export type CollectionSuggestionEntityType = "person" | "organization";

export interface CollectionSuggestionSearch {
  query: string;
  targets: CollectionSuggestionEntityType[];
}

export interface CollectionSuggestionGap {
  should_offer: boolean;
  reason?: string;
  suggested_prompt?: string;
}

export interface CollectionSuggestionPlan {
  searches: CollectionSuggestionSearch[];
  gap: CollectionSuggestionGap;
}

export interface CollectionSuggestionCandidate {
  entity_type: CollectionSuggestionEntityType;
  id: string;
  name: string;
  reason: string;
  score: number;
  snippet?: string;
  source_search: string;
}

export interface RerankedCollectionCandidate {
  entity_type: CollectionSuggestionEntityType;
  id: string;
  reason: string;
  score: number;
}

const ENTITY_TYPES = new Set<CollectionSuggestionEntityType>([
  "person",
  "organization",
]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function normalizeTargets(value: unknown): CollectionSuggestionEntityType[] {
  const raw = Array.isArray(value) ? value : [];
  const targets = raw.filter(
    (item): item is CollectionSuggestionEntityType =>
      typeof item === "string" && ENTITY_TYPES.has(item as CollectionSuggestionEntityType),
  );
  return Array.from(new Set(targets));
}

export function collectionSuggestionKey(
  entityType: CollectionSuggestionEntityType,
  id: string,
): string {
  return `${entityType}:${id}`;
}

export function fallbackCollectionSuggestionPlan(query: string): CollectionSuggestionPlan {
  return {
    searches: [{
      query: query.trim(),
      targets: ["person", "organization"],
    }],
    gap: { should_offer: false },
  };
}

export function parseCollectionSuggestionPlan(
  payload: unknown,
  fallbackQuery: string,
): CollectionSuggestionPlan {
  const record = asRecord(payload);
  const rawSearches = Array.isArray(record.searches) ? record.searches : [];
  const searches = rawSearches
    .map((item) => {
      const row = asRecord(item);
      const query = cleanText(row.query);
      if (!query) return null;
      const targets = normalizeTargets(row.targets ?? row.entity_targets);
      return {
        query,
        targets: targets.length > 0 ? targets : ["person", "organization"],
      } satisfies CollectionSuggestionSearch;
    })
    .filter((item): item is CollectionSuggestionSearch => Boolean(item))
    .slice(0, 4);

  const gapRaw = asRecord(record.gap);
  const reason = cleanText(gapRaw.reason);
  const suggestedPrompt = cleanText(
    gapRaw.suggested_prompt ?? record.discovery_prompt,
  );
  const shouldOffer =
    gapRaw.should_offer === true || Boolean(suggestedPrompt || reason);

  return {
    searches: searches.length > 0
      ? searches
      : fallbackCollectionSuggestionPlan(fallbackQuery).searches,
    gap: {
      should_offer: shouldOffer,
      ...(reason ? { reason } : {}),
      ...(suggestedPrompt ? { suggested_prompt: suggestedPrompt } : {}),
    },
  };
}

export function parseRerankedCollectionCandidates(
  payload: unknown,
): { message: string; candidates: RerankedCollectionCandidate[] } {
  const record = asRecord(payload);
  const rawCandidates = Array.isArray(record.candidates)
    ? record.candidates
    : Array.isArray(record.suggestions)
      ? record.suggestions
      : [];

  return {
    message: cleanText(record.message),
    candidates: rawCandidates
      .map((item) => {
        const row = asRecord(item);
        const entityType = row.entity_type;
        const id = cleanText(row.id);
        const reason = cleanText(row.reason);
        const rawScore = row.score;
        const score = typeof rawScore === "number" && Number.isFinite(rawScore)
          ? Math.max(0, Math.min(1, rawScore))
          : 0.5;

        if (
          !id ||
          !reason ||
          typeof entityType !== "string" ||
          !ENTITY_TYPES.has(entityType as CollectionSuggestionEntityType)
        ) {
          return null;
        }

        return {
          entity_type: entityType as CollectionSuggestionEntityType,
          id,
          reason,
          score,
        } satisfies RerankedCollectionCandidate;
      })
      .filter((item): item is RerankedCollectionCandidate => Boolean(item)),
  };
}

export function applyRerankAndBackfill(
  retrieved: CollectionSuggestionCandidate[],
  reranked: RerankedCollectionCandidate[],
  maxResults: number,
): CollectionSuggestionCandidate[] {
  const limit = Math.max(0, Math.floor(maxResults));
  if (limit === 0) return [];

  const byKey = new Map(
    retrieved.map((candidate) => [
      collectionSuggestionKey(candidate.entity_type, candidate.id),
      candidate,
    ]),
  );
  const used = new Set<string>();
  const output: CollectionSuggestionCandidate[] = [];

  for (const candidate of reranked) {
    const key = collectionSuggestionKey(candidate.entity_type, candidate.id);
    const retrievedCandidate = byKey.get(key);
    if (!retrievedCandidate || used.has(key)) continue;

    output.push({
      ...retrievedCandidate,
      reason: candidate.reason,
      score: candidate.score,
    });
    used.add(key);
    if (output.length >= limit) return output;
  }

  for (const candidate of retrieved) {
    const key = collectionSuggestionKey(candidate.entity_type, candidate.id);
    if (used.has(key)) continue;
    output.push(candidate);
    used.add(key);
    if (output.length >= limit) break;
  }

  return output;
}
