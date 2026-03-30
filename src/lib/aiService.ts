import { supabase } from './supabase';
import { type Person } from './supabase';

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

export interface SearchedContact {
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

export interface SearchContactsResult {
  message: string;
  contacts: SearchedContact[];
}

export async function searchContacts(
  query: string
): Promise<SearchContactsResult> {
  const { data, error } = await supabase.functions.invoke('search-contacts', {
    body: { query },
  });

  if (error) {
    throw new Error(`Search request failed: ${error.message}`);
  }

  const result = data as SearchContactsResult;

  if (!result || (!result.message && !result.contacts)) {
    throw new Error('Invalid search response');
  }

  return {
    message: result.message || 'Search complete.',
    contacts: Array.isArray(result.contacts) ? result.contacts : [],
  };
}

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
  const result = await callAI<SmartSearchResult>('smart_search', { query });

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
      val = String(person[personField] || '').toLowerCase();
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
    const val = String(person[field] || '').toLowerCase();
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

/** Fire-and-forget: trigger embedding generation for a person */
export function generateEmbedding(personId: string): void {
  supabase.functions.invoke('generate-embeddings', {
    body: { personId },
  }).catch(() => {/* fire-and-forget */});
}

export interface SuggestPeopleResult {
  id: string;
  name: string;
  reason: string;
  similarity: number;
}

/**
 * Suggest people via server-side embedding search + Gemini Pro ranking.
 * Falls back to client-side keyword scoring if the edge function is unavailable.
 */
export async function suggestPeopleEmbedding(
  query: string,
  options?: { collection_id?: string; exclude_ids?: string[]; max_results?: number }
): Promise<SuggestPeopleResult[]> {
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

    return data.suggestions as SuggestPeopleResult[];
  } catch {
    // Fallback to client-side scoring
    const fallback = await suggestPeople(query);
    return fallback.map((item) => ({
      id: item.person.id,
      name: item.person.name,
      reason: item.reason,
      similarity: item.score,
    }));
  }
}

export async function suggestPeople(query: string): Promise<{ person: Person; reason: string; score: number }[]> {
  try {
    const res = await smartSearch(query);
    const { data: people, error } = await supabase.from('people').select('*, locations(*)').limit(200);
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
}

/**
 * Server-side hybrid search combining keyword scoring (0.4) + embedding similarity (0.6).
 * Replaces the old pattern of fetching all people and scoring client-side.
 * Falls back to client-side scoring if the edge function fails.
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
    // Fallback: client-side scoring (same as before, but only as degraded path)
    const res = await smartSearch(query);
    const { data: people } = await supabase.from('people').select('*, locations(*)').limit(200);

    if (!people) {
      return { results: [], keywords: res.keywords, message: res.message, total_with_embeddings: 0 };
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
      flemish_connection: s.person.flemish_connection ?? null,
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

    return { results, keywords: res.keywords, message: res.message, total_with_embeddings: 0 };
  }
}

/** Log a search result click for relevance feedback (fire-and-forget) */
export function logSearchClick(query: string, personId: string): void {
  supabase.from('search_clicks').insert({ query, person_id: personId }).then();
}
