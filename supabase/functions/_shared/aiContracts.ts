import type { GeminiModelRoute } from "./gemini.ts";

export type JsonSchema = Record<string, unknown>;

export type AiAgentTask =
  | "parse_contacts"
  | "smart_search"
  | "flemish_search"
  | "merge_text"
  | "check_profile";

export interface ParsedContact {
  name: string;
  current_position: string;
  occupation: string;
  location_city: string;
  location_state: string;
  bio: string;
  flemish_connection: string;
  sectors: string[];
}

export interface ParseContactsResult {
  message: string;
  contacts: ParsedContact[];
}

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
  keywords: SmartSearchKeywords;
}

export interface FlemishSearchKeywords {
  flemish_connection: string[];
  bio: string[];
}

export interface FlemishSearchResult {
  message: string;
  keywords: FlemishSearchKeywords;
}

export interface ProfileCheckSuggestion {
  field_name: string;
  current_value: string;
  suggested_value: string;
  source: string;
}

export interface ProfileCheckResult {
  suggestions: ProfileCheckSuggestion[];
}

export const VALID_PROFILE_SUGGESTION_FIELDS = [
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
] as const;

type TaskStatus = "active" | "frozen";

export interface AiTaskDefinition {
  status: TaskStatus;
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

const EMPTY_FLEMISH_SEARCH_KEYWORDS: FlemishSearchKeywords = {
  flemish_connection: [],
  bio: [],
};

function normalizeParsedContacts(payload: unknown): ParseContactsResult {
  const obj =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};
  const contactsRaw = Array.isArray(obj.contacts) ? obj.contacts : [];

  return {
    message: safeString(obj.message),
    contacts: contactsRaw.map((contact) => {
      const row =
        contact && typeof contact === "object"
          ? (contact as Record<string, unknown>)
          : {};

      return {
        name: safeString(row.name),
        current_position: safeString(row.current_position),
        occupation: safeString(row.occupation),
        location_city: safeString(row.location_city),
        location_state: safeString(row.location_state),
        bio: safeString(row.bio),
        flemish_connection: safeString(row.flemish_connection),
        sectors: Array.isArray(row.sectors)
          ? row.sectors.map((sector) => safeString(sector)).filter(Boolean)
          : [],
      };
    }),
  };
}

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

export function normalizeFlemishSearchResult(
  payload: unknown
): FlemishSearchResult {
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
    keywords: {
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

const PARSE_CONTACTS_SYSTEM_PROMPT = `You are a data extraction assistant for a Flemish-American network directory that tracks people in the US with connections to Flanders (Belgium).

Given a user's description of one or more contacts, extract each person's details into structured records.

Rules:
- Extract the full name, position/role, location, and any Flemish/Belgian connection
- For location, use US city names and 2-letter state abbreviations (e.g. MA, NY, CA)
- For sectors, choose from ONLY these options: Artificial Intelligence, Biotechnology, Finance, Culture & Arts, Education, Research
- If the description mentions multiple people (numbered list, semicolons, or separate sentences), extract each one separately
- If information is not provided for a field, use an empty string
- The bio field should be a brief summary if enough context is given, otherwise empty
- The flemish_connection field captures any Belgian/Flemish institutional or personal connection mentioned (e.g. "From Ghent", "KU Leuven alumnus", "BAEF fellow")
- Always provide a friendly message summarizing what you extracted`;

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
- Only populate fields that the query implies; leave others as empty arrays
- For location, expand abbreviations (e.g. "SF" -> "san francisco", "NYC" -> "new york")
- For sector, use the exact sector names in lowercase
- Generate synonyms and related terms to improve matching (e.g. "AI" -> ["artificial intelligence", "ai", "machine learning"])
- Maximum 5 keywords per field
- Always provide a brief message describing what you're searching for`;

const FLEMISH_SEARCH_SYSTEM_PROMPT = `You are a search assistant for a Flemish-American professional network directory. The user is searching for Flemish connections using natural language.

Given a natural language query, extract normalized lowercase keywords and specify which profile fields to search.

You may ONLY return keywords for these two fields:
- flemish_connection: Belgian/Flemish institutional or personal connections (universities, organizations, cities, fellowships)
- bio: biographical text that may mention Flemish/Belgian connections

Rules:
- All keywords must be lowercase
- Generate synonyms and abbreviations (e.g. "University of Antwerp" -> ["university of antwerp", "uantwerp", "ua", "antwerpen"])
- Maximum 6 keywords per field
- Always populate both fields with relevant keywords
- Always provide a brief message describing what you're searching for`;

const MERGE_TEXT_SYSTEM_PROMPT = `You are a text merging assistant for a professional network directory.

Given two versions of a text field (e.g. bio, flemish_connection), merge them into a single coherent text that preserves all unique information from both versions. Remove redundancies but keep all distinct facts. Keep the tone professional and concise. Return only the merged text, nothing else.`;

export const CHECK_PROFILE_SYSTEM_PROMPT = `You are a profile accuracy checker for a Flemish-American professional network directory.

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

const PARSE_CONTACTS_SCHEMA: JsonSchema = {
  type: "OBJECT",
  properties: {
    message: {
      type: "STRING",
      description: "Brief message about what was extracted",
    },
    contacts: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING" },
          current_position: { type: "STRING" },
          occupation: {
            type: "STRING",
            description: "Job type category (e.g. Researcher, Creative, Executive)",
          },
          location_city: { type: "STRING" },
          location_state: { type: "STRING" },
          bio: { type: "STRING" },
          flemish_connection: { type: "STRING" },
          sectors: { type: "ARRAY", items: { type: "STRING" } },
        },
        required: [
          "name",
          "current_position",
          "occupation",
          "location_city",
          "location_state",
          "bio",
          "flemish_connection",
          "sectors",
        ],
      },
    },
  },
  required: ["message", "contacts"],
};

export const SMART_SEARCH_SCHEMA: JsonSchema = {
  type: "OBJECT",
  properties: {
    message: {
      type: "STRING",
      description: "Brief description of the search being performed",
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
  required: ["message", "keywords"],
};

const FLEMISH_SEARCH_SCHEMA: JsonSchema = {
  type: "OBJECT",
  properties: {
    message: {
      type: "STRING",
      description: "Brief description of the flemish connection search",
    },
    keywords: {
      type: "OBJECT",
      properties: {
        flemish_connection: { type: "ARRAY", items: { type: "STRING" } },
        bio: { type: "ARRAY", items: { type: "STRING" } },
      },
      required: ["flemish_connection", "bio"],
    },
  },
  required: ["message", "keywords"],
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

function buildParseContactsPrompt(context: Record<string, unknown>): string {
  const sectors = Array.isArray(context.sectors)
    ? context.sectors.map((sector) => safeString(sector)).filter(Boolean)
    : [];

  return `User description:\n${safeString(context.description)}\n\nAvailable sectors: ${sectors.join(", ")}`;
}

export function buildSearchPrompt(query: unknown): string {
  return `Search query: "${safeString(query)}"`;
}

export function buildCheckProfilePrompt(
  person: Record<string, unknown> | undefined,
  searchResults: unknown
): string {
  const sanitized: Record<string, string> = {};
  if (person && typeof person === "object") {
    for (const [key, value] of Object.entries(person)) {
      sanitized[key] = safeString(value);
    }
  }

  return `Current profile:\n${JSON.stringify(sanitized, null, 2)}\n\nWeb search results:\n${safeString(searchResults)}`;
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
  parse_contacts: {
    status: "frozen",
    modelRoute: "contact_extraction",
    systemPrompt: PARSE_CONTACTS_SYSTEM_PROMPT,
    schema: PARSE_CONTACTS_SCHEMA,
    buildUserPrompt: buildParseContactsPrompt,
    normalizeResult: normalizeParsedContacts,
  },
  smart_search: {
    status: "active",
    modelRoute: "query_parsing",
    systemPrompt: SMART_SEARCH_SYSTEM_PROMPT,
    schema: SMART_SEARCH_SCHEMA,
    buildUserPrompt: (context) => buildSearchPrompt(context.query),
    normalizeResult: normalizeSmartSearchResult,
  },
  flemish_search: {
    status: "frozen",
    modelRoute: "query_parsing",
    systemPrompt: FLEMISH_SEARCH_SYSTEM_PROMPT,
    schema: FLEMISH_SEARCH_SCHEMA,
    buildUserPrompt: (context) => buildSearchPrompt(context.query),
    normalizeResult: normalizeFlemishSearchResult,
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
        context.searchResults
      ),
    normalizeResult: normalizeProfileCheckResult,
  },
};

export function isAiAgentTask(value: string): value is AiAgentTask {
  return value in AI_AGENT_TASK_DEFINITIONS;
}

export function getAiAgentTaskDefinition(task: AiAgentTask): AiTaskDefinition {
  return AI_AGENT_TASK_DEFINITIONS[task];
}

export function getFrozenAiAgentTasks(): AiAgentTask[] {
  return (Object.entries(AI_AGENT_TASK_DEFINITIONS) as Array<
    [AiAgentTask, AiTaskDefinition]
  >)
    .filter(([, definition]) => definition.status === "frozen")
    .map(([task]) => task);
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

export function getEmptyFlemishSearchKeywords(): FlemishSearchKeywords {
  return {
    ...EMPTY_FLEMISH_SEARCH_KEYWORDS,
    flemish_connection: [],
    bio: [],
  };
}
