export type GeminiModelRoute =
  | "query_parsing"
  | "contact_extraction"
  | "profile_verification"
  | "lightweight_text_merge";

const LEGACY_FLASH_DEFAULT =
  Deno.env.get("GEMINI_FLASH_MODEL") || "gemini-3-flash-preview";
const LEGACY_LITE_DEFAULT =
  Deno.env.get("GEMINI_LITE_MODEL") || "gemini-2.5-flash-lite";

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
        LEGACY_FLASH_DEFAULT,
        Deno.env.get("GEMINI_QUERY_FALLBACK_MODEL"),
        LEGACY_LITE_DEFAULT,
      ]);
    case "contact_extraction":
      return unique([
        Deno.env.get("GEMINI_EXTRACTION_MODEL"),
        LEGACY_FLASH_DEFAULT,
        Deno.env.get("GEMINI_EXTRACTION_FALLBACK_MODEL"),
        LEGACY_LITE_DEFAULT,
      ]);
    case "profile_verification":
      return unique([
        Deno.env.get("GEMINI_PROFILE_MODEL"),
        LEGACY_FLASH_DEFAULT,
        Deno.env.get("GEMINI_PROFILE_FALLBACK_MODEL"),
        LEGACY_LITE_DEFAULT,
      ]);
    case "lightweight_text_merge":
      return unique([
        Deno.env.get("GEMINI_MERGE_MODEL"),
        LEGACY_LITE_DEFAULT,
        Deno.env.get("GEMINI_MERGE_FALLBACK_MODEL"),
        LEGACY_FLASH_DEFAULT,
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
}: StructuredGeminiCallOptions<T>): Promise<{ data: T; modelUsed: string }> {
  const models = getGeminiModelChain(route);
  let lastError = `No Gemini models configured for route "${route}"`;

  for (const model of models) {
    for (let attempt = 0; attempt < attemptsPerModel; attempt += 1) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": apiKey,
            },
            body: JSON.stringify({
              system_instruction: {
                parts: [{ text: systemPrompt }],
              },
              contents: [{ role: "user", parts: [{ text: userPrompt }] }],
              generation_config: {
                response_mime_type: "application/json",
                response_schema: schema,
                temperature,
              },
            }),
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
