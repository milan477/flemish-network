// US-network scope of a discovered contact, matching the
// `discovered_contacts_suggested_us_network_status_check` constraint
// (migration 20260508000006_verify_before_promote.sql).
//
// NULL means the scope is not established yet; agent-verify fills it in.
// `needs_review` is only the extraction model's "ambiguous" answer and is never
// persisted on discovered_contacts (it remains valid on `people`).
export type DiscoveredContactNetworkStatus = "us_based" | "us_connected_abroad";

export function normalizeDiscoveredContactNetworkStatus(
  value: unknown,
): DiscoveredContactNetworkStatus | null {
  return value === "us_based" || value === "us_connected_abroad" ? value : null;
}

// A concrete US tie while based abroad is the more specific finding, and an
// unknown scope never erases a known one.
export function mergeDiscoveredContactNetworkStatus(
  base: DiscoveredContactNetworkStatus | null,
  other: DiscoveredContactNetworkStatus | null,
): DiscoveredContactNetworkStatus | null {
  if (base === "us_connected_abroad" || other === "us_connected_abroad") {
    return "us_connected_abroad";
  }
  return base ?? other;
}

// The single write boundary for the scope columns of discovered_contacts:
// only values the CHECK constraints accept, and no confidence without a scope.
export function discoveredContactNetworkScopeColumns(
  status: unknown,
  confidence: unknown,
): {
  suggested_us_network_status: DiscoveredContactNetworkStatus | null;
  suggested_us_network_confidence: number | null;
} {
  const normalizedStatus = normalizeDiscoveredContactNetworkStatus(status);
  if (!normalizedStatus) {
    return {
      suggested_us_network_status: null,
      suggested_us_network_confidence: null,
    };
  }

  const numericConfidence = typeof confidence === "number" ||
      typeof confidence === "string"
    ? Number(confidence)
    : Number.NaN;
  return {
    suggested_us_network_status: normalizedStatus,
    suggested_us_network_confidence: Number.isFinite(numericConfidence)
      ? Math.max(0, Math.min(1, numericConfidence))
      : null,
  };
}
