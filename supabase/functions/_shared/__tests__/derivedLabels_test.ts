import { assertEquals, assert } from "jsr:@std/assert@^1.0.0";
import {
  buildDiscoveryDerivedLabels,
  buildVerificationDerivedLabels,
  getLocationLabelSummary,
  getLocationReviewRequired,
  getNormalizedLabelValue,
  normalizeLabelMetadata,
} from "../derivedLabels.ts";
import type { SupabaseAdminClient } from "../database.types.ts";

// Stub supabase admin client: only `from("locations").select(...).ilike(...).eq(...).limit(...).maybeSingle()`
// is reached, and only when there is a US-candidate location to lookup.
function stubSupabase(): SupabaseAdminClient {
  const chain = {
    select() { return this; },
    ilike() { return this; },
    eq() { return this; },
    limit() { return this; },
    async maybeSingle() { return { data: null, error: null }; },
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
