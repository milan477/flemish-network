import { assertEquals } from "jsr:@std/assert@^1.0.0";
import {
  getFieldRisk,
  insertVerificationSuggestions,
  type VerificationSuggestion,
} from "../verification.ts";
import type { SupabaseAdminClient } from "../database.types.ts";

// ---------------------------------------------------------------------------
// Minimal SupabaseAdminClient mock
//
// Handles these three chain shapes used by insertVerificationSuggestions:
//   from(t).select(cols).eq().eq().eq()          → Promise<{data, error}>
//   from(t).insert(rows).select(cols)             → Promise<{data, error}>
//   from(t).update(data).eq(col, id)              → Promise<{error}>
// ---------------------------------------------------------------------------

interface ExistingRow {
  id: string;
  dedupe_key: string;
  confidence: number;
  evidence_url: string;
  evidence_excerpt: string;
}

function makeReadChain(
  resolveValue: { data: unknown; error: null },
): Record<string, unknown> {
  const chain: Record<string, unknown> = {};
  const chainMethods = ["eq", "select", "in", "not", "gte", "order", "limit", "neq", "is"];
  for (const m of chainMethods) {
    chain[m] = () => chain;
  }
  chain.then = (
    resolve: (v: unknown) => unknown,
    reject?: (e: unknown) => unknown,
  ) => Promise.resolve(resolveValue).then(resolve, reject);
  chain.catch = (reject: (e: unknown) => unknown) =>
    Promise.resolve(resolveValue).catch(reject);
  chain.finally = (fn: () => void) =>
    Promise.resolve(resolveValue).finally(fn);
  Object.defineProperty(chain, Symbol.toStringTag, { value: "Promise" });
  return chain;
}

function makeMockClient(opts: { existingRows?: ExistingRow[] } = {}): {
  client: SupabaseAdminClient;
  capturedInserts: unknown[][];
  capturedUpdates: Array<{ id: string; data: unknown }>;
} {
  const capturedInserts: unknown[][] = [];
  const capturedUpdates: Array<{ id: string; data: unknown }> = [];

  const client = {
    from(_table: string) {
      return {
        select(_cols: string) {
          return makeReadChain({ data: opts.existingRows ?? [], error: null });
        },
        insert(rows: unknown[]) {
          capturedInserts.push(rows);
          return {
            select(_cols: string) {
              return Promise.resolve({
                data: (rows as unknown[]).map((_r, i) => ({ id: `mock-${i}` })),
                error: null,
              });
            },
          };
        },
        update(data: unknown) {
          return {
            eq(_col: string, id: string) {
              capturedUpdates.push({ id, data });
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  } as unknown as SupabaseAdminClient;

  return { client, capturedInserts, capturedUpdates };
}

function makeSuggestion(
  overrides: Partial<VerificationSuggestion> = {},
): VerificationSuggestion {
  return {
    field_name: "type",
    current_value: "Company",
    suggested_value: "University",
    source: "Web search",
    evidence_url: "https://example.com",
    evidence_excerpt: "Their official site confirms they are a university.",
    confidence: 0.8,
    method: "web_search_llm",
    dedupe_key: "type::university",
    risk_level: "low",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// getFieldRisk
// ---------------------------------------------------------------------------

Deno.test("getFieldRisk: bio, description, and _status are high-risk", () => {
  assertEquals(getFieldRisk("bio"), "high");
  assertEquals(getFieldRisk("description"), "high");
  assertEquals(getFieldRisk("_status"), "high");
});

Deno.test("getFieldRisk: name, website_url, and current_position are medium-risk", () => {
  assertEquals(getFieldRisk("name"), "medium");
  assertEquals(getFieldRisk("website_url"), "medium");
  assertEquals(getFieldRisk("current_position"), "medium");
  assertEquals(getFieldRisk("email"), "medium");
});

Deno.test("getFieldRisk: type, location_city, location_state, and profile_photo_url are low-risk", () => {
  assertEquals(getFieldRisk("type"), "low");
  assertEquals(getFieldRisk("location_city"), "low");
  assertEquals(getFieldRisk("location_state"), "low");
  assertEquals(getFieldRisk("profile_photo_url"), "low");
});

// ---------------------------------------------------------------------------
// insertVerificationSuggestions – person durable path
// ---------------------------------------------------------------------------

Deno.test("durable mode: inserts new person suggestion with pending status and evidence fields", async () => {
  const { client, capturedInserts } = makeMockClient();
  const suggestion = makeSuggestion({
    field_name: "current_position",
    current_value: "Engineer",
    suggested_value: "Professor at MIT",
    dedupe_key: "current_position::professor at mit",
    risk_level: "medium",
    evidence_url: "https://mit.edu/faculty",
    evidence_excerpt: "Listed as Professor in the MIT faculty directory.",
    confidence: 0.88,
  });

  const result = await insertVerificationSuggestions(
    client,
    { recordType: "person", recordId: "person-uuid-1" },
    [suggestion],
    { agentRunId: "run-abc" },
  );

  assertEquals(result.inserted, 1);
  assertEquals(result.duplicatesSkipped, 0);
  assertEquals(capturedInserts.length, 1);

  const row = (capturedInserts[0] as Array<Record<string, unknown>>)[0];
  assertEquals(row.record_type, "person");
  assertEquals(row.person_id, "person-uuid-1");
  assertEquals(row.organization_id, null);
  assertEquals(row.status, "pending");
  assertEquals(row.field_name, "current_position");
  assertEquals(row.suggested_value, "Professor at MIT");
  assertEquals(row.agent_run_id, "run-abc");
  assertEquals(typeof row.evidence_url, "string");
  assertEquals(typeof row.evidence_excerpt, "string");
});

// ---------------------------------------------------------------------------
// insertVerificationSuggestions – organization durable path
// ---------------------------------------------------------------------------

Deno.test("durable mode: inserts new organization suggestion with pending status and evidence fields", async () => {
  const { client, capturedInserts } = makeMockClient();
  const suggestion = makeSuggestion({
    field_name: "website_url",
    current_value: "",
    suggested_value: "https://example-org.com",
    dedupe_key: "website_url::example-orgcom",
    risk_level: "medium",
    evidence_url: "https://example-org.com",
    evidence_excerpt: "Official website confirmed via web search.",
    confidence: 0.85,
  });

  const result = await insertVerificationSuggestions(
    client,
    { recordType: "organization", recordId: "org-uuid-1" },
    [suggestion],
  );

  assertEquals(result.inserted, 1);
  assertEquals(capturedInserts.length, 1);

  const row = (capturedInserts[0] as Array<Record<string, unknown>>)[0];
  assertEquals(row.record_type, "organization");
  assertEquals(row.organization_id, "org-uuid-1");
  assertEquals(row.person_id, null);
  assertEquals(row.status, "pending");
  assertEquals(row.field_name, "website_url");
});

// ---------------------------------------------------------------------------
// High-risk suggestions remain pending
// ---------------------------------------------------------------------------

Deno.test("high-risk fields are always inserted with pending status awaiting staff review", async () => {
  const { client, capturedInserts } = makeMockClient();
  const highRiskSuggestion = makeSuggestion({
    field_name: "description",
    current_value: "",
    suggested_value: "A leading research organization based in Brussels.",
    dedupe_key: "description::a leading research organization based in brussels",
    risk_level: "high",
    confidence: 0.9,
    evidence_url: "https://example.com/about",
    evidence_excerpt: "The organization's about page describes them as a leading research group.",
  });

  const result = await insertVerificationSuggestions(
    client,
    { recordType: "organization", recordId: "org-uuid-2" },
    [highRiskSuggestion],
  );

  assertEquals(result.inserted, 1);
  const row = (capturedInserts[0] as Array<Record<string, unknown>>)[0];
  assertEquals(row.status, "pending");
  assertEquals(row.field_name, "description");
});

Deno.test("high-risk bio suggestion is inserted with pending status awaiting staff review", async () => {
  const { client, capturedInserts } = makeMockClient();
  const bioSuggestion = makeSuggestion({
    field_name: "bio",
    current_value: "",
    suggested_value: "Dr. Arend is a professor of computer science specializing in AI at MIT with over 20 years of experience.",
    dedupe_key: "bio::dr arend is a professor",
    risk_level: "high",
    confidence: 0.92,
    evidence_url: "https://mit.edu/people/arend",
    evidence_excerpt: "Dr. Arend is a professor of computer science specializing in AI at MIT.",
  });

  const result = await insertVerificationSuggestions(
    client,
    { recordType: "person", recordId: "person-uuid-2" },
    [bioSuggestion],
  );

  assertEquals(result.inserted, 1);
  const row = (capturedInserts[0] as Array<Record<string, unknown>>)[0];
  assertEquals(row.status, "pending");
  assertEquals(row.field_name, "bio");
});

// ---------------------------------------------------------------------------
// Suggestion deduplication
// ---------------------------------------------------------------------------

Deno.test("dedupe: skips suggestion whose dedupe_key already exists with equal or higher confidence", async () => {
  const existingRows: ExistingRow[] = [
    {
      id: "existing-suggestion-1",
      dedupe_key: "type::university",
      confidence: 0.85,
      evidence_url: "https://existing-source.com",
      evidence_excerpt: "Existing evidence excerpt.",
    },
  ];
  const { client, capturedInserts } = makeMockClient({ existingRows });

  const suggestion = makeSuggestion({
    dedupe_key: "type::university",
    confidence: 0.75,
  });

  const result = await insertVerificationSuggestions(
    client,
    { recordType: "organization", recordId: "org-uuid-3" },
    [suggestion],
  );

  assertEquals(result.inserted, 0);
  assertEquals(result.duplicatesSkipped, 1);
  assertEquals(capturedInserts.length, 0);
});

Deno.test("dedupe: updates existing suggestion when incoming has higher confidence", async () => {
  const existingRows: ExistingRow[] = [
    {
      id: "existing-id-1",
      dedupe_key: "type::university",
      confidence: 0.6,
      evidence_url: "",
      evidence_excerpt: "",
    },
  ];
  const { client, capturedInserts, capturedUpdates } = makeMockClient({ existingRows });

  const suggestion = makeSuggestion({
    dedupe_key: "type::university",
    confidence: 0.9,
    evidence_url: "https://new-source.com",
    evidence_excerpt: "Better evidence from a more authoritative source.",
  });

  const result = await insertVerificationSuggestions(
    client,
    { recordType: "organization", recordId: "org-uuid-4" },
    [suggestion],
  );

  assertEquals(result.inserted, 0);
  assertEquals(result.duplicatesSkipped, 1);
  assertEquals(result.updated, 1);
  assertEquals(capturedInserts.length, 0);
  assertEquals(capturedUpdates.length, 1);
  assertEquals(capturedUpdates[0].id, "existing-id-1");
});

Deno.test("dedupe: inserts suggestion when dedupe_key differs from existing", async () => {
  const existingRows: ExistingRow[] = [
    {
      id: "existing-id-2",
      dedupe_key: "type::company",
      confidence: 0.9,
      evidence_url: "https://source.com",
      evidence_excerpt: "Existing evidence.",
    },
  ];
  const { client, capturedInserts } = makeMockClient({ existingRows });

  const suggestion = makeSuggestion({
    suggested_value: "University",
    dedupe_key: "type::university",
    confidence: 0.82,
  });

  const result = await insertVerificationSuggestions(
    client,
    { recordType: "organization", recordId: "org-uuid-5" },
    [suggestion],
  );

  assertEquals(result.inserted, 1);
  assertEquals(result.duplicatesSkipped, 0);
  assertEquals(capturedInserts.length, 1);
});

// ---------------------------------------------------------------------------
// Preview mode contract
//
// In preview mode, agent-verify calls runVerificationForOrganization /
// runVerificationForPerson but never reaches insertVerificationSuggestions,
// markOrganizationVerified, markPersonVerified, or any agent_runs update.
// This test verifies insertVerificationSuggestions with an empty suggestions
// list (the contract for the preview code path) produces zero writes.
// ---------------------------------------------------------------------------

Deno.test("preview mode: calling insertVerificationSuggestions with empty suggestions produces no DB writes", async () => {
  const { client, capturedInserts, capturedUpdates } = makeMockClient();

  const result = await insertVerificationSuggestions(
    client,
    { recordType: "organization", recordId: "org-uuid-preview" },
    [],
  );

  assertEquals(result.inserted, 0);
  assertEquals(result.updated, 0);
  assertEquals(result.duplicatesSkipped, 0);
  assertEquals(capturedInserts.length, 0);
  assertEquals(capturedUpdates.length, 0);
});

Deno.test("preview mode: calling insertVerificationSuggestions with empty suggestions produces no DB writes (person)", async () => {
  const { client, capturedInserts, capturedUpdates } = makeMockClient();

  const result = await insertVerificationSuggestions(
    client,
    { recordType: "person", recordId: "person-uuid-preview" },
    [],
  );

  assertEquals(result.inserted, 0);
  assertEquals(result.updated, 0);
  assertEquals(result.duplicatesSkipped, 0);
  assertEquals(capturedInserts.length, 0);
  assertEquals(capturedUpdates.length, 0);
});
