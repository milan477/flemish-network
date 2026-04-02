import type { SupabaseAdminClient } from "./database.types.ts";

export interface ParsedLocationCandidate {
  raw_text: string;
  city: string;
  state: string;
  country: string;
  is_us_candidate: boolean;
  parser_confidence: number;
  review_required: boolean;
  label_value: string;
}

export interface ExistingLocationMatch {
  id: string;
  city: string;
  state: string;
  latitude: number | string | null;
  longitude: number | string | null;
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
  "vlaanderen",
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

export function safeString(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

export function normalizeWhitespace(value: string): string {
  return safeString(value).replace(/\s+/g, " ").trim();
}

export function normalizeLocationKey(value: string): string {
  return normalizeWhitespace(value).toLowerCase();
}

export function isUsCountry(country: string): boolean {
  const normalized = normalizeLocationKey(country);
  return (
    normalized === "united states" ||
    normalized === "united states of america" ||
    normalized === "usa" ||
    normalized === "us"
  );
}

export function stateToCode(state: string): string {
  const trimmed = safeString(state);
  if (!trimmed) return "";
  const upper = trimmed.toUpperCase();
  if (US_STATE_CODES.has(upper)) return upper;
  return US_STATE_BY_NAME[trimmed.toLowerCase()] || "";
}

export function buildLocationLabelValue(city: string, state: string, rawText: string): string {
  const pieces = [safeString(city), safeString(state)].filter(Boolean);
  if (pieces.length > 0) return pieces.join(", ");
  return safeString(rawText);
}

export function parseLocationCandidate(
  rawLocationText: string,
  cityValue: string,
  stateValue: string,
  countryValue = "",
): ParsedLocationCandidate {
  const rawText = normalizeWhitespace(rawLocationText);
  const parts = rawText
    .split(",")
    .map((part) => normalizeWhitespace(part))
    .filter(Boolean);

  let city = normalizeWhitespace(cityValue);
  let state = normalizeWhitespace(stateValue);
  let country = normalizeWhitespace(countryValue);

  if (!city && parts.length >= 1) city = parts[0];
  if (!state && parts.length >= 2) state = parts[1];
  if (!country && parts.length >= 3) country = parts[2];
  if (!country && parts.length === 2 && isUsCountry(parts[1])) {
    country = parts[1];
    state = "";
  }

  const stateCode = stateToCode(state);
  const lowerRaw = normalizeLocationKey(rawText);
  const isNonUsByKeyword = NON_US_LOCATION_KEYWORDS.some((keyword) =>
    lowerRaw.includes(keyword)
  );

  let isUsCandidate = false;
  if (isUsCountry(country) || Boolean(stateCode)) {
    isUsCandidate = true;
  } else if (country || isNonUsByKeyword) {
    isUsCandidate = false;
  } else if (city && !rawText) {
    isUsCandidate = Boolean(stateCode);
  }

  let parserConfidence = 0.45;
  if (city && stateCode) parserConfidence = 0.93;
  else if (city && state) parserConfidence = 0.8;
  else if (city && rawText) parserConfidence = 0.68;
  else if (rawText) parserConfidence = 0.56;

  if (!isUsCandidate && (country || isNonUsByKeyword)) {
    parserConfidence = Math.max(parserConfidence, 0.9);
  }

  const normalizedState = stateCode || state;
  const reviewRequired =
    !isUsCandidate ||
    !city ||
    (!normalizedState && isUsCandidate) ||
    parserConfidence < 0.82;

  return {
    raw_text: rawText,
    city,
    state: normalizedState,
    country,
    is_us_candidate: isUsCandidate,
    parser_confidence: Number(parserConfidence.toFixed(2)),
    review_required: reviewRequired,
    label_value: buildLocationLabelValue(city, normalizedState, rawText),
  };
}

export async function findExistingUsLocation(
  supabase: SupabaseAdminClient,
  city: string,
  state: string,
): Promise<ExistingLocationMatch | null> {
  const normalizedCity = normalizeWhitespace(city);
  const normalizedState = stateToCode(state) || normalizeWhitespace(state);

  if (!normalizedCity || !normalizedState) {
    return null;
  }

  const { data, error } = await supabase
    .from("locations")
    .select("id, city, state, latitude, longitude")
    .ilike("city", normalizedCity)
    .eq("state", normalizedState)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to look up location ${normalizedCity}, ${normalizedState}: ${error.message}`);
  }

  return (data || null) as ExistingLocationMatch | null;
}
