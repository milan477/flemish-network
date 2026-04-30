import {
  assertEquals,
  assert,
} from "jsr:@std/assert@^1.0.0";
import {
  classifySearchRoute,
  buildSearchTerms,
  pickSearchSnippet,
  getSearchRouteConfig,
} from "../searchRouting.ts";
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

Deno.test("classifySearchRoute: literal short name → direct_lookup", () => {
  assertEquals(classifySearchRoute("Jan Janssens", emptyKeywords()), "direct_lookup");
});

Deno.test("classifySearchRoute: name keyword + few tokens → direct_lookup", () => {
  const k = emptyKeywords();
  k.name = ["jan janssens"];
  assertEquals(classifySearchRoute("jan janssens", k), "direct_lookup");
});

Deno.test("classifySearchRoute: location + sector with few tokens → faceted", () => {
  const k = emptyKeywords();
  k.location_city = ["boston"];
  k.sector = ["biotechnology"];
  // 2 non-stopword tokens → falls through the long-tokens exploratory check
  assertEquals(classifySearchRoute("biotech in Boston", k), "faceted");
});

Deno.test("classifySearchRoute: long semantic intent → exploratory", () => {
  const k = emptyKeywords();
  k.bio = ["machine learning", "research"];
  assertEquals(
    classifySearchRoute(
      "people who are working on machine learning research in startups",
      k
    ),
    "exploratory"
  );
});

Deno.test("classifySearchRoute: location + sector + many tokens → exploratory", () => {
  const k = emptyKeywords();
  k.location_city = ["boston"];
  k.sector = ["finance"];
  assertEquals(
    classifySearchRoute("finance executives based around Boston area", k),
    "exploratory"
  );
});

Deno.test("getSearchRouteConfig: returns expected weights for each route", () => {
  const direct = getSearchRouteConfig("direct_lookup");
  const faceted = getSearchRouteConfig("faceted");
  const exp = getSearchRouteConfig("exploratory");
  assert(direct.lexicalWeight > exp.lexicalWeight);
  assert(exp.vectorWeight > direct.vectorWeight);
  assertEquals(faceted.route, "faceted");
});

Deno.test("buildSearchTerms: dedupes, normalizes, caps at 16", () => {
  const k = emptyKeywords();
  k.name = ["Jan Janssens", "JAN JANSSENS"];
  k.location_city = ["Boston", "boston"];
  const terms = buildSearchTerms("Jan Janssens Boston", k);
  assert(terms.length <= 16);
  // Lowercased + deduped
  const unique = new Set(terms);
  assertEquals(unique.size, terms.length);
  assert(terms.includes("jan janssens"));
  assert(terms.includes("boston"));
});

Deno.test("pickSearchSnippet: prefers hint when match_field is non-name", () => {
  const snippet = pickSearchSnippet(
    {
      current_position: "Engineer",
      occupation: "Engineer",
      bio: "Long bio sentence one. And second.",
      flemish_connection_names: "KU Leuven",
      sector_names: "Biotechnology",
      location_text: "Boston, MA",
    },
    ["leuven"],
    "leuven",
    { match_field: "bio", match_text: "Loves KU Leuven research." }
  );
  assertEquals(snippet, "Loves KU Leuven research.");
});

Deno.test("pickSearchSnippet: ignores hint when match_field is name", () => {
  const snippet = pickSearchSnippet(
    {
      current_position: "Engineer",
      occupation: "Engineer",
      bio: "",
      flemish_connection_names: "KU Leuven",
      sector_names: "",
      location_text: "",
    },
    ["leuven"],
    "leuven",
    { match_field: "name", match_text: "ignored" }
  );
  assert(snippet.includes("KU Leuven"));
});

Deno.test("pickSearchSnippet: truncates very long snippets", () => {
  const long = "x".repeat(500);
  const snippet = pickSearchSnippet(
    {
      current_position: "",
      occupation: "",
      bio: long,
      flemish_connection_names: "",
      sector_names: "",
      location_text: "",
    },
    [],
    "",
    undefined
  );
  assert(snippet.length <= 230);
  assert(snippet.endsWith("..."));
});
