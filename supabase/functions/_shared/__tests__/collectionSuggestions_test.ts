import { assertEquals } from "jsr:@std/assert@^1.0.0";
import {
  applyRerankAndBackfill,
  fallbackCollectionSuggestionPlan,
  parseCollectionSuggestionPlan,
  parseRerankedCollectionCandidates,
  type CollectionSuggestionCandidate,
} from "../collectionSuggestions.ts";

const mixedCandidates: CollectionSuggestionCandidate[] = [
  {
    entity_type: "person",
    id: "person-1",
    name: "Ada Person",
    reason: "Lexical person match",
    score: 0.9,
    source_search: "biotech leaders",
  },
  {
    entity_type: "organization",
    id: "org-1",
    name: "Flanders Lab",
    reason: "Organization match",
    score: 0.8,
    source_search: "biotech organizations",
  },
  {
    entity_type: "person",
    id: "person-2",
    name: "Ben Person",
    reason: "Vector person match",
    score: 0.7,
    source_search: "biotech leaders",
  },
];

Deno.test("fallbackCollectionSuggestionPlan: searches the original prompt across people and organizations without a gap", () => {
  assertEquals(fallbackCollectionSuggestionPlan(" Belgian biotech in Boston "), {
    searches: [{
      query: "Belgian biotech in Boston",
      targets: ["person", "organization"],
    }],
    gap: { should_offer: false },
  });
});

Deno.test("parseCollectionSuggestionPlan: caps focused searches and preserves Discovery handoff shape", () => {
  const plan = parseCollectionSuggestionPlan({
    searches: [
      { query: "biotech leaders Boston", targets: ["person"] },
      { query: "biotech organizations Boston", targets: ["organization"] },
      { query: "Belgian life sciences New York", targets: ["person", "organization"] },
      { query: "Flemish universities California", entity_targets: ["organization"] },
      { query: "extra query ignored", targets: ["person"] },
    ],
    gap: {
      should_offer: true,
      reason: "The database may be missing early-stage Belgian biotech founders.",
      suggested_prompt: "Find Belgian biotech founders in Boston and New York.",
    },
  }, "fallback");

  assertEquals(plan.searches, [
    { query: "biotech leaders Boston", targets: ["person"] },
    { query: "biotech organizations Boston", targets: ["organization"] },
    { query: "Belgian life sciences New York", targets: ["person", "organization"] },
    { query: "Flemish universities California", targets: ["organization"] },
  ]);
  assertEquals(plan.gap, {
    should_offer: true,
    reason: "The database may be missing early-stage Belgian biotech founders.",
    suggested_prompt: "Find Belgian biotech founders in Boston and New York.",
  });
});

Deno.test("parseRerankedCollectionCandidates: normalizes mixed rerank payloads", () => {
  const parsed = parseRerankedCollectionCandidates({
    message: "Use these candidates",
    candidates: [
      { entity_type: "organization", id: "org-1", reason: "Strong org fit", score: 2 },
      { entity_type: "person", id: "person-1", reason: "Strong person fit", score: 0.75 },
      { entity_type: "organization", id: "", reason: "missing id", score: 0.5 },
      { entity_type: "place", id: "place-1", reason: "wrong entity", score: 0.5 },
    ],
  });

  assertEquals(parsed, {
    message: "Use these candidates",
    candidates: [
      { entity_type: "organization", id: "org-1", reason: "Strong org fit", score: 1 },
      { entity_type: "person", id: "person-1", reason: "Strong person fit", score: 0.75 },
    ],
  });
});

Deno.test("applyRerankAndBackfill: ignores unknown rerank IDs and fills from deterministic retrieved order", () => {
  const ranked = applyRerankAndBackfill(
    mixedCandidates,
    [
      { entity_type: "organization", id: "unknown-org", reason: "Invented", score: 1 },
      { entity_type: "organization", id: "org-1", reason: "Best organization", score: 0.95 },
    ],
    3,
  );

  assertEquals(ranked.map((candidate) => `${candidate.entity_type}:${candidate.id}`), [
    "organization:org-1",
    "person:person-1",
    "person:person-2",
  ]);
  assertEquals(ranked[0].reason, "Best organization");
  assertEquals(ranked[0].score, 0.95);
});
