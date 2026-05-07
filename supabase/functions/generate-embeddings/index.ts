import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, requireStaffRole } from "../_shared/auth.ts";
import {
  jsonError,
  statusForError,
  structuredErrorBody,
  wrapHandler,
} from "../_shared/httpError.ts";
import type { SupabaseAdminClient } from "../_shared/database.types.ts";
import {
  buildOrganizationStructuredEmbeddingText,
  buildOrganizationTextChunks,
  buildPersonTextChunks,
  buildStructuredEmbeddingText,
  cancelAsyncEmbeddingBatch,
  createAsyncEmbeddingBatch,
  EMBEDDING_DIM,
  type EmbeddingDocumentInput,
  type EmbeddingEntityType,
  type EmbeddingTargetType,
  type EmbeddingTextChunkInput,
  embedTexts,
  getAsyncEmbeddingBatch,
  type OrganizationEmbeddingDocumentInput,
} from "../_shared/embeddings.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, apikey, x-client-info",
};

const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_ASYNC_BATCH_SIZE = 40;
const MAX_ASYNC_BATCH_SIZE = 60;

interface PersonRow {
  id: string;
  name: string | null;
  current_position: string | null;
  bio: string | null;
  occupation: string | null;
  location_id: string | null;
  embedding_dirty_at: string | null;
  person_flemish_connections?: {
    role?: string | null;
    evidence_excerpt?: string | null;
    flemish_connections:
      | { name: string | null }
      | { name: string | null }[]
      | null;
  }[] | null;
}

interface SectorRow {
  sectors:
    | { name: string | null }
    | { name: string | null }[]
    | null;
}

interface LocationRow {
  city: string | null;
  state: string | null;
}

interface OrganizationRow {
  id: string;
  name: string | null;
  type: string | null;
  description: string | null;
  website_url: string | null;
  location_id: string | null;
  us_network_status: string | null;
  embedding_dirty_at?: string | null;
}

interface OrganizationSearchDocumentRow {
  organization_id: string;
  sector_names: string | null;
  flemish_link: string | null;
  primary_location_text: string | null;
  location_text: string | null;
}

interface ChunkUpsertRow extends Record<string, unknown> {
  person_id?: string;
  organization_id?: string;
  chunk_type: string;
  chunk_index: number;
  chunk_text: string;
  embedding: string;
}

interface ClaimedJobRow {
  entity_type: EmbeddingEntityType;
  entity_id: string;
  person_id?: string;
  organization_id?: string;
  claim_token: string;
  claimed_dirty_at: string;
}

interface QueueJobUpdate extends Record<string, unknown> {
  status: "pending" | "running";
  queued_at?: string;
  claimed_at: string | null;
  claimed_dirty_at: string | null;
  claim_token: string | null;
  last_error?: string | null;
}

interface EmbeddingWorkManifestChunk {
  chunk_type: string;
  chunk_index: number;
  chunk_text: string;
}

interface EmbeddingWorkManifestItem {
  entity_type: EmbeddingEntityType;
  entity_id: string;
  person_id?: string;
  organization_id?: string;
  entity_name: string;
  claim_token: string;
  claimed_dirty_at: string;
  document_text: string;
  chunk_plans: EmbeddingWorkManifestChunk[];
}

interface PreparedEmbeddingJob {
  job: ClaimedJobRow;
  entity_type: EmbeddingEntityType;
  entity_id: string;
  entity_name: string;
  text: string;
  chunks: EmbeddingTextChunkInput[];
}

interface EmbeddingBatchRunRow {
  id: string;
  gemini_batch_name: string;
  display_name: string;
  status: string;
  request_count: number;
  people_count: number;
  manifest: unknown;
  batch_state: string | null;
  batch_stats: Record<string, unknown> | null;
  started_at: string;
  completed_at: string | null;
  last_polled_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

interface SupabaseErrorLike {
  message?: string;
  code?: string;
}

interface SupabaseResultLike {
  data?: unknown;
  error: SupabaseErrorLike | null;
  count?: number | null;
}

interface DynamicQuery extends PromiseLike<SupabaseResultLike> {
  select(columns?: string, options?: Record<string, unknown>): DynamicQuery;
  update(values: Record<string, unknown>): DynamicQuery;
  insert(
    values: Record<string, unknown> | Record<string, unknown>[],
  ): DynamicQuery;
  delete(): DynamicQuery;
  eq(column: string, value: unknown): DynamicQuery;
  in(column: string, values: unknown[]): DynamicQuery;
  order(column: string, options?: Record<string, unknown>): DynamicQuery;
  limit(count: number): DynamicQuery;
  maybeSingle(): Promise<SupabaseResultLike>;
  single(): Promise<SupabaseResultLike>;
}

function firstRelationRow<T>(
  value: T | T[] | null | undefined,
): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function fromDynamic(supabase: SupabaseAdminClient, table: string) {
  return (supabase.from as unknown as (tableName: string) => DynamicQuery)(
    table,
  );
}

async function rpcDynamic(
  supabase: SupabaseAdminClient,
  functionName: string,
  args: Record<string, unknown>,
): Promise<{ data: unknown; error: SupabaseErrorLike | null }> {
  return await (
    supabase.rpc as unknown as (
      fn: string,
      args?: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: SupabaseErrorLike | null }>
  )(functionName, args);
}

function isMissingRpcError(error: SupabaseErrorLike | null): boolean {
  if (!error) return false;
  const message = error.message || "";
  return error.code === "PGRST202" ||
    /function .* could not be found/i.test(message);
}

function isMissingRelationError(error: SupabaseErrorLike | null): boolean {
  if (!error) return false;
  const message = error.message || "";
  return error.code === "42P01" ||
    error.code === "PGRST205" ||
    /relation .* does not exist/i.test(message) ||
    /could not find the table/i.test(message);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeEntityType(value: unknown): EmbeddingTargetType {
  if (value === "organization" || value === "all") return value;
  return "person";
}

function normalizeStringIds(...values: unknown[]): string[] {
  const ids = new Set<string>();

  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      ids.add(value.trim());
    } else if (Array.isArray(value)) {
      value.forEach((item) => {
        if (typeof item === "string" && item.trim()) {
          ids.add(item.trim());
        }
      });
    }
  }

  return Array.from(ids);
}

function normalizeClaimedJobs(value: unknown): ClaimedJobRow[] {
  if (!Array.isArray(value)) return [];

  return value.map((item) => {
    const row = item && typeof item === "object"
      ? (item as Record<string, unknown>)
      : {};
    const personId = typeof row.person_id === "string" ? row.person_id : "";
    const organizationId = typeof row.organization_id === "string"
      ? row.organization_id
      : "";
    const rawType: EmbeddingEntityType = row.entity_type === "organization" ||
        (!personId && organizationId)
      ? "organization"
      : "person";
    const entityId = typeof row.entity_id === "string"
      ? row.entity_id
      : rawType === "organization"
      ? organizationId
      : personId;
    const claimToken = typeof row.claim_token === "string"
      ? row.claim_token
      : "";
    const claimedDirtyAt = typeof row.claimed_dirty_at === "string"
      ? row.claimed_dirty_at
      : "";

    return {
      entity_type: rawType,
      entity_id: entityId,
      person_id: personId || undefined,
      organization_id: organizationId || undefined,
      claim_token: claimToken,
      claimed_dirty_at: claimedDirtyAt,
    };
  }).filter((job) => job.entity_id && job.claim_token && job.claimed_dirty_at);
}

function labelManifestItem(
  item: Pick<EmbeddingWorkManifestItem, "entity_type" | "entity_id">,
) {
  return `${item.entity_type} ${item.entity_id}`;
}

function buildFlemishConnectionNames(person: PersonRow): string[] {
  const names = new Set<string>();

  for (const link of person.person_flemish_connections || []) {
    const raw = link.flemish_connections;
    const rows = Array.isArray(raw) ? raw : raw ? [raw] : [];
    for (const row of rows) {
      const name = row?.name?.trim();
      if (!name) continue;
      const evidence = [link.role, link.evidence_excerpt]
        .map((value) => value?.trim())
        .filter(Boolean)
        .join(" ");
      names.add(evidence ? `${name} ${evidence}` : name);
    }
  }

  return Array.from(names).sort();
}

function buildLocationText(location: LocationRow | null): string {
  if (!location) return "";
  return [location.city, location.state].filter(Boolean).join(", ");
}

function buildEmbeddingInput(
  person: PersonRow,
  sectorNames: string[],
  location: LocationRow | null,
): EmbeddingDocumentInput {
  return {
    name: person.name || "",
    currentPosition: person.current_position || "",
    bio: person.bio || "",
    occupation: person.occupation || "",
    sectors: sectorNames,
    flemishConnections: buildFlemishConnectionNames(person),
    locationText: buildLocationText(location),
  };
}

function splitSearchDocumentValues(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildOrganizationEmbeddingInput(
  organization: OrganizationRow,
  searchDocument: OrganizationSearchDocumentRow | null,
  location: LocationRow | null,
): OrganizationEmbeddingDocumentInput {
  return {
    name: organization.name || "",
    type: organization.type || "",
    description: organization.description || "",
    sectors: splitSearchDocumentValues(searchDocument?.sector_names),
    flemishLink: searchDocument?.flemish_link || "",
    locationText: searchDocument?.location_text ||
      searchDocument?.primary_location_text ||
      buildLocationText(location),
    usNetworkStatus: organization.us_network_status || "",
    websiteUrl: organization.website_url || "",
  };
}

async function enqueueDirtyJobs(
  supabase: SupabaseAdminClient,
  entityType: EmbeddingTargetType,
): Promise<number> {
  let queued = 0;

  if (entityType === "person" || entityType === "all") {
    const { data, error } = await supabase.rpc("enqueue_dirty_embedding_jobs");
    if (error) throw error;
    queued += typeof data === "number" ? data : 0;
  }

  if (entityType === "organization" || entityType === "all") {
    const { data, error } = await rpcDynamic(
      supabase,
      "enqueue_dirty_organization_embedding_jobs",
      {},
    );
    if (error) throw error;
    queued += typeof data === "number" ? data : 0;
  }

  return queued;
}

async function enqueueSpecificPeople(
  supabase: SupabaseAdminClient,
  personIds: string[],
): Promise<number> {
  if (personIds.length === 0) return 0;

  const { data, error } = await supabase.rpc("enqueue_people_embedding_jobs", {
    p_person_ids: personIds,
  });

  if (error) {
    throw error;
  }

  return typeof data === "number" ? data : 0;
}

async function enqueueSpecificOrganizations(
  supabase: SupabaseAdminClient,
  organizationIds: string[],
): Promise<number> {
  if (organizationIds.length === 0) return 0;

  const primary = await rpcDynamic(
    supabase,
    "enqueue_organization_embedding_jobs",
    {
      p_organization_ids: organizationIds,
    },
  );

  if (!primary.error) {
    return typeof primary.data === "number" ? primary.data : 0;
  }

  if (!isMissingRpcError(primary.error)) {
    throw primary.error;
  }

  const fallback = await rpcDynamic(supabase, "enqueue_embedding_jobs", {
    p_entity_type: "organization",
    p_entity_ids: organizationIds,
  });

  if (fallback.error) {
    throw fallback.error;
  }

  return typeof fallback.data === "number" ? fallback.data : 0;
}

async function getOutstandingJobCount(
  supabase: SupabaseAdminClient,
): Promise<number> {
  const [peopleJobs, organizationJobs] = await Promise.all([
    supabase
      .from("embedding_jobs")
      .select("status", { count: "exact", head: true }),
    fromDynamic(supabase, "organization_embedding_jobs")
      .select("status", { count: "exact", head: true }),
  ]);

  if (peopleJobs.error) throw peopleJobs.error;
  if (
    organizationJobs.error && !isMissingRelationError(organizationJobs.error)
  ) {
    throw organizationJobs.error;
  }

  return (peopleJobs.count || 0) +
    (organizationJobs.error ? 0 : organizationJobs.count || 0);
}

async function releaseJobAsPending(
  supabase: SupabaseAdminClient,
  job: Pick<
    ClaimedJobRow,
    "entity_type" | "entity_id" | "person_id" | "organization_id"
  >,
  claimToken: string,
  queuedAt: string | null,
  lastError: string | null,
): Promise<void> {
  const update: QueueJobUpdate = {
    status: "pending",
    queued_at: queuedAt || new Date().toISOString(),
    claimed_at: null,
    claimed_dirty_at: null,
    claim_token: null,
    last_error: lastError,
  };

  const { error } = job.entity_type === "organization"
    ? await fromDynamic(supabase, "organization_embedding_jobs")
      .update(update)
      .eq("organization_id", job.organization_id || job.entity_id)
      .eq("claim_token", claimToken)
    : await supabase
      .from("embedding_jobs")
      .update(update)
      .eq("person_id", job.person_id || job.entity_id)
      .eq("claim_token", claimToken);

  if (error) {
    throw error;
  }
}

async function deleteJob(
  supabase: SupabaseAdminClient,
  job: Pick<
    ClaimedJobRow,
    "entity_type" | "entity_id" | "person_id" | "organization_id"
  >,
  claimToken: string,
): Promise<void> {
  const { error } = job.entity_type === "organization"
    ? await fromDynamic(supabase, "organization_embedding_jobs")
      .delete()
      .eq("organization_id", job.organization_id || job.entity_id)
      .eq("claim_token", claimToken)
    : await supabase
      .from("embedding_jobs")
      .delete()
      .eq("person_id", job.person_id || job.entity_id)
      .eq("claim_token", claimToken);

  if (error) {
    throw error;
  }
}

async function claimJobs(
  supabase: SupabaseAdminClient,
  batchSize: number,
  entityType: EmbeddingTargetType,
  personIds: string[] | null,
  organizationIds: string[] | null,
): Promise<ClaimedJobRow[]> {
  const claimToken = crypto.randomUUID();
  const jobs: ClaimedJobRow[] = [];
  const personBatchSize = entityType === "all"
    ? Math.max(1, Math.ceil(batchSize / 2))
    : batchSize;
  const organizationBatchSize = entityType === "all"
    ? Math.max(1, Math.floor(batchSize / 2))
    : batchSize;

  if (entityType === "person" || entityType === "all") {
    const { data, error } = await supabase.rpc("claim_embedding_jobs", {
      p_batch_size: personBatchSize,
      p_claim_token: claimToken,
      p_person_ids: personIds && personIds.length > 0 ? personIds : null,
    });

    if (error) throw error;
    jobs.push(...normalizeClaimedJobs(data));
  }

  if (entityType === "organization" || entityType === "all") {
    const { data, error } = await rpcDynamic(
      supabase,
      "claim_organization_embedding_jobs",
      {
        p_batch_size: organizationBatchSize,
        p_claim_token: claimToken,
        p_organization_ids: organizationIds && organizationIds.length > 0
          ? organizationIds
          : null,
      },
    );

    if (error) throw error;
    jobs.push(...normalizeClaimedJobs(data));
  }

  return jobs.slice(0, batchSize);
}

function normalizeManifest(
  value: unknown,
): EmbeddingWorkManifestItem[] {
  if (!Array.isArray(value)) return [];

  return value.map((item) => {
    const row = item && typeof item === "object"
      ? (item as Record<string, unknown>)
      : {};

    const chunkPlans = Array.isArray(row.chunk_plans)
      ? row.chunk_plans
        .map((chunk) => {
          const chunkRow = chunk && typeof chunk === "object"
            ? (chunk as Record<string, unknown>)
            : {};
          return {
            chunk_type: String(chunkRow.chunk_type || "combined"),
            chunk_index: Number(chunkRow.chunk_index || 0),
            chunk_text: String(chunkRow.chunk_text || ""),
          };
        })
        .filter((chunk) => chunk.chunk_text.trim().length > 0)
      : [];
    const entityType: EmbeddingEntityType = row.entity_type === "organization"
      ? "organization"
      : "person";
    const personId = String(row.person_id || "");
    const organizationId = String(row.organization_id || "");
    const entityId = String(
      row.entity_id ||
        (entityType === "organization" ? organizationId : personId),
    );

    return {
      entity_type: entityType,
      entity_id: entityId,
      person_id: personId || undefined,
      organization_id: organizationId || undefined,
      entity_name: String(row.entity_name || row.person_name || ""),
      claim_token: String(row.claim_token || ""),
      claimed_dirty_at: String(row.claimed_dirty_at || ""),
      document_text: String(row.document_text || ""),
      chunk_plans: chunkPlans,
    };
  }).filter((item) =>
    item.entity_id &&
    item.claim_token &&
    item.claimed_dirty_at
  );
}

async function prepareEmbeddingJobs(
  supabase: SupabaseAdminClient,
  jobs: ClaimedJobRow[],
): Promise<{
  preparedJobs: PreparedEmbeddingJob[];
  failed: number;
  errors: string[];
}> {
  let failed = 0;
  const errors: string[] = [];

  const personIds = jobs
    .filter((job) => job.entity_type === "person")
    .map((job) => job.person_id || job.entity_id);
  const organizationIds = jobs
    .filter((job) => job.entity_type === "organization")
    .map((job) => job.organization_id || job.entity_id);

  const [peopleRes, sectorRes, organizationRes, organizationSearchRes] =
    await Promise.all([
      personIds.length > 0
        ? supabase
          .from("people")
          .select(
            "id, name, current_position, bio, occupation, location_id, embedding_dirty_at, person_flemish_connections(role, evidence_excerpt, flemish_connections(name))",
          )
          .in("id", personIds)
        : { data: [], error: null },
      personIds.length > 0
        ? supabase
          .from("person_sectors")
          .select("person_id, sectors(name)")
          .in("person_id", personIds)
        : { data: [], error: null },
      organizationIds.length > 0
        ? supabase
          .from("organizations")
          .select(
            "id, name, type, description, website_url, location_id, us_network_status, embedding_dirty_at",
          )
          .in("id", organizationIds)
        : { data: [], error: null },
      organizationIds.length > 0
        ? supabase
          .from("organization_search_documents")
          .select(
            "organization_id, sector_names, flemish_link, primary_location_text, location_text",
          )
          .in("organization_id", organizationIds)
        : { data: [], error: null },
    ]);

  if (peopleRes.error) {
    throw peopleRes.error;
  }

  if (sectorRes.error) {
    throw sectorRes.error;
  }

  if (organizationRes.error) {
    throw organizationRes.error;
  }

  if (organizationSearchRes.error) {
    throw organizationSearchRes.error;
  }

  const peopleById = new Map<string, PersonRow>();
  const locationIds = new Set<string>();
  for (const row of (peopleRes.data || []) as unknown as PersonRow[]) {
    peopleById.set(row.id, row);
    if (row.location_id) locationIds.add(row.location_id);
  }

  const organizationsById = new Map<string, OrganizationRow>();
  for (
    const row of (organizationRes.data || []) as unknown as OrganizationRow[]
  ) {
    organizationsById.set(row.id, row);
    if (row.location_id) locationIds.add(row.location_id);
  }

  const organizationSearchById = new Map<
    string,
    OrganizationSearchDocumentRow
  >();
  for (
    const row of (organizationSearchRes.data ||
      []) as unknown as OrganizationSearchDocumentRow[]
  ) {
    organizationSearchById.set(row.organization_id, row);
  }

  const { data: locationRows, error: locationError } = locationIds.size > 0
    ? await supabase
      .from("locations")
      .select("id, city, state")
      .in("id", Array.from(locationIds))
    : { data: [], error: null };

  if (locationError) {
    throw locationError;
  }

  const locationById = new Map<string, LocationRow>();
  for (
    const row of (locationRows || []) as Array<LocationRow & { id: string }>
  ) {
    locationById.set(row.id, row);
  }

  const sectorNamesByPerson = new Map<string, string[]>();
  for (
    const row of ((sectorRes.data || []) as unknown as Array<{
      person_id: string;
      sectors: SectorRow["sectors"];
    }>)
  ) {
    const next = sectorNamesByPerson.get(row.person_id) || [];
    const name = firstRelationRow(row.sectors)?.name;
    if (name && !next.includes(name)) {
      next.push(name);
      sectorNamesByPerson.set(row.person_id, next);
    }
  }

  const preparedJobs: PreparedEmbeddingJob[] = [];

  for (const job of jobs) {
    if (job.entity_type === "organization") {
      const organizationId = job.organization_id || job.entity_id;
      const organization = organizationsById.get(organizationId);
      if (!organization) {
        await deleteJob(supabase, job, job.claim_token);
        continue;
      }

      const input = buildOrganizationEmbeddingInput(
        organization,
        organizationSearchById.get(organizationId) || null,
        organization.location_id
          ? locationById.get(organization.location_id) || null
          : null,
      );
      const text = buildOrganizationStructuredEmbeddingText(input);

      if (!text.trim()) {
        await releaseJobAsPending(
          supabase,
          job,
          job.claim_token,
          organization.embedding_dirty_at || job.claimed_dirty_at,
          "Empty embedding text",
        );
        errors.push(`Organization ${organizationId}: empty embedding text`);
        failed += 1;
        continue;
      }

      preparedJobs.push({
        job,
        entity_type: "organization",
        entity_id: organizationId,
        entity_name: organization.name || "",
        text,
        chunks: buildOrganizationTextChunks(input),
      });
      continue;
    }

    const personId = job.person_id || job.entity_id;
    const person = peopleById.get(personId);
    if (!person) {
      await deleteJob(supabase, job, job.claim_token);
      continue;
    }

    const input = buildEmbeddingInput(
      person,
      sectorNamesByPerson.get(personId) || [],
      person.location_id ? locationById.get(person.location_id) || null : null,
    );
    const text = buildStructuredEmbeddingText(input);

    if (!text.trim()) {
      await releaseJobAsPending(
        supabase,
        job,
        job.claim_token,
        person.embedding_dirty_at,
        "Empty embedding text",
      );
      errors.push(`Person ${personId}: empty embedding text`);
      failed += 1;
      continue;
    }

    preparedJobs.push({
      job,
      entity_type: "person",
      entity_id: personId,
      entity_name: person.name || "",
      text,
      chunks: buildPersonTextChunks(input),
    });
  }

  return { preparedJobs, failed, errors };
}

function buildManifestFromPreparedJobs(
  preparedJobs: PreparedEmbeddingJob[],
): EmbeddingWorkManifestItem[] {
  return preparedJobs.map((
    { job, entity_type, entity_id, entity_name, text, chunks },
  ) => ({
    entity_type,
    entity_id,
    person_id: entity_type === "person" ? entity_id : undefined,
    organization_id: entity_type === "organization" ? entity_id : undefined,
    entity_name,
    claim_token: job.claim_token,
    claimed_dirty_at: job.claimed_dirty_at,
    document_text: text,
    chunk_plans: chunks.map((chunk) => ({
      chunk_type: chunk.chunk_type,
      chunk_index: chunk.chunk_index,
      chunk_text: chunk.chunk_text,
    })),
  }));
}

async function releaseManifestJobsAsPending(
  supabase: SupabaseAdminClient,
  manifest: EmbeddingWorkManifestItem[],
  message: string,
): Promise<string[]> {
  const errors: string[] = [];

  for (const item of manifest) {
    try {
      await releaseJobAsPending(
        supabase,
        item,
        item.claim_token,
        item.claimed_dirty_at,
        message,
      );
    } catch (error) {
      errors.push(
        `${labelManifestItem(item)}: failed to release job - ${
          (error as Error).message || "unknown error"
        }`,
      );
    }
  }

  return errors;
}

async function applyEmbeddingOutputs(
  supabase: SupabaseAdminClient,
  manifest: EmbeddingWorkManifestItem[],
  documentEmbeddings: number[][],
  chunkEmbeddings: number[][],
): Promise<{ processed: number; failed: number; errors: string[] }> {
  let processed = 0;
  let failed = 0;
  const errors: string[] = [];

  let chunkOffset = 0;

  for (let index = 0; index < manifest.length; index += 1) {
    const item = manifest[index];

    try {
      const documentEmbedding = documentEmbeddings[index];
      if (!documentEmbedding) {
        throw new Error("Missing document embedding");
      }

      const vectorStr = `[${documentEmbedding.join(",")}]`;

      const entityId = item.entity_id;
      const entityTable = item.entity_type === "organization"
        ? "organizations"
        : "people";
      const chunkTable = item.entity_type === "organization"
        ? "organization_text_chunks"
        : "person_text_chunks";
      const chunkForeignKey = item.entity_type === "organization"
        ? "organization_id"
        : "person_id";

      const { data: updatedEntity, error: updateError } = await supabase
        .from(entityTable)
        .update({
          embedding: vectorStr,
          embedding_generated_at: item.claimed_dirty_at,
        })
        .eq("id", entityId)
        .select("embedding_dirty_at")
        .maybeSingle();

      if (updateError) {
        throw updateError;
      }

      const { error: deleteChunkError } = await fromDynamic(
        supabase,
        chunkTable,
      )
        .delete()
        .eq(chunkForeignKey, entityId);

      if (deleteChunkError) {
        throw deleteChunkError;
      }

      const chunkRows: ChunkUpsertRow[] = item.chunk_plans.map(
        (chunk, chunkIndex) => {
          const embedding = chunkEmbeddings[chunkOffset + chunkIndex];
          if (!embedding) {
            throw new Error(
              `Missing chunk embedding for ${chunk.chunk_type}:${chunk.chunk_index}`,
            );
          }

          return {
            [chunkForeignKey]: entityId,
            chunk_type: chunk.chunk_type,
            chunk_index: chunk.chunk_index,
            chunk_text: chunk.chunk_text,
            embedding: `[${embedding.join(",")}]`,
          };
        },
      );

      chunkOffset += item.chunk_plans.length;

      if (chunkRows.length > 0) {
        const { error: insertChunkError } = await fromDynamic(
          supabase,
          chunkTable,
        )
          .insert(chunkRows);

        if (insertChunkError) {
          throw insertChunkError;
        }
      }

      const dirtyAt = updatedEntity?.embedding_dirty_at as
        | string
        | null
        | undefined;
      if (
        dirtyAt &&
        new Date(dirtyAt).getTime() > new Date(item.claimed_dirty_at).getTime()
      ) {
        await releaseJobAsPending(
          supabase,
          item,
          item.claim_token,
          dirtyAt,
          null,
        );
      } else {
        await deleteJob(supabase, item, item.claim_token);
      }

      processed += 1;
    } catch (error) {
      const message = (error as Error).message || "Embedding refresh failed";
      errors.push(`${labelManifestItem(item)}: ${message}`);
      failed += 1;

      try {
        await releaseJobAsPending(
          supabase,
          item,
          item.claim_token,
          item.claimed_dirty_at,
          message,
        );
      } catch (releaseError) {
        errors.push(
          `${labelManifestItem(item)}: failed to release job - ${
            (releaseError as Error).message || "unknown error"
          }`,
        );
      }

      chunkOffset += item.chunk_plans.length;
    }
  }

  return { processed, failed, errors };
}

function extractBatchResource(
  operation: Record<string, unknown>,
): Record<string, unknown> | null {
  const direct = operation.batch;
  if (direct && typeof direct === "object") {
    return direct as Record<string, unknown>;
  }

  const response = operation.response;
  if (response && typeof response === "object") {
    const batch = (response as Record<string, unknown>).batch;
    if (batch && typeof batch === "object") {
      return batch as Record<string, unknown>;
    }
  }

  const metadata = operation.metadata;
  if (metadata && typeof metadata === "object") {
    const batch = (metadata as Record<string, unknown>).batch;
    if (batch && typeof batch === "object") {
      return batch as Record<string, unknown>;
    }
  }

  return null;
}

function extractBatchState(
  operation: Record<string, unknown>,
  batch: Record<string, unknown> | null,
): string {
  const batchState = typeof batch?.state === "string" ? batch.state : null;
  if (batchState) return batchState;

  if (operation.done === true) {
    return operation.error ? "FAILED" : "SUCCEEDED";
  }

  return "RUNNING";
}

function batchStatusFromState(state: string): string {
  const normalized = state.toUpperCase();
  if (normalized.includes("CANCEL")) return "cancelled";
  if (normalized.includes("FAIL")) return "failed";
  if (
    normalized.includes("SUCCEED") || normalized.includes("DONE") ||
    normalized.includes("COMPLETE")
  ) {
    return "succeeded";
  }
  return "running";
}

function extractEmbeddingValues(payload: unknown): number[] {
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;

  if (Array.isArray(record.values)) {
    return record.values.filter((value): value is number =>
      typeof value === "number"
    );
  }

  if (record.embedding && typeof record.embedding === "object") {
    return extractEmbeddingValues(record.embedding);
  }

  if (record.response && typeof record.response === "object") {
    return extractEmbeddingValues(record.response);
  }

  return [];
}

async function loadBatchRuns(
  supabase: SupabaseAdminClient,
  limit = 5,
  batchName?: string,
): Promise<EmbeddingBatchRunRow[]> {
  let query = supabase
    .from("embedding_batch_runs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (batchName) {
    query = query.eq("gemini_batch_name", batchName);
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return (data || []) as EmbeddingBatchRunRow[];
}

async function syncBatchRun(
  supabase: SupabaseAdminClient,
  apiKey: string,
  batchRun: EmbeddingBatchRunRow,
): Promise<EmbeddingBatchRunRow> {
  const operation = await getAsyncEmbeddingBatch(
    apiKey,
    batchRun.gemini_batch_name,
  );
  const batch = extractBatchResource(operation);
  const batchState = extractBatchState(operation, batch);
  const status = batchStatusFromState(batchState);
  const manifest = normalizeManifest(batchRun.manifest);
  const batchStats = batch?.batchStats && typeof batch.batchStats === "object"
    ? batch.batchStats as Record<string, unknown>
    : batchRun.batch_stats;

  let completedAt = batchRun.completed_at;
  let lastError = batchRun.last_error;
  let nextStatus = status;

  if (status === "succeeded") {
    const inlinedResponses = batch?.output &&
        typeof batch.output === "object" &&
        (batch.output as Record<string, unknown>).inlinedResponses &&
        typeof (batch.output as Record<string, unknown>).inlinedResponses ===
          "object"
      ? ((batch.output as Record<string, unknown>).inlinedResponses as Record<
        string,
        unknown
      >)
        .inlinedResponses
      : null;

    if (!Array.isArray(inlinedResponses)) {
      nextStatus = "failed";
      lastError = "Async batch completed without inline embedding responses";
      const releaseErrors = await releaseManifestJobsAsPending(
        supabase,
        manifest,
        lastError,
      );
      if (releaseErrors.length > 0) {
        lastError = `${lastError}; ${releaseErrors.join("; ")}`;
      }
    } else {
      const expectedRequests = manifest.reduce(
        (sum, item) => sum + 1 + item.chunk_plans.length,
        0,
      );

      if (inlinedResponses.length !== expectedRequests) {
        nextStatus = "failed";
        lastError =
          `Async batch returned ${inlinedResponses.length} responses for ${expectedRequests} requests`;
        const releaseErrors = await releaseManifestJobsAsPending(
          supabase,
          manifest,
          lastError,
        );
        if (releaseErrors.length > 0) {
          lastError = `${lastError}; ${releaseErrors.join("; ")}`;
        }
      } else {
        const documentEmbeddings: number[][] = [];
        const chunkEmbeddings: number[][] = [];
        let responseIndex = 0;
        const itemErrors = new Map<string, string>();

        for (const item of manifest) {
          const itemKey = `${item.entity_type}:${item.entity_id}`;
          const documentResponse = inlinedResponses[responseIndex] &&
              typeof inlinedResponses[responseIndex] === "object"
            ? (inlinedResponses[responseIndex] as Record<string, unknown>)
            : {};
          responseIndex += 1;

          if (documentResponse.error) {
            itemErrors.set(
              itemKey,
              `Document embedding failed: ${
                JSON.stringify(documentResponse.error)
              }`,
            );
          } else {
            const embedding = extractEmbeddingValues(documentResponse.response);
            if (embedding.length === 0) {
              itemErrors.set(itemKey, "Document embedding missing values");
            } else {
              documentEmbeddings.push(embedding);
            }
          }

          for (
            let chunkIdx = 0;
            chunkIdx < item.chunk_plans.length;
            chunkIdx += 1
          ) {
            const chunkResponse = inlinedResponses[responseIndex] &&
                typeof inlinedResponses[responseIndex] === "object"
              ? (inlinedResponses[responseIndex] as Record<string, unknown>)
              : {};
            responseIndex += 1;

            if (!itemErrors.has(itemKey)) {
              if (chunkResponse.error) {
                itemErrors.set(
                  itemKey,
                  `Chunk embedding failed: ${
                    JSON.stringify(chunkResponse.error)
                  }`,
                );
              } else {
                const embedding = extractEmbeddingValues(
                  chunkResponse.response,
                );
                if (embedding.length === 0) {
                  itemErrors.set(itemKey, "Chunk embedding missing values");
                } else {
                  chunkEmbeddings.push(embedding);
                }
              }
            }
          }
        }

        if (itemErrors.size > 0) {
          nextStatus = "failed";
          lastError = Array.from(itemErrors.entries())
            .map(([itemKey, message]) => `${itemKey}: ${message}`)
            .join("; ");
          const releaseErrors = await releaseManifestJobsAsPending(
            supabase,
            manifest,
            lastError,
          );
          if (releaseErrors.length > 0) {
            lastError = `${lastError}; ${releaseErrors.join("; ")}`;
          }
        } else {
          const applyResult = await applyEmbeddingOutputs(
            supabase,
            manifest,
            documentEmbeddings,
            chunkEmbeddings,
          );

          lastError = applyResult.errors.length > 0
            ? applyResult.errors.join("; ")
            : null;
          nextStatus = applyResult.failed > 0 ? "failed" : "ingested";
        }
      }
    }

    completedAt = new Date().toISOString();
  } else if (status === "failed" || status === "cancelled") {
    lastError = operation.error
      ? JSON.stringify(operation.error)
      : lastError || `Async batch ${status}`;
    completedAt = completedAt || new Date().toISOString();
    const releaseErrors = await releaseManifestJobsAsPending(
      supabase,
      manifest,
      lastError,
    );
    if (releaseErrors.length > 0) {
      lastError = `${lastError}; ${releaseErrors.join("; ")}`;
    }
  }

  const { data, error } = await supabase
    .from("embedding_batch_runs")
    .update({
      status: nextStatus,
      batch_state: batchState,
      batch_stats: batchStats || {},
      completed_at: completedAt,
      last_polled_at: new Date().toISOString(),
      last_error: lastError,
    })
    .eq("id", batchRun.id)
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return data as EmbeddingBatchRunRow;
}

Deno.serve(wrapHandler(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiKey) {
      return jsonError(
        500,
        "agent_failure",
        "GEMINI_API_KEY not configured",
        "Set GEMINI_API_KEY in edge function secrets.",
      );
    }

    const supabase = createAdminClient();
    await requireStaffRole(req, supabase, "editor");
    const body = req.method === "POST"
      ? await req.json() as Record<string, unknown>
      : {};
    const action = typeof body.action === "string" ? body.action : "process";
    const requestedEntityType = normalizeEntityType(body.entity_type);
    const personIds = normalizeStringIds(
      body.personId,
      body.person_id,
      body.personIds,
      body.person_ids,
    );
    const organizationIds = normalizeStringIds(
      body.organizationId,
      body.organization_id,
      body.organizationIds,
      body.organization_ids,
    );
    const claimEntityType: EmbeddingTargetType = organizationIds.length > 0 &&
        personIds.length > 0
      ? "all"
      : organizationIds.length > 0
      ? "organization"
      : requestedEntityType;
    const batchSizeInput =
      typeof body.batch_size === "number" && body.batch_size > 0
        ? Math.floor(body.batch_size)
        : null;
    const batchSize = batchSizeInput
      ? Math.min(batchSizeInput, 100)
      : DEFAULT_BATCH_SIZE;
    const asyncBatchSize = batchSizeInput
      ? Math.min(batchSizeInput, MAX_ASYNC_BATCH_SIZE)
      : DEFAULT_ASYNC_BATCH_SIZE;
    const backfill = body.backfill === true;
    const kick = body.kick === true;
    const statusOnly = body.status_only === true;
    const batchName = typeof body.batch_name === "string"
      ? body.batch_name.trim()
      : "";

    let enqueued = 0;

    if (personIds.length > 0) {
      enqueued += await enqueueSpecificPeople(supabase, personIds);
    }

    if (organizationIds.length > 0) {
      enqueued += await enqueueSpecificOrganizations(supabase, organizationIds);
    }

    if (backfill) {
      enqueued += await enqueueDirtyJobs(supabase, requestedEntityType);
    }

    if (action === "list_batches") {
      const batchRuns = await loadBatchRuns(supabase, 6);
      const syncedRuns: EmbeddingBatchRunRow[] = [];

      for (const batchRun of batchRuns) {
        if (batchRun.status === "running" || batchRun.status === "succeeded") {
          syncedRuns.push(await syncBatchRun(supabase, geminiKey, batchRun));
        } else {
          syncedRuns.push(batchRun);
        }
      }

      return jsonResponse({
        batches: syncedRuns,
        remaining: await getOutstandingJobCount(supabase),
        enqueued,
      });
    }

    if (action === "cancel_batch") {
      if (!batchName) {
        return jsonError(400, "invalid_input", "batch_name is required");
      }

      const [existingRun] = await loadBatchRuns(supabase, 1, batchName);
      if (!existingRun) {
        return jsonError(404, "not_found", "Batch not found");
      }

      await cancelAsyncEmbeddingBatch(geminiKey, batchName);
      const releaseErrors = await releaseManifestJobsAsPending(
        supabase,
        normalizeManifest(existingRun.manifest),
        "Cancelled by operator",
      );
      const { data: cancelledBatch, error: cancelError } = await supabase
        .from("embedding_batch_runs")
        .update({
          status: "cancelled",
          batch_state: "CANCELLED",
          completed_at: new Date().toISOString(),
          last_polled_at: new Date().toISOString(),
          last_error: releaseErrors.length > 0
            ? releaseErrors.join("; ")
            : null,
        })
        .eq("id", existingRun.id)
        .select("*")
        .single();

      if (cancelError) {
        throw cancelError;
      }

      return jsonResponse({
        batch: cancelledBatch,
        remaining: await getOutstandingJobCount(supabase),
      });
    }

    if (action === "poll_batch") {
      if (!batchName) {
        return jsonError(400, "invalid_input", "batch_name is required");
      }

      const [existingRun] = await loadBatchRuns(supabase, 1, batchName);
      if (!existingRun) {
        return jsonError(404, "not_found", "Batch not found");
      }

      const synced = await syncBatchRun(supabase, geminiKey, existingRun);

      return jsonResponse({
        batch: synced,
        remaining: await getOutstandingJobCount(supabase),
      });
    }

    if (statusOnly) {
      return jsonResponse({
        processed: 0,
        failed: 0,
        claimed: 0,
        enqueued,
        remaining: await getOutstandingJobCount(supabase),
        errors: [],
      });
    }

    if (action === "start_batch") {
      const claimedJobs = await claimJobs(
        supabase,
        asyncBatchSize,
        backfill ? requestedEntityType : claimEntityType,
        personIds.length > 0 && !backfill ? personIds : null,
        organizationIds.length > 0 && !backfill ? organizationIds : null,
      );

      if (claimedJobs.length === 0) {
        return jsonResponse({
          batch: null,
          claimed: 0,
          enqueued,
          remaining: await getOutstandingJobCount(supabase),
          errors: [],
        });
      }

      const prepared = await prepareEmbeddingJobs(supabase, claimedJobs);
      const manifest = buildManifestFromPreparedJobs(prepared.preparedJobs);

      if (manifest.length === 0) {
        return jsonResponse({
          batch: null,
          claimed: claimedJobs.length,
          enqueued,
          remaining: await getOutstandingJobCount(supabase),
          failed: prepared.failed,
          errors: prepared.errors,
        });
      }

      const batchRequests = manifest.flatMap((item) => [
        {
          request: {
            content: { parts: [{ text: item.document_text }] },
            taskType: "RETRIEVAL_DOCUMENT" as const,
            title: item.entity_name || undefined,
            outputDimensionality: EMBEDDING_DIM,
          },
          metadata: {
            entity_type: item.entity_type,
            entity_id: item.entity_id,
            person_id: item.person_id,
            organization_id: item.organization_id,
            request_type: "document",
          },
        },
        ...item.chunk_plans.map((chunk) => ({
          request: {
            content: { parts: [{ text: chunk.chunk_text }] },
            taskType: "RETRIEVAL_DOCUMENT" as const,
            title: item.entity_name || undefined,
            outputDimensionality: EMBEDDING_DIM,
          },
          metadata: {
            entity_type: item.entity_type,
            entity_id: item.entity_id,
            person_id: item.person_id,
            organization_id: item.organization_id,
            request_type: "chunk",
            chunk_type: chunk.chunk_type,
            chunk_index: chunk.chunk_index,
          },
        })),
      ]);

      const displayName = `flemish-network-embeddings-${
        new Date().toISOString().replace(/[:.]/g, "-")
      }`;

      try {
        const geminiBatchName = await createAsyncEmbeddingBatch(
          geminiKey,
          batchRequests,
          displayName,
        );

        const { data: insertedBatch, error: insertBatchError } = await supabase
          .from("embedding_batch_runs")
          .insert({
            gemini_batch_name: geminiBatchName,
            display_name: displayName,
            status: "running",
            request_count: batchRequests.length,
            people_count: manifest.filter((item) =>
              item.entity_type === "person"
            ).length,
            manifest,
            batch_state: "RUNNING",
            batch_stats: {
              requestCount: batchRequests.length,
              peopleCount: manifest.filter((item) =>
                item.entity_type === "person"
              ).length,
              organizationCount: manifest.filter((item) =>
                item.entity_type === "organization"
              ).length,
              successfulRequestCount: 0,
              failedRequestCount: 0,
              pendingRequestCount: batchRequests.length,
            },
            started_at: new Date().toISOString(),
          })
          .select("*")
          .single();

        if (insertBatchError) {
          throw insertBatchError;
        }

        return jsonResponse({
          batch: insertedBatch,
          claimed: claimedJobs.length,
          enqueued,
          failed: prepared.failed,
          errors: prepared.errors,
          remaining: await getOutstandingJobCount(supabase),
        });
      } catch (error) {
        const message = (error as Error).message ||
          "Async embedding batch failed";
        const releaseErrors = await releaseManifestJobsAsPending(
          supabase,
          manifest,
          message,
        );

        return jsonResponse({
          batch: null,
          claimed: claimedJobs.length,
          enqueued,
          failed: manifest.length + prepared.failed,
          errors: [...prepared.errors, message, ...releaseErrors],
          remaining: await getOutstandingJobCount(supabase),
        }, 500);
      }
    }

    const shouldProcess = backfill || kick || personIds.length > 0 ||
      organizationIds.length > 0;
    if (!shouldProcess) {
      return jsonResponse({
        processed: 0,
        failed: 0,
        claimed: 0,
        enqueued,
        remaining: await getOutstandingJobCount(supabase),
        errors: [],
      });
    }

    const claimedJobs = await claimJobs(
      supabase,
      batchSize,
      backfill ? requestedEntityType : claimEntityType,
      personIds.length > 0 && !backfill && !kick ? personIds : null,
      organizationIds.length > 0 && !backfill && !kick ? organizationIds : null,
    );

    if (claimedJobs.length === 0) {
      return jsonResponse({
        processed: 0,
        failed: 0,
        claimed: 0,
        enqueued,
        remaining: await getOutstandingJobCount(supabase),
        errors: [],
      });
    }

    const result = await processClaimedJobs(supabase, geminiKey, claimedJobs);

    return jsonResponse({
      ...result,
      claimed: claimedJobs.length,
      enqueued,
      remaining: await getOutstandingJobCount(supabase),
    });
  } catch (err) {
    return jsonResponse(structuredErrorBody(err), statusForError(err));
  }
}));

async function processClaimedJobs(
  supabase: SupabaseAdminClient,
  apiKey: string,
  jobs: ClaimedJobRow[],
): Promise<{ processed: number; failed: number; errors: string[] }> {
  const prepared = await prepareEmbeddingJobs(supabase, jobs);
  const manifest = buildManifestFromPreparedJobs(prepared.preparedJobs);

  if (manifest.length === 0) {
    return { processed: 0, failed: prepared.failed, errors: prepared.errors };
  }

  let documentEmbeddings: number[][] = [];
  let chunkEmbeddings: number[][] = [];

  try {
    documentEmbeddings = await embedTexts(
      apiKey,
      manifest.map((item) => ({
        text: item.document_text,
        title: item.entity_name || undefined,
        taskType: "RETRIEVAL_DOCUMENT",
      })),
    );

    const chunkRequests = manifest.flatMap((item) =>
      item.chunk_plans.map((chunk) => ({
        text: chunk.chunk_text,
        title: item.entity_name || undefined,
        taskType: "RETRIEVAL_DOCUMENT" as const,
      }))
    );

    chunkEmbeddings = chunkRequests.length > 0
      ? await embedTexts(apiKey, chunkRequests)
      : [];
  } catch (error) {
    const message = (error as Error).message || "Embedding refresh failed";
    const releaseErrors = await releaseManifestJobsAsPending(
      supabase,
      manifest,
      message,
    );

    return {
      processed: 0,
      failed: manifest.length + prepared.failed,
      errors: [...prepared.errors, message, ...releaseErrors],
    };
  }

  const applied = await applyEmbeddingOutputs(
    supabase,
    manifest,
    documentEmbeddings,
    chunkEmbeddings,
  );

  return {
    processed: applied.processed,
    failed: prepared.failed + applied.failed,
    errors: [...prepared.errors, ...applied.errors],
  };
}
