import {
  APIFY_ACTORS,
  ApifyError,
  getApifyUsage,
  runApifyActor,
} from "./apifyClient.ts";
import {
  getAiAgentTaskDefinition,
  type OrganizationCheckResult,
  type ProfileCheckResult,
} from "./aiContracts.ts";
import { callGeminiStructured } from "./gemini.ts";
import type { SupabaseAdminClient } from "./database.types.ts";
import {
  formatResultsForLLM,
  searchWeb,
  type WebSearchResult,
} from "./webSearch.ts";

export type VerificationMethod = "linkedin_scrape" | "web_search_llm";
export type VerificationPath = "linkedin" | "web_search" | "skipped";
export type VerificationRisk = "low" | "medium" | "high";
export type VerificationStatus =
  | "verified"
  | "suggestions"
  | "no_results"
  | "error"
  | "quota_exhausted";

export type VerificationMode = "preview" | "durable";
export type VerificationRecordType = "person" | "organization";

export interface VerificationTarget {
  recordType: VerificationRecordType;
  recordId: string;
}

const CANDIDATE_POOL_MULTIPLIER = 15;
const MIN_CANDIDATE_POOL = 60;
const SEARCH_ACTIVITY_LOOKBACK_DAYS = 90;
const DISCOVERY_TOUCH_LOOKBACK_DAYS = 45;

export interface VerificationSuggestion {
  field_name: string;
  current_value: string;
  suggested_value: string;
  source: string;
  evidence_url: string;
  evidence_excerpt: string;
  confidence: number;
  method: VerificationMethod;
  dedupe_key: string;
  risk_level: VerificationRisk;
}

export interface VerificationPriorityContext {
  priority_score: number;
  stale_days: number;
  search_clicks_90d: number;
  recent_discovery_touches_45d: number;
  pending_suggestions: number;
  reasons: string[];
}

export interface VerificationStep {
  person_id: string;
  person_name: string;
  path: VerificationPath;
  status: VerificationStatus;
  detail?: string;
  priority_score?: number;
  priority_reasons?: string[];
}

export interface VerificationPerson {
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
  title: string | null;
  first_name: string | null;
  last_name: string | null;
  data_source: string | null;
  last_verified_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  locations: {
    city?: string | null;
    state?: string | null;
  } | null;
  priority?: VerificationPriorityContext;
}

interface VerificationPersonQueryRow extends Omit<VerificationPerson, "locations" | "priority"> {
  locations?:
    | {
        city?: string | null;
        state?: string | null;
      }
    | {
        city?: string | null;
        state?: string | null;
      }[]
    | null;
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

export interface VerificationExecutionResult {
  person: VerificationPerson;
  suggestions: VerificationSuggestion[];
  path: VerificationPath;
  status: VerificationStatus;
  detail?: string;
  warnings: string[];
  llm_calls_made: number;
  linkedin_scrapes_made: number;
  web_searches_made: number;
  web_search_provider: string;
  llm_model_used: string | null;
  quota_exhausted: boolean;
  apify_available_after: boolean;
}

export interface InsertSuggestionsResult {
  inserted: number;
  updated: number;
  duplicatesSkipped: number;
}

function safeStr(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalizePersonRow(person: VerificationPersonQueryRow): VerificationPerson {
  const location = Array.isArray(person.locations)
    ? person.locations[0] ?? null
    : person.locations ?? null;

  return {
    ...person,
    locations: location
      ? {
          city: location.city ?? null,
          state: location.state ?? null,
        }
      : null,
  };
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

function canonicalizeLinkedInUrl(value: string): string {
  const normalized = safeStr(value);
  if (!normalized) return "";
  try {
    const url = new URL(
      normalized.startsWith("http://") || normalized.startsWith("https://")
        ? normalized
        : `https://${normalized}`,
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

function parseLocation(
  locationText: string,
  cityValue: string,
  stateValue: string,
  countryValue: string,
) {
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
  } else if (
    NON_US_LOCATION_KEYWORDS.some((keyword) => lowerLocation.includes(keyword))
  ) {
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

function buildLinkedInCurrentPosition(
  headline: string,
  title: string,
  company: string,
): string {
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
  const state = pickString(item, [
    "state",
    "geo.state",
    "location.state",
    "addressRegion",
  ]);
  const country = pickString(item, [
    "country",
    "geo.country",
    "location.country",
    "addressCountry",
  ]);
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
  if (!scraped || scraped.length < 80) return false;
  if (!current) return true;
  if (valuesMatch(current, scraped)) return false;
  return current.length < 60 && scraped.length >= current.length + 80;
}

function clampConfidence(value: unknown, fallback: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(1, numeric));
}

function truncateExcerpt(value: string, maxLength = 240): string {
  const trimmed = safeStr(value);
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 3)}...`;
}

export function getFieldRisk(fieldName: string): VerificationRisk {
  if (fieldName === "bio" || fieldName === "description" || fieldName === "_status") {
    return "high";
  }

  if (
    fieldName === "current_position" ||
    fieldName === "occupation" ||
    fieldName === "email" ||
    fieldName === "phone" ||
    fieldName === "title" ||
    fieldName === "first_name" ||
    fieldName === "last_name" ||
    fieldName === "name" ||
    fieldName === "website_url"
  ) {
    return "medium";
  }

  return "low";
}

function getMethodPriority(method: VerificationMethod): number {
  if (method === "linkedin_scrape") return 2;
  return 1;
}

function getNormalizedSuggestionValue(fieldName: string, value: string): string {
  if (
    fieldName.endsWith("_url") ||
    fieldName === "linkedin_url" ||
    fieldName === "website_url" ||
    fieldName === "twitter_url" ||
    fieldName === "profile_photo_url"
  ) {
    return normalizeUrl(value);
  }

  return normalizeText(value);
}

function buildDedupeKey(fieldName: string, suggestedValue: string): string {
  return `${fieldName}::${getNormalizedSuggestionValue(fieldName, suggestedValue)}`;
}

function isSuggestionBetter(
  nextSuggestion: VerificationSuggestion,
  currentSuggestion: VerificationSuggestion,
): boolean {
  if (nextSuggestion.confidence !== currentSuggestion.confidence) {
    return nextSuggestion.confidence > currentSuggestion.confidence;
  }

  const nextMethodPriority = getMethodPriority(nextSuggestion.method);
  const currentMethodPriority = getMethodPriority(currentSuggestion.method);
  if (nextMethodPriority !== currentMethodPriority) {
    return nextMethodPriority > currentMethodPriority;
  }

  return nextSuggestion.evidence_excerpt.length > currentSuggestion.evidence_excerpt.length;
}

function finalizeSuggestions(
  suggestions: VerificationSuggestion[],
): VerificationSuggestion[] {
  const deduped = new Map<string, VerificationSuggestion>();

  for (const suggestion of suggestions) {
    const existing = deduped.get(suggestion.dedupe_key);
    if (!existing || isSuggestionBetter(suggestion, existing)) {
      deduped.set(suggestion.dedupe_key, suggestion);
    }
  }

  const bestByField = new Map<string, VerificationSuggestion>();
  for (const suggestion of deduped.values()) {
    const existing = bestByField.get(suggestion.field_name);
    if (!existing || isSuggestionBetter(suggestion, existing)) {
      bestByField.set(suggestion.field_name, suggestion);
    }
  }

  return Array.from(bestByField.values()).sort((a, b) => {
    const riskOrder: Record<VerificationRisk, number> = {
      high: 0,
      medium: 1,
      low: 2,
    };

    if (riskOrder[a.risk_level] !== riskOrder[b.risk_level]) {
      return riskOrder[a.risk_level] - riskOrder[b.risk_level];
    }

    return b.confidence - a.confidence;
  });
}

function passesRiskPolicy(suggestion: VerificationSuggestion): boolean {
  const excerptLength = suggestion.evidence_excerpt.length;

  if (!suggestion.suggested_value) return false;
  if (!suggestion.evidence_url && !suggestion.evidence_excerpt) return false;

  if (suggestion.risk_level === "low") {
    return suggestion.confidence >= 0.6;
  }

  if (suggestion.risk_level === "medium") {
    return suggestion.confidence >= 0.72 &&
      Boolean(suggestion.evidence_url || excerptLength >= 16);
  }

  return suggestion.confidence >= 0.85 &&
    Boolean(suggestion.evidence_url || excerptLength >= 20);
}

function getPersonFieldValue(person: VerificationPerson, fieldName: string): string {
  switch (fieldName) {
    case "current_position":
      return safeStr(person.current_position);
    case "occupation":
      return safeStr(person.occupation);
    case "email":
      return safeStr(person.email);
    case "linkedin_url":
      return safeStr(person.linkedin_url);
    case "bio":
      return safeStr(person.bio);
    case "phone":
      return safeStr(person.phone);
    case "website_url":
      return safeStr(person.website_url);
    case "twitter_url":
      return safeStr(person.twitter_url);
    case "profile_photo_url":
      return safeStr(person.profile_photo_url);
    case "location_city":
      return safeStr(person.locations?.city);
    case "location_state":
      return safeStr(person.locations?.state);
    case "title":
      return safeStr(person.title);
    case "first_name":
      return safeStr(person.first_name);
    case "last_name":
      return safeStr(person.last_name);
    case "name":
      return safeStr(person.name);
    default:
      return "";
  }
}

function buildSuggestion(
  input: {
    field_name: string;
    current_value?: string;
    suggested_value: string;
    source: string;
    evidence_url?: string;
    evidence_excerpt?: string;
    confidence?: number;
    method: VerificationMethod;
  },
): VerificationSuggestion | null {
  const fieldName = safeStr(input.field_name);
  const suggestedValue = safeStr(input.suggested_value);
  const currentValue = safeStr(input.current_value);

  if (!fieldName || !suggestedValue) return null;
  if (
    (fieldName.endsWith("_url") || fieldName === "profile_photo_url")
      ? urlsMatch(currentValue, suggestedValue)
      : valuesMatch(currentValue, suggestedValue)
  ) {
    return null;
  }

  const suggestion: VerificationSuggestion = {
    field_name: fieldName,
    current_value: currentValue,
    suggested_value: suggestedValue,
    source: safeStr(input.source),
    evidence_url: safeStr(input.evidence_url),
    evidence_excerpt: truncateExcerpt(input.evidence_excerpt || ""),
    confidence: clampConfidence(
      input.confidence,
      input.method === "linkedin_scrape" ? 0.85 : 0.74,
    ),
    method: input.method,
    dedupe_key: buildDedupeKey(fieldName, suggestedValue),
    risk_level: getFieldRisk(fieldName),
  };

  return passesRiskPolicy(suggestion) ? suggestion : null;
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

function getDefaultConfidenceForLinkedInField(fieldName: string): number {
  switch (fieldName) {
    case "linkedin_url":
      return 0.98;
    case "profile_photo_url":
      return 0.95;
    case "location_city":
    case "location_state":
      return 0.92;
    case "_status":
      return 0.9;
    case "bio":
      return 0.88;
    case "current_position":
      return 0.84;
    default:
      return 0.82;
  }
}

function diffLinkedInProfile(
  person: VerificationPerson,
  profile: LinkedInProfile,
): VerificationSuggestion[] {
  const suggestions: VerificationSuggestion[] = [];
  const currentCity = safeStr(person.locations?.city);
  const currentState = safeStr(person.locations?.state);
  const currentLocation = [currentCity, currentState].filter(Boolean).join(", ");
  const evidenceUrl =
    canonicalizeLinkedInUrl(profile.linkedin_url) ||
    canonicalizeLinkedInUrl(safeStr(person.linkedin_url));

  const pushLinkedInSuggestion = (
    fieldName: string,
    suggestedValue: string,
    source: string,
    evidenceExcerpt: string,
  ) => {
    const suggestion = buildSuggestion({
      field_name: fieldName,
      current_value:
        fieldName === "_status" ? currentLocation : getPersonFieldValue(person, fieldName),
      suggested_value: suggestedValue,
      source,
      evidence_url: evidenceUrl,
      evidence_excerpt: evidenceExcerpt,
      confidence: getDefaultConfidenceForLinkedInField(fieldName),
      method: "linkedin_scrape",
    });

    if (suggestion) {
      suggestions.push(suggestion);
    }
  };

  if (
    profile.current_position &&
    !valuesMatch(safeStr(person.current_position), profile.current_position)
  ) {
    pushLinkedInSuggestion(
      "current_position",
      profile.current_position,
      "LinkedIn profile",
      `LinkedIn headline/current role: ${profile.current_position}`,
    );
  }

  if (profile.is_us_location === false && profile.location_text) {
    pushLinkedInSuggestion(
      "_status",
      "may_have_left_us",
      "LinkedIn profile",
      `LinkedIn location appears outside the US: ${profile.location_text}`,
    );
  } else {
    if (profile.location_city && !valuesMatch(currentCity, profile.location_city)) {
      pushLinkedInSuggestion(
        "location_city",
        profile.location_city,
        "LinkedIn profile",
        `LinkedIn location: ${profile.location_text || profile.location_city}`,
      );
    }

    if (profile.location_state && !valuesMatch(currentState, profile.location_state)) {
      pushLinkedInSuggestion(
        "location_state",
        profile.location_state,
        "LinkedIn profile",
        `LinkedIn location: ${profile.location_text || profile.location_state}`,
      );
    }
  }

  if (shouldSuggestBio(safeStr(person.bio), profile.bio)) {
    pushLinkedInSuggestion(
      "bio",
      profile.bio,
      "LinkedIn profile",
      profile.bio,
    );
  }

  if (
    profile.profile_photo_url &&
    !safeStr(person.profile_photo_url) &&
    !urlsMatch(safeStr(person.profile_photo_url), profile.profile_photo_url)
  ) {
    pushLinkedInSuggestion(
      "profile_photo_url",
      profile.profile_photo_url,
      "LinkedIn profile",
      "LinkedIn profile exposes a profile photo URL for this contact.",
    );
  }

  if (
    profile.linkedin_url &&
    safeStr(person.linkedin_url) &&
    !urlsMatch(safeStr(person.linkedin_url), profile.linkedin_url)
  ) {
    pushLinkedInSuggestion(
      "linkedin_url",
      profile.linkedin_url,
      "LinkedIn profile",
      `Canonical LinkedIn profile URL: ${canonicalizeLinkedInUrl(profile.linkedin_url)}`,
    );
  }

  return finalizeSuggestions(suggestions);
}

function buildSearchQuery(person: VerificationPerson): string {
  const locationCity = safeStr(person.locations?.city);
  return [person.name, person.current_position, locationCity]
    .map(safeStr)
    .filter(Boolean)
    .join(" ");
}

async function callCheckProfile(
  person: VerificationPerson,
  geminiApiKey: string,
  searchResults: WebSearchResult[],
): Promise<{ suggestions: VerificationSuggestion[]; modelUsed: string }> {
  if (!geminiApiKey) {
    throw new Error("Missing GEMINI_API_KEY");
  }

  const definition = getAiAgentTaskDefinition("check_profile");
  const { data, modelUsed } = await callGeminiStructured<ProfileCheckResult>({
    apiKey: geminiApiKey,
    route: definition.modelRoute,
    systemPrompt: definition.systemPrompt,
    userPrompt: definition.buildUserPrompt({
      person: {
        id: person.id,
        name: person.name,
        title: safeStr(person.title),
        first_name: safeStr(person.first_name),
        last_name: safeStr(person.last_name),
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
      },
      searchResults: formatResultsForLLM(searchResults),
    }),
    schema: definition.schema,
    parse: (payload) => definition.normalizeResult(payload) as ProfileCheckResult,
    attemptsPerModel: 2,
    emptyResponseFallback: { suggestions: [] },
  });

  const fallbackResult = searchResults[0];
  const suggestions = data.suggestions
    .map((suggestion) =>
      buildSuggestion({
        field_name: suggestion.field_name,
        current_value: getPersonFieldValue(person, suggestion.field_name),
        suggested_value: suggestion.suggested_value,
        source: suggestion.source || "Web search",
        evidence_url: suggestion.evidence_url || fallbackResult?.url || "",
        evidence_excerpt:
          suggestion.evidence_excerpt ||
          fallbackResult?.content ||
          suggestion.source ||
          "",
        confidence: clampConfidence(
          suggestion.confidence,
          getFieldRisk(suggestion.field_name) === "high" ? 0.86 : 0.76,
        ),
        method: "web_search_llm",
      })
    )
    .filter((suggestion): suggestion is VerificationSuggestion => Boolean(suggestion));

  return {
    suggestions: finalizeSuggestions(suggestions),
    modelUsed,
  };
}

export async function getVerificationApifyAvailability(): Promise<boolean> {
  const usage = await getApifyUsage();
  return usage.available;
}

export async function loadVerificationPerson(
  supabase: SupabaseAdminClient,
  personId: string,
): Promise<VerificationPerson | null> {
  const { data, error } = await supabase
    .from("people")
    .select(`
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
      title,
      first_name,
      last_name,
      data_source,
      last_verified_at,
      created_at,
      updated_at,
      locations(city, state)
    `)
    .eq("id", personId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load person ${personId}: ${error.message}`);
  }

  if (!data) return null;
  return normalizePersonRow(data as VerificationPersonQueryRow);
}

function daysSinceReference(dateValue: string | null | undefined): number {
  if (!dateValue) return 3650;
  const deltaMs = Date.now() - new Date(dateValue).getTime();
  return Math.max(0, Math.floor(deltaMs / (1000 * 60 * 60 * 24)));
}

function getVerificationAgeReference(person: VerificationPerson): string {
  return person.last_verified_at || person.updated_at || person.created_at || new Date(0).toISOString();
}

function getSourceImportanceBoost(source: string): number {
  switch (source) {
    case "self_reported":
      return 3.5;
    case "manual":
      return 3;
    case "csv_import":
      return 2.2;
    case "discovery_agent":
      return 2;
    case "ai_agent":
      return 1.5;
    default:
      return 1;
  }
}

function buildPriorityContext(
  person: VerificationPerson,
  metrics: {
    searchClicks90d: number;
    recentDiscoveryTouches45d: number;
    pendingSuggestions: number;
  },
): VerificationPriorityContext {
  const staleDays = daysSinceReference(getVerificationAgeReference(person));
  const staleScore = Math.min(staleDays / 30, 18);
  const unverifiedBoost = person.last_verified_at ? 0 : 4;
  const linkedinBoost = safeStr(person.linkedin_url) ? 4 : 0;
  const sourceBoost = getSourceImportanceBoost(safeStr(person.data_source));
  const activityBoost = Math.min(metrics.searchClicks90d * 1.25, 6);
  const discoveryBoost = Math.min(metrics.recentDiscoveryTouches45d * 2, 6);
  const pendingPenalty = metrics.pendingSuggestions > 0 ? 100 : 0;

  const reasons: string[] = [];
  if (!person.last_verified_at) reasons.push("never verified");
  reasons.push(`${staleDays}d stale`);
  if (safeStr(person.linkedin_url)) reasons.push("has LinkedIn");
  if (metrics.searchClicks90d > 0) reasons.push(`${metrics.searchClicks90d} search clicks / 90d`);
  if (metrics.recentDiscoveryTouches45d > 0) {
    reasons.push(`${metrics.recentDiscoveryTouches45d} recent discovery touch${metrics.recentDiscoveryTouches45d === 1 ? "" : "es"}`);
  }
  if (metrics.pendingSuggestions > 0) reasons.push("already has pending suggestions");

  return {
    priority_score: Math.max(
      0,
      staleScore + unverifiedBoost + linkedinBoost + sourceBoost + activityBoost + discoveryBoost -
        pendingPenalty,
    ),
    stale_days: staleDays,
    search_clicks_90d: metrics.searchClicks90d,
    recent_discovery_touches_45d: metrics.recentDiscoveryTouches45d,
    pending_suggestions: metrics.pendingSuggestions,
    reasons,
  };
}

export async function fetchVerificationCandidates(
  supabase: SupabaseAdminClient,
  batchSize: number,
  maxAgeMonths: number,
  personIds?: string[],
): Promise<VerificationPerson[]> {
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
    title,
    first_name,
    last_name,
    data_source,
    last_verified_at,
    created_at,
    updated_at,
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

    return ((data || []) as VerificationPersonQueryRow[])
      .map(normalizePersonRow)
      .slice(0, batchSize);
  }

  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - maxAgeMonths);

  const candidatePoolSize = Math.max(batchSize * CANDIDATE_POOL_MULTIPLIER, MIN_CANDIDATE_POOL);
  const { data, error } = await supabase
    .from("people")
    .select(selectClause)
    .order("last_verified_at", { ascending: true, nullsFirst: true })
    .limit(candidatePoolSize);

  if (error) {
    throw new Error(`Failed to load people: ${error.message}`);
  }

  const pool = ((data || []) as VerificationPersonQueryRow[])
    .map(normalizePersonRow)
    .filter((person) => {
      if (!person.last_verified_at) return true;
      return new Date(person.last_verified_at).getTime() < cutoff.getTime();
    });

  const personIdsInPool = pool.map((person) => person.id);
  if (personIdsInPool.length === 0) return [];

  const searchClicksCutoff = new Date();
  searchClicksCutoff.setDate(searchClicksCutoff.getDate() - SEARCH_ACTIVITY_LOOKBACK_DAYS);
  const discoveryCutoff = new Date();
  discoveryCutoff.setDate(discoveryCutoff.getDate() - DISCOVERY_TOUCH_LOOKBACK_DAYS);

  const [
    pendingSuggestionsRes,
    searchClicksRes,
    discoveryTouchesRes,
  ] = await Promise.all([
    supabase
      .from("profile_suggestions")
      .select("person_id")
      .in("person_id", personIdsInPool)
      .eq("record_type", "person")
      .eq("status", "pending"),
    supabase
      .from("search_clicks")
      .select("person_id, clicked_at")
      .in("person_id", personIdsInPool)
      .gte("clicked_at", searchClicksCutoff.toISOString()),
    supabase
      .from("discovered_contacts")
      .select("approved_person_id, created_at")
      .in("approved_person_id", personIdsInPool)
      .gte("created_at", discoveryCutoff.toISOString()),
  ]);

  if (pendingSuggestionsRes.error) {
    throw new Error(
      `Failed to load pending verification suggestions: ${pendingSuggestionsRes.error.message}`,
    );
  }
  if (searchClicksRes.error) {
    throw new Error(`Failed to load search click activity: ${searchClicksRes.error.message}`);
  }
  if (discoveryTouchesRes.error) {
    throw new Error(
      `Failed to load discovery touch activity: ${discoveryTouchesRes.error.message}`,
    );
  }

  const pendingSuggestionCount = new Map<string, number>();
  for (const row of pendingSuggestionsRes.data || []) {
    const personId = safeStr(row.person_id);
    if (!personId) continue;
    pendingSuggestionCount.set(personId, (pendingSuggestionCount.get(personId) || 0) + 1);
  }

  const searchClickCount = new Map<string, number>();
  for (const row of searchClicksRes.data || []) {
    const personId = safeStr(row.person_id);
    if (!personId) continue;
    searchClickCount.set(personId, (searchClickCount.get(personId) || 0) + 1);
  }

  const discoveryTouchCount = new Map<string, number>();
  for (const row of discoveryTouchesRes.data || []) {
    const personId = safeStr(row.approved_person_id);
    if (!personId) continue;
    discoveryTouchCount.set(personId, (discoveryTouchCount.get(personId) || 0) + 1);
  }

  return pool
    .map((person) => ({
      ...person,
      priority: buildPriorityContext(person, {
        searchClicks90d: searchClickCount.get(person.id) || 0,
        recentDiscoveryTouches45d: discoveryTouchCount.get(person.id) || 0,
        pendingSuggestions: pendingSuggestionCount.get(person.id) || 0,
      }),
    }))
    .filter((person) => (person.priority?.pending_suggestions || 0) === 0)
    .sort((a, b) => (b.priority?.priority_score || 0) - (a.priority?.priority_score || 0))
    .slice(0, batchSize);
}

export async function runVerificationForPerson(
  supabase: SupabaseAdminClient,
  person: VerificationPerson,
  options: {
    geminiApiKey?: string;
    apifyAvailable: boolean;
  },
): Promise<VerificationExecutionResult> {
  const warnings: string[] = [];
  let apifyAvailable = options.apifyAvailable;

  if (safeStr(person.linkedin_url) && apifyAvailable) {
    try {
      const linkedinUrl = canonicalizeLinkedInUrl(safeStr(person.linkedin_url));
      const scrape = await runApifyActor<Record<string, unknown>>(
        APIFY_ACTORS.LINKEDIN_PROFILE_SCRAPER,
        {
          urls: [linkedinUrl],
          profileUrls: [linkedinUrl],
        },
        { sync: true, timeoutSecs: 20 },
      );

      const scrapedItem = scrape.items[0];
      if (scrapedItem) {
        const normalizedProfile = normalizeLinkedInProfile(scrapedItem);
        const suggestions = diffLinkedInProfile(person, normalizedProfile);

        return {
          person,
          suggestions,
          path: "linkedin",
          status: suggestions.length > 0 ? "suggestions" : "verified",
          detail: suggestions.length > 0 ? `${suggestions.length} differences detected` : undefined,
          warnings,
          llm_calls_made: 0,
          linkedin_scrapes_made: 1,
          web_searches_made: 0,
          web_search_provider: "none",
          llm_model_used: null,
          quota_exhausted: false,
          apify_available_after: apifyAvailable,
        };
      }
    } catch (error) {
      if (error instanceof ApifyError && error.code === "apify_quota_exhausted") {
        apifyAvailable = false;
      }

      if (!isSkippableLinkedInInputError(error)) {
        warnings.push(
          `LinkedIn scrape failed (${error instanceof Error ? error.message : "unknown error"})`,
        );
      }
    }
  }

  const query = buildSearchQuery(person);
  if (!query) {
    return {
      person,
      suggestions: [],
      path: "skipped",
      status: "no_results",
      detail: "No usable search query",
      warnings,
      llm_calls_made: 0,
      linkedin_scrapes_made: 0,
      web_searches_made: 0,
      web_search_provider: "none",
      llm_model_used: null,
      quota_exhausted: false,
      apify_available_after: apifyAvailable,
    };
  }

  const searchResponse = await searchWeb(query, supabase);
  const webSearchesMade = searchResponse.provider === "none" ? 0 : 1;

  if (searchResponse.quota_exhausted && searchResponse.results.length === 0) {
    return {
      person,
      suggestions: [],
      path: "web_search",
      status: "quota_exhausted",
      detail: "Web search quota exhausted",
      warnings,
      llm_calls_made: 0,
      linkedin_scrapes_made: 0,
      web_searches_made: webSearchesMade,
      web_search_provider: searchResponse.provider,
      llm_model_used: null,
      quota_exhausted: true,
      apify_available_after: apifyAvailable,
    };
  }

  if (searchResponse.results.length === 0) {
    return {
      person,
      suggestions: [],
      path: "web_search",
      status: "no_results",
      warnings,
      llm_calls_made: 0,
      linkedin_scrapes_made: 0,
      web_searches_made: webSearchesMade,
      web_search_provider: searchResponse.provider,
      llm_model_used: null,
      quota_exhausted: false,
      apify_available_after: apifyAvailable,
    };
  }

  const llmResult = await callCheckProfile(
    person,
    safeStr(options.geminiApiKey),
    searchResponse.results,
  );

  return {
    person,
    suggestions: llmResult.suggestions,
    path: "web_search",
    status: llmResult.suggestions.length > 0 ? "suggestions" : "verified",
    detail: llmResult.suggestions.length > 0
      ? `${llmResult.suggestions.length} differences detected`
      : undefined,
    warnings,
    llm_calls_made: 1,
    linkedin_scrapes_made: 0,
    web_searches_made: webSearchesMade,
    web_search_provider: searchResponse.provider,
    llm_model_used: llmResult.modelUsed,
    quota_exhausted: false,
    apify_available_after: apifyAvailable,
  };
}

export async function insertVerificationSuggestions(
  supabase: SupabaseAdminClient,
  target: VerificationTarget,
  suggestions: VerificationSuggestion[],
  options?: {
    agentRunId?: string;
  },
): Promise<InsertSuggestionsResult> {
  if (suggestions.length === 0) {
    return { inserted: 0, updated: 0, duplicatesSkipped: 0 };
  }

  const targetColumn = target.recordType === "organization" ? "organization_id" : "person_id";

  const { data: existing, error: existingError } = await supabase
    .from("profile_suggestions")
    .select("id, dedupe_key, confidence, evidence_url, evidence_excerpt")
    .eq(targetColumn, target.recordId)
    .eq("record_type", target.recordType)
    .eq("status", "pending");

  if (existingError) {
    throw new Error(`Failed to load existing suggestions: ${existingError.message}`);
  }

  const existingByKey = new Map<
    string,
    {
      id: string;
      confidence: number;
      evidence_url: string;
      evidence_excerpt: string;
    }
  >();

  for (const row of existing || []) {
    const key = safeStr(row.dedupe_key);
    if (!key) continue;
    existingByKey.set(key, {
      id: safeStr(row.id),
      confidence: clampConfidence(row.confidence, 0),
      evidence_url: safeStr(row.evidence_url),
      evidence_excerpt: safeStr(row.evidence_excerpt),
    });
  }

  const toInsert = [];
  const toUpdate: Array<{ id: string; suggestion: VerificationSuggestion }> = [];
  let duplicatesSkipped = 0;

  for (const suggestion of suggestions) {
    const existingRow = existingByKey.get(suggestion.dedupe_key);
    if (!existingRow) {
      toInsert.push({
        record_type: target.recordType,
        person_id: target.recordType === "person" ? target.recordId : null,
        organization_id: target.recordType === "organization" ? target.recordId : null,
        field_name: suggestion.field_name,
        current_value: suggestion.current_value,
        suggested_value: suggestion.suggested_value,
        source: suggestion.source,
        evidence_url: suggestion.evidence_url || null,
        evidence_excerpt: suggestion.evidence_excerpt || null,
        confidence: suggestion.confidence,
        method: suggestion.method,
        agent_run_id: options?.agentRunId || null,
        dedupe_key: suggestion.dedupe_key,
        status: "pending",
      });
      continue;
    }

    duplicatesSkipped += 1;
    const shouldRefreshExisting = suggestion.confidence > existingRow.confidence ||
      (!existingRow.evidence_url && Boolean(suggestion.evidence_url)) ||
      (!existingRow.evidence_excerpt && Boolean(suggestion.evidence_excerpt));

    if (shouldRefreshExisting) {
      toUpdate.push({
        id: existingRow.id,
        suggestion,
      });
    }
  }

  let inserted = 0;
  if (toInsert.length > 0) {
    const { data: insertedRows, error: insertError } = await supabase
      .from("profile_suggestions")
      .insert(toInsert)
      .select("id");

    if (insertError) {
      throw new Error(`Failed to insert suggestions: ${insertError.message}`);
    }

    inserted = insertedRows?.length || 0;
  }

  let updated = 0;
  for (const row of toUpdate) {
    const { error: updateError } = await supabase
      .from("profile_suggestions")
      .update({
        current_value: row.suggestion.current_value,
        source: row.suggestion.source,
        evidence_url: row.suggestion.evidence_url || null,
        evidence_excerpt: row.suggestion.evidence_excerpt || null,
        confidence: row.suggestion.confidence,
        method: row.suggestion.method,
        agent_run_id: options?.agentRunId || null,
      })
      .eq("id", row.id);

    if (updateError) {
      throw new Error(`Failed to refresh existing suggestion: ${updateError.message}`);
    }

    updated += 1;
  }

  return { inserted, updated, duplicatesSkipped };
}

export async function markPersonVerified(
  supabase: SupabaseAdminClient,
  personId: string,
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

// ---------------------------------------------------------------------------
// Organization verification (Phase 7 scaffolding).
//
// The full implementation (web-search-driven evidence gathering, field
// comparison, Gemini-backed `check_organization` task) is tracked in
// docs/PHASE-7-VERIFICATION.md. The exports below define the API surface so
// agent-verify can route record_type='organization' through a single contract.
// Until the helper is implemented, callers receive a typed "no_results" so the
// preview/durable contract responds gracefully.
// ---------------------------------------------------------------------------

export interface VerificationOrganization {
  id: string;
  name: string;
  description: string | null;
  website_url: string | null;
  type: string | null;
  us_network_status: string | null;
  last_verified_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export async function loadVerificationOrganization(
  supabase: SupabaseAdminClient,
  organizationId: string,
): Promise<VerificationOrganization | null> {
  const { data, error } = await supabase
    .from("organizations")
    .select(`
      id,
      name,
      description,
      website_url,
      type,
      us_network_status,
      created_at,
      updated_at
    `)
    .eq("id", organizationId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load organization ${organizationId}: ${error.message}`);
  }

  if (!data) return null;
  return {
    ...data,
    last_verified_at: null,
  } as VerificationOrganization;
}

export async function fetchOrganizationVerificationCandidates(
  supabase: SupabaseAdminClient,
  batchSize: number,
  maxAgeMonths: number,
  organizationIds?: string[],
): Promise<VerificationOrganization[]> {
  const selectClause = `
    id,
    name,
    description,
    website_url,
    type,
    us_network_status,
    created_at,
    updated_at
  `;

  if (organizationIds && organizationIds.length > 0) {
    const { data, error } = await supabase
      .from("organizations")
      .select(selectClause)
      .in("id", organizationIds)
      .limit(batchSize);

    if (error) {
      throw new Error(`Failed to load targeted organizations: ${error.message}`);
    }

    return ((data || []) as Array<Omit<VerificationOrganization, "last_verified_at">>).map(
      (row) => ({ ...row, last_verified_at: null }) as VerificationOrganization,
    );
  }

  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - maxAgeMonths);

  const candidatePoolSize = Math.max(batchSize * CANDIDATE_POOL_MULTIPLIER, MIN_CANDIDATE_POOL);
  const { data, error } = await supabase
    .from("organizations")
    .select(selectClause)
    .order("updated_at", { ascending: true, nullsFirst: true })
    .limit(candidatePoolSize);

  if (error) {
    throw new Error(`Failed to load organizations: ${error.message}`);
  }

  const orgs = ((data || []) as Array<Omit<VerificationOrganization, "last_verified_at">>)
    .map((row) => ({ ...row, last_verified_at: null }) as VerificationOrganization)
    .filter((org) => {
      const reference = org.updated_at || org.created_at;
      if (!reference) return true;
      return new Date(reference).getTime() < cutoff.getTime();
    });

  const orgIds = orgs.map((org) => org.id);
  if (orgIds.length === 0) return [];

  const { data: pendingRows, error: pendingError } = await supabase
    .from("profile_suggestions")
    .select("organization_id")
    .in("organization_id", orgIds)
    .eq("record_type", "organization")
    .eq("status", "pending");

  if (pendingError) {
    throw new Error(
      `Failed to load pending organization suggestions: ${pendingError.message}`,
    );
  }

  const pendingByOrg = new Set<string>();
  for (const row of pendingRows || []) {
    const id = safeStr(row.organization_id);
    if (id) pendingByOrg.add(id);
  }

  return orgs
    .filter((org) => !pendingByOrg.has(org.id))
    .slice(0, batchSize);
}

export interface VerificationOrganizationExecutionResult {
  organization: VerificationOrganization;
  suggestions: VerificationSuggestion[];
  path: VerificationPath;
  status: VerificationStatus;
  detail?: string;
  warnings: string[];
  llm_calls_made: number;
  web_searches_made: number;
  web_search_provider: string;
  llm_model_used: string | null;
  quota_exhausted: boolean;
}

function getOrganizationFieldValue(
  organization: VerificationOrganization,
  fieldName: string,
): string {
  switch (fieldName) {
    case "name":
      return safeStr(organization.name);
    case "description":
      return safeStr(organization.description);
    case "website_url":
      return safeStr(organization.website_url);
    case "type":
      return safeStr(organization.type);
    default:
      return "";
  }
}

function buildOrganizationSearchQuery(organization: VerificationOrganization): string {
  return [organization.name, organization.type, "official website"]
    .map(safeStr)
    .filter(Boolean)
    .join(" ");
}

async function callCheckOrganization(
  organization: VerificationOrganization,
  geminiApiKey: string,
  searchResults: WebSearchResult[],
): Promise<{ suggestions: VerificationSuggestion[]; modelUsed: string }> {
  if (!geminiApiKey) {
    throw new Error("Missing GEMINI_API_KEY");
  }

  const definition = getAiAgentTaskDefinition("check_organization");
  const { data, modelUsed } = await callGeminiStructured<OrganizationCheckResult>({
    apiKey: geminiApiKey,
    route: definition.modelRoute,
    systemPrompt: definition.systemPrompt,
    userPrompt: definition.buildUserPrompt({
      organization: {
        id: organization.id,
        name: safeStr(organization.name),
        description: safeStr(organization.description),
        website_url: safeStr(organization.website_url),
        type: safeStr(organization.type),
      },
      searchResults: formatResultsForLLM(searchResults),
    }),
    schema: definition.schema,
    parse: (payload) => definition.normalizeResult(payload) as OrganizationCheckResult,
    attemptsPerModel: 2,
    emptyResponseFallback: { suggestions: [] },
  });

  const fallbackResult = searchResults[0];
  const suggestions = data.suggestions
    .map((suggestion) => {
      const currentValue = getOrganizationFieldValue(organization, suggestion.field_name);

      // For description, mirror person bio behavior: only suggest if the
      // existing description is empty/short and the new value is substantial.
      if (suggestion.field_name === "description") {
        const next = safeStr(suggestion.suggested_value);
        if (!shouldSuggestBio(currentValue, next)) return null;
      }

      return buildSuggestion({
        field_name: suggestion.field_name,
        current_value: currentValue,
        suggested_value: suggestion.suggested_value,
        source: suggestion.source || "Web search",
        evidence_url: suggestion.evidence_url || fallbackResult?.url || "",
        evidence_excerpt:
          suggestion.evidence_excerpt ||
          fallbackResult?.content ||
          suggestion.source ||
          "",
        confidence: clampConfidence(
          suggestion.confidence,
          getFieldRisk(suggestion.field_name) === "high" ? 0.86 : 0.76,
        ),
        method: "web_search_llm",
      });
    })
    .filter((suggestion): suggestion is VerificationSuggestion => Boolean(suggestion));

  return {
    suggestions: finalizeSuggestions(suggestions),
    modelUsed,
  };
}

export async function runVerificationForOrganization(
  supabase: SupabaseAdminClient,
  organization: VerificationOrganization,
  options: {
    geminiApiKey?: string;
  },
): Promise<VerificationOrganizationExecutionResult> {
  const warnings: string[] = [];
  const query = buildOrganizationSearchQuery(organization);

  if (!query) {
    return {
      organization,
      suggestions: [],
      path: "skipped",
      status: "no_results",
      detail: "No usable search query",
      warnings,
      llm_calls_made: 0,
      web_searches_made: 0,
      web_search_provider: "none",
      llm_model_used: null,
      quota_exhausted: false,
    };
  }

  const searchResponse = await searchWeb(query, supabase);
  const webSearchesMade = searchResponse.provider === "none" ? 0 : 1;

  if (searchResponse.quota_exhausted && searchResponse.results.length === 0) {
    return {
      organization,
      suggestions: [],
      path: "web_search",
      status: "quota_exhausted",
      detail: "Web search quota exhausted",
      warnings,
      llm_calls_made: 0,
      web_searches_made: webSearchesMade,
      web_search_provider: searchResponse.provider,
      llm_model_used: null,
      quota_exhausted: true,
    };
  }

  if (searchResponse.results.length === 0) {
    return {
      organization,
      suggestions: [],
      path: "web_search",
      status: "no_results",
      warnings,
      llm_calls_made: 0,
      web_searches_made: webSearchesMade,
      web_search_provider: searchResponse.provider,
      llm_model_used: null,
      quota_exhausted: false,
    };
  }

  const llmResult = await callCheckOrganization(
    organization,
    safeStr(options.geminiApiKey),
    searchResponse.results,
  );

  return {
    organization,
    suggestions: llmResult.suggestions,
    path: "web_search",
    status: llmResult.suggestions.length > 0 ? "suggestions" : "verified",
    detail: llmResult.suggestions.length > 0
      ? `${llmResult.suggestions.length} differences detected`
      : undefined,
    warnings,
    llm_calls_made: 1,
    web_searches_made: webSearchesMade,
    web_search_provider: searchResponse.provider,
    llm_model_used: llmResult.modelUsed,
    quota_exhausted: false,
  };
}

export async function markOrganizationVerified(
  supabase: SupabaseAdminClient,
  organizationId: string,
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("organizations")
    .update({ updated_at: now })
    .eq("id", organizationId);

  if (error) {
    throw new Error(`Failed to mark organization verified: ${error.message}`);
  }
}
