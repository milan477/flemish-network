// Stage 2 reranker for search-people. Sends the original query plus the top
// candidate blobs to Gemini and asks for a ranked list of {id, kind, reason}.
// Designed to fail open: if the model errors or runs over budget, the caller
// keeps the Stage 1 hybrid order and tags rerank_status accordingly.

import { callGeminiStructured } from "../_shared/gemini.ts";

export type RerankStatus = "ok" | "skipped" | "error" | "timeout";

export interface RerankBlobCandidate {
  id: string;
  kind: "person" | "organization";
  blob: string;
}

export interface RerankResultItem {
  id: string;
  kind: "person" | "organization";
  reason: string;
}

export interface RerankOutcome {
  status: RerankStatus;
  ranked: RerankResultItem[];
  model: string | null;
  error?: string;
  duration_ms?: number;
}

// Generous timeout: Gemini 2.5 flash structured output for ~50 candidates can
// take 2-4s on cold paths. Past 12s the user is staring at a spinner — better
// to fall back to Stage 1 ordering. The plan documents the rerank as
// best-effort.
const RERANK_TIMEOUT_MS = 12000;
const MAX_BLOB_CHARS = 400;
const MAX_CANDIDATES = 30;

function clipBlob(blob: string): string {
  const trimmed = blob.replace(/\s+/g, " ").trim();
  if (trimmed.length <= MAX_BLOB_CHARS) return trimmed;
  return `${trimmed.slice(0, MAX_BLOB_CHARS - 3)}...`;
}

function parseRanked(
  payload: unknown,
  validIds: Set<string>,
): RerankResultItem[] {
  if (!payload || typeof payload !== "object") {
    throw new Error("rerank payload not an object");
  }
  const ranked = (payload as { ranked?: unknown }).ranked;
  if (!Array.isArray(ranked)) {
    throw new Error("rerank payload missing 'ranked' array");
  }
  const seen = new Set<string>();
  const result: RerankResultItem[] = [];
  for (const entry of ranked) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    const id = typeof item.id === "string" ? item.id.trim() : "";
    const kindRaw = typeof item.kind === "string" ? item.kind.trim() : "";
    const reason = typeof item.reason === "string" ? item.reason.trim() : "";
    if (!id || (kindRaw !== "person" && kindRaw !== "organization")) continue;
    if (!validIds.has(id) || seen.has(id)) continue;
    seen.add(id);
    result.push({ id, kind: kindRaw, reason });
  }
  return result;
}

export async function rerankSearchCandidates(
  apiKey: string,
  query: string,
  candidates: RerankBlobCandidate[],
): Promise<RerankOutcome> {
  if (!apiKey || candidates.length === 0) {
    return { status: "skipped", ranked: [], model: null };
  }

  const limited = candidates.slice(0, MAX_CANDIDATES);
  const validIds = new Set(limited.map((c) => c.id));
  const candidateLines = limited
    .map((c) =>
      `- KIND: ${c.kind} | ID: ${c.id} | BLOB: ${clipBlob(c.blob)}`
    )
    .join("\n");

  const userPrompt = `User query: "${query.replace(/"/g, "'")}"

Candidates (re-rank by best match to the user's intent — respect any explicit constraints in the query like city, state, sector, or organization):
${candidateLines}

Return only the IDs from the candidate list above. Drop candidates that clearly don't match. Order best matches first.`;

  const systemPrompt =
    "You re-rank a list of person and organization profile blobs against a user's natural-language search query for a Flemish-Belgian professional network in the United States. Respect explicit constraints in the query (especially city, state, sector). Never invent IDs — only return IDs present in the supplied candidate list. Return at most 30 ranked items, best first, each with a short one-line reason.";

  const startedAt = performance.now();
  const timer = new Promise<RerankOutcome>((resolve) => {
    setTimeout(
      () =>
        resolve({
          status: "timeout",
          ranked: [],
          model: null,
          duration_ms: RERANK_TIMEOUT_MS,
        }),
      RERANK_TIMEOUT_MS,
    );
  });

  try {
    const work = (async (): Promise<RerankOutcome> => {
      const { data, modelUsed } = await callGeminiStructured({
        apiKey,
        route: "search_rerank",
        systemPrompt,
        userPrompt,
        schema: {
          type: "OBJECT",
          properties: {
            ranked: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  id: { type: "STRING" },
                  kind: { type: "STRING", enum: ["person", "organization"] },
                  reason: { type: "STRING" },
                },
                required: ["id", "kind", "reason"],
              },
            },
          },
          required: ["ranked"],
        },
        parse: (payload: unknown) => parseRanked(payload, validIds),
        temperature: 0.1,
        attemptsPerModel: 1,
        // Disable extended thinking — this is a deterministic blob-ranking
        // task; thinking dominates latency without improving quality and
        // pushes the call past our 12 s budget.
        thinkingBudget: 0,
      });
      return {
        status: "ok",
        ranked: data,
        model: modelUsed,
        duration_ms: Math.round(performance.now() - startedAt),
      };
    })();

    return await Promise.race([work, timer]);
  } catch (err) {
    return {
      status: "error",
      ranked: [],
      model: null,
      error: err instanceof Error ? err.message : String(err),
      duration_ms: Math.round(performance.now() - startedAt),
    };
  }
}
