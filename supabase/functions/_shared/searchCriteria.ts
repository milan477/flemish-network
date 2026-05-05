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

function normalizeText(value: string | null | undefined): string {
  return (value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map(normalizeText).filter(Boolean)));
}

function termsMatchText(terms: string[], text: string | null): boolean {
  const normalizedText = normalizeText(text);
  if (!normalizedText) return false;

  return unique(terms).some((term) =>
    normalizedText.includes(term) || term.includes(normalizedText)
  );
}

function groupMatches(terms: string[], text: string | null): boolean {
  return terms.length === 0 || termsMatchText(terms, text);
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
  filters: ManualSearchFilters | null | undefined
): SmartSearchKeywords {
  const keywords = emptySearchKeywords();
  if (!filters || typeof filters !== "object") return keywords;

  if (typeof filters.sector === "string") keywords.sector = [filters.sector];
  if (typeof filters.occupation === "string") {
    keywords.occupation = [filters.occupation];
  }
  if (typeof filters.city === "string") keywords.location_city = [filters.city];
  if (typeof filters.state === "string") {
    keywords.location_state = [filters.state];
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
  right: SmartSearchKeywords
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
  document: StructuredSearchDocument
): StructuredCriteriaCoverage {
  const criteria: boolean[] = [];

  if ((keywords.sector || []).length > 0) {
    criteria.push(termsMatchText(keywords.sector, document.sector_names));
  }

  if ((keywords.occupation || []).length > 0) {
    criteria.push(termsMatchText(keywords.occupation, document.occupation));
  }

  if ((keywords.current_position || []).length > 0) {
    criteria.push(
      termsMatchText(keywords.current_position, document.current_position)
    );
  }

  if ((keywords.flemish_connection || []).length > 0) {
    criteria.push(
      termsMatchText(
        keywords.flemish_connection,
        document.flemish_connection_names
      )
    );
  }

  if (
    (keywords.location_city || []).length > 0 ||
    (keywords.location_state || []).length > 0
  ) {
    criteria.push(
      groupMatches(keywords.location_city || [], document.location_text) &&
        groupMatches(keywords.location_state || [], document.location_text)
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
  matchMode: SearchMatchMode
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
  matched: boolean
): StructuredCriteriaCoverage {
  const total = coverage.total + 1;
  const nextMatched = coverage.matched + (matched ? 1 : 0);

  return {
    total,
    matched: nextMatched,
    score: nextMatched / total,
  };
}
