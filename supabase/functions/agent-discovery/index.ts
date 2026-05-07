import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { searchWeb } from "../_shared/webSearch.ts";
import {
  createAdminClient,
  HttpError,
  requireStaffRole,
} from "../_shared/auth.ts";
import { agentRunErrorKindFor, structuredErrorBody, statusForError, wrapHandler } from "../_shared/httpError.ts";
import type { SupabaseAdminClient } from "../_shared/database.types.ts";
import {
  buildDiscoveryDerivedLabels,
  upsertDerivedLabelSuggestions,
} from "../_shared/derivedLabels.ts";
import {
  createGeminiContextCache,
  deleteGeminiContextCache,
  getGeminiModelChain,
  getPrimaryGeminiModel,
} from "../_shared/gemini.ts";
import {
  APIFY_ACTORS,
  ApifyError,
  getApifyUsage,
  runApifyActor,
} from "../_shared/apifyClient.ts";
import {
  canonicalizeUrl,
  classifyPageHeuristically,
  extractDomain,
  fetchPage,
  harvestFeedUrls,
  harvestSitemapUrls,
  hashString,
  normalizeWhitespace,
  pickTopChildLinks,
  safeString,
  type FetchedPage,
  type HarvestedFrontierSeed,
  type PageClassification,
  type ScoredChildLink,
} from "../_shared/discovery.ts";
import {
  hasUsLocationSignal,
  likelySameOrganization,
  mergeOrganizationCandidates,
  normalizeOrganizationLocation,
  normalizeOrganizationName,
  normalizeOrganizationWebsite,
  organizationCandidateKey,
  primaryOrganizationDomain,
  type DiscoveryOrganizationCandidate,
  type OrganizationLocationEvidence,
  type OrganizationNetworkStatus,
} from "../_shared/discoveryOrganizations.ts";
import { createLogger } from "../_shared/log.ts";

const log = createLogger("agent-discovery");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, apikey, x-client-info",
};

const DEFAULT_BATCH_SIZE = 10;
const MAX_BATCH_SIZE = 20;
const MAX_SEARCH_QUERIES = 6;
const MAX_DEPTH = 2;
const MAX_CHILD_LINKS = 5;
const DEFAULT_PER_DOMAIN_RUN_LIMIT = 3;
const MAX_LINKEDIN_ENRICHMENTS = 3;
const LINKEDIN_ENRICHMENT_TIMEOUT_SECS = 12;
const MAX_SITEMAP_SEEDS = 12;
const MAX_RSS_SEEDS = 8;
const MAX_GAP_TARGETS = 6;
const SITEMAP_HARVEST_COOLDOWN_HOURS = 24 * 7;
const RSS_HARVEST_COOLDOWN_HOURS = 24 * 3;
const PROVEN_DOMAIN_YIELD_SCORE = 0.75;
const GEMINI_REQUEST_TIMEOUT_MS = 30_000;
const EXTRACTION_PRIMARY_TIMEOUT_MS = 18_000;
const EXTRACTION_FALLBACK_TIMEOUT_MS = 10_000;
const EXTRACTION_TIMEOUT_RETRY_HOURS = 6;
const GEMINI_MAX_ATTEMPTS_PER_MODEL = 2;
const MAX_EXTRACTION_MODELS = 2;
const EXTRACTION_CACHE_MIN_CHARS = 2200;
const EXTRACTION_CACHE_TTL_SECONDS = 15 * 60;

const PAGE_CLASSIFICATION_SCHEMA = {
  type: "OBJECT",
  properties: {
    page_type: {
      type: "STRING",
      enum: [
        "person_profile",
        "team_or_roster",
        "lab_or_group_page",
        "article_or_press_release",
        "event_or_speaker_page",
        "directory_or_index_page",
        "organization_profile",
        "partner_or_program_page",
        "low_value_boilerplate",
        "irrelevant",
      ],
    },
    should_extract: { type: "BOOLEAN" },
    should_expand: { type: "BOOLEAN" },
    confidence: { type: "NUMBER" },
    reason: { type: "STRING" },
  },
  required: [
    "page_type",
    "should_extract",
    "should_expand",
    "confidence",
    "reason",
  ],
};

const PAGE_EXTRACTION_SCHEMA = {
  type: "OBJECT",
  properties: {
    contacts: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING" },
          bio: { type: "STRING" },
          occupation: { type: "STRING" },
          current_position: { type: "STRING" },
          location_city: { type: "STRING" },
          location_state: { type: "STRING" },
          suggested_us_network_status: {
            type: "STRING",
            enum: ["us_based", "us_connected_abroad", "needs_review"],
          },
          suggested_us_network_confidence: { type: "NUMBER" },
          current_location_city: { type: "STRING" },
          current_location_country: { type: "STRING" },
          suggested_us_connections: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                location_city: { type: "STRING" },
                location_state: { type: "STRING" },
                connection_label: { type: "STRING" },
                source_url: { type: "STRING" },
                evidence_excerpt: { type: "STRING" },
                confidence: { type: "NUMBER" },
              },
              required: [
                "location_city",
                "location_state",
                "connection_label",
                "source_url",
                "evidence_excerpt",
                "confidence",
              ],
            },
          },
          raw_location_text: { type: "STRING" },
          flemish_connection: { type: "STRING" },
          raw_flemish_text: { type: "STRING" },
          website_url: { type: "STRING" },
          email: { type: "STRING" },
          linkedin_url: { type: "STRING" },
          sectors: { type: "ARRAY", items: { type: "STRING" } },
          evidence_excerpt: { type: "STRING" },
          raw_role_text: { type: "STRING" },
          confidence: { type: "NUMBER" },
        },
        required: [
          "name",
          "bio",
          "occupation",
          "current_position",
          "location_city",
          "location_state",
          "suggested_us_network_status",
          "suggested_us_network_confidence",
          "current_location_city",
          "current_location_country",
          "suggested_us_connections",
          "raw_location_text",
          "flemish_connection",
          "raw_flemish_text",
          "website_url",
          "email",
          "linkedin_url",
          "sectors",
          "evidence_excerpt",
          "raw_role_text",
          "confidence",
        ],
      },
    },
    organizations: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING" },
          website_url: { type: "STRING" },
          description: { type: "STRING" },
          suggested_us_network_status: {
            type: "STRING",
            enum: [
              "us_based_organization",
              "belgian_organization_with_us_presence",
              "us_organization_connected_to_flanders",
              "institutional_connector",
            ],
          },
          us_locations: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                city: { type: "STRING" },
                state: { type: "STRING" },
                country: { type: "STRING" },
                role: { type: "STRING" },
                label: { type: "STRING" },
                description: { type: "STRING" },
                source_url: { type: "STRING" },
                evidence_excerpt: { type: "STRING" },
                confidence: { type: "NUMBER" },
                is_primary: { type: "BOOLEAN" },
              },
              required: [
                "city",
                "state",
                "country",
                "role",
                "label",
                "description",
                "source_url",
                "evidence_excerpt",
                "confidence",
                "is_primary",
              ],
            },
          },
          sectors: { type: "ARRAY", items: { type: "STRING" } },
          flemish_belgian_relevance: { type: "STRING" },
          evidence_excerpt: { type: "STRING" },
          raw_relevance_text: { type: "STRING" },
          raw_location_text: { type: "STRING" },
          raw_sector_text: { type: "STRING" },
          confidence: { type: "NUMBER" },
        },
        required: [
          "name",
          "website_url",
          "description",
          "suggested_us_network_status",
          "us_locations",
          "sectors",
          "flemish_belgian_relevance",
          "evidence_excerpt",
          "raw_relevance_text",
          "raw_location_text",
          "raw_sector_text",
          "confidence",
        ],
      },
    },
  },
  required: ["contacts", "organizations"],
};

const PAGE_CLASSIFICATION_PROMPT = `You are triaging web pages for a Flemish-American network discovery crawler.

Classify the page into one of:
- person_profile
- team_or_roster
- lab_or_group_page
- article_or_press_release
- event_or_speaker_page
- directory_or_index_page
- organization_profile
- partner_or_program_page
- low_value_boilerplate
- irrelevant

Rules:
- should_extract is true only when the page likely contains direct, attributable evidence about one or more people or organizations.
- should_expand is true when the page is worth following for child links, including promising directories or rosters.
- low_value_boilerplate covers privacy, login, cookie, careers, generic navigation, and similar pages.
- Prefer directory_or_index_page over team_or_roster when the page is mostly a large index/listing with many links and weak direct person evidence.
- Return concise reasons.`;

const PAGE_EXTRACTION_PROMPT = `You are extracting discovery candidates for a Flemish-American professional network.

Extract people ONLY when the page gives explicit evidence that they have a Belgian/Flemish connection and are either US-based or have a concrete US tie while based abroad. If location is unknown, include them only if the Flemish and US-tie evidence is strong.

Extract organizations ONLY when the page gives explicit evidence that the organization is part of the Flemish-American network: a Belgian/Flemish organization with US presence, a US organization with concrete Flemish/Belgian relevance, a US-based Belgian/Flemish organization, or an institutional connector. Never include an organization only because one extracted person works there.

Rules:
- Extract from profile pages, team rosters, lab/group pages, event speaker pages, articles, and press releases.
- Use empty strings for unknown scalar fields and [] for unknown sectors.
- location_state must be a 2-letter US state abbreviation when possible, otherwise empty.
- suggested_us_network_status is us_based for a current US base, us_connected_abroad for a non-US current base with a concrete US tie, and needs_review for ambiguous evidence.
- For us_connected_abroad, keep location_city/location_state empty unless they represent a US tie; put current abroad city/country in current_location_city/current_location_country and put US ties in suggested_us_connections.
- suggested_us_connections must include a US city/state, short connection label, evidence excerpt, source URL, and confidence.
- raw_location_text is the exact phrase from the page that suggests location.
- raw_flemish_text is the exact phrase from the page that suggests the Belgian/Flemish tie.
- raw_role_text is the exact role/title phrase from the page.
- evidence_excerpt must be a short verbatim or near-verbatim excerpt from the page supporting this person.
- confidence is 0 to 1.
- Only include email, website_url, and linkedin_url when explicitly present on the page.
- sectors must be chosen only from: Artificial Intelligence, Biotechnology, Finance, Culture & Arts, Education, Research.`;

type DiscoveryPageType = PageClassification["pageType"];

interface ExistingContactLookupRow {
  id: string;
  name: string;
  email?: string | null;
  linkedin_url?: string | null;
  website_url?: string | null;
  current_position?: string | null;
  occupation?: string | null;
  location_city?: string | null;
  location_state?: string | null;
  bio?: string | null;
  flemish_connection?: string | null;
  suggested_us_network_status?: string | null;
  suggested_us_network_confidence?: number | string | null;
  current_location_city?: string | null;
  current_location_country?: string | null;
  suggested_us_connections?: unknown[] | null;
  sectors?: string[] | null;
  source_urls?: string[] | null;
  evidence_count?: number | null;
  last_evidence_at?: string | null;
  discovery_confidence?: number | string | null;
  candidate_key?: string | null;
}

interface ExtractedContact {
  name: string;
  bio: string;
  occupation: string;
  current_position: string;
  location_city: string;
  location_state: string;
  flemish_connection: string;
  suggested_us_network_status: "us_based" | "us_connected_abroad" | "needs_review";
  suggested_us_network_confidence: number;
  current_location_city: string;
  current_location_country: string;
  suggested_us_connections: Array<Record<string, unknown>>;
  website_url: string;
  email: string;
  linkedin_url: string;
  sectors: string[];
  source_urls: string[];
}

interface ExtractedPageContact extends ExtractedContact {
  raw_location_text: string;
  raw_flemish_text: string;
  evidence_excerpt: string;
  raw_role_text: string;
  extraction_confidence: number;
}

interface ExtractedPageOrganization extends DiscoveryOrganizationCandidate {
  evidence_excerpt: string;
  raw_relevance_text: string;
  raw_location_text: string;
  raw_sector_text: string;
}

interface DiscoveryEvidenceInput {
  pageUrl: string;
  pageTitle: string;
  pageType: string;
  sourceType: string;
  evidenceExcerpt: string;
  rawLocationText: string;
  rawFlemishText: string;
  rawRoleText: string;
  extractionConfidence: number;
  locationCity: string;
  locationState: string;
  discoveredVia: string;
  parentUrl: string | null;
  fetchedAt: string;
  discoveryPageId: string | null;
}

interface OrganizationEvidenceInput {
  pageUrl: string;
  pageTitle: string;
  pageType: string;
  sourceType: string;
  sourceName: string;
  sourceUrl: string;
  evidenceExcerpt: string;
  rawRelevanceText: string;
  rawLocationText: string;
  rawSectorText: string;
  normalizedLocationCity: string;
  normalizedLocationState: string;
  normalizedLocationCountry: string;
  confidence: number;
  observedAt: string;
  discoveryPageId: string | null;
}

interface CandidateBundle {
  contact: ExtractedContact;
  evidence: DiscoveryEvidenceInput[];
  candidateKey: string | null;
}

interface OrganizationCandidateBundle {
  organization: DiscoveryOrganizationCandidate;
  evidence: OrganizationEvidenceInput[];
  candidateKey: string;
}

interface LinkedInProfile {
  firstName?: string;
  lastName?: string;
  fullName?: string;
  headline?: string;
  location?: string;
  linkedInProfileUrl?: string;
  profileUrl?: string;
  company?: string;
  companyName?: string;
  position?: string;
  title?: string;
  summary?: string;
  description?: string;
}

interface DiscoverySourcePack {
  id: string;
  key: string;
  name: string;
  query_templates: string[] | null;
  coverage_target_keys: string[] | null;
  priority_boost: number | null;
  max_seed_urls_per_run: number | null;
  refresh_interval_days: number | null;
  last_seeded_at: string | null;
}

interface SearchSeedPlan {
  query: string;
  sourceType: "custom_query" | "source_pack" | "entity_pivot";
  sourcePackId: string | null;
  sourcePackKey: string | null;
  priorityBoost: number;
  maxSeedUrls: number;
  coverageTargetKey: string | null;
  gapLabel: string | null;
  gapScore: number;
  gapSector: string | null;
  entityKey: string | null;
  entityName: string | null;
  entityType: string | null;
}

interface FrontierRow {
  id: string;
  url: string;
  canonical_url: string;
  domain: string;
  priority_score: number;
  depth: number;
  discovered_from_url: string | null;
  discovery_reason: string | null;
  source_type: string;
  source_pack_id: string | null;
  pivot_entity_key: string | null;
  pivot_entity_name: string | null;
  pivot_entity_type: string | null;
  search_query: string | null;
  anchor_text: string | null;
  title: string | null;
  content_hash: string | null;
  fetch_error_count: number | null;
}

interface EntityPivotPlanRow {
  entity_key: string;
  entity_name: string;
  entity_type: string;
  coverage_target_keys: string[];
  seed_queries: string[];
  source_urls: string[];
  source_count: number;
  strong_source_count: number;
  approved_contact_count: number;
  pending_contact_count: number;
  avg_confidence: number | string | null;
  max_source_strength: number | string | null;
  seeded_frontier_count: number;
  last_seeded_at: string | null;
  last_seen_at: string | null;
  priority_score: number | string | null;
}

interface DiscoveryDomainPolicy {
  domain: string;
  status: string;
  weekly_fetch_budget: number | null;
  yield_score: number | null;
  revisit_interval_hours: number | null;
  candidates_approved: number | null;
  candidates_rejected: number | null;
  duplicate_candidates: number | null;
  recent_fetches_7d: number | null;
  remaining_budget_7d: number | null;
  last_approved_contact_at: string | null;
  last_sitemap_at: string | null;
  last_rss_at: string | null;
}

interface CoverageGapRow {
  geography_key: string;
  geography_type: "state" | "metro";
  label: string;
  sector_emphasis: string[] | null;
  gap_score: number | null;
}

interface StepLog {
  step: string;
  timestamp: string;
  elapsed: string;
  status: "ok" | "error" | "skipped";
  detail: Record<string, unknown>;
}

interface FrontierUpsertRow {
  url: string;
  canonical_url: string;
  domain: string;
  priority_score: number;
  depth: number;
  discovered_from_url: string | null;
  discovery_reason: string;
  source_type: string;
  source_pack_id: string | null;
  pivot_entity_key: string | null;
  pivot_entity_name: string | null;
  pivot_entity_type: string | null;
  search_query: string | null;
  anchor_text: string | null;
  title: string | null;
  next_fetch_at: string;
}

interface PageProcessResult {
  pageId: string | null;
  classification: PageClassification;
  extractedBundles: CandidateBundle[];
  extractedOrganizationBundles: OrganizationCandidateBundle[];
  childLinksQueued: number;
  duplicatesSkipped: number;
  organizationDuplicatesSkipped: number;
  derivedLabelsUpserted: number;
  insertedContacts: number;
  mergedContacts: number;
  insertedOrganizations: number;
  mergedOrganizations: number;
  linkedinSearches: number;
  sitemapSeeded: number;
  rssSeeded: number;
}

interface EntityPivotCandidate {
  entityKey: string;
  entityName: string;
  entityType: string;
  normalizedDomain: string | null;
  coverageTargetKeys: string[];
  seedQueries: string[];
  sourceUrl: string;
  sourceTitle: string | null;
  sourcePageType: string | null;
  sourceExcerpt: string | null;
  confidence: number;
  sourceStrength: number;
}

const ENTITY_SHORT_NAMES = new Set([
  "baef",
  "imec",
  "ugent",
  "vub",
  "uantwerp",
  "mit",
  "nih",
  "ucla",
  "nyu",
]);

const ENTITY_STOPWORDS = new Set([
  "belgian",
  "flemish",
  "united states",
  "usa",
  "us",
  "team",
  "faculty",
  "leadership",
  "board",
  "speaker",
  "speakers",
  "members",
  "member",
  "alumni",
  "fellows",
  "professional",
  "researcher",
  "research",
]);

const US_STATE_CODES = new Set([
  "AL",
  "AK",
  "AZ",
  "AR",
  "CA",
  "CO",
  "CT",
  "DE",
  "FL",
  "GA",
  "HI",
  "ID",
  "IL",
  "IN",
  "IA",
  "KS",
  "KY",
  "LA",
  "ME",
  "MD",
  "MA",
  "MI",
  "MN",
  "MS",
  "MO",
  "MT",
  "NE",
  "NV",
  "NH",
  "NJ",
  "NM",
  "NY",
  "NC",
  "ND",
  "OH",
  "OK",
  "OR",
  "PA",
  "RI",
  "SC",
  "SD",
  "TN",
  "TX",
  "UT",
  "VT",
  "VA",
  "WA",
  "WV",
  "WI",
  "WY",
  "DC",
]);

const US_STATE_NAMES = new Set([
  "alabama",
  "alaska",
  "arizona",
  "arkansas",
  "california",
  "colorado",
  "connecticut",
  "delaware",
  "florida",
  "georgia",
  "hawaii",
  "idaho",
  "illinois",
  "indiana",
  "iowa",
  "kansas",
  "kentucky",
  "louisiana",
  "maine",
  "maryland",
  "massachusetts",
  "michigan",
  "minnesota",
  "mississippi",
  "missouri",
  "montana",
  "nebraska",
  "nevada",
  "new hampshire",
  "new jersey",
  "new mexico",
  "new york",
  "north carolina",
  "north dakota",
  "ohio",
  "oklahoma",
  "oregon",
  "pennsylvania",
  "rhode island",
  "south carolina",
  "south dakota",
  "tennessee",
  "texas",
  "utah",
  "vermont",
  "virginia",
  "washington",
  "west virginia",
  "wisconsin",
  "wyoming",
  "district of columbia",
]);

const NON_US_KEYWORDS = [
  "belgium",
  "brussels",
  "antwerp",
  "ghent",
  "leuven",
  "flanders",
  "wallonia",
  "europe",
  "netherlands",
  "france",
  "germany",
  "london",
  "paris",
  "berlin",
  "amsterdam",
];

function normalizeName(name: string): string {
  return normalizeWhitespace(safeString(name).toLowerCase());
}

function normalizeEmail(email: string): string {
  return normalizeWhitespace(safeString(email).toLowerCase());
}

function normalizeLinkedInUrl(url: string): string {
  return normalizeWhitespace(safeString(url)).replace(/\/+$/, "").toLowerCase();
}

function normalizeWebsiteUrl(url: string): string {
  return normalizeWhitespace(safeString(url))
    .replace(/\/+$/, "")
    .replace(/^https?:\/\/(www\.)?/i, "")
    .toLowerCase();
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

function normalizeEntityName(value: string): string {
  return normalizeWhitespace(
    safeString(value)
      .replace(/\([^)]*\)/g, " ")
      .replace(/[|/]+/g, " ")
      .replace(/\s+-\s+/g, " ")
      .replace(/\s+/g, " "),
  );
}

function normalizeEntityKey(value: string): string {
  return normalizeEntityName(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function looksLikeGenericEntity(value: string): boolean {
  const normalized = normalizeEntityKey(value);
  if (!normalized) return true;
  if (ENTITY_STOPWORDS.has(normalized)) return true;
  if (normalized.length < 5 && !ENTITY_SHORT_NAMES.has(normalized)) return true;
  return false;
}

function looksLikePersonName(candidate: string, contactName: string): boolean {
  const normalizedCandidate = normalizeEntityKey(candidate);
  const normalizedContactName = normalizeName(contactName).replace(/[^a-z0-9]+/g, " ").trim();

  if (!normalizedCandidate || !normalizedContactName) return false;
  if (normalizedCandidate === normalizedContactName) return true;

  const candidateWords = normalizedCandidate.split(" ").filter(Boolean);
  const contactWords = normalizedContactName.split(" ").filter(Boolean);
  if (candidateWords.length >= 2 && candidateWords.length <= 4 && candidateWords.join(" ") === contactWords.join(" ")) {
    return true;
  }

  return false;
}

function extractEntityFromText(value: string): string {
  const raw = safeString(value).trim();
  const titledParts = raw
    .split(/\s+\|\s+|\s+-\s+/)
    .map((part) => normalizeEntityName(part))
    .filter(Boolean);
  if (titledParts.length > 1) {
    return titledParts[titledParts.length - 1];
  }

  const normalized = normalizeEntityName(value);
  if (!normalized) return "";

  const patterns = [
    /\bat\s+([^,.;|]+)/i,
    /\bwith\s+([^,.;|]+)/i,
    /\bfor\s+([^,.;|]+)/i,
    /\bof\s+([^,.;|]+)/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match?.[1]) {
      return normalizeEntityName(match[1]);
    }
  }

  return normalized;
}

function inferEntityType(entityName: string, pageType?: string | null): string {
  const normalized = normalizeEntityKey(entityName);

  if (
    normalized.includes("lab") ||
    normalized.includes("laboratory") ||
    normalized.includes("research center") ||
    normalized.includes("research centre") ||
    normalized.includes("research group") ||
    normalized.includes("institute") ||
    normalized.includes("department")
  ) {
    return "lab";
  }

  if (
    normalized.includes("fellowship") ||
    normalized.includes("fellows") ||
    normalized.includes("program") ||
    normalized.includes("programme") ||
    normalized.includes("scholar")
  ) {
    return "fellowship";
  }

  if (
    normalized.includes("advisory") ||
    normalized.includes("board") ||
    normalized.includes("committee") ||
    normalized.includes("trustee")
  ) {
    return "advisory_board";
  }

  if (
    normalized.includes("conference") ||
    normalized.includes("summit") ||
    normalized.includes("symposium") ||
    normalized.includes("forum") ||
    normalized.includes("event") ||
    normalized.includes("speaker")
  ) {
    return "event";
  }

  if (
    normalized.includes("association") ||
    normalized.includes("society") ||
    normalized.includes("network") ||
    normalized.includes("chamber")
  ) {
    return "association";
  }

  if (
    normalized.includes("university") ||
    normalized.includes("college") ||
    normalized.includes("school") ||
    normalized.includes("ku leuven") ||
    normalized.includes("ugent") ||
    normalized.includes("vub") ||
    normalized.includes("uantwerp")
  ) {
    return "institution";
  }

  if (pageType === "lab_or_group_page") return "lab";
  if (pageType === "event_or_speaker_page") return "event";

  return "organization";
}

function buildPivotSeedQueries(entityName: string, entityType: string): string[] {
  const quoted = `"${entityName}"`;

  switch (entityType) {
    case "lab":
      return [
        `${quoted} team United States`,
        `${quoted} members United States`,
        `${quoted} faculty United States`,
      ];
    case "fellowship":
      return [
        `${quoted} fellows United States`,
        `${quoted} alumni United States`,
        `${quoted} placements United States`,
      ];
    case "advisory_board":
      return [
        `${quoted} advisory board United States`,
        `${quoted} leadership United States`,
        `${quoted} board members United States`,
      ];
    case "event":
      return [
        `${quoted} speakers United States`,
        `${quoted} agenda United States`,
        `${quoted} participants United States`,
      ];
    case "association":
      return [
        `${quoted} board United States`,
        `${quoted} members United States`,
        `${quoted} events United States`,
      ];
    case "institution":
      return [
        `${quoted} alumni United States`,
        `${quoted} faculty United States`,
        `${quoted} team United States`,
      ];
    default:
      return [
        `${quoted} team United States`,
        `${quoted} leadership United States`,
        `${quoted} advisory board United States`,
      ];
  }
}

function buildCoverageTargetKeys(
  contact: ExtractedContact,
  evidence: DiscoveryEvidenceInput[],
): string[] {
  const state = normalizeWhitespace(contact.location_state).toUpperCase() ||
    normalizeWhitespace(evidence.find((item) => item.locationState)?.locationState || "").toUpperCase();

  return state ? [`state:${state}`] : [];
}

function extractPivotCandidates(
  contact: ExtractedContact,
  evidence: DiscoveryEvidenceInput[],
): EntityPivotCandidate[] {
  const collected = new Map<string, EntityPivotCandidate>();
  const defaultEvidence = evidence[0];
  if (!defaultEvidence) return [];

  const maybeAdd = (
    rawEntity: string,
    source: DiscoveryEvidenceInput,
    baseStrength: number,
    preferredType?: string | null,
  ) => {
    const entityName = normalizeEntityName(extractEntityFromText(rawEntity));
    if (!entityName) return;
    if (looksLikeGenericEntity(entityName)) return;
    if (looksLikePersonName(entityName, contact.name)) return;

    const entityType = preferredType || inferEntityType(entityName, source.pageType);
    const entityKey = `${entityType}:${normalizeEntityKey(entityName)}`;
    if (!entityKey || entityKey.endsWith(":")) return;

    const candidate: EntityPivotCandidate = {
      entityKey,
      entityName,
      entityType,
      normalizedDomain: extractDomain(source.pageUrl) || null,
      coverageTargetKeys: buildCoverageTargetKeys(contact, evidence),
      seedQueries: buildPivotSeedQueries(entityName, entityType),
      sourceUrl: source.pageUrl,
      sourceTitle: source.pageTitle || null,
      sourcePageType: source.pageType || null,
      sourceExcerpt: source.evidenceExcerpt || source.rawRoleText || null,
      confidence: Number(source.extractionConfidence || 0),
      sourceStrength: Number((baseStrength + Number(source.extractionConfidence || 0)).toFixed(2)),
    };

    const existing = collected.get(entityKey);
    if (!existing || candidate.sourceStrength > existing.sourceStrength) {
      collected.set(entityKey, candidate);
    }
  };

  for (const item of evidence) {
    if (contact.current_position) {
      maybeAdd(contact.current_position, item, 2.25);
    }
    if (contact.flemish_connection) {
      maybeAdd(contact.flemish_connection, item, 1.75);
    }
    if (item.rawRoleText) {
      maybeAdd(item.rawRoleText, item, 1.5);
    }
    if (item.rawFlemishText) {
      maybeAdd(item.rawFlemishText, item, 1.5);
    }
    if (
      item.pageTitle &&
      item.pageType !== "person_profile" &&
      item.pageType !== "article_or_press_release"
    ) {
      maybeAdd(item.pageTitle, item, 2.5, inferEntityType(item.pageTitle, item.pageType));
    }
  }

  return [...collected.values()]
    .sort((a, b) => b.sourceStrength - a.sourceStrength)
    .slice(0, 4);
}

function buildCandidateKey(
  contact: ExtractedContact,
  evidence: DiscoveryEvidenceInput[],
): string | null {
  const linkedin = normalizeLinkedInUrl(contact.linkedin_url);
  if (linkedin) return `linkedin:${linkedin}`;

  const email = normalizeEmail(contact.email);
  if (email) return `email:${email}`;

  const website = normalizeWebsiteUrl(contact.website_url);
  if (website) return `site:${website}`;

  const normalizedName = normalizeName(contact.name).replace(/[^a-z0-9]+/g, " ").trim();
  if (!normalizedName) return null;

  const bestPivot = extractPivotCandidates(contact, evidence)[0];
  const stateSignal =
    normalizeWhitespace(contact.location_state).toLowerCase() ||
    normalizeWhitespace(evidence.find((item) => item.locationState)?.locationState || "").toLowerCase();
  const domainSignal = extractDomain(evidence[0]?.pageUrl || "") || "";

  if (bestPivot) {
    const entitySignal = bestPivot.entityKey.split(":").slice(1).join(":");
    return `candidate:${normalizedName}|${entitySignal}${stateSignal ? `|${stateSignal}` : ""}`;
  }

  if (stateSignal) {
    return `candidate:${normalizedName}|${stateSignal}`;
  }

  if (domainSignal) {
    return `candidate:${normalizedName}|${domainSignal}`;
  }

  return null;
}

function parseLocation(location: string): { city: string; state: string } {
  const parts = safeString(location).split(",").map((part) => part.trim());
  const city = parts[0] || "";
  const state = parts[1] || "";
  return { city, state };
}

function contactScore(contact: ExtractedContact): number {
  let score = 0;
  if (normalizeLinkedInUrl(contact.linkedin_url)) score += 5;
  if (normalizeEmail(contact.email)) score += 4;
  if (normalizeWebsiteUrl(contact.website_url)) score += 3;
  if (contact.flemish_connection) score += 3;
  if (contact.current_position) score += 2;
  if (contact.bio) score += Math.min(contact.bio.length / 120, 3);
  if (contact.location_state) score += 1;
  if (contact.sectors.length > 0) score += 1;
  if (contact.source_urls.length > 0) score += 1;
  return score;
}

function pickBetterValue(primary: string, secondary: string): string {
  const a = normalizeWhitespace(primary);
  const b = normalizeWhitespace(secondary);
  if (!a) return b;
  if (!b) return a;
  return b.length > a.length ? b : a;
}

function mergeContacts(existing: ExtractedContact, incoming: ExtractedContact): ExtractedContact {
  const preferIncoming = contactScore(incoming) > contactScore(existing);
  const base = preferIncoming ? incoming : existing;
  const other = preferIncoming ? existing : incoming;

  const baseCity = normalizeWhitespace(base.location_city);
  const baseState = normalizeWhitespace(base.location_state);
  const otherCity = normalizeWhitespace(other.location_city);
  const otherState = normalizeWhitespace(other.location_state);
  const useOtherLocation =
    (!baseState && otherState) ||
    (!baseCity && otherCity) ||
    (!baseCity && !baseState && (otherCity || otherState));

  return {
    name: pickBetterValue(base.name, other.name),
    bio: pickBetterValue(base.bio, other.bio).slice(0, 500),
    occupation: pickBetterValue(base.occupation, other.occupation),
    current_position: pickBetterValue(base.current_position, other.current_position),
    location_city: useOtherLocation ? otherCity : baseCity,
    location_state: useOtherLocation ? otherState : baseState,
    flemish_connection: pickBetterValue(base.flemish_connection, other.flemish_connection),
    suggested_us_network_status:
      base.suggested_us_network_status === "us_connected_abroad" ||
      other.suggested_us_network_status === "us_connected_abroad"
        ? "us_connected_abroad"
        : base.suggested_us_network_status === "needs_review"
          ? "needs_review"
          : other.suggested_us_network_status,
    suggested_us_network_confidence: Math.max(
      base.suggested_us_network_confidence || 0,
      other.suggested_us_network_confidence || 0,
    ),
    current_location_city: pickBetterValue(
      base.current_location_city,
      other.current_location_city,
    ),
    current_location_country: pickBetterValue(
      base.current_location_country,
      other.current_location_country,
    ),
    suggested_us_connections: [
      ...base.suggested_us_connections,
      ...other.suggested_us_connections,
    ],
    website_url: pickBetterValue(base.website_url, other.website_url),
    email: pickBetterValue(base.email, other.email),
    linkedin_url: pickBetterValue(base.linkedin_url, other.linkedin_url),
    sectors: uniqueStrings([...base.sectors, ...other.sectors]),
    source_urls: uniqueStrings([...base.source_urls, ...other.source_urls]),
  };
}

function locationsCompatible(a: ExtractedContact, b: ExtractedContact): boolean {
  const aState = normalizeWhitespace(a.location_state).toLowerCase();
  const bState = normalizeWhitespace(b.location_state).toLowerCase();
  if (aState && bState && aState !== bState) return false;

  const aCity = normalizeWhitespace(a.location_city).toLowerCase();
  const bCity = normalizeWhitespace(b.location_city).toLowerCase();
  if (aCity && bCity && aCity !== bCity && aState && bState) return false;

  return true;
}

function hasConflictingStrongIdentity(a: ExtractedContact, b: ExtractedContact): boolean {
  const emailA = normalizeEmail(a.email);
  const emailB = normalizeEmail(b.email);
  if (emailA && emailB && emailA !== emailB) return true;

  const linkedinA = normalizeLinkedInUrl(a.linkedin_url);
  const linkedinB = normalizeLinkedInUrl(b.linkedin_url);
  if (linkedinA && linkedinB && linkedinA !== linkedinB) return true;

  const websiteA = normalizeWebsiteUrl(a.website_url);
  const websiteB = normalizeWebsiteUrl(b.website_url);
  if (websiteA && websiteB && websiteA !== websiteB) return true;

  return false;
}

function likelySameContact(a: ExtractedContact, b: ExtractedContact): boolean {
  const linkedinA = normalizeLinkedInUrl(a.linkedin_url);
  const linkedinB = normalizeLinkedInUrl(b.linkedin_url);
  if (linkedinA && linkedinB && linkedinA === linkedinB) return true;

  const emailA = normalizeEmail(a.email);
  const emailB = normalizeEmail(b.email);
  if (emailA && emailB && emailA === emailB) return true;

  const websiteA = normalizeWebsiteUrl(a.website_url);
  const websiteB = normalizeWebsiteUrl(b.website_url);
  if (websiteA && websiteB && websiteA === websiteB) return true;

  const nameA = normalizeName(a.name);
  const nameB = normalizeName(b.name);
  if (!nameA || nameA !== nameB) return false;

  if (hasConflictingStrongIdentity(a, b)) return false;

  return locationsCompatible(a, b);
}

function mergeBundles(existing: CandidateBundle, incoming: CandidateBundle): CandidateBundle {
  return {
    contact: mergeContacts(existing.contact, incoming.contact),
    evidence: [...existing.evidence, ...incoming.evidence],
    candidateKey: existing.candidateKey || incoming.candidateKey,
  };
}

function consolidateBundles(bundles: CandidateBundle[]): CandidateBundle[] {
  const consolidated: CandidateBundle[] = [];

  for (const bundle of bundles) {
    const matchIndex = consolidated.findIndex((candidate) => {
      if (candidate.candidateKey && bundle.candidateKey && candidate.candidateKey === bundle.candidateKey) {
        return true;
      }

      return likelySameContact(candidate.contact, bundle.contact);
    });

    if (matchIndex === -1) {
      consolidated.push(bundle);
      continue;
    }

    consolidated[matchIndex] = mergeBundles(consolidated[matchIndex], bundle);
  }

  return consolidated;
}

function mergeOrganizationBundles(
  existing: OrganizationCandidateBundle,
  incoming: OrganizationCandidateBundle,
): OrganizationCandidateBundle {
  const merged = mergeOrganizationCandidates(existing.organization, incoming.organization);
  return {
    organization: merged,
    evidence: [...existing.evidence, ...incoming.evidence],
    candidateKey: existing.candidateKey || incoming.candidateKey || organizationCandidateKey(merged),
  };
}

function consolidateOrganizationBundles(bundles: OrganizationCandidateBundle[]): OrganizationCandidateBundle[] {
  const consolidated: OrganizationCandidateBundle[] = [];

  for (const bundle of bundles) {
    const matchIndex = consolidated.findIndex((candidate) =>
      candidate.candidateKey === bundle.candidateKey ||
      likelySameOrganization(candidate.organization, bundle.organization)
    );

    if (matchIndex === -1) {
      consolidated.push(bundle);
      continue;
    }

    consolidated[matchIndex] = mergeOrganizationBundles(consolidated[matchIndex], bundle);
  }

  return consolidated;
}

function mapLinkedInProfile(profile: LinkedInProfile): ExtractedContact {
  const name =
    safeString(profile.fullName) ||
    `${safeString(profile.firstName)} ${safeString(profile.lastName)}`.trim();
  const position =
    safeString(profile.headline) ||
    safeString(profile.position) ||
    safeString(profile.title);
  const linkedinUrl =
    safeString(profile.linkedInProfileUrl) || safeString(profile.profileUrl);
  const location = parseLocation(safeString(profile.location));

  return {
    name,
    bio: safeString(profile.summary || profile.description).slice(0, 500),
    occupation: "",
    current_position: position,
    location_city: location.city,
    location_state: location.state,
    flemish_connection: "",
    suggested_us_network_status: isLikelyUS({
      location_city: location.city,
      location_state: location.state,
    })
      ? "us_based"
      : "needs_review",
    suggested_us_network_confidence: 0,
    current_location_city: "",
    current_location_country: "",
    suggested_us_connections: [],
    website_url: "",
    email: "",
    linkedin_url: linkedinUrl,
    sectors: [],
    source_urls: linkedinUrl ? [linkedinUrl] : [],
  };
}

function isLikelyUS(contact: Pick<ExtractedContact, "location_city" | "location_state">): boolean {
  const state = contact.location_state.trim();
  const stateUpper = state.toUpperCase();
  const stateLower = state.toLowerCase();

  if (stateUpper && (US_STATE_CODES.has(stateUpper) || US_STATE_NAMES.has(stateLower))) {
    return true;
  }

  if (state && NON_US_KEYWORDS.some((keyword) => stateLower.includes(keyword))) {
    return false;
  }

  const cityLower = contact.location_city.toLowerCase();
  if (NON_US_KEYWORDS.some((keyword) => cityLower.includes(keyword))) {
    return false;
  }

  return true;
}

function normalizePersonUsNetworkStatus(
  value: unknown,
): ExtractedContact["suggested_us_network_status"] {
  if (value === "us_connected_abroad" || value === "needs_review") return value;
  return "us_based";
}

function clampConfidence(value: unknown): number {
  return Number.isFinite(Number(value))
    ? Math.max(0, Math.min(1, Number(value)))
    : 0;
}

function hashSeed(seed: string): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function selectRotatingItems<T>(items: T[], count: number, seed: string): T[] {
  if (items.length <= count) return [...items];

  const start = hashSeed(seed) % items.length;
  const result: T[] = [];
  for (let index = 0; index < Math.min(count, items.length); index += 1) {
    result.push(items[(start + index) % items.length]);
  }
  return result;
}

function hoursSince(timestamp: string | null | undefined): number {
  if (!timestamp) return Number.POSITIVE_INFINITY;
  const delta = Date.now() - new Date(timestamp).getTime();
  return delta / (1000 * 60 * 60);
}

function queryIncludesToken(query: string, token: string): boolean {
  const normalizedQuery = query.toLowerCase();
  const normalizedToken = token.toLowerCase();
  return normalizedQuery.includes(normalizedToken);
}

function pickGapForSourcePack(
  pack: DiscoverySourcePack,
  gaps: CoverageGapRow[],
): CoverageGapRow | null {
  const packTargets = new Set((pack.coverage_target_keys || []).map((value) => value.toLowerCase()));
  const scoped = packTargets.size > 0
    ? gaps.filter((gap) => packTargets.has(gap.geography_key.toLowerCase()))
    : gaps;

  return scoped
    .filter((gap) => Number(gap.gap_score || 0) > 0)
    .sort((a, b) => Number(b.gap_score || 0) - Number(a.gap_score || 0))[0] || null;
}

function pickGapSector(gap: CoverageGapRow | null): string | null {
  const sectors = Array.isArray(gap?.sector_emphasis) ? gap?.sector_emphasis : [];
  return sectors.find((value) => normalizeWhitespace(value).length > 0) || null;
}

function decorateQueryWithGap(baseQuery: string, gap: CoverageGapRow | null): string {
  if (!gap) return normalizeWhitespace(baseQuery);

  const sector = pickGapSector(gap);
  const parts = [normalizeWhitespace(baseQuery)];
  if (!queryIncludesToken(baseQuery, gap.label)) {
    parts.push(gap.label);
  }
  if (sector && !queryIncludesToken(baseQuery, sector)) {
    parts.push(sector);
  }

  return normalizeWhitespace(parts.join(" "));
}

function computeNextFetchAt(
  pageType: string,
  extractionCount: number,
  errorCount = 0,
  domainPolicy?: DiscoveryDomainPolicy | null,
): string {
  const now = new Date();
  let hours =
    pageType === "low_value_boilerplate" || pageType === "irrelevant"
      ? 24 * 45
      : extractionCount > 0
      ? 24 * 21
      : 24 * 14;

  const policyHours = Number(domainPolicy?.revisit_interval_hours || 0);
  if (policyHours > 0) {
    hours = extractionCount > 0 ? Math.min(hours, policyHours) : Math.max(hours, policyHours);
  }

  const penaltyHours = errorCount > 0 ? Math.min(errorCount * 6, 24 * 7) : 0;
  now.setHours(now.getHours() + hours + penaltyHours);
  return now.toISOString();
}

function computeRetryAt(hours: number): string {
  const next = new Date();
  next.setHours(next.getHours() + hours);
  return next.toISOString();
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAbortLikeError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") {
    return true;
  }

  const message = getErrorMessage(error).toLowerCase();
  return message.includes("signal has been aborted") ||
    message.includes("operation was aborted") ||
    message.includes("aborterror") ||
    message.includes("timed out");
}

function isRetryableUpstreamError(error: unknown): boolean {
  if (isAbortLikeError(error)) {
    return true;
  }

  const message = getErrorMessage(error).toLowerCase();
  return message.includes("429") ||
    message.includes("rate limited") ||
    message.includes("quota") ||
    message.includes("500") ||
    message.includes("502") ||
    message.includes("503") ||
    message.includes("504") ||
    message.includes("temporarily unavailable") ||
    message.includes("network") ||
    message.includes("econnreset") ||
    message.includes("socket hang up") ||
    message.includes("connection reset");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callGeminiJson<T>(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  schema: Record<string, unknown>,
  options?: {
    timeoutMs?: number;
    attemptsPerModel?: number;
    cachedContentName?: string;
  },
): Promise<T> {
  const timeoutMs = options?.timeoutMs || GEMINI_REQUEST_TIMEOUT_MS;
  const attemptsPerModel = options?.attemptsPerModel || GEMINI_MAX_ATTEMPTS_PER_MODEL;
  let lastError: unknown = new Error(`Gemini ${model} failed without a response`);

  for (let attempt = 0; attempt < attemptsPerModel; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
          },
          body: JSON.stringify(
            options?.cachedContentName
              ? {
                cachedContent: options.cachedContentName,
                contents: [{ role: "user", parts: [{ text: userPrompt }] }],
                generation_config: {
                  response_mime_type: "application/json",
                  response_schema: schema,
                  temperature: 0.1,
                },
              }
              : {
                system_instruction: { parts: [{ text: systemPrompt }] },
                contents: [{ role: "user", parts: [{ text: userPrompt }] }],
                generation_config: {
                  response_mime_type: "application/json",
                  response_schema: schema,
                  temperature: 0.1,
                },
              },
          ),
          signal: controller.signal,
        },
      );

      if (response.status === 429 || response.status >= 500) {
        lastError = new Error(`Gemini ${model} transient ${response.status}: ${(await response.text()).slice(0, 200)}`);
        if (attempt < attemptsPerModel - 1) {
          await sleep(400 * (attempt + 1));
          continue;
        }
        throw lastError;
      }

      if (!response.ok) {
        throw new Error(`Gemini ${model} failed (${response.status}): ${(await response.text()).slice(0, 400)}`);
      }

      const data = await response.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        throw new Error(`Gemini ${model} returned no JSON payload`);
      }

      return JSON.parse(text) as T;
    } catch (error) {
      lastError = isAbortLikeError(error)
        ? new Error(`Gemini ${model} timed out after ${Math.round(timeoutMs / 1000)}s`)
        : error;
      if (attempt < attemptsPerModel - 1 && isRetryableUpstreamError(lastError)) {
        await sleep(400 * (attempt + 1));
        continue;
      }
      throw lastError;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function classifyPageWithLLM(
  page: FetchedPage,
  geminiKey: string,
): Promise<PageClassification> {
  const prompt = `URL: ${page.canonicalUrl}
Title: ${page.title}
Excerpt: ${page.excerpt}
Content:
${page.text.slice(0, 4000)}
`;

  const parsed = await callGeminiJson<{
    page_type: DiscoveryPageType;
    should_extract: boolean;
    should_expand: boolean;
    confidence: number;
    reason: string;
  }>(
    geminiKey,
    getPrimaryGeminiModel("page_classification"),
    PAGE_CLASSIFICATION_PROMPT,
    prompt,
    PAGE_CLASSIFICATION_SCHEMA,
  );

  return {
    pageType: parsed.page_type,
    shouldExtract: parsed.should_extract,
    shouldExpand: parsed.should_expand,
    confidence: Math.max(0, Math.min(parsed.confidence || 0, 1)),
    reason: normalizeWhitespace(parsed.reason),
    method: "llm",
  };
}

function normalizeExtractedPageContact(raw: Record<string, unknown>, pageUrl: string): ExtractedPageContact {
  return {
    name: safeString(raw.name),
    bio: safeString(raw.bio),
    occupation: safeString(raw.occupation),
    current_position: safeString(raw.current_position),
    location_city: safeString(raw.location_city),
    location_state: safeString(raw.location_state).toUpperCase(),
    flemish_connection: safeString(raw.flemish_connection),
    suggested_us_network_status: normalizePersonUsNetworkStatus(
      raw.suggested_us_network_status,
    ),
    suggested_us_network_confidence: clampConfidence(
      raw.suggested_us_network_confidence,
    ),
    current_location_city: safeString(raw.current_location_city),
    current_location_country: safeString(raw.current_location_country),
    suggested_us_connections: Array.isArray(raw.suggested_us_connections)
      ? raw.suggested_us_connections
        .filter((value): value is Record<string, unknown> =>
          Boolean(value && typeof value === "object")
        )
      : [],
    website_url: safeString(raw.website_url),
    email: safeString(raw.email),
    linkedin_url: safeString(raw.linkedin_url),
    sectors: Array.isArray(raw.sectors)
      ? (raw.sectors as unknown[]).filter((value): value is string => typeof value === "string")
      : [],
    source_urls: [pageUrl],
    raw_location_text: safeString(raw.raw_location_text),
    raw_flemish_text: safeString(raw.raw_flemish_text),
    evidence_excerpt: safeString(raw.evidence_excerpt),
    raw_role_text: safeString(raw.raw_role_text),
    extraction_confidence: typeof raw.confidence === "number" ? raw.confidence : 0,
  };
}

function normalizeOrganizationNetworkStatus(value: unknown): OrganizationNetworkStatus {
  if (
    value === "belgian_organization_with_us_presence" ||
    value === "us_organization_connected_to_flanders" ||
    value === "institutional_connector"
  ) {
    return value;
  }
  return "us_based_organization";
}

function normalizeExtractedPageOrganization(raw: Record<string, unknown>, pageUrl: string): ExtractedPageOrganization {
  const locations = Array.isArray(raw.us_locations)
    ? raw.us_locations
      .filter((value): value is Record<string, unknown> => Boolean(value && typeof value === "object"))
      .map((location) => normalizeOrganizationLocation(location, pageUrl))
      .filter(hasUsLocationSignal)
    : [];

  return {
    name: safeString(raw.name),
    website_url: safeString(raw.website_url),
    description: safeString(raw.description),
    suggested_us_network_status: normalizeOrganizationNetworkStatus(raw.suggested_us_network_status),
    us_locations: locations,
    sectors: Array.isArray(raw.sectors)
      ? (raw.sectors as unknown[]).filter((value): value is string => typeof value === "string")
      : [],
    flemish_belgian_relevance: safeString(raw.flemish_belgian_relevance),
    source_urls: uniqueStrings([pageUrl, safeString(raw.website_url)]),
    confidence: clampConfidence(raw.confidence),
    evidence_excerpt: safeString(raw.evidence_excerpt),
    raw_relevance_text: safeString(raw.raw_relevance_text),
    raw_location_text: safeString(raw.raw_location_text),
    raw_sector_text: safeString(raw.raw_sector_text),
  };
}

async function extractCandidatesFromPage(
  page: FetchedPage,
  classification: PageClassification,
  geminiKey: string,
): Promise<{ contacts: ExtractedPageContact[]; organizations: ExtractedPageOrganization[] }> {
  const primaryMaxChars =
    classification.pageType === "team_or_roster"
      ? 5500
      : classification.pageType === "article_or_press_release"
      ? 5000
      : classification.pageType === "person_profile"
      ? 4500
      : 5000;
  const fallbackMaxChars = Math.min(
    primaryMaxChars,
    classification.pageType === "team_or_roster" ? 3200 : 2800,
  );
  const extractionModels = getGeminiModelChain("contact_extraction")
    .slice(0, MAX_EXTRACTION_MODELS);

  const attempts = [
    {
      model: extractionModels[0] || getPrimaryGeminiModel("contact_extraction"),
      maxChars: primaryMaxChars,
      timeoutMs: EXTRACTION_PRIMARY_TIMEOUT_MS,
    },
    {
      model: extractionModels[0] || getPrimaryGeminiModel("contact_extraction"),
      maxChars: fallbackMaxChars,
      timeoutMs: EXTRACTION_FALLBACK_TIMEOUT_MS,
    },
    ...(extractionModels[1]
      ? [{
        model: extractionModels[1],
        maxChars: fallbackMaxChars,
        timeoutMs: EXTRACTION_FALLBACK_TIMEOUT_MS,
      }]
      : []),
  ].filter((attempt, index, arr) =>
    arr.findIndex((candidate) =>
      candidate.model === attempt.model &&
      candidate.maxChars === attempt.maxChars &&
      candidate.timeoutMs === attempt.timeoutMs
    ) === index
  );

  let lastError: unknown = null;
  let fallbackCacheName: string | null = null;
  const repeatedPrimaryModel =
    attempts.filter((attempt) => attempt.model === attempts[0]?.model).length > 1
      ? attempts[0]?.model
      : null;
  const fallbackCachePrompt = `Page URL: ${page.canonicalUrl}
Page title: ${page.title}
Page type: ${classification.pageType}

Page content:
${page.text.slice(0, fallbackMaxChars)}
`;

  try {
    for (let index = 0; index < attempts.length; index += 1) {
      const attempt = attempts[index];
      const prompt = `Page URL: ${page.canonicalUrl}
Page title: ${page.title}
Page type: ${classification.pageType}

Page content:
${page.text.slice(0, attempt.maxChars)}
`;

      try {
        const shouldUseFallbackCache =
          repeatedPrimaryModel === attempt.model &&
          index > 0 &&
          fallbackMaxChars >= EXTRACTION_CACHE_MIN_CHARS;

        if (shouldUseFallbackCache && !fallbackCacheName) {
          const cacheKey = await hashString(page.canonicalUrl);
          fallbackCacheName = await createGeminiContextCache({
            apiKey: geminiKey,
            model: attempt.model,
            contentsText: fallbackCachePrompt,
            systemPrompt: PAGE_EXTRACTION_PROMPT,
            displayName: `discovery-extract-${cacheKey.slice(0, 12)}`,
            ttlSeconds: EXTRACTION_CACHE_TTL_SECONDS,
          });
        }

        const parsed = await callGeminiJson<{ contacts: Record<string, unknown>[]; organizations: Record<string, unknown>[] }>(
          geminiKey,
          attempt.model,
          PAGE_EXTRACTION_PROMPT,
          shouldUseFallbackCache
            ? "Extract discovery candidates from the cached page context."
            : prompt,
          PAGE_EXTRACTION_SCHEMA,
          {
            timeoutMs: attempt.timeoutMs,
            cachedContentName: shouldUseFallbackCache ? fallbackCacheName || undefined : undefined,
          },
        );

        const contacts = (Array.isArray(parsed.contacts) ? parsed.contacts : [])
          .map((contact) => normalizeExtractedPageContact(contact, page.canonicalUrl))
          .filter((contact) => normalizeWhitespace(contact.name).length > 0)
          .filter((contact) =>
            contact.suggested_us_network_status === "us_connected_abroad" ||
            isLikelyUS(contact)
          );
        const organizations = (Array.isArray(parsed.organizations) ? parsed.organizations : [])
          .map((organization) => normalizeExtractedPageOrganization(organization, page.canonicalUrl))
          .filter((organization) => normalizeWhitespace(organization.name).length > 0)
          .filter((organization) =>
            organization.us_locations.length > 0 ||
            organization.suggested_us_network_status === "belgian_organization_with_us_presence" ||
            organization.suggested_us_network_status === "institutional_connector"
          );

        return { contacts, organizations };
      } catch (error) {
        lastError = error;
      }
    }
  } finally {
    if (fallbackCacheName) {
      await deleteGeminiContextCache(geminiKey, fallbackCacheName).catch((error) => {
        log.warn("delete_gemini_context_cache_failed", error);
      });
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Failed to extract candidates from page");
}

async function loadSourcePacks(
  supabase: SupabaseAdminClient,
): Promise<DiscoverySourcePack[]> {
  const { data, error } = await supabase
    .from("discovery_source_packs")
    .select("id, key, name, query_templates, coverage_target_keys, priority_boost, max_seed_urls_per_run, refresh_interval_days, last_seeded_at")
    .eq("active", true)
    .order("last_seeded_at", { ascending: true, nullsFirst: true });

  if (error) {
    throw new Error(`Failed to load source packs: ${error.message}`);
  }

  return (data || []) as DiscoverySourcePack[];
}

async function loadCoverageGaps(
  supabase: SupabaseAdminClient,
): Promise<CoverageGapRow[]> {
  const { data, error } = await supabase
    .from("coverage_gaps")
    .select("geography_key, geography_type, label, sector_emphasis, gap_score")
    .order("gap_score", { ascending: false })
    .limit(MAX_GAP_TARGETS);

  if (error) {
    throw new Error(`Failed to load coverage gaps: ${error.message}`);
  }

  return (data || []) as CoverageGapRow[];
}

async function loadEntityPivots(
  supabase: SupabaseAdminClient,
): Promise<EntityPivotPlanRow[]> {
  const { data, error } = await supabase
    .from("ops_discovery_entity_pivots")
    .select("*")
    .or("approved_contact_count.gt.0,strong_source_count.gt.0")
    .order("priority_score", { ascending: false })
    .limit(8);

  if (error) {
    throw new Error(`Failed to load entity pivots: ${error.message}`);
  }

  return (data || []) as EntityPivotPlanRow[];
}

async function loadDomainPolicies(
  supabase: SupabaseAdminClient,
  domains: string[],
): Promise<Map<string, DiscoveryDomainPolicy>> {
  const normalizedDomains = uniqueStrings(domains).filter(Boolean);
  if (normalizedDomains.length === 0) {
    return new Map();
  }

  const { data, error } = await supabase
    .from("ops_discovery_domain_yield")
    .select("*")
    .in("domain", normalizedDomains);

  if (error) {
    throw new Error(`Failed to load domain policies: ${error.message}`);
  }

  return new Map(
    (data || []).map((row) => [
      row.domain,
      {
        domain: row.domain,
        status: row.status,
        weekly_fetch_budget: row.weekly_fetch_budget,
        yield_score: row.yield_score === null ? null : Number(row.yield_score),
        revisit_interval_hours: row.revisit_interval_hours,
        candidates_approved: row.candidates_approved,
        candidates_rejected: row.candidates_rejected,
        duplicate_candidates: row.duplicate_candidates,
        recent_fetches_7d: row.recent_fetches_7d,
        remaining_budget_7d: row.remaining_budget_7d,
        last_approved_contact_at: row.last_approved_contact_at,
        last_sitemap_at: row.last_sitemap_at,
        last_rss_at: row.last_rss_at,
      },
    ]),
  );
}

async function getQueuedFrontierCount(
  supabase: SupabaseAdminClient,
): Promise<number> {
  const { count, error } = await supabase
    .from("discovery_frontier")
    .select("id", { count: "exact", head: true })
    .in("status", ["queued", "done"])
    .lte("next_fetch_at", new Date().toISOString());

  if (error) {
    return 0;
  }

  return count || 0;
}

function buildSeedPlans(
  query: string,
  sourcePacks: DiscoverySourcePack[],
  coverageGaps: CoverageGapRow[],
  entityPivots: EntityPivotPlanRow[],
  runId?: string,
): SearchSeedPlan[] {
  const trimmedQuery = normalizeWhitespace(query);

  if (trimmedQuery) {
    return uniqueStrings([
      trimmedQuery,
      `${trimmedQuery} Belgian OR Flemish United States`,
      `${trimmedQuery} KU Leuven UGent VUB UAntwerp imec BAEF United States`,
    ])
      .slice(0, 3)
      .map((value) => ({
        query: value,
        sourceType: "custom_query" as const,
        sourcePackId: null,
        sourcePackKey: null,
        priorityBoost: 6,
        maxSeedUrls: 10,
        coverageTargetKey: null,
        gapLabel: null,
        gapScore: 0,
        gapSector: null,
        entityKey: null,
        entityName: null,
        entityType: null,
      }));
  }

  const seed = runId || new Date().toISOString().slice(0, 13);
  const selectedPacks = [...sourcePacks]
    .sort((a, b) => {
      const gapA = pickGapForSourcePack(a, coverageGaps);
      const gapB = pickGapForSourcePack(b, coverageGaps);
      const scoreA = Number(gapA?.gap_score || 0) + Number(a.priority_boost || 0);
      const scoreB = Number(gapB?.gap_score || 0) + Number(b.priority_boost || 0);
      return scoreB - scoreA;
    })
    .slice(0, 2);
  const plans: SearchSeedPlan[] = [];

  for (const pack of selectedPacks) {
    const queries = Array.isArray(pack.query_templates) ? pack.query_templates : [];
    const gap = pickGapForSourcePack(pack, coverageGaps);
    const gapScore = Number(gap?.gap_score || 0);
    const gapSector = pickGapSector(gap);
    const selectedQueries = selectRotatingItems(
      queries,
      Math.min(2, queries.length),
      `${seed}:${pack.key}`,
    );

    for (const planQuery of selectedQueries) {
      const decoratedQuery = decorateQueryWithGap(planQuery, gap);
      plans.push({
        query: decoratedQuery,
        sourceType: "source_pack",
        sourcePackId: pack.id,
        sourcePackKey: pack.key,
        priorityBoost: Number(pack.priority_boost || 0) + Math.min(gapScore, 6),
        maxSeedUrls: Math.max(1, Math.min(10, Number(pack.max_seed_urls_per_run || 8))),
        coverageTargetKey: gap?.geography_key || null,
        gapLabel: gap?.label || null,
        gapScore,
        gapSector,
        entityKey: null,
        entityName: null,
        entityType: null,
      });
    }
  }

  const pivotPlans = entityPivots
    .filter((pivot) => Array.isArray(pivot.seed_queries) && pivot.seed_queries.length > 0)
    .filter((pivot) => {
      if (!pivot.last_seeded_at) return true;
      return hoursSince(pivot.last_seeded_at) >= 24 * 7;
    })
    .sort((a, b) => Number(b.priority_score || 0) - Number(a.priority_score || 0))
    .slice(0, 2)
    .map((pivot) => {
      const gap = (pivot.coverage_target_keys || [])
        .map((key) => coverageGaps.find((row) => row.geography_key === key))
        .find((value): value is CoverageGapRow => Boolean(value)) || null;
      const queryIndex = Math.max(0, Number(pivot.seeded_frontier_count || 0) % Math.max(pivot.seed_queries.length, 1));
      const baseQuery = pivot.seed_queries[queryIndex] || pivot.seed_queries[0];
      const decoratedQuery = decorateQueryWithGap(baseQuery, gap);

      return {
        query: decoratedQuery,
        sourceType: "entity_pivot" as const,
        sourcePackId: null,
        sourcePackKey: null,
        priorityBoost: Number(pivot.priority_score || 0),
        maxSeedUrls: 8,
        coverageTargetKey: gap?.geography_key || null,
        gapLabel: gap?.label || null,
        gapScore: Number(gap?.gap_score || 0),
        gapSector: pickGapSector(gap),
        entityKey: pivot.entity_key,
        entityName: pivot.entity_name,
        entityType: pivot.entity_type,
      };
    });

  plans.push(...pivotPlans);

  return plans.slice(0, MAX_SEARCH_QUERIES);
}

async function bumpDomainStats(
  supabase: SupabaseAdminClient,
  domain: string,
  delta: {
    pagesQueued?: number;
    pagesFetched?: number;
    promisingPages?: number;
    candidatesExtracted?: number;
    sourcePackId?: string | null;
    lastSeenAt?: string | null;
    lastFetchedAt?: string | null;
    nextFetchAt?: string | null;
    averageEvidenceConfidence?: number | null;
    duplicateCandidates?: number;
    lastSitemapAt?: string | null;
    lastRssAt?: string | null;
  },
): Promise<void> {
  if (!domain) return;

  const { data: existing } = await supabase
    .from("discovery_domains")
    .select("*")
    .eq("domain", domain)
    .maybeSingle();

  const nextLastSeenAt = delta.lastSeenAt || existing?.last_seen_at || new Date().toISOString();
  const nextLastFetchedAt = delta.lastFetchedAt || existing?.last_fetched_at || null;
  const nextNextFetchAt = delta.nextFetchAt || existing?.next_fetch_at || null;
  const nextAverageConfidence =
    delta.averageEvidenceConfidence !== undefined && delta.averageEvidenceConfidence !== null
      ? Number(delta.averageEvidenceConfidence.toFixed(2))
      : existing?.average_evidence_confidence ?? null;

  if (!existing) {
    await supabase.from("discovery_domains").insert({
      domain,
      source_pack_id: delta.sourcePackId || null,
      pages_queued: Math.max(0, delta.pagesQueued || 0),
      pages_fetched: Math.max(0, delta.pagesFetched || 0),
      promising_pages: Math.max(0, delta.promisingPages || 0),
      candidates_extracted: Math.max(0, delta.candidatesExtracted || 0),
      average_evidence_confidence: nextAverageConfidence,
      last_seen_at: nextLastSeenAt,
      last_fetched_at: nextLastFetchedAt,
      next_fetch_at: nextNextFetchAt,
      duplicate_candidates: Math.max(0, delta.duplicateCandidates || 0),
      last_sitemap_at: delta.lastSitemapAt || null,
      last_rss_at: delta.lastRssAt || null,
    });
    return;
  }

  await supabase
    .from("discovery_domains")
    .update({
      source_pack_id: existing.source_pack_id || delta.sourcePackId || null,
      pages_queued: Math.max(0, Number(existing.pages_queued || 0) + Number(delta.pagesQueued || 0)),
      pages_fetched: Math.max(0, Number(existing.pages_fetched || 0) + Number(delta.pagesFetched || 0)),
      promising_pages: Math.max(0, Number(existing.promising_pages || 0) + Number(delta.promisingPages || 0)),
      candidates_extracted: Math.max(
        0,
        Number(existing.candidates_extracted || 0) + Number(delta.candidatesExtracted || 0),
      ),
      average_evidence_confidence: nextAverageConfidence,
      last_seen_at: nextLastSeenAt,
      last_fetched_at: nextLastFetchedAt,
      next_fetch_at: nextNextFetchAt,
      duplicate_candidates: Math.max(
        0,
        Number(existing.duplicate_candidates || 0) + Number(delta.duplicateCandidates || 0),
      ),
      last_sitemap_at: delta.lastSitemapAt || existing.last_sitemap_at || null,
      last_rss_at: delta.lastRssAt || existing.last_rss_at || null,
    })
    .eq("id", existing.id);
}

async function saveFrontierSeeds(
  supabase: SupabaseAdminClient,
  rows: FrontierUpsertRow[],
): Promise<number> {
  if (rows.length === 0) return 0;

  const canonicalUrls = uniqueStrings(rows.map((row) => row.canonical_url));
  const { data: existing } = await supabase
    .from("discovery_frontier")
    .select("id, canonical_url, status, priority_score, next_fetch_at, source_pack_id, pivot_entity_key, pivot_entity_name, pivot_entity_type")
    .in("canonical_url", canonicalUrls);

  const existingByCanonical = new Map(
    (existing || []).map((row: {
      id: string;
      canonical_url: string;
      status: string;
      priority_score: string | number | null;
      next_fetch_at: string | null;
      source_pack_id: string | null;
      pivot_entity_key: string | null;
      pivot_entity_name: string | null;
      pivot_entity_type: string | null;
    }) => [
      row.canonical_url,
      row,
    ]),
  );

  const inserts: FrontierUpsertRow[] = [];
  const updates: Array<{ id: string; patch: Record<string, unknown> }> = [];

  for (const row of rows) {
    const existingRow = existingByCanonical.get(row.canonical_url);
    if (!existingRow) {
      inserts.push(row);
      continue;
    }

    const nextPriority = Math.max(Number(existingRow.priority_score || 0), row.priority_score);
    const existingNextFetchAt = existingRow.next_fetch_at
      ? new Date(existingRow.next_fetch_at).getTime()
      : Number.POSITIVE_INFINITY;
    const proposedNextFetchAt = new Date(row.next_fetch_at).getTime();
    const nextFetchAt = proposedNextFetchAt < existingNextFetchAt
      ? row.next_fetch_at
      : existingRow.next_fetch_at;
    const shouldRequeue = ["failed", "ignored"].includes(existingRow.status);
    const shouldRefresh =
      shouldRequeue ||
      nextPriority > Number(existingRow.priority_score || 0) ||
      proposedNextFetchAt < existingNextFetchAt ||
      (!existingRow.source_pack_id && row.source_pack_id) ||
      (!existingRow.pivot_entity_key && row.pivot_entity_key);

    if (!shouldRefresh) {
      continue;
    }

    updates.push({
      id: existingRow.id,
      patch: {
        priority_score: nextPriority,
        next_fetch_at: shouldRequeue ? new Date().toISOString() : nextFetchAt,
        source_pack_id: existingRow.source_pack_id || row.source_pack_id || null,
        pivot_entity_key: existingRow.pivot_entity_key || row.pivot_entity_key || null,
        pivot_entity_name: existingRow.pivot_entity_name || row.pivot_entity_name || null,
        pivot_entity_type: existingRow.pivot_entity_type || row.pivot_entity_type || null,
        discovered_from_url: row.discovered_from_url,
        discovery_reason: row.discovery_reason,
        search_query: row.search_query,
        anchor_text: row.anchor_text,
        title: row.title,
        status: shouldRequeue ? "queued" : existingRow.status,
      },
    });
  }

  if (inserts.length > 0) {
    const { error } = await supabase
      .from("discovery_frontier")
      .insert(
        inserts.map((row) => ({
          ...row,
          status: "queued",
        })),
      );

    if (error) {
      throw new Error(`Failed to seed discovery_frontier: ${error.message}`);
    }

    const countsByDomain = new Map<string, number>();
    for (const row of inserts) {
      countsByDomain.set(row.domain, (countsByDomain.get(row.domain) || 0) + 1);
    }

    await Promise.all(
      [...countsByDomain.entries()].map(([domain, count]) =>
        bumpDomainStats(supabase, domain, {
          pagesQueued: count,
          sourcePackId: inserts.find((row) => row.domain === domain)?.source_pack_id || null,
          lastSeenAt: new Date().toISOString(),
        })
      ),
    );
  }

  if (updates.length > 0) {
    const updateResults = await Promise.all(
      updates.map(({ id, patch }) =>
        supabase
          .from("discovery_frontier")
          .update(patch)
          .eq("id", id)
      ),
    );

    const updateError = updateResults.find((result) => result.error);
    if (updateError?.error) {
      throw new Error(`Failed to refresh discovery_frontier seeds: ${updateError.error.message}`);
    }
  }

  return inserts.length + updates.length;
}

async function recordFrontierRefill(
  supabase: SupabaseAdminClient,
  input: {
    runId?: string;
    reason: string;
    provider?: string | null;
    frontierBefore?: number;
    seededCount: number;
    sourcePackIds?: string[];
    plannedQueries?: SearchSeedPlan[];
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  if (input.seededCount <= 0) return;

  const { error } = await supabase.from("discovery_frontier_refills").insert({
    agent_run_id: input.runId || null,
    refill_reason: input.reason,
    provider: input.provider || null,
    frontier_before: input.frontierBefore ?? null,
    seeded_count: input.seededCount,
    source_pack_ids: input.sourcePackIds || [],
    planned_queries: (input.plannedQueries || []).map((plan) => ({
      query: plan.query,
      source_type: plan.sourceType,
      source_pack_key: plan.sourcePackKey,
      entity_key: plan.entityKey,
      entity_name: plan.entityName,
      entity_type: plan.entityType,
      coverage_target_key: plan.coverageTargetKey,
      gap_label: plan.gapLabel,
      gap_score: plan.gapScore,
    })),
    metadata: input.metadata || {},
  });

  if (error) {
    throw new Error(`Failed to record discovery frontier refill: ${error.message}`);
  }
}

function isProvenDomain(policy: DiscoveryDomainPolicy | null | undefined): boolean {
  return (
    Number(policy?.candidates_approved || 0) > 0 ||
    Number(policy?.yield_score || 0) >= PROVEN_DOMAIN_YIELD_SCORE
  );
}

function buildHarvestFrontierRows(
  harvested: HarvestedFrontierSeed,
  sourceType: "sitemap" | "rss",
  frontier: FrontierRow,
  policy: DiscoveryDomainPolicy | null | undefined,
): FrontierUpsertRow[] {
  return harvested.urls.map((url, index) => ({
    url,
    canonical_url: url,
    domain: extractDomain(url),
    priority_score:
      Number(frontier.priority_score || 0) +
      Math.min(Number(policy?.yield_score || 0), 6) +
      (sourceType === "sitemap" ? 3 : 2) -
      index * 0.2,
    depth: 0,
    discovered_from_url: frontier.canonical_url,
    discovery_reason: `${sourceType}:${frontier.domain}`,
    source_type: sourceType,
    source_pack_id: frontier.source_pack_id,
    pivot_entity_key: frontier.pivot_entity_key,
    pivot_entity_name: frontier.pivot_entity_name,
    pivot_entity_type: frontier.pivot_entity_type,
    search_query: frontier.search_query,
    anchor_text: null,
    title: null,
    next_fetch_at: new Date().toISOString(),
  }));
}

async function maybeHarvestProvenDomain(
  supabase: SupabaseAdminClient,
  frontier: FrontierRow,
  policy: DiscoveryDomainPolicy | null,
  runId: string | undefined,
  steps: StepLog[],
  elapsed: () => string,
): Promise<{ seeded: number; sitemapSeeded: number; rssSeeded: number }> {
  if (!policy || !isProvenDomain(policy)) {
    return { seeded: 0, sitemapSeeded: 0, rssSeeded: 0 };
  }

  if (Number(policy.remaining_budget_7d || 0) <= 0) {
    steps.push({
      step: `domain_harvest_${frontier.domain}`,
      timestamp: new Date().toISOString(),
      elapsed: elapsed(),
      status: "skipped",
      detail: {
        domain: frontier.domain,
        reason: "weekly_budget_exhausted",
        remaining_budget_7d: policy.remaining_budget_7d,
      },
    });
    return { seeded: 0, sitemapSeeded: 0, rssSeeded: 0 };
  }

  const shouldHarvestSitemap = hoursSince(policy.last_sitemap_at) >= SITEMAP_HARVEST_COOLDOWN_HOURS;
  const shouldHarvestRss = hoursSince(policy.last_rss_at) >= RSS_HARVEST_COOLDOWN_HOURS;
  let sitemapSeeded = 0;
  let rssSeeded = 0;

  if (shouldHarvestSitemap) {
    const attemptedAt = new Date().toISOString();
    const harvested = await harvestSitemapUrls(frontier.domain, MAX_SITEMAP_SEEDS);
    await bumpDomainStats(supabase, frontier.domain, {
      lastSitemapAt: attemptedAt,
    });
    policy.last_sitemap_at = attemptedAt;
    if (harvested) {
      const rows = buildHarvestFrontierRows(harvested, "sitemap", frontier, policy);
      sitemapSeeded = await saveFrontierSeeds(supabase, rows);
      if (sitemapSeeded > 0) {
        await recordFrontierRefill(supabase, {
          runId,
          reason: "proven_domain_sitemap",
          seededCount: sitemapSeeded,
          sourcePackIds: frontier.source_pack_id ? [frontier.source_pack_id] : [],
          metadata: {
            domain: frontier.domain,
            source_url: harvested.sourceUrl,
          },
        });
      }
    }
  }

  if (shouldHarvestRss) {
    const attemptedAt = new Date().toISOString();
    const harvested = await harvestFeedUrls(frontier.domain, MAX_RSS_SEEDS);
    await bumpDomainStats(supabase, frontier.domain, {
      lastRssAt: attemptedAt,
    });
    policy.last_rss_at = attemptedAt;
    if (harvested) {
      const rows = buildHarvestFrontierRows(harvested, "rss", frontier, policy);
      rssSeeded = await saveFrontierSeeds(supabase, rows);
      if (rssSeeded > 0) {
        await recordFrontierRefill(supabase, {
          runId,
          reason: "proven_domain_rss",
          seededCount: rssSeeded,
          sourcePackIds: frontier.source_pack_id ? [frontier.source_pack_id] : [],
          metadata: {
            domain: frontier.domain,
            source_url: harvested.sourceUrl,
          },
        });
      }
    }
  }

  if (shouldHarvestSitemap || shouldHarvestRss) {
    steps.push({
      step: `domain_harvest_${frontier.domain}`,
      timestamp: new Date().toISOString(),
      elapsed: elapsed(),
      status: sitemapSeeded > 0 || rssSeeded > 0 ? "ok" : "skipped",
      detail: {
        domain: frontier.domain,
        sitemap_seeded: sitemapSeeded,
        rss_seeded: rssSeeded,
        yield_score: policy.yield_score,
        candidates_approved: policy.candidates_approved,
      },
    });
  }

  return {
    seeded: sitemapSeeded + rssSeeded,
    sitemapSeeded,
    rssSeeded,
  };
}

async function seedFrontier(
  supabase: SupabaseAdminClient,
  plans: SearchSeedPlan[],
  runId: string | undefined,
  frontierBefore: number,
  steps: StepLog[],
  elapsed: () => string,
): Promise<{ seeded: number; provider: string; usedSourcePackIds: string[]; usedEntityKeys: string[] }> {
  let seeded = 0;
  const providersUsed = new Set<string>();
  const usedSourcePackIds = new Set<string>();
  const usedEntityKeys = new Set<string>();

  for (let index = 0; index < plans.length; index += 1) {
    const plan = plans[index];
    const searchResponse = await searchWeb(plan.query, supabase);
    if (searchResponse.provider && searchResponse.provider !== "none") {
      providersUsed.add(searchResponse.provider);
    }

    const frontierRows: FrontierUpsertRow[] = searchResponse.results
      .slice(0, plan.maxSeedUrls)
      .map<FrontierUpsertRow | null>((result, resultIndex) => {
        const canonicalUrl = canonicalizeUrl(result.url);
        if (!canonicalUrl) return null;

        const domain = extractDomain(canonicalUrl);
        if (!domain) return null;

        return {
          url: result.url,
          canonical_url: canonicalUrl,
          domain,
          priority_score: plan.priorityBoost + Math.max(0, 10 - resultIndex),
          depth: 0,
          discovered_from_url: null,
          discovery_reason:
            plan.sourceType === "source_pack"
              ? `source_pack:${plan.sourcePackKey || "unknown"}`
              : plan.sourceType === "entity_pivot"
              ? `entity_pivot:${plan.entityKey || plan.entityName || "unknown"}`
              : "custom_query",
          source_type:
            plan.sourceType === "source_pack"
              ? "source_pack"
              : plan.sourceType === "entity_pivot"
              ? "entity_pivot"
              : "search_seed",
          source_pack_id: plan.sourcePackId,
          pivot_entity_key: plan.entityKey,
          pivot_entity_name: plan.entityName,
          pivot_entity_type: plan.entityType,
          search_query: plan.query,
          anchor_text: null,
          title: result.title || null,
          next_fetch_at: new Date().toISOString(),
        };
      })
      .filter((row): row is FrontierUpsertRow => row !== null);

    if (frontierRows.length > 0) {
      seeded += await saveFrontierSeeds(supabase, frontierRows);
      frontierRows.forEach((row) => {
        void bumpDomainStats(supabase, row.domain, {
          sourcePackId: row.source_pack_id,
          lastSeenAt: new Date().toISOString(),
        });
      });
      if (plan.entityKey) {
        usedEntityKeys.add(plan.entityKey);
      }
    }

    if (plan.sourcePackId) {
      usedSourcePackIds.add(plan.sourcePackId);
    }

    steps.push({
      step: `seed_search_${index + 1}`,
      timestamp: new Date().toISOString(),
      elapsed: elapsed(),
      status: searchResponse.quota_exhausted ? "error" : "ok",
      detail: {
        query: plan.query,
        source_type: plan.sourceType,
        source_pack_id: plan.sourcePackId,
        entity_key: plan.entityKey,
        entity_name: plan.entityName,
        entity_type: plan.entityType,
        coverage_target_key: plan.coverageTargetKey,
        gap_label: plan.gapLabel,
        gap_score: plan.gapScore,
        gap_sector: plan.gapSector,
        provider: searchResponse.provider,
        cached: searchResponse.cached,
        result_count: searchResponse.results.length,
        seeded_count: frontierRows.length,
        result_urls: frontierRows.map((row) => row.canonical_url),
      },
    });

    if (searchResponse.quota_exhausted) {
      break;
    }
  }

  await recordFrontierRefill(supabase, {
    runId,
    reason: "search_seed",
    provider: [...providersUsed][0] || "none",
    frontierBefore,
    seededCount: seeded,
    sourcePackIds: [...usedSourcePackIds],
    plannedQueries: plans,
  });

  return {
    seeded,
    provider: [...providersUsed][0] || "none",
    usedSourcePackIds: [...usedSourcePackIds],
    usedEntityKeys: [...usedEntityKeys],
  };
}

async function markEntityPivotsSeeded(
  supabase: SupabaseAdminClient,
  entityKeys: string[],
): Promise<void> {
  const uniqueKeys = uniqueStrings(entityKeys);
  if (uniqueKeys.length === 0) return;

  const { data: pivots, error } = await supabase
    .from("discovery_entity_pivots")
    .select("id, entity_key, seeded_frontier_count")
    .in("entity_key", uniqueKeys);

  if (error) {
    throw new Error(`Failed to load seeded entity pivots: ${error.message}`);
  }

  const updates = (pivots || []).map((pivot: {
    id: string;
    entity_key: string;
    seeded_frontier_count: number | null;
  }) =>
    supabase
      .from("discovery_entity_pivots")
      .update({
        seeded_frontier_count: Number(pivot.seeded_frontier_count || 0) + 1,
        last_seeded_at: new Date().toISOString(),
      })
      .eq("id", pivot.id),
  );

  const results = await Promise.all(updates);
  const updateError = results.find((result) => result.error)?.error;
  if (updateError) {
    throw new Error(`Failed to mark entity pivots seeded: ${updateError.message}`);
  }
}

async function markSourcePacksSeeded(
  supabase: SupabaseAdminClient,
  sourcePackIds: string[],
): Promise<void> {
  if (sourcePackIds.length === 0) return;

  await supabase
    .from("discovery_source_packs")
    .update({ last_seeded_at: new Date().toISOString() })
    .in("id", sourcePackIds);
}

async function claimFrontierBatch(
  supabase: SupabaseAdminClient,
  runId: string,
  batchSize: number,
): Promise<FrontierRow[]> {
  const { data, error } = await supabase.rpc("claim_discovery_frontier", {
    p_run_id: runId,
    p_limit: batchSize,
    p_per_domain_limit: DEFAULT_PER_DOMAIN_RUN_LIMIT,
  });

  if (error) {
    throw new Error(`Failed to claim discovery frontier: ${error.message}`);
  }

  return (data || []) as FrontierRow[];
}

async function releaseClaimedFrontier(
  supabase: SupabaseAdminClient,
  runId: string,
): Promise<void> {
  await supabase.rpc("release_discovery_frontier_claims", {
    p_run_id: runId,
    p_status: "queued",
  });
}

async function upsertDiscoveryPage(
  supabase: SupabaseAdminClient,
  frontier: FrontierRow,
  page: FetchedPage,
  classification: PageClassification,
  childLinks: ScoredChildLink[],
): Promise<string | null> {
  const { data, error } = await supabase
    .from("discovery_pages")
    .upsert(
      {
        frontier_id: frontier.id,
        canonical_url: page.canonicalUrl,
        final_url: page.finalUrl,
        domain: page.domain,
        page_title: page.title || null,
        page_type: classification.pageType,
        classification_method: classification.method,
        classification_confidence: Number(classification.confidence.toFixed(2)),
        fetch_status: page.status,
        content_hash: page.contentHash || null,
        content_excerpt: page.excerpt || null,
        content_text: page.text || null,
        extracted_links: childLinks,
        metadata: {
          classification_reason: classification.reason,
          discovered_from_url: frontier.discovered_from_url,
          source_type: frontier.source_type,
          search_query: frontier.search_query,
        },
        fetched_at: page.fetchedAt,
      },
      { onConflict: "canonical_url" },
    )
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to upsert discovery page: ${error.message}`);
  }

  return data?.id || null;
}

function mapExistingContactRow(row: ExistingContactLookupRow): ExtractedContact {
  return {
    name: safeString(row.name),
    bio: safeString(row.bio),
    occupation: safeString(row.occupation),
    current_position: safeString(row.current_position),
    location_city: safeString(row.location_city),
    location_state: safeString(row.location_state),
    flemish_connection: safeString(row.flemish_connection),
    suggested_us_network_status: normalizePersonUsNetworkStatus(
      row.suggested_us_network_status,
    ),
    suggested_us_network_confidence: clampConfidence(
      row.suggested_us_network_confidence,
    ),
    current_location_city: safeString(row.current_location_city),
    current_location_country: safeString(row.current_location_country),
    suggested_us_connections: Array.isArray(row.suggested_us_connections)
      ? row.suggested_us_connections
        .filter((value): value is Record<string, unknown> =>
          Boolean(value && typeof value === "object")
        )
      : [],
    website_url: safeString(row.website_url),
    email: safeString(row.email),
    linkedin_url: safeString(row.linkedin_url),
    sectors: Array.isArray(row.sectors)
      ? (row.sectors as unknown[]).filter((value): value is string => typeof value === "string")
      : [],
    source_urls: Array.isArray(row.source_urls)
      ? (row.source_urls as unknown[]).filter((value): value is string => typeof value === "string")
      : [],
  };
}

async function queryByField(
  supabase: SupabaseAdminClient,
  table: "people" | "discovered_contacts",
  field: "email" | "linkedin_url" | "website_url" | "name" | "candidate_key",
  value: string,
  pendingOnly = false,
): Promise<ExistingContactLookupRow[]> {
  if (!value) return [];

  let query = supabase.from(table).select("*");
  if (table === "discovered_contacts" && pendingOnly) {
    query = query.eq("status", "pending");
  }

  if (field === "name") {
    query = query.ilike(field, value);
  } else {
    query = query.eq(field, value);
  }

  const { data } = await query.limit(5);
  return (data || []) as ExistingContactLookupRow[];
}

async function findExistingPerson(
  supabase: SupabaseAdminClient,
  contact: ExtractedContact,
): Promise<ExistingContactLookupRow | null> {
  const queries: Array<Promise<ExistingContactLookupRow[]>> = [];
  const email = normalizeEmail(contact.email);
  const linkedin = normalizeLinkedInUrl(contact.linkedin_url);
  const website = normalizeWebsiteUrl(contact.website_url);
  const name = contact.name.trim();

  if (email) queries.push(queryByField(supabase, "people", "email", email));
  if (linkedin) queries.push(queryByField(supabase, "people", "linkedin_url", contact.linkedin_url));
  if (website) queries.push(queryByField(supabase, "people", "website_url", contact.website_url));
  if (name) queries.push(queryByField(supabase, "people", "name", name));

  const resultSets = await Promise.all(queries);
  const rows = resultSets.flat();

  return (
    rows.find((row) => {
      const mapped = mapExistingContactRow(row);
      return likelySameContact(mapped, contact);
    }) || null
  );
}

async function findPendingDiscoveredContact(
  supabase: SupabaseAdminClient,
  contact: ExtractedContact,
  candidateKey?: string | null,
): Promise<ExistingContactLookupRow | null> {
  const queries: Array<Promise<ExistingContactLookupRow[]>> = [];
  const email = normalizeEmail(contact.email);
  const linkedin = normalizeLinkedInUrl(contact.linkedin_url);
  const website = normalizeWebsiteUrl(contact.website_url);
  const name = contact.name.trim();

  if (candidateKey) {
    queries.push(queryByField(supabase, "discovered_contacts", "candidate_key", candidateKey, true));
  }
  if (email) queries.push(queryByField(supabase, "discovered_contacts", "email", email, true));
  if (linkedin) queries.push(queryByField(supabase, "discovered_contacts", "linkedin_url", contact.linkedin_url, true));
  if (website) queries.push(queryByField(supabase, "discovered_contacts", "website_url", contact.website_url, true));
  if (name) queries.push(queryByField(supabase, "discovered_contacts", "name", name, true));

  const resultSets = await Promise.all(queries);
  const rows = resultSets.flat();

  if (candidateKey) {
    const keyMatch = rows.find((row) => safeString(row.candidate_key) === candidateKey);
    if (keyMatch) {
      return keyMatch;
    }
  }

  return (
    rows.find((row) => {
      const mapped = mapExistingContactRow(row);
      return likelySameContact(mapped, contact);
    }) || null
  );
}

async function insertEvidenceRows(
  supabase: SupabaseAdminClient,
  discoveredContactId: string,
  contactName: string,
  evidence: DiscoveryEvidenceInput[],
): Promise<number> {
  if (evidence.length === 0) return 0;

  const rows = await Promise.all(
    evidence.map(async (item) => ({
      discovered_contact_id: discoveredContactId,
      discovery_page_id: item.discoveryPageId,
      evidence_key: await hashString(
        `${normalizeName(contactName)}|${item.pageUrl}|${normalizeWhitespace(item.evidenceExcerpt)}|${normalizeWhitespace(item.rawRoleText)}`,
      ),
      page_url: item.pageUrl,
      page_title: item.pageTitle || null,
      page_type: item.pageType || null,
      source_type: item.sourceType || null,
      evidence_excerpt: item.evidenceExcerpt || null,
      raw_location_text: item.rawLocationText || null,
      raw_flemish_text: item.rawFlemishText || null,
      raw_role_text: item.rawRoleText || null,
      extraction_confidence: Number(item.extractionConfidence.toFixed(2)),
      normalized_location_city: item.locationCity || null,
      normalized_location_state: item.locationState || null,
      discovered_via: item.discoveredVia || null,
      parent_url: item.parentUrl || null,
      fetched_at: item.fetchedAt,
    })),
  );

  const { data, error } = await supabase
    .from("discovery_evidence")
    .upsert(rows, { onConflict: "evidence_key", ignoreDuplicates: true })
    .select("id");

  if (error) {
    throw new Error(`Failed to write discovery evidence: ${error.message}`);
  }

  return data?.length || 0;
}

async function upsertEntityPivots(
  supabase: SupabaseAdminClient,
  discoveredContactId: string,
  bundle: CandidateBundle,
): Promise<number> {
  const pivotCandidates = extractPivotCandidates(bundle.contact, bundle.evidence);
  if (pivotCandidates.length === 0) return 0;

  let upserted = 0;

  for (const pivot of pivotCandidates) {
    const { data: existingPivot, error: loadError } = await supabase
      .from("discovery_entity_pivots")
      .select("id, source_urls, coverage_target_keys, seed_queries")
      .eq("entity_key", pivot.entityKey)
      .maybeSingle();

    if (loadError) {
      throw new Error(`Failed to load entity pivot: ${loadError.message}`);
    }

    const nextSourceUrls = uniqueStrings([
      ...(Array.isArray(existingPivot?.source_urls) ? existingPivot.source_urls : []),
      ...bundle.evidence.map((item) => item.pageUrl),
    ]);
    const nextCoverageTargets = uniqueStrings([
      ...(Array.isArray(existingPivot?.coverage_target_keys) ? existingPivot.coverage_target_keys : []),
      ...pivot.coverageTargetKeys,
    ]);
    const nextSeedQueries = uniqueStrings([
      ...(Array.isArray(existingPivot?.seed_queries) ? existingPivot.seed_queries : []),
      ...pivot.seedQueries,
    ]);

    let pivotId = existingPivot?.id || null;

    if (!existingPivot) {
      const { data: insertedPivot, error: insertError } = await supabase
        .from("discovery_entity_pivots")
        .insert({
          entity_key: pivot.entityKey,
          entity_name: pivot.entityName,
          entity_type: pivot.entityType,
          normalized_domain: pivot.normalizedDomain,
          coverage_target_keys: nextCoverageTargets,
          seed_queries: nextSeedQueries,
          source_urls: nextSourceUrls,
          last_seen_at: new Date().toISOString(),
        })
        .select("id")
        .maybeSingle();

      if (insertError || !insertedPivot) {
        throw new Error(insertError?.message || "Failed to insert entity pivot");
      }

      pivotId = insertedPivot.id;
    } else {
      const { error: updateError } = await supabase
        .from("discovery_entity_pivots")
        .update({
          entity_name: pivot.entityName,
          entity_type: pivot.entityType,
          normalized_domain: pivot.normalizedDomain,
          coverage_target_keys: nextCoverageTargets,
          seed_queries: nextSeedQueries,
          source_urls: nextSourceUrls,
          last_seen_at: new Date().toISOString(),
        })
        .eq("id", existingPivot.id);

      if (updateError) {
        throw new Error(`Failed to update entity pivot: ${updateError.message}`);
      }

      pivotId = existingPivot.id;
    }

    const { error: sourceError } = await supabase
      .from("discovery_entity_pivot_sources")
      .upsert({
        pivot_id: pivotId,
        discovered_contact_id: discoveredContactId,
        discovery_evidence_id: null,
        source_page_url: pivot.sourceUrl,
        source_page_title: pivot.sourceTitle,
        source_page_type: pivot.sourcePageType,
        source_domain: extractDomain(pivot.sourceUrl) || pivot.normalizedDomain,
        source_excerpt: pivot.sourceExcerpt,
        confidence: Number(pivot.confidence.toFixed(2)),
        source_strength: Number(pivot.sourceStrength.toFixed(2)),
      }, {
        onConflict: "pivot_id,discovered_contact_id,source_page_url",
        ignoreDuplicates: false,
      });

    if (sourceError) {
      throw new Error(`Failed to write entity pivot source: ${sourceError.message}`);
    }

    upserted += 1;
  }

  return upserted;
}

interface PersistCandidateResult {
  status: "inserted" | "merged" | "duplicate_people";
  discoveredContactId: string | null;
  derivedLabelsUpserted: number;
}

async function persistCandidateBundle(
  supabase: SupabaseAdminClient,
  bundle: CandidateBundle,
  runId: string | undefined,
): Promise<PersistCandidateResult> {
  const peopleMatch = await findExistingPerson(supabase, bundle.contact);
  if (peopleMatch) {
    return {
      status: "duplicate_people",
      discoveredContactId: null,
      derivedLabelsUpserted: 0,
    };
  }

  const pendingMatch = await findPendingDiscoveredContact(
    supabase,
    bundle.contact,
    bundle.candidateKey,
  );
  if (pendingMatch) {
    const existingContact = mapExistingContactRow(pendingMatch);
    const mergedContact = mergeContacts(existingContact, bundle.contact);
    const insertedEvidenceCount = await insertEvidenceRows(
      supabase,
      String(pendingMatch.id),
      mergedContact.name,
      bundle.evidence,
    );

    const nextEvidenceCount =
      Number(pendingMatch.evidence_count || 0) + Number(insertedEvidenceCount || 0);
    const nowIso = new Date().toISOString();

    const { error } = await supabase
      .from("discovered_contacts")
      .update({
        name: mergedContact.name,
        email: mergedContact.email || null,
        linkedin_url: mergedContact.linkedin_url || null,
        current_position: mergedContact.current_position || null,
        occupation: mergedContact.occupation || null,
        location_city: mergedContact.location_city || null,
        location_state: mergedContact.location_state || null,
        suggested_us_network_status: mergedContact.suggested_us_network_status,
        suggested_us_network_confidence: mergedContact.suggested_us_network_confidence,
        current_location_city: mergedContact.current_location_city || null,
        current_location_country: mergedContact.current_location_country || null,
        suggested_us_connections: mergedContact.suggested_us_connections,
        bio: mergedContact.bio || null,
        flemish_connection: mergedContact.flemish_connection || null,
        website_url: mergedContact.website_url || null,
        sectors: mergedContact.sectors.length > 0 ? mergedContact.sectors : null,
        source: "frontier_page",
        source_urls: mergedContact.source_urls.length > 0 ? mergedContact.source_urls : null,
        candidate_key: bundle.candidateKey,
        agent_run_id: runId || null,
        last_seen_at: nowIso,
        last_evidence_at: insertedEvidenceCount > 0 ? nowIso : pendingMatch.last_evidence_at || nowIso,
        evidence_count: nextEvidenceCount,
        discovery_confidence: Number(
          Math.max(
            Number(pendingMatch.discovery_confidence || 0),
            ...bundle.evidence.map((item) => item.extractionConfidence || 0),
          ).toFixed(2),
        ),
      })
      .eq("id", pendingMatch.id);

    if (error) {
      throw new Error(`Failed to update discovered contact: ${error.message}`);
    }

    const derivedLabelsUpserted = await upsertDerivedLabelSuggestions(
      supabase,
      await buildDiscoveryDerivedLabels(supabase, {
        discoveredContactId: String(pendingMatch.id),
        agentRunId: runId || null,
        source: "frontier_page",
        currentPosition: mergedContact.current_position,
        occupation: mergedContact.occupation,
        bio: mergedContact.bio,
        locationCity: mergedContact.location_city,
        locationState: mergedContact.location_state,
        rawLocationText: bundle.evidence.find((item) => item.rawLocationText)?.rawLocationText || "",
        flemishConnection: mergedContact.flemish_connection,
        sectors: mergedContact.sectors,
        evidence: bundle.evidence.map((item) => ({
          pageUrl: item.pageUrl,
          pageType: item.pageType,
          evidenceExcerpt: item.evidenceExcerpt,
          rawLocationText: item.rawLocationText,
          rawFlemishText: item.rawFlemishText,
          extractionConfidence: item.extractionConfidence,
        })),
      }),
    );

    return {
      status: "merged",
      discoveredContactId: String(pendingMatch.id),
      derivedLabelsUpserted,
    };
  }

  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("discovered_contacts")
    .insert({
      name: bundle.contact.name,
      email: bundle.contact.email || null,
      linkedin_url: bundle.contact.linkedin_url || null,
      current_position: bundle.contact.current_position || null,
      occupation: bundle.contact.occupation || null,
      location_city: bundle.contact.location_city || null,
      location_state: bundle.contact.location_state || null,
      suggested_us_network_status: bundle.contact.suggested_us_network_status,
      suggested_us_network_confidence: bundle.contact.suggested_us_network_confidence,
      current_location_city: bundle.contact.current_location_city || null,
      current_location_country: bundle.contact.current_location_country || null,
      suggested_us_connections: bundle.contact.suggested_us_connections,
      bio: bundle.contact.bio || null,
      flemish_connection: bundle.contact.flemish_connection || null,
      website_url: bundle.contact.website_url || null,
      sectors: bundle.contact.sectors.length > 0 ? bundle.contact.sectors : null,
      source: "frontier_page",
      source_urls: bundle.contact.source_urls.length > 0 ? bundle.contact.source_urls : null,
      candidate_key: bundle.candidateKey,
      status: "pending",
      agent_run_id: runId || null,
      first_seen_at: nowIso,
      last_seen_at: nowIso,
      last_evidence_at: nowIso,
      evidence_count: 0,
      discovery_confidence: Number(
        Math.max(...bundle.evidence.map((item) => item.extractionConfidence || 0), 0).toFixed(2),
      ),
    })
    .select("id")
    .maybeSingle();

  if (error || !data) {
    throw new Error(error?.message || "Failed to insert discovered contact");
  }

  const insertedEvidenceCount = await insertEvidenceRows(
    supabase,
    data.id,
    bundle.contact.name,
    bundle.evidence,
  );

  await supabase
    .from("discovered_contacts")
    .update({
      evidence_count: insertedEvidenceCount,
    })
    .eq("id", data.id);

  const derivedLabelsUpserted = await upsertDerivedLabelSuggestions(
    supabase,
    await buildDiscoveryDerivedLabels(supabase, {
      discoveredContactId: data.id,
      agentRunId: runId || null,
      source: "frontier_page",
      currentPosition: bundle.contact.current_position,
      occupation: bundle.contact.occupation,
      bio: bundle.contact.bio,
      locationCity: bundle.contact.location_city,
      locationState: bundle.contact.location_state,
      rawLocationText: bundle.evidence.find((item) => item.rawLocationText)?.rawLocationText || "",
      flemishConnection: bundle.contact.flemish_connection,
      sectors: bundle.contact.sectors,
      evidence: bundle.evidence.map((item) => ({
        pageUrl: item.pageUrl,
        pageType: item.pageType,
        evidenceExcerpt: item.evidenceExcerpt,
        rawLocationText: item.rawLocationText,
        rawFlemishText: item.rawFlemishText,
        extractionConfidence: item.extractionConfidence,
      })),
    }),
  );

  return {
    status: "inserted",
    discoveredContactId: data.id,
    derivedLabelsUpserted,
  };
}

interface ExistingOrganizationLookupRow {
  id: string;
  name: string;
  website_url?: string | null;
  description?: string | null;
  us_network_status?: string | null;
  flemish_link?: string | null;
  candidate_key?: string | null;
  suggested_us_network_status?: string | null;
  us_locations?: unknown;
  sectors?: string[] | null;
  flemish_belgian_relevance?: string | null;
  source_urls?: string[] | null;
  confidence?: number | string | null;
  evidence_count?: number | null;
  last_evidence_at?: string | null;
}

interface PersistOrganizationResult {
  status: "inserted" | "merged" | "duplicate_organizations";
  discoveredOrganizationId: string | null;
}

function mapExistingDiscoveredOrganizationRow(row: ExistingOrganizationLookupRow): DiscoveryOrganizationCandidate {
  return {
    name: safeString(row.name),
    website_url: safeString(row.website_url),
    description: safeString(row.description),
    suggested_us_network_status: normalizeOrganizationNetworkStatus(row.suggested_us_network_status),
    us_locations: Array.isArray(row.us_locations)
      ? (row.us_locations as unknown[])
        .filter((value): value is OrganizationLocationEvidence => Boolean(value && typeof value === "object"))
      : [],
    sectors: Array.isArray(row.sectors)
      ? row.sectors.filter((value): value is string => typeof value === "string")
      : [],
    flemish_belgian_relevance: safeString(row.flemish_belgian_relevance),
    source_urls: Array.isArray(row.source_urls)
      ? row.source_urls.filter((value): value is string => typeof value === "string")
      : [],
    confidence: clampConfidence(row.confidence),
  };
}

function mapApprovedOrganizationRow(row: ExistingOrganizationLookupRow): DiscoveryOrganizationCandidate {
  return {
    name: safeString(row.name),
    website_url: safeString(row.website_url),
    description: safeString(row.description),
    suggested_us_network_status: normalizeOrganizationNetworkStatus(row.us_network_status),
    us_locations: [],
    sectors: [],
    flemish_belgian_relevance: safeString(row.flemish_link),
    source_urls: row.website_url ? [row.website_url] : [],
    confidence: 1,
  };
}

async function queryOrganizationsByField(
  supabase: SupabaseAdminClient,
  table: "organizations" | "discovered_organizations",
  field: "website_url" | "name" | "candidate_key",
  value: string,
  pendingOnly = false,
): Promise<ExistingOrganizationLookupRow[]> {
  if (!value) return [];

  let query = supabase.from(table).select("*");
  if (table === "discovered_organizations" && pendingOnly) {
    query = query.eq("status", "pending");
  }

  if (field === "name") {
    query = query.ilike(field, value);
  } else {
    query = query.eq(field, value);
  }

  const { data } = await query.limit(8);
  return (data || []) as ExistingOrganizationLookupRow[];
}

async function findExistingApprovedOrganization(
  supabase: SupabaseAdminClient,
  organization: DiscoveryOrganizationCandidate,
): Promise<ExistingOrganizationLookupRow | null> {
  const queries: Array<Promise<ExistingOrganizationLookupRow[]>> = [];
  const website = normalizeOrganizationWebsite(organization.website_url);
  const name = normalizeWhitespace(organization.name);

  if (organization.website_url) queries.push(queryOrganizationsByField(supabase, "organizations", "website_url", organization.website_url));
  if (website && organization.website_url !== website) queries.push(queryOrganizationsByField(supabase, "organizations", "website_url", website));
  if (name) queries.push(queryOrganizationsByField(supabase, "organizations", "name", name));

  const rows = (await Promise.all(queries)).flat();
  return rows.find((row) => likelySameOrganization(mapApprovedOrganizationRow(row), organization)) || null;
}

async function findPendingDiscoveredOrganization(
  supabase: SupabaseAdminClient,
  organization: DiscoveryOrganizationCandidate,
  candidateKey: string,
): Promise<ExistingOrganizationLookupRow | null> {
  const queries: Array<Promise<ExistingOrganizationLookupRow[]>> = [
    queryOrganizationsByField(supabase, "discovered_organizations", "candidate_key", candidateKey, true),
  ];
  const website = normalizeOrganizationWebsite(organization.website_url);
  const name = normalizeWhitespace(organization.name);

  if (organization.website_url) {
    queries.push(queryOrganizationsByField(supabase, "discovered_organizations", "website_url", organization.website_url, true));
  }
  if (website && organization.website_url !== website) {
    queries.push(queryOrganizationsByField(supabase, "discovered_organizations", "website_url", website, true));
  }
  if (name) queries.push(queryOrganizationsByField(supabase, "discovered_organizations", "name", name, true));

  const rows = (await Promise.all(queries)).flat();
  return rows.find((row) => safeString(row.candidate_key) === candidateKey) ||
    rows.find((row) => likelySameOrganization(mapExistingDiscoveredOrganizationRow(row), organization)) ||
    null;
}

async function insertOrganizationEvidenceRows(
  supabase: SupabaseAdminClient,
  discoveredOrganizationId: string,
  organizationName: string,
  evidence: OrganizationEvidenceInput[],
): Promise<number> {
  if (evidence.length === 0) return 0;

  const rows = await Promise.all(
    evidence.map(async (item) => ({
      discovered_organization_id: discoveredOrganizationId,
      discovery_page_id: item.discoveryPageId,
      evidence_key: await hashString(
        `${normalizeOrganizationName(organizationName)}|${item.pageUrl}|${normalizeWhitespace(item.evidenceExcerpt)}|${normalizeWhitespace(item.rawRelevanceText)}`,
      ),
      page_url: item.pageUrl,
      page_title: item.pageTitle || null,
      page_type: item.pageType || null,
      source_type: item.sourceType || null,
      source_name: item.sourceName || null,
      source_url: item.sourceUrl || item.pageUrl,
      evidence_excerpt: item.evidenceExcerpt || null,
      raw_relevance_text: item.rawRelevanceText || null,
      raw_location_text: item.rawLocationText || null,
      raw_sector_text: item.rawSectorText || null,
      normalized_location_city: item.normalizedLocationCity || null,
      normalized_location_state: item.normalizedLocationState || null,
      normalized_location_country: item.normalizedLocationCountry || null,
      confidence: Number(item.confidence.toFixed(2)),
      observed_at: item.observedAt,
    })),
  );

  const { data, error } = await supabase
    .from("discovered_organization_evidence")
    .upsert(rows, { onConflict: "evidence_key", ignoreDuplicates: true })
    .select("id");

  if (error) {
    throw new Error(`Failed to write discovered organization evidence: ${error.message}`);
  }

  return data?.length || 0;
}

async function persistOrganizationBundle(
  supabase: SupabaseAdminClient,
  bundle: OrganizationCandidateBundle,
  runId: string | undefined,
): Promise<PersistOrganizationResult> {
  const approvedMatch = await findExistingApprovedOrganization(supabase, bundle.organization);
  if (approvedMatch) {
    return { status: "duplicate_organizations", discoveredOrganizationId: null };
  }

  const pendingMatch = await findPendingDiscoveredOrganization(
    supabase,
    bundle.organization,
    bundle.candidateKey,
  );

  if (pendingMatch) {
    const merged = mergeOrganizationCandidates(
      mapExistingDiscoveredOrganizationRow(pendingMatch),
      bundle.organization,
    );
    await insertOrganizationEvidenceRows(
      supabase,
      String(pendingMatch.id),
      merged.name,
      bundle.evidence,
    );

    const { error } = await supabase
      .from("discovered_organizations")
      .update({
        name: merged.name,
        website_url: merged.website_url || null,
        description: merged.description || null,
        candidate_key: safeString(pendingMatch.candidate_key) || bundle.candidateKey,
        source: "agent_discovery",
        suggested_us_network_status: merged.suggested_us_network_status,
        us_locations: merged.us_locations,
        sectors: merged.sectors.length > 0 ? merged.sectors : null,
        flemish_belgian_relevance: merged.flemish_belgian_relevance || null,
        source_urls: merged.source_urls.length > 0 ? merged.source_urls : null,
        confidence: Number(merged.confidence.toFixed(2)),
        agent_run_id: runId || null,
        last_seen_at: new Date().toISOString(),
      })
      .eq("id", pendingMatch.id);

    if (error) {
      throw new Error(`Failed to update discovered organization: ${error.message}`);
    }

    return { status: "merged", discoveredOrganizationId: String(pendingMatch.id) };
  }

  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("discovered_organizations")
    .insert({
      name: bundle.organization.name,
      website_url: bundle.organization.website_url || null,
      description: bundle.organization.description || null,
      candidate_key: bundle.candidateKey,
      source: "agent_discovery",
      suggested_us_network_status: bundle.organization.suggested_us_network_status,
      us_locations: bundle.organization.us_locations,
      sectors: bundle.organization.sectors.length > 0 ? bundle.organization.sectors : null,
      flemish_belgian_relevance: bundle.organization.flemish_belgian_relevance || null,
      source_urls: bundle.organization.source_urls.length > 0 ? bundle.organization.source_urls : null,
      confidence: Number(bundle.organization.confidence.toFixed(2)),
      status: "pending",
      agent_run_id: runId || null,
      first_seen_at: nowIso,
      last_seen_at: nowIso,
      last_evidence_at: nowIso,
      evidence_count: 0,
    })
    .select("id")
    .maybeSingle();

  if (error || !data) {
    throw new Error(error?.message || "Failed to insert discovered organization");
  }

  await insertOrganizationEvidenceRows(
    supabase,
    data.id,
    bundle.organization.name,
    bundle.evidence,
  );

  return { status: "inserted", discoveredOrganizationId: data.id };
}

async function enqueueChildLinks(
  supabase: SupabaseAdminClient,
  frontier: FrontierRow,
  childLinks: ScoredChildLink[],
  policy: DiscoveryDomainPolicy | null,
  aggressive: boolean,
): Promise<number> {
  if (childLinks.length === 0) return 0;
  if (frontier.depth >= MAX_DEPTH) return 0;
  if (policy?.status === "blocked" || policy?.status === "paused") return 0;

  const remainingBudget = Math.max(0, Number(policy?.remaining_budget_7d || childLinks.length));
  if (remainingBudget <= 0) return 0;

  const allowedChildren = aggressive
    ? Math.min(childLinks.length, MAX_CHILD_LINKS, remainingBudget)
    : Math.min(childLinks.length, 1, remainingBudget);
  if (allowedChildren <= 0) return 0;

  const rows: FrontierUpsertRow[] = childLinks.slice(0, allowedChildren).map((link, index) => ({
    url: link.url,
    canonical_url: link.url,
    domain: extractDomain(link.url),
    priority_score:
      Number(frontier.priority_score || 0) +
      link.score +
      Math.min(Number(policy?.yield_score || 0), 4) -
      index * 0.25,
    depth: Math.min(frontier.depth + 1, MAX_DEPTH),
    discovered_from_url: frontier.canonical_url,
    discovery_reason: link.reason || "child_link",
    source_type: "child_link",
    source_pack_id: frontier.source_pack_id,
    pivot_entity_key: frontier.pivot_entity_key,
    pivot_entity_name: frontier.pivot_entity_name,
    pivot_entity_type: frontier.pivot_entity_type,
    search_query: frontier.search_query,
    anchor_text: link.anchorText || null,
    title: null,
    next_fetch_at: new Date().toISOString(),
  }));

  return await saveFrontierSeeds(supabase, rows);
}

async function maybeEnrichViaLinkedIn(
  bundles: CandidateBundle[],
  steps: StepLog[],
  elapsed: () => string,
): Promise<{ bundles: CandidateBundle[]; searches: number }> {
  if (bundles.length === 0) {
    return { bundles, searches: 0 };
  }

  const apify = await getApifyUsage();
  if (!apify.available) {
    steps.push({
      step: "linkedin_enrichment",
      timestamp: new Date().toISOString(),
      elapsed: elapsed(),
      status: "skipped",
      detail: { reason: apify.error || "Apify unavailable" },
    });
    return { bundles, searches: 0 };
  }

  let searches = 0;
  const enriched = [...bundles];
  const targets = enriched
    .map((bundle, index) => ({ bundle, index }))
    .filter(({ bundle }) => !bundle.contact.linkedin_url && contactScore(bundle.contact) >= 6)
    .slice(0, MAX_LINKEDIN_ENRICHMENTS);

  for (const target of targets) {
    const keywords = uniqueStrings([
      target.bundle.contact.name,
      `${target.bundle.contact.name} ${target.bundle.contact.current_position}`.trim(),
    ])[0];

    if (!keywords) continue;

    try {
      const result = await runApifyActor<LinkedInProfile>(
        APIFY_ACTORS.LINKEDIN_PROFILE_SEARCH,
        {
          keywords,
          location: "United States",
          limit: 5,
        },
        {
          sync: true,
          timeoutSecs: LINKEDIN_ENRICHMENT_TIMEOUT_SECS,
        },
      );

      searches += 1;
      const match = (result.items || [])
        .map(mapLinkedInProfile)
        .find((profile) => normalizeName(profile.name) === normalizeName(target.bundle.contact.name));

      steps.push({
        step: `linkedin_enrichment_${searches}`,
        timestamp: new Date().toISOString(),
        elapsed: elapsed(),
        status: match ? "ok" : "skipped",
        detail: {
          keywords,
          matched: Boolean(match),
          raw_results: result.items?.length || 0,
          linkedin_url: match?.linkedin_url || null,
        },
      });

      if (match) {
        const mergedContact = mergeContacts(target.bundle.contact, match);
        enriched[target.index] = {
          ...target.bundle,
          contact: mergedContact,
          candidateKey: buildCandidateKey(mergedContact, target.bundle.evidence),
        };
      }
    } catch (error) {
      const code = error instanceof ApifyError ? error.code : "unknown";
      steps.push({
        step: `linkedin_enrichment_${searches + 1}`,
        timestamp: new Date().toISOString(),
        elapsed: elapsed(),
        status: "error",
        detail: {
          keywords,
          code,
          error: error instanceof Error ? error.message : "LinkedIn enrichment failed",
        },
      });

      if (error instanceof ApifyError && error.code === "apify_quota_exhausted") {
        break;
      }
    }
  }

  return { bundles: enriched, searches };
}

async function processFrontierRow(
  supabase: SupabaseAdminClient,
  frontier: FrontierRow,
  domainPolicy: DiscoveryDomainPolicy | null,
  geminiKey: string,
  runId: string | undefined,
  steps: StepLog[],
  elapsed: () => string,
  llmStats: { calls: number },
  heartbeat: () => Promise<void>,
): Promise<PageProcessResult> {
  const page = await fetchPage(frontier.url);
  await heartbeat();

  if (!page.contentType.includes("text/html") && !page.contentType.includes("text/plain") && page.contentType !== "") {
    await supabase
      .from("discovery_frontier")
      .update({
        status: "ignored",
        claimed_at: null,
        claimed_run_id: null,
        last_http_status: page.status,
        last_fetched_at: page.fetchedAt,
        page_type: "irrelevant",
        last_extraction_outcome: "non_html_content",
        next_fetch_at: computeNextFetchAt("irrelevant", 0),
      })
      .eq("id", frontier.id);

    return {
      pageId: null,
      classification: {
        pageType: "irrelevant",
        shouldExtract: false,
        shouldExpand: false,
        confidence: 1,
        reason: "Non-HTML content.",
        method: "heuristic",
      },
      extractedBundles: [],
      extractedOrganizationBundles: [],
      childLinksQueued: 0,
      duplicatesSkipped: 0,
      organizationDuplicatesSkipped: 0,
      derivedLabelsUpserted: 0,
      insertedContacts: 0,
      mergedContacts: 0,
      insertedOrganizations: 0,
      mergedOrganizations: 0,
      linkedinSearches: 0,
      sitemapSeeded: 0,
      rssSeeded: 0,
    };
  }

  let classification = classifyPageHeuristically(page);
  if (
    classification.confidence < 0.6 &&
    classification.pageType !== "low_value_boilerplate" &&
    classification.pageType !== "irrelevant" &&
    page.text.length > 250
  ) {
    try {
      classification = await classifyPageWithLLM(page, geminiKey);
      llmStats.calls += 1;
    } catch (error) {
      if (!isRetryableUpstreamError(error)) {
        throw error;
      }
      classification.reason = `${classification.reason} LLM classification deferred; kept heuristic label.`;
    }
  }

  const parentHasStrongSignals =
    classification.shouldExtract ||
    ["team_or_roster", "lab_or_group_page", "directory_or_index_page", "person_profile"].includes(
      classification.pageType,
    );
  const childLinks = classification.shouldExpand
    ? pickTopChildLinks(page.canonicalUrl, page.links, {
      limit: MAX_CHILD_LINKS,
      minScore: isProvenDomain(domainPolicy) ? 2 : 3,
      context: {
        parentPageType: classification.pageType,
        parentHasStrongSignals,
        domainApprovedCount: Number(domainPolicy?.candidates_approved || 0),
        domainYieldScore: Number(domainPolicy?.yield_score || 0),
      },
    })
    : [];
  const pageId = await upsertDiscoveryPage(supabase, frontier, page, classification, childLinks);
  await heartbeat();

  steps.push({
    step: `page_classification_${frontier.id}`,
    timestamp: new Date().toISOString(),
    elapsed: elapsed(),
    status: "ok",
    detail: {
      frontier_id: frontier.id,
      url: page.canonicalUrl,
      page_type: classification.pageType,
      method: classification.method,
      confidence: Number(classification.confidence.toFixed(2)),
      should_extract: classification.shouldExtract,
      should_expand: classification.shouldExpand,
      reason: classification.reason,
    },
  });

  if (frontier.content_hash && frontier.content_hash === page.contentHash) {
    const expandFromSignals = parentHasStrongSignals && isProvenDomain(domainPolicy);
    const childLinksQueued = await enqueueChildLinks(
      supabase,
      frontier,
      childLinks,
      domainPolicy,
      expandFromSignals,
    );

    await supabase
      .from("discovery_frontier")
      .update({
        url: page.finalUrl,
        domain: page.domain,
        title: page.title || null,
        status: "done",
        claimed_at: null,
        claimed_run_id: null,
        last_http_status: page.status,
        last_fetched_at: page.fetchedAt,
        content_hash: page.contentHash,
        page_type: classification.pageType,
        last_extraction_outcome: "unchanged",
        next_fetch_at: computeNextFetchAt(classification.pageType, 0, 0, domainPolicy),
      })
      .eq("id", frontier.id);

    await bumpDomainStats(supabase, page.domain, {
      pagesFetched: 1,
      pagesQueued: -1 + childLinksQueued,
      promisingPages: classification.shouldExtract ? 1 : 0,
      lastSeenAt: page.fetchedAt,
      lastFetchedAt: page.fetchedAt,
      nextFetchAt: computeNextFetchAt(classification.pageType, 0, 0, domainPolicy),
      sourcePackId: frontier.source_pack_id,
    });

    return {
      pageId,
      classification,
      extractedBundles: [],
      extractedOrganizationBundles: [],
      childLinksQueued,
      duplicatesSkipped: 0,
      organizationDuplicatesSkipped: 0,
      derivedLabelsUpserted: 0,
      insertedContacts: 0,
      mergedContacts: 0,
      insertedOrganizations: 0,
      mergedOrganizations: 0,
      linkedinSearches: 0,
      sitemapSeeded: 0,
      rssSeeded: 0,
    };
  }

  let bundles: CandidateBundle[] = [];
  let organizationBundles: OrganizationCandidateBundle[] = [];
  let extractionDeferred = false;
  let extractionErrorMessage: string | null = null;
  if (classification.shouldExtract && page.text.length > 250) {
    try {
      const extraction = await extractCandidatesFromPage(page, classification, geminiKey);
      llmStats.calls += 1;

      bundles = extraction.contacts.map((contact) => ({
        contact,
        evidence: [
          {
            pageUrl: page.canonicalUrl,
            pageTitle: page.title,
            pageType: classification.pageType,
            sourceType: frontier.source_type,
            evidenceExcerpt: contact.evidence_excerpt,
            rawLocationText: contact.raw_location_text,
            rawFlemishText: contact.raw_flemish_text,
            rawRoleText: contact.raw_role_text,
            extractionConfidence: contact.extraction_confidence,
            locationCity: contact.location_city,
            locationState: contact.location_state,
            discoveredVia: frontier.discovery_reason || frontier.source_type,
            parentUrl: frontier.discovered_from_url,
            fetchedAt: page.fetchedAt,
            discoveryPageId: pageId,
          },
        ],
        candidateKey: buildCandidateKey(contact, [
          {
            pageUrl: page.canonicalUrl,
            pageTitle: page.title,
            pageType: classification.pageType,
            sourceType: frontier.source_type,
            evidenceExcerpt: contact.evidence_excerpt,
            rawLocationText: contact.raw_location_text,
            rawFlemishText: contact.raw_flemish_text,
            rawRoleText: contact.raw_role_text,
            extractionConfidence: contact.extraction_confidence,
            locationCity: contact.location_city,
            locationState: contact.location_state,
            discoveredVia: frontier.discovery_reason || frontier.source_type,
            parentUrl: frontier.discovered_from_url,
            fetchedAt: page.fetchedAt,
            discoveryPageId: pageId,
          },
        ]),
      }));
      organizationBundles = extraction.organizations.map((organization) => {
        const primaryLocation = organization.us_locations.find((location) => location.is_primary) ||
          organization.us_locations[0];
        const sourceDomain = primaryOrganizationDomain(organization);

        return {
          organization,
          evidence: [
            {
              pageUrl: page.canonicalUrl,
              pageTitle: page.title,
              pageType: classification.pageType,
              sourceType: frontier.source_type,
              sourceName: sourceDomain || frontier.domain,
              sourceUrl: page.canonicalUrl,
              evidenceExcerpt: organization.evidence_excerpt,
              rawRelevanceText: organization.raw_relevance_text,
              rawLocationText: organization.raw_location_text,
              rawSectorText: organization.raw_sector_text,
              normalizedLocationCity: primaryLocation?.city || "",
              normalizedLocationState: primaryLocation?.state || "",
              normalizedLocationCountry: primaryLocation?.country || "",
              confidence: organization.confidence,
              observedAt: page.fetchedAt,
              discoveryPageId: pageId,
            },
          ],
          candidateKey: organizationCandidateKey(organization),
        };
      });
    } catch (error) {
      if (!isRetryableUpstreamError(error)) {
        throw error;
      }
      extractionDeferred = true;
      extractionErrorMessage = getErrorMessage(error);
    }
    await heartbeat();
  }

  bundles = consolidateBundles(bundles).map((bundle) => ({
    ...bundle,
    candidateKey: bundle.candidateKey || buildCandidateKey(bundle.contact, bundle.evidence),
  }));
  organizationBundles = consolidateOrganizationBundles(organizationBundles).map((bundle) => ({
    ...bundle,
    candidateKey: bundle.candidateKey || organizationCandidateKey(bundle.organization),
  }));
  const enrichment = await maybeEnrichViaLinkedIn(bundles, steps, elapsed);
  bundles = enrichment.bundles;
  await heartbeat();

  let insertedContacts = 0;
  let mergedContacts = 0;
  let duplicatesSkipped = 0;
  let organizationDuplicatesSkipped = 0;
  let derivedLabelsUpserted = 0;
  let insertedOrganizations = 0;
  let mergedOrganizations = 0;

  for (const bundle of bundles) {
    const result = await persistCandidateBundle(supabase, bundle, runId);
    if (result.status === "inserted") insertedContacts += 1;
    if (result.status === "merged") mergedContacts += 1;
    if (result.status === "duplicate_people") duplicatesSkipped += 1;
    derivedLabelsUpserted += result.derivedLabelsUpserted;
    if (result.discoveredContactId) {
      await upsertEntityPivots(supabase, result.discoveredContactId, bundle);
    }
  }

  for (const bundle of organizationBundles) {
    const result = await persistOrganizationBundle(supabase, bundle, runId);
    if (result.status === "inserted") insertedOrganizations += 1;
    if (result.status === "merged") mergedOrganizations += 1;
    if (result.status === "duplicate_organizations") organizationDuplicatesSkipped += 1;
  }

  if (duplicatesSkipped + organizationDuplicatesSkipped > 0) {
    await bumpDomainStats(supabase, page.domain, {
      duplicateCandidates: duplicatesSkipped + organizationDuplicatesSkipped,
    });
  }

  const shouldExpandAggressively =
    bundles.length > 0 ||
    organizationBundles.length > 0 ||
    (
      parentHasStrongSignals &&
      ["team_or_roster", "lab_or_group_page", "directory_or_index_page"].includes(classification.pageType)
    );
  const childLinksQueued = await enqueueChildLinks(
    supabase,
    frontier,
    childLinks,
    domainPolicy,
    shouldExpandAggressively,
  );
  await heartbeat();

  const harvestResult = classification.pageType === "low_value_boilerplate" || classification.pageType === "irrelevant"
    ? { seeded: 0, sitemapSeeded: 0, rssSeeded: 0 }
    : await maybeHarvestProvenDomain(supabase, frontier, domainPolicy, runId, steps, elapsed);
  await heartbeat();

  steps.push({
    step: `page_extraction_${frontier.id}`,
    timestamp: new Date().toISOString(),
    elapsed: elapsed(),
    status: extractionDeferred ? "skipped" : classification.shouldExtract ? "ok" : "skipped",
    detail: {
      frontier_id: frontier.id,
      url: page.canonicalUrl,
      extracted_candidates: bundles.length + organizationBundles.length,
      extracted_contacts: bundles.length,
      extracted_organizations: organizationBundles.length,
      inserted_contacts: insertedContacts,
      merged_contacts: mergedContacts,
      duplicates_skipped: duplicatesSkipped,
      inserted_organizations: insertedOrganizations,
      merged_organizations: mergedOrganizations,
      organization_duplicates_skipped: organizationDuplicatesSkipped,
      derived_labels_upserted: derivedLabelsUpserted,
      child_links_queued: childLinksQueued,
      sitemap_seeded: harvestResult.sitemapSeeded,
      rss_seeded: harvestResult.rssSeeded,
      extraction_timeout: extractionDeferred && (extractionErrorMessage?.toLowerCase().includes("timed out") || false),
      timeout_error: extractionErrorMessage?.toLowerCase().includes("timed out") ? extractionErrorMessage : null,
      extraction_deferred: extractionDeferred,
      deferred_error: extractionErrorMessage,
    },
  });

  const nextFetchAt = extractionDeferred
    ? computeRetryAt(EXTRACTION_TIMEOUT_RETRY_HOURS)
    : computeNextFetchAt(classification.pageType, bundles.length, 0, domainPolicy);
  await supabase
    .from("discovery_frontier")
    .update({
      url: page.finalUrl,
      domain: page.domain,
      title: page.title || null,
      status: "done",
      claimed_at: null,
      claimed_run_id: null,
      last_http_status: page.status,
      last_fetched_at: page.fetchedAt,
      content_hash: page.contentHash,
      page_type: classification.pageType,
      last_extraction_outcome: extractionDeferred
        ? "upstream_retry"
        : bundles.length + organizationBundles.length > 0
        ? "candidate_extracted"
        : classification.shouldExtract
        ? "no_candidate"
        : "not_extracted",
      next_fetch_at: nextFetchAt,
    })
    .eq("id", frontier.id);

  const evidenceConfidence =
    bundles.length > 0
      ? bundles.reduce((sum, bundle) => sum + bundle.evidence[0].extractionConfidence, 0) / bundles.length
      : organizationBundles.length > 0
      ? organizationBundles.reduce((sum, bundle) => sum + bundle.evidence[0].confidence, 0) / organizationBundles.length
      : null;

  await bumpDomainStats(supabase, page.domain, {
    pagesQueued: -1 + childLinksQueued,
    pagesFetched: 1,
    promisingPages: classification.shouldExtract ? 1 : 0,
    candidatesExtracted: insertedContacts + mergedContacts + insertedOrganizations + mergedOrganizations,
    sourcePackId: frontier.source_pack_id,
    lastSeenAt: page.fetchedAt,
    lastFetchedAt: page.fetchedAt,
    nextFetchAt,
    averageEvidenceConfidence: evidenceConfidence,
  });

  return {
    pageId,
    classification,
    extractedBundles: bundles,
    extractedOrganizationBundles: organizationBundles,
    childLinksQueued,
    duplicatesSkipped,
    organizationDuplicatesSkipped,
    derivedLabelsUpserted,
    insertedContacts,
    mergedContacts,
    insertedOrganizations,
    mergedOrganizations,
    linkedinSearches: enrichment.searches,
    sitemapSeeded: harvestResult.sitemapSeeded,
    rssSeeded: harvestResult.rssSeeded,
  };
}

Deno.serve(wrapHandler(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  let supabase: SupabaseAdminClient | null = null;
  let runId: string | undefined;

  try {
    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiKey) {
      throw new HttpError(500, "Missing GEMINI_API_KEY");
    }

    supabase = createAdminClient();
    const adminClient = supabase;
    await requireStaffRole(req, adminClient, "editor");

    const body = await req.json();
    const query = normalizeWhitespace(safeString(body.query));
    runId = safeString(body.run_id) || undefined;
    const batchSize = Math.max(
      1,
      Math.min(MAX_BATCH_SIZE, Number(body.batch_size || DEFAULT_BATCH_SIZE)),
    );

    const heartbeat = async () => {
      if (!runId) return;
      await adminClient
        .from("agent_runs")
        .update({ heartbeat_at: new Date().toISOString() })
        .eq("id", runId);
    };

    const startTime = Date.now();
    const DEADLINE_MS = 55_000;
    const timeLeft = () => DEADLINE_MS - (Date.now() - startTime);
    const isTimedOut = () => timeLeft() < 3_000;
    const elapsed = () => `${((Date.now() - startTime) / 1000).toFixed(1)}s`;

    let llmCallsMade = 0;
    let webSearchesMade = 0;
    let linkedinSearchesMade = 0;
    let webSearchProvider = "none";
    let frontierSeeded = 0;
    let frontierClaimed = 0;
    let pagesFetched = 0;
    let insertedContacts = 0;
    let mergedContacts = 0;
    let duplicatesSkipped = 0;
    let insertedOrganizations = 0;
    let mergedOrganizations = 0;
    let organizationDuplicatesSkipped = 0;
    let derivedLabelsUpserted = 0;
    let childLinksQueued = 0;
    let sitemapUrlsSeeded = 0;
    let rssUrlsSeeded = 0;
    let sourcePacksUsed: string[] = [];
    let gapTargetsUsed: string[] = [];
    let entityPivotsUsed: string[] = [];

    const steps: StepLog[] = [];
    const errors: string[] = [];

    await heartbeat();

    const [queuedFrontierCount, sourcePacks, coverageGaps, entityPivots] = await Promise.all([
      getQueuedFrontierCount(supabase),
      loadSourcePacks(supabase),
      loadCoverageGaps(supabase),
      loadEntityPivots(supabase),
    ]);

    const shouldSeed = query.length > 0 || queuedFrontierCount < batchSize;
    const seedPlans = shouldSeed
      ? buildSeedPlans(query, sourcePacks, coverageGaps, entityPivots, runId)
      : [];
    gapTargetsUsed = uniqueStrings(seedPlans.map((plan) => plan.coverageTargetKey || "").filter(Boolean));
    entityPivotsUsed = uniqueStrings(seedPlans.map((plan) => plan.entityKey || "").filter(Boolean));

    steps.push({
      step: "discovery_plan",
      timestamp: new Date().toISOString(),
      elapsed: elapsed(),
      status: "ok",
      detail: {
        query: query || null,
        queued_frontier_before: queuedFrontierCount,
        should_seed: shouldSeed,
        seed_queries: seedPlans.map((plan) => ({
          query: plan.query,
          source_type: plan.sourceType,
          source_pack_id: plan.sourcePackId,
          entity_key: plan.entityKey,
          entity_name: plan.entityName,
          entity_type: plan.entityType,
          coverage_target_key: plan.coverageTargetKey,
          gap_label: plan.gapLabel,
          gap_score: plan.gapScore,
          gap_sector: plan.gapSector,
        })),
        gap_targets: coverageGaps.slice(0, 3).map((gap) => ({
          geography_key: gap.geography_key,
          label: gap.label,
          gap_score: gap.gap_score,
        })),
        batch_size: batchSize,
      },
    });

    if (!isTimedOut() && seedPlans.length > 0) {
      const seedResult = await seedFrontier(
        supabase,
        seedPlans,
        runId,
        queuedFrontierCount,
        steps,
        elapsed,
      );
      frontierSeeded = seedResult.seeded;
      webSearchProvider = seedResult.provider;
      webSearchesMade = seedPlans.length;
      sourcePacksUsed = seedResult.usedSourcePackIds;
      entityPivotsUsed = uniqueStrings([
        ...entityPivotsUsed,
        ...seedResult.usedEntityKeys,
      ]);
      await markSourcePacksSeeded(supabase, sourcePacksUsed);
      await markEntityPivotsSeeded(supabase, seedResult.usedEntityKeys);
    }

    await heartbeat();

    if (!runId) {
      throw new Error("agent-discovery requires run_id when triggered via the scheduler");
    }

    if (isTimedOut()) {
      throw new Error("Discovery run hit the time budget before claiming frontier work");
    }

    const claimed = await claimFrontierBatch(supabase, runId, batchSize);
    frontierClaimed = claimed.length;

    if (claimed.length > 0) {
      const claimedByDomain = new Map<string, number>();
      for (const frontier of claimed) {
        claimedByDomain.set(frontier.domain, (claimedByDomain.get(frontier.domain) || 0) + 1);
      }
      await Promise.all(
        [...claimedByDomain.entries()].map(([domain, count]) =>
          bumpDomainStats(adminClient, domain, { pagesQueued: -count })
        ),
      );
    }

    steps.push({
      step: "frontier_claim",
      timestamp: new Date().toISOString(),
      elapsed: elapsed(),
      status: claimed.length > 0 ? "ok" : "skipped",
      detail: {
        claimed_count: claimed.length,
        frontier_ids: claimed.map((row) => row.id),
      },
    });

    const domainPolicies = await loadDomainPolicies(
      supabase,
      claimed.map((row) => row.domain),
    );

    const llmStats = { calls: 0 };

    for (const frontier of claimed) {
      if (isTimedOut()) {
        steps.push({
          step: `frontier_process_${frontier.id}`,
          timestamp: new Date().toISOString(),
          elapsed: elapsed(),
          status: "skipped",
          detail: {
            frontier_id: frontier.id,
            reason: "Not enough time remaining",
          },
        });
        break;
      }

      try {
        await heartbeat();
        const result = await processFrontierRow(
          supabase,
          frontier,
          domainPolicies.get(frontier.domain) || null,
          geminiKey,
          runId,
          steps,
          elapsed,
          llmStats,
          heartbeat,
        );

        pagesFetched += 1;
        insertedContacts += result.insertedContacts;
        mergedContacts += result.mergedContacts;
        duplicatesSkipped += result.duplicatesSkipped;
        insertedOrganizations += result.insertedOrganizations;
        mergedOrganizations += result.mergedOrganizations;
        organizationDuplicatesSkipped += result.organizationDuplicatesSkipped;
        derivedLabelsUpserted += result.derivedLabelsUpserted;
        childLinksQueued += result.childLinksQueued;
        linkedinSearchesMade += result.linkedinSearches;
        sitemapUrlsSeeded += result.sitemapSeeded;
        rssUrlsSeeded += result.rssSeeded;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown processing error";
        const retryable = isRetryableUpstreamError(error);
        if (!retryable) {
          errors.push(`Failed processing ${frontier.canonical_url}: ${message}`);
        }

        await supabase
          .from("discovery_frontier")
          .update({
            status: retryable ? "queued" : "failed",
            claimed_at: null,
            claimed_run_id: null,
            fetch_error_count: retryable
              ? Number(frontier.fetch_error_count || 0)
              : Number(frontier.fetch_error_count || 0) + 1,
            last_extraction_outcome: retryable ? "upstream_retry" : "failed",
            next_fetch_at: retryable
              ? computeRetryAt(EXTRACTION_TIMEOUT_RETRY_HOURS)
              : computeNextFetchAt(
                "irrelevant",
                0,
                Number(frontier.fetch_error_count || 0) + 1,
                domainPolicies.get(frontier.domain) || null,
              ),
          })
          .eq("id", frontier.id);

        steps.push({
          step: `frontier_process_${frontier.id}`,
          timestamp: new Date().toISOString(),
          elapsed: elapsed(),
          status: retryable ? "skipped" : "error",
          detail: {
            frontier_id: frontier.id,
            url: frontier.canonical_url,
            error: message,
            retry_scheduled: retryable,
          },
        });
      }
    }

    llmCallsMade = llmStats.calls;

    if (isTimedOut()) {
      await releaseClaimedFrontier(supabase, runId);
    }

    const frontierQueueAfter = await getQueuedFrontierCount(supabase);

    const result = {
      mode: query ? "custom_query" : "seeded_frontier_batch",
      input_query: query || null,
      frontier_seeded: frontierSeeded,
      frontier_claimed: frontierClaimed,
      frontier_queue_after: frontierQueueAfter,
      pages_fetched: pagesFetched,
      suggestions_created: insertedContacts,
      suggestions_merged: mergedContacts,
      duplicates_skipped: duplicatesSkipped,
      organizations_inserted: insertedOrganizations,
      organizations_merged: mergedOrganizations,
      organization_duplicates_skipped: organizationDuplicatesSkipped,
      organization_suggestions_created: insertedOrganizations,
      organization_suggestions_merged: mergedOrganizations,
      derived_labels_upserted: derivedLabelsUpserted,
      child_links_queued: childLinksQueued,
      sitemap_urls_seeded: sitemapUrlsSeeded,
      rss_urls_seeded: rssUrlsSeeded,
      source_packs_used: sourcePacksUsed,
      gap_targets_used: gapTargetsUsed,
      entity_pivots_used: entityPivotsUsed,
      llm_calls_made: llmCallsMade,
      web_searches_made: webSearchesMade,
      linkedin_searches_made: linkedinSearchesMade,
      web_search_provider: webSearchProvider,
      llm_model_used: {
        extraction: getPrimaryGeminiModel("contact_extraction"),
        classification: getPrimaryGeminiModel("page_classification"),
      },
      errors: errors.length > 0 ? errors : undefined,
      steps,
    };

    if (runId && supabase) {
      const costEstimate = llmCallsMade * 0.001 + linkedinSearchesMade * 0.1;
      await supabase
        .from("agent_runs")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          results: result,
          llm_calls_made: llmCallsMade,
          llm_model_used: getPrimaryGeminiModel("contact_extraction"),
          web_searches_made: webSearchesMade,
          web_search_provider: webSearchProvider,
          cost_estimate_usd: Math.round(costEstimate * 10000) / 10000,
        })
        .eq("id", runId);
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    if (runId && supabase) {
      try {
        await releaseClaimedFrontier(supabase, runId);
      } catch (cleanupError) {
        log.withRun(runId).warn("release_claimed_frontier_failed", cleanupError);
      }

      try {
        await supabase
          .from("agent_runs")
          .update({
            status: "failed",
            completed_at: new Date().toISOString(),
            error_message: error instanceof Error ? error.message : "Unknown error",
            error_kind: agentRunErrorKindFor(error),
          })
          .eq("id", runId);
      } catch (updateError) {
        log.withRun(runId).warn("persist_run_failure_failed", updateError);
      }
    }

    return new Response(
      JSON.stringify({
        ...structuredErrorBody(error),
        llm_calls_made: 0,
        web_searches_made: 0,
        linkedin_searches_made: 0,
      }),
      {
        status: statusForError(error),
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
}));
