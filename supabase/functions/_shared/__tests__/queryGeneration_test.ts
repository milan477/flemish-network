import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@^1.0.0";
import { generateSearchQueries } from "../queryGeneration.ts";

type FetchHandler = (
  input: Request | URL | string,
  init?: RequestInit,
) => Promise<Response>;

async function withFetch<T>(handler: FetchHandler, fn: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = handler as typeof globalThis.fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

function geminiResponseBody(payload: unknown): string {
  return JSON.stringify({
    candidates: [
      {
        content: {
          parts: [{ text: JSON.stringify(payload) }],
        },
      },
    ],
  });
}

Deno.test("generateSearchQueries returns parsed Gemini queries", async () => {
  let captured: { url: string; body: string } | null = null;
  await withFetch(
    async (input, init) => {
      captured = {
        url: typeof input === "string" ? input : input.toString(),
        body: typeof init?.body === "string" ? init.body : "",
      };
      return new Response(
        geminiResponseBody({
          queries: [
            {
              query:
                '"KU Leuven" alumni (Belgian OR Flemish) "United States" site:linkedin.com/in',
              surface: "linkedin_profile",
              lens: "alumni_network",
              rationale: "us_based_alumni_linkedin",
            },
            {
              query:
                '"KU Leuven" "visiting professor" (Harvard OR MIT OR Stanford)',
              surface: "faculty_page",
              lens: "named_entity",
              rationale: "us_connected_abroad_visiting_prof",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
    async () => {
      const result = await generateSearchQueries(
        {
          intent: "biotech researcher Boston",
          surfaces: ["linkedin_profile", "faculty_page"],
          lenses: ["alumni_network"],
          context: { rotationSeed: "run-abc" },
          maxQueries: 4,
        },
        "test-api-key",
      );

      assertEquals(result.queries.length, 2);
      assertEquals(result.fallbackUsed, false);
      assertEquals(result.queries[0].surface, "linkedin_profile");
      assertEquals(result.queries[0].lens, "alumni_network");
      assertStringIncludes(result.queries[0].query, "KU Leuven");
    },
  );

  assert(captured !== null);
  assertStringIncludes(captured!.url, "generativelanguage.googleapis.com");
  assertStringIncludes(captured!.body, "ROTATION_SEED");
  assertStringIncludes(captured!.body, "biotech researcher Boston");
});

Deno.test("generateSearchQueries falls back when Gemini returns malformed payload", async () => {
  await withFetch(
    async () =>
      new Response(
        geminiResponseBody({ queries: "not-an-array" }),
        { status: 200 },
      ),
    async () => {
      const result = await generateSearchQueries(
        { intent: "Vlerick MBA finance" },
        "test-api-key",
      );
      assertEquals(result.fallbackUsed, true);
      assertEquals(result.queries.length, 1);
      assertStringIncludes(result.queries[0].query, "Vlerick MBA finance");
      assertStringIncludes(
        result.queries[0].query,
        '"from Ghent"',
      );
    },
  );
});

Deno.test("generateSearchQueries falls back on Gemini transport error", async () => {
  await withFetch(
    async () => {
      throw new Error("network down");
    },
    async () => {
      const result = await generateSearchQueries(
        { intent: "Belgian founders Boston" },
        "test-api-key",
      );
      assertEquals(result.fallbackUsed, true);
      assert(result.fallbackReason && result.fallbackReason.length > 0);
      assertEquals(result.queries.length, 1);
    },
  );
});

Deno.test("generateSearchQueries forwards avoidQueryShapes into the prompt", async () => {
  let body = "";
  await withFetch(
    async (_input, init) => {
      body = typeof init?.body === "string" ? init.body : "";
      return new Response(
        geminiResponseBody({
          queries: [
            {
              query: '("from Ghent") "United States" "data scientist"',
              surface: null,
              lens: "surface_phrase",
              rationale: "us_based_origin_surface",
            },
          ],
        }),
        { status: 200 },
      );
    },
    async () => {
      const result = await generateSearchQueries(
        {
          intent: "Flemish data scientists",
          context: {
            avoidQueryShapes: [
              '"<entity>" alumni United States',
              '"<entity>" team United States',
            ],
            knownEntities: ["KU Leuven"],
          },
        },
        "test-api-key",
      );
      assertEquals(result.queries.length, 1);
    },
  );

  assertStringIncludes(body, "AVOID_QUERY_SHAPES");
  assertStringIncludes(body, "team United States");
  assertStringIncludes(body, "KNOWN_ENTITIES");
});

Deno.test("generateSearchQueries dedupes case-insensitive duplicates", async () => {
  await withFetch(
    async () =>
      new Response(
        geminiResponseBody({
          queries: [
            { query: "Foo Bar", rationale: "a" },
            { query: "foo bar", rationale: "b" },
            { query: "Other", rationale: "c" },
          ],
        }),
        { status: 200 },
      ),
    async () => {
      const result = await generateSearchQueries(
        { intent: "smoke" },
        "test-api-key",
      );
      assertEquals(result.queries.length, 2);
      assertEquals(result.queries[0].query, "Foo Bar");
      assertEquals(result.queries[1].query, "Other");
    },
  );
});
