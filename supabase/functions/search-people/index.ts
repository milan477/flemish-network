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
import {
  buildManualFilterKeywords,
  calculateStructuredCriteriaCoverage,
  criteriaCoveragePasses,
  addCriterionCoverage,
  mergeSearchKeywords,
  normalizePersonScope,
  normalizeSearchMatchMode,
  type ManualSearchFilters,
} from "../_shared/searchCriteria.ts";

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

interface PersonSearchResultItem {
  entity_type: "person";
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
  us_network_status?: string | null;
  current_location_city?: string | null;
  current_location_country?: string | null;
  person_us_connections?: unknown[];
  score: number;
  snippet: string;
  rationale: string;
}

interface OrganizationSearchResultItem {
  entity_type: "organization";
  id: string;
  name: string;
  type: string | null;
  description: string | null;
  logo_url: string | null;
  website_url: string | null;
  location_id: string | null;
  locations: { city: string | null; state: string | null } | null;
  us_network_status: string | null;
  flemish_link: string | null;
  organization_us_locations?: unknown[];
  score: number;
  snippet: string;
  rationale: string;
}

type MixedSearchResultItem = PersonSearchResultItem | OrganizationSearchResultItem;

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

interface OrganizationLexicalCandidateRow {
  organization_id: string;
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

interface OrganizationSearchDocumentRow {
  organization_id: string;
  type: string | null;
  description: string | null;
  flemish_link: string | null;
  sector_names: string | null;
  primary_location_text: string | null;
  location_text: string | null;
  us_network_status: string | null;
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
  us_network_status: string | null;
  current_location_city: string | null;
  current_location_country: string | null;
  person_us_connections?: unknown[];
}

interface OrganizationRow {
  id: string;
  name: string;
  type: string | null;
  description: string | null;
  logo_url: string | null;
  website_url: string | null;
  location_id: string | null;
  locations: { city: string | null; state: string | null } | null;
  us_network_status: string | null;
  flemish_link: string | null;
  organization_us_locations?: unknown[];
}

interface PersonQueryRow extends Omit<PersonRow, "locations"> {
  locations:
    | { city: string | null; state: string | null }
    | { city: string | null; state: string | null }[]
    | null;
}

interface OrganizationQueryRow extends Omit<OrganizationRow, "locations"> {
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

function normalizeOrganizationLocationRelation(
  value: OrganizationQueryRow["locations"]
): OrganizationRow["locations"] {
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

function buildFallbackOrganizationDocument(
  organization: OrganizationRow
): OrganizationSearchDocumentRow {
  const locationText = organization.locations?.city
    ? `${organization.locations.city}, ${organization.locations.state || ""}`.trim().replace(/,\s*$/, "")
    : null;

  return {
    organization_id: organization.id,
    type: organization.type,
    description: organization.description,
    flemish_link: organization.flemish_link,
    sector_names: null,
    primary_location_text: locationText,
    location_text: locationText,
    us_network_status: organization.us_network_status,
  };
}

function organizationSnippetSource(
  document: OrganizationSearchDocumentRow
): SearchDocumentSnippetSource {
  return {
    current_position: document.type,
    occupation: document.type,
    bio: document.description,
    flemish_connection_names: document.flemish_link,
    sector_names: document.sector_names,
    location_text: document.location_text || document.primary_location_text,
  };
}

function rationaleFromMatch(
  entityType: "person" | "organization",
  matchField: string | null | undefined,
  score: number
): string {
  const label = entityType === "person" ? "person" : "organization";
  const scoreText = Math.round(score * 1000) / 1000;

  switch (matchField) {
    case "name":
      return `Matched ${label} name; score ${scoreText}.`;
    case "current_position":
      return `Matched role or position; score ${scoreText}.`;
    case "occupation":
    case "type":
      return `Matched type or occupation; score ${scoreText}.`;
    case "flemish_connection":
      return `Matched Flemish or Belgian relevance; score ${scoreText}.`;
    case "sector":
      return `Matched sector criteria; score ${scoreText}.`;
    case "location":
      return `Matched location criteria; score ${scoreText}.`;
    case "us_network_status":
      return `Matched US network status; score ${scoreText}.`;
    case "bio":
    case "description":
      return `Matched descriptive text; score ${scoreText}.`;
    default:
      return `Matched ranked ${label} search signals; score ${scoreText}.`;
  }
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
    const matchMode = normalizeSearchMatchMode(body?.match_mode);
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

    const filters: Record<string, unknown> | null =
      body?.filters && typeof body.filters === "object"
      ? body.filters as Record<string, unknown>
      : null;
    const showPeople = filters?.show_people !== false;
    const showOrganizations = filters?.show_organizations !== false;
    const criteriaKeywords = mergeSearchKeywords(
      keywords,
      buildManualFilterKeywords(filters as ManualSearchFilters | null)
    );
    const personScope = normalizePersonScope(filters?.person_scope);
    const route = classifySearchRoute(query, criteriaKeywords);
    const config = getSearchRouteConfig(route);

    const [lexicalResponse, vectorResponse, chunkResponse, organizationLexicalResponse] = await Promise.all([
      showPeople
        ? supabase.rpc("search_people_lexical", {
            search_query: query,
            search_route: route,
            match_count: config.lexicalTopK,
          })
        : { data: [] as LexicalCandidateRow[], error: null },
      (async () => {
        if (!showPeople || !queryEmbedding) {
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
        if (!showPeople || !queryEmbedding) {
          return { data: [] as ChunkCandidateRow[], error: null };
        }

        const vectorStr = `[${queryEmbedding.join(",")}]`;
        return await supabase.rpc("match_person_text_chunks", {
          query_embedding: vectorStr,
          match_count: config.vectorTopK * 2,
          similarity_threshold: Math.max(0.35, config.vectorSimilarityThreshold - 0.08),
        });
      })(),
      showOrganizations
        ? supabase.rpc("search_organizations_lexical", {
            search_query: query,
            search_route: route,
            match_count: config.lexicalTopK,
          })
        : { data: [] as OrganizationLexicalCandidateRow[], error: null },
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

    if (organizationLexicalResponse.error) {
      throw organizationLexicalResponse.error;
    }

    const lexicalMatches = (lexicalResponse.data || []) as LexicalCandidateRow[];
    const vectorMatches = vectorResponse.data || [];
    const chunkMatches = chunkResponse.data || [];
    const organizationLexicalMatches =
      (organizationLexicalResponse.data || []) as OrganizationLexicalCandidateRow[];

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

    const organizationLexicalById = new Map<string, OrganizationLexicalCandidateRow>();
    const organizationLexicalRanks = new Map<string, number>();
    organizationLexicalMatches.forEach((candidate, index) => {
      organizationLexicalById.set(candidate.organization_id, candidate);
      organizationLexicalRanks.set(candidate.organization_id, index + 1);
    });
    const organizationCandidateIds = Array.from(organizationLexicalById.keys());

    if (candidateIds.length === 0 && organizationCandidateIds.length === 0) {
      return new Response(
        JSON.stringify({
          results: [],
          people: [],
          organizations: [],
          keywords: criteriaKeywords,
          match_mode: matchMode,
          route,
          degraded: !queryEmbedding,
          diagnostics: {
            lexical_candidates: 0,
            vector_candidates: 0,
            chunk_candidates: 0,
            organization_lexical_candidates: 0,
            fused_candidates: 0,
            structured_criteria: 0,
          },
          message: "No matching network records found.",
          total_with_embeddings: 0,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const [peopleResponse, documentsResponse, embeddingCountResponse] =
      await Promise.all([
        candidateIds.length > 0
          ? supabase
              .from("people")
              .select(
                "id, name, first_name, last_name, title, current_position, bio, occupation, profile_photo_url, email, linkedin_url, last_verified_at, location_id, us_network_status, current_location_city, current_location_country, locations(city, state), person_us_connections(*, locations(city, state))"
              )
              .in("id", candidateIds)
          : { data: [] as PersonQueryRow[], error: null },
        candidateIds.length > 0
          ? supabase
              .from("people_search_documents")
              .select(
                "person_id, current_position, occupation, bio, flemish_connection_names, sector_names, location_text"
              )
              .in("person_id", candidateIds)
          : { data: [] as SearchDocumentRow[], error: null },
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

    const searchTerms = buildSearchTerms(query, criteriaKeywords);
    const scoredPeople = candidateIds
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
        const coverage = personScope
          ? addCriterionCoverage(
              calculateStructuredCriteriaCoverage(criteriaKeywords, document),
              person.us_network_status === personScope
            )
          : calculateStructuredCriteriaCoverage(criteriaKeywords, document);
        if (!criteriaCoveragePasses(coverage, matchMode)) {
          return null;
        }

        const coverageBoost = coverage.total > 0 ? 0.04 * coverage.score : 0;
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
          fusedScore: fusedScore + coverageBoost,
          snippet,
        };
      })
      .filter((value): value is NonNullable<typeof value> => Boolean(value))
      .sort((a, b) => b.fusedScore - a.fusedScore)
      .slice(0, limit);

    const peopleResults: PersonSearchResultItem[] = scoredPeople.map(({ person, document, fusedScore, snippet }) => ({
      entity_type: "person",
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
      us_network_status: person.us_network_status,
      current_location_city: person.current_location_city,
      current_location_country: person.current_location_country,
      person_us_connections: person.person_us_connections || [],
      score: Math.round(fusedScore * 1000) / 1000,
      snippet,
      rationale: rationaleFromMatch("person", lexicalByPerson.get(person.id)?.match_field, fusedScore),
    }));

    const [organizationsResponse, organizationDocumentsResponse] =
      await Promise.all([
        organizationCandidateIds.length > 0
          ? supabase
              .from("organizations")
              .select(
                "id, name, type, description, logo_url, website_url, location_id, us_network_status, flemish_link, locations(city, state), organization_us_locations(*, locations(city, state))"
              )
              .in("id", organizationCandidateIds)
          : { data: [] as OrganizationQueryRow[], error: null },
        organizationCandidateIds.length > 0
          ? supabase
              .from("organization_search_documents")
              .select(
                "organization_id, type, description, flemish_link, sector_names, primary_location_text, location_text, us_network_status"
              )
              .in("organization_id", organizationCandidateIds)
          : { data: [] as OrganizationSearchDocumentRow[], error: null },
      ]);

    if (organizationsResponse.error) {
      throw organizationsResponse.error;
    }

    if (organizationDocumentsResponse.error) {
      throw organizationDocumentsResponse.error;
    }

    const organizations = ((organizationsResponse.data || []) as unknown as OrganizationQueryRow[]).map((organization) => ({
      ...organization,
      locations: normalizeOrganizationLocationRelation(organization.locations),
    }));
    const organizationDocuments =
      (organizationDocumentsResponse.data || []) as OrganizationSearchDocumentRow[];
    const organizationsById = new Map<string, OrganizationRow>();
    for (const organization of organizations) {
      organizationsById.set(organization.id, organization);
    }

    const organizationDocumentsById = new Map<string, OrganizationSearchDocumentRow>();
    for (const document of organizationDocuments) {
      organizationDocumentsById.set(document.organization_id, document);
    }

    const scoredOrganizations = organizationCandidateIds
      .map((organizationId) => {
        const organization = organizationsById.get(organizationId);
        const lexical = organizationLexicalById.get(organizationId);
        if (!organization || !lexical) return null;

        const lexicalRank = organizationLexicalRanks.get(organizationId);
        const lexicalSignal = clampScore(lexical.lexical_score);
        const exactBoost = lexical.exact_name_match ? config.exactBoost : 0;
        const nameBoost = config.nameBoost * clampScore((lexical.name_score || 0) / 1.2);
        const fieldBoost = getFieldBoost(route, lexical.match_field || null);
        const fusedScore =
          config.lexicalWeight * reciprocalRank(lexicalRank) +
          config.lexicalSignalWeight * lexicalSignal +
          0.6 * exactBoost +
          0.8 * nameBoost +
          fieldBoost;

        if (fusedScore < config.minimumScore) {
          return null;
        }

        const document =
          organizationDocumentsById.get(organizationId) ||
          buildFallbackOrganizationDocument(organization);
        const snippetSource = organizationSnippetSource(document);
        const coverage = calculateStructuredCriteriaCoverage(criteriaKeywords, snippetSource);
        if (!criteriaCoveragePasses(coverage, matchMode)) {
          return null;
        }

        const coverageBoost = coverage.total > 0 ? 0.04 * coverage.score : 0;
        const snippet = pickSearchSnippet(snippetSource, searchTerms, query, {
          match_field: lexical.match_field,
          match_text: lexical.match_text,
        });

        return {
          organization,
          fusedScore: fusedScore + coverageBoost,
          snippet,
          matchField: lexical.match_field,
        };
      })
      .filter((value): value is NonNullable<typeof value> => Boolean(value))
      .sort((a, b) => b.fusedScore - a.fusedScore)
      .slice(0, limit);

    const organizationResults: OrganizationSearchResultItem[] = scoredOrganizations.map(({
      organization,
      fusedScore,
      snippet,
      matchField,
    }) => ({
      entity_type: "organization",
      id: organization.id,
      name: organization.name,
      type: organization.type,
      description: organization.description,
      logo_url: organization.logo_url,
      website_url: organization.website_url,
      location_id: organization.location_id,
      locations: organization.locations,
      us_network_status: organization.us_network_status,
      flemish_link: organization.flemish_link,
      organization_us_locations: organization.organization_us_locations || [],
      score: Math.round(fusedScore * 1000) / 1000,
      snippet,
      rationale: rationaleFromMatch("organization", matchField, fusedScore),
    }));

    const results: MixedSearchResultItem[] = [
      ...peopleResults,
      ...organizationResults,
    ]
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    const visiblePeople = results.filter(
      (result): result is PersonSearchResultItem => result.entity_type === "person"
    );
    const visibleOrganizations = results.filter(
      (result): result is OrganizationSearchResultItem =>
        result.entity_type === "organization"
    );

    return new Response(
      JSON.stringify({
        results,
        people: visiblePeople,
        organizations: visibleOrganizations,
        keywords: criteriaKeywords,
        match_mode: matchMode,
        route,
        degraded: !queryEmbedding,
        diagnostics: {
          lexical_candidates: lexicalMatches.length,
          vector_candidates: vectorMatches.length,
          chunk_candidates: chunkMatches.length,
          organization_lexical_candidates: organizationLexicalMatches.length,
          fused_candidates: candidateIds.length + organizationCandidateIds.length,
          structured_criteria: calculateStructuredCriteriaCoverage(
            criteriaKeywords,
            {
              current_position: null,
              occupation: null,
              flemish_connection_names: null,
              sector_names: null,
              location_text: null,
            }
          ).total,
        },
        message: `Found ${visiblePeople.length} people and ${visibleOrganizations.length} organizations using ${routeLabel(route)}.`,
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
