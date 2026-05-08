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
  type FlemishFactCandidate,
  type OrganizationLocationEvidence,
  type OrganizationNetworkStatus,
} from "../_shared/discoveryOrganizations.ts";
import { createLogger } from "../_shared/log.ts";
import {
  generateSearchQueries,
  type GeneratedQuery,
  type QueryGenerationContext,
} from "../_shared/queryGeneration.ts";
import {
  allocateBudget,
  updateArmStats,
  type AllocationSlot,
} from "../_shared/banditAllocator.ts";
import { validatePivot } from "../_shared/pivotValidation.ts";

const log = createLogger("agent-discovery");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, apikey, x-client-info",
};

const DEFAULT_BATCH_SIZE = 10;
const MAX_BATCH_SIZE = 20;
const MAX_SEARCH_QUERIES = 5;
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
          flemish_fact_candidates: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                canonical_name: { type: "STRING" },
                candidate_alias: { type: "STRING" },
                role: { type: "STRING" },
                source_url: { type: "STRING" },
                evidence_excerpt: { type: "STRING" },
                confidence: { type: "NUMBER" },
                raw_evidence: { type: "STRING" },
              },
              required: [
                "canonical_name",
                "candidate_alias",
                "role",
                "source_url",
                "evidence_excerpt",
                "confidence",
                "raw_evidence",
              ],
            },
          },
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
          "flemish_fact_candidates",
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
          flemish_fact_candidates: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                canonical_name: { type: "STRING" },
                candidate_alias: { type: "STRING" },
                role: { type: "STRING" },
                source_url: { type: "STRING" },
                evidence_excerpt: { type: "STRING" },
                confidence: { type: "NUMBER" },
                raw_evidence: { type: "STRING" },
              },
              required: [
                "canonical_name",
                "candidate_alias",
                "role",
                "source_url",
                "evidence_excerpt",
                "confidence",
                "raw_evidence",
              ],
            },
          },
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
          "flemish_fact_candidates",
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
- flemish_fact_candidates must list canonical Flemish/Belgian entity candidates when identifiable. Use canonical_name for the broad entity (for example KU Leuven, UGent, imec, BAEF, Flemish Government, FIT, VUB, Vlerick, VITO, Flanders Make, VIB), candidate_alias for the page phrase when different, role for the relationship, source_url, evidence_excerpt, confidence, and raw_evidence. Do not invent canonical names when the page only has vague Belgian/Flemish relevance; keep that in raw evidence instead.
- Model-discovered aliases are review candidates only; do not mark every raw phrase as a default filter entity.
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
  flemish_fact_candidates: FlemishFactCandidate[];
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

interface DiscoverySurface {
  key: string;
  name: string;
  description: string | null;
  preferred_site_operators: string[];
}

interface DiscoveryLens {
  key: string;
  name: string;
  description: string | null;
  prompt_guidance: string | null;
}

interface DiscoverySeedDomain {
  id: string;
  domain: string;
  surfaces: string[];
  lenses: string[];
  notes: string | null;
}

interface SearchSeedPlan {
  query: string;
  sourceType: "custom_query" | "surface_lens" | "entity_pivot" | "reflection" | "multi_hop" | "composition";
  priorityBoost: number;
  maxSeedUrls: number;
  coverageTargetKey: string | null;
  gapLabel: string | null;
  gapScore: number;
  gapSector: string | null;
  entityKey: string | null;
  entityName: string | null;
  entityType: string | null;
  surface: string | null;
  lens: string | null;
  rationale: string | null;
  domainHint: string | null;
  compositionKeys: string[];
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
  saturation_cooldown_until: string | null;
  validation_score: number | null;
  rolling_new_approved: number;
  rolling_window_started_at: string | null;
}

interface CompositionPivotRow {
  id: string;
  pivot_type: "sector_cluster" | "geo_cluster" | "sector_geo_cluster";
  context: { sector?: string; state?: string; city?: string };
  approved_people_count: number;
  saturation_cooldown_until: string | null;
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
    flemish_fact_candidates: [
      ...base.flemish_fact_candidates,
      ...other.flemish_fact_candidates,
    ],
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
    flemish_fact_candidates: [],
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

function normalizeFlemishFactCandidate(
  raw: Record<string, unknown>,
  fallbackUrl: string,
  fallbackEvidence: string,
): FlemishFactCandidate {
  return {
    canonical_name: normalizeWhitespace(safeString(raw.canonical_name)),
    candidate_alias: normalizeWhitespace(safeString(raw.candidate_alias)),
    role: normalizeWhitespace(safeString(raw.role)),
    source_url: normalizeWhitespace(safeString(raw.source_url)) || fallbackUrl,
    evidence_excerpt: normalizeWhitespace(safeString(raw.evidence_excerpt)) || fallbackEvidence,
    confidence: clampConfidence(raw.confidence),
    raw_evidence: normalizeWhitespace(safeString(raw.raw_evidence)) || fallbackEvidence,
  };
}

function hoursSince(timestamp: string | null | undefined): number {
  if (!timestamp) return Number.POSITIVE_INFINITY;
  const delta = Date.now() - new Date(timestamp).getTime();
  return delta / (1000 * 60 * 60);
}

function pickGapSector(gap: CoverageGapRow | null): string | null {
  const sectors = Array.isArray(gap?.sector_emphasis) ? gap?.sector_emphasis : [];
  return sectors.find((value) => normalizeWhitespace(value).length > 0) || null;
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
  const rawFlemishText = safeString(raw.raw_flemish_text);
  const evidenceExcerpt = safeString(raw.evidence_excerpt);

  return {
    name: safeString(raw.name),
    bio: safeString(raw.bio),
    occupation: safeString(raw.occupation),
    current_position: safeString(raw.current_position),
    location_city: safeString(raw.location_city),
    location_state: safeString(raw.location_state).toUpperCase(),
    flemish_connection: safeString(raw.flemish_connection),
    flemish_fact_candidates: Array.isArray(raw.flemish_fact_candidates)
      ? raw.flemish_fact_candidates
        .filter((value): value is Record<string, unknown> =>
          Boolean(value && typeof value === "object")
        )
        .map((candidate) =>
          normalizeFlemishFactCandidate(candidate, pageUrl, rawFlemishText || evidenceExcerpt)
        )
        .filter((candidate) => candidate.canonical_name.length > 0)
      : [],
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
    raw_flemish_text: rawFlemishText,
    evidence_excerpt: evidenceExcerpt,
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
  const rawRelevanceText = safeString(raw.raw_relevance_text);
  const evidenceExcerpt = safeString(raw.evidence_excerpt);

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
    flemish_fact_candidates: Array.isArray(raw.flemish_fact_candidates)
      ? raw.flemish_fact_candidates
        .filter((value): value is Record<string, unknown> => Boolean(value && typeof value === "object"))
        .map((candidate) =>
          normalizeFlemishFactCandidate(candidate, pageUrl, rawRelevanceText || evidenceExcerpt)
        )
        .filter((candidate) => candidate.canonical_name.length > 0)
      : [],
    source_urls: uniqueStrings([pageUrl, safeString(raw.website_url)]),
    confidence: clampConfidence(raw.confidence),
    evidence_excerpt: evidenceExcerpt,
    raw_relevance_text: rawRelevanceText,
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

async function loadSurfaceLensTaxonomy(
  supabase: SupabaseAdminClient,
): Promise<{
  surfaces: DiscoverySurface[];
  lenses: DiscoveryLens[];
  domains: DiscoverySeedDomain[];
}> {
  const [surfacesRes, lensesRes, domainsRes] = await Promise.all([
    supabase
      .from("discovery_surfaces")
      .select("key, name, description, preferred_site_operators")
      .eq("active", true)
      .order("key"),
    supabase
      .from("discovery_lenses")
      .select("key, name, description, prompt_guidance")
      .eq("active", true)
      .order("key"),
    supabase
      .from("discovery_seed_domains")
      .select("id, domain, surfaces, lenses, notes")
      .eq("active", true)
      .order("domain"),
  ]);

  if (surfacesRes.error) {
    throw new Error(`Failed to load discovery surfaces: ${surfacesRes.error.message}`);
  }
  if (lensesRes.error) {
    throw new Error(`Failed to load discovery lenses: ${lensesRes.error.message}`);
  }
  if (domainsRes.error) {
    throw new Error(`Failed to load discovery seed domains: ${domainsRes.error.message}`);
  }

  return {
    surfaces: (surfacesRes.data || []) as DiscoverySurface[],
    lenses: (lensesRes.data || []) as DiscoveryLens[],
    domains: (domainsRes.data || []) as DiscoverySeedDomain[],
  };
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
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("ops_discovery_entity_pivots")
    .select("*")
    .or("approved_contact_count.gt.0,strong_source_count.gt.0")
    // Only load pivots that have passed validation (score >= 0.5) or have not
    // yet been validated (validation_score IS NULL means the column is absent
    // or not yet set — we let those through for backwards compatibility).
    .or("validation_score.is.null,validation_score.gte.0.5")
    .order("priority_score", { ascending: false })
    .limit(16); // load more then filter saturated ones below

  if (error) {
    throw new Error(`Failed to load entity pivots: ${error.message}`);
  }

  const rows = (data || []) as EntityPivotPlanRow[];

  // Filter out pivots in saturation cooldown.
  const eligible = rows.filter((pivot) => {
    if (!pivot.saturation_cooldown_until) return true;
    return pivot.saturation_cooldown_until <= now;
  });

  return eligible.slice(0, 8);
}

async function loadCompositionPivots(
  supabase: SupabaseAdminClient,
): Promise<CompositionPivotRow[]> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("discovery_composition_pivots")
    .select("id,pivot_type,context,approved_people_count,saturation_cooldown_until")
    .or(`saturation_cooldown_until.is.null,saturation_cooldown_until.lte.${now}`)
    .order("approved_people_count", { ascending: false })
    .limit(4);

  if (error) {
    // Non-fatal: composition pivots are optional
    log.warn("load_composition_pivots_failed", error.message);
    return [];
  }

  return (data || []) as CompositionPivotRow[];
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

function customQueryPlan(generated: GeneratedQuery): SearchSeedPlan {
  return {
    query: generated.query,
    sourceType: "custom_query" as const,
    priorityBoost: 6,
    maxSeedUrls: 10,
    coverageTargetKey: null,
    gapLabel: null,
    gapScore: 0,
    gapSector: null,
    entityKey: null,
    entityName: null,
    entityType: null,
    surface: generated.surface,
    lens: generated.lens,
    rationale: generated.rationale,
    domainHint: null,
    compositionKeys: [],
  };
}

async function runQueryGeneration(
  intent: string,
  options: {
    runId: string | undefined;
    geminiKey: string;
    llmStats: { calls: number };
    steps: StepLog[];
    elapsed: () => string;
    stepLabel: string;
    surfaces?: string[];
    lenses?: string[];
    context?: QueryGenerationContext;
    maxQueries?: number;
  },
): Promise<GeneratedQuery[]> {
  const trimmed = normalizeWhitespace(intent);
  if (!trimmed) return [];

  const rotationSeed = options.context?.rotationSeed || options.runId ||
    new Date().toISOString();

  const result = await generateSearchQueries(
    {
      intent: trimmed,
      surfaces: options.surfaces,
      lenses: options.lenses,
      context: { ...(options.context || {}), rotationSeed },
      maxQueries: options.maxQueries ?? MAX_SEARCH_QUERIES,
      runId: options.runId ?? null,
    },
    options.geminiKey,
  );

  if (!result.fallbackUsed) {
    options.llmStats.calls += 1;
  }

  options.steps.push({
    step: options.stepLabel,
    timestamp: new Date().toISOString(),
    elapsed: options.elapsed(),
    status: result.fallbackUsed ? "skipped" : "ok",
    detail: {
      intent: trimmed,
      rotation_seed: rotationSeed,
      surfaces: options.surfaces || [],
      lenses: options.lenses || [],
      model: result.modelUsed,
      fallback: result.fallbackUsed,
      fallback_reason: result.fallbackReason,
      queries: result.queries.map((entry) => ({
        query: entry.query,
        surface: entry.surface,
        lens: entry.lens,
        rationale: entry.rationale,
      })),
    },
  });

  return result.queries;
}

async function generateCustomQueryPlans(
  query: string,
  runId: string | undefined,
  geminiKey: string,
  llmStats: { calls: number },
  steps: StepLog[],
  elapsed: () => string,
): Promise<SearchSeedPlan[]> {
  const queries = await runQueryGeneration(query, {
    runId,
    geminiKey,
    llmStats,
    steps,
    elapsed,
    stepLabel: "query_generation",
  });
  return queries.map(customQueryPlan);
}


/**
 * Query recently-approved people (last 7 days) and return their employers
 * that are not already covered by an active entity pivot.
 * These feed multi-hop expansion plans in buildQueryPlans.
 */
async function loadMultiHopEmployers(
  supabase: SupabaseAdminClient,
  entityPivots: EntityPivotPlanRow[],
): Promise<string[]> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("people")
    .select("current_employer")
    .not("current_employer", "is", null)
    .gte("created_at", sevenDaysAgo)
    .limit(30);

  if (error) {
    log.warn("load_multi_hop_employers_failed", error.message);
    return [];
  }

  const pivotNames = new Set(entityPivots.map((p) => p.entity_name.toLowerCase().trim()));
  const employers = new Set<string>();
  for (const row of data || []) {
    const emp = (row.current_employer as string | null)?.trim();
    if (!emp) continue;
    if (pivotNames.has(emp.toLowerCase())) continue;
    employers.add(emp);
  }

  return Array.from(employers).slice(0, 6);
}

/**
 * Update rolling_new_approved and saturation_cooldown_until on entity pivots
 * that were used in this run. Called after run completion.
 *
 * A pivot enters 30-day saturation cooldown when rolling_new_approved == 0
 * for 3 consecutive runs AND rolling_window_started_at is older than 7 days.
 */
async function updatePivotSaturation(
  supabase: SupabaseAdminClient,
  usedEntityKeys: string[],
  newApprovedByPivot: Map<string, number>,
): Promise<void> {
  if (usedEntityKeys.length === 0) return;

  const { data: pivots, error } = await supabase
    .from("discovery_entity_pivots")
    .select("id, entity_key, rolling_new_approved, rolling_window_started_at, saturation_cooldown_until")
    .in("entity_key", usedEntityKeys);

  if (error || !pivots) return;

  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const thirtyDaysCooldown = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

  for (const pivot of pivots) {
    const newApproved = newApprovedByPivot.get(pivot.entity_key as string) || 0;
    const prevRolling = Number(pivot.rolling_new_approved || 0);
    const windowStarted = pivot.rolling_window_started_at as string | null;

    // Update rolling count (simple increment; reset logic can be added later).
    const nextRolling = prevRolling + newApproved;

    // Saturation: if no new approved in this run AND window is older than 7 days
    // AND rolling count is still 0, set cooldown.
    let newCooldown = pivot.saturation_cooldown_until as string | null;
    if (newApproved === 0 && nextRolling === 0) {
      const windowOld = !windowStarted || windowStarted < sevenDaysAgo;
      if (windowOld) {
        newCooldown = thirtyDaysCooldown;
      }
    } else if (newApproved > 0) {
      // Clear cooldown when we get new approvals.
      newCooldown = null;
    }

    await supabase
      .from("discovery_entity_pivots")
      .update({
        rolling_new_approved: nextRolling,
        saturation_cooldown_until: newCooldown,
      })
      .eq("id", pivot.id as string);
  }
}

async function buildQueryPlans(
  query: string,
  surfaces: DiscoverySurface[],
  lenses: DiscoveryLens[],
  domains: DiscoverySeedDomain[],
  coverageGaps: CoverageGapRow[],
  entityPivots: EntityPivotPlanRow[],
  allocationSlots: AllocationSlot[],
  compositionPivots: CompositionPivotRow[],
  multiHopEmployers: string[],
  runId: string | undefined,
  geminiKey: string,
  llmStats: { calls: number },
  steps: StepLog[],
  elapsed: () => string,
): Promise<SearchSeedPlan[]> {
  const trimmedQuery = normalizeWhitespace(query);

  if (trimmedQuery) {
    return await generateCustomQueryPlans(
      trimmedQuery,
      runId,
      geminiKey,
      llmStats,
      steps,
      elapsed,
    );
  }

  const plans: SearchSeedPlan[] = [];

  // Build lookup maps for surface/lens objects.
  const surfaceByKey = new Map(surfaces.map((s) => [s.key, s]));
  const lensByKey = new Map(lenses.map((l) => [l.key, l]));

  // Helper: find a matching seed domain for a (surface, lens) pair.
  function findDomain(surfaceKey: string, lensKey: string): DiscoverySeedDomain | null {
    const matches = domains.filter(
      (d) => d.surfaces.includes(surfaceKey) && d.lenses.includes(lensKey),
    );
    return matches.length > 0 ? matches[0] : null;
  }

  // 1. Coverage-gap-driven plans: pair top gaps with bandit-allocated slots.
  //    Exploration slots go first (guaranteed by allocateBudget ordering).
  const topGaps = [...coverageGaps]
    .filter((gap) => Number(gap.gap_score || 0) > 0)
    .sort((a, b) => Number(b.gap_score || 0) - Number(a.gap_score || 0))
    .slice(0, 2);

  // Use the first N exploitation slots for gap plans.
  const exploitationSlots = allocationSlots.filter((s) => !s.isExploration);
  const gapSlots = exploitationSlots.slice(0, topGaps.length);

  for (let i = 0; i < topGaps.length && i < gapSlots.length; i += 1) {
    const gap = topGaps[i];
    const slot = gapSlots[i];
    const surface = surfaceByKey.get(slot.surface);
    const lens = lensByKey.get(slot.lens);
    if (!surface || !lens) continue;

    const gapSector = pickGapSector(gap);
    const domain = findDomain(slot.surface, slot.lens);
    const compositionKeys = [
      `surface:${slot.surface}`,
      `lens:${slot.lens}`,
      gap.geography_key ? `geo:${gap.geography_key}` : null,
      gapSector ? `sector:${gapSector}` : null,
    ].filter((value): value is string => Boolean(value));

    const intent = [
      `Surface ${surface.name.toLowerCase()} via ${lens.name.toLowerCase()}`,
      gap.label ? `targeting ${gap.label}` : null,
      gapSector ? `(${gapSector} sector)` : null,
    ].filter(Boolean).join(" ");

    const generated = await runQueryGeneration(intent, {
      runId,
      geminiKey,
      llmStats,
      steps,
      elapsed,
      stepLabel: `query_generation:surface_lens:${slot.surface}:${slot.lens}`,
      surfaces: [slot.surface],
      lenses: [slot.lens],
      maxQueries: 2,
      context: {
        coverageGapLabel: gap.label || null,
        coverageGapSector: gapSector,
        rotationSeed:
          `${runId || "anon"}:${slot.surface}:${slot.lens}:${gap.geography_key}`,
      },
    });

    for (const entry of generated) {
      plans.push({
        query: entry.query,
        sourceType: "surface_lens",
        priorityBoost: 4 + Math.min(Number(gap.gap_score || 0), 6),
        maxSeedUrls: 8,
        coverageTargetKey: gap.geography_key,
        gapLabel: gap.label,
        gapScore: Number(gap.gap_score || 0),
        gapSector,
        entityKey: null,
        entityName: null,
        entityType: null,
        surface: entry.surface || slot.surface,
        lens: entry.lens || slot.lens,
        rationale: entry.rationale,
        domainHint: domain?.domain || null,
        compositionKeys,
      });
    }
  }

  // 2. Exploration slots: at least one basin-exploration tuple so the agent
  //    doesn't only chase gaps it already knows about. The bandit guarantees
  //    ≥ 25% of slots are marked isExploration.
  //    Reflection-driven slots (from discovery_reflection_suggestions) use
  //    sourceType='reflection'; other exploration slots use 'surface_lens'.
  const explorationSlotsForPlan = allocationSlots.filter((s) => s.isExploration);
  const exploSlot = explorationSlotsForPlan[0];
  if (exploSlot) {
    const surface = surfaceByKey.get(exploSlot.surface);
    const lens = lensByKey.get(exploSlot.lens);
    if (surface && lens) {
      const domain = findDomain(exploSlot.surface, exploSlot.lens);
      const compositionKeys = [
        `surface:${exploSlot.surface}`,
        `lens:${exploSlot.lens}`,
        ...(exploSlot.contextKey ? [`context:${exploSlot.contextKey}`] : []),
      ];
      const isReflection = Boolean(exploSlot.reflectionSuggestionId);
      const intent = isReflection
        ? `Reflection-driven exploration: ${surface.name.toLowerCase()} via ${lens.name.toLowerCase()}${exploSlot.contextKey ? ` — context: ${exploSlot.contextKey}` : ""}`
        : `Surface ${surface.name.toLowerCase()} via ${lens.name.toLowerCase()} — broad exploration`;
      const generated = await runQueryGeneration(intent, {
        runId,
        geminiKey,
        llmStats,
        steps,
        elapsed,
        stepLabel: `query_generation:surface_lens:${exploSlot.surface}:${exploSlot.lens}:${isReflection ? "reflection" : "explore"}`,
        surfaces: [exploSlot.surface],
        lenses: [exploSlot.lens],
        maxQueries: 2,
        context: {
          rotationSeed:
            `${runId || "anon"}:${isReflection ? "reflection" : "explore"}:${exploSlot.surface}:${exploSlot.lens}`,
          ...(exploSlot.contextKey
            ? {
              coverageGapLabel: exploSlot.contextKey,
              coverageGapSector: exploSlot.contextKey.startsWith("sector:")
                ? exploSlot.contextKey.replace("sector:", "")
                : null,
            }
            : {}),
        },
      });

      for (const entry of generated) {
        plans.push({
          query: entry.query,
          sourceType: isReflection ? "reflection" : "surface_lens",
          priorityBoost: 3,
          maxSeedUrls: 8,
          coverageTargetKey: null,
          gapLabel: null,
          gapScore: 0,
          gapSector: null,
          entityKey: null,
          entityName: null,
          entityType: null,
          surface: entry.surface || exploSlot.surface,
          lens: entry.lens || exploSlot.lens,
          rationale: entry.rationale,
          domainHint: domain?.domain || null,
          compositionKeys,
        });
      }
    }
  }

  // 3. Entity-pivot plans (kept from prior phase, enriched with surface/lens
  //    tags from the generator).
  const eligiblePivots = entityPivots
    .filter((pivot) => {
      if (!pivot.last_seeded_at) return true;
      return hoursSince(pivot.last_seeded_at) >= 24 * 7;
    })
    .sort((a, b) => Number(b.priority_score || 0) - Number(a.priority_score || 0))
    .slice(0, 2);

  for (const pivot of eligiblePivots) {
    const gap = (pivot.coverage_target_keys || [])
      .map((key) => coverageGaps.find((row) => row.geography_key === key))
      .find((value): value is CoverageGapRow => Boolean(value)) || null;

    const intent =
      `${pivot.entity_name} (${pivot.entity_type}) — surface members, alumni, faculty, leadership, or affiliates with US ties`;
    const generated = await runQueryGeneration(intent, {
      runId,
      geminiKey,
      llmStats,
      steps,
      elapsed,
      stepLabel: `query_generation:entity_pivot:${pivot.entity_key}`,
      lenses: ["named_entity", "alumni_network"],
      maxQueries: 2,
      context: {
        knownEntities: [pivot.entity_name],
        coverageGapLabel: gap?.label || null,
        coverageGapSector: pickGapSector(gap),
        rotationSeed:
          `${runId || "anon"}:${pivot.entity_key}:${pivot.seeded_frontier_count || 0}`,
      },
    });

    for (const entry of generated) {
      plans.push({
        query: entry.query,
        sourceType: "entity_pivot" as const,
        priorityBoost: Number(pivot.priority_score || 0),
        maxSeedUrls: 8,
        coverageTargetKey: gap?.geography_key || null,
        gapLabel: gap?.label || null,
        gapScore: Number(gap?.gap_score || 0),
        gapSector: pickGapSector(gap),
        entityKey: pivot.entity_key,
        entityName: pivot.entity_name,
        entityType: pivot.entity_type,
        surface: entry.surface,
        lens: entry.lens || "named_entity",
        rationale: entry.rationale,
        domainHint: null,
        compositionKeys: [
          `entity:${pivot.entity_key}`,
          gap?.geography_key ? `geo:${gap.geography_key}` : null,
        ].filter((value): value is string => Boolean(value)),
      });
    }
  }

  // 4. Composition pivot plans: one query per active sector/geo cluster.
  for (const comp of compositionPivots.slice(0, 2)) {
    if (plans.length >= MAX_SEARCH_QUERIES) break;
    const { sector, state } = comp.context;
    const ctxLabel = [sector, state].filter(Boolean).join(" / ");
    const compIntent = `Flemish/Belgian professionals in ${ctxLabel} — ${comp.pivot_type.replace(/_/g, " ")} cluster (${comp.approved_people_count} approved)`;
    const generated = await runQueryGeneration(compIntent, {
      runId,
      geminiKey,
      llmStats,
      steps,
      elapsed,
      stepLabel: `query_generation:composition:${comp.id}`,
      lenses: ["sector_geo", "nationality_role"],
      maxQueries: 2,
      context: {
        coverageGapSector: sector,
        coverageGapLabel: state ? `${sector || "professional"} cluster in ${state}` : ctxLabel,
        rotationSeed: `${runId || "anon"}:composition:${comp.id}`,
      },
    });

    for (const entry of generated) {
      if (plans.length >= MAX_SEARCH_QUERIES) break;
      plans.push({
        query: entry.query,
        sourceType: "composition",
        priorityBoost: 3,
        maxSeedUrls: 8,
        coverageTargetKey: null,
        gapLabel: ctxLabel,
        gapScore: 0,
        gapSector: sector || null,
        entityKey: null,
        entityName: null,
        entityType: null,
        surface: entry.surface,
        lens: entry.lens || "sector_geo",
        rationale: entry.rationale,
        domainHint: null,
        compositionKeys: [
          sector ? `sector:${sector}` : null,
          state ? `geo:state:${state}` : null,
          `composition:${comp.pivot_type}`,
        ].filter((v): v is string => Boolean(v)),
      });
    }
  }

  // 5. Multi-hop plans: one query per recently-approved person's employer
  //    (employers not already covered by entity pivots).
  const pivotEntityNames = new Set(entityPivots.map((p) => p.entity_name.toLowerCase()));
  for (const employer of multiHopEmployers.slice(0, 2)) {
    if (plans.length >= MAX_SEARCH_QUERIES) break;
    if (pivotEntityNames.has(employer.toLowerCase())) continue; // already covered

    const intent =
      `${employer} — Flemish/Belgian employees, founders, or alumni with US ties (multi-hop expansion from recently approved person)`;
    const generated = await runQueryGeneration(intent, {
      runId,
      geminiKey,
      llmStats,
      steps,
      elapsed,
      stepLabel: `query_generation:multi_hop:${employer.slice(0, 30)}`,
      lenses: ["company_affiliation", "named_entity"],
      maxQueries: 2,
      context: {
        knownEntities: [employer],
        rotationSeed: `${runId || "anon"}:multi_hop:${employer}`,
      },
    });

    for (const entry of generated) {
      if (plans.length >= MAX_SEARCH_QUERIES) break;
      plans.push({
        query: entry.query,
        sourceType: "multi_hop",
        priorityBoost: 4,
        maxSeedUrls: 8,
        coverageTargetKey: null,
        gapLabel: null,
        gapScore: 0,
        gapSector: null,
        entityKey: null,
        entityName: employer,
        entityType: "organization",
        surface: entry.surface,
        lens: entry.lens || "company_affiliation",
        rationale: entry.rationale,
        domainHint: null,
        compositionKeys: [`multi_hop:${employer.slice(0, 40)}`],
      });
    }
  }

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
    .select("id, canonical_url, status, priority_score, next_fetch_at, pivot_entity_key, pivot_entity_name, pivot_entity_type")
    .in("canonical_url", canonicalUrls);

  const existingByCanonical = new Map(
    (existing || []).map((row: {
      id: string;
      canonical_url: string;
      status: string;
      priority_score: string | number | null;
      next_fetch_at: string | null;
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
      (!existingRow.pivot_entity_key && row.pivot_entity_key);

    if (!shouldRefresh) {
      continue;
    }

    updates.push({
      id: existingRow.id,
      patch: {
        priority_score: nextPriority,
        next_fetch_at: shouldRequeue ? new Date().toISOString() : nextFetchAt,
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
    planned_queries: (input.plannedQueries || []).map((plan) => ({
      query: plan.query,
      source_type: plan.sourceType,
      surface: plan.surface,
      lens: plan.lens,
      domain_hint: plan.domainHint,
      composition_keys: plan.compositionKeys,
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
): Promise<{ seeded: number; provider: string; usedEntityKeys: string[] }> {
  let seeded = 0;
  const providersUsed = new Set<string>();
  const usedEntityKeys = new Set<string>();

  for (let index = 0; index < plans.length; index += 1) {
    const plan = plans[index];
    const searchResponse = await searchWeb(plan.query, supabase);
    if (searchResponse.provider && searchResponse.provider !== "none") {
      providersUsed.add(searchResponse.provider);
    }

    if (runId) {
      const { error: attemptError } = await supabase
        .from("discovery_query_attempts")
        .insert({
          run_id: runId,
          surface: plan.surface,
          lens: plan.lens,
          composition_keys: plan.compositionKeys,
          query_text: plan.query,
          source_type: plan.sourceType,
          pivot_entity_key: plan.entityKey,
          provider: searchResponse.provider || null,
          urls_returned: searchResponse.results.length,
        });
      if (attemptError) {
        log.warn("failed to log discovery_query_attempt", { error: attemptError.message });
      }
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
            plan.sourceType === "surface_lens"
              ? `surface_lens:${plan.surface || "unknown"}:${plan.lens || "unknown"}`
              : plan.sourceType === "reflection"
              ? `reflection:${plan.surface || "unknown"}:${plan.lens || "unknown"}`
              : plan.sourceType === "entity_pivot"
              ? `entity_pivot:${plan.entityKey || plan.entityName || "unknown"}`
              : "custom_query",
          source_type:
            plan.sourceType === "entity_pivot"
              ? "entity_pivot"
              : plan.sourceType === "reflection"
              ? "reflection"
              : "search_seed",
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
          lastSeenAt: new Date().toISOString(),
        });
      });
      if (plan.entityKey) {
        usedEntityKeys.add(plan.entityKey);
      }
    }

    steps.push({
      step: `seed_search_${index + 1}`,
      timestamp: new Date().toISOString(),
      elapsed: elapsed(),
      status: searchResponse.quota_exhausted ? "error" : "ok",
      detail: {
        query: plan.query,
        source_type: plan.sourceType,
        surface: plan.surface,
        lens: plan.lens,
        domain_hint: plan.domainHint,
        composition_keys: plan.compositionKeys,
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
    plannedQueries: plans,
  });

  return {
    seeded,
    provider: [...providersUsed][0] || "none",
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
    flemish_fact_candidates: [],
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
  geminiKey: string,
): Promise<number> {
  const pivotCandidates = extractPivotCandidates(bundle.contact, bundle.evidence);
  if (pivotCandidates.length === 0) return 0;

  let upserted = 0;

  for (const pivot of pivotCandidates) {
    const { data: existingPivot, error: loadError } = await supabase
      .from("discovery_entity_pivots")
      .select("id, source_urls, coverage_target_keys, validation_score")
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

    let pivotId = existingPivot?.id || null;

    if (!existingPivot) {
      // Validate the pivot before inserting it into the active rotation.
      const sourceExcerpts = bundle.evidence
        .map((item) => item.evidenceExcerpt || "")
        .filter(Boolean);
      const validation = await validatePivot(
        pivot.entityName,
        pivot.entityType,
        sourceExcerpts,
        geminiKey,
      );

      const now = new Date().toISOString();
      const { data: insertedPivot, error: insertError } = await supabase
        .from("discovery_entity_pivots")
        .insert({
          entity_key: pivot.entityKey,
          entity_name: pivot.entityName,
          entity_type: pivot.entityType,
          normalized_domain: pivot.normalizedDomain,
          coverage_target_keys: nextCoverageTargets,
          source_urls: nextSourceUrls,
          last_seen_at: now,
          validation_score: validation.score,
          validation_rationale: validation.rationale,
          validation_at: now,
        })
        .select("id")
        .maybeSingle();

      if (insertError || !insertedPivot) {
        throw new Error(insertError?.message || "Failed to insert entity pivot");
      }

      pivotId = insertedPivot.id;

      // Reject pivots that score below the threshold — they stay in the table
      // with the validation score set so we can audit them, but they won't be
      // loaded by loadEntityPivots (which filters validation_score < 0.5).
      if (validation.score < 0.5) {
        log.warn("pivot_validation_rejected", `${pivot.entityKey} score=${validation.score} reason=${validation.rationale}`);
        // Still write the pivot source row below so evidence is preserved.
      }
    } else {
      const { error: updateError } = await supabase
        .from("discovery_entity_pivots")
        .update({
          entity_name: pivot.entityName,
          entity_type: pivot.entityType,
          normalized_domain: pivot.normalizedDomain,
          coverage_target_keys: nextCoverageTargets,
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
    await storeModelDiscoveredFlemishAliases(supabase, mergedContact.flemish_fact_candidates);

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
      flemishFactCandidates: mergedContact.flemish_fact_candidates,
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
  await storeModelDiscoveredFlemishAliases(supabase, bundle.contact.flemish_fact_candidates);

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
      flemishFactCandidates: bundle.contact.flemish_fact_candidates,
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
    flemish_fact_candidates: [],
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
    flemish_belgian_relevance: "",
    flemish_fact_candidates: [],
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

async function storeModelDiscoveredFlemishAliases(
  supabase: SupabaseAdminClient,
  candidates: FlemishFactCandidate[],
): Promise<void> {
  const aliasCandidates = candidates.filter((candidate) =>
    candidate.canonical_name &&
    candidate.candidate_alias &&
    candidate.canonical_name.toLowerCase() !== candidate.candidate_alias.toLowerCase()
  );
  if (aliasCandidates.length === 0) return;

  for (const candidate of aliasCandidates) {
    const { error } = await supabase.rpc("add_flemish_connection_alias", {
      p_connection_name: candidate.canonical_name,
      p_alias: candidate.candidate_alias,
      p_source: "model",
      p_status: "pending",
      p_confidence: candidate.confidence || null,
      p_source_url: candidate.source_url || null,
      p_evidence_excerpt: candidate.evidence_excerpt || candidate.raw_evidence || null,
    });

    if (error) {
      throw new Error(`Failed to store Flemish alias candidate: ${error.message}`);
    }
  }
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
    await storeModelDiscoveredFlemishAliases(supabase, merged.flemish_fact_candidates);

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
  await storeModelDiscoveredFlemishAliases(
    supabase,
    bundle.organization.flemish_fact_candidates,
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
      await upsertEntityPivots(supabase, result.discoveredContactId, bundle, geminiKey);
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
    const DEADLINE_MS = 110_000;
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
    let gapTargetsUsed: string[] = [];
    let entityPivotsUsed: string[] = [];
    let surfacesUsed: string[] = [];
    let lensesUsed: string[] = [];

    const steps: StepLog[] = [];
    const errors: string[] = [];
    const llmStats = { calls: 0 };

    await heartbeat();

    const [queuedFrontierCount, taxonomy, coverageGaps, entityPivots, compositionPivots] = await Promise.all([
      getQueuedFrontierCount(supabase),
      loadSurfaceLensTaxonomy(supabase),
      loadCoverageGaps(supabase),
      loadEntityPivots(supabase),
      loadCompositionPivots(supabase),
    ]);

    // Bandit allocation: allocate query budget across (surface, lens) arms.
    // Budget = MAX_SEARCH_QUERIES minus slots reserved for entity pivots (up to 2).
    // The allocateBudget call falls back gracefully if the table is empty.
    const pivotBudget = Math.min(2, entityPivots.filter((p) => {
      if (!p.last_seeded_at) return true;
      return hoursSince(p.last_seeded_at) >= 24 * 7;
    }).length);
    const surfaceLensBudget = Math.max(1, MAX_SEARCH_QUERIES - pivotBudget);
    let allocationSlots: AllocationSlot[] = [];
    try {
      allocationSlots = await allocateBudget(supabase, surfaceLensBudget, runId || "anon");
    } catch (allocErr) {
      // Non-fatal: fall back to empty allocation (entity pivots and gaps will still run)
      log.withRun(runId).warn("bandit_allocation_failed", allocErr instanceof Error ? allocErr.message : String(allocErr));
    }

    steps.push({
      step: "bandit_allocation",
      timestamp: new Date().toISOString(),
      elapsed: elapsed(),
      status: "ok",
      detail: {
        budget: surfaceLensBudget,
        slots: allocationSlots.map((s) => ({
          surface: s.surface,
          lens: s.lens,
          context_key: s.contextKey,
          is_exploration: s.isExploration,
        })),
      },
    });

    // Multi-hop: load recently approved people's employers for expansion.
    const multiHopEmployers = await loadMultiHopEmployers(supabase, entityPivots).catch((err) => {
      log.withRun(runId).warn("multi_hop_employers_load_failed", err instanceof Error ? err.message : String(err));
      return [] as string[];
    });

    const shouldSeed = query.length > 0 || queuedFrontierCount < batchSize;
    const seedPlans = shouldSeed
      ? await buildQueryPlans(
          query,
          taxonomy.surfaces,
          taxonomy.lenses,
          taxonomy.domains,
          coverageGaps,
          entityPivots,
          allocationSlots,
          compositionPivots,
          multiHopEmployers,
          runId,
          geminiKey,
          llmStats,
          steps,
          elapsed,
        )
      : [];
    gapTargetsUsed = uniqueStrings(seedPlans.map((plan) => plan.coverageTargetKey || "").filter(Boolean));
    entityPivotsUsed = uniqueStrings(seedPlans.map((plan) => plan.entityKey || "").filter(Boolean));
    surfacesUsed = uniqueStrings(seedPlans.map((plan) => plan.surface || "").filter(Boolean));
    lensesUsed = uniqueStrings(seedPlans.map((plan) => plan.lens || "").filter(Boolean));

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
          surface: plan.surface,
          lens: plan.lens,
          domain_hint: plan.domainHint,
          composition_keys: plan.compositionKeys,
          entity_key: plan.entityKey,
          entity_name: plan.entityName,
          entity_type: plan.entityType,
          coverage_target_key: plan.coverageTargetKey,
          gap_label: plan.gapLabel,
          gap_score: plan.gapScore,
          gap_sector: plan.gapSector,
          rationale: plan.rationale,
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
      entityPivotsUsed = uniqueStrings([
        ...entityPivotsUsed,
        ...seedResult.usedEntityKeys,
      ]);
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
      surfaces_used: surfacesUsed,
      lenses_used: lensesUsed,
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

      try {
        await supabase.rpc("resolve_discovery_query_attempts", { p_run_id: runId });
      } catch (resolveError) {
        log.withRun(runId).warn("resolve_query_attempts_failed", resolveError);
      }

      // Update arm stats for all surface_lens plans that ran this session.
      try {
        // Aggregate new_pending_contacts and candidates_extracted per (surface, lens)
        // from the seed plans that were actually executed.
        const armMap = new Map<string, { surface: string; lens: string; contextKey: string; candidatesExtracted: number; newPendingContacts: number; costUsd: number }>();
        for (const plan of seedPlans) {
          if (plan.sourceType !== "surface_lens" || !plan.surface || !plan.lens) continue;
          const key = `${plan.surface}|${plan.lens}|`;
          if (!armMap.has(key)) {
            armMap.set(key, {
              surface: plan.surface,
              lens: plan.lens,
              contextKey: "",
              candidatesExtracted: 0,
              newPendingContacts: 0,
              costUsd: 0,
            });
          }
        }
        // We don't have per-plan new_pending counts here (they resolve async via RPC),
        // so we record attempts=1 per arm with 0 yield. The nightly refresh will
        // pull accurate counters from discovery_query_attempts.
        const armUpdates = Array.from(armMap.values()).map((arm) => ({
          surface: arm.surface,
          lens: arm.lens,
          contextKey: arm.contextKey,
          candidatesExtracted: 0,
          newPendingContacts: 0,
          costUsd: 0,
        }));
        if (armUpdates.length > 0) {
          await updateArmStats(supabase, armUpdates);
        }
      } catch (armStatsError) {
        log.withRun(runId).warn("arm_stats_update_failed", armStatsError instanceof Error ? armStatsError.message : String(armStatsError));
      }

      // Saturation tracking: update rolling_new_approved on entity pivots used in this run.
      // We pass a zero map here (actual approvals come from async RPC resolution later).
      // The key effect is that pivots with long-zero windows will enter cooldown.
      try {
        const usedEntityPivotKeys = seedPlans
          .filter((p) => p.sourceType === "entity_pivot" && p.entityKey)
          .map((p) => p.entityKey as string);
        if (usedEntityPivotKeys.length > 0) {
          await updatePivotSaturation(
            supabase,
            usedEntityPivotKeys,
            new Map<string, number>(), // approvals not yet resolved; saturation logic still applies
          );
        }
      } catch (satErr) {
        log.withRun(runId).warn("pivot_saturation_update_failed", satErr instanceof Error ? satErr.message : String(satErr));
      }
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
