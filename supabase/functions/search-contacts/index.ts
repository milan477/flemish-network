import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

const GEMINI_MODEL = "gemini-3-flash-preview";

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
        "Brief summary of what was found. Mention the number of contacts discovered.",
    },
    contacts: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: {
            type: "STRING",
            description: "Full name of the person",
          },
          bio: {
            type: "STRING",
            description:
              "Short bio (1-2 sentences) based on search results. Empty string if nothing found.",
          },
          occupation: {
            type: "STRING",
            description:
              "Job type category. One of: Professor, Researcher, Engineer, Executive, Government, Creative, Finance, Entrepreneur, Healthcare, Manager, Consultant, or a short custom label. Empty if unknown.",
          },
          current_position: {
            type: "STRING",
            description:
              "Full current job title and organization (e.g. 'AI Researcher at MIT'). Empty if unknown.",
          },
          location_city: {
            type: "STRING",
            description:
              "Current city or most likely US city. Empty if unknown.",
          },
          location_state: {
            type: "STRING",
            description:
              "US 2-letter state abbreviation (e.g. MA, NY, CA). Empty if unknown.",
          },
          flemish_connection: {
            type: "STRING",
            description:
              "Any Belgian/Flemish connection: university, fellowship, origin, etc. Empty if none found.",
          },
          website_url: {
            type: "STRING",
            description:
              "Personal or professional website URL. Empty if not found.",
          },
          email: {
            type: "STRING",
            description:
              "Email address if publicly available. Empty if not found. Must be a real address from search results, never fabricated.",
          },
          email_source: {
            type: "STRING",
            description:
              "The specific URL or source where the email address was found. Empty if email is empty.",
          },
          linkedin_url: {
            type: "STRING",
            description:
              "LinkedIn profile URL (e.g. https://linkedin.com/in/...). Empty if not found.",
          },
          sectors: {
            type: "ARRAY",
            items: { type: "STRING" },
            description:
              "Relevant sectors from: Artificial Intelligence, Biotechnology, Finance, Culture & Arts, Education, Research. Can be multiple.",
          },
          sources: {
            type: "ARRAY",
            items: { type: "STRING" },
            description:
              "URLs of the web pages where information about this person was found.",
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

const SYSTEM_PROMPT = `You are a research assistant for a Flemish-American professional network directory. Your job is to extract structured contact information from web search results.

Rules:
- Extract EVERY distinct person mentioned in the search results that matches the user's query
- For group queries (e.g. "Belgian AI researchers in Boston"), extract ALL individuals found
- All fields are required. Use empty string "" for any field where data is unavailable
- For location, use US city names and 2-letter state abbreviations
- For sectors, choose from ONLY: Artificial Intelligence, Biotechnology, Finance, Culture & Arts, Education, Research
- For occupation, use one of: Professor, Researcher, Engineer, Executive, Government, Creative, Finance, Entrepreneur, Healthcare, Manager, Consultant — or a short custom label
- For email: ONLY include emails that appear verbatim in the search results. NEVER fabricate or guess email addresses
- For email_source: provide the exact URL where the email was found
- For linkedin_url: include the full LinkedIn URL if found in search results
- For sources: list the URLs of pages where you found information about each person
- The flemish_connection field captures any Belgian/Flemish link (university, fellowship, origin city, etc.)
- bio should be 1-2 concise sentences based on factual information from search results
- Provide a helpful message summarizing your findings`;

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
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

  const userPrompt = `User query: "${query}"

Web search results:
${searchResults}

Extract all matching contacts from these search results. If the query asks for a group (e.g. "Belgian researchers at Stanford"), find every individual that matches.`;

  let lastError = "";

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
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
      });

      if (!resp.ok) {
        lastError = await resp.text();
        continue;
      }

      const data = await resp.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        lastError = "Empty Gemini response";
        continue;
      }

      const parsed = JSON.parse(text);

      if (
        typeof parsed.message !== "string" ||
        !Array.isArray(parsed.contacts)
      ) {
        lastError = "Response does not match schema";
        continue;
      }

      const contacts: ExtractedContact[] = parsed.contacts
        .map((c: Record<string, unknown>) => normalizeContact(c))
        .filter((c: ExtractedContact) => c.name.trim().length > 0);

      return { message: parsed.message, contacts };
    } catch (err) {
      lastError = (err as Error).message;
    }
  }

  throw new Error(`Gemini extraction failed: ${lastError}`);
}

async function checkDuplicates(
  contacts: ExtractedContact[],
  supabase: ReturnType<typeof createClient>
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

  const nameMap = new Map<string, string>();
  try {
    const { data: allPeopleNames } = await supabase
      .from("people")
      .select("id, name, first_name, last_name");

    if (allPeopleNames && Array.isArray(allPeopleNames)) {
      for (const p of allPeopleNames as Array<{ id: string; name: string; first_name?: string; last_name?: string }>) {
        const fullName = safeStr(p.name).trim().toLowerCase();
        const pid = safeStr(p.id);
        if (fullName) nameMap.set(fullName, pid);
        const composed = `${safeStr(p.first_name)} ${safeStr(p.last_name)}`.trim().toLowerCase();
        if (composed && composed !== fullName) nameMap.set(composed, pid);
      }
    }
  } catch {
    // name check unavailable
  }

  return contacts.map((contact) => {
    let is_duplicate = false;
    let duplicate_reason = "";
    let existing_person_id = "";

    if (contact.email && contact.email.includes("@")) {
      const match = existing.find(
        (e) =>
          e.email &&
          e.email.toLowerCase() === contact.email.toLowerCase()
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
        (e) =>
          e.linkedin_url &&
          normalize(e.linkedin_url) === normalize(contact.linkedin_url)
      );
      if (match) {
        is_duplicate = true;
        duplicate_reason = `LinkedIn matches existing contact: ${safeStr(match.name)}`;
        existing_person_id = safeStr(match.id);
      }
    }

    if (!is_duplicate) {
      const nameKey = contact.name.trim().toLowerCase();
      const matchId = nameMap.get(nameKey);
      if (matchId) {
        is_duplicate = true;
        duplicate_reason = `Name matches existing contact`;
        existing_person_id = matchId;
      }
    }

    return {
      ...contact,
      is_duplicate,
      duplicate_reason,
      existing_person_id,
    };
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
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
    const query: string = safeStr(body.query);

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
          message:
            "No web results found for this query. Try a more specific search.",
          contacts: [],
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const geminiResult = await callGemini(geminiKey, searchResults, `${query} (provide 4-phrase bio if possible; the flemish connection should mention things that relate the person to Flanders/Belgium))`);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseKey) {
      return new Response(
        JSON.stringify({
          message: geminiResult.message,
          contacts: geminiResult.contacts.map((c) => ({
            ...c,
            is_duplicate: false,
            duplicate_reason: "",
            existing_person_id: "",
          })),
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const contactsWithDupes = await checkDuplicates(
      geminiResult.contacts,
      supabase
    );

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
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
