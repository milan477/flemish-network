import {
  assert,
  assertEquals,
} from "jsr:@std/assert@^1.0.0";
import {
  buildManualFilterKeywords,
  calculateStructuredCriteriaCoverage,
  criteriaCoveragePasses,
  mergeSearchKeywords,
  addCriterionCoverage,
  normalizePersonScope,
  normalizeSearchMatchMode,
} from "../searchCriteria.ts";
import type { SmartSearchKeywords } from "../aiContracts.ts";

function emptyKeywords(): SmartSearchKeywords {
  return {
    name: [],
    occupation: [],
    sector: [],
    location_city: [],
    location_state: [],
    current_position: [],
    flemish_connection: [],
    bio: [],
  };
}

Deno.test("structured criteria coverage: KU Leuven biotech Boston covers all facets", () => {
  const keywords = emptyKeywords();
  keywords.flemish_connection = ["KU Leuven"];
  keywords.sector = ["biotech"];
  keywords.location_city = ["Boston"];

  const coverage = calculateStructuredCriteriaCoverage(keywords, {
    current_position: "Founder",
    occupation: "Executive",
    flemish_connection_names: "KU Leuven",
    sector_names: "Biotechnology",
    location_text: "Boston, MA",
  });

  assertEquals(coverage.total, 3);
  assertEquals(coverage.matched, 3);
  assert(criteriaCoveragePasses(coverage, "all"));
  assert(criteriaCoveragePasses(coverage, "any"));
});

Deno.test("structured criteria coverage: organization sector location and Flemish coverage", () => {
  const keywords = emptyKeywords();
  keywords.flemish_connection = ["imec"];
  keywords.sector = ["semiconductor"];
  keywords.location_state = ["California"];

  const coverage = calculateStructuredCriteriaCoverage(keywords, {
    current_position: "Research lab",
    occupation: "Research lab",
    flemish_connection_names: "imec",
    sector_names: "Semiconductor, AI",
    location_text: "San Francisco, CA | San Diego, CA | California",
  });

  assertEquals(coverage.total, 3);
  assertEquals(coverage.matched, 3);
  assert(criteriaCoveragePasses(coverage, "all"));
});

Deno.test("structured criteria coverage: all rejects partial overlap and any accepts it", () => {
  const keywords = emptyKeywords();
  keywords.flemish_connection = ["KU Leuven"];
  keywords.sector = ["biotech"];
  keywords.location_city = ["Boston"];

  const coverage = calculateStructuredCriteriaCoverage(keywords, {
    current_position: "Founder",
    occupation: "Executive",
    flemish_connection_names: "KU Leuven",
    sector_names: "Finance",
    location_text: "New York, NY",
  });

  assertEquals(coverage.total, 3);
  assertEquals(coverage.matched, 1);
  assertEquals(criteriaCoveragePasses(coverage, "all"), false);
  assertEquals(criteriaCoveragePasses(coverage, "any"), true);
});

Deno.test("manual filters merge into structured search keywords", () => {
  const queryKeywords = emptyKeywords();
  queryKeywords.sector = ["biotech"];
  const manualKeywords = buildManualFilterKeywords({
    sector: "Biotechnology",
    city: "Boston",
    flemish_connections: ["KU Leuven"],
  });

  const merged = mergeSearchKeywords(queryKeywords, manualKeywords);

  assertEquals(merged.sector, ["biotech", "biotechnology"]);
  assertEquals(merged.location_city, ["boston"]);
  assertEquals(merged.flemish_connection, ["ku leuven"]);
});

Deno.test("normalizeSearchMatchMode defaults to all", () => {
  assertEquals(normalizeSearchMatchMode("any"), "any");
  assertEquals(normalizeSearchMatchMode("bogus"), "all");
});

Deno.test("person scope can be added as a structured criterion", () => {
  const coverage = addCriterionCoverage(
    { total: 1, matched: 1, score: 1 },
    false
  );

  assertEquals(coverage.total, 2);
  assertEquals(coverage.matched, 1);
  assertEquals(criteriaCoveragePasses(coverage, "all"), false);
  assertEquals(criteriaCoveragePasses(coverage, "any"), true);
  assertEquals(normalizePersonScope("us_based"), "us_based");
  assertEquals(normalizePersonScope("all"), null);
});
