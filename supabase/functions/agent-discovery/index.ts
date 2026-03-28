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

const PREDEFINED_LINKEDIN_QUERIES = [
  { keywords: "KU Leuven", type: "school" },
  { keywords: "UGent OR Ghent University", type: "school" },
  { keywords: "VUB OR Vrije Universiteit Brussel", type: "school" },
  { keywords: "imec", type: "company" },
  { keywords: "Barco", type: "company" },
  { keywords: "Umicore", type: "company" },
  { keywords: "BAEF fellow", type: "keyword" },
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

// ── Helpers ──────────────────────────────────────────────────────────

function safeStr(val: unknown): string {
  if (val === null || val === undefined) return "";
  return String(val);
}

function normalizeLinkedInUrl(url: string): string {
  return safeStr(url).replace(/\/+$/, "").toLowerCase();
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
): Promise<ExtractedContact[]> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

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

      if (!resp.ok) continue;

      const data = await resp.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) continue;

      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed.contacts)) continue;

      return parsed.contacts
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
        }));
    } catch {
      // retry
    }
  }

  return [];
}

// isDuplicate removed — replaced with batched dedup in main handler

// Cross-dedup between channels: remove contacts that share a LinkedIn URL
function crossDedup(contacts: ExtractedContact[]): ExtractedContact[] {
  const seen = new Map<string, ExtractedContact>();
  const result: ExtractedContact[] = [];

  for (const c of contacts) {
    const linkedinKey = c.linkedin_url
      ? normalizeLinkedInUrl(c.linkedin_url)
      : "";
    const nameKey = c.name.trim().toLowerCase();

    if (linkedinKey && seen.has(linkedinKey)) {
      // Merge: prefer the one with more data
      const existing = seen.get(linkedinKey)!;
      if (
        (c.bio && !existing.bio) ||
        (c.flemish_connection && !existing.flemish_connection)
      ) {
        // Merge fields from web search into LinkedIn result
        existing.bio = existing.bio || c.bio;
        existing.flemish_connection =
          existing.flemish_connection || c.flemish_connection;
        existing.email = existing.email || c.email;
        existing.sectors =
          existing.sectors.length > 0 ? existing.sectors : c.sectors;
        existing.source_urls = [
          ...new Set([...existing.source_urls, ...c.source_urls]),
        ];
      }
      continue;
    }

    // Also dedup by name (case-insensitive)
    if (!linkedinKey) {
      const existingByName = result.find(
        (r) => r.name.trim().toLowerCase() === nameKey
      );
      if (existingByName) continue;
    }

    if (linkedinKey) seen.set(linkedinKey, c);
    result.push(c);
  }

  return result;
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

    if (!query) {
      return new Response(
        JSON.stringify({ error: "query is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

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

    // Only append suffix terms that aren't already in the query
    const queryLower = query.toLowerCase();
    const suffixTerms = ["flemish", "belgian", "professional"].filter(
      (t) => !queryLower.includes(t)
    );
    const webQuery = suffixTerms.length > 0
      ? `${query} ${suffixTerms.join(" ")}`
      : query;

    try {
      const searchResp = await searchWeb(webQuery, supabase);
      webSearchesMade++;
      if (!searchResp.cached) webSearchProvider = searchResp.provider;

      steps.push({
        step: "web_search",
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
        // Use shorter content per result (1000 chars) to speed up LLM processing
        const formatted = searchResp.results
          .map((r) => {
            const body = r.raw_content && r.raw_content.length > r.content.length
              ? r.raw_content.slice(0, 1000)
              : r.content;
            return `Source: ${r.url}\nTitle: ${r.title}\nContent: ${body}`;
          })
          .join("\n\n---\n\n");
        const extracted = await extractContactsFromWeb(
          formatted,
          query,
          geminiKey
        );
        llmCallsMade++;

        const usFiltered = extracted.filter(isLikelyUS);
        const nonUsFiltered = extracted.filter((c) => !isLikelyUS(c));

        steps.push({
          step: "llm_extraction",
          timestamp: new Date().toISOString(),
          elapsed: elapsed(),
          status: "ok",
          detail: {
            model: GEMINI_MODEL,
            extracted_count: extracted.length,
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
              sectors: c.sectors,
            })),
          },
        });

        allContacts.push(...usFiltered);
      }

      if (searchResp.quota_exhausted) {
        errors.push("Web search quota exhausted");
      }
    } catch (err) {
      const msg = (err as Error).message;
      errors.push(`Web search failed: ${msg}`);
      steps.push({
        step: "web_search",
        timestamp: new Date().toISOString(),
        elapsed: elapsed(),
        status: "error",
        detail: { query: webQuery, error: msg },
      });
    }

    await heartbeat();

    // ── Channel 2: LinkedIn search via Apify ───────────────────────
    // Skip LinkedIn on tight deadline — web search + LLM already took most of our budget
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
        try {
          const linkedinInput: Record<string, unknown> = {
            keywords: query,
            location: "United States",
            limit: 10, // reduced from 20 — faster actor completion
          };

          // Give Apify at most 15s so we have time for dedup+insert
          const apifyTimeout = Math.min(15, Math.floor(timeLeft() / 1000) - 8);
          if (apifyTimeout < 5) throw new Error("Not enough time for LinkedIn search");

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
            step: "linkedin_search",
            timestamp: new Date().toISOString(),
            elapsed: elapsed(),
            status: "ok",
            detail: {
              actor: APIFY_ACTORS.LINKEDIN_PROFILE_SEARCH,
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
        } catch (err) {
          const msg = (err as Error).message;
          const code = err instanceof ApifyError ? err.code : "unknown";
          if (err instanceof ApifyError && err.code === "apify_quota_exhausted") {
            errors.push("Apify credits exhausted — LinkedIn channel skipped");
          } else {
            errors.push(`LinkedIn search failed: ${msg}`);
          }
          steps.push({
            step: "linkedin_search",
            timestamp: new Date().toISOString(),
            elapsed: elapsed(),
            status: "error",
            detail: { error: msg, code },
          });
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

    const deduped = crossDedup(allContacts);

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

    // Batch: collect all emails, linkedin URLs, and names for a single query each
    const allEmails = deduped.map((c) => c.email?.trim()).filter((e) => e && e.includes("@")) as string[];
    const allLinkedins = deduped.map((c) => normalizeLinkedInUrl(c.linkedin_url)).filter(Boolean);
    const allNames = deduped.map((c) => c.name.trim().toLowerCase()).filter(Boolean);

    // Fetch known emails/linkedin/names from people table in one go
    const knownPeople = new Set<string>();
    if (allEmails.length > 0 || allLinkedins.length > 0) {
      const orParts: string[] = [];
      for (const e of allEmails) orParts.push(`email.ilike.${e}`);
      for (const l of allLinkedins) orParts.push(`linkedin_url.ilike.${l}`);
      const { data } = await supabase.from("people").select("email, linkedin_url, name").or(orParts.join(","));
      for (const p of data || []) {
        if (p.email) knownPeople.add(p.email.toLowerCase());
        if (p.linkedin_url) knownPeople.add(normalizeLinkedInUrl(p.linkedin_url));
        if (p.name) knownPeople.add(p.name.toLowerCase());
      }
    }
    // Also check by name (catches people without email/linkedin match)
    if (allNames.length > 0) {
      const { data } = await supabase.from("people").select("name").in("name", allNames);
      for (const p of data || []) {
        if (p.name) knownPeople.add(p.name.toLowerCase());
      }
    }

    // Same for discovered_contacts
    const knownDiscovered = new Set<string>();
    if (allEmails.length > 0 || allLinkedins.length > 0) {
      const orParts: string[] = [];
      for (const e of allEmails) orParts.push(`email.ilike.${e}`);
      for (const l of allLinkedins) orParts.push(`linkedin_url.ilike.${l}`);
      const { data } = await supabase.from("discovered_contacts").select("email, linkedin_url, name").or(orParts.join(","));
      for (const d of data || []) {
        if (d.email) knownDiscovered.add(d.email.toLowerCase());
        if (d.linkedin_url) knownDiscovered.add(normalizeLinkedInUrl(d.linkedin_url));
        if (d.name) knownDiscovered.add(d.name.toLowerCase());
      }
    }
    if (allNames.length > 0) {
      const { data } = await supabase.from("discovered_contacts").select("name").in("name", allNames);
      for (const d of data || []) {
        if (d.name) knownDiscovered.add(d.name.toLowerCase());
      }
    }

    // Now check each contact against the batch results
    for (const contact of deduped) {
      const email = contact.email?.trim()?.toLowerCase() || "";
      const linkedin = normalizeLinkedInUrl(contact.linkedin_url);
      const name = contact.name.trim().toLowerCase();

      const isDupe =
        (email && (knownPeople.has(email) || knownDiscovered.has(email))) ||
        (linkedin && (knownPeople.has(linkedin) || knownDiscovered.has(linkedin))) ||
        (name && (knownPeople.has(name) || knownDiscovered.has(name)));

      if (isDupe) {
        duplicatesSkipped++;
        dupeNames.push(contact.name);
      } else {
        newContacts.push(contact);
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
