import { assert, assertEquals } from "jsr:@std/assert@^1.0.0";
import {
  discoveredContactNetworkScopeColumns,
  mergeDiscoveredContactNetworkStatus,
  normalizeDiscoveredContactNetworkStatus,
} from "../discoveredContactScope.ts";

// Mirrors the live CHECK constraints on public.discovered_contacts
// (migration 20260508000006_verify_before_promote.sql + 20260504000000_us_network_scope.sql).
function assertSatisfiesDiscoveredContactScopeConstraints(
  columns: {
    suggested_us_network_status: unknown;
    suggested_us_network_confidence: unknown;
  },
) {
  const status = columns.suggested_us_network_status;
  assert(
    status === null || status === "us_based" || status === "us_connected_abroad",
    `discovered_contacts_suggested_us_network_status_check rejects ${JSON.stringify(status)}`,
  );
  const confidence = columns.suggested_us_network_confidence;
  assert(
    confidence === null ||
      (typeof confidence === "number" && confidence >= 0 && confidence <= 1),
    `discovered_contacts_suggested_us_network_confidence_check rejects ${JSON.stringify(confidence)}`,
  );
}

Deno.test("normalizeDiscoveredContactNetworkStatus: maps needs_review and unknown values to null", () => {
  assertEquals(normalizeDiscoveredContactNetworkStatus("us_based"), "us_based");
  assertEquals(
    normalizeDiscoveredContactNetworkStatus("us_connected_abroad"),
    "us_connected_abroad",
  );
  assertEquals(normalizeDiscoveredContactNetworkStatus("needs_review"), null);
  assertEquals(normalizeDiscoveredContactNetworkStatus(null), null);
  assertEquals(normalizeDiscoveredContactNetworkStatus(undefined), null);
  assertEquals(normalizeDiscoveredContactNetworkStatus(""), null);
  assertEquals(normalizeDiscoveredContactNetworkStatus("US"), null);
});

Deno.test("mergeDiscoveredContactNetworkStatus: an ambiguous signal never overwrites a known scope", () => {
  assertEquals(mergeDiscoveredContactNetworkStatus("us_based", null), "us_based");
  assertEquals(mergeDiscoveredContactNetworkStatus(null, "us_based"), "us_based");
  assertEquals(
    mergeDiscoveredContactNetworkStatus("us_based", "us_connected_abroad"),
    "us_connected_abroad",
  );
  assertEquals(
    mergeDiscoveredContactNetworkStatus("us_connected_abroad", "us_based"),
    "us_connected_abroad",
  );
  assertEquals(mergeDiscoveredContactNetworkStatus(null, null), null);
});

Deno.test("discoveredContactNetworkScopeColumns: never emits a value the discovered_contacts CHECK constraints reject", () => {
  const statuses = [
    "us_based",
    "us_connected_abroad",
    "needs_review",
    "unknown",
    "",
    null,
    undefined,
  ];
  const confidences = [0, 0.83, 1, 1.4, -0.2, Number.NaN, null, undefined];

  for (const status of statuses) {
    for (const confidence of confidences) {
      assertSatisfiesDiscoveredContactScopeConstraints(
        discoveredContactNetworkScopeColumns(status, confidence),
      );
    }
  }
});

Deno.test("discoveredContactNetworkScopeColumns: an unestablished scope clears its confidence", () => {
  // The official Fayat directory row shape: no scope yet, awaiting agent-verify.
  assertEquals(discoveredContactNetworkScopeColumns("needs_review", 0), {
    suggested_us_network_status: null,
    suggested_us_network_confidence: null,
  });
  assertEquals(discoveredContactNetworkScopeColumns(null, 0.7), {
    suggested_us_network_status: null,
    suggested_us_network_confidence: null,
  });
});

Deno.test("discoveredContactNetworkScopeColumns: keeps a known scope with a clamped confidence", () => {
  assertEquals(discoveredContactNetworkScopeColumns("us_based", 0.83), {
    suggested_us_network_status: "us_based",
    suggested_us_network_confidence: 0.83,
  });
  assertEquals(discoveredContactNetworkScopeColumns("us_connected_abroad", 1.4), {
    suggested_us_network_status: "us_connected_abroad",
    suggested_us_network_confidence: 1,
  });
  assertEquals(discoveredContactNetworkScopeColumns("us_based", Number.NaN), {
    suggested_us_network_status: "us_based",
    suggested_us_network_confidence: null,
  });
});
