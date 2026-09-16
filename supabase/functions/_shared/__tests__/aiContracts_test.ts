import { assertEquals, assert } from "jsr:@std/assert@^1.0.0";
import {
  normalizeSmartSearchResult,
  normalizeProfileCheckResult,
  isAiAgentTask,
  getAiAgentTaskDefinition,
  getEmptySmartSearchKeywords,
  buildSearchPrompt,
  buildCheckProfilePrompt,
} from "../aiContracts.ts";

Deno.test("normalizeSmartSearchResult: lowercases + filters empty + handles missing keys", () => {
  const r = normalizeSmartSearchResult({
    message: "  Searching  ",
    concepts: [" New York University ", ""],
    keywords: {
      name: ["Jan", "", "JANSSENS"],
      sector: ["AI"],
      // missing location_city, etc.
    },
  });
  assertEquals(r.message, "Searching");
  assertEquals(r.concepts, ["New York University"]);
  assertEquals(r.keywords.name, ["jan", "janssens"]);
  assertEquals(r.keywords.sector, ["ai"]);
  assertEquals(r.keywords.location_city, []);
  assertEquals(r.keywords.bio, []);
});

Deno.test("normalizeSmartSearchResult: malformed payload yields empty keywords", () => {
  const r = normalizeSmartSearchResult(null);
  assertEquals(r.keywords, getEmptySmartSearchKeywords());
  assertEquals(r.message, "");
  assertEquals(r.concepts, []);
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

Deno.test("normalizeProfileCheckResult: accepts profile photo suggestions", () => {
  const r = normalizeProfileCheckResult({
    suggestions: [{
      field_name: "profile_photo_url",
      current_value: "",
      suggested_value: "https://example.com/milan.jpg",
      source: "Personal website",
      confidence: 0.92,
    }],
  });

  assertEquals(r.suggestions.length, 1);
  assertEquals(r.suggestions[0].field_name, "profile_photo_url");
});

Deno.test("isAiAgentTask: only known tasks accepted", () => {
  assert(isAiAgentTask("smart_search"));
  assert(isAiAgentTask("merge_text"));
  assert(isAiAgentTask("check_profile"));
  assertEquals(isAiAgentTask("parse_contacts"), false);
  assertEquals(isAiAgentTask("flemish_search"), false);
  assertEquals(isAiAgentTask("nonexistent"), false);
});

Deno.test("getAiAgentTaskDefinition: surfaces system prompt + schema", () => {
  const def = getAiAgentTaskDefinition("smart_search");
  assertEquals(def.status, "active");
  assert(def.systemPrompt.length > 0);
  assertEquals(typeof def.buildUserPrompt, "function");
  assertEquals(typeof def.normalizeResult, "function");
});

Deno.test("check_profile requires paired, current US location evidence", () => {
  const prompt = getAiAgentTaskDefinition("check_profile").systemPrompt;
  assert(prompt.includes("explicit current US residence"));
  assert(prompt.includes("former school"));
  assert(prompt.includes("both city and state"));
  assert(prompt.includes("real US location"));
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
  assert(p.includes("Profile photo candidates:"));
});

Deno.test("buildCheckProfilePrompt: includes exact profile photo candidates", () => {
  const p = buildCheckProfilePrompt(
    { name: "Milan", profile_photo_url: "" },
    "search results",
    [{
      image_url: "https://example.com/milan.jpg",
      alt_text: "Milan Liessens Dujardin",
      source_url: "https://example.com/about",
      page_title: "About Milan",
    }],
  );

  assert(p.includes('"image_url": "https://example.com/milan.jpg"'));
  assert(p.includes('"alt_text": "Milan Liessens Dujardin"'));
});
