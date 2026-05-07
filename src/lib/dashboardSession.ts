import type { Organization, Person } from './supabase';

const SEARCH_CACHE_KEY = 'dashboard-search-cache-v1';
const LAST_DASHBOARD_LOCATION_KEY = 'last-dashboard-location-v1';
const MAX_CACHE_ENTRIES = 10;

export interface CachedDashboardSearch {
  query: string;
  scope?: string;
  nameMatches: Person[];
  aiResults: Person[];
  organizationResults?: Organization[];
  snippets: Array<[string, string]>;
  updatedAt: number;
}

function canUseSessionStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined';
}

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase();
}

function readSearchCache(): CachedDashboardSearch[] {
  if (!canUseSessionStorage()) return [];

  try {
    const raw = window.sessionStorage.getItem(SEARCH_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CachedDashboardSearch[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeSearchCache(entries: CachedDashboardSearch[]) {
  if (!canUseSessionStorage()) return;

  try {
    window.sessionStorage.setItem(SEARCH_CACHE_KEY, JSON.stringify(entries));
  } catch {
    // Ignore quota and serialization failures.
  }
}

export function getCachedDashboardSearch(
  query: string,
  scope = 'default'
): CachedDashboardSearch | null {
  const key = normalizeQuery(query);
  if (!key) return null;

  return (
    readSearchCache().find(
      (entry) =>
        normalizeQuery(entry.query) === key &&
        (entry.scope || 'default') === scope
    ) || null
  );
}

export function setCachedDashboardSearch(
  entry: Omit<CachedDashboardSearch, 'updatedAt'> & { updatedAt?: number }
) {
  const key = normalizeQuery(entry.query);
  if (!key) return;

  const nextEntry: CachedDashboardSearch = {
    ...entry,
    query: entry.query.trim(),
    updatedAt: entry.updatedAt || Date.now(),
  };

  const scope = entry.scope || 'default';
  const existing = readSearchCache().filter(
    (cached) =>
      normalizeQuery(cached.query) !== key ||
      (cached.scope || 'default') !== scope
  );
  existing.unshift(nextEntry);
  writeSearchCache(existing.slice(0, MAX_CACHE_ENTRIES));
}

export function setLastDashboardLocation(location: string) {
  if (!canUseSessionStorage() || !location.startsWith('/')) return;

  try {
    window.sessionStorage.setItem(LAST_DASHBOARD_LOCATION_KEY, location);
  } catch {
    // Ignore storage failures.
  }
}

export function getLastDashboardLocation(): string | null {
  if (!canUseSessionStorage()) return null;

  try {
    const value = window.sessionStorage.getItem(LAST_DASHBOARD_LOCATION_KEY);
    return value && value.startsWith('/') ? value : null;
  } catch {
    return null;
  }
}
