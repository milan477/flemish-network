import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  createAdminClient,
  HttpError,
  requireStaffRole,
} from "./auth.ts";
import type { SupabaseAdminClient } from "./database.types.ts";
import { callGeminiStructured } from "./gemini.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, apikey, x-client-info",
};

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
  email_source: string;
  linkedin_url: string;
  sectors: string[];
  sources: string[];
}

interface ContactWithDupe extends ExtractedContact {
  is_duplicate: boolean;
  duplicate_reason: string;
  existing_person_id: string;
}

function safeStr(val: unknown): string {
  if (val === null || val === undefined) return "";
  return String(val);
}

function normalizeContact(raw: Record<string, unknown>): ExtractedContact {
  return {
    name: safeStr(raw.name),
    bio: safeStr(raw.bio),
    occupation: safeStr(raw.occupation),
    current_position: safeStr(raw.current_position),
    location_city: safeStr(raw.location_city),
    location_state: safeStr(raw.location_state),
    flemish_connection: safeStr(raw.flemish_connection),
    website_url: safeStr(raw.website_url),
    email: safeStr(raw.email),
    email_source: safeStr(raw.email_source),
    linkedin_url: safeStr(raw.linkedin_url),
    sectors: Array.isArray(raw.sectors)
      ? raw.sectors.filter((s): s is string => typeof s === "string")
      : [],
    sources: Array.isArray(raw.sources)
      ? raw.sources.filter((s): s is string => typeof s === "string")
      : [],
  };
}

const GEMINI_SCHEMA = {
  type: "OBJECT",
  properties: {
    message: {
      type: "STRING",
      description:
        "Brief summary of what was discovered. Mention the number of contacts discovered.",
    },
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
          email_source: { type: "STRING" },
          linkedin_url: { type: "STRING" },
          sectors: {
            type: "ARRAY",
            items: { type: "STRING" },
          },
          sources: {
            type: "ARRAY",
            items: { type: "STRING" },
          },
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
          "email_source",
          "linkedin_url",
          "sectors",
          "sources",
        ],
      },
    },
  },
  required: ["message", "contacts"],
};

const SYSTEM_PROMPT = `You are helping an operator discover people for a Flemish-American professional network.

Rules:
- Extract every distinct person in the web results who appears relevant to the user query
- All fields are required. Use empty string "" for missing scalar fields and [] for missing arrays
- For location, prefer US city names and 2-letter state abbreviations
- For sectors, choose only from: Artificial Intelligence, Biotechnology, Finance, Culture & Arts, Education, Research
- For occupation, use a concise category such as Professor, Researcher, Engineer, Executive, Government, Creative, Finance, Entrepreneur, Healthcare, Manager, Consultant
- For email, only include an email that appears verbatim in the source material
- For email_source, provide the specific URL where the email was found
- For linkedin_url, include the full LinkedIn URL if found
- For sources, list the URLs where information about the person was found
- The flemish_connection field captures any Belgian/Flemish tie such as university, fellowship, program, origin, or institution
- bio should be concise and factual`;

async function searchWeb(
  query: string,
  tavilyKey: string
): Promise<{ results: string; urls: string[] }> {
  try {
    const resp = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: tavilyKey,
        query,
        search_depth: "advanced",
        max_results: 10,
        include_raw_content: false,
      }),
    });

    const data = await resp.json();
    const urls: string[] = [];

    if (!data.results || !Array.isArray(data.results) || data.results.length === 0) {
      return { results: "", urls };
    }

    const formatted = data.results
      .map((r: { title?: string; content?: string; url?: string }) => {
        const url = safeStr(r.url);
        if (url) urls.push(url);
        return `Source: ${url}\nTitle: ${safeStr(r.title)}\nContent: ${safeStr(r.content)}`;
      })
      .join("\n\n---\n\n");

    return { results: formatted, urls };
  } catch {
    return { results: "", urls: [] };
  }
}

async function callGemini(
  apiKey: string,
  searchResults: string,
  query: string
): Promise<{ message: string; contacts: ExtractedContact[] }> {
  const userPrompt = `Discovery query: "${query}"

Web results:
${searchResults}

Extract structured discovery candidates from these results.`;
  const { data } = await callGeminiStructured({
    apiKey,
    route: "contact_extraction",
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    schema: GEMINI_SCHEMA,
    temperature: 0.2,
    attemptsPerModel: 3,
    parse: (payload: unknown) => {
      const parsed =
        payload && typeof payload === "object"
          ? (payload as Record<string, unknown>)
          : {};

      return {
        message: safeStr(parsed.message),
        contacts: Array.isArray(parsed.contacts)
          ? parsed.contacts
            .map((contact) =>
              normalizeContact(
                contact && typeof contact === "object"
                  ? (contact as Record<string, unknown>)
                  : {},
              )
            )
            .filter((contact) => contact.name.trim().length > 0)
          : [],
      };
    },
  });

  return data;
}

async function checkDuplicates(
  contacts: ExtractedContact[],
  supabase: SupabaseAdminClient
): Promise<ContactWithDupe[]> {
  const emails = contacts
    .map((c) => c.email)
    .filter((e) => typeof e === "string" && e.includes("@"));
  const linkedins = contacts
    .map((c) => c.linkedin_url)
    .filter((l) => typeof l === "string" && l.length > 0);

  let existing: Array<{
    id: string;
    name: string;
    email: string | null;
    linkedin_url: string | null;
  }> = [];

  const orParts: string[] = [];
  if (emails.length > 0) {
    orParts.push(
      `email.in.(${emails.map((e) => `"${e.replace(/"/g, "")}"`).join(",")})`
    );
  }
  if (linkedins.length > 0) {
    orParts.push(
      `linkedin_url.in.(${linkedins.map((l) => `"${l.replace(/"/g, "")}"`).join(",")})`
    );
  }

  if (orParts.length > 0) {
    try {
      const { data } = await supabase
        .from("people")
        .select("id, name, email, linkedin_url")
        .or(orParts.join(","));
      existing = (data || []) as typeof existing;
    } catch {
      existing = [];
    }
  }

  const results: ContactWithDupe[] = [];

  for (const contact of contacts) {
    let is_duplicate = false;
    let duplicate_reason = "";
    let existing_person_id = "";

    if (contact.email && contact.email.includes("@")) {
      const match = existing.find(
        (e) => e.email && e.email.toLowerCase() === contact.email.toLowerCase()
      );
      if (match) {
        is_duplicate = true;
        duplicate_reason = `Email matches existing contact: ${safeStr(match.name)}`;
        existing_person_id = safeStr(match.id);
      }
    }

    if (!is_duplicate && contact.linkedin_url) {
      const normalize = (url: string) =>
        safeStr(url).replace(/\/+$/, "").toLowerCase();
      const match = existing.find(
        (e) => e.linkedin_url && normalize(e.linkedin_url) === normalize(contact.linkedin_url)
      );
      if (match) {
        is_duplicate = true;
        duplicate_reason = `LinkedIn matches existing contact: ${safeStr(match.name)}`;
        existing_person_id = safeStr(match.id);
      }
    }

    if (!is_duplicate && contact.name) {
      try {
        const nameKey = contact.name.trim().toLowerCase();
        const { data: nameMatches } = await supabase
          .from("people")
          .select("id, name")
          .or(`name.ilike.${nameKey},name.ilike.${nameKey}`)
          .limit(1);
        if (nameMatches && nameMatches.length > 0) {
          is_duplicate = true;
          duplicate_reason = "Name matches existing contact";
          existing_person_id = safeStr(nameMatches[0].id);
        }
      } catch {
        // name check unavailable
      }
    }

    results.push({
      ...contact,
      is_duplicate,
      duplicate_reason,
      existing_person_id,
    });
  }

  return results;
}

export async function handleDiscoverContactsRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabase = createAdminClient();
    await requireStaffRole(req, supabase, "editor");

    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiKey) {
      return new Response(
        JSON.stringify({ error: "GEMINI_API_KEY not configured" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const tavilyKey = Deno.env.get("TAVILY_API_KEY");
    const body = await req.json();
    const query = safeStr(body.query);

    if (!query.trim()) {
      return new Response(
        JSON.stringify({ error: "query is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const searchQuery = `${query.trim()} (flemish/belgian professional)`;
    let searchResults = "";

    if (tavilyKey) {
      const webResult = await searchWeb(searchQuery, tavilyKey);
      searchResults = webResult.results;
    }

    if (!searchResults && tavilyKey) {
      const fallbackSearch = await searchWeb(query.trim(), tavilyKey);
      searchResults = fallbackSearch.results;
    }

    if (!searchResults) {
      return new Response(
        JSON.stringify({
          message: "No web discovery results found. Try a more specific query.",
          contacts: [],
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const geminiResult = await callGemini(
      geminiKey,
      searchResults,
      `${query} (prefer evidence-bearing bios and Flemish/Belgian ties)`
    );

    const contactsWithDupes = await checkDuplicates(geminiResult.contacts, supabase);

    return new Response(
      JSON.stringify({
        message: geminiResult.message,
        contacts: contactsWithDupes,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : "Internal error",
      }),
      {
        status: err instanceof HttpError ? err.status : 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
}
