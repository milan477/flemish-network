import { canonicalizeUrl, extractDomain, normalizeWhitespace, safeString } from "./discovery.ts";

export type OrganizationNetworkStatus =
  | "us_based_organization"
  | "belgian_organization_with_us_presence"
  | "us_organization_connected_to_flanders"
  | "institutional_connector";

export interface OrganizationLocationEvidence {
  city: string;
  state: string;
  country: string;
  role: string;
  label: string;
  description: string;
  source_url: string;
  evidence_excerpt: string;
  confidence: number;
  is_primary: boolean;
}

export interface DiscoveryOrganizationCandidate {
  name: string;
  website_url: string;
  description: string;
  suggested_us_network_status: OrganizationNetworkStatus;
  us_locations: OrganizationLocationEvidence[];
  sectors: string[];
  flemish_belgian_relevance: string;
  source_urls: string[];
  confidence: number;
}

export function normalizeOrganizationName(value: string): string {
  return normalizeWhitespace(safeString(value).toLowerCase())
    .replace(/&/g, " and ")
    .replace(/\b(incorporated|inc|llc|l\.l\.c|corp|corporation|company|co|ltd|limited|plc|nv|sa|bv|vzw|nonprofit|foundation)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function normalizeOrganizationWebsite(value: string): string {
  const raw = normalizeWhitespace(safeString(value));
  if (!raw) return "";

  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const canonical = canonicalizeUrl(withProtocol);
  if (!canonical) {
    return raw
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./i, "")
      .replace(/\/+$/, "")
      .toLowerCase();
  }

  try {
    const url = new URL(canonical);
    const path = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");
    return `${url.hostname.replace(/^www\./i, "").toLowerCase()}${path}${url.search}`;
  } catch {
    return canonical
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./i, "")
      .replace(/\/+$/, "")
      .toLowerCase();
  }
}

export function organizationCandidateKey(candidate: Pick<DiscoveryOrganizationCandidate, "name" | "website_url">): string {
  const website = normalizeOrganizationWebsite(candidate.website_url);
  if (website) return `org:site:${website}`;

  const name = normalizeOrganizationName(candidate.name);
  return `org:name:${name}`;
}

export function strongOrganizationNameMatch(a: string, b: string): boolean {
  const normalizedA = normalizeOrganizationName(a);
  const normalizedB = normalizeOrganizationName(b);
  if (!normalizedA || !normalizedB) return false;
  if (normalizedA === normalizedB) return true;

  const aWords = normalizedA.split(" ").filter(Boolean);
  const bWords = normalizedB.split(" ").filter(Boolean);
  if (aWords.length < 2 || bWords.length < 2) return false;

  const shorter = aWords.length <= bWords.length ? aWords : bWords;
  const longer = aWords.length > bWords.length ? aWords : bWords;
  return shorter.length >= 2 && shorter.every((word) => longer.includes(word));
}

export function likelySameOrganization(
  a: Pick<DiscoveryOrganizationCandidate, "name" | "website_url">,
  b: Pick<DiscoveryOrganizationCandidate, "name" | "website_url">,
): boolean {
  const websiteA = normalizeOrganizationWebsite(a.website_url);
  const websiteB = normalizeOrganizationWebsite(b.website_url);
  if (websiteA && websiteB) return websiteA === websiteB;
  return strongOrganizationNameMatch(a.name, b.name);
}

export function mergeOrganizationCandidates(
  existing: DiscoveryOrganizationCandidate,
  incoming: DiscoveryOrganizationCandidate,
): DiscoveryOrganizationCandidate {
  const preferIncoming = incoming.confidence > existing.confidence;
  const base = preferIncoming ? incoming : existing;
  const other = preferIncoming ? existing : incoming;

  return {
    name: pickBetterText(base.name, other.name),
    website_url: pickBetterText(base.website_url, other.website_url),
    description: pickBetterText(base.description, other.description).slice(0, 800),
    suggested_us_network_status: base.suggested_us_network_status || other.suggested_us_network_status,
    us_locations: uniqueLocations([...base.us_locations, ...other.us_locations]),
    sectors: uniqueStrings([...base.sectors, ...other.sectors]),
    flemish_belgian_relevance: pickBetterText(
      base.flemish_belgian_relevance,
      other.flemish_belgian_relevance,
    ).slice(0, 800),
    source_urls: uniqueStrings([...base.source_urls, ...other.source_urls]),
    confidence: Math.max(base.confidence || 0, other.confidence || 0),
  };
}

export function normalizeOrganizationLocation(raw: Record<string, unknown>, fallbackUrl: string): OrganizationLocationEvidence {
  return {
    city: normalizeWhitespace(safeString(raw.city || raw.location_city)),
    state: normalizeWhitespace(safeString(raw.state || raw.location_state)).toUpperCase(),
    country: normalizeWhitespace(safeString(raw.country || raw.location_country || "United States")),
    role: normalizeWhitespace(safeString(raw.role || raw.location_role)),
    label: normalizeWhitespace(safeString(raw.label)),
    description: normalizeWhitespace(safeString(raw.description)),
    source_url: normalizeWhitespace(safeString(raw.source_url)) || fallbackUrl,
    evidence_excerpt: normalizeWhitespace(safeString(raw.evidence_excerpt)),
    confidence: clampConfidence(raw.confidence),
    is_primary: Boolean(raw.is_primary),
  };
}

export function hasUsLocationSignal(location: OrganizationLocationEvidence): boolean {
  return Boolean(location.state || location.country.toLowerCase().includes("united states") || location.country.toLowerCase() === "usa");
}

export function primaryOrganizationDomain(candidate: Pick<DiscoveryOrganizationCandidate, "website_url" | "source_urls">): string {
  return extractDomain(candidate.website_url) ||
    candidate.source_urls.map((url) => extractDomain(url)).find(Boolean) ||
    "";
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = normalizeWhitespace(value);
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function uniqueLocations(locations: OrganizationLocationEvidence[]): OrganizationLocationEvidence[] {
  const seen = new Set<string>();
  const result: OrganizationLocationEvidence[] = [];
  for (const location of locations) {
    const key = [
      location.city.toLowerCase(),
      location.state.toLowerCase(),
      location.country.toLowerCase(),
      location.role.toLowerCase(),
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(location);
  }
  return result;
}

function pickBetterText(primary: string, secondary: string): string {
  const a = normalizeWhitespace(primary);
  const b = normalizeWhitespace(secondary);
  if (!a) return b;
  if (!b) return a;
  return b.length > a.length ? b : a;
}

function clampConfidence(value: unknown): number {
  return Number.isFinite(Number(value))
    ? Math.max(0, Math.min(1, Number(value)))
    : 0;
}
