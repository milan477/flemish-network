import { assertEquals, assert } from "jsr:@std/assert@^1.0.0";
import {
  buildDiscoveryDerivedLabels,
  buildVerificationDerivedLabels,
  getLocationLabelSummary,
  getLocationReviewRequired,
  getNormalizedLabelValue,
  normalizeLabelMetadata,
  upsertDerivedLabelSuggestions,
} from "../derivedLabels.ts";
import type { SupabaseAdminClient } from "../database.types.ts";
import { isRecordDataError } from "../discoveryPersistence.ts";

// Stub supabase admin client: only `from("locations").select(...).ilike(...).eq(...).limit(...).maybeSingle()`
// is reached, and only when there is a US-candidate location to lookup.
function stubSupabase(): SupabaseAdminClient {
  let city = "";
  let state = "";
  const chain = {
    select() { return this; },
    ilike(_column: string, value: string) { city = value; return this; },
    eq(_column: string, value: string) { state = value; return this; },
    limit() { return this; },
    async maybeSingle() {
      if (city === "Boston" && state === "MA") {
        return {
          data: { id: "boston-ma", city, state, latitude: 42.36, longitude: -71.06 },
          error: null,
        };
      }
      return { data: null, error: null };
    },
  };
  return {
    from: () => chain,
  } as unknown as SupabaseAdminClient;
}

Deno.test("buildDiscoveryDerivedLabels: dedupes sector seeds + clamps confidence", async () => {
  const supabase = stubSupabase();
  const seeds = await buildDiscoveryDerivedLabels(supabase, {
    discoveredContactId: "dc-1",
    agentRunId: "run-1",
    source: "linkedin",
    currentPosition: "Machine learning research scientist",
    occupation: "Academic/Researcher",
    bio: "Research in AI and machine learning at MIT",
    locationCity: "Boston",
    locationState: "MA",
    rawLocationText: "Boston, MA",
    flemishConnection: "KU Leuven alumnus",
    sectors: ["Artificial Intelligence"],
    evidence: [
      {
        pageUrl: "https://example.com",
        pageType: "person_profile",
        evidenceExcerpt: "Excerpt",
        rawLocationText: "Boston, MA",
        rawFlemishText: "KU Leuven",
        extractionConfidence: 0.9,
      },
    ],
  });

  // Confidence always clamped to [0,1]
  for (const seed of seeds) {
    assert(seed.confidence >= 0 && seed.confidence <= 1);
  }
  // Every seed carries a non-empty dedupe_key (including us_location seeds since 6.3 fix)
  for (const seed of seeds) {
    assert(seed.dedupe_key.length > 0, `seed missing dedupe_key: ${seed.label_type}`);
  }

  // Sector seed for AI exists, only one (explicit + inferred merged)
  const aiSeeds = seeds.filter(
    (s) => s.label_type === "sector" && s.label_value === "Artificial Intelligence"
  );
  assertEquals(aiSeeds.length, 1);

  // Flemish entity for KU Leuven exists
  assert(
    seeds.some(
      (s) => s.label_type === "flemish_entity" && s.label_value === "KU Leuven"
    )
  );

  // Source quality is "high" because of linkedin source
  const sq = seeds.find((s) => s.label_type === "source_quality");
  assertEquals(sq?.label_value, "high");

  // Location seed present and US
  const loc = seeds.find((s) => s.label_type === "us_location");
  assert(loc);
  assertEquals(loc?.label_value, "Boston, MA");
});

Deno.test("buildDiscoveryDerivedLabels: explicit Flemish text canonicalizes variants", async () => {
  const supabase = stubSupabase();
  const seeds = await buildDiscoveryDerivedLabels(supabase, {
    discoveredContactId: "dc-2",
    source: "web",
    currentPosition: "",
    occupation: "",
    bio: "Studied at Katholieke Universiteit Leuven and Ghent University",
    locationCity: "",
    locationState: "",
    rawLocationText: "",
    flemishConnection: "",
    sectors: [],
    evidence: [],
  });

  const fl = seeds
    .filter((s) => s.label_type === "flemish_entity")
    .map((s) => s.label_value)
    .sort();
  assertEquals(fl, ["KU Leuven", "UGent"]);
});

Deno.test("buildVerificationDerivedLabels: linkedin_scrape method → high source quality", async () => {
  const supabase = stubSupabase();
  const seeds = await buildVerificationDerivedLabels(supabase, {
    personId: "p-1",
    source: "agent-verify",
    currentPosition: "Postdoc researcher",
    occupation: "",
    bio: "Postdoc at Boston University",
    locationCity: "Boston",
    locationState: "MA",
    rawLocationText: "Boston, MA",
    flemishTexts: ["BAEF fellow"],
    evidenceUrl: "https://example.com",
    evidenceExcerpt: "x",
    method: "linkedin_scrape",
  });

  const sq = seeds.find((s) => s.label_type === "source_quality");
  assertEquals(sq?.label_value, "high");
  assertEquals(sq?.confidence, 0.95);

  // Occupation inferred from "postdoc" keyword
  const occ = seeds.find((s) => s.label_type === "occupation");
  assertEquals(occ?.label_value, "Academic/Researcher");

  // BAEF flemish entity present
  assert(seeds.some((s) => s.label_type === "flemish_entity" && s.label_value === "BAEF"));
});

Deno.test("buildVerificationDerivedLabels: rejects nonexistent US city/state pairs", async () => {
  const seeds = await buildVerificationDerivedLabels(stubSupabase(), {
    personId: "p-2",
    source: "Web verification",
    currentPosition: "Producer",
    occupation: "Professional",
    bio: "Belgian producer who studied in Brussels and Los Angeles.",
    locationCity: "Brussels",
    locationState: "CA",
    rawLocationText: "RITCS in Brussels and USC in Los Angeles",
    flemishTexts: ["Fayat Scholarship"],
    evidenceUrl: "https://example.com/victor",
    evidenceExcerpt: "Studied at RITCS in Brussels and USC in Los Angeles.",
    method: "web_search_llm",
    suggestionConfidence: 0.94,
  });

  assertEquals(seeds.some((seed) => seed.label_type === "us_location"), false);
});

Deno.test("getLocationLabelSummary / getLocationReviewRequired / normalizeLabelMetadata", () => {
  assertEquals(
    getLocationLabelSummary({
      parsed_city: "Boston",
      parsed_state: "MA",
      raw_location_text: "Boston, MA",
    }),
    "Boston, MA"
  );
  assertEquals(getLocationReviewRequired({ review_required: false }), false);
  assertEquals(getLocationReviewRequired(null), true);
  assertEquals(normalizeLabelMetadata(null), {});
  assertEquals(getNormalizedLabelValue("  Boston  MA "), "boston ma");
});

// Stub for `from("derived_label_suggestions").upsert(rows, { onConflict }).select("id")`
// that behaves like Postgres INSERT ... ON CONFLICT DO UPDATE: a batch that hits the
// same conflict key twice fails with SQLSTATE 21000.
function recordingUpsertSupabase(): {
  client: SupabaseAdminClient;
  upserts: Array<Array<Record<string, unknown>>>;
} {
  const upserts: Array<Array<Record<string, unknown>>> = [];
  const client = {
    from(table: string) {
      if (table !== "derived_label_suggestions") {
        throw new Error(`unexpected table ${table}`);
      }
      return {
        upsert(rows: Array<Record<string, unknown>>, options: { onConflict: string }) {
          upserts.push(rows);
          const keys = rows.map((row) => String(row[options.onConflict]));
          const duplicate = keys.length !== new Set(keys).size;
          return {
            select() {
              return Promise.resolve(
                duplicate
                  ? {
                    data: null,
                    error: {
                      code: "21000",
                      message: "ON CONFLICT DO UPDATE command cannot affect row a second time",
                    },
                  }
                  : { data: rows.map((_, index) => ({ id: `label-${index}` })), error: null },
              );
            },
          };
        },
      };
    },
  } as unknown as SupabaseAdminClient;
  return { client, upserts };
}

Deno.test("upsertDerivedLabelSuggestions: a Flemish entity found by both text inference and a catalog fact candidate upserts once", async () => {
  // A frontier contact whose flemish_connection text and LLM fact candidate both name KU Leuven,
  // with the fact candidate duplicated by mergeContacts concatenating two pages' candidates.
  const seeds = await buildDiscoveryDerivedLabels(stubSupabase(), {
    discoveredContactId: "dc-dup",
    agentRunId: "run-dup",
    source: "frontier_page",
    currentPosition: "",
    occupation: "",
    bio: "",
    locationCity: "",
    locationState: "",
    rawLocationText: "",
    flemishConnection: "KU Leuven",
    flemishFactCandidates: [
      { canonical_name: "KU Leuven", role: "alumnus", confidence: 0.95 },
      { canonical_name: "KU Leuven", role: "alumnus", confidence: 0.6 },
    ],
    sectors: [],
    evidence: [],
  });
  const { client, upserts } = recordingUpsertSupabase();

  const upserted = await upsertDerivedLabelSuggestions(client, seeds);

  assertEquals(upserts.length, 1);
  const keys = upserts[0].map((row) => row.dedupe_key);
  assertEquals(keys.length, new Set(keys).size);
  assertEquals(upserted, keys.length);
  const kuLeuven = upserts[0].filter((row) =>
    row.dedupe_key === "discovered:dc-dup|flemish_entity|ku leuven"
  );
  assertEquals(kuLeuven.length, 1);
  // The strongest evidence wins the conflict instead of an arbitrary row.
  assertEquals(kuLeuven[0].confidence, 0.95);
});

Deno.test("upsertDerivedLabelSuggestions: a rejected batch surfaces the Postgres SQLSTATE so the caller can isolate the record", async () => {
  const client = {
    from() {
      return {
        upsert() {
          return {
            select() {
              return Promise.resolve({
                data: null,
                error: {
                  code: "23502",
                  message: 'null value in column "label_value" violates not-null constraint',
                },
              });
            },
          };
        },
      };
    },
  } as unknown as SupabaseAdminClient;

  let thrown: unknown = null;
  try {
    await upsertDerivedLabelSuggestions(client, [{
      discovered_contact_id: "dc-err",
      label_type: "sector",
      label_value: "Research",
      normalized_value: "research",
      confidence: 0.9,
      source: "frontier_page",
      dedupe_key: "discovered:dc-err|sector|research",
    }]);
  } catch (error) {
    thrown = error;
  }

  assert(thrown instanceof Error);
  assertEquals(
    thrown.message,
    'Failed to upsert derived labels: null value in column "label_value" violates not-null constraint',
  );
  assert(isRecordDataError(thrown));
});
