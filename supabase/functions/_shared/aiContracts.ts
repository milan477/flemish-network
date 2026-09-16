import type { GeminiModelRoute } from "./gemini.ts";

export type JsonSchema = Record<string, unknown>;

export type AiAgentTask =
  | "smart_search"
  | "merge_text"
  | "check_profile"
  | "check_organization";

export interface SmartSearchKeywords {
  name: string[];
  occupation: string[];
  sector: string[];
  location_city: string[];
  location_state: string[];
  current_position: string[];
  flemish_connection: string[];
  bio: string[];
}

export interface SmartSearchResult {
  message: string;
  concepts: string[];
  keywords: SmartSearchKeywords;
}

export interface ProfileCheckSuggestion {
  field_name: string;
  current_value: string;
  suggested_value: string;
  source: string;
  evidence_url?: string;
  evidence_excerpt?: string;
  confidence?: number;
}

export interface ProfileCheckResult {
  suggestions: ProfileCheckSuggestion[];
}

export interface OrganizationCheckResult {
  suggestions: ProfileCheckSuggestion[];
}

export const VALID_ORGANIZATION_SUGGESTION_FIELDS = [
  "name",
  "description",
  "website_url",
  "type",
] as const;

export const VALID_PROFILE_SUGGESTION_FIELDS = [
  "title",
  "first_name",
  "last_name",
  "name",
  "current_position",
  "occupation",
  "email",
  "linkedin_url",
  "profile_photo_url",
  "bio",
  "phone",
  "website_url",
  "twitter_url",
  "location_city",
  "location_state",
] as const;

export interface AiTaskDefinition {
  status: "active";
  modelRoute: GeminiModelRoute;
  systemPrompt: string;
  schema: JsonSchema;
  buildUserPrompt: (context: Record<string, unknown>) => string;
  normalizeResult: (payload: unknown) => unknown;
}

function safeString(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function toLowercaseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => safeString(item).toLowerCase())
    .filter(Boolean);
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => safeString(item)).filter(Boolean);
}

const EMPTY_SMART_SEARCH_KEYWORDS: SmartSearchKeywords = {
  name: [],
  occupation: [],
  sector: [],
  location_city: [],
  location_state: [],
  current_position: [],
  flemish_connection: [],
  bio: [],
};

export function normalizeSmartSearchResult(payload: unknown): SmartSearchResult {
  const obj =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};
  const keywords =
    obj.keywords && typeof obj.keywords === "object"
      ? (obj.keywords as Record<string, unknown>)
      : {};

  return {
    message: safeString(obj.message),
    concepts: toStringArray(obj.concepts),
    keywords: {
      name: toLowercaseStringArray(keywords.name),
      occupation: toLowercaseStringArray(keywords.occupation),
      sector: toLowercaseStringArray(keywords.sector),
      location_city: toLowercaseStringArray(keywords.location_city),
      location_state: toLowercaseStringArray(keywords.location_state),
      current_position: toLowercaseStringArray(keywords.current_position),
      flemish_connection: toLowercaseStringArray(keywords.flemish_connection),
      bio: toLowercaseStringArray(keywords.bio),
    },
  };
}

export function normalizeProfileCheckResult(
  payload: unknown
): ProfileCheckResult {
  const obj =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};
  const suggestionsRaw = Array.isArray(obj.suggestions) ? obj.suggestions : [];
  const validFields = new Set<string>(VALID_PROFILE_SUGGESTION_FIELDS);

  return {
    suggestions: suggestionsRaw
      .map((suggestion) => {
        const row =
          suggestion && typeof suggestion === "object"
            ? (suggestion as Record<string, unknown>)
            : {};

        return {
          field_name: safeString(row.field_name),
          current_value: safeString(row.current_value),
          suggested_value: safeString(row.suggested_value),
          source: safeString(row.source) || "web_search",
          evidence_url: safeString(row.evidence_url),
          evidence_excerpt: safeString(row.evidence_excerpt),
          confidence: Number.isFinite(Number(row.confidence))
            ? Math.max(0, Math.min(1, Number(row.confidence)))
            : undefined,
        };
      })
      .filter(
        (suggestion) =>
          Boolean(
            suggestion.field_name &&
              suggestion.suggested_value &&
              validFields.has(suggestion.field_name)
          )
      ),
  };
}

export function normalizeOrganizationCheckResult(
  payload: unknown
): OrganizationCheckResult {
  const obj =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};
  const suggestionsRaw = Array.isArray(obj.suggestions) ? obj.suggestions : [];
  const validFields = new Set<string>(VALID_ORGANIZATION_SUGGESTION_FIELDS);

  return {
    suggestions: suggestionsRaw
      .map((suggestion) => {
        const row =
          suggestion && typeof suggestion === "object"
            ? (suggestion as Record<string, unknown>)
            : {};

        return {
          field_name: safeString(row.field_name),
          current_value: safeString(row.current_value),
          suggested_value: safeString(row.suggested_value),
          source: safeString(row.source) || "web_search",
          evidence_url: safeString(row.evidence_url),
          evidence_excerpt: safeString(row.evidence_excerpt),
          confidence: Number.isFinite(Number(row.confidence))
            ? Math.max(0, Math.min(1, Number(row.confidence)))
            : undefined,
        };
      })
      .filter(
        (suggestion) =>
          Boolean(
            suggestion.field_name &&
              suggestion.suggested_value &&
              validFields.has(suggestion.field_name)
          )
      ),
  };
}

export const SMART_SEARCH_SYSTEM_PROMPT = `You are a search assistant for a professional network directory of Flemish-connected people in the United States.

Given a natural language search query, extract structured search keywords for each profile field. These keywords will be used for fuzzy similarity matching against profiles.

Available profile fields:
- name: person's full name
- occupation: job type (e.g. Researcher, Executive, Creative, Engineer, Consultant)
- sector: one of: Artificial Intelligence, Biotechnology, Finance, Culture & Arts, Education, Research
- location_city: US city name
- location_state: 2-letter US state code
- current_position: job title or role description
- flemish_connection: Belgian/Flemish institutional connection (e.g. KU Leuven, UGent, VUB, BAEF, imec)
- bio: biographical keywords

Rules:
- Return an array of lowercase keywords for each relevant field
- Return 1-3 concise canonical concepts representing what the query means. Expand well-known acronyms from general knowledge instead of merely repeating the acronym.
- Only populate fields that the query implies; leave others as empty arrays
- Resolve shorthand, abbreviations, and incomplete phrases into canonical concepts you know before assigning fields (for example, "uni" or "univ" means "university"). Keep useful original terms alongside canonical concepts when they improve recall.
- Treat the query as concepts rather than requiring its literal wording; infer likely entity types such as a university, city, profession, or sector without inventing a specific named entity unsupported by the query.
- For location, expand abbreviations (e.g. "SF" -> "san francisco", "NYC" -> "new york")
- For sector, use the exact sector names in lowercase
- Generate synonyms and related terms to improve matching (e.g. "Artificial Intelligence" -> ["machine learning", "neural networks"])
- Maximum 5 keywords per field
- Always provide a brief message describing what you're searching for`;

const MERGE_TEXT_SYSTEM_PROMPT = `You are a text merging assistant for a professional network directory.

Given two versions of a text field (e.g. bio, flemish_connection), merge them into a single coherent text that preserves all unique information from both versions. Remove redundancies but keep all distinct facts. Keep the tone professional and concise. Return only the merged text, nothing else.`;

export const CHECK_PROFILE_SYSTEM_PROMPT = `You are a profile accuracy checker for a Flemish-American professional network directory.

Given a person's current profile data and web search results about them, identify any factual updates that should be made to their profile.

Rules:
- Only suggest changes clearly supported by the search results
- Compare search results against each current profile field
- Field names must be exactly one of: title, first_name, last_name, name, current_position, occupation, email, linkedin_url, profile_photo_url, bio, phone, website_url, twitter_url, location_city, location_state
- Do not suggest a change if the current value already matches what's in the search results
- Be conservative: only suggest changes you are confident about
- For profile_photo_url, only suggest an exact absolute image URL from the supplied profile photo candidates. The image must clearly depict this exact person; never use a logo, icon, banner, placeholder, or ambiguous group photo
- For bio, only suggest if current bio is empty or very short and search results provide substantial information
- For location_city and location_state, only suggest a person's explicit current US residence or primary current US work location
- Never infer a current location from a birthplace, former school, scholarship, degree, event, project, or an organization's address
- Location changes must include both city and state, supported together by the same evidence; never return only one half of the pair
- Verify that the city and state form a real US location. Do not combine a non-US city with a US state code
- The source field should briefly describe where the information was found (e.g. "LinkedIn profile", "University website", "News article")
- Set evidence_url to the supporting result URL and evidence_excerpt to a short quote/paraphrase from that same result
- Set confidence to a number between 0 and 1
- If no changes are found, return an empty suggestions array`;

export const CHECK_ORGANIZATION_SYSTEM_PROMPT = `You are an organization profile checker for a Flemish-American professional network directory.

Given an organization's current profile data and web search results about it, identify factual updates that should be made to the profile.

Rules:
- Only suggest changes clearly supported by the search results
- Compare the search results against each current profile field
- Field names must be exactly one of: name, description, website_url, type
- For "type", suggest a short category (e.g. "University", "Foundation", "Government Agency", "Company", "Nonprofit")
- Do not suggest a change if the current value already matches the search evidence
- Be conservative: only suggest changes you are confident about
- For description, only suggest if current description is empty or very short and search results provide substantial information
- The source field should briefly describe where the information was found (e.g. "Official website", "Wikipedia", "News article")
- Set evidence_url to the supporting result URL and evidence_excerpt to a short quote/paraphrase from that same result
- Set confidence to a number between 0 and 1
- If no changes are found, return an empty suggestions array`;

export const CHECK_ORGANIZATION_SCHEMA: JsonSchema = {
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
          evidence_url: { type: "STRING" },
          evidence_excerpt: { type: "STRING" },
          confidence: { type: "NUMBER" },
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

export function buildCheckOrganizationPrompt(
  organization: Record<string, unknown> | undefined,
  searchResults: unknown
): string {
  const sanitized: Record<string, string> = {};
  if (organization && typeof organization === "object") {
    for (const [key, value] of Object.entries(organization)) {
      sanitized[key] = safeString(value);
    }
  }

  return `Current organization profile:\n${JSON.stringify(sanitized, null, 2)}\n\nWeb search results:\n${safeString(searchResults)}`;
}

export const SMART_SEARCH_SCHEMA: JsonSchema = {
  type: "OBJECT",
  properties: {
    message: {
      type: "STRING",
      description: "Brief description of the search being performed",
    },
    concepts: {
      type: "ARRAY",
      items: { type: "STRING" },
      description: "One to three canonical concepts inferred from the query",
    },
    keywords: {
      type: "OBJECT",
      properties: {
        name: { type: "ARRAY", items: { type: "STRING" } },
        occupation: { type: "ARRAY", items: { type: "STRING" } },
        sector: { type: "ARRAY", items: { type: "STRING" } },
        location_city: { type: "ARRAY", items: { type: "STRING" } },
        location_state: { type: "ARRAY", items: { type: "STRING" } },
        current_position: { type: "ARRAY", items: { type: "STRING" } },
        flemish_connection: { type: "ARRAY", items: { type: "STRING" } },
        bio: { type: "ARRAY", items: { type: "STRING" } },
      },
      required: [
        "name",
        "occupation",
        "sector",
        "location_city",
        "location_state",
        "current_position",
        "flemish_connection",
        "bio",
      ],
    },
  },
  required: ["message", "concepts", "keywords"],
};

const MERGE_TEXT_SCHEMA: JsonSchema = {
  type: "OBJECT",
  properties: {
    merged: {
      type: "STRING",
      description: "The merged text combining information from both versions",
    },
  },
  required: ["merged"],
};

export const CHECK_PROFILE_SCHEMA: JsonSchema = {
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
          evidence_url: { type: "STRING" },
          evidence_excerpt: { type: "STRING" },
          confidence: { type: "NUMBER" },
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

export function buildSearchPrompt(query: unknown): string {
  return `Search query: "${safeString(query)}"`;
}

export function buildCheckProfilePrompt(
  person: Record<string, unknown> | undefined,
  searchResults: unknown,
  photoCandidates?: unknown
): string {
  const sanitized: Record<string, string> = {};
  if (person && typeof person === "object") {
    for (const [key, value] of Object.entries(person)) {
      sanitized[key] = safeString(value);
    }
  }

  const candidates = Array.isArray(photoCandidates) ? photoCandidates : [];
  return `Current profile:\n${JSON.stringify(sanitized, null, 2)}\n\nWeb search results:\n${safeString(searchResults)}\n\nProfile photo candidates:\n${JSON.stringify(candidates, null, 2)}`;
}

function buildMergeTextPrompt(context: Record<string, unknown>): string {
  const fieldName = safeString(context.field_name) || "text";
  const existingValue = safeString(context.existing_value) || "(empty)";
  const newValue = safeString(context.new_value) || "(empty)";

  return `Field: ${fieldName}\n\nExisting value:\n${existingValue}\n\nNew value:\n${newValue}`;
}

function normalizeMergeTextResult(payload: unknown): { merged: string } {
  const obj =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};

  return {
    merged: safeString(obj.merged),
  };
}

export const AI_AGENT_TASK_DEFINITIONS: Record<AiAgentTask, AiTaskDefinition> = {
  smart_search: {
    status: "active",
    modelRoute: "query_parsing",
    systemPrompt: SMART_SEARCH_SYSTEM_PROMPT,
    schema: SMART_SEARCH_SCHEMA,
    buildUserPrompt: (context) => buildSearchPrompt(context.query),
    normalizeResult: normalizeSmartSearchResult,
  },
  merge_text: {
    status: "active",
    modelRoute: "lightweight_text_merge",
    systemPrompt: MERGE_TEXT_SYSTEM_PROMPT,
    schema: MERGE_TEXT_SCHEMA,
    buildUserPrompt: buildMergeTextPrompt,
    normalizeResult: normalizeMergeTextResult,
  },
  check_profile: {
    status: "active",
    modelRoute: "profile_verification",
    systemPrompt: CHECK_PROFILE_SYSTEM_PROMPT,
    schema: CHECK_PROFILE_SCHEMA,
    buildUserPrompt: (context) =>
      buildCheckProfilePrompt(
        context.person as Record<string, unknown> | undefined,
        context.searchResults,
        context.photoCandidates
      ),
    normalizeResult: normalizeProfileCheckResult,
  },
  check_organization: {
    status: "active",
    modelRoute: "profile_verification",
    systemPrompt: CHECK_ORGANIZATION_SYSTEM_PROMPT,
    schema: CHECK_ORGANIZATION_SCHEMA,
    buildUserPrompt: (context) =>
      buildCheckOrganizationPrompt(
        context.organization as Record<string, unknown> | undefined,
        context.searchResults
      ),
    normalizeResult: normalizeOrganizationCheckResult,
  },
};

export function isAiAgentTask(value: string): value is AiAgentTask {
  return value in AI_AGENT_TASK_DEFINITIONS;
}

export function getAiAgentTaskDefinition(task: AiAgentTask): AiTaskDefinition {
  return AI_AGENT_TASK_DEFINITIONS[task];
}

export function getAiAgentTasks(): AiAgentTask[] {
  return Object.keys(AI_AGENT_TASK_DEFINITIONS) as AiAgentTask[];
}

export function getEmptySmartSearchKeywords(): SmartSearchKeywords {
  return {
    ...EMPTY_SMART_SEARCH_KEYWORDS,
    name: [],
    occupation: [],
    sector: [],
    location_city: [],
    location_state: [],
    current_position: [],
    flemish_connection: [],
    bio: [],
  };
}
