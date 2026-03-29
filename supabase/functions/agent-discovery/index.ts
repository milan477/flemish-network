import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { searchWeb } from "../_shared/webSearch.ts";
import {
  runApifyActor,
  ApifyError,
  APIFY_ACTORS,
  getApifyUsage,
} from "../_shared/apifyClient.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, apikey, x-client-info",
};

const GEMINI_MODEL =
  Deno.env.get("GEMINI_FLASH_MODEL") || "gemini-3-flash-preview";

const MAX_WEB_SEARCHES = 3;
const MAX_LINKEDIN_SEARCHES = 2;

// ── Predefined queries ───────────────────────────────────────────────

const PREDEFINED_WEB_QUERIES = [
  "BAEF fellowship alumni currently in the United States",
  "KU Leuven alumni working in the United States",
  "UGent alumni professionals in the United States",
  "VUB alumni in the United States",
  "UAntwerp alumni working in the United States",
  "Flemish entrepreneurs in US technology sector",
  "Belgian researchers at American universities",
  "imec alumni working in the United States",
];

const PREDEFINED_WEB_QUERY_GROUPS = [
  ["BAEF fellowship alumni currently in the United States"],
  [
    "KU Leuven alumni working in the United States",
    "UGent alumni professionals in the United States",
    "VUB alumni in the United States",
    "UAntwerp alumni working in the United States",
  ],
  [
    "Flemish entrepreneurs in US technology sector",
    "Belgian researchers at American universities",
    "imec alumni working in the United States",
  ],
];

const PREDEFINED_LINKEDIN_QUERIES = [
  { keywords: "KU Leuven", type: "school" },
  { keywords: "UGent OR Ghent University", type: "school" },
  { keywords: "VUB OR Vrije Universiteit Brussel", type: "school" },
  { keywords: "imec", type: "company" },
  { keywords: "Barco", type: "company" },
  { keywords: "Umicore", type: "company" },
  { keywords: "BAEF fellow", type: "keyword" },
];

const PREDEFINED_LINKEDIN_QUERY_GROUPS = [
  [
    { keywords: "KU Leuven", type: "school" },
    { keywords: "UGent OR Ghent University", type: "school" },
    { keywords: "VUB OR Vrije Universiteit Brussel", type: "school" },
  ],
  [
    { keywords: "imec", type: "company" },
    { keywords: "Barco", type: "company" },
    { keywords: "Umicore", type: "company" },
    { keywords: "BAEF fellow", type: "keyword" },
  ],
];

// ── Types ────────────────────────────────────────────────────────────

interface ExtractedContact {
  name: string;
  bio: string;
  occupation: string;
  current_position: string;
  location_city: string;
  location_state: string;
  flemish_connection: string;
  website_url: string;
  email: string;
  linkedin_url: string;
  sectors: string[];
  source_urls: string[];
  channel: "web_search" | "linkedin";
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

interface StepLog {
  step: string;
  timestamp: string;
  elapsed: string;
  status: "ok" | "error" | "skipped";
  detail: Record<string, unknown>;
}

interface LinkedInSearchPlan {
  keywords: string;
  type: string;
}

interface DiscoveryPlan {
  mode: "seeded_sweep" | "custom_query";
  input_query: string | null;
  web_queries: string[];
  linkedin_queries: LinkedInSearchPlan[];
}

interface WebExtractionResult {
  contacts: ExtractedContact[];
  error?: string;
  quotaExceeded?: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────

function safeStr(val: unknown): string {
  if (val === null || val === undefined) return "";
  return String(val);
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeName(name: string): string {
  return normalizeWhitespace(safeStr(name).toLowerCase());
}

function normalizeEmail(email: string): string {
  return normalizeWhitespace(safeStr(email).toLowerCase());
}

function normalizeLinkedInUrl(url: string): string {
  return normalizeWhitespace(safeStr(url)).replace(/\/+$/, "").toLowerCase();
}

function normalizeWebsiteUrl(url: string): string {
  const normalized = normalizeWhitespace(safeStr(url)).replace(/\/+$/, "").toLowerCase();
  return normalized.replace(/^https?:\/\/(www\.)?/, "");
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const trimmed = normalizeWhitespace(value);
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }

  return result;
}

function escapeOrValue(value: string): string {
  return value.replace(/,/g, " ").replace(/[()]/g, " ").trim();
}

function hashSeed(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function selectRotatingItems<T>(items: T[], count: number, seed: string): T[] {
  if (items.length <= count) return [...items];

  const result: T[] = [];
  const start = hashSeed(seed) % items.length;
  for (let i = 0; i < Math.min(count, items.length); i++) {
    result.push(items[(start + i) % items.length]);
  }
  return result;
}

function selectFromGroups<T>(groups: T[][], seed: string): T[] {
  return groups
    .map((group, index) => selectRotatingItems(group, 1, `${seed}:${index}`)[0])
    .filter((item): item is T => item !== undefined);
}

function enrichWebQuery(query: string): string {
  const base = normalizeWhitespace(query);
  const lower = base.toLowerCase();
  const suffixTerms = [
    "flemish",
    "belgian",
    "united states",
  ].filter((term) => !lower.includes(term));

  return suffixTerms.length > 0
    ? `${base} ${suffixTerms.join(" ")}`
    : base;
}

function buildDiscoveryPlan(
  query: string,
  runId?: string
): DiscoveryPlan {
  const trimmedQuery = normalizeWhitespace(query);

  if (trimmedQuery) {
    const webQueries = uniqueStrings([
      enrichWebQuery(trimmedQuery),
      enrichWebQuery(`${trimmedQuery} alumni researcher entrepreneur executive`),
      enrichWebQuery(`${trimmedQuery} KU Leuven UGent VUB UAntwerp imec BAEF`),
    ]).slice(0, MAX_WEB_SEARCHES);

    const linkedinQueries = uniqueStrings([
      trimmedQuery,
      `${trimmedQuery} Belgium OR Flanders`,
      `${trimmedQuery} KU Leuven OR UGent OR VUB OR UAntwerp OR imec`,
    ]).slice(0, MAX_LINKEDIN_SEARCHES).map((keywords) => ({
      keywords,
      type: "keyword",
    }));

    return {
      mode: "custom_query",
      input_query: trimmedQuery,
      web_queries: webQueries,
      linkedin_queries: linkedinQueries,
    };
  }

  const seed = runId || new Date().toISOString().slice(0, 13);
  return {
    mode: "seeded_sweep",
    input_query: null,
    web_queries: uniqueStrings(
      selectFromGroups(PREDEFINED_WEB_QUERY_GROUPS, `web:${seed}`).map(enrichWebQuery)
    ).slice(0, MAX_WEB_SEARCHES),
    linkedin_queries: selectFromGroups(
      PREDEFINED_LINKEDIN_QUERY_GROUPS,
      `linkedin:${seed}`
    ).slice(0, MAX_LINKEDIN_SEARCHES),
  };
}

// Parse US city/state from a location string like "San Francisco, California"
function parseLocation(loc: string): { city: string; state: string } {
  if (!loc) return { city: "", state: "" };
  const parts = loc.split(",").map((s) => s.trim());
  return { city: parts[0] || "", state: parts[1] || "" };
}

// Valid US state codes for filtering out non-US contacts
const US_STATE_CODES = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC",
]);

const NON_US_KEYWORDS = [
  "belgium","brussels","antwerp","ghent","leuven","bruges","liège","namur",
  "flanders","wallonia","europe","germany","france","netherlands","uk",
  "london","paris","berlin","amsterdam",
];

const US_STATE_NAMES = new Set([
  "alabama","alaska","arizona","arkansas","california","colorado","connecticut",
  "delaware","florida","georgia","hawaii","idaho","illinois","indiana","iowa",
  "kansas","kentucky","louisiana","maine","maryland","massachusetts","michigan",
  "minnesota","mississippi","missouri","montana","nebraska","nevada","new hampshire",
  "new jersey","new mexico","new york","north carolina","north dakota","ohio",
  "oklahoma","oregon","pennsylvania","rhode island","south carolina","south dakota",
  "tennessee","texas","utah","vermont","virginia","washington","west virginia",
  "wisconsin","wyoming","district of columbia",
]);

function isLikelyUS(contact: ExtractedContact): boolean {
  const state = contact.location_state.trim();
  const stateUpper = state.toUpperCase();
  const stateLower = state.toLowerCase();

  // If state is a valid US code or full name, it's US
  if (stateUpper && (US_STATE_CODES.has(stateUpper) || US_STATE_NAMES.has(stateLower))) return true;

  // If state contains non-US keywords, filter out
  if (state && NON_US_KEYWORDS.some((kw) => stateLower.includes(kw))) return false;

  // If city contains non-US keywords, filter out
  const cityLower = contact.location_city.toLowerCase();
  if (NON_US_KEYWORDS.some((kw) => cityLower.includes(kw))) return false;

  // No location info or unrecognized state — let it through
  return true;
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

function mergeContacts(
  existing: ExtractedContact,
  incoming: ExtractedContact
): ExtractedContact {
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
    website_url: pickBetterValue(base.website_url, other.website_url),
    email: pickBetterValue(base.email, other.email),
    linkedin_url: pickBetterValue(base.linkedin_url, other.linkedin_url),
    sectors: uniqueStrings([...base.sectors, ...other.sectors]),
    source_urls: uniqueStrings([...base.source_urls, ...other.source_urls]),
    channel:
      base.channel === "linkedin" || other.channel === "linkedin"
        ? "linkedin"
        : "web_search",
  };
}

function locationsCompatible(
  a: ExtractedContact,
  b: ExtractedContact
): boolean {
  const aState = normalizeWhitespace(a.location_state).toLowerCase();
  const bState = normalizeWhitespace(b.location_state).toLowerCase();
  if (aState && bState && aState !== bState) return false;

  const aCity = normalizeWhitespace(a.location_city).toLowerCase();
  const bCity = normalizeWhitespace(b.location_city).toLowerCase();
  if (aCity && bCity && aCity !== bCity && aState && bState) return false;

  return true;
}

function hasConflictingStrongIdentity(
  a: ExtractedContact,
  b: ExtractedContact
): boolean {
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

function likelySameContact(
  a: ExtractedContact,
  b: ExtractedContact
): boolean {
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

function consolidateContacts(contacts: ExtractedContact[]): ExtractedContact[] {
  const consolidated: ExtractedContact[] = [];

  for (const contact of contacts) {
    const matchIndex = consolidated.findIndex((existing) =>
      likelySameContact(existing, contact)
    );

    if (matchIndex === -1) {
      consolidated.push(contact);
      continue;
    }

    consolidated[matchIndex] = mergeContacts(consolidated[matchIndex], contact);
  }

  return consolidated;
}

// Map a LinkedIn profile to our contact schema
function mapLinkedInProfile(profile: LinkedInProfile): ExtractedContact {
  const name =
    safeStr(profile.fullName) ||
    `${safeStr(profile.firstName)} ${safeStr(profile.lastName)}`.trim();
  const position =
    safeStr(profile.headline) ||
    safeStr(profile.position) ||
    safeStr(profile.title);
  const linkedinUrl =
    safeStr(profile.linkedInProfileUrl) || safeStr(profile.profileUrl);
  const loc = parseLocation(safeStr(profile.location));

  return {
    name,
    bio: safeStr(profile.summary || profile.description).slice(0, 500),
    occupation: "",
    current_position: position,
    location_city: loc.city,
    location_state: loc.state,
    flemish_connection: "",
    website_url: "",
    email: "",
    linkedin_url: linkedinUrl,
    sectors: [],
    source_urls: linkedinUrl ? [linkedinUrl] : [],
    channel: "linkedin",
  };
}

// ── Gemini extraction (web search channel) ───────────────────────────

const GEMINI_SCHEMA = {
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
          flemish_connection: { type: "STRING" },
          website_url: { type: "STRING" },
          email: { type: "STRING" },
          linkedin_url: { type: "STRING" },
          sectors: { type: "ARRAY", items: { type: "STRING" } },
          sources: { type: "ARRAY", items: { type: "STRING" } },
        },
        required: [
          "name",
          "bio",
          "occupation",
          "current_position",
          "location_city",
          "location_state",
          "flemish_connection",
          "website_url",
          "email",
          "linkedin_url",
          "sectors",
          "sources",
        ],
      },
    },
  },
  required: ["contacts"],
};

const SYSTEM_PROMPT = `You are a research assistant for a Flemish-American professional network directory. Extract structured contact information from web search results.

Your job is to find EVERY person with a Belgian/Flemish connection mentioned in ANY type of source:
- LinkedIn profiles and personal websites
- News articles and press releases that mention someone
- Blog posts, interviews, and feature stories
- Wikipedia lists and encyclopedia entries
- University faculty pages, alumni spotlights, award announcements
- Organization "about" pages listing team members

Rules:
- Extract EVERY distinct person mentioned that has a Belgian/Flemish connection AND appears to be in the US (or location is unknown — include them too, we'll verify later)
- It is OK to extract a person with incomplete information. A name + flemish connection is enough. Use empty string "" for any unavailable fields.
- Do NOT skip someone just because the source is an article rather than a profile page. If a news article says "Dr. Jan Peeters, a Belgian researcher at MIT", extract that person.
- For location, use US city names and 2-letter state abbreviations (e.g. "CA", "NY", "MA"). If location is unclear, use empty strings — do NOT skip the person.
- ONLY skip people who are clearly located outside the US (e.g. "based in Brussels", "works at KU Leuven in Belgium")
- For sectors, choose from ONLY: Artificial Intelligence, Biotechnology, Finance, Culture & Arts, Education, Research. Use empty array [] if unclear.
- For occupation: Professor, Researcher, Engineer, Executive, Government, Creative, Finance, Entrepreneur, Healthcare, Manager, Consultant, or a short custom label. Use "" if unclear.
- For email: ONLY include emails that appear verbatim in the search results. NEVER fabricate.
- bio should be 1-2 concise sentences summarizing what you know about them from the source
- flemish_connection: mention Belgian/Flemish link (university, fellowship, origin, nationality, etc.)
- sources: include the URL(s) where this person was mentioned`;

async function extractContactsFromWeb(
  searchResults: string,
  query: string,
  geminiKey: string
): Promise<WebExtractionResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
  let lastError = "Unknown Gemini extraction error";
  let quotaExceeded = false;

  const userPrompt = `Query: "${query}"

Web search results:
${searchResults}

Extract ALL Flemish/Belgian-connected people mentioned in these results. Include people from articles, news stories, lists, and any other source — not just profile pages. Even a brief mention of a person's name and their Belgian/Flemish connection is enough to extract them.`;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const controller = new AbortController();
      const fetchTimeout = setTimeout(() => controller.abort(), 30000);
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": geminiKey,
        },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{ role: "user", parts: [{ text: userPrompt }] }],
          generation_config: {
            response_mime_type: "application/json",
            response_schema: GEMINI_SCHEMA,
            temperature: 0.2,
          },
        }),
        signal: controller.signal,
      });
      clearTimeout(fetchTimeout);

      if (!resp.ok) {
        const errorText = await resp.text();
        quotaExceeded = resp.status === 429;
        lastError = `Gemini ${resp.status}: ${errorText.slice(0, 300)}`;
        if (quotaExceeded) break;
        continue;
      }

      const data = await resp.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        lastError = "Gemini returned no structured text";
        continue;
      }

      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed.contacts)) {
        lastError = "Gemini response did not include a contacts array";
        continue;
      }

      return {
        contacts: parsed.contacts
        .filter(
          (c: Record<string, unknown>) =>
            safeStr(c.name).trim().length > 0
        )
        .map((c: Record<string, unknown>): ExtractedContact => ({
          name: safeStr(c.name),
          bio: safeStr(c.bio),
          occupation: safeStr(c.occupation),
          current_position: safeStr(c.current_position),
          location_city: safeStr(c.location_city),
          location_state: safeStr(c.location_state),
          flemish_connection: safeStr(c.flemish_connection),
          website_url: safeStr(c.website_url),
          email: safeStr(c.email),
          linkedin_url: safeStr(c.linkedin_url),
          sectors: Array.isArray(c.sectors)
            ? (c.sectors as unknown[]).filter(
                (s): s is string => typeof s === "string"
              )
            : [],
          source_urls: Array.isArray(c.sources)
            ? (c.sources as unknown[]).filter(
                (s): s is string => typeof s === "string"
              )
            : [],
          channel: "web_search",
        })),
      };
    } catch (err) {
      lastError = err instanceof Error ? err.message : "Gemini request failed";
    }
  }

  return {
    contacts: [],
    error: lastError,
    quotaExceeded,
  };
}

function addKnownIdentifiers(
  sink: Set<string>,
  row: {
    name?: string | null;
    email?: string | null;
    linkedin_url?: string | null;
    website_url?: string | null;
  }
): void {
  const name = normalizeName(row.name || "");
  const email = normalizeEmail(row.email || "");
  const linkedin = normalizeLinkedInUrl(row.linkedin_url || "");
  const website = normalizeWebsiteUrl(row.website_url || "");

  if (name) sink.add(`name:${name}`);
  if (email) sink.add(`email:${email}`);
  if (linkedin) sink.add(`linkedin:${linkedin}`);
  if (website) sink.add(`website:${website}`);
}

async function fetchKnownIdentifiers(
  supabase: ReturnType<typeof createClient>,
  table: "people" | "discovered_contacts",
  field: "name" | "email" | "linkedin_url" | "website_url",
  values: string[],
  sink: Set<string>
): Promise<void> {
  if (values.length === 0) return;

  const chunkSize = 20;
  for (let i = 0; i < values.length; i += chunkSize) {
    const chunk = values
      .slice(i, i + chunkSize)
      .map(escapeOrValue)
      .filter(Boolean);

    if (chunk.length === 0) continue;

    const filter = chunk.map((value) => `${field}.ilike.${value}`).join(",");
    const { data } = await supabase
      .from(table)
      .select("name, email, linkedin_url, website_url")
      .or(filter);

    for (const row of data || []) {
      addKnownIdentifiers(sink, row);
    }
  }
}

// ── Main handler ─────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const geminiKey = Deno.env.get("GEMINI_API_KEY");

  if (!supabaseUrl || !supabaseKey) {
    return new Response(
      JSON.stringify({ error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  if (!geminiKey) {
    return new Response(
      JSON.stringify({ error: "Missing GEMINI_API_KEY" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  let runId: string | undefined;

  try {
    const body = await req.json();
    const query: string = safeStr(body.query).trim();
    runId = body.run_id;
    const maxResults = body.max_results || 20;
    const plan = buildDiscoveryPlan(query, runId);

    // Heartbeat helper
    const heartbeat = async () => {
      if (runId) {
        await supabase
          .from("agent_runs")
          .update({ heartbeat_at: new Date().toISOString() })
          .eq("id", runId);
      }
    };

    const startTime = Date.now();
    // Supabase edge function timeout: 60s free tier, 150s pro.
    // Use 55s deadline to leave 5s buffer for self-reporting.
    const DEADLINE_MS = 55_000;
    const timeLeft = () => DEADLINE_MS - (Date.now() - startTime);
    const isTimedOut = () => timeLeft() < 3_000;
    const elapsed = () => `${((Date.now() - startTime) / 1000).toFixed(1)}s`;

    let llmCallsMade = 0;
    let webSearchesMade = 0;
    let linkedinSearchesMade = 0;
    let webSearchProvider = "";
    const allContacts: ExtractedContact[] = [];
    const errors: string[] = [];

    // Step-by-step execution log for observability
    const steps: StepLog[] = [];

    // ── Channel 1: Web search ──────────────────────────────────────

    await heartbeat();

    steps.push({
      step: "search_plan",
      timestamp: new Date().toISOString(),
      elapsed: elapsed(),
      status: "ok",
      detail: {
        mode: plan.mode,
        input_query: plan.input_query,
        web_queries: plan.web_queries,
        linkedin_queries: plan.linkedin_queries,
      },
    });

    for (let i = 0; i < plan.web_queries.length; i++) {
      if (isTimedOut()) {
        steps.push({
          step: `web_search_${i + 1}`,
          timestamp: new Date().toISOString(),
          elapsed: elapsed(),
          status: "skipped",
          detail: {
            query: plan.web_queries[i],
            reason: "Not enough time remaining",
            time_remaining_ms: timeLeft(),
          },
        });
        break;
      }

      const webQuery = plan.web_queries[i];

      try {
        const searchResp = await searchWeb(webQuery, supabase);
        webSearchesMade++;
        if (!searchResp.cached && searchResp.provider !== "none") {
          webSearchProvider = searchResp.provider;
        }

        steps.push({
          step: `web_search_${i + 1}`,
          timestamp: new Date().toISOString(),
          elapsed: elapsed(),
          status: searchResp.quota_exhausted ? "error" : "ok",
          detail: {
            query: webQuery,
            provider: searchResp.provider,
            cached: searchResp.cached,
            results_count: searchResp.results.length,
            quota_exhausted: searchResp.quota_exhausted,
            result_urls: searchResp.results.map((r) => r.url),
          },
        });

        await heartbeat();

        if (searchResp.results.length > 0 && !isTimedOut()) {
          const formatted = searchResp.results
            .map((r) => {
              const body = r.raw_content && r.raw_content.length > r.content.length
                ? r.raw_content.slice(0, 1200)
                : r.content;
              return `Source: ${r.url}\nTitle: ${r.title}\nContent: ${body}`;
            })
            .join("\n\n---\n\n");
          const extraction = await extractContactsFromWeb(
            formatted,
            webQuery,
            geminiKey
          );
          if (extraction.error) {
            errors.push(`LLM extraction failed for "${webQuery}": ${extraction.error}`);
            steps.push({
              step: `llm_extraction_${i + 1}`,
              timestamp: new Date().toISOString(),
              elapsed: elapsed(),
              status: "error",
              detail: {
                query: webQuery,
                model: GEMINI_MODEL,
                error: extraction.error,
                quota_exhausted: extraction.quotaExceeded || false,
              },
            });

            if (extraction.quotaExceeded) break;
            continue;
          }

          llmCallsMade++;

          const usFiltered = extraction.contacts.filter(isLikelyUS);
          const nonUsFiltered = extraction.contacts.filter((c) => !isLikelyUS(c));

          steps.push({
            step: `llm_extraction_${i + 1}`,
            timestamp: new Date().toISOString(),
            elapsed: elapsed(),
            status: "ok",
            detail: {
              query: webQuery,
              model: GEMINI_MODEL,
              extracted_count: extraction.contacts.length,
              us_filtered_count: usFiltered.length,
              non_us_removed: nonUsFiltered.map((c) => ({
                name: c.name,
                location: `${c.location_city}, ${c.location_state}`,
              })),
              contacts: usFiltered.map((c) => ({
                name: c.name,
                position: c.current_position,
                location: `${c.location_city}, ${c.location_state}`,
                flemish_connection: c.flemish_connection,
                email: c.email || null,
                linkedin: c.linkedin_url || null,
                website: c.website_url || null,
                sectors: c.sectors,
              })),
            },
          });

          allContacts.push(...usFiltered);
        }

        if (searchResp.quota_exhausted) {
          errors.push("Web search quota exhausted");
          break;
        }
      } catch (err) {
        const msg = (err as Error).message;
        errors.push(`Web search failed for "${webQuery}": ${msg}`);
        steps.push({
          step: `web_search_${i + 1}`,
          timestamp: new Date().toISOString(),
          elapsed: elapsed(),
          status: "error",
          detail: { query: webQuery, error: msg },
        });
      }
    }

    await heartbeat();

    // ── Channel 2: LinkedIn search via Apify ───────────────────────
    if (isTimedOut()) {
      const msg = "Skipping LinkedIn channel — not enough time remaining";
      steps.push({
        step: "linkedin_search",
        timestamp: new Date().toISOString(),
        elapsed: elapsed(),
        status: "skipped",
        detail: { reason: msg, time_remaining_ms: timeLeft() },
      });
    } else {
      const apifyAvailable = await getApifyUsage();

      if (apifyAvailable.available) {
        for (let i = 0; i < plan.linkedin_queries.length; i++) {
          if (isTimedOut()) {
            steps.push({
              step: `linkedin_search_${i + 1}`,
              timestamp: new Date().toISOString(),
              elapsed: elapsed(),
              status: "skipped",
              detail: {
                query: plan.linkedin_queries[i],
                reason: "Not enough time remaining",
                time_remaining_ms: timeLeft(),
              },
            });
            break;
          }

          try {
            const linkedinQuery = plan.linkedin_queries[i];
            const linkedinInput: Record<string, unknown> = {
              keywords: linkedinQuery.keywords,
              location: "United States",
              limit: 10,
            };

            const apifyTimeout = Math.min(15, Math.floor(timeLeft() / 1000) - 8);
            if (apifyTimeout < 5) {
              throw new Error("Not enough time for LinkedIn search");
            }

            const result = await runApifyActor<LinkedInProfile>(
              APIFY_ACTORS.LINKEDIN_PROFILE_SEARCH,
              linkedinInput,
              { sync: true, timeoutSecs: apifyTimeout }
            );

            linkedinSearchesMade++;

            const rawItems = result.items || [];
            const mapped = rawItems
              .map(mapLinkedInProfile)
              .filter((c) => c.name.trim().length > 0);
            const usFiltered = mapped.filter(isLikelyUS);
            const nonUsFiltered = mapped.filter((c) => !isLikelyUS(c));

            steps.push({
              step: `linkedin_search_${i + 1}`,
              timestamp: new Date().toISOString(),
              elapsed: elapsed(),
              status: "ok",
              detail: {
                actor: APIFY_ACTORS.LINKEDIN_PROFILE_SEARCH,
                query: linkedinQuery,
                input: linkedinInput,
                timeout_secs: apifyTimeout,
                raw_results: rawItems.length,
                mapped_count: mapped.length,
                us_filtered_count: usFiltered.length,
                non_us_removed: nonUsFiltered.map((c) => ({
                  name: c.name,
                  location: `${c.location_city}, ${c.location_state}`,
                })),
                contacts: usFiltered.map((c) => ({
                  name: c.name,
                  position: c.current_position,
                  location: `${c.location_city}, ${c.location_state}`,
                  linkedin: c.linkedin_url || null,
                })),
              },
            });

            allContacts.push(...usFiltered);
            await heartbeat();
          } catch (err) {
            const msg = (err as Error).message;
            const code = err instanceof ApifyError ? err.code : "unknown";

            if (err instanceof ApifyError && err.code === "apify_quota_exhausted") {
              errors.push("Apify credits exhausted — LinkedIn channel skipped");
              steps.push({
                step: `linkedin_search_${i + 1}`,
                timestamp: new Date().toISOString(),
                elapsed: elapsed(),
                status: "error",
                detail: { error: msg, code },
              });
              break;
            }

            errors.push(`LinkedIn search failed: ${msg}`);
            steps.push({
              step: `linkedin_search_${i + 1}`,
              timestamp: new Date().toISOString(),
              elapsed: elapsed(),
              status: "error",
              detail: { error: msg, code },
            });
          }
        }
      } else {
        const msg = `Apify unavailable: ${apifyAvailable.error || "no token"}`;
        errors.push(`${msg} — LinkedIn channel skipped`);
        steps.push({
          step: "linkedin_search",
          timestamp: new Date().toISOString(),
          elapsed: elapsed(),
          status: "skipped",
          detail: { reason: msg },
        });
      }
    }

    await heartbeat();

    // ── Cross-dedup between channels ───────────────────────────────

    const deduped = consolidateContacts(allContacts);

    steps.push({
      step: "cross_dedup",
      timestamp: new Date().toISOString(),
      elapsed: elapsed(),
      status: "ok",
      detail: {
        before: allContacts.length,
        after: deduped.length,
        removed: allContacts.length - deduped.length,
      },
    });

    // ── Dedup against people + discovered_contacts tables (batched) ─

    let duplicatesSkipped = 0;
    const newContacts: ExtractedContact[] = [];
    const dupeNames: string[] = [];

    const allEmails = uniqueStrings(
      deduped
        .map((c) => normalizeEmail(c.email))
        .filter((email) => email && email.includes("@"))
    );
    const allLinkedins = uniqueStrings(
      deduped.map((c) => normalizeLinkedInUrl(c.linkedin_url)).filter(Boolean)
    );
    const allWebsites = uniqueStrings(
      deduped.map((c) => normalizeWebsiteUrl(c.website_url)).filter(Boolean)
    );
    const allNames = uniqueStrings(
      deduped.map((c) => normalizeName(c.name)).filter(Boolean)
    );

    const knownPeople = new Set<string>();
    const knownDiscovered = new Set<string>();

    await Promise.all([
      fetchKnownIdentifiers(supabase, "people", "email", allEmails, knownPeople),
      fetchKnownIdentifiers(supabase, "people", "linkedin_url", allLinkedins, knownPeople),
      fetchKnownIdentifiers(supabase, "people", "website_url", allWebsites, knownPeople),
      fetchKnownIdentifiers(supabase, "people", "name", allNames, knownPeople),
      fetchKnownIdentifiers(supabase, "discovered_contacts", "email", allEmails, knownDiscovered),
      fetchKnownIdentifiers(supabase, "discovered_contacts", "linkedin_url", allLinkedins, knownDiscovered),
      fetchKnownIdentifiers(supabase, "discovered_contacts", "website_url", allWebsites, knownDiscovered),
      fetchKnownIdentifiers(supabase, "discovered_contacts", "name", allNames, knownDiscovered),
    ]);

    // Now check each contact against the batch results
    for (const contact of deduped) {
      const email = normalizeEmail(contact.email);
      const linkedin = normalizeLinkedInUrl(contact.linkedin_url);
      const website = normalizeWebsiteUrl(contact.website_url);
      const name = normalizeName(contact.name);

      const isDupe =
        (email && (knownPeople.has(`email:${email}`) || knownDiscovered.has(`email:${email}`))) ||
        (linkedin &&
          (knownPeople.has(`linkedin:${linkedin}`) ||
            knownDiscovered.has(`linkedin:${linkedin}`))) ||
        (website &&
          (knownPeople.has(`website:${website}`) ||
            knownDiscovered.has(`website:${website}`))) ||
        (name && (knownPeople.has(`name:${name}`) || knownDiscovered.has(`name:${name}`)));

      if (isDupe) {
        duplicatesSkipped++;
        dupeNames.push(contact.name);
      } else {
        newContacts.push(contact);
        addKnownIdentifiers(knownDiscovered, {
          name: contact.name,
          email: contact.email,
          linkedin_url: contact.linkedin_url,
          website_url: contact.website_url,
        });
      }
    }

    steps.push({
      step: "db_dedup",
      timestamp: new Date().toISOString(),
      elapsed: elapsed(),
      status: "ok",
      detail: {
        checked: deduped.length,
        duplicates_found: duplicatesSkipped,
        duplicate_names: dupeNames,
        new_contacts: newContacts.length,
      },
    });

    await heartbeat();

    // ── Insert into discovered_contacts (batched) ─────────────────

    const toInsert = newContacts.slice(0, maxResults);
    let suggestionsCreated = 0;
    const insertedNames: string[] = [];

    if (toInsert.length > 0) {
      const rows = toInsert.map((contact) => ({
        name: contact.name,
        email: contact.email || null,
        linkedin_url: contact.linkedin_url || null,
        current_position: contact.current_position || null,
        occupation: contact.occupation || null,
        location_city: contact.location_city || null,
        location_state: contact.location_state || null,
        bio: contact.bio || null,
        flemish_connection: contact.flemish_connection || null,
        website_url: contact.website_url || null,
        sectors: contact.sectors.length > 0 ? contact.sectors : null,
        source: contact.channel === "linkedin" ? "linkedin_search" : "web_search",
        source_urls: contact.source_urls.length > 0 ? contact.source_urls : null,
        status: "pending",
        agent_run_id: runId || null,
      }));

      const { data, error } = await supabase
        .from("discovered_contacts")
        .insert(rows)
        .select("name");

      if (!error && data) {
        suggestionsCreated = data.length;
        insertedNames.push(...data.map((d: { name: string }) => d.name));
      } else if (error) {
        errors.push(`Insert failed: ${error.message}`);
      }
    }

    steps.push({
      step: "insert",
      timestamp: new Date().toISOString(),
      elapsed: elapsed(),
      status: "ok",
      detail: {
        attempted: toInsert.length,
        inserted: suggestionsCreated,
        names: insertedNames,
        max_results_limit: maxResults,
        total_available: newContacts.length,
      },
    });

    // ── Return results ─────────────────────────────────────────────

    const result = {
      mode: plan.mode,
      input_query: plan.input_query,
      queries_executed: {
        web: plan.web_queries,
        linkedin: plan.linkedin_queries,
      },
      profiles_found: deduped.length,
      duplicates_skipped: duplicatesSkipped,
      suggestions_created: suggestionsCreated,
      sources: {
        web_search: allContacts.filter((c) => c.channel === "web_search").length,
        linkedin: allContacts.filter((c) => c.channel === "linkedin").length,
      },
      llm_calls_made: llmCallsMade,
      web_searches_made: webSearchesMade,
      linkedin_searches_made: linkedinSearchesMade,
      web_search_provider: webSearchProvider || "none",
      llm_model_used: GEMINI_MODEL,
      errors: errors.length > 0 ? errors : undefined,
      steps,
    };

    // Self-report completion to agent_runs
    if (runId) {
      const linkedinSearches = linkedinSearchesMade;
      const costEstimate =
        llmCallsMade * 0.001 + linkedinSearches * 0.1;
      await supabase
        .from("agent_runs")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          results: result,
          llm_calls_made: llmCallsMade,
          llm_model_used: GEMINI_MODEL,
          web_searches_made: webSearchesMade,
          web_search_provider: webSearchProvider || "none",
          cost_estimate_usd: Math.round(costEstimate * 10000) / 10000,
        })
        .eq("id", runId);
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    // Self-report failure
    if (runId) {
      await supabase
        .from("agent_runs")
        .update({
          status: "failed",
          completed_at: new Date().toISOString(),
          error_message: err instanceof Error ? err.message : "Unknown error",
        })
        .eq("id", runId)
        .catch(() => {});
    }

    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : "Internal error",
        llm_calls_made: 0,
        web_searches_made: 0,
        linkedin_searches_made: 0,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
