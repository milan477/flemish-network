import { supabase } from './supabase';

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

export interface SuggestedPersonEntry {
  id: string;
  reason: string;
}

export interface SuggestPeopleResult {
  message: string;
  suggested_person_ids: string[];
  suggestions?: SuggestedPersonEntry[];
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
  person: Record<string, unknown>,
  keywords: SmartSearchKeywords
): number {
  let score = 0;
  let totalWeight = 0;

  const fields: { key: keyof SmartSearchKeywords; personField: string; weight: number }[] = [
    { key: 'name', personField: 'name', weight: 3 },
    { key: 'occupation', personField: 'occupation', weight: 2 },
    { key: 'sector', personField: 'sectors_text', weight: 2 },
    { key: 'location_city', personField: 'location_city', weight: 1.5 },
    { key: 'location_state', personField: 'location_state', weight: 1 },
    { key: 'current_position', personField: 'current_position', weight: 2 },
    { key: 'flemish_connection', personField: 'flemish_connection', weight: 2 },
    { key: 'bio', personField: 'bio', weight: 1 },
  ];

  for (const { key, personField, weight } of fields) {
    const kws = keywords[key];
    if (kws.length === 0) continue;

    totalWeight += weight;
    const val = String(person[personField] || '').toLowerCase();
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

export async function suggestPeople(
  query: string,
  plan: Record<string, unknown>,
  people: Array<Record<string, unknown>>
): Promise<SuggestPeopleResult> {
  const trimmedPeople = people.map((p) => ({
    id: p.id,
    name: p.name,
    current_position: p.current_position || '',
    location_city: p.location_city || '',
    location_state: p.location_state || '',
    flemish_connection: p.flemish_connection || '',
    available_for_lectures: p.available_for_lectures || false,
    bio: typeof p.bio === 'string' ? p.bio.slice(0, 200) : '',
  }));

  const result = await callAI<SuggestPeopleResult>('suggest_people', {
    query,
    plan,
    people: trimmedPeople,
  });

  if (!result.message || !Array.isArray(result.suggested_person_ids)) {
    throw new Error('Invalid suggest_people response');
  }

  const validIds = new Set(people.map((p) => p.id as string));
  result.suggested_person_ids = result.suggested_person_ids.filter((id) =>
    validIds.has(id)
  );

  if (result.suggestions) {
    result.suggestions = result.suggestions.filter((s) => validIds.has(s.id));
  }

  return result;
}
