import { assertEquals, assert } from "jsr:@std/assert@^1.0.0";
import {
  normalizeSmartSearchResult,
  normalizeFlemishSearchResult,
  normalizeProfileCheckResult,
  isAiAgentTask,
  getAiAgentTaskDefinition,
  getEmptySmartSearchKeywords,
  getEmptyFlemishSearchKeywords,
  buildSearchPrompt,
  buildCheckProfilePrompt,
} from "../aiContracts.ts";

Deno.test("normalizeSmartSearchResult: lowercases + filters empty + handles missing keys", () => {
  const r = normalizeSmartSearchResult({
    message: "  Searching  ",
    keywords: {
      name: ["Jan", "", "JANSSENS"],
      sector: ["AI"],
      // missing location_city, etc.
    },
  });
  assertEquals(r.message, "Searching");
  assertEquals(r.keywords.name, ["jan", "janssens"]);
  assertEquals(r.keywords.sector, ["ai"]);
  assertEquals(r.keywords.location_city, []);
  assertEquals(r.keywords.bio, []);
});

Deno.test("normalizeSmartSearchResult: malformed payload yields empty keywords", () => {
  const r = normalizeSmartSearchResult(null);
  assertEquals(r.keywords, getEmptySmartSearchKeywords());
  assertEquals(r.message, "");
});

Deno.test("normalizeFlemishSearchResult: only flemish_connection + bio", () => {
  const r = normalizeFlemishSearchResult({
    keywords: { flemish_connection: ["KU Leuven"], bio: ["alumni"] },
  });
  assertEquals(r.keywords.flemish_connection, ["ku leuven"]);
  assertEquals(r.keywords.bio, ["alumni"]);
});

Deno.test("normalizeFlemishSearchResult: malformed payload yields empty", () => {
  const r = normalizeFlemishSearchResult("not an object");
  assertEquals(r.keywords, getEmptyFlemishSearchKeywords());
});

Deno.test("normalizeProfileCheckResult: drops invalid field_name and missing suggested_value", () => {
  const r = normalizeProfileCheckResult({
    suggestions: [
      {
        field_name: "current_position",
        current_value: "Engineer",
        suggested_value: "Senior Engineer",
        source: "LinkedIn",
        confidence: 0.7,
      },
      {
        field_name: "not_a_field",
        current_value: "x",
        suggested_value: "y",
        source: "x",
      },
      {
        field_name: "bio",
        current_value: "",
        suggested_value: "",
        source: "x",
      },
    ],
  });
  assertEquals(r.suggestions.length, 1);
  assertEquals(r.suggestions[0].field_name, "current_position");
  assertEquals(r.suggestions[0].confidence, 0.7);
});

Deno.test("normalizeProfileCheckResult: clamps confidence to 0..1, defaults source", () => {
  const r = normalizeProfileCheckResult({
    suggestions: [
      {
        field_name: "bio",
        current_value: "",
        suggested_value: "Lots of new info",
        source: "",
        confidence: 5,
      },
      {
        field_name: "bio",
        current_value: "",
        suggested_value: "Also new",
        source: "",
        confidence: -2,
      },
      {
        field_name: "bio",
        current_value: "",
        suggested_value: "Ok",
        source: "",
        confidence: "not a number",
      },
    ],
  });
  assertEquals(r.suggestions[0].confidence, 1);
  assertEquals(r.suggestions[1].confidence, 0);
  assertEquals(r.suggestions[2].confidence, undefined);
  assertEquals(r.suggestions[0].source, "web_search");
});

Deno.test("isAiAgentTask: only known tasks accepted", () => {
  assert(isAiAgentTask("smart_search"));
  assert(isAiAgentTask("merge_text"));
  assertEquals(isAiAgentTask("nonexistent"), false);
});

Deno.test("getAiAgentTaskDefinition: surfaces system prompt + schema", () => {
  const def = getAiAgentTaskDefinition("smart_search");
  assertEquals(def.status, "active");
  assert(def.systemPrompt.length > 0);
  assertEquals(typeof def.buildUserPrompt, "function");
  assertEquals(typeof def.normalizeResult, "function");
});

Deno.test("buildSearchPrompt + buildCheckProfilePrompt: stable formatting", () => {
  assertEquals(buildSearchPrompt("foo"), 'Search query: "foo"');
  assertEquals(buildSearchPrompt(null), 'Search query: ""');
  const p = buildCheckProfilePrompt(
    { name: "Jan", current_position: "Engineer", extra: 42 },
    "result blob"
  );
  assert(p.includes("Current profile:"));
  assert(p.includes('"name": "Jan"'));
  assert(p.includes('"extra": "42"'));
  assert(p.includes("result blob"));
});
