import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  runApifyActor,
  ApifyError,
  APIFY_ACTORS,
  getApifyUsage,
} from "../_shared/apifyClient.ts";
import { searchWeb, formatResultsForLLM } from "../_shared/webSearch.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, apikey, x-client-info",
};

const GEMINI_MODEL =
  Deno.env.get("GEMINI_FLASH_MODEL") || "gemini-3-flash-preview";
const GEMINI_FALLBACK_MODEL = "gemini-2.5-flash-lite";
const DEFAULT_BATCH_SIZE = 5;
const DEFAULT_MAX_AGE_MONTHS = 6;
const DEADLINE_MS = 55_000;
const CHECK_PROFILE_SYSTEM_PROMPT = `You are a profile accuracy checker for a Flemish-American professional network directory.

Given a person's current profile data and web search results about them, identify any factual updates that should be made to their profile.

Rules:
- Only suggest changes clearly supported by the search results
- Compare search results against each current profile field
- Field names must be exactly one of: title, first_name, last_name, name, current_position, occupation, email, linkedin_url, bio, phone, website_url, twitter_url, location_city, location_state
- Do not suggest a change if the current value already matches what's in the search results
- Be conservative: only suggest changes you are confident about
- For bio, only suggest if current bio is empty or very short and search results provide substantial information
- The source field should briefly describe where the information was found (e.g. "LinkedIn profile", "University website", "News article")
- If no changes are found, return an empty suggestions array`;
const CHECK_PROFILE_SCHEMA = {
  type: "OBJECT",
  properties: {
    suggestions: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          field_name: { type: "STRING" },
          current_value: { type: "STRING" },
          suggested_value: { type: "STRING" },
          source: { type: "STRING" },
        },
        required: [
          "field_name",
          "current_value",
          "suggested_value",
          "source",
        ],
      },
    },
  },
  required: ["suggestions"],
};

interface PersonRow {
  id: string;
  name: string;
  current_position: string | null;
  bio: string | null;
  profile_photo_url: string | null;
  linkedin_url: string | null;
  email: string | null;
  phone: string | null;
  website_url: string | null;
  twitter_url: string | null;
  occupation: string | null;
  last_verified_at: string | null;
  locations?: {
    city?: string | null;
    state?: string | null;
  } | null;
}

interface Suggestion {
  field_name: string;
  current_value: string;
  suggested_value: string;
  source: string;
}

interface LinkedInProfile {
  current_position: string;
  bio: string;
  profile_photo_url: string;
  linkedin_url: string;
  location_text: string;
  location_city: string;
  location_state: string;
  is_us_location: boolean | null;
}

interface StepLog {
  person_id: string;
  person_name: string;
  path: "linkedin" | "web_search" | "skipped";
  status: "verified" | "suggestions" | "no_results" | "error" | "quota_exhausted";
  detail?: string;
}

function safeStr(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalizeText(value: string): string {
  return safeStr(value)
    .toLowerCase()
    .replace(/https?:\/\//g, "")
    .replace(/www\./g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeUrl(value: string): string {
  return safeStr(value)
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/+$/, "")
    .trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function canonicalizeLinkedInUrl(value: string): string {
  const normalized = safeStr(value);
  if (!normalized) return "";
  try {
    const url = new URL(
      normalized.startsWith("http://") || normalized.startsWith("https://")
        ? normalized
        : `https://${normalized}`
    );
    if (url.hostname === "linkedin.com") {
      url.hostname = "www.linkedin.com";
    }
    url.protocol = "https:";
    return url.toString();
  } catch {
    return normalized;
  }
}

function valuesMatch(currentValue: string, suggestedValue: string): boolean {
  const current = normalizeText(currentValue);
  const suggested = normalizeText(suggestedValue);
  if (!current || !suggested) return false;
  if (current === suggested) return true;
  return (
    (current.length >= 8 && suggested.includes(current)) ||
    (suggested.length >= 8 && current.includes(suggested))
  );
}

function urlsMatch(currentValue: string, suggestedValue: string): boolean {
  const current = normalizeUrl(currentValue);
  const suggested = normalizeUrl(suggestedValue);
  return Boolean(current && suggested && current === suggested);
}

function isAdvisoryField(fieldName: string): boolean {
  return fieldName.startsWith("_");
}

const US_STATE_BY_NAME: Record<string, string> = {
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  connecticut: "CT",
  delaware: "DE",
  florida: "FL",
  georgia: "GA",
  hawaii: "HI",
  idaho: "ID",
  illinois: "IL",
  indiana: "IN",
  iowa: "IA",
  kansas: "KS",
  kentucky: "KY",
  louisiana: "LA",
  maine: "ME",
  maryland: "MD",
  massachusetts: "MA",
  michigan: "MI",
  minnesota: "MN",
  mississippi: "MS",
  missouri: "MO",
  montana: "MT",
  nebraska: "NE",
  nevada: "NV",
  "new hampshire": "NH",
  "new jersey": "NJ",
  "new mexico": "NM",
  "new york": "NY",
  "north carolina": "NC",
  "north dakota": "ND",
  ohio: "OH",
  oklahoma: "OK",
  oregon: "OR",
  pennsylvania: "PA",
  "rhode island": "RI",
  "south carolina": "SC",
  "south dakota": "SD",
  tennessee: "TN",
  texas: "TX",
  utah: "UT",
  vermont: "VT",
  virginia: "VA",
  washington: "WA",
  "west virginia": "WV",
  wisconsin: "WI",
  wyoming: "WY",
  "district of columbia": "DC",
};

const US_STATE_CODES = new Set(Object.values(US_STATE_BY_NAME));
const NON_US_LOCATION_KEYWORDS = [
  "belgium",
  "brussels",
  "flanders",
  "europe",
  "canada",
  "toronto",
  "montreal",
  "vancouver",
  "united kingdom",
  "england",
  "london",
  "france",
  "paris",
  "germany",
  "berlin",
  "netherlands",
  "amsterdam",
];

function stateToCode(state: string): string {
  const trimmed = safeStr(state);
  if (!trimmed) return "";
  const upper = trimmed.toUpperCase();
  if (US_STATE_CODES.has(upper)) return upper;
  return US_STATE_BY_NAME[trimmed.toLowerCase()] || "";
}

function isUsCountry(country: string): boolean {
  const normalized = normalizeText(country);
  return (
    normalized === "united states" ||
    normalized === "united states of america" ||
    normalized === "usa" ||
    normalized === "us"
  );
}

function parseLocation(locationText: string, cityValue: string, stateValue: string, countryValue: string) {
  const parts = safeStr(locationText)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  let city = safeStr(cityValue);
  let state = safeStr(stateValue);
  let country = safeStr(countryValue);

  if (!city && parts.length >= 1) city = parts[0];
  if (!state && parts.length >= 2) state = parts[1];
  if (!country && parts.length >= 3) country = parts[2];
  if (!country && parts.length === 2 && isUsCountry(parts[1])) {
    country = parts[1];
    state = "";
  }

  const stateCode = stateToCode(state);
  const lowerLocation = normalizeText(locationText);

  let isUsLocation: boolean | null = null;
  if (isUsCountry(country)) {
    isUsLocation = true;
  } else if (country) {
    isUsLocation = false;
  } else if (stateCode) {
    isUsLocation = true;
  } else if (NON_US_LOCATION_KEYWORDS.some((keyword) => lowerLocation.includes(keyword))) {
    isUsLocation = false;
  }

  return {
    city,
    state: stateCode || state,
    country,
    isUsLocation,
  };
}

function getValueAtPath(record: unknown, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = record;

  for (const part of parts) {
    if (current === null || current === undefined) return undefined;

    if (Array.isArray(current)) {
      const index = Number(part);
      current = Number.isInteger(index) ? current[index] : undefined;
      continue;
    }

    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

function pickString(record: unknown, paths: string[]): string {
  for (const path of paths) {
    const value = getValueAtPath(record, path);
    const str = safeStr(value);
    if (str) return str;
  }
  return "";
}

function buildLinkedInCurrentPosition(headline: string, title: string, company: string): string {
  if (headline) return headline;
  if (title && company) {
    const normalizedTitle = normalizeText(title);
    const normalizedCompany = normalizeText(company);
    if (normalizedTitle.includes(normalizedCompany)) return title;
    return `${title} at ${company}`;
  }
  return title || company;
}

function normalizeLinkedInProfile(item: Record<string, unknown>): LinkedInProfile {
  const headline = pickString(item, [
    "headline",
    "position",
    "title",
    "currentPosition",
    "experiences.0.title",
    "positions.0.title",
  ]);
  const title = pickString(item, [
    "jobTitle",
    "experienceTitle",
    "experiences.0.title",
    "positions.0.title",
  ]);
  const company = pickString(item, [
    "companyName",
    "company",
    "currentCompany",
    "experiences.0.companyName",
    "positions.0.companyName",
  ]);
  const locationText = pickString(item, [
    "location",
    "locationName",
    "geo.full",
    "geo.fullLocation",
    "geoLocationName",
    "address",
  ]);
  const city = pickString(item, ["city", "geo.city", "location.city"]);
  const state = pickString(item, ["state", "geo.state", "location.state", "addressRegion"]);
  const country = pickString(item, ["country", "geo.country", "location.country", "addressCountry"]);
  const parsedLocation = parseLocation(locationText, city, state, country);

  return {
    current_position: buildLinkedInCurrentPosition(headline, title, company),
    bio: pickString(item, ["about", "summary", "description", "bio"]),
    profile_photo_url: pickString(item, [
      "profilePicUrl",
      "profilePic",
      "profilePictureUrl",
      "profilePicture",
      "profilePictureHighQuality",
      "profilePhotoUrl",
      "profilePhoto",
      "photoUrl",
      "photo",
      "avatar",
      "image",
    ]),
    linkedin_url: pickString(item, [
      "linkedInProfileUrl",
      "linkedInUrl",
      "linkedinUrl",
      "profileUrl",
      "url",
    ]),
    location_text: locationText,
    location_city: parsedLocation.city,
    location_state: parsedLocation.state,
    is_us_location: parsedLocation.isUsLocation,
  };
}

function shouldSuggestBio(currentBio: string, scrapedBio: string): boolean {
  const current = safeStr(currentBio);
  const scraped = safeStr(scrapedBio);
  if (!scraped || scraped.length < 60) return false;
  if (!current) return true;
  if (valuesMatch(current, scraped)) return false;
  return current.length < 40 && scraped.length >= current.length + 60;
}

function mergeProvider(currentProvider: string, nextProvider: string): string {
  if (!nextProvider || nextProvider === "none") return currentProvider;
  if (!currentProvider) return nextProvider;
  if (currentProvider === nextProvider) return currentProvider;
  return "mixed";
}

function mergeModel(currentModel: string, nextModel: string): string {
  if (!nextModel) return currentModel;
  if (!currentModel) return nextModel;
  if (currentModel === nextModel) return currentModel;
  return "mixed";
}

function isSkippableLinkedInInputError(error: unknown): boolean {
  if (!(error instanceof ApifyError)) return false;
  const message = error.message.toLowerCase();
  return (
    error.code === "actor_failed" &&
    message.includes("invalid-input") &&
    message.includes("input.urls")
  );
}

async function heartbeat(
  supabase: ReturnType<typeof createClient>,
  runId?: string
): Promise<void> {
  if (!runId) return;
  await supabase
    .from("agent_runs")
    .update({ heartbeat_at: new Date().toISOString() })
    .eq("id", runId);
}

async function fetchCandidates(
  supabase: ReturnType<typeof createClient>,
  batchSize: number,
  maxAgeMonths: number,
  personIds?: string[]
): Promise<PersonRow[]> {
  const selectClause = `
      id,
      name,
      current_position,
      bio,
      profile_photo_url,
      linkedin_url,
      email,
      phone,
      website_url,
      twitter_url,
      occupation,
      last_verified_at,
      locations(city, state)
    `;

  if (personIds && personIds.length > 0) {
    const { data, error } = await supabase
      .from("people")
      .select(selectClause)
      .in("id", personIds)
      .limit(batchSize);

    if (error) {
      throw new Error(`Failed to load targeted people: ${error.message}`);
    }

    return ((data || []) as PersonRow[]).slice(0, batchSize);
  }

  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - maxAgeMonths);

  const { data, error } = await supabase
    .from("people")
    .select(selectClause)
    .order("last_verified_at", { ascending: true, nullsFirst: true })
    .limit(batchSize);

  if (error) {
    throw new Error(`Failed to load people: ${error.message}`);
  }

  const people = ((data || []) as PersonRow[]).filter((person) => {
    if (!person.last_verified_at) return true;
    return new Date(person.last_verified_at).getTime() < cutoff.getTime();
  });

  return people.slice(0, batchSize);
}

async function insertSuggestions(
  supabase: ReturnType<typeof createClient>,
  personId: string,
  suggestions: Suggestion[]
): Promise<{ inserted: number; duplicatesSkipped: number }> {
  if (suggestions.length === 0) {
    return { inserted: 0, duplicatesSkipped: 0 };
  }

  const { data: existing, error: existingError } = await supabase
    .from("profile_suggestions")
    .select("field_name, suggested_value")
    .eq("person_id", personId)
    .eq("status", "pending");

  if (existingError) {
    throw new Error(`Failed to load existing suggestions: ${existingError.message}`);
  }

  const signatures = new Set(
    ((existing || []) as Array<{ field_name: string; suggested_value: string }>).map((row) =>
      `${row.field_name}::${normalizeText(row.suggested_value)}`
    )
  );

  const toInsert: Suggestion[] = [];
  let duplicatesSkipped = 0;

  for (const suggestion of suggestions) {
    const signature = `${suggestion.field_name}::${normalizeText(suggestion.suggested_value)}`;
    if (signatures.has(signature)) {
      duplicatesSkipped += 1;
      continue;
    }
    signatures.add(signature);
    toInsert.push(suggestion);
  }

  if (toInsert.length === 0) {
    return { inserted: 0, duplicatesSkipped };
  }

  const rows = toInsert.map((suggestion) => ({
    person_id: personId,
    field_name: suggestion.field_name,
    current_value: suggestion.current_value,
    suggested_value: suggestion.suggested_value,
    source: suggestion.source,
    status: "pending",
  }));

  const { data: insertedRows, error: insertError } = await supabase
    .from("profile_suggestions")
    .insert(rows)
    .select("id");

  if (insertError) {
    throw new Error(`Failed to insert suggestions: ${insertError.message}`);
  }

  return { inserted: insertedRows?.length || 0, duplicatesSkipped };
}

async function markVerified(
  supabase: ReturnType<typeof createClient>,
  personId: string
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("people")
    .update({
      last_verified_at: now,
      updated_at: now,
    })
    .eq("id", personId);

  if (error) {
    throw new Error(`Failed to mark verified: ${error.message}`);
  }
}

async function callCheckProfile(
  person: PersonRow,
  geminiApiKey: string,
  searchResults: string
): Promise<{ suggestions: Suggestion[]; modelUsed: string }> {
  if (!geminiApiKey) {
    throw new Error("Missing GEMINI_API_KEY");
  }

  const validFields = new Set([
    "title",
    "first_name",
    "last_name",
    "name",
    "current_position",
    "occupation",
    "email",
    "linkedin_url",
    "bio",
    "phone",
    "website_url",
    "twitter_url",
    "location_city",
    "location_state",
  ]);

  const requestBody = {
    system_instruction: {
      parts: [{ text: CHECK_PROFILE_SYSTEM_PROMPT }],
    },
    contents: [{
      role: "user",
      parts: [{
        text: `Current profile:\n${JSON.stringify({
          id: person.id,
          name: person.name,
          current_position: safeStr(person.current_position),
          occupation: safeStr(person.occupation),
          email: safeStr(person.email),
          linkedin_url: safeStr(person.linkedin_url),
          bio: safeStr(person.bio),
          phone: safeStr(person.phone),
          website_url: safeStr(person.website_url),
          twitter_url: safeStr(person.twitter_url),
          location_city: safeStr(person.locations?.city),
          location_state: safeStr(person.locations?.state),
        }, null, 2)}\n\nWeb search results:\n${searchResults}`,
      }],
    }],
    generation_config: {
      response_mime_type: "application/json",
      response_schema: CHECK_PROFILE_SCHEMA,
      temperature: 0.3,
    },
  };

  const models = Array.from(new Set([GEMINI_MODEL, GEMINI_FALLBACK_MODEL]));
  let lastError = "";

  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": geminiApiKey,
          },
          body: JSON.stringify(requestBody),
        }
      );

      if (response.status === 429) {
        lastError = `Gemini check_profile failed: 429`;
        await sleep(model === GEMINI_MODEL ? 1200 : 2000);
        continue;
      }

      if (!response.ok) {
        lastError = `Gemini check_profile failed: ${response.status}`;
        break;
      }

      const payload = await response.json();
      const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        return { suggestions: [], modelUsed: model };
      }

      const parsed = JSON.parse(text);
      const suggestions = Array.isArray(parsed?.suggestions) ? parsed.suggestions : [];

      return {
        modelUsed: model,
        suggestions: suggestions
          .filter((suggestion: Record<string, unknown>) => {
            const fieldName = safeStr(suggestion.field_name);
            const suggestedValue = safeStr(suggestion.suggested_value);
            return Boolean(fieldName && suggestedValue && validFields.has(fieldName));
          })
          .map((suggestion: Record<string, unknown>) => ({
            field_name: safeStr(suggestion.field_name),
            current_value: safeStr(suggestion.current_value),
            suggested_value: safeStr(suggestion.suggested_value),
            source: safeStr(suggestion.source) || "web_search",
          })),
      };
    }
  }

  throw new Error(lastError || "Gemini check_profile failed");
}

function diffLinkedInProfile(person: PersonRow, profile: LinkedInProfile): Suggestion[] {
  const suggestions: Suggestion[] = [];
  const currentCity = safeStr(person.locations?.city);
  const currentState = safeStr(person.locations?.state);
  const currentLocation = [currentCity, currentState].filter(Boolean).join(", ");

  if (
    profile.current_position &&
    !valuesMatch(safeStr(person.current_position), profile.current_position)
  ) {
    const significantChange = Boolean(person.current_position);
    suggestions.push({
      field_name: "current_position",
      current_value: safeStr(person.current_position),
      suggested_value: profile.current_position,
      source: significantChange
        ? "linkedin_scrape (possible career change)"
        : "linkedin_scrape",
    });
  }

  if (profile.is_us_location === false) {
    suggestions.push({
      field_name: "_status",
      current_value: currentLocation,
      suggested_value: "may_have_left_us",
      source: `linkedin_scrape: location appears outside US (${profile.location_text || "unknown"})`,
    });
  } else {
    if (
      profile.location_city &&
      !valuesMatch(currentCity, profile.location_city)
    ) {
      suggestions.push({
        field_name: "location_city",
        current_value: currentCity,
        suggested_value: profile.location_city,
        source: "linkedin_scrape",
      });
    }

    if (
      profile.location_state &&
      !valuesMatch(currentState, profile.location_state)
    ) {
      suggestions.push({
        field_name: "location_state",
        current_value: currentState,
        suggested_value: profile.location_state,
        source: "linkedin_scrape",
      });
    }
  }

  if (shouldSuggestBio(safeStr(person.bio), profile.bio)) {
    suggestions.push({
      field_name: "bio",
      current_value: safeStr(person.bio),
      suggested_value: profile.bio,
      source: "linkedin_scrape",
    });
  }

  if (
    profile.profile_photo_url &&
    !safeStr(person.profile_photo_url) &&
    !urlsMatch(safeStr(person.profile_photo_url), profile.profile_photo_url)
  ) {
    suggestions.push({
      field_name: "profile_photo_url",
      current_value: safeStr(person.profile_photo_url),
      suggested_value: profile.profile_photo_url,
      source: "linkedin_scrape",
    });
  }

  if (
    profile.linkedin_url &&
    safeStr(person.linkedin_url) &&
    !urlsMatch(safeStr(person.linkedin_url), profile.linkedin_url)
  ) {
    suggestions.push({
      field_name: "linkedin_url",
      current_value: safeStr(person.linkedin_url),
      suggested_value: profile.linkedin_url,
      source: "linkedin_scrape",
    });
  }

  return suggestions;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const geminiApiKey = Deno.env.get("GEMINI_API_KEY");

  if (!supabaseUrl || !serviceKey) {
    return new Response(
      JSON.stringify({ error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  let runId: string | undefined;
  let llmCallsMade = 0;
  let webSearchesMade = 0;
  let linkedinScrapesMade = 0;
  let webSearchProvider = "";
  let llmModelUsed = "";

  try {
    const body = await req.json().catch(() => ({}));
    const batchSizeRaw = Number(body.batch_size ?? DEFAULT_BATCH_SIZE);
    const maxAgeMonthsRaw = Number(body.max_age_months ?? DEFAULT_MAX_AGE_MONTHS);

    if (!Number.isFinite(batchSizeRaw) || batchSizeRaw < 1) {
      return new Response(
        JSON.stringify({ error: "batch_size must be a positive number" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!Number.isFinite(maxAgeMonthsRaw) || maxAgeMonthsRaw < 0) {
      return new Response(
        JSON.stringify({ error: "max_age_months must be 0 or greater" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const batchSize = Math.min(Math.floor(batchSizeRaw), DEFAULT_BATCH_SIZE);
    const maxAgeMonths = Math.floor(maxAgeMonthsRaw);
    runId = safeStr(body.run_id) || undefined;
    const personIds = Array.isArray(body.person_ids)
      ? body.person_ids.map((value: unknown) => safeStr(value)).filter(Boolean)
      : safeStr(body.person_id)
        ? [safeStr(body.person_id)]
        : undefined;

    const startTime = Date.now();
    const timeLeft = () => DEADLINE_MS - (Date.now() - startTime);

    const candidates = await fetchCandidates(supabase, batchSize, maxAgeMonths, personIds);
    const apifyStatus = await getApifyUsage();
    let apifyAvailable = apifyStatus.available;
    let quotaExhausted = false;
    let profilesChecked = 0;
    let profilesVerified = 0;
    let suggestionsCreated = 0;
    let duplicatesSkipped = 0;
    let skippedNoResults = 0;
    let linkedinChecked = 0;
    let webChecked = 0;
    const errors: string[] = [];
    const steps: StepLog[] = [];

    for (const person of candidates) {
      if (timeLeft() < 5_000) {
        errors.push("Stopped early to avoid edge function timeout");
        break;
      }

      await heartbeat(supabase, runId);
      profilesChecked += 1;

      const personName = safeStr(person.name) || person.id;
      let personHadSuggestions = false;
      let handled = false;

      if (safeStr(person.linkedin_url) && apifyAvailable) {
        try {
          const linkedinUrl = canonicalizeLinkedInUrl(safeStr(person.linkedin_url));
          const timeoutSecs = Math.max(8, Math.min(20, Math.floor(timeLeft() / 1000) - 5));
          const scrape = await runApifyActor<Record<string, unknown>>(
            APIFY_ACTORS.LINKEDIN_PROFILE_SCRAPER,
            {
              urls: [linkedinUrl],
              profileUrls: [linkedinUrl],
            },
            { sync: true, timeoutSecs }
          );

          linkedinScrapesMade += 1;
          linkedinChecked += 1;

          const scrapedItem = scrape.items[0];
          if (scrapedItem) {
            const normalizedProfile = normalizeLinkedInProfile(scrapedItem);
            const suggestions = diffLinkedInProfile(person, normalizedProfile);
            personHadSuggestions = suggestions.length > 0;

            const insertResult = await insertSuggestions(supabase, person.id, suggestions);
            suggestionsCreated += insertResult.inserted;
            duplicatesSkipped += insertResult.duplicatesSkipped;

            if (!personHadSuggestions) {
              await markVerified(supabase, person.id);
              profilesVerified += 1;
              steps.push({
                person_id: person.id,
                person_name: personName,
                path: "linkedin",
                status: "verified",
              });
            } else {
              steps.push({
                person_id: person.id,
                person_name: personName,
                path: "linkedin",
                status: "suggestions",
                detail: `${suggestions.length} differences detected`,
              });
            }

            handled = true;
          }
        } catch (error) {
          if (error instanceof ApifyError && error.code === "apify_quota_exhausted") {
            apifyAvailable = false;
          }
          if (!isSkippableLinkedInInputError(error)) {
            errors.push(
              `${personName}: LinkedIn scrape failed (${error instanceof Error ? error.message : "unknown error"})`
            );
          }
        }
      }

      if (handled) {
        continue;
      }

      const locationCity = safeStr(person.locations?.city);
      const query = [person.name, person.current_position, locationCity]
        .map(safeStr)
        .filter(Boolean)
        .join(" ");

      if (!query) {
        skippedNoResults += 1;
        steps.push({
          person_id: person.id,
          person_name: personName,
          path: "skipped",
          status: "no_results",
          detail: "No usable search query",
        });
        continue;
      }

      const searchResponse = await searchWeb(query, supabase);
      webSearchProvider = mergeProvider(webSearchProvider, searchResponse.provider);

      if (searchResponse.provider !== "none") {
        webSearchesMade += 1;
      }

      if (searchResponse.quota_exhausted && searchResponse.results.length === 0) {
        quotaExhausted = true;
        steps.push({
          person_id: person.id,
          person_name: personName,
          path: "web_search",
          status: "quota_exhausted",
          detail: "Web search quota exhausted",
        });
        break;
      }

      if (searchResponse.results.length === 0) {
        skippedNoResults += 1;
        steps.push({
          person_id: person.id,
          person_name: personName,
          path: "web_search",
          status: "no_results",
        });
        continue;
      }

      webChecked += 1;
      llmCallsMade += 1;

      try {
        const llmResult = await callCheckProfile(
          person,
          geminiApiKey || "",
          formatResultsForLLM(searchResponse.results)
        );
        llmModelUsed = mergeModel(llmModelUsed, llmResult.modelUsed);
        const llmSuggestions = llmResult.suggestions;

        personHadSuggestions = llmSuggestions.length > 0;
        const insertResult = await insertSuggestions(supabase, person.id, llmSuggestions);
        suggestionsCreated += insertResult.inserted;
        duplicatesSkipped += insertResult.duplicatesSkipped;

        if (!personHadSuggestions) {
          await markVerified(supabase, person.id);
          profilesVerified += 1;
          steps.push({
            person_id: person.id,
            person_name: personName,
            path: "web_search",
            status: "verified",
          });
        } else {
          steps.push({
            person_id: person.id,
            person_name: personName,
            path: "web_search",
            status: "suggestions",
            detail: `${llmSuggestions.length} differences detected`,
          });
        }
      } catch (error) {
        errors.push(
          `${personName}: web verification failed (${error instanceof Error ? error.message : "unknown error"})`
        );
        steps.push({
          person_id: person.id,
          person_name: personName,
          path: "web_search",
          status: "error",
          detail: error instanceof Error ? error.message : "unknown error",
        });
      }
    }

    const result = {
      profiles_checked: profilesChecked,
      suggestions_created: suggestionsCreated,
      profiles_verified: profilesVerified,
      skipped_no_results: skippedNoResults,
      duplicates_skipped: duplicatesSkipped,
      quota_exhausted: quotaExhausted,
      by_source: {
        linkedin: linkedinChecked,
        web_search: webChecked,
      },
      llm_calls_made: llmCallsMade,
      linkedin_scrapes_made: linkedinScrapesMade,
      web_searches_made: webSearchesMade,
      web_search_provider: webSearchProvider || "none",
      llm_model_used: llmCallsMade > 0 ? llmModelUsed || GEMINI_MODEL : null,
      errors: errors.length > 0 ? errors : undefined,
      steps,
    };

    if (runId) {
      const costEstimate = llmCallsMade * 0.001 + linkedinScrapesMade * 0.003;
      await supabase
        .from("agent_runs")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          results: result,
          llm_calls_made: llmCallsMade,
          llm_model_used: llmCallsMade > 0 ? llmModelUsed || GEMINI_MODEL : null,
          web_searches_made: webSearchesMade,
          web_search_provider: webSearchProvider || "none",
          cost_estimate_usd: Math.round(costEstimate * 10000) / 10000,
        })
        .eq("id", runId);
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    if (runId) {
      await supabase
        .from("agent_runs")
        .update({
          status: "failed",
          completed_at: new Date().toISOString(),
          error_message: error instanceof Error ? error.message : "Unknown error",
          llm_calls_made: llmCallsMade,
          llm_model_used: llmCallsMade > 0 ? llmModelUsed || GEMINI_MODEL : null,
          web_searches_made: webSearchesMade,
          web_search_provider: webSearchProvider || "none",
        })
        .eq("id", runId)
        .catch(() => {});
    }

    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Internal error",
        llm_calls_made: llmCallsMade,
        linkedin_scrapes_made: linkedinScrapesMade,
        web_searches_made: webSearchesMade,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
