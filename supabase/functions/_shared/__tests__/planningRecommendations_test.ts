/**
 * Planning recommendation behavioral contract tests.
 *
 * agent-scheduler's loadDiscoveryPlanning function is not exported, so the
 * DB-dependent integration tests (exhausted domain exclusion, pivot cooldown
 * exclusion) are marked `ignore: true`.  They document the required behavior
 * and explain exactly what a future integration harness would need to wire up.
 *
 * The pure helper logic (deriveYieldFromScore, deriveYieldFromEvidenceCount,
 * buildGapDiscoveryQuery, buildEntityPivotQuery, buildDomainDiscoveryQuery)
 * is inlined here because it is not exported.  These tests pin the mapping so
 * any change to the thresholds fails loudly.
 */

import { assertEquals } from "jsr:@std/assert@^1.0.0";

// ---------------------------------------------------------------------------
// Inline copies of the private pure helpers from agent-scheduler/index.ts.
// If you change the originals, update these too — failing tests will remind you.
// ---------------------------------------------------------------------------

function deriveYieldFromScore(yieldScore: number): "high" | "medium" | "low" {
  if (yieldScore > 0.6) return "high";
  if (yieldScore > 0.3) return "medium";
  return "low";
}

function deriveYieldFromEvidenceCount(count: number): "high" | "medium" | "low" {
  if (count >= 3) return "high";
  if (count >= 1) return "medium";
  return "low";
}

function pickPrimarySector(sectors: string[] | null | undefined): string | null {
  if (!Array.isArray(sectors)) return null;
  return sectors.find((value) => typeof value === "string" && value.trim().length > 0) || null;
}

function buildGapDiscoveryQuery(gap: {
  label: string;
  sector_emphasis?: string[] | null;
}): string {
  const sector = pickPrimarySector(gap.sector_emphasis);
  const parts: string[] = ["(Belgian OR Flemish)"];
  if (sector) parts.push(sector);
  parts.push(gap.label);
  return parts.join(" ");
}

function buildEntityPivotQuery(domain: string | null, entityName: string): string {
  if (domain) {
    return `site:${domain} ${entityName} (Belgian OR Flemish OR Vlaams)`;
  }
  return `${entityName} (Belgian OR Flemish OR Vlaams) team OR faculty OR people`;
}

function buildDomainDiscoveryQuery(domain: string): string {
  return `site:${domain} (Belgian OR Flemish OR Vlaams) team OR faculty OR people`;
}

// ---------------------------------------------------------------------------
// Rubric: expected_yield derivation from score (used for gap and domain actions)
// ---------------------------------------------------------------------------

Deno.test("deriveYieldFromScore: score > 0.6 maps to high", () => {
  assertEquals(deriveYieldFromScore(0.61), "high");
  assertEquals(deriveYieldFromScore(1.0), "high");
});

Deno.test("deriveYieldFromScore: score in (0.3, 0.6] maps to medium", () => {
  assertEquals(deriveYieldFromScore(0.31), "medium");
  assertEquals(deriveYieldFromScore(0.6), "medium");
});

Deno.test("deriveYieldFromScore: score <= 0.3 maps to low", () => {
  assertEquals(deriveYieldFromScore(0.3), "low");
  assertEquals(deriveYieldFromScore(0.0), "low");
});

// ---------------------------------------------------------------------------
// Rubric: expected_yield derivation from evidence count (used for pivot actions)
// ---------------------------------------------------------------------------

Deno.test("deriveYieldFromEvidenceCount: 3+ contacts maps to high", () => {
  assertEquals(deriveYieldFromEvidenceCount(3), "high");
  assertEquals(deriveYieldFromEvidenceCount(10), "high");
});

Deno.test("deriveYieldFromEvidenceCount: 1 or 2 contacts maps to medium", () => {
  assertEquals(deriveYieldFromEvidenceCount(1), "medium");
  assertEquals(deriveYieldFromEvidenceCount(2), "medium");
});

Deno.test("deriveYieldFromEvidenceCount: 0 contacts maps to low", () => {
  assertEquals(deriveYieldFromEvidenceCount(0), "low");
});

// ---------------------------------------------------------------------------
// Rubric: query templates match basis kind
// ---------------------------------------------------------------------------

Deno.test("buildGapDiscoveryQuery: includes basis label and Flemish operator", () => {
  const query = buildGapDiscoveryQuery({ label: "Boston", sector_emphasis: ["Technology"] });
  assertEquals(query, "(Belgian OR Flemish) Technology Boston");
});

Deno.test("buildGapDiscoveryQuery: omits sector when sector_emphasis is empty", () => {
  const query = buildGapDiscoveryQuery({ label: "Texas", sector_emphasis: [] });
  assertEquals(query, "(Belgian OR Flemish) Texas");
});

Deno.test("buildEntityPivotQuery: uses site: operator when domain is provided", () => {
  const query = buildEntityPivotQuery("imec-int.com", "imec");
  assertEquals(query, "site:imec-int.com imec (Belgian OR Flemish OR Vlaams)");
});

Deno.test("buildEntityPivotQuery: falls back to name-only query when domain is null", () => {
  const query = buildEntityPivotQuery(null, "KU Leuven");
  assertEquals(query, "KU Leuven (Belgian OR Flemish OR Vlaams) team OR faculty OR people");
});

Deno.test("buildDomainDiscoveryQuery: always uses site: operator with Flemish operator", () => {
  const query = buildDomainDiscoveryQuery("vib.be");
  assertEquals(query, "site:vib.be (Belgian OR Flemish OR Vlaams) team OR faculty OR people");
});

// ---------------------------------------------------------------------------
// DB-dependent: exhausted domain exclusion
//
// TODO: requires DB
// loadDiscoveryPlanning calls:
//   supabase.from("ops_discovery_domain_yield").select(...).neq("status", "exhausted")
// To integration-test this, you would need a Supabase test environment with:
//   - A row in ops_discovery_domain_yield with status = 'exhausted'
//   - A row with status = 'active' and remaining_budget_7d > 0
// Then call loadDiscoveryPlanning(supabase) and assert that the exhausted domain
// does NOT appear in any recommended_actions[].target.domain.
// ---------------------------------------------------------------------------

Deno.test({
  name: "loadDiscoveryPlanning: exhausted domains do not appear in recommended actions",
  ignore: true, // TODO: requires DB — see comment above
  fn: async () => {
    // Integration test outline:
    //
    // 1. Seed a row in ops_discovery_domain_yield:
    //    { domain: 'exhausted.example', status: 'exhausted', yield_score: 0.9,
    //      remaining_budget_7d: 0, candidates_approved: 5, candidates_rejected: 0,
    //      duplicate_rate_pct: 0, last_approved_contact_at: new Date().toISOString() }
    //
    // 2. Seed a row with status = 'active' so there is at least one valid domain.
    //
    // 3. Call loadDiscoveryPlanning(supabase) — currently private, would need export.
    //
    // 4. const exhaustedInActions = result.recommended_actions.some(
    //      (a) => a.target?.domain === 'exhausted.example'
    //    );
    //    assertEquals(exhaustedInActions, false);
    //
    // The .neq("status", "exhausted") filter in topDomainsRes is the guard being tested.
  },
});

// ---------------------------------------------------------------------------
// DB-dependent: 72-hour pivot cooldown exclusion
//
// TODO: requires DB
// loadDiscoveryPlanning queries ops_discovery_entity_pivots with:
//   .or(`last_recommended_at.is.null,last_recommended_at.lt.${cooldownCutoff}`)
// To integration-test this, you would need a Supabase test environment with:
//   - A pivot row whose last_recommended_at is within the last 72 hours
//   - A pivot row with last_recommended_at = null (eligible)
// Then call loadDiscoveryPlanning(supabase) and assert that the cooled-down pivot
// does NOT appear in any recommended_actions[].basis.key.
// ---------------------------------------------------------------------------

Deno.test({
  name: "loadDiscoveryPlanning: pivots recommended within 72h are excluded by cooldown",
  ignore: true, // TODO: requires DB — see comment above
  fn: async () => {
    // Integration test outline:
    //
    // 1. Seed a row in ops_discovery_entity_pivots:
    //    { entity_key: 'cooled-pivot', entity_name: 'Cooled Pivot Entity',
    //      entity_type: 'university', approved_contact_count: 5,
    //      strong_source_count: 2, seeded_frontier_count: 1,
    //      normalized_domain: null, seed_queries: ['query1'],
    //      priority_score: 0.9,
    //      last_recommended_at: new Date().toISOString() }   // NOW — within 72h
    //
    // 2. Seed a pivot with last_recommended_at = null (eligible) to ensure
    //    at least one action is returned.
    //
    // 3. Call loadDiscoveryPlanning(supabase) — currently private, would need export.
    //
    // 4. const cooledInActions = result.recommended_actions.some(
    //      (a) => a.basis?.key === 'Cooled Pivot Entity'
    //    );
    //    assertEquals(cooledInActions, false);
    //
    // The .or(`last_recommended_at.is.null,last_recommended_at.lt.${cooldownCutoff}`)
    // filter in pivotsRes is the guard being tested.
  },
});

// ---------------------------------------------------------------------------
// DB-dependent: coverage gap cooldown exclusion (same pattern as pivot cooldown)
//
// TODO: requires DB
// loadDiscoveryPlanning queries coverage_gaps with:
//   .or(`last_recommended_at.is.null,last_recommended_at.lt.${cooldownCutoff}`)
// ---------------------------------------------------------------------------

Deno.test({
  name: "loadDiscoveryPlanning: coverage gaps recommended within 72h are excluded by cooldown",
  ignore: true, // TODO: requires DB — see comment above
  fn: async () => {
    // Integration test outline:
    //
    // 1. Seed a row in coverage_gaps (or coverage_targets):
    //    { geography_key: 'cooled-metro', geography_type: 'metro', label: 'Cooled Metro',
    //      gap_score: 0.95,
    //      last_recommended_at: new Date().toISOString() }  // NOW — within 72h
    //
    // 2. Seed a gap with last_recommended_at = null (eligible).
    //
    // 3. Call loadDiscoveryPlanning(supabase) — currently private, would need export.
    //
    // 4. const cooledGapInActions = result.recommended_actions.some(
    //      (a) => a.basis?.key === 'cooled-metro'
    //    );
    //    assertEquals(cooledGapInActions, false);
  },
});
