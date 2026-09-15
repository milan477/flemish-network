import type { Organization, Person } from './supabase';
import type { HybridSearchResultItem, SmartSearchKeywords } from './aiService';

export type SearchRefinementKind = 'university' | 'location' | 'sector' | 'role';

export interface SearchRefinementSuggestion {
  id: string;
  kind: SearchRefinementKind;
  label: string;
  value: string;
  searchQuery: string;
  matchTerms: string[];
}

export interface SearchRefinementGroup extends SearchRefinementSuggestion {
  people: Person[];
  organizations: Organization[];
  snippets: Array<[string, string]>;
  loading?: boolean;
}

function normalize(value: string | null | undefined): string {
  return (value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const EXACT_MATCH_STOP_WORDS = new Set([
  'a', 'an', 'and', 'at', 'for', 'from', 'in', 'of', 'on', 'or', 'the', 'to', 'with',
]);

const GENERIC_QUERY_CONCEPTS: Record<string, string> = {
  uni: 'university',
  univ: 'university',
};

function tokenMatchesKeyword(token: string, keyword: string): boolean {
  if (token === keyword) return true;
  if (keyword.length >= 3 && token.startsWith(keyword)) return true;
  return token.length >= 3 && keyword.startsWith(token);
}

function exactKeywordScore(query: string, values: Array<string | null | undefined>): number {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return 0;
  return values.some((value) => {
    const searchableText = normalize(value);
    return Boolean(searchableText) && ` ${searchableText} `.includes(` ${normalizedQuery} `);
  }) ? 1 : 0;
}

export function exactSearchPhrase(query: string): string {
  return normalize(query);
}

export function exactSearchKeywords(query: string): string[] {
  return normalize(query)
    .split(' ')
    .filter((keyword) => keyword.length > 1 && !EXACT_MATCH_STOP_WORDS.has(keyword))
    .map((keyword) => GENERIC_QUERY_CONCEPTS[keyword] || keyword);
}

function connectionNames(person: Person): string[] {
  return (person.person_flemish_connections || []).flatMap((link) => {
    const connections = Array.isArray(link.flemish_connections)
      ? link.flemish_connections
      : link.flemish_connections
        ? [link.flemish_connections]
        : [];
    return connections.map((connection) => connection.name);
  });
}

export function personMatchesExactSearch(
  person: Person,
  query: string,
  snippet?: string
): boolean {
  return personExactSearchScore(person, query, snippet) > 0;
}

export function personExactSearchScore(
  person: Person,
  query: string,
  snippet?: string
): number {
  return exactKeywordScore(query, [
    person.name,
    person.first_name,
    person.last_name,
    person.title,
    person.current_position,
    person.occupation,
    person.bio,
    person.flemish_connection,
    person.sector_names,
    person.locations?.city,
    person.locations?.state,
    person.current_location_city,
    person.current_location_country,
    ...(person.person_us_connections || []).flatMap((connection) => [
      connection.connection_label,
      connection.evidence_excerpt,
      connection.locations?.city,
      connection.locations?.state,
    ]),
    ...connectionNames(person),
    snippet,
  ]);
}

export function organizationMatchesExactSearch(
  organization: Organization,
  query: string,
  snippet?: string
): boolean {
  return organizationExactSearchScore(organization, query, snippet) > 0;
}

export function organizationExactSearchScore(
  organization: Organization,
  query: string,
  snippet?: string
): number {
  return exactKeywordScore(query, [
    organization.name,
    organization.type,
    organization.description,
    organization.locations?.city,
    organization.locations?.state,
    ...(organization.organization_us_locations || []).flatMap((location) => [
      location.label,
      location.description,
      location.evidence_excerpt,
      location.locations?.city,
      location.locations?.state,
    ]),
    snippet,
  ]);
}

function titleCase(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .map((word) => word ? `${word[0].toUpperCase()}${word.slice(1).toLowerCase()}` : '')
    .join(' ');
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = normalize(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function resultText(result: HybridSearchResultItem): string {
  if (result.entity_type === 'organization') {
    return [result.name, result.type, result.description, result.snippet, result.rationale]
      .filter(Boolean)
      .join(' ');
  }

  return [
    result.name,
    result.current_position,
    result.occupation,
    result.bio,
    result.flemish_connection,
    result.snippet,
    result.rationale,
  ]
    .filter(Boolean)
    .join(' ');
}

function inferInstitution(
  query: string,
  results: HybridSearchResultItem[]
): { value: string; aliases: string[] } | null {
  const queryKeywords = exactSearchKeywords(query);

  const candidateScore = (value: string): number => {
    const candidateTokens = normalize(value).split(' ');
    const tokenScore = queryKeywords.filter((keyword) =>
      candidateTokens.some((token) => tokenMatchesKeyword(token, keyword))
    ).length;
    const queryAcronym = normalize(query).replace(/\s+/g, '');
    const candidateAcronym = candidateTokens
      .filter((token) => !EXACT_MATCH_STOP_WORDS.has(token))
      .map((token) => token[0])
      .join('');
    return queryAcronym.length >= 2 && queryAcronym === candidateAcronym
      ? queryKeywords.length + 1
      : tokenScore;
  };

  const matchingOrganization = results
    .filter((result) => result.entity_type === 'organization')
    .filter((result) =>
      /\b(university|college|institute|school)\b/.test(normalize(`${result.name} ${result.type}`))
    )
    .sort((a, b) => candidateScore(b.name) - candidateScore(a.name))[0];
  if (matchingOrganization?.entity_type === 'organization') {
    if (candidateScore(matchingOrganization.name) > 0) {
      return { value: matchingOrganization.name, aliases: [matchingOrganization.name] };
    }
  }

  const patterns = [
    /\bUniversity\s+of\s+(?:[A-Z][A-Za-z&.'-]*\s*){1,4}?\b/g,
    /\b(?:[A-Z][A-Za-z&.'-]*\s+){1,4}(?:University|College|Institute|School)\b/g,
    /\b[A-Z]{2,5}\s+[A-Z][A-Za-z.'-]+\b/g,
  ];

  let bestMatch = '';
  let bestScore = 0;
  for (const result of results) {
    const text = resultText(result);
    for (const pattern of patterns) {
      for (const match of text.match(pattern) || []) {
        const score = candidateScore(match);
        if (score > bestScore) {
          bestMatch = match.trim();
          bestScore = score;
        }
      }
    }
  }

  return bestMatch ? { value: bestMatch, aliases: [bestMatch] } : null;
}

export function buildSearchRefinementSuggestions(
  query: string,
  keywords: SmartSearchKeywords,
  results: HybridSearchResultItem[]
): SearchRefinementSuggestion[] {
  const suggestions: SearchRefinementSuggestion[] = [];
  const institution = inferInstitution(query, results);

  if (institution) {
    suggestions.push({
      id: `university:${normalize(institution.value)}`,
      kind: 'university',
      label: `University: ${institution.value}`,
      value: institution.value,
      searchQuery: `people and organizations affiliated with ${institution.value}`,
      matchTerms: unique(institution.aliases),
    });
  }

  const location = keywords.location_city[0] || '';
  if (location) {
    const state = keywords.location_state[0];
    const locationValue = titleCase(location);
    suggestions.push({
      id: `location:${normalize(locationValue)}:${normalize(state)}`,
      kind: 'location',
      label: `Location: ${locationValue}${state ? `, ${state.toUpperCase()}` : ''}`,
      value: locationValue,
      searchQuery: `people and organizations located in ${locationValue}${state ? `, ${state}` : ', United States'}`,
      matchTerms: unique([locationValue, state]),
    });
  }

  const sector = keywords.sector[0];
  if (sector && !suggestions.some((suggestion) => normalize(suggestion.value) === normalize(sector))) {
    const value = titleCase(sector);
    suggestions.push({
      id: `sector:${normalize(value)}`,
      kind: 'sector',
      label: `Sector: ${value}`,
      value,
      searchQuery: `people and organizations in the ${value} sector`,
      matchTerms: unique(keywords.sector),
    });
  }

  const role = keywords.occupation[0];
  if (role && suggestions.length < 3) {
    const value = titleCase(role);
    suggestions.push({
      id: `role:${normalize(value)}`,
      kind: 'role',
      label: `Role: ${value}`,
      value,
      searchQuery: `people working as ${value}`,
      matchTerms: unique(keywords.occupation),
    });
  }

  return suggestions.slice(0, 3);
}

function includesAny(text: string, terms: string[]): boolean {
  const normalizedText = normalize(text);
  return terms.some((term) => normalizedText.includes(normalize(term)));
}

function personLocationText(person: Person): string {
  return [
    person.locations?.city,
    person.locations?.state,
    ...(person.person_us_connections || []).flatMap((connection) => [
      connection.locations?.city,
      connection.locations?.state,
    ]),
  ]
    .filter(Boolean)
    .join(' ');
}

function organizationLocationText(organization: Organization): string {
  return [
    organization.locations?.city,
    organization.locations?.state,
    ...(organization.organization_us_locations || []).flatMap((location) => [
      location.locations?.city,
      location.locations?.state,
    ]),
  ]
    .filter(Boolean)
    .join(' ');
}

export function resultMatchesRefinement(
  result: HybridSearchResultItem,
  refinement: SearchRefinementSuggestion
): boolean {
  if (refinement.kind === 'location') {
    const locationText = result.entity_type === 'person'
      ? personLocationText(result as unknown as Person)
      : organizationLocationText(result as unknown as Organization);
    return includesAny(locationText, [refinement.value]) ||
      includesAny(resultText(result), [refinement.value]);
  }

  if (refinement.kind === 'university') {
    return includesAny(resultText(result), refinement.matchTerms);
  }

  if (refinement.kind === 'sector') {
    const text = result.entity_type === 'person'
      ? [result.occupation, result.bio, result.snippet].filter(Boolean).join(' ')
      : [result.type, result.description, result.snippet].filter(Boolean).join(' ');
    return includesAny(text, refinement.matchTerms);
  }

  const text = result.entity_type === 'person'
    ? [result.occupation, result.current_position, result.bio].filter(Boolean).join(' ')
    : [result.type, result.description].filter(Boolean).join(' ');
  return includesAny(text, refinement.matchTerms);
}
