import { assertEquals, assertStringIncludes } from "jsr:@std/assert@^1.0.0";
import {
  buildOrganizationStructuredEmbeddingText,
  buildOrganizationTextChunks,
  buildPersonTextChunks,
  buildStructuredEmbeddingText,
} from "../embeddings.ts";

Deno.test("buildStructuredEmbeddingText preserves person embedding fields", () => {
  const text = buildStructuredEmbeddingText({
    name: "Jane Peeters",
    currentPosition: "Founder at Flanders Bio US",
    bio: "Builds Flemish biotech partnerships in Boston.",
    occupation: "Founder",
    sectors: ["Biotech", "Venture"],
    flemishConnections: ["Flanders Investment & Trade"],
    locationText: "Boston, MA",
  });

  assertStringIncludes(text, "Name: Jane Peeters");
  assertStringIncludes(
    text,
    "Flemish connections: Flanders Investment & Trade",
  );
});

Deno.test("buildOrganizationStructuredEmbeddingText includes organization-specific context", () => {
  const text = buildOrganizationStructuredEmbeddingText({
    name: "Flanders AI Hub",
    type: "Research institute",
    description:
      "Runs applied AI programs with Flemish universities and US labs.",
    sectors: ["AI", "Research"],
    flemishLink: "Founded by Flemish university partners.",
    locationText: "New York, NY; Boston, MA",
    usNetworkStatus: "belgian_organization_with_us_presence",
    websiteUrl: "https://example.org",
  });

  assertStringIncludes(text, "Organization: Flanders AI Hub");
  assertStringIncludes(
    text,
    "Flemish or Belgian relevance: Founded by Flemish university partners.",
  );
  assertStringIncludes(text, "US locations: New York, NY; Boston, MA");
});

Deno.test("buildOrganizationTextChunks creates bounded mixed organization chunks", () => {
  const chunks = buildOrganizationTextChunks({
    name: "Flanders AI Hub",
    type: "Research institute",
    description:
      "Runs applied AI programs with Flemish universities and US labs. Supports industry pilots across the Northeast.",
    sectors: ["AI", "Research"],
    flemishLink: "Founded by Flemish university partners.",
    locationText: "New York, NY",
    usNetworkStatus: "belgian_organization_with_us_presence",
    websiteUrl: "https://example.org",
  });

  assertEquals(chunks.some((chunk) => chunk.chunk_type === "profile"), true);
  assertEquals(
    chunks.some((chunk) => chunk.chunk_type === "description"),
    true,
  );
  assertEquals(chunks.some((chunk) => chunk.chunk_type === "combined"), true);
  assertEquals(chunks.length <= 7, true);
});

Deno.test("buildPersonTextChunks remains person typed", () => {
  const chunks = buildPersonTextChunks({
    name: "Jane Peeters",
    currentPosition: "Founder",
    bio: "Works with Flemish founders. Advises US expansion.",
    occupation: "Founder",
    sectors: ["Biotech"],
    flemishConnections: ["Flanders"],
    locationText: "Boston, MA",
  });

  assertEquals(chunks.some((chunk) => chunk.chunk_type === "position"), true);
  assertEquals(chunks.some((chunk) => chunk.chunk_type === "bio"), true);
  assertEquals(chunks.some((chunk) => chunk.chunk_type === "combined"), true);
});
