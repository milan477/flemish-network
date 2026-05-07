import type { SmartSearchKeywords } from "./aiContracts.ts";

export type SearchMatchMode = "all" | "any";

export interface ManualSearchFilters {
  sector?: string | null;
  person_scope?: string | null;
  occupation?: string | null;
  city?: string | null;
  state?: string | null;
  flemish_connections?: string[] | null;
}

export interface StructuredSearchDocument {
  current_position: string | null;
  occupation: string | null;
  flemish_connection_names: string | null;
  sector_names: string | null;
  location_text: string | null;
}

export interface StructuredCriteriaCoverage {
  total: number;
  matched: number;
  score: number;
}

export interface SearchIntentConstraint {
  field: "sector" | "state";
  value: string;
  matched_text: string;
}

export interface SearchIntent {
  original_query: string;
  semantic_query: string;
  structured_constraints: SearchIntentConstraint[];
  semantic_remainder: string;
  keywords: SmartSearchKeywords;
}

export interface SearchIntentCatalog {
  sectors?: string[];
}

const KEYWORD_FIELDS: Array<keyof SmartSearchKeywords> = [
  "name",
  "occupation",
  "sector",
  "location_city",
  "location_state",
  "current_position",
  "flemish_connection",
  "bio",
];

const STATE_NAMES_BY_CODE: Record<string, string> = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
  DC: "District of Columbia",
};

const STATE_CODES_BY_NAME = Object.fromEntries(
  Object.entries(STATE_NAMES_BY_CODE).map(([code, name]) => [
    normalizeText(name),
    code,
  ]),
) as Record<string, string>;

const DEFAULT_SECTOR_CANONICAL: Record<string, string> = {
  ai: "Artificial Intelligence",
  "artificial intelligence": "Artificial Intelligence",
  biotech: "Biotechnology",
  biotechnology: "Biotechnology",
  finance: "Finance",
  "culture arts": "Culture & Arts",
  "culture & arts": "Culture & Arts",
  education: "Education",
  research: "Research",
};

function normalizeText(value: string | null | undefined): string {
  return (value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map(normalizeText).filter(Boolean)));
}

function uniqueDisplay(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = normalizeText(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(value.trim());
  }
  return result;
}

function containsNormalizedTerm(text: string, term: string): boolean {
  const normalizedText = normalizeText(text);
  const normalizedTerm = normalizeText(term);
  if (!normalizedText || !normalizedTerm) return false;
  if (normalizedText === normalizedTerm) return true;

  const pattern = new RegExp(`(^|\\s)${escapeRegExp(normalizedTerm)}(\\s|$)`);
  return pattern.test(normalizedText);
}

function termsMatchText(terms: string[], text: string | null): boolean {
  const normalizedText = normalizeText(text);
  if (!normalizedText) return false;

  return unique(terms).some((term) =>
    containsNormalizedTerm(normalizedText, term)
  );
}

function groupMatches(terms: string[], text: string | null): boolean {
  return terms.length === 0 || termsMatchText(terms, text);
}

function expandStateTerms(terms: string[]): string[] {
  const expanded: string[] = [];
  for (const term of terms) {
    const normalized = normalizeText(term);
    if (!normalized) continue;
    expanded.push(term);

    if (normalized.length === 2) {
      const stateName = STATE_NAMES_BY_CODE[normalized.toUpperCase()];
      if (stateName) expanded.push(stateName);
      continue;
    }

    const stateCode = STATE_CODES_BY_NAME[normalized];
    if (stateCode) expanded.push(stateCode);
  }
  return uniqueDisplay(expanded);
}

function expandSectorTerms(terms: string[]): string[] {
  const expanded: string[] = [];
  const canonicalToAliases = new Map<string, string[]>();
  for (const [alias, canonical] of Object.entries(DEFAULT_SECTOR_CANONICAL)) {
    const key = normalizeText(canonical);
    canonicalToAliases.set(key, [
      ...(canonicalToAliases.get(key) || []),
      alias,
    ]);
  }

  for (const term of terms) {
    const normalized = normalizeText(term);
    if (!normalized) continue;
    expanded.push(term);
    const canonical = DEFAULT_SECTOR_CANONICAL[normalized];
    if (canonical) expanded.push(canonical);
    for (const alias of canonicalToAliases.get(normalized) || []) {
      expanded.push(alias);
    }
  }

  return uniqueDisplay(expanded);
}

function buildSectorCanonicalMap(
  catalog: SearchIntentCatalog | undefined,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const [alias, canonical] of Object.entries(DEFAULT_SECTOR_CANONICAL)) {
    map.set(normalizeText(alias), canonical);
  }
  for (const sector of catalog?.sectors || []) {
    const normalized = normalizeText(sector);
    if (normalized) map.set(normalized, sector.trim());
  }
  return map;
}

function matchCatalogTerm(
  query: string,
  catalog: Map<string, string>,
): { raw: string; canonical: string } | null {
  const candidates = Array.from(catalog.entries())
    .filter(([raw]) => raw.length > 1)
    .sort((a, b) => b[0].length - a[0].length);

  for (const [raw, canonical] of candidates) {
    const pattern = new RegExp(`(^|\\W)${escapeRegExp(raw)}(\\W|$)`, "i");
    if (pattern.test(query)) return { raw, canonical };
  }

  return null;
}

function matchState(
  query: string,
): { raw: string; canonical: string; code: string } | null {
  for (const [code, name] of Object.entries(STATE_NAMES_BY_CODE)) {
    const codePattern = new RegExp(`(^|\\W)${escapeRegExp(code)}(\\W|$)`);
    if (codePattern.test(query)) return { raw: code, canonical: name, code };

    const namePattern = new RegExp(`(^|\\W)${escapeRegExp(name)}(\\W|$)`, "i");
    if (namePattern.test(query)) return { raw: name, canonical: name, code };
  }

  return null;
}

function removeMatchedTerms(query: string, rawTerms: string[]): string {
  let next = query;
  for (const term of rawTerms) {
    next = next.replace(
      new RegExp(`(^|\\W)${escapeRegExp(term)}(?=\\W|$)`, "ig"),
      " ",
    );
  }
  return normalizeText(
    next.replace(/\b(in|near|around|based|based in)\b/gi, " "),
  );
}

export function parseSearchIntent(
  query: string,
  baseKeywords: SmartSearchKeywords = emptySearchKeywords(),
  catalog?: SearchIntentCatalog,
): SearchIntent {
  const originalQuery = query.trim();
  const keywords = mergeSearchKeywords(baseKeywords, emptySearchKeywords());
  const structuredConstraints: SearchIntentConstraint[] = [];
  const rawMatches: string[] = [];

  const sectorMatch = matchCatalogTerm(
    originalQuery,
    buildSectorCanonicalMap(catalog),
  );
  if (sectorMatch) {
    structuredConstraints.push({
      field: "sector",
      value: sectorMatch.canonical,
      matched_text: sectorMatch.raw,
    });
    keywords.sector = uniqueDisplay([
      ...keywords.sector,
      sectorMatch.canonical,
    ]);
    rawMatches.push(sectorMatch.raw);
  }

  const stateMatch = matchState(originalQuery);
  if (stateMatch) {
    structuredConstraints.push({
      field: "state",
      value: stateMatch.code,
      matched_text: stateMatch.raw,
    });
    keywords.location_state = uniqueDisplay([
      ...keywords.location_state,
      stateMatch.code,
      stateMatch.canonical,
    ]);
    rawMatches.push(stateMatch.raw);
  }

  return {
    original_query: originalQuery,
    semantic_query: originalQuery,
    structured_constraints: structuredConstraints,
    semantic_remainder: removeMatchedTerms(originalQuery, rawMatches),
    keywords,
  };
}

export function buildLexicalQueryForIntent(intent: SearchIntent): string {
  const canonicalTerms = intent.structured_constraints.map((constraint) =>
    constraint.value
  );
  return uniqueDisplay([intent.original_query, ...canonicalTerms]).join(" ");
}

export function normalizeSearchMatchMode(value: unknown): SearchMatchMode {
  return value === "any" ? "any" : "all";
}

export function emptySearchKeywords(): SmartSearchKeywords {
  return {
    name: [],
    occupation: [],
    sector: [],
    location_city: [],
    location_state: [],
    current_position: [],
    flemish_connection: [],
    bio: [],
  };
}

export function buildManualFilterKeywords(
  filters: ManualSearchFilters | null | undefined,
): SmartSearchKeywords {
  const keywords = emptySearchKeywords();
  if (!filters || typeof filters !== "object") return keywords;

  if (typeof filters.sector === "string") keywords.sector = [filters.sector];
  if (typeof filters.occupation === "string") {
    keywords.occupation = [filters.occupation];
  }
  if (typeof filters.city === "string") keywords.location_city = [filters.city];
  if (typeof filters.state === "string") {
    keywords.location_state = expandStateTerms([filters.state]);
  }
  if (Array.isArray(filters.flemish_connections)) {
    keywords.flemish_connection = filters.flemish_connections.filter((value) =>
      typeof value === "string"
    ) as string[];
  }

  return keywords;
}

export function mergeSearchKeywords(
  left: SmartSearchKeywords,
  right: SmartSearchKeywords,
): SmartSearchKeywords {
  const merged = emptySearchKeywords();

  for (const field of KEYWORD_FIELDS) {
    merged[field] = unique([
      ...(left[field] || []),
      ...(right[field] || []),
    ]);
  }

  return merged;
}

export function calculateStructuredCriteriaCoverage(
  keywords: SmartSearchKeywords,
  document: StructuredSearchDocument,
): StructuredCriteriaCoverage {
  const criteria: boolean[] = [];

  if ((keywords.sector || []).length > 0) {
    criteria.push(
      termsMatchText(expandSectorTerms(keywords.sector), document.sector_names),
    );
  }

  if ((keywords.occupation || []).length > 0) {
    criteria.push(termsMatchText(keywords.occupation, document.occupation));
  }

  if ((keywords.current_position || []).length > 0) {
    criteria.push(
      termsMatchText(keywords.current_position, document.current_position),
    );
  }

  if ((keywords.flemish_connection || []).length > 0) {
    criteria.push(
      termsMatchText(
        keywords.flemish_connection,
        document.flemish_connection_names,
      ),
    );
  }

  if (
    (keywords.location_city || []).length > 0 ||
    (keywords.location_state || []).length > 0
  ) {
    criteria.push(
      groupMatches(keywords.location_city || [], document.location_text) &&
        groupMatches(
          expandStateTerms(keywords.location_state || []),
          document.location_text,
        ),
    );
  }

  const matched = criteria.filter(Boolean).length;
  const total = criteria.length;

  return {
    total,
    matched,
    score: total === 0 ? 0 : matched / total,
  };
}

export function criteriaCoveragePasses(
  coverage: StructuredCriteriaCoverage,
  matchMode: SearchMatchMode,
): boolean {
  if (coverage.total === 0) return true;
  if (matchMode === "any") return coverage.matched > 0;
  return coverage.matched === coverage.total;
}

export function normalizePersonScope(value: unknown): string | null {
  return value === "us_based" || value === "us_connected_abroad" ? value : null;
}

export function addCriterionCoverage(
  coverage: StructuredCriteriaCoverage,
  matched: boolean,
): StructuredCriteriaCoverage {
  const total = coverage.total + 1;
  const nextMatched = coverage.matched + (matched ? 1 : 0);

  return {
    total,
    matched: nextMatched,
    score: nextMatched / total,
  };
}
