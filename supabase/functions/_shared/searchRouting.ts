import type { SmartSearchKeywords } from "./aiContracts.ts";
import type { SearchIntent } from "./searchCriteria.ts";

export type SearchRoute = "direct_lookup" | "faceted" | "exploratory";

export interface SearchRouteConfig {
  route: SearchRoute;
  lexicalTopK: number;
  vectorTopK: number;
  vectorSimilarityThreshold: number;
  lexicalWeight: number;
  vectorWeight: number;
  lexicalSignalWeight: number;
  vectorSignalWeight: number;
  exactBoost: number;
  nameBoost: number;
  minimumScore: number;
}

export interface SearchDocumentSnippetSource {
  current_position: string | null;
  occupation: string | null;
  bio: string | null;
  flemish_connection_names: string | null;
  sector_names: string | null;
  location_text: string | null;
}

export interface LexicalMatchHint {
  match_field: string | null;
  match_text: string | null;
}

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "at",
  "for",
  "from",
  "in",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
]);

const SEARCH_ROUTE_CONFIG: Record<SearchRoute, SearchRouteConfig> = {
  direct_lookup: {
    route: "direct_lookup",
    lexicalTopK: 40,
    vectorTopK: 20,
    vectorSimilarityThreshold: 0.12,
    lexicalWeight: 0.72,
    vectorWeight: 0.28,
    lexicalSignalWeight: 0.16,
    vectorSignalWeight: 0.08,
    exactBoost: 0.16,
    nameBoost: 0.12,
    minimumScore: 0.012,
  },
  faceted: {
    route: "faceted",
    lexicalTopK: 60,
    vectorTopK: 30,
    vectorSimilarityThreshold: 0.1,
    lexicalWeight: 0.64,
    vectorWeight: 0.36,
    lexicalSignalWeight: 0.12,
    vectorSignalWeight: 0.1,
    exactBoost: 0.07,
    nameBoost: 0.08,
    minimumScore: 0.009,
  },
  exploratory: {
    route: "exploratory",
    lexicalTopK: 50,
    vectorTopK: 50,
    vectorSimilarityThreshold: 0.08,
    lexicalWeight: 0.52,
    vectorWeight: 0.48,
    lexicalSignalWeight: 0.1,
    vectorSignalWeight: 0.12,
    exactBoost: 0.04,
    nameBoost: 0.05,
    minimumScore: 0.007,
  },
};

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s&/+.-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitTerms(value: string): string[] {
  return normalizeText(value)
    .split(" ")
    .map((term) => term.trim())
    .filter((term) => term.length > 1 && !STOP_WORDS.has(term));
}

function hasInstitutionAnchor(values: string[]): boolean {
  return values.some((value) =>
    /\b(baef|fayat|imec|ku|leuven|ugent|ghent|vub|uantwerp|uhasselt|university|college|institute|lab|fellowship|foundation)\b/i
      .test(
        value,
      )
  );
}

function scoreTextMatch(
  text: string | null | undefined,
  terms: string[],
  normalizedQuery: string,
): number {
  const normalizedText = normalizeText(text || "");
  if (!normalizedText) return 0;

  let score = 0;

  if (normalizedQuery && normalizedText.includes(normalizedQuery)) {
    score += 2;
  }

  for (const term of terms) {
    if (!term) continue;
    if (normalizedText === term) {
      score += 1.5;
      continue;
    }
    if (normalizedText.startsWith(term)) {
      score += 1.1;
      continue;
    }
    if (normalizedText.includes(term)) {
      score += 0.75;
    }
  }

  return score;
}

function bestBioSentence(
  bio: string | null | undefined,
  terms: string[],
  normalizedQuery: string,
): string {
  const sentences = (bio || "")
    .split(/[.!?]+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  if (sentences.length === 0) return "";

  const best = sentences
    .map((sentence) => ({
      sentence,
      score: scoreTextMatch(sentence, terms, normalizedQuery),
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.sentence.length - b.sentence.length;
    })[0];

  return best?.sentence || sentences[0];
}

function truncate(text: string, maxLength = 220): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trimEnd()}...`;
}

export function classifySearchRoute(
  query: string,
  keywords: SmartSearchKeywords,
): SearchRoute {
  const trimmedQuery = query.trim();
  const tokens = splitTerms(trimmedQuery);
  const tokenCount = tokens.length;
  const hasLocation = keywords.location_city.length > 0 ||
    keywords.location_state.length > 0;
  const hasStructuredFacet = keywords.sector.length > 0 ||
    keywords.occupation.length > 0 ||
    keywords.flemish_connection.length > 0;
  const hasNamedAnchor = keywords.name.length > 0 ||
    hasInstitutionAnchor(keywords.flemish_connection);
  const hasSemanticIntent = keywords.bio.length > 1 ||
    /\b(looking for|people who|someone who|working on|focused on|interested in)\b/i
      .test(
        trimmedQuery,
      ) ||
    tokenCount >= 7;
  const looksLiteralName = tokenCount >= 1 &&
    tokenCount <= 4 &&
    !hasLocation &&
    !hasStructuredFacet &&
    keywords.bio.length === 0 &&
    /^[\p{L}.' -]+$/u.test(trimmedQuery);

  if (
    looksLiteralName ||
    (keywords.name.length > 0 &&
      tokenCount <= 4 &&
      !hasLocation &&
      keywords.bio.length === 0)
  ) {
    return "direct_lookup";
  }

  if (hasLocation && hasStructuredFacet) {
    if (
      !hasNamedAnchor &&
      (keywords.sector.length > 0 || keywords.occupation.length > 0) &&
      tokenCount >= 3
    ) {
      return "exploratory";
    }

    return "faceted";
  }

  if (tokenCount <= 4 && !hasLocation && !hasSemanticIntent) {
    return "direct_lookup";
  }

  if (
    hasLocation || hasStructuredFacet || keywords.current_position.length > 0
  ) {
    return "faceted";
  }

  return "exploratory";
}

export function getSearchRouteConfig(route: SearchRoute): SearchRouteConfig {
  return SEARCH_ROUTE_CONFIG[route];
}

export function buildSemanticRetrievalQuery(
  query: string | Pick<SearchIntent, "original_query" | "semantic_remainder">,
): string {
  if (typeof query === "string") return query.trim();
  return query.original_query.trim() || query.semantic_remainder.trim();
}

export function buildSearchTerms(
  query: string,
  keywords: SmartSearchKeywords,
): string[] {
  const orderedTerms = [
    normalizeText(query),
    ...keywords.name,
    ...keywords.current_position,
    ...keywords.occupation,
    ...keywords.sector,
    ...keywords.flemish_connection,
    ...keywords.location_city,
    ...keywords.location_state,
    ...keywords.bio,
    ...splitTerms(query),
  ];

  return Array.from(
    new Set(orderedTerms.map((term) => normalizeText(term)).filter(Boolean)),
  ).slice(0, 16);
}

export function pickSearchSnippet(
  doc: SearchDocumentSnippetSource,
  terms: string[],
  query: string,
  hint?: LexicalMatchHint,
): string {
  const normalizedQuery = normalizeText(query);

  if (
    hint?.match_text?.trim() &&
    hint.match_field &&
    hint.match_field !== "name" &&
    hint.match_field !== "current_position"
  ) {
    return truncate(hint.match_text.trim());
  }

  const bioSentence = bestBioSentence(doc.bio, terms, normalizedQuery);
  const candidates = [
    {
      text: doc.flemish_connection_names || "",
      score:
        scoreTextMatch(doc.flemish_connection_names, terms, normalizedQuery) +
        0.18,
    },
    {
      text: doc.sector_names || "",
      score: scoreTextMatch(doc.sector_names, terms, normalizedQuery) + 0.14,
    },
    {
      text: doc.location_text || "",
      score: scoreTextMatch(doc.location_text, terms, normalizedQuery) + 0.12,
    },
    {
      text: doc.occupation || "",
      score: scoreTextMatch(doc.occupation, terms, normalizedQuery) + 0.1,
    },
    {
      text: bioSentence,
      score: scoreTextMatch(bioSentence, terms, normalizedQuery) +
        (bioSentence ? 0.08 : 0),
    },
    {
      text: doc.current_position || "",
      score: scoreTextMatch(doc.current_position, terms, normalizedQuery) +
        0.06,
    },
  ]
    .filter((candidate) => candidate.text.trim())
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.text.length - b.text.length;
    });

  const snippet = candidates[0]?.text ||
    bioSentence ||
    doc.current_position ||
    doc.flemish_connection_names ||
    doc.location_text ||
    "";

  return truncate(snippet.trim());
}
