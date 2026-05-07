import { supabase } from './supabase';
import {
  US_STATES,
  type MapFilters,
  type Organization,
  type Person,
  type SearchMatchMode,
} from './supabase';
import { getPersonFlemishConnectionText } from './flemishConnections';
import { extractEdgeError, EdgeFunctionError } from './edgeError';

const SEARCH_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'at',
  'for',
  'from',
  'in',
  'near',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
]);

const SECTOR_SYNONYMS: Record<string, string[]> = {
  ai: ['ai', 'artificial intelligence'],
  artificial: ['artificial intelligence'],
  biotech: ['biotech', 'biotechnology'],
  biotechnology: ['biotech', 'biotechnology'],
  finance: ['finance', 'financial'],
  education: ['education', 'educator'],
  research: ['research', 'researcher'],
  culture: ['culture', 'arts'],
  arts: ['arts', 'culture'],
};

const STATE_NAMES = new Set(US_STATES.map((state) => state.name.toLowerCase()));
const STATE_CODES = new Set(US_STATES.map((state) => state.code.toLowerCase()));

function uniqueTerms(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function buildFallbackTerms(query: string): string[] {
  const normalized = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .trim();

  if (!normalized) return [];

  const tokens = normalized
    .split(/\s+/)
    .filter((token) => token.length > 1 && !SEARCH_STOP_WORDS.has(token));
  const bigrams: string[] = [];

  for (let index = 0; index < tokens.length - 1; index += 1) {
    bigrams.push(`${tokens[index]} ${tokens[index + 1]}`);
  }

  return uniqueTerms([...tokens, ...bigrams]);
}

function buildFallbackKeywords(query: string): SmartSearchKeywords {
  const terms = buildFallbackTerms(query);
  const stateTerms = terms.filter(
    (term) => STATE_NAMES.has(term) || STATE_CODES.has(term)
  );
  const nonStateTerms = terms.filter((term) => !stateTerms.includes(term));
  const sectorTerms = uniqueTerms([
    ...nonStateTerms,
    ...nonStateTerms.flatMap((term) => SECTOR_SYNONYMS[term] || []),
  ]);
  const likelyNameTerms = nonStateTerms.length <= 3 ? nonStateTerms : [];

  return {
    name: likelyNameTerms,
    occupation: nonStateTerms,
    sector: sectorTerms,
    location_city: nonStateTerms.filter((term) => term.length >= 3),
    location_state: stateTerms,
    current_position: nonStateTerms,
    flemish_connection: nonStateTerms,
    bio: nonStateTerms,
  };
}

interface AIResponse<T> {
  success: boolean;
  data?: T;
  // Phase 6.3: error is now a structured { code, message, hint? } envelope.
  error?: { code: string; message: string; hint?: string } | string;
}

async function callAI<T>(
  task: string,
  context: Record<string, unknown>
): Promise<T> {
  const { data, error } = await supabase.functions.invoke('ai-agent', {
    body: { task, context },
  });

  if (error) {
    throw await extractEdgeError(error, 'AI request failed');
  }

  const result = data as AIResponse<T>;

  if (!result || !result.success || !result.data) {
    if (result?.error && typeof result.error === 'object') {
      throw new EdgeFunctionError(result.error.message, result.error.code, result.error.hint);
    }
    throw new Error(
      typeof result?.error === 'string' ? result.error : 'AI request failed'
    );
  }

  return result.data;
}

export interface DiscoveredWebContact {
  name: string;
  bio: string;
  occupation: string;
  current_position: string;
  location_city: string;
  location_state: string;
  flemish_connection: string;
  website_url: string;
  email: string;
  email_source: string;
  linkedin_url: string;
  sectors: string[];
  sources: string[];
  is_duplicate: boolean;
  duplicate_reason: string;
  existing_person_id: string;
}

export type SearchedContact = DiscoveredWebContact;

export interface SmartSearchKeywords {
  name: string[];
  occupation: string[];
  sector: string[];
  location_city: string[];
  location_state: string[];
  current_position: string[];
  flemish_connection: string[];
  bio: string[];
}

export interface SmartSearchResult {
  message: string;
  keywords: SmartSearchKeywords;
}

export async function smartSearch(
  query: string
): Promise<SmartSearchResult> {
  let result: SmartSearchResult;

  try {
    result = await callAI<SmartSearchResult>('smart_search', { query });
  } catch {
    return {
      message: 'Using deterministic fallback query parsing.',
      keywords: buildFallbackKeywords(query),
    };
  }

  if (!result.message || !result.keywords) {
    throw new Error('Invalid smart_search response');
  }

  const kw = result.keywords;
  for (const key of Object.keys(kw) as (keyof SmartSearchKeywords)[]) {
    if (!Array.isArray(kw[key])) {
      kw[key] = [];
    }
    kw[key] = kw[key].map((v) => (typeof v === 'string' ? v.toLowerCase() : '')).filter(Boolean);
  }

  return result;
}

export const AI_SCORE_THRESHOLD = 0.08;

function getIndexedString(
  person: Record<string, unknown>,
  field: string
): string {
  const value = person[field];
  return typeof value === 'string' || typeof value === 'number'
    ? String(value).toLowerCase()
    : '';
}

function getNestedString(
  person: Record<string, unknown>,
  parent: string,
  child: string
): string {
  const parentValue = person[parent];
  if (!parentValue || typeof parentValue !== 'object') return '';
  const childValue = (parentValue as Record<string, unknown>)[child];
  return typeof childValue === 'string' || typeof childValue === 'number'
    ? String(childValue).toLowerCase()
    : '';
}

export function scorePersonAgainstKeywords(
  person: Record<string, unknown>,
  keywords: SmartSearchKeywords
): number {
  let score = 0;
  let totalWeight = 0;

  const fields: { key: keyof SmartSearchKeywords; personField: string; weight: number }[] = [
    { key: 'name', personField: 'name', weight: 3 },
    { key: 'occupation', personField: 'occupation', weight: 2 },
    { key: 'sector', personField: 'sectors_text', weight: 2 },
    { key: 'location_city', personField: 'locations.city', weight: 1.5 },
    { key: 'location_state', personField: 'locations.state', weight: 1 },
    { key: 'current_position', personField: 'current_position', weight: 2 },
    { key: 'flemish_connection', personField: 'flemish_connection', weight: 2 },
    { key: 'bio', personField: 'bio', weight: 1 },
  ];

  for (const { key, personField, weight } of fields) {
    const kws = keywords[key];
    if (!kws || kws.length === 0) continue;

    totalWeight += weight;
    
    let val = '';
    if (personField.includes('.')) {
      const [parent, child] = personField.split('.');
      val = getNestedString(person, parent, child);
    } else {
      val = personField === 'flemish_connection'
        ? getPersonFlemishConnectionText(person as unknown as Person).toLowerCase()
        : getIndexedString(person, personField);
    }
    
    if (!val) continue;

    let fieldHits = 0;
    for (const kw of kws) {
      if (val.includes(kw)) fieldHits++;
    }

    score += (fieldHits / kws.length) * weight;
  }

  return totalWeight > 0 ? score / totalWeight : 0;
}

export function scorePersonAgainstFilter(
  person: Record<string, unknown>,
  keywords: Record<string, string[]>,
  fields: readonly string[]
): boolean {
  for (const field of fields) {
    const kws = keywords[field];
    if (!kws || kws.length === 0) continue;
    const val = field === 'flemish_connection'
      ? getPersonFlemishConnectionText(person as unknown as Person).toLowerCase()
      : getIndexedString(person, field);
    if (!val) continue;
    for (const kw of kws) {
      if (val.includes(kw)) return true;
    }
  }
  return false;
}

export interface SuggestPeopleResult {
  id: string;
  name: string;
  reason: string;
  similarity: number;
}

export interface CollectionSuggestionCandidate {
  entity_type: 'person' | 'organization';
  id: string;
  name: string;
  reason: string;
  score: number;
  snippet?: string;
  source_search: string;
}

export interface CollectionSuggestionGap {
  should_offer: boolean;
  reason?: string;
  suggested_prompt?: string;
}

export interface SuggestPeopleResponse {
  message: string;
  suggestions: SuggestPeopleResult[];
  candidates: CollectionSuggestionCandidate[];
  searches: unknown[];
  gap: CollectionSuggestionGap;
}

/**
 * Suggest people via server-side embedding search + Gemini Pro ranking.
 * Falls back to client-side keyword scoring if the edge function is unavailable.
 */
export async function suggestPeopleEmbedding(
  query: string,
  options?: {
    collection_id?: string;
    exclude_ids?: string[];
    exclude_organization_ids?: string[];
    max_results?: number;
  }
): Promise<SuggestPeopleResponse> {
  try {
    const { data, error } = await supabase.functions.invoke('suggest-people', {
      body: {
        query,
        collection_id: options?.collection_id,
        exclude_ids: options?.exclude_ids,
        exclude_organization_ids: options?.exclude_organization_ids,
        max_results: options?.max_results || 15,
      },
    });

    if (error) throw await extractEdgeError(error, 'People suggestion request failed');
    if (!data?.suggestions && !data?.candidates) throw new Error('No suggestions returned');

    const candidates: CollectionSuggestionCandidate[] = Array.isArray(data.candidates)
      ? (data.candidates as CollectionSuggestionCandidate[])
      : (data.suggestions || []).map((suggestion: SuggestPeopleResult) => ({
          entity_type: 'person' as const,
          id: suggestion.id,
          name: suggestion.name,
          reason: suggestion.reason,
          score: suggestion.similarity,
          source_search: query,
        }));

    return {
      message:
        typeof data.message === 'string'
          ? data.message
          : `Found ${candidates.length} collection candidates.`,
      suggestions: Array.isArray(data.suggestions)
        ? (data.suggestions as SuggestPeopleResult[])
        : candidates
            .filter((candidate) => candidate.entity_type === 'person')
            .map((candidate) => ({
              id: candidate.id,
              name: candidate.name,
              reason: candidate.reason,
              similarity: candidate.score,
            })),
      candidates,
      searches: Array.isArray(data.searches) ? data.searches : [],
      gap:
        data.gap && typeof data.gap === 'object'
          ? (data.gap as CollectionSuggestionGap)
          : { should_offer: false },
    };
  } catch (error) {
    // Fallback to client-side scoring
    const fallback = await suggestPeople(query);
    const excludeSet = new Set(options?.exclude_ids || []);

    if (options?.collection_id) {
      const { data: members } = await supabase
        .from('collection_members')
        .select('person_id')
        .eq('collection_id', options.collection_id);

      (members || []).forEach((member) => {
        if (typeof member.person_id === 'string') {
          excludeSet.add(member.person_id);
        }
      });
    }

    const filteredFallback = fallback
      .filter((item) => !excludeSet.has(item.person.id))
      .slice(0, options?.max_results || 15);

    if (filteredFallback.length > 0) {
      return {
        message: `Found ${filteredFallback.length} people by fallback scoring.`,
        suggestions: filteredFallback.map((item) => ({
          id: item.person.id,
          name: item.person.name,
          reason: item.reason,
          similarity: item.score,
        })),
        candidates: filteredFallback.map((item) => ({
          entity_type: 'person',
          id: item.person.id,
          name: item.person.name,
          reason: item.reason,
          score: item.score,
          source_search: query,
        })),
        searches: [{ query, targets: ['person'] }],
        gap: { should_offer: false },
      };
    }

    if (error instanceof EdgeFunctionError) throw error;
    const message =
      error instanceof Error
        ? error.message
        : 'Unable to load suggested people right now.';
    throw new Error(message);
  }
}

export async function suggestPeople(query: string): Promise<{ person: Person; reason: string; score: number }[]> {
  try {
    const res = await smartSearch(query);
    const { data: people, error } = await supabase
      .from('people')
      .select('*, locations(*), person_flemish_connections(flemish_connection_id, flemish_connections(id, name, type))')
      .limit(200);
    if (error || !people) throw error || new Error('No people found');

    return (people || [])
      .map((p) => ({
        person: p as Person,
        score: scorePersonAgainstKeywords(p as Record<string, unknown>, res.keywords),
        reason: res.message,
      }))
      .filter((item) => item.score > 0.05)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
  } catch {
    return [];
  }
}

// ---------- Hybrid Search (server-side) ----------

export interface HybridPersonSearchResultItem {
  entity_type: 'person';
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
  locations: { city: string; state: string } | null;
  score: number;
  snippet: string;
  rationale?: string;
}

export interface HybridOrganizationSearchResultItem {
  entity_type: 'organization';
  id: string;
  name: string;
  type: string | null;
  description: string | null;
  logo_url: string | null;
  website_url: string | null;
  location_id: string | null;
  locations: { city: string; state: string } | null;
  us_network_status: string | null;
  flemish_link: string | null;
  organization_us_locations?: Organization['organization_us_locations'];
  score: number;
  snippet: string;
  rationale?: string;
}

export type HybridSearchResultItem =
  | HybridPersonSearchResultItem
  | HybridOrganizationSearchResultItem;

export interface HybridSearchResponse {
  results: HybridSearchResultItem[];
  people?: HybridPersonSearchResultItem[];
  organizations?: HybridOrganizationSearchResultItem[];
  keywords: SmartSearchKeywords;
  message: string;
  total_with_embeddings: number;
  route?: 'direct_lookup' | 'faceted' | 'exploratory';
  degraded?: boolean;
  diagnostics?: {
    lexical_candidates: number;
    vector_candidates: number;
    fused_candidates: number;
    organization_lexical_candidates?: number;
  };
}

/**
 * Server-side routed hybrid search using lexical retrieval + vector fusion.
 * Falls back to a degraded client-side path only if the edge function fails.
 */
export async function hybridSearch(
  query: string,
  maxResults = 30,
  matchMode: SearchMatchMode = 'all',
  filters?: MapFilters
): Promise<HybridSearchResponse> {
  try {
    const { data, error } = await supabase.functions.invoke('search-people', {
      body: {
        query,
        max_results: maxResults,
        match_mode: matchMode,
        filters: filters
          ? {
              show_people: filters.showPeople,
              show_organizations: filters.showOrganizations,
              sector: filters.sector,
              person_scope: filters.personScope,
              occupation: filters.occupation,
              city: filters.city,
              state: filters.state,
              flemish_connections: filters.flemishConnections,
            }
          : undefined,
      },
    });

    if (error) throw await extractEdgeError(error, 'Search request failed');
    if (!data?.results || !data?.keywords) throw new Error('Invalid response');

    return data as HybridSearchResponse;
  } catch {
    // Fallback: client-side scoring using deterministic query parsing if edge functions are unavailable.
    const res = await smartSearch(query);
    const { data: people } = await supabase
      .from('people')
      .select('*, locations(*), person_flemish_connections(flemish_connection_id, flemish_connections(id, name, type))')
      .limit(200);

    if (!people) {
      return {
        results: [],
        keywords: res.keywords,
        message: 'Search is running in degraded fallback mode and returned no matches.',
        total_with_embeddings: 0,
        degraded: true,
      };
    }

    const scored = (people as Person[])
      .map((p) => ({
        person: p,
        score: scorePersonAgainstKeywords(
          p as unknown as Record<string, unknown>,
          res.keywords
        ),
      }))
      .filter((s) => s.score >= AI_SCORE_THRESHOLD)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults);

    const results: HybridPersonSearchResultItem[] = scored.map((s) => ({
      entity_type: 'person',
      id: s.person.id,
      name: s.person.name,
      first_name: s.person.first_name ?? null,
      last_name: s.person.last_name ?? null,
      title: s.person.title ?? null,
      current_position: s.person.current_position ?? null,
      bio: s.person.bio ?? null,
      occupation: s.person.occupation ?? null,
      flemish_connection: getPersonFlemishConnectionText(s.person) || null,
      profile_photo_url: s.person.profile_photo_url ?? null,
      email: s.person.email ?? null,
      linkedin_url: s.person.linkedin_url ?? null,
      last_verified_at: s.person.last_verified_at ?? null,
      available_for_lectures: s.person.available_for_lectures ?? null,
      location_id: s.person.location_id ?? null,
      locations: s.person.locations
        ? { city: s.person.locations.city, state: s.person.locations.state }
        : null,
      score: s.score,
      snippet: '',
      rationale: 'Matched by degraded local keyword scoring.',
    }));

    return {
      results,
      people: results,
      organizations: [],
      keywords: res.keywords,
      message: 'Search is running in degraded fallback mode; results are limited to the first 200 profiles.',
      total_with_embeddings: 0,
      degraded: true,
    };
  }
}

export const networkSearch = hybridSearch;

/** Log a search result click for relevance feedback (fire-and-forget) */
export function logSearchClick(query: string, personId: string): void {
  supabase.from('search_clicks').insert({ query, person_id: personId }).then();
}
