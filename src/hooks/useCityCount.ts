/**
 * Single source of truth for "how many distinct cities" in the network.
 *
 * Cities are keyed by `city|state` (Cambridge MA is not Cambridge UK). All
 * dashboard counters (map, list view, admin overview) must consume one of the
 * helpers exported here so the visible number cannot drift across surfaces.
 */

export interface CityRecord {
  city?: string | null;
  state?: string | null;
}

export interface NestedCityRecord {
  locations?: CityRecord | null;
}

export function buildCityKey(city: string, state: string): string {
  return `${city}|${state}`;
}

/**
 * Count unique (city, state) pairs across any record shape that exposes a
 * `getCity` accessor. A null/empty city or state is ignored.
 */
export function countUniqueCities<T>(
  items: readonly T[],
  getLocation: (item: T) => CityRecord | null | undefined
): number {
  const keys = new Set<string>();
  for (const item of items) {
    const loc = getLocation(item);
    if (!loc?.city || !loc?.state) continue;
    keys.add(buildCityKey(loc.city, loc.state));
  }
  return keys.size;
}

/**
 * Convenience for arrays of map clusters (already carry city + state).
 */
export function countUniqueClusterCities(
  clusters: readonly { city: string; state: string }[]
): number {
  return countUniqueCities(clusters, (c) => ({ city: c.city, state: c.state }));
}

/**
 * Convenience for arrays of records whose location is nested under
 * `locations` (e.g. `Person`, `Organization`).
 */
export function countUniqueLocationCities(
  items: readonly NestedCityRecord[]
): number {
  return countUniqueCities(items, (item) => item.locations ?? null);
}

/**
 * React hook form for callers that prefer hook semantics. Pure derivation —
 * memoization is the caller's responsibility (the inputs are usually already
 * memoized arrays in the parent component).
 */
export function useCityCount<T>(
  items: readonly T[],
  getLocation: (item: T) => CityRecord | null | undefined
): number {
  return countUniqueCities(items, getLocation);
}
