import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, apikey, x-client-info",
};

interface PersonData {
  id: string;
  name: string;
  title?: string;
  first_name?: string;
  last_name?: string;
  current_position?: string;
  location_city?: string;
  location_state?: string;
  bio?: string;
  flemish_connection?: string;
  phone?: string;
  email?: string;
  linkedin_url?: string;
  website_url?: string;
  twitter_url?: string;
}

function buildFlemishConnectionText(
  links:
    | {
        flemish_connections:
          | { name: string | null }
          | { name: string | null }[]
          | null;
      }[]
    | null
    | undefined
): string {
  const names = new Set<string>();

  for (const link of links || []) {
    const raw = link.flemish_connections;
    const rows = Array.isArray(raw) ? raw : raw ? [raw] : [];
    for (const row of rows) {
      const name = row?.name?.trim();
      if (name) names.add(name);
    }
  }

  return Array.from(names).sort().join(", ");
}

interface Suggestion {
  field_name: string;
  current_value: string;
  suggested_value: string;
  source: string;
}

interface ProcessedPersonResult {
  personId: string;
  personName: string;
  suggestionsCount: number;
  suggestions: Suggestion[];
}

function safeStr(val: unknown): string {
  if (val === null || val === undefined) return "";
  return String(val);
}

async function searchWeb(
  query: string,
  tavilyKey: string
): Promise<string> {
  try {
    const resp = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: tavilyKey,
        query,
        search_depth: "basic",
        max_results: 5,
      }),
    });
    const data = await resp.json();
    if (data.results && Array.isArray(data.results)) {
      return data.results
        .map(
          (r: { title?: string; content?: string; url?: string }) =>
            `Title: ${safeStr(r.title)}\nContent: ${safeStr(r.content)}\nURL: ${safeStr(r.url)}`
        )
        .join("\n\n");
    }
  } catch {
    // ignore search errors
  }
  return "";
}

async function extractSuggestionsWithAI(
  person: PersonData,
  searchResults: string
): Promise<Suggestion[]> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceKey) return [];

  try {
    const resp = await fetch(`${supabaseUrl}/functions/v1/ai-agent`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        task: "check_profile",
        context: { person, searchResults },
      }),
    });

    if (!resp.ok) return [];

    const result = await resp.json();
    if (!result || !result.success || !result.data) return [];
    if (!Array.isArray(result.data.suggestions)) return [];

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

    return result.data.suggestions
      .filter(
        (s: Record<string, unknown>) =>
          s &&
          typeof s === "object" &&
          s.field_name &&
          typeof s.field_name === "string" &&
          validFields.has(s.field_name) &&
          s.suggested_value &&
          typeof s.suggested_value === "string" &&
          s.suggested_value !== safeStr(s.current_value)
      )
      .map((s: Record<string, unknown>) => ({
        field_name: String(s.field_name),
        current_value: safeStr(s.current_value),
        suggested_value: String(s.suggested_value),
        source: safeStr(s.source),
      }));
  } catch {
    return [];
  }
}

async function processOnePerson(
  personId: string,
  supabase: ReturnType<typeof createClient>,
  tavilyKey: string | undefined
): Promise<ProcessedPersonResult> {
  try {
    if (!personId || typeof personId !== "string") {
      return {
        personId: "",
        personName: "Unknown",
        suggestionsCount: 0,
        suggestions: [],
      };
    }

    const { data: person, error: fetchErr } = await supabase
      .from("people")
      .select("*, locations(city, state), person_flemish_connections(flemish_connections(name))")
      .eq("id", personId)
      .maybeSingle();

    if (fetchErr || !person) {
      return {
        personId,
        personName: "Unknown",
        suggestionsCount: 0,
        suggestions: [],
      };
    }

    const p: PersonData = {
      id: safeStr(person.id),
      name: safeStr(person.name),
      title: safeStr(person.title),
      first_name: safeStr(person.first_name),
      last_name: safeStr(person.last_name),
      current_position: safeStr(person.current_position),
      location_city: safeStr(person.locations?.city),
      location_state: safeStr(person.locations?.state),
      bio: safeStr(person.bio),
      flemish_connection: buildFlemishConnectionText(person.person_flemish_connections),
      phone: safeStr(person.phone),
      email: safeStr(person.email),
      linkedin_url: safeStr(person.linkedin_url),
      website_url: safeStr(person.website_url),
      twitter_url: safeStr(person.twitter_url),
    };

    if (!p.name) {
      return {
        personId,
        personName: "Unknown",
        suggestionsCount: 0,
        suggestions: [],
      };
    }

    const searchQuery = `${p.name} ${p.current_position} ${p.location_city}`.trim();

    let searchResults = "";
    if (tavilyKey) {
      searchResults = await searchWeb(searchQuery, tavilyKey);
    }

    if (!searchResults) {
      return {
        personId,
        personName: p.name,
        suggestionsCount: 0,
        suggestions: [],
      };
    }

    const suggestions = await extractSuggestionsWithAI(p, searchResults);

    return {
      personId,
      personName: p.name,
      suggestionsCount: suggestions.length,
      suggestions,
    };
  } catch {
    return {
      personId,
      personName: "Unknown",
      suggestionsCount: 0,
      suggestions: [],
    };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const personId = safeStr(body.personId);

    if (!personId) {
      return new Response(
        JSON.stringify({ error: "personId is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseKey) {
      return new Response(
        JSON.stringify({ error: "Missing Supabase configuration" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const tavilyKey = Deno.env.get("TAVILY_API_KEY");

    const result = await processOnePerson(personId, supabase, tavilyKey);
    const responseBody = {
      personId: result.personId,
      personName: result.personName,
      suggestionsCount: result.suggestionsCount,
      suggestions: result.suggestions,
    };

    return new Response(JSON.stringify(responseBody), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
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
