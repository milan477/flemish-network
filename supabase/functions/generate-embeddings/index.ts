import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import type { Database, SupabaseAdminClient } from "../_shared/database.types.ts";
import {
  buildPersonTextChunks,
  buildStructuredEmbeddingText,
  embedTexts,
  type EmbeddingDocumentInput,
} from "../_shared/embeddings.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, apikey, x-client-info",
};

const DEFAULT_BATCH_SIZE = 20;

interface PersonRow {
  id: string;
  name: string | null;
  current_position: string | null;
  bio: string | null;
  occupation: string | null;
  location_id: string | null;
  embedding_dirty_at: string | null;
  person_flemish_connections?: {
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

interface ChunkUpsertRow extends Record<string, unknown> {
  person_id: string;
  chunk_type: "bio" | "position" | "combined";
  chunk_index: number;
  chunk_text: string;
  embedding: string;
}

interface ClaimedJobRow {
  person_id: string;
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

function firstRelationRow<T>(
  value: T | T[] | null | undefined
): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function buildFlemishConnectionNames(person: PersonRow): string[] {
  const names = new Set<string>();

  for (const link of person.person_flemish_connections || []) {
    const raw = link.flemish_connections;
    const rows = Array.isArray(raw) ? raw : raw ? [raw] : [];
    for (const row of rows) {
      const name = row?.name?.trim();
      if (name) names.add(name);
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
  location: LocationRow | null
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

async function enqueueDirtyJobs(
  supabase: SupabaseAdminClient
): Promise<number> {
  const { data, error } = await supabase.rpc("enqueue_dirty_embedding_jobs");
  if (error) {
    throw error;
  }
  return typeof data === "number" ? data : 0;
}

async function enqueueSpecificPeople(
  supabase: SupabaseAdminClient,
  personIds: string[]
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

async function getOutstandingJobCount(
  supabase: SupabaseAdminClient
): Promise<number> {
  const { count, error } = await supabase
    .from("embedding_jobs")
    .select("person_id", { count: "exact", head: true });

  if (error) {
    throw error;
  }

  return count || 0;
}

async function releaseJobAsPending(
  supabase: SupabaseAdminClient,
  personId: string,
  claimToken: string,
  queuedAt: string | null,
  lastError: string | null
): Promise<void> {
  const update: QueueJobUpdate = {
    status: "pending",
    queued_at: queuedAt || new Date().toISOString(),
    claimed_at: null,
    claimed_dirty_at: null,
    claim_token: null,
    last_error: lastError,
  };

  const { error } = await supabase
    .from("embedding_jobs")
    .update(update)
    .eq("person_id", personId)
    .eq("claim_token", claimToken);

  if (error) {
    throw error;
  }
}

async function deleteJob(
  supabase: SupabaseAdminClient,
  personId: string,
  claimToken: string
): Promise<void> {
  const { error } = await supabase
    .from("embedding_jobs")
    .delete()
    .eq("person_id", personId)
    .eq("claim_token", claimToken);

  if (error) {
    throw error;
  }
}

async function claimJobs(
  supabase: SupabaseAdminClient,
  batchSize: number,
  personIds: string[] | null
): Promise<ClaimedJobRow[]> {
  const claimToken = crypto.randomUUID();
  const { data, error } = await supabase.rpc("claim_embedding_jobs", {
    p_batch_size: batchSize,
    p_claim_token: claimToken,
    p_person_ids: personIds && personIds.length > 0 ? personIds : null,
  });

  if (error) {
    throw error;
  }

  return (data || []) as ClaimedJobRow[];
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiKey) {
      return jsonResponse({ error: "GEMINI_API_KEY not configured" }, 500);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseKey) {
      return jsonResponse(
        { error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" },
        500
      );
    }

    const supabase = createClient<Database>(supabaseUrl, supabaseKey);
    const body = req.method === "POST"
      ? await req.json() as Record<string, unknown>
      : {};
    const personId = typeof body.personId === "string" ? body.personId : null;
    const personIds = Array.isArray(body.personIds)
      ? body.personIds.filter((value: unknown): value is string =>
          typeof value === "string" && value.trim().length > 0
        )
      : [];
    const batchSize =
      typeof body.batch_size === "number" && body.batch_size > 0
        ? Math.min(body.batch_size, 100)
        : DEFAULT_BATCH_SIZE;
    const backfill = body.backfill === true;
    const kick = body.kick === true;
    const statusOnly = body.status_only === true;

    const targetSeedIds: string[] = personId ? [personId, ...personIds] : personIds;
    const targetedPersonIds: string[] = Array.from(new Set(targetSeedIds));

    let enqueued = 0;

    if (targetedPersonIds.length > 0) {
      enqueued += await enqueueSpecificPeople(supabase, targetedPersonIds);
    }

    if (backfill) {
      enqueued += await enqueueDirtyJobs(supabase);
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

    const shouldProcess = backfill || kick || targetedPersonIds.length > 0;
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
      targetedPersonIds.length > 0 && !backfill && !kick ? targetedPersonIds : null
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
    return jsonResponse(
      { error: (err as Error).message || "Internal error" },
      500
    );
  }
});

async function processClaimedJobs(
  supabase: SupabaseAdminClient,
  apiKey: string,
  jobs: ClaimedJobRow[]
): Promise<{ processed: number; failed: number; errors: string[] }> {
  let processed = 0;
  let failed = 0;
  const errors: string[] = [];

  const personIds = jobs.map((job) => job.person_id);
  const [peopleRes, sectorRes] = await Promise.all([
    supabase
      .from("people")
      .select(
        "id, name, current_position, bio, occupation, location_id, embedding_dirty_at, person_flemish_connections(flemish_connections(name))"
      )
      .in("id", personIds),
    supabase
      .from("person_sectors")
      .select("person_id, sectors(name)")
      .in("person_id", personIds),
  ]);

  if (peopleRes.error) {
    throw peopleRes.error;
  }

  if (sectorRes.error) {
    throw sectorRes.error;
  }

  const peopleById = new Map<string, PersonRow>();
  const locationIds = new Set<string>();
  for (const row of (peopleRes.data || []) as unknown as PersonRow[]) {
    peopleById.set(row.id, row);
    if (row.location_id) locationIds.add(row.location_id);
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
  for (const row of (locationRows || []) as Array<LocationRow & { id: string }>) {
    locationById.set(row.id, row);
  }

  const sectorNamesByPerson = new Map<string, string[]>();
  for (const row of ((sectorRes.data || []) as unknown as Array<{
    person_id: string;
    sectors: SectorRow["sectors"];
  }>)) {
    const next = sectorNamesByPerson.get(row.person_id) || [];
    const name = firstRelationRow(row.sectors)?.name;
    if (name && !next.includes(name)) {
      next.push(name);
      sectorNamesByPerson.set(row.person_id, next);
    }
  }

  const executableJobs: Array<{
    job: ClaimedJobRow;
    person: PersonRow;
    text: string;
    chunks: ReturnType<typeof buildPersonTextChunks>;
  }> = [];

  for (const job of jobs) {
    const person = peopleById.get(job.person_id);
    if (!person) {
      await deleteJob(supabase, job.person_id, job.claim_token);
      continue;
    }

    const input = buildEmbeddingInput(
      person,
      sectorNamesByPerson.get(job.person_id) || [],
      person.location_id ? locationById.get(person.location_id) || null : null,
    );
    const text = buildStructuredEmbeddingText(input);

    if (!text.trim()) {
      await releaseJobAsPending(
        supabase,
        job.person_id,
        job.claim_token,
        person.embedding_dirty_at,
        "Empty embedding text"
      );
      errors.push(`Person ${job.person_id}: empty embedding text`);
      failed += 1;
      continue;
    }

    executableJobs.push({
      job,
      person,
      text,
      chunks: buildPersonTextChunks(input),
    });
  }

  if (executableJobs.length === 0) {
    return { processed, failed, errors };
  }

  let documentEmbeddings: number[][] = [];
  let chunkEmbeddings: number[][] = [];
  const chunkPlans: Array<ChunkUpsertRow & { person_name: string }> = [];

  try {
    documentEmbeddings = await embedTexts(
      apiKey,
      executableJobs.map(({ person, text }) => ({
        text,
        title: person.name || undefined,
        taskType: "RETRIEVAL_DOCUMENT",
      })),
    );

    const chunkRequests = executableJobs.flatMap(({ person, chunks }) =>
      chunks.map((chunk) => {
        chunkPlans.push({
          person_id: person.id,
          person_name: person.name || "",
          chunk_type: chunk.chunk_type,
          chunk_index: chunk.chunk_index,
          chunk_text: chunk.chunk_text,
          embedding: "",
        });

        return {
          text: chunk.chunk_text,
          title: person.name || undefined,
          taskType: "RETRIEVAL_DOCUMENT" as const,
        };
      })
    );

    chunkEmbeddings = chunkRequests.length > 0
      ? await embedTexts(apiKey, chunkRequests)
      : [];
  } catch (err) {
    const message = (err as Error).message || "Embedding refresh failed";

    for (const { job } of executableJobs) {
      errors.push(`Person ${job.person_id}: ${message}`);
      failed += 1;

      try {
        await releaseJobAsPending(
          supabase,
          job.person_id,
          job.claim_token,
          job.claimed_dirty_at,
          message
        );
      } catch (releaseError) {
        errors.push(
          `Person ${job.person_id}: failed to release job - ${
            (releaseError as Error).message || "unknown error"
          }`
        );
      }
    }

    return { processed, failed, errors };
  }

  chunkPlans.forEach((plan, index) => {
    const embedding = chunkEmbeddings[index];
    if (embedding) {
      plan.embedding = `[${embedding.join(",")}]`;
    }
  });

  const chunksByPerson = new Map<string, ChunkUpsertRow[]>();
  for (const plan of chunkPlans) {
    if (!plan.embedding) continue;
    const next = chunksByPerson.get(plan.person_id) || [];
    next.push({
      person_id: plan.person_id,
      chunk_type: plan.chunk_type,
      chunk_index: plan.chunk_index,
      chunk_text: plan.chunk_text,
      embedding: plan.embedding,
    });
    chunksByPerson.set(plan.person_id, next);
  }

  for (let index = 0; index < executableJobs.length; index += 1) {
    const { job } = executableJobs[index];
    try {
      const embedding = documentEmbeddings[index];
      const vectorStr = `[${embedding.join(",")}]`;

      const { data: updatedPerson, error: updateError } = await supabase
        .from("people")
        .update({
          embedding: vectorStr,
          embedding_generated_at: job.claimed_dirty_at,
        })
        .eq("id", job.person_id)
        .select("embedding_dirty_at")
        .maybeSingle();

      if (updateError) {
        throw updateError;
      }

      const { error: deleteChunkError } = await supabase
        .from("person_text_chunks")
        .delete()
        .eq("person_id", job.person_id);

      if (deleteChunkError) {
        throw deleteChunkError;
      }

      const chunkRows = chunksByPerson.get(job.person_id) || [];
      if (chunkRows.length > 0) {
        const { error: insertChunkError } = await supabase
          .from("person_text_chunks")
          .insert(chunkRows);

        if (insertChunkError) {
          throw insertChunkError;
        }
      }

      const dirtyAt = updatedPerson?.embedding_dirty_at;
      if (
        dirtyAt &&
        new Date(dirtyAt).getTime() > new Date(job.claimed_dirty_at).getTime()
      ) {
        await releaseJobAsPending(
          supabase,
          job.person_id,
          job.claim_token,
          dirtyAt,
          null
        );
      } else {
        await deleteJob(supabase, job.person_id, job.claim_token);
      }

      processed += 1;
    } catch (err) {
      const message = (err as Error).message || "Embedding refresh failed";
      errors.push(`Person ${job.person_id}: ${message}`);
      failed += 1;

      try {
        await releaseJobAsPending(
          supabase,
          job.person_id,
          job.claim_token,
          job.claimed_dirty_at,
          message
        );
      } catch (releaseError) {
        errors.push(
          `Person ${job.person_id}: failed to release job - ${
            (releaseError as Error).message || "unknown error"
          }`
        );
      }
    }
  }

  return { processed, failed, errors };
}
