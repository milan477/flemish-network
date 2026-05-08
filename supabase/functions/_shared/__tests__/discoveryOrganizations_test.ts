import { assertEquals } from "jsr:@std/assert@^1.0.0";
import {
  likelySameOrganization,
  mergeOrganizationCandidates,
  normalizeOrganizationWebsite,
  organizationCandidateKey,
  strongOrganizationNameMatch,
  type DiscoveryOrganizationCandidate,
} from "../discoveryOrganizations.ts";

function candidate(partial: Partial<DiscoveryOrganizationCandidate>): DiscoveryOrganizationCandidate {
  return {
    name: "Flanders Investment & Trade",
    website_url: "",
    description: "",
    suggested_us_network_status: "institutional_connector",
    us_locations: [],
    sectors: [],
    flemish_belgian_relevance: "",
    flemish_fact_candidates: [],
    source_urls: [],
    confidence: 0.5,
    ...partial,
  };
}

Deno.test("normalizeOrganizationWebsite: removes protocol, www, tracking, and trailing slash", () => {
  assertEquals(
    normalizeOrganizationWebsite("https://www.example.org/about/?utm_source=x"),
    "example.org/about",
  );
});

Deno.test("organizationCandidateKey: prefers normalized website over name", () => {
  assertEquals(
    organizationCandidateKey(candidate({ website_url: "https://www.imec-int.com/" })),
    "org:site:imec-int.com",
  );
});

Deno.test("strongOrganizationNameMatch: ignores common legal suffixes", () => {
  assertEquals(strongOrganizationNameMatch("Acme Biotech Inc.", "Acme Biotech"), true);
  assertEquals(strongOrganizationNameMatch("Acme Biotech", "Different Biotech"), false);
});

Deno.test("likelySameOrganization: website conflicts block name-only merge", () => {
  assertEquals(
    likelySameOrganization(
      candidate({ name: "Acme Biotech Inc.", website_url: "https://acme.example" }),
      candidate({ name: "Acme Biotech", website_url: "https://other.example" }),
    ),
    false,
  );
});

Deno.test("mergeOrganizationCandidates: combines evidence fields without duplicates", () => {
  const merged = mergeOrganizationCandidates(
    candidate({
      website_url: "https://example.org",
      sectors: ["Research"],
      source_urls: ["https://example.org/a"],
      confidence: 0.4,
    }),
    candidate({
      description: "Longer evidence-backed description",
      sectors: ["Research", "Biotechnology"],
      source_urls: ["https://example.org/a", "https://example.org/b"],
      confidence: 0.8,
    }),
  );

  assertEquals(merged.description, "Longer evidence-backed description");
  assertEquals(merged.sectors, ["Research", "Biotechnology"]);
  assertEquals(merged.source_urls, ["https://example.org/a", "https://example.org/b"]);
  assertEquals(merged.confidence, 0.8);
});
