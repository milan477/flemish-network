import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  createAdminClient,
  requireStaffRole,
} from "../_shared/auth.ts";
import {
  applyRerankAndBackfill,
  fallbackCollectionSuggestionPlan,
  parseCollectionSuggestionPlan,
  parseRerankedCollectionCandidates,
  type CollectionSuggestionCandidate,
  type CollectionSuggestionEntityType,
  type CollectionSuggestionPlan,
  type CollectionSuggestionSearch,
} from "../_shared/collectionSuggestions.ts";
import { embedTexts } from "../_shared/embeddings.ts";
import { callGeminiStructured } from "../_shared/gemini.ts";
import { errorToResponse, jsonError, wrapHandler } from "../_shared/httpError.ts";
import {
  classifySearchRoute,
  getSearchRouteConfig,
} from "../_shared/searchRouting.ts";
import {
  buildLexicalQueryForIntent,
  parseSearchIntent,
} from "../_shared/searchCriteria.ts";
import type { SmartSearchKeywords } from "../_shared/aiContracts.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, apikey, x-client-info",
};

const RRF_K = 60;
const DEFAULT_LIMIT = 15;
const MAX_LIMIT = 30;

const EMPTY_KEYWORDS: SmartSearchKeywords = {
  name: [],
  occupation: [],
  sector: [],
  location_city: [],
  location_state: [],
  current_position: [],
  flemish_connection: [],
  bio: [],
};

interface LexicalPersonMatch {
  person_id: string;
  lexical_score: number;
  exact_name_match: boolean;
  name_score: number;
  match_field: string | null;
  match_text: string | null;
}

interface VectorPersonMatch {
  id: string;
  similarity: number;
}

interface ChunkPersonMatch {
  person_id: string;
  chunk_text: string;
  similarity: number;
}

interface OrganizationLexicalMatch {
  organization_id: string;
  lexical_score: number;
  exact_name_match: boolean;
  name_score: number;
  match_field: string | null;
  match_text: string | null;
}

interface OrganizationVectorMatch {
  id?: string;
  organization_id?: string;
  similarity: number;
}

interface OrganizationChunkMatch {
  id: string;
  organization_id: string;
  chunk_text: string;
  similarity: number;
}

interface PersonRow {
  id: string;
  name: string;
  current_position: string | null;
  bio: string | null;
  occupation: string | null;
}

interface PeopleSearchDocumentRow {
  person_id: string;
  current_position: string | null;
  occupation: string | null;
  bio: string | null;
  flemish_connection_names: string | null;
  sector_names: string | null;
  location_text: string | null;
}

interface OrganizationRow {
  id: string;
  name: string;
  type: string | null;
  description: string | null;
}

interface OrganizationSearchDocumentRow {
  organization_id: string;
  type: string | null;
  description: string | null;
  flemish_fact_text: string | null;
  sector_names: string | null;
  primary_location_text: string | null;
  location_text: string | null;
  us_network_status: string | null;
}

interface CandidateAccumulator {
  entity_type: CollectionSuggestionEntityType;
  id: string;
  source_search: string;
  score: number;
  reason: string;
  snippet?: string;
}

interface CollectionMemberRow {
  person_id: string | null;
  organization_id: string | null;
}

interface SearchIntent {
  originalQuery: string;
  lexicalQuery: string;
  semanticQuery: string;
  search: CollectionSuggestionSearch;
  route: ReturnType<typeof classifySearchRoute>;
  config: ReturnType<typeof getSearchRouteConfig>;
}

function clampScore(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function reciprocalRank(rank: number): number {
  return 1 / (RRF_K + rank);
}

function optionalReciprocalRank(rank: number | undefined): number {
  return rank ? reciprocalRank(rank) : 0;
}

function getFieldBoost(route: SearchIntent["route"], field: string | null): number {
  if (!field) return 0;

  if (route === "direct_lookup") {
    return field === "flemish_connection" || field === "occupation" ? 0.015 : 0;
  }

  if (route === "faceted") {
    return ["flemish_connection", "sector", "location", "occupation"].includes(field)
      ? 0.02
      : 0.008;
  }

  return field === "bio" || field === "description" ? 0.015 : 0.01;
}

function buildSearchIntents(
  originalQuery: string,
  searches: CollectionSuggestionSearch[],
): SearchIntent[] {
  return searches.map((search) => {
    const parsedIntent = parseSearchIntent(search.query, EMPTY_KEYWORDS);
    const lexicalQuery = buildLexicalQueryForIntent(parsedIntent);
    const route = classifySearchRoute(parsedIntent.original_query, parsedIntent.keywords);
    return {
      originalQuery,
      lexicalQuery,
      semanticQuery: originalQuery,
      search,
      route,
      config: getSearchRouteConfig(route),
    };
  });
}

async function callUntypedRpc<T>(
  supabase: ReturnType<typeof createAdminClient>,
  fn: string,
  args: Record<string, unknown>,
): Promise<{ data: T[] | null; error: unknown }> {
  const rpc = supabase.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: T[] | null; error: unknown }>;
  return await rpc(fn, args);
}

function getOrganizationMatchId(
  candidate: OrganizationVectorMatch | OrganizationChunkMatch,
): string | null {
  if ("organization_id" in candidate && candidate.organization_id) {
    return candidate.organization_id;
  }
  return "id" in candidate && candidate.id ? candidate.id : null;
}

function normalizeLimit(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(value)));
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

function truncateSnippet(value: string | null | undefined, maxLength = 220): string | undefined {
  const normalized = (value || "").trim().replace(/\s+/g, " ");
  if (!normalized) return undefined;
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
}

function upsertAccumulator(
  map: Map<string, CandidateAccumulator>,
  candidate: CandidateAccumulator,
) {
  const key = `${candidate.entity_type}:${candidate.id}`;
  const existing = map.get(key);
  if (!existing || candidate.score > existing.score) {
    map.set(key, candidate);
  }
}

function textFromPersonDocument(
  document: PeopleSearchDocumentRow | undefined,
  person: PersonRow,
): string | undefined {
  return truncateSnippet(
    [
      document?.current_position || person.current_position,
      document?.occupation || person.occupation,
      document?.flemish_connection_names,
      document?.sector_names,
      document?.location_text,
      document?.bio || person.bio,
    ].filter(Boolean).join(" | "),
  );
}

function textFromOrganizationDocument(
  document: OrganizationSearchDocumentRow | undefined,
  organization: OrganizationRow,
): string | undefined {
  return truncateSnippet(
    [
      document?.type || organization.type,
      document?.sector_names,
      document?.location_text || document?.primary_location_text,
      document?.flemish_fact_text,
      document?.description || organization.description,
      document?.us_network_status,
    ].filter(Boolean).join(" | "),
  );
}

async function parseGoalWithGemini(
  apiKey: string,
  query: string,
): Promise<CollectionSuggestionPlan> {
  const { data } = await callGeminiStructured({
    apiKey,
    route: "query_parsing",
    systemPrompt:
      "Parse a staff collection goal into focused searches over approved people and organizations. Return concise JSON only.",
    userPrompt: `Collection goal: "${query}"

Return at most 4 searches. Each search must include a query and targets containing "person", "organization", or both.
If the goal suggests missing database coverage that should be discovered later, set gap.should_offer and provide a suggested Discovery prompt. Do not start Discovery.`,
    schema: {
      type: "OBJECT",
      properties: {
        searches: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              query: { type: "STRING" },
              targets: {
                type: "ARRAY",
                items: { type: "STRING", enum: ["person", "organization"] },
              },
            },
            required: ["query", "targets"],
          },
        },
        gap: {
          type: "OBJECT",
          properties: {
            should_offer: { type: "BOOLEAN" },
            reason: { type: "STRING" },
            suggested_prompt: { type: "STRING" },
          },
          required: ["should_offer"],
        },
      },
      required: ["searches", "gap"],
    },
    parse: (payload: unknown) => parseCollectionSuggestionPlan(payload, query),
    temperature: 0.1,
    attemptsPerModel: 1,
  });

  return data;
}

async function rerankWithGemini(
  apiKey: string,
  query: string,
  candidates: CollectionSuggestionCandidate[],
): Promise<{ message: string; candidates: CollectionSuggestionCandidate[] }> {
  const candidateList = candidates
    .slice(0, 60)
    .map((candidate) =>
      `- ${candidate.entity_type} | ID: ${candidate.id} | Name: ${candidate.name} | Search: ${candidate.source_search} | Score: ${candidate.score.toFixed(3)} | Snippet: ${candidate.snippet || ""}`
    )
    .join("\n");

  const { data } = await callGeminiStructured({
    apiKey,
    route: "offline_evaluation",
    systemPrompt:
      "Rank existing approved people and organizations for a collection. Never invent IDs; only return IDs from the supplied candidate list.",
    userPrompt: `Collection goal: "${query}"

Candidates:
${candidateList}

Return the best mixed candidates. Include only relevant IDs from the list.`,
    schema: {
      type: "OBJECT",
      properties: {
        message: { type: "STRING" },
        candidates: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              entity_type: { type: "STRING", enum: ["person", "organization"] },
              id: { type: "STRING" },
              reason: { type: "STRING" },
              score: { type: "NUMBER" },
            },
            required: ["entity_type", "id", "reason", "score"],
          },
        },
      },
      required: ["message", "candidates"],
    },
    parse: parseRerankedCollectionCandidates,
    temperature: 0.2,
    attemptsPerModel: 1,
  });

  return {
    message: data.message,
    candidates: applyRerankAndBackfill(candidates, data.candidates, candidates.length),
  };
}

async function getSearchEmbeddings(
  apiKey: string,
  intents: SearchIntent[],
): Promise<Array<number[] | null>> {
  try {
    const embeddings = await embedTexts(
      apiKey,
      intents.map((intent) => ({
        text: intent.semanticQuery,
        taskType: "RETRIEVAL_QUERY",
      })),
    );
    return embeddings;
  } catch (err) {
    console.warn("[suggest-people] collection suggestion embeddings degraded", err);
    return intents.map(() => null);
  }
}

async function retrieveCandidates(
  supabase: ReturnType<typeof createAdminClient>,
  intents: SearchIntent[],
  embeddings: Array<number[] | null>,
): Promise<CollectionSuggestionCandidate[]> {
  const accumulators = new Map<string, CandidateAccumulator>();
  const candidatePersonIds = new Set<string>();
  const candidateOrganizationIds = new Set<string>();

  for (let searchIndex = 0; searchIndex < intents.length; searchIndex += 1) {
    const intent = intents[searchIndex];
    const { search, route, config } = intent;
    const embedding = embeddings[searchIndex];
    const wantsPeople = search.targets.includes("person");
    const wantsOrganizations = search.targets.includes("organization");

    const vectorStr = embedding ? `[${embedding.join(",")}]` : null;
    const [
      peopleLexicalResponse,
      vectorResponse,
      chunkResponse,
      organizationResponse,
      organizationVectorResponse,
      organizationChunkResponse,
    ] =
      await Promise.all([
        wantsPeople
          ? supabase.rpc("search_people_lexical", {
            search_query: intent.lexicalQuery,
            search_route: route,
            match_count: config.lexicalTopK,
          })
          : { data: [] as LexicalPersonMatch[], error: null },
        wantsPeople && vectorStr
          ? supabase.rpc("match_people", {
            query_embedding: vectorStr,
            match_count: config.vectorTopK,
            similarity_threshold: config.vectorSimilarityThreshold,
          })
          : { data: [] as VectorPersonMatch[], error: null },
        wantsPeople && vectorStr
          ? supabase.rpc("match_person_text_chunks", {
            query_embedding: vectorStr,
            match_count: config.vectorTopK * 2,
            similarity_threshold: Math.max(0.35, config.vectorSimilarityThreshold - 0.08),
          })
          : { data: [] as ChunkPersonMatch[], error: null },
        wantsOrganizations
          ? supabase.rpc("search_organizations_lexical", {
            search_query: intent.lexicalQuery,
            search_route: route,
            match_count: config.lexicalTopK,
          })
          : { data: [] as OrganizationLexicalMatch[], error: null },
        wantsOrganizations && vectorStr
          ? callUntypedRpc<OrganizationVectorMatch>(
            supabase,
            "match_organizations",
            {
              query_embedding: vectorStr,
              match_count: config.vectorTopK,
              similarity_threshold: config.vectorSimilarityThreshold,
            },
          )
          : { data: [] as OrganizationVectorMatch[], error: null },
        wantsOrganizations && vectorStr
          ? callUntypedRpc<OrganizationChunkMatch>(
            supabase,
            "match_organization_text_chunks",
            {
              query_embedding: vectorStr,
              match_count: config.vectorTopK * 2,
              similarity_threshold: Math.max(0.35, config.vectorSimilarityThreshold - 0.08),
            },
          )
          : { data: [] as OrganizationChunkMatch[], error: null },
      ]);

    if (peopleLexicalResponse.error) throw peopleLexicalResponse.error;
    if (vectorResponse.error) throw vectorResponse.error;
    if (chunkResponse.error) throw chunkResponse.error;
    if (organizationResponse.error) throw organizationResponse.error;
    if (organizationVectorResponse.error) throw organizationVectorResponse.error;
    if (organizationChunkResponse.error) throw organizationChunkResponse.error;

    const peopleLexicalMatches = (peopleLexicalResponse.data || []) as LexicalPersonMatch[];
    const vectorMatches = (vectorResponse.data || []) as VectorPersonMatch[];
    const chunkMatches = (chunkResponse.data || []) as ChunkPersonMatch[];
    const organizationMatches = (organizationResponse.data || []) as OrganizationLexicalMatch[];
    const organizationVectorMatches =
      (organizationVectorResponse.data || []) as OrganizationVectorMatch[];
    const organizationChunkMatches =
      (organizationChunkResponse.data || []) as OrganizationChunkMatch[];

    const lexicalByPerson = new Map<string, LexicalPersonMatch>();
    const lexicalRanks = new Map<string, number>();
    peopleLexicalMatches.forEach((match, index) => {
      lexicalByPerson.set(match.person_id, match);
      lexicalRanks.set(match.person_id, index + 1);
    });

    const vectorByPerson = new Map<string, VectorPersonMatch>();
    const vectorRanks = new Map<string, number>();
    vectorMatches.forEach((match, index) => {
      vectorByPerson.set(match.id, match);
      vectorRanks.set(match.id, index + 1);
    });

    const chunkByPerson = new Map<string, ChunkPersonMatch>();
    const chunkRanks = new Map<string, number>();
    chunkMatches.forEach((match, index) => {
      const existing = chunkByPerson.get(match.person_id);
      if (!existing || match.similarity > existing.similarity) {
        chunkByPerson.set(match.person_id, match);
      }
      if (!chunkRanks.has(match.person_id)) {
        chunkRanks.set(match.person_id, index + 1);
      }
    });

    const personIds = new Set([
      ...lexicalByPerson.keys(),
      ...vectorByPerson.keys(),
      ...chunkByPerson.keys(),
    ]);

    for (const personId of personIds) {
      candidatePersonIds.add(personId);
      const lexical = lexicalByPerson.get(personId);
      const vector = vectorByPerson.get(personId);
      const bestChunk = chunkByPerson.get(personId);
      const score =
        config.lexicalWeight * optionalReciprocalRank(lexicalRanks.get(personId)) +
        config.vectorWeight * optionalReciprocalRank(vectorRanks.get(personId)) +
        0.5 * config.vectorWeight * optionalReciprocalRank(chunkRanks.get(personId)) +
        config.lexicalSignalWeight * clampScore(lexical?.lexical_score) +
        config.vectorSignalWeight * clampScore(vector?.similarity) +
        0.08 * clampScore(bestChunk?.similarity) +
        (lexical?.exact_name_match ? config.exactBoost : 0) +
        (lexical ? config.nameBoost * clampScore(lexical.name_score / 1.2) : 0) +
        getFieldBoost(route, lexical?.match_field || null);

      upsertAccumulator(accumulators, {
        entity_type: "person",
        id: personId,
        source_search: intent.lexicalQuery,
        score,
        reason: `Matched approved people records for "${intent.lexicalQuery}".`,
        snippet: truncateSnippet(bestChunk?.chunk_text || lexical?.match_text),
      });
    }

    const organizationLexicalById = new Map<string, OrganizationLexicalMatch>();
    const organizationLexicalRanks = new Map<string, number>();
    organizationMatches.forEach((match, index) => {
      organizationLexicalById.set(match.organization_id, match);
      organizationLexicalRanks.set(match.organization_id, index + 1);
    });

    const organizationVectorById = new Map<string, OrganizationVectorMatch>();
    const organizationVectorRanks = new Map<string, number>();
    organizationVectorMatches.forEach((match, index) => {
      const organizationId = getOrganizationMatchId(match);
      if (!organizationId) return;
      organizationVectorById.set(organizationId, match);
      organizationVectorRanks.set(organizationId, index + 1);
    });

    const organizationChunkById = new Map<string, OrganizationChunkMatch>();
    const organizationChunkRanks = new Map<string, number>();
    organizationChunkMatches.forEach((match, index) => {
      const organizationId = getOrganizationMatchId(match);
      if (!organizationId) return;
      const existing = organizationChunkById.get(organizationId);
      if (!existing || match.similarity > existing.similarity) {
        organizationChunkById.set(organizationId, match);
      }
      if (!organizationChunkRanks.has(organizationId)) {
        organizationChunkRanks.set(organizationId, index + 1);
      }
    });

    const organizationIds = new Set([
      ...organizationLexicalById.keys(),
      ...organizationVectorById.keys(),
      ...organizationChunkById.keys(),
    ]);

    for (const organizationId of organizationIds) {
      candidateOrganizationIds.add(organizationId);
      const lexical = organizationLexicalById.get(organizationId);
      const vector = organizationVectorById.get(organizationId);
      const bestChunk = organizationChunkById.get(organizationId);
      const score =
        config.lexicalWeight * optionalReciprocalRank(organizationLexicalRanks.get(organizationId)) +
        config.vectorWeight * optionalReciprocalRank(organizationVectorRanks.get(organizationId)) +
        0.5 * config.vectorWeight * optionalReciprocalRank(organizationChunkRanks.get(organizationId)) +
        config.lexicalSignalWeight * clampScore(lexical?.lexical_score) +
        config.vectorSignalWeight * clampScore(vector?.similarity) +
        0.08 * clampScore(bestChunk?.similarity) +
        (lexical?.exact_name_match ? 0.6 * config.exactBoost : 0) +
        (lexical ? 0.8 * config.nameBoost * clampScore(lexical.name_score / 1.2) : 0) +
        getFieldBoost(route, lexical?.match_field || null);

      upsertAccumulator(accumulators, {
        entity_type: "organization",
        id: organizationId,
        source_search: intent.lexicalQuery,
        score,
        reason: `Matched approved organization records for "${intent.lexicalQuery}".`,
        snippet: truncateSnippet(bestChunk?.chunk_text || lexical?.match_text),
      });
    }
  }

  const [peopleResponse, peopleDocumentsResponse, organizationsResponse, organizationDocumentsResponse] =
    await Promise.all([
      candidatePersonIds.size > 0
        ? supabase
          .from("people")
          .select("id, name, current_position, bio, occupation")
          .in("id", Array.from(candidatePersonIds))
        : { data: [] as PersonRow[], error: null },
      candidatePersonIds.size > 0
        ? supabase
          .from("people_search_documents")
          .select(
            "person_id, current_position, occupation, bio, flemish_connection_names, sector_names, location_text",
          )
          .in("person_id", Array.from(candidatePersonIds))
        : { data: [] as PeopleSearchDocumentRow[], error: null },
      candidateOrganizationIds.size > 0
        ? supabase
          .from("organizations")
          .select("id, name, type, description")
          .in("id", Array.from(candidateOrganizationIds))
        : { data: [] as OrganizationRow[], error: null },
      candidateOrganizationIds.size > 0
        ? supabase
          .from("organization_search_documents")
          .select(
            "organization_id, type, description, flemish_fact_text, sector_names, primary_location_text, location_text, us_network_status",
          )
          .in("organization_id", Array.from(candidateOrganizationIds))
        : { data: [] as OrganizationSearchDocumentRow[], error: null },
    ]);

  if (peopleResponse.error) throw peopleResponse.error;
  if (peopleDocumentsResponse.error) throw peopleDocumentsResponse.error;
  if (organizationsResponse.error) throw organizationsResponse.error;
  if (organizationDocumentsResponse.error) throw organizationDocumentsResponse.error;

  const peopleById = new Map(
    ((peopleResponse.data || []) as PersonRow[]).map((person) => [person.id, person]),
  );
  const peopleDocumentsById = new Map(
    ((peopleDocumentsResponse.data || []) as PeopleSearchDocumentRow[]).map((document) => [
      document.person_id,
      document,
    ]),
  );
  const organizationsById = new Map(
    ((organizationsResponse.data || []) as OrganizationRow[]).map((organization) => [
      organization.id,
      organization,
    ]),
  );
  const organizationDocumentsById = new Map(
    ((organizationDocumentsResponse.data || []) as OrganizationSearchDocumentRow[]).map((document) => [
      document.organization_id,
      document,
    ]),
  );

  return Array.from(accumulators.values())
    .map((candidate): CollectionSuggestionCandidate | null => {
      if (candidate.entity_type === "person") {
        const person = peopleById.get(candidate.id);
        if (!person) return null;
        const document = peopleDocumentsById.get(candidate.id);
        return {
          entity_type: "person",
          id: person.id,
          name: person.name,
          reason: candidate.reason,
          score: Math.round(clampScore(candidate.score) * 1000) / 1000,
          snippet: candidate.snippet || textFromPersonDocument(document, person),
          source_search: candidate.source_search,
        } satisfies CollectionSuggestionCandidate;
      }

      const organization = organizationsById.get(candidate.id);
      if (!organization) return null;
      const document = organizationDocumentsById.get(candidate.id);
      return {
        entity_type: "organization",
        id: organization.id,
        name: organization.name,
        reason: candidate.reason,
        score: Math.round(clampScore(candidate.score) * 1000) / 1000,
        snippet: candidate.snippet || textFromOrganizationDocument(document, organization),
        source_search: candidate.source_search,
      } satisfies CollectionSuggestionCandidate;
    })
    .filter((candidate): candidate is CollectionSuggestionCandidate => Boolean(candidate))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.name.localeCompare(b.name);
    });
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

    const body = await req.json();
    const query = typeof body?.query === "string" ? body.query.trim() : "";
    if (!query) {
      return jsonError(400, "invalid_input", "query is required");
    }

    const collectionId =
      typeof body?.collection_id === "string" && body.collection_id.trim()
        ? body.collection_id.trim()
        : null;
    const limit = normalizeLimit(body?.max_results);
    const excludedPeople = new Set(normalizeStringArray(body?.exclude_ids));
    const excludedOrganizations = new Set(
      normalizeStringArray(body?.exclude_organization_ids),
    );

    if (collectionId) {
      const { data: members, error: membersError } = await supabase
        .from("collection_members")
        .select("person_id, organization_id")
        .eq("collection_id", collectionId);

      if (membersError) throw membersError;

      ((members || []) as CollectionMemberRow[]).forEach((member) => {
        if (member.person_id) excludedPeople.add(member.person_id);
        if (member.organization_id) excludedOrganizations.add(member.organization_id);
      });
    }

    let plan: CollectionSuggestionPlan;
    try {
      plan = await parseGoalWithGemini(geminiKey, query);
    } catch (err) {
      console.warn("[suggest-people] collection goal parsing failed; using fallback", err);
      plan = fallbackCollectionSuggestionPlan(query);
    }

    const intents = buildSearchIntents(query, plan.searches);
    const embeddings = await getSearchEmbeddings(geminiKey, intents);
    const retrieved = (await retrieveCandidates(supabase, intents, embeddings))
      .filter((candidate) =>
        candidate.entity_type === "person"
          ? !excludedPeople.has(candidate.id)
          : !excludedOrganizations.has(candidate.id)
      );

    let candidates: CollectionSuggestionCandidate[];
    let message: string;

    try {
      const ranked = await rerankWithGemini(geminiKey, query, retrieved);
      candidates = ranked.candidates.slice(0, limit);
      message = ranked.message || `Found ${candidates.length} collection candidates.`;
    } catch (err) {
      console.warn("[suggest-people] collection rerank failed; using deterministic fallback", err);
      candidates = retrieved.slice(0, limit);
      message = `Found ${candidates.length} collection candidates by deterministic scoring.`;
    }

    if (candidates.length < limit) {
      candidates = applyRerankAndBackfill(candidates, [], limit);
    }

    return new Response(
      JSON.stringify({
        message,
        searches: plan.searches,
        candidates,
        gap: plan.gap,
        suggestions: candidates
          .filter((candidate) => candidate.entity_type === "person")
          .map((candidate) => ({
            id: candidate.id,
            name: candidate.name,
            reason: candidate.reason,
            similarity: candidate.score,
          })),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return errorToResponse(err);
  }
}));
