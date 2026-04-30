import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  buildSearchPrompt,
  normalizeSmartSearchResult,
  SMART_SEARCH_SCHEMA,
  SMART_SEARCH_SYSTEM_PROMPT,
  type SmartSearchKeywords,
} from "../_shared/aiContracts.ts";
import {
  createAdminClient,
  requireStaffRole,
} from "../_shared/auth.ts";
import { errorToResponse, jsonError, wrapHandler } from "../_shared/httpError.ts";
import { embedTexts } from "../_shared/embeddings.ts";
import { callGeminiStructured } from "../_shared/gemini.ts";
import {
  buildSearchTerms,
  classifySearchRoute,
  getSearchRouteConfig,
  pickSearchSnippet,
  type LexicalMatchHint,
  type SearchDocumentSnippetSource,
  type SearchRoute,
} from "../_shared/searchRouting.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, apikey, x-client-info",
};

const RRF_K = 60;

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

interface SearchResultItem {
  id: string;
  name: string;
  first_name: string | null;
  last_name: string | null;
  title: string | null;
  current_position: string | null;
  bio: string | null;
  occupation: string | null;
  flemish_connection: string | null;
  profile_photo_url: string | null;
  email: string | null;
  linkedin_url: string | null;
  last_verified_at: string | null;
  available_for_lectures: boolean | null;
  location_id: string | null;
  locations: { city: string | null; state: string | null } | null;
  score: number;
  snippet: string;
}

interface LexicalCandidateRow {
  person_id: string;
  lexical_score: number;
  exact_name_match: boolean;
  name_score: number;
  text_score: number;
  ts_score: number;
  match_field: string | null;
  match_text: string | null;
}

interface VectorCandidateRow {
  id: string;
  similarity: number;
}

interface ChunkCandidateRow {
  id: string;
  person_id: string;
  chunk_type: string;
  chunk_index: number;
  chunk_text: string;
  similarity: number;
}

interface SearchDocumentRow extends SearchDocumentSnippetSource {
  person_id: string;
}

interface PersonRow {
  id: string;
  name: string;
  first_name: string | null;
  last_name: string | null;
  title: string | null;
  current_position: string | null;
  bio: string | null;
  occupation: string | null;
  profile_photo_url: string | null;
  email: string | null;
  linkedin_url: string | null;
  last_verified_at: string | null;
  location_id: string | null;
  locations: { city: string | null; state: string | null } | null;
}

interface PersonQueryRow extends Omit<PersonRow, "locations"> {
  locations:
    | { city: string | null; state: string | null }
    | { city: string | null; state: string | null }[]
    | null;
}

function normalizeLocationRelation(
  value: PersonQueryRow["locations"]
): PersonRow["locations"] {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

async function extractKeywords(
  apiKey: string,
  query: string
): Promise<SmartSearchKeywords> {
  const { data } = await callGeminiStructured({
    apiKey,
    route: "query_parsing",
    systemPrompt: SMART_SEARCH_SYSTEM_PROMPT,
    userPrompt: buildSearchPrompt(query),
    schema: SMART_SEARCH_SCHEMA,
    parse: normalizeSmartSearchResult,
    attemptsPerModel: 2,
  });

  return data.keywords;
}

async function getEmbedding(apiKey: string, text: string): Promise<number[]> {
  const results = await embedTexts(apiKey, [{
    text,
    taskType: "RETRIEVAL_QUERY",
  }]);
  return results[0];
}

function clampScore(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function reciprocalRank(rank: number | undefined): number {
  return rank ? 1 / (RRF_K + rank) : 0;
}

function getFieldBoost(route: SearchRoute, field: string | null): number {
  if (!field) return 0;

  if (route === "direct_lookup") {
    return field === "flemish_connection" || field === "occupation" ? 0.015 : 0;
  }

  if (route === "faceted") {
    return ["flemish_connection", "sector", "location", "occupation"].includes(field)
      ? 0.02
      : 0.008;
  }

  return field === "bio" ? 0.015 : 0.01;
}

function buildFallbackDocument(person: PersonRow): SearchDocumentRow {
  return {
    person_id: person.id,
    current_position: person.current_position,
    occupation: person.occupation,
    bio: person.bio,
    flemish_connection_names: null,
    sector_names: null,
    location_text: person.locations?.city
      ? `${person.locations.city}, ${person.locations.state || ""}`.trim().replace(/,\s*$/, "")
      : null,
  };
}

function routeLabel(route: SearchRoute): string {
  switch (route) {
    case "direct_lookup":
      return "direct lookup";
    case "faceted":
      return "faceted hybrid search";
    default:
      return "exploratory hybrid search";
  }
}

function truncateSnippet(value: string, maxLength = 220): string {
  const normalized = value.trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 3)}...`;
}

Deno.serve(wrapHandler(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const geminiKey = Deno.env.get("GEMINI_API_KEY") || null;
    const supabase = createAdminClient();
    await requireStaffRole(req, supabase, "viewer");

    const body = await req.json();
    const query = typeof body?.query === "string" ? body.query.trim() : "";
    const limit =
      typeof body?.max_results === "number" && body.max_results > 0
        ? Math.min(body.max_results, 100)
        : 30;

    if (!query) {
      return jsonError(400, "invalid_input", "query is required");
    }

    const [keywords, queryEmbedding] = geminiKey
      ? await Promise.all([
          extractKeywords(geminiKey, query).catch((error) => {
            console.warn("[search-people] keyword extraction failed; using empty keywords", error);
            return EMPTY_KEYWORDS;
          }),
          getEmbedding(geminiKey, query).catch((error) => {
            console.warn("[search-people] query embedding failed; running lexical-only", error);
            return null;
          }),
        ])
      : [EMPTY_KEYWORDS, null];

    const route = classifySearchRoute(query, keywords);
    const config = getSearchRouteConfig(route);

    const [lexicalResponse, vectorResponse, chunkResponse] = await Promise.all([
      supabase.rpc("search_people_lexical", {
        search_query: query,
        search_route: route,
        match_count: config.lexicalTopK,
      }),
      (async () => {
        if (!queryEmbedding) {
          return { data: [] as VectorCandidateRow[], error: null };
        }

        const vectorStr = `[${queryEmbedding.join(",")}]`;
        return await supabase.rpc("match_people", {
          query_embedding: vectorStr,
          match_count: config.vectorTopK,
          similarity_threshold: config.vectorSimilarityThreshold,
        });
      })(),
      (async () => {
        if (!queryEmbedding) {
          return { data: [] as ChunkCandidateRow[], error: null };
        }

        const vectorStr = `[${queryEmbedding.join(",")}]`;
        return await supabase.rpc("match_person_text_chunks", {
          query_embedding: vectorStr,
          match_count: config.vectorTopK * 2,
          similarity_threshold: Math.max(0.35, config.vectorSimilarityThreshold - 0.08),
        });
      })(),
    ]);

    if (lexicalResponse.error) {
      throw lexicalResponse.error;
    }

    if (vectorResponse.error) {
      throw vectorResponse.error;
    }

    if (chunkResponse.error) {
      throw chunkResponse.error;
    }

    const lexicalMatches = lexicalResponse.data || [];
    const vectorMatches = vectorResponse.data || [];
    const chunkMatches = chunkResponse.data || [];

    const lexicalByPerson = new Map<string, LexicalCandidateRow>();
    const lexicalRanks = new Map<string, number>();
    lexicalMatches.forEach((candidate, index) => {
      lexicalByPerson.set(candidate.person_id, candidate);
      lexicalRanks.set(candidate.person_id, index + 1);
    });

    const vectorByPerson = new Map<string, VectorCandidateRow>();
    const vectorRanks = new Map<string, number>();
    vectorMatches.forEach((candidate, index) => {
      vectorByPerson.set(candidate.id, candidate);
      vectorRanks.set(candidate.id, index + 1);
    });

    const chunkByPerson = new Map<string, ChunkCandidateRow>();
    const chunkRanks = new Map<string, number>();
    chunkMatches.forEach((candidate, index) => {
      const existing = chunkByPerson.get(candidate.person_id);
      if (!existing || candidate.similarity > existing.similarity) {
        chunkByPerson.set(candidate.person_id, candidate);
      }
      if (!chunkRanks.has(candidate.person_id)) {
        chunkRanks.set(candidate.person_id, index + 1);
      }
    });

    const candidateIds = Array.from(
      new Set([
        ...lexicalByPerson.keys(),
        ...vectorByPerson.keys(),
        ...chunkByPerson.keys(),
      ])
    );

    if (candidateIds.length === 0) {
      return new Response(
        JSON.stringify({
          results: [],
          keywords,
          route,
          degraded: !queryEmbedding,
          diagnostics: {
            lexical_candidates: 0,
            vector_candidates: 0,
            chunk_candidates: 0,
            fused_candidates: 0,
          },
          message: "No matching profiles found.",
          total_with_embeddings: 0,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const [peopleResponse, documentsResponse, embeddingCountResponse] =
      await Promise.all([
        supabase
          .from("people")
          .select(
            "id, name, first_name, last_name, title, current_position, bio, occupation, profile_photo_url, email, linkedin_url, last_verified_at, location_id, locations(city, state)"
          )
          .in("id", candidateIds),
        supabase
          .from("people_search_documents")
          .select(
            "person_id, current_position, occupation, bio, flemish_connection_names, sector_names, location_text"
          )
          .in("person_id", candidateIds),
        supabase
          .from("people")
          .select("id", { count: "exact", head: true })
          .not("embedding", "is", null),
      ]);

    if (peopleResponse.error) {
      throw peopleResponse.error;
    }

    if (documentsResponse.error) {
      throw documentsResponse.error;
    }

    if (embeddingCountResponse.error) {
      throw embeddingCountResponse.error;
    }

    const people = ((peopleResponse.data || []) as unknown as PersonQueryRow[]).map((person) => ({
      ...person,
      locations: normalizeLocationRelation(person.locations),
    }));
    const documents = (documentsResponse.data || []) as SearchDocumentRow[];

    const peopleById = new Map<string, PersonRow>();
    for (const person of people) {
      peopleById.set(person.id, person);
    }

    const documentsByPerson = new Map<string, SearchDocumentRow>();
    for (const document of documents) {
      documentsByPerson.set(document.person_id, document);
    }

    const searchTerms = buildSearchTerms(query, keywords);
    const scored = candidateIds
      .map((personId) => {
        const person = peopleById.get(personId);
        if (!person) return null;

        const lexical = lexicalByPerson.get(personId);
        const vector = vectorByPerson.get(personId);
        const bestChunk = chunkByPerson.get(personId);
        const lexicalRank = lexicalRanks.get(personId);
        const vectorRank = vectorRanks.get(personId);
        const chunkRank = chunkRanks.get(personId);
        const lexicalSignal = clampScore(lexical?.lexical_score);
        const vectorSignal = clampScore(vector?.similarity);
        const chunkSignal = clampScore(bestChunk?.similarity);
        const exactBoost = lexical?.exact_name_match ? config.exactBoost : 0;
        const nameBoost = lexical
          ? config.nameBoost * clampScore((lexical.name_score || 0) / 1.2)
          : 0;
        const fieldBoost = getFieldBoost(route, lexical?.match_field || null);

        const fusedScore =
          config.lexicalWeight * reciprocalRank(lexicalRank) +
          config.vectorWeight * reciprocalRank(vectorRank) +
          0.5 * config.vectorWeight * reciprocalRank(chunkRank) +
          config.lexicalSignalWeight * lexicalSignal +
          config.vectorSignalWeight * vectorSignal +
          0.08 * chunkSignal +
          exactBoost +
          nameBoost +
          fieldBoost;

        if (fusedScore < config.minimumScore) {
          return null;
        }

        const document =
          documentsByPerson.get(personId) || buildFallbackDocument(person);
        const hint: LexicalMatchHint | undefined = lexical
          ? {
              match_field: lexical.match_field,
              match_text: lexical.match_text,
            }
          : undefined;
        const lexicalSnippet = pickSearchSnippet(document, searchTerms, query, hint);
        const snippet = bestChunk?.chunk_text &&
            (!lexical || bestChunk.similarity >= vectorSignal || !lexicalSnippet)
          ? truncateSnippet(bestChunk.chunk_text)
          : lexicalSnippet;

        return {
          person,
          document,
          fusedScore,
          snippet,
        };
      })
      .filter((value): value is NonNullable<typeof value> => Boolean(value))
      .sort((a, b) => b.fusedScore - a.fusedScore)
      .slice(0, limit);

    const results: SearchResultItem[] = scored.map(({ person, document, fusedScore, snippet }) => ({
      id: person.id,
      name: person.name,
      first_name: person.first_name,
      last_name: person.last_name,
      title: person.title,
      current_position: person.current_position,
      bio: person.bio,
      occupation: person.occupation,
      flemish_connection: document.flemish_connection_names || null,
      profile_photo_url: person.profile_photo_url,
      email: person.email,
      linkedin_url: person.linkedin_url,
      last_verified_at: person.last_verified_at,
      available_for_lectures: null,
      location_id: person.location_id,
      locations: person.locations,
      score: Math.round(fusedScore * 1000) / 1000,
      snippet,
    }));

    return new Response(
      JSON.stringify({
        results,
        keywords,
        route,
        degraded: !queryEmbedding,
        diagnostics: {
          lexical_candidates: lexicalMatches.length,
          vector_candidates: vectorMatches.length,
          chunk_candidates: chunkMatches.length,
          fused_candidates: candidateIds.length,
        },
        message: `Found ${results.length} relevant people using ${routeLabel(route)}.`,
        total_with_embeddings: embeddingCountResponse.count || 0,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    return errorToResponse(err);
  }
}));
