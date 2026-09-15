import { assertEquals, assertStringIncludes } from "jsr:@std/assert@^1.0.0";
import type { SupabaseAdminClient } from "../database.types.ts";
import {
  appendCanonicalFlemishConnections,
  loadFlemishConnectionCatalogPrompt,
  resolveModelFlemishFactCandidates,
} from "../flemishConnectionCatalog.ts";

function candidate(canonicalName: string, alias = canonicalName) {
  return {
    canonical_name: canonicalName,
    candidate_alias: alias,
    role: "alumnus",
    source_url: "https://example.com",
    evidence_excerpt: `${alias} alumnus`,
    confidence: 0.91,
    raw_evidence: `${alias} alumnus`,
  };
}

Deno.test("catalog prompt exposes canonical names and approved aliases", async () => {
  const chain = {
    select() {
      return this;
    },
    async order() {
      return {
        data: [{
          id: "fc-1",
          name: "UGent",
          entity_type: "university",
          is_filterable: true,
          flemish_connection_aliases: [
            { alias: "Ghent University", status: "approved" },
            { alias: "Universiteit Gent", status: "pending" },
          ],
        }],
        error: null,
      };
    },
  };
  const supabase = { from: () => chain } as unknown as SupabaseAdminClient;
  const prompt = await loadFlemishConnectionCatalogPrompt(supabase);

  assertStringIncludes(prompt, "UGent [university]");
  assertStringIncludes(prompt, "approved aliases: Ghent University");
  assertEquals(prompt.includes("Universiteit Gent"), false);
});

Deno.test("resolver reuses an existing canonical connection selected by alias", async () => {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const supabase = {
    async rpc(fn: string, args: Record<string, unknown>) {
      calls.push({ fn, args });
      if (
        fn === "lookup_flemish_connection" &&
        args.p_name_or_alias === "University of Ghent"
      ) {
        return { data: [], error: null };
      }
      if (fn === "lookup_flemish_connection") {
        return {
          data: [{ id: "fc-1", name: "UGent", entity_type: "university" }],
          error: null,
        };
      }
      return { data: "alias-1", error: null };
    },
  } as unknown as SupabaseAdminClient;

  const result = await resolveModelFlemishFactCandidates(
    supabase,
    [candidate("University of Ghent", "Ghent University")],
  );

  assertEquals(result[0].canonical_name, "UGent");
  assertEquals(
    calls.some((call) => call.fn === "ensure_flemish_connection"),
    false,
  );
  assertEquals(
    calls.some((call) => call.fn === "add_flemish_connection_alias"),
    false,
    "an approved alias must not be downgraded to pending",
  );
});

Deno.test("resolver creates an unknown canonical connection as non-filterable", async () => {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const supabase = {
    async rpc(fn: string, args: Record<string, unknown>) {
      calls.push({ fn, args });
      if (fn === "lookup_flemish_connection") return { data: [], error: null };
      if (fn === "ensure_flemish_connection") {
        return { data: "fc-new", error: null };
      }
      return { data: "alias-new", error: null };
    },
  } as unknown as SupabaseAdminClient;

  const result = await resolveModelFlemishFactCandidates(
    supabase,
    [candidate("HOGENT", "HOGENT University of Applied Sciences")],
  );

  assertEquals(result[0].canonical_name, "HOGENT");
  const ensureCall = calls.find((call) =>
    call.fn === "ensure_flemish_connection"
  );
  assertEquals(ensureCall?.args.p_is_filterable, false);
  assertEquals(ensureCall?.args.p_connection_group, "model_discovery");
});

Deno.test("canonical names are retained alongside raw evidence for later searchable linking", () => {
  assertEquals(
    appendCanonicalFlemishConnections(
      "HOGENT alumnus",
      [candidate("HOGENT", "HOGENT University of Applied Sciences")],
    ),
    "HOGENT alumnus",
  );
  assertEquals(
    appendCanonicalFlemishConnections("Belgian education", [
      candidate("HOGENT"),
    ]),
    "Belgian education; HOGENT",
  );
  assertEquals(
    appendCanonicalFlemishConnections("Benefit program", [candidate("FIT")]),
    "Benefit program; FIT",
  );
});
