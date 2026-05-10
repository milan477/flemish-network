export type GeminiModelRoute =
  | "query_parsing"
  | "query_generation"
  | "page_classification"
  | "contact_extraction"
  | "profile_verification"
  | "lightweight_text_merge"
  | "offline_evaluation"
  | "search_rerank";

const FLASH_DEFAULT =
  Deno.env.get("GEMINI_FLASH_MODEL") || "gemini-2.5-flash";
const FLASH_LITE_DEFAULT =
  Deno.env.get("GEMINI_FLASH_LITE_MODEL") ||
  Deno.env.get("GEMINI_LITE_MODEL") || "gemini-2.5-flash-lite";
const PRO_DEFAULT =
  Deno.env.get("GEMINI_PRO_MODEL") || "gemini-2.5-pro";

function unique(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value))
    )
  );
}

export function getGeminiModelChain(route: GeminiModelRoute): string[] {
  switch (route) {
    case "query_parsing":
      return unique([
        Deno.env.get("GEMINI_QUERY_MODEL"),
        FLASH_LITE_DEFAULT,
        Deno.env.get("GEMINI_QUERY_FALLBACK_MODEL"),
        FLASH_DEFAULT,
      ]);
    case "query_generation":
      return unique([
        Deno.env.get("GEMINI_QUERY_GENERATION_MODEL"),
        FLASH_LITE_DEFAULT,
        Deno.env.get("GEMINI_QUERY_GENERATION_FALLBACK_MODEL"),
        FLASH_DEFAULT,
      ]);
    case "page_classification":
      return unique([
        Deno.env.get("GEMINI_CLASSIFICATION_MODEL"),
        FLASH_LITE_DEFAULT,
        Deno.env.get("GEMINI_CLASSIFICATION_FALLBACK_MODEL"),
        FLASH_DEFAULT,
      ]);
    case "contact_extraction":
      return unique([
        Deno.env.get("GEMINI_EXTRACTION_MODEL"),
        FLASH_DEFAULT,
        Deno.env.get("GEMINI_EXTRACTION_FALLBACK_MODEL"),
        FLASH_LITE_DEFAULT,
      ]);
    case "profile_verification":
      return unique([
        Deno.env.get("GEMINI_PROFILE_MODEL"),
        FLASH_DEFAULT,
        Deno.env.get("GEMINI_PROFILE_FALLBACK_MODEL"),
        PRO_DEFAULT,
      ]);
    case "lightweight_text_merge":
      return unique([
        Deno.env.get("GEMINI_MERGE_MODEL"),
        PRO_DEFAULT,
        Deno.env.get("GEMINI_MERGE_FALLBACK_MODEL"),
        FLASH_DEFAULT,
      ]);
    case "offline_evaluation":
      return unique([
        Deno.env.get("GEMINI_EVAL_MODEL"),
        PRO_DEFAULT,
        Deno.env.get("GEMINI_EVAL_FALLBACK_MODEL"),
        FLASH_DEFAULT,
      ]);
    case "search_rerank":
      // Owner decision (UX_REMEDIATION Phase 1A): default to gemini-2.5-flash.
      // Override via GEMINI_SEARCH_RERANK_MODEL (e.g. flash-lite if latency
      // becomes the dominant constraint at scale).
      return unique([
        Deno.env.get("GEMINI_SEARCH_RERANK_MODEL"),
        FLASH_DEFAULT,
        Deno.env.get("GEMINI_SEARCH_RERANK_FALLBACK_MODEL"),
        FLASH_LITE_DEFAULT,
      ]);
  }
}

export function getPrimaryGeminiModel(route: GeminiModelRoute): string {
  const [model] = getGeminiModelChain(route);
  if (!model) {
    throw new Error(`No Gemini model configured for route "${route}"`);
  }
  return model;
}

export function getGeminiModelSummary(): Record<GeminiModelRoute, string[]> {
  return {
    query_parsing: getGeminiModelChain("query_parsing"),
    query_generation: getGeminiModelChain("query_generation"),
    page_classification: getGeminiModelChain("page_classification"),
    contact_extraction: getGeminiModelChain("contact_extraction"),
    profile_verification: getGeminiModelChain("profile_verification"),
    lightweight_text_merge: getGeminiModelChain("lightweight_text_merge"),
    offline_evaluation: getGeminiModelChain("offline_evaluation"),
    search_rerank: getGeminiModelChain("search_rerank"),
  };
}

interface GeminiContextCacheOptions {
  apiKey: string;
  model: string;
  contentsText: string;
  displayName?: string;
  systemPrompt?: string;
  ttlSeconds?: number;
}

function buildGeminiGenerateContentUrl(model: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

function buildGeminiCacheUrl(name?: string): string {
  return name
    ? `https://generativelanguage.googleapis.com/v1beta/${name}`
    : "https://generativelanguage.googleapis.com/v1beta/cachedContents";
}

function buildCacheSystemInstruction(systemPrompt?: string) {
  const normalized = systemPrompt?.trim();
  if (!normalized) return undefined;
  return {
    parts: [{ text: normalized }],
  };
}

export async function createGeminiContextCache({
  apiKey,
  model,
  contentsText,
  displayName,
  systemPrompt,
  ttlSeconds = 900,
}: GeminiContextCacheOptions): Promise<string> {
  const response = await fetch(buildGeminiCacheUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      model: `models/${model}`,
      displayName: displayName?.trim() || undefined,
      contents: [{
        role: "user",
        parts: [{ text: contentsText }],
      }],
      systemInstruction: buildCacheSystemInstruction(systemPrompt),
      ttl: `${Math.max(60, Math.floor(ttlSeconds))}s`,
    }),
  });

  if (!response.ok) {
    throw new Error(`Gemini context cache failed (${response.status}): ${await response.text()}`);
  }

  const payload = await response.json();
  const cacheName = typeof payload?.name === "string" ? payload.name : "";

  if (!cacheName) {
    throw new Error("Gemini context cache did not return a cache name");
  }

  return cacheName;
}

export async function deleteGeminiContextCache(
  apiKey: string,
  cacheName: string,
): Promise<void> {
  const normalized = cacheName.trim();
  if (!normalized) return;

  const response = await fetch(buildGeminiCacheUrl(normalized), {
    method: "DELETE",
    headers: {
      "x-goog-api-key": apiKey,
    },
  });

  if (!response.ok && response.status !== 404) {
    throw new Error(`Failed to delete Gemini cache ${normalized}: ${await response.text()}`);
  }
}

interface StructuredGeminiCallOptions<T> {
  apiKey: string;
  route: GeminiModelRoute;
  systemPrompt: string;
  userPrompt: string;
  schema: Record<string, unknown>;
  parse: (payload: unknown) => T;
  temperature?: number;
  attemptsPerModel?: number;
  emptyResponseFallback?: T;
  cachedContentName?: string;
  /**
   * Optional thinking budget passed through to the Gemini 2.5 thinking config.
   * Set to `0` to disable extended thinking entirely (useful for latency-bound
   * paths like search rerank where reasoning depth doesn't move the needle).
   */
  thinkingBudget?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function callGeminiStructured<T>({
  apiKey,
  route,
  systemPrompt,
  userPrompt,
  schema,
  parse,
  temperature = 0.3,
  attemptsPerModel = 2,
  emptyResponseFallback,
  cachedContentName,
  thinkingBudget,
}: StructuredGeminiCallOptions<T>): Promise<{ data: T; modelUsed: string }> {
  const models = getGeminiModelChain(route);
  let lastError = `No Gemini models configured for route "${route}"`;

  for (const model of models) {
    for (let attempt = 0; attempt < attemptsPerModel; attempt += 1) {
      try {
        const response = await fetch(
          buildGeminiGenerateContentUrl(model),
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": apiKey,
            },
            body: JSON.stringify(
              cachedContentName
                ? {
                  contents: [{ role: "user", parts: [{ text: userPrompt }] }],
                  cachedContent: cachedContentName,
                  generation_config: {
                    response_mime_type: "application/json",
                    response_schema: schema,
                    temperature,
                    ...(thinkingBudget !== undefined
                      ? { thinking_config: { thinking_budget: thinkingBudget } }
                      : {}),
                  },
                }
                : {
                  system_instruction: {
                    parts: [{ text: systemPrompt }],
                  },
                  contents: [{ role: "user", parts: [{ text: userPrompt }] }],
                  generation_config: {
                    response_mime_type: "application/json",
                    response_schema: schema,
                    temperature,
                    ...(thinkingBudget !== undefined
                      ? { thinking_config: { thinking_budget: thinkingBudget } }
                      : {}),
                  },
                },
            ),
          }
        );

        if (response.status === 429) {
          lastError = `Gemini ${model} rate limited`;
          await sleep(model.includes("lite") ? 1500 : 1000);
          continue;
        }

        if (!response.ok) {
          lastError = `Gemini ${model} failed (${response.status}): ${await response.text()}`;
          break;
        }

        const payload = await response.json();
        const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!text) {
          if (emptyResponseFallback !== undefined) {
            return { data: emptyResponseFallback, modelUsed: model };
          }
          lastError = `Gemini ${model} returned empty structured output`;
          break;
        }

        const parsed = parse(JSON.parse(text));
        return { data: parsed, modelUsed: model };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        if (attempt < attemptsPerModel - 1) {
          await sleep(500);
        }
      }
    }
  }

  throw new Error(lastError);
}
