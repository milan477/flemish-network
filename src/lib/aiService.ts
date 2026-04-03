import { supabase } from './supabase';
import { US_STATES, type Person } from './supabase';
import { getPersonFlemishConnectionText } from './flemishConnections';

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

export interface ParsedContact {
  name: string;
  current_position: string;
  occupation: string;
  location_city: string;
  location_state: string;
  bio: string;
  flemish_connection: string;
  sectors: string[];
}

export interface ParseContactsResult {
  message: string;
  contacts: ParsedContact[];
}

interface AIResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

async function callAI<T>(
  task: string,
  context: Record<string, unknown>
): Promise<T> {
  const { data, error } = await supabase.functions.invoke('ai-agent', {
    body: { task, context },
  });

  if (error) {
    throw new Error(`AI request failed: ${error.message}`);
  }

  const result = data as AIResponse<T>;

  if (!result || !result.success || !result.data) {
    throw new Error(result?.error || 'AI request failed');
  }

  return result.data;
}

export async function parseContacts(
  description: string,
  sectors: string[]
): Promise<ParseContactsResult> {
  const result = await callAI<ParseContactsResult>('parse_contacts', {
    description,
    sectors,
  });

  if (!result.message || !Array.isArray(result.contacts)) {
    throw new Error('Invalid parse_contacts response');
  }
  for (const c of result.contacts) {
    if (typeof c.name !== 'string' || !c.name) {
      throw new Error('Contact missing required name field');
    }
  }

  return result;
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

export interface DiscoverContactsResult {
  message: string;
  contacts: DiscoveredWebContact[];
}

export async function discoverContacts(
  query: string
): Promise<DiscoverContactsResult> {
  const { data, error } = await supabase.functions.invoke('discover-contacts', {
    body: { query },
  });

  if (error) {
    throw new Error(`Discovery request failed: ${error.message}`);
  }

  const result = data as DiscoverContactsResult;

  if (!result || (!result.message && !result.contacts)) {
    throw new Error('Invalid discovery response');
  }

  return {
    message: result.message || 'Discovery complete.',
    contacts: Array.isArray(result.contacts) ? result.contacts : [],
  };
}

export const searchContacts = discoverContacts;

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

export function scorePersonAgainstKeywords(
  person: Record<string, any>,
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
      val = String(person[parent]?.[child] || '').toLowerCase();
    } else {
      val = personField === 'flemish_connection'
        ? getPersonFlemishConnectionText(person as Person).toLowerCase()
        : String(person[personField] || '').toLowerCase();
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
  person: Record<string, any>,
  keywords: Record<string, string[]>,
  fields: readonly string[]
): boolean {
  for (const field of fields) {
    const kws = keywords[field];
    if (!kws || kws.length === 0) continue;
    const val = field === 'flemish_connection'
      ? getPersonFlemishConnectionText(person as Person).toLowerCase()
      : String(person[field] || '').toLowerCase();
    if (!val) continue;
    for (const kw of kws) {
      if (val.includes(kw)) return true;
    }
  }
  return false;
}

export interface FlemishSearchKeywords {
  flemish_connection: string[];
  bio: string[];
}

export interface FlemishSearchResult {
  message: string;
  keywords: FlemishSearchKeywords;
}

export async function flemishSearch(
  query: string
): Promise<FlemishSearchResult> {
  const result = await callAI<FlemishSearchResult>('flemish_search', { query });

  if (!result.message || !result.keywords) {
    throw new Error('Invalid flemish_search response');
  }

  const kw = result.keywords;
  for (const key of Object.keys(kw) as (keyof FlemishSearchKeywords)[]) {
    if (!Array.isArray(kw[key])) {
      kw[key] = [];
    }
    kw[key] = kw[key].map((v) => (typeof v === 'string' ? v.toLowerCase() : '')).filter(Boolean);
  }

  return result;
}

export interface SuggestPeopleResult {
  id: string;
  name: string;
  reason: string;
  similarity: number;
}

export interface SuggestPeopleResponse {
  message: string;
  suggestions: SuggestPeopleResult[];
}

/**
 * Suggest people via server-side embedding search + Gemini Pro ranking.
 * Falls back to client-side keyword scoring if the edge function is unavailable.
 */
export async function suggestPeopleEmbedding(
  query: string,
  options?: { collection_id?: string; exclude_ids?: string[]; max_results?: number }
): Promise<SuggestPeopleResponse> {
  try {
    const { data, error } = await supabase.functions.invoke('suggest-people', {
      body: {
        query,
        collection_id: options?.collection_id,
        exclude_ids: options?.exclude_ids,
        max_results: options?.max_results || 15,
      },
    });

    if (error) throw error;
    if (!data?.suggestions) throw new Error('No suggestions returned');

    return {
      message:
        typeof data.message === 'string'
          ? data.message
          : `Found ${data.suggestions.length} relevant people.`,
      suggestions: data.suggestions as SuggestPeopleResult[],
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
      };
    }

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
      .map((p: any) => ({
        person: p as Person,
        score: scorePersonAgainstKeywords(p, res.keywords),
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

export interface HybridSearchResultItem {
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
}

export interface HybridSearchResponse {
  results: HybridSearchResultItem[];
  keywords: SmartSearchKeywords;
  message: string;
  total_with_embeddings: number;
  route?: 'direct_lookup' | 'faceted' | 'exploratory';
  degraded?: boolean;
  diagnostics?: {
    lexical_candidates: number;
    vector_candidates: number;
    fused_candidates: number;
  };
}

/**
 * Server-side routed hybrid search using lexical retrieval + vector fusion.
 * Falls back to a degraded client-side path only if the edge function fails.
 */
export async function hybridSearch(
  query: string,
  maxResults = 30
): Promise<HybridSearchResponse> {
  try {
    const { data, error } = await supabase.functions.invoke('search-people', {
      body: { query, max_results: maxResults },
    });

    if (error) throw error;
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

    const results: HybridSearchResultItem[] = scored.map((s) => ({
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
    }));

    return {
      results,
      keywords: res.keywords,
      message: 'Search is running in degraded fallback mode; results are limited to the first 200 profiles.',
      total_with_embeddings: 0,
      degraded: true,
    };
  }
}

/** Log a search result click for relevance feedback (fire-and-forget) */
export function logSearchClick(query: string, personId: string): void {
  supabase.from('search_clicks').insert({ query, person_id: personId }).then();
}
