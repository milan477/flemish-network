import { assertEquals, assert } from "jsr:@std/assert@^1.0.0";
import {
  parseLocationCandidate,
  stateToCode,
  isUsCountry,
  buildLocationLabelValue,
  normalizeWhitespace,
  normalizeLocationKey,
  safeString,
} from "../locationPipeline.ts";

Deno.test("safeString / normalizeWhitespace handle edge inputs", () => {
  assertEquals(safeString(null), "");
  assertEquals(safeString(undefined), "");
  assertEquals(safeString(123), "123");
  assertEquals(normalizeWhitespace("  a   b\tc\n d "), "a b c d");
  assertEquals(normalizeLocationKey("  Boston  MA "), "boston ma");
});

Deno.test("isUsCountry recognizes common US labels", () => {
  for (const v of ["USA", "us", "United States", "united states of america"]) {
    assert(isUsCountry(v), `expected "${v}" to be US`);
  }
  assertEquals(isUsCountry("Belgium"), false);
});

Deno.test("stateToCode: code passthrough, name to code, unknowns empty", () => {
  assertEquals(stateToCode("ma"), "MA");
  assertEquals(stateToCode("MA"), "MA");
  assertEquals(stateToCode("Massachusetts"), "MA");
  assertEquals(stateToCode("massachusetts"), "MA");
  assertEquals(stateToCode("New York"), "NY");
  assertEquals(stateToCode("Atlantis"), "");
  assertEquals(stateToCode(""), "");
});

Deno.test("parseLocationCandidate: full city + state code is high confidence US", () => {
  const r = parseLocationCandidate("", "Boston", "MA");
  assertEquals(r.city, "Boston");
  assertEquals(r.state, "MA");
  assertEquals(r.is_us_candidate, true);
  assert(r.parser_confidence >= 0.9);
  assertEquals(r.review_required, false);
  assertEquals(r.label_value, "Boston, MA");
});

Deno.test("parseLocationCandidate: parses raw 'City, ST' string", () => {
  const r = parseLocationCandidate("Austin, TX", "", "");
  assertEquals(r.city, "Austin");
  assertEquals(r.state, "TX");
  assert(r.is_us_candidate);
});

Deno.test("parseLocationCandidate: marks Belgian location as non-US", () => {
  const r = parseLocationCandidate("Leuven, Belgium", "", "");
  assertEquals(r.is_us_candidate, false);
  assertEquals(r.review_required, true);
});

Deno.test("parseLocationCandidate: handles 'City, USA' with empty state", () => {
  const r = parseLocationCandidate("Springfield, USA", "", "");
  assertEquals(r.is_us_candidate, true);
  assertEquals(r.country, "USA");
  assertEquals(r.state, "");
  assertEquals(r.review_required, true); // missing state code
});

Deno.test("parseLocationCandidate: empty input → very low confidence, review required", () => {
  const r = parseLocationCandidate("", "", "");
  assertEquals(r.label_value, "");
  assert(r.parser_confidence < 0.7);
  assertEquals(r.review_required, true);
});

Deno.test("buildLocationLabelValue: prefers city/state over raw fallback", () => {
  assertEquals(buildLocationLabelValue("Boston", "MA", "raw"), "Boston, MA");
  assertEquals(buildLocationLabelValue("", "", "Brussels"), "Brussels");
  assertEquals(buildLocationLabelValue("", "", ""), "");
});
