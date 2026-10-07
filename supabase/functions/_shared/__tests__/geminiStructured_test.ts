import { assert, assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert@^1.0.0";
import { callGeminiStructured } from "../gemini.ts";
import { isGeminiRateLimitError } from "../discoveredVerification.ts";

// Replaces fetch with per-model canned Gemini responses for the duration of `run`.
async function withGeminiResponses(
  statusByModel: Record<string, number>,
  run: () => Promise<void>,
): Promise<void> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    const model = url.match(/models\/([^:]+):generateContent/)?.[1] ?? "";
    const status = statusByModel[model] ?? 500;
    const body = status === 200
      ? JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] })
      : JSON.stringify({ error: { code: status, message: `models/${model} is not found for API version v1beta` } });
    return Promise.resolve(new Response(body, { status }));
  }) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

const callProfileVerification = () =>
  callGeminiStructured<{ ok: boolean }>({
    apiKey: "test-key",
    route: "profile_verification",
    systemPrompt: "system",
    userPrompt: "user",
    schema: { type: "OBJECT" },
    parse: (payload) => payload as { ok: boolean },
    attemptsPerModel: 1,
  });

Deno.test("callGeminiStructured: the final error lists every model tried with its HTTP status", async () => {
  await withGeminiResponses({
    "gemini-3.8-flash": 404,
    "gemini-3.7-flash": 404,
    "gemini-3.6-flash": 404,
    "gemini-3.1-pro-preview": 404,
    "gemini-2.5-pro": 429,
  }, async () => {
    const error = await assertRejects(callProfileVerification, Error);
    assert(error.message.startsWith("Gemini gemini-2.5-pro rate limited"), error.message);
    assertStringIncludes(
      error.message,
      "models tried: gemini-3.8-flash 404, gemini-3.7-flash 404, gemini-3.6-flash 404, gemini-3.1-pro-preview 404, gemini-2.5-pro 429",
    );
    // A rate limit on the last model still reads as transient for the verification queue.
    assert(isGeminiRateLimitError(error.message));
  });
});

Deno.test("callGeminiStructured: a 404 on the last model is not reported as a rate limit", async () => {
  await withGeminiResponses({
    "gemini-3.8-flash": 429,
    "gemini-3.7-flash": 404,
    "gemini-3.6-flash": 404,
    "gemini-3.1-pro-preview": 404,
    "gemini-2.5-pro": 404,
  }, async () => {
    const error = await assertRejects(callProfileVerification, Error);
    assert(error.message.startsWith("Gemini gemini-2.5-pro failed (404)"), error.message);
    assertStringIncludes(error.message, "models tried: gemini-3.8-flash 429, gemini-3.7-flash 404");
    assertEquals(isGeminiRateLimitError(error.message), false);
    assert(error.message.length < 600, `error message too long: ${error.message.length}`);
  });
});

Deno.test("callGeminiStructured: a success reports which model answered and what failed before it", async () => {
  await withGeminiResponses({
    "gemini-3.8-flash": 404,
    "gemini-3.7-flash": 200,
  }, async () => {
    const result = await callProfileVerification();
    assertEquals(result.data, { ok: true });
    assertEquals(result.modelUsed, "gemini-3.7-flash");
    assertEquals(result.modelAttempts, "gemini-3.8-flash 404, gemini-3.7-flash 200");
  });
});
