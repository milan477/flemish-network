import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

const GEMINI_MODEL = "gemini-3-flash-preview";

const SYSTEM_PROMPTS: Record<string, string> = {
  parse_contacts: `You are a data extraction assistant for a Flemish-American network directory that tracks people in the US with connections to Flanders (Belgium).

Given a user's description of one or more contacts, extract each person's details into structured records.

Rules:
- Extract the full name, position/role, location, and any Flemish/Belgian connection
- For location, use US city names and 2-letter state abbreviations (e.g. MA, NY, CA)
- For sectors, choose from ONLY these options: Artificial Intelligence, Biotechnology, Finance, Culture & Arts, Education, Research
- If the description mentions multiple people (numbered list, semicolons, or separate sentences), extract each one separately
- If information is not provided for a field, use an empty string
- The bio field should be a brief summary if enough context is given, otherwise empty
- The flemish_connection field captures any Belgian/Flemish institutional or personal connection mentioned (e.g. "From Ghent", "KU Leuven alumnus", "BAEF fellow")
- Always provide a friendly message summarizing what you extracted`,

  suggest_people: `You are an event planning assistant for a Flemish-American professional network. You help find the best contacts for events, missions, talks, and campaigns.

Given an event plan and a user's request, identify which people from the provided list would be most relevant.

Rules:
- You can ONLY suggest people from the provided list. Never invent people or IDs.
- Return person IDs in order of relevance (most relevant first)
- Consider the event type, topic, location, and the user's specific request
- Match people by their sector, position, location, flemish connection, and availability
- If the user asks for speakers or lecturers, prioritize people marked as available for lectures
- Maximum 8 suggestions per response
- For EACH suggested person, provide a brief 1-sentence reason explaining why they are a good fit (in the suggestions array)
- If the user sends a greeting, help request, or question about the plan, respond conversationally with an empty suggested_person_ids and suggestions arrays
- Provide a helpful, concise message explaining your suggestions or answering the question`,

  smart_search: `You are a search assistant for a professional network directory of Flemish-connected people in the United States.

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
- Always provide a brief message describing what you're searching for`,

  flemish_search: `You are a search assistant for a Flemish-American professional network directory. The user is searching for Flemish connections using natural language.

Given a natural language query, extract normalized lowercase keywords and specify which profile fields to search.

You may ONLY return keywords for these two fields:
- flemish_connection: Belgian/Flemish institutional or personal connections (universities, organizations, cities, fellowships)
- bio: biographical text that may mention Flemish/Belgian connections

Rules:
- All keywords must be lowercase
- Generate synonyms and abbreviations (e.g. "University of Antwerp" -> ["university of antwerp", "uantwerp", "ua", "antwerpen"])
- Maximum 6 keywords per field
- Always populate both fields with relevant keywords
- Always provide a brief message describing what you're searching for`,

  check_profile: `You are a profile accuracy checker for a Flemish-American professional network directory.

Given a person's current profile data and web search results about them, identify any factual updates that should be made to their profile.

Rules:
- Only suggest changes clearly supported by the search results
- Compare search results against each current profile field
- Field names must be exactly one of: title, first_name, last_name, name, current_position, occupation, email, linkedin_url, bio, phone, website_url, twitter_url, location_city, location_state
- Do not suggest a change if the current value already matches what's in the search results
- Be conservative: only suggest changes you are confident about
- For bio, only suggest if current bio is empty or very short and search results provide substantial information
- The source field should briefly describe where the information was found (e.g. "LinkedIn profile", "University website", "News article")
- If no changes are found, return an empty suggestions array`,
};

const SCHEMAS: Record<string, object> = {
  parse_contacts: {
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
            occupation: { type: "STRING", description: "Job type category (e.g. Researcher, Creative, Executive)" },
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
  },

  suggest_people: {
    type: "OBJECT",
    properties: {
      message: {
        type: "STRING",
        description: "Conversational response to the user",
      },
      suggested_person_ids: {
        type: "ARRAY",
        items: { type: "STRING" },
        description: "Person IDs from the available list, ordered by relevance",
      },
      suggestions: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            id: { type: "STRING", description: "Person ID" },
            reason: { type: "STRING", description: "Brief 1-sentence reason why this person is a good fit" },
          },
          required: ["id", "reason"],
        },
        description: "Each suggested person with a reason",
      },
    },
    required: ["message", "suggested_person_ids", "suggestions"],
  },

  smart_search: {
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
        required: ["name", "occupation", "sector", "location_city", "location_state", "current_position", "flemish_connection", "bio"],
      },
    },
    required: ["message", "keywords"],
  },

  flemish_search: {
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
  },

  check_profile: {
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
  },
};

function buildUserPrompt(
  task: string,
  context: Record<string, unknown>
): string {
  switch (task) {
    case "parse_contacts": {
      const sectors = (context.sectors as string[]) || [];
      return `User description:\n${context.description}\n\nAvailable sectors: ${sectors.join(", ")}`;
    }

    case "suggest_people": {
      const plan = context.plan as Record<string, string>;
      const people = context.people as Array<Record<string, unknown>>;
      const lines = people.map(
        (p) =>
          `ID:${p.id} | ${p.name} | ${p.current_position || "No position"} | ${p.location_city || "??"}, ${p.location_state || ""} | Flemish: ${p.flemish_connection || "none"}${p.available_for_lectures ? " | Lectures: yes" : ""}`
      );
      return `Event: ${plan.title || "Untitled"} (${plan.event_type})\nTopic: ${plan.topic}\nLocation: ${plan.location || "TBD"}\nDates: ${plan.dates_description || "TBD"}\n\nUser request: "${context.query}"\n\nAvailable people (${lines.length}):\n${lines.join("\n")}`;
    }

    case "smart_search": {
      return `Search query: "${context.query}"`;
    }

    case "flemish_search": {
      return `Search query: "${context.query}"`;
    }

    case "check_profile": {
      const person = context.person as Record<string, unknown> | undefined;
      const sanitized: Record<string, string> = {};
      if (person && typeof person === "object") {
        for (const [k, v] of Object.entries(person)) {
          sanitized[k] = v === null || v === undefined ? "" : String(v);
        }
      }
      const searchText = context.searchResults ?? "";
      return `Current profile:\n${JSON.stringify(sanitized, null, 2)}\n\nWeb search results:\n${searchText}`;
    }

    default:
      return JSON.stringify(context);
  }
}

async function callGemini(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  schema: object,
  maxRetries = 2
): Promise<unknown> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

  let lastError = "";

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: "user", parts: [{ text: userPrompt }] }],
          generation_config: {
            response_mime_type: "application/json",
            response_schema: schema,
            temperature: 0.3,
          },
        }),
      });

      if (!resp.ok) {
        lastError = await resp.text();
        continue;
      }

      const data = await resp.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!text) {
        lastError = "Empty response from Gemini";
        continue;
      }

      const parsed = JSON.parse(text);
      return parsed;
    } catch (err) {
      lastError = (err as Error).message;
    }
  }

  throw new Error(`Gemini call failed after ${maxRetries + 1} attempts: ${lastError}`);
}

function validateResponse(task: string, data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const obj = data as Record<string, unknown>;

  switch (task) {
    case "parse_contacts":
      return typeof obj.message === "string" && Array.isArray(obj.contacts);
    case "suggest_people":
      return (
        typeof obj.message === "string" &&
        Array.isArray(obj.suggested_person_ids) &&
        Array.isArray(obj.suggestions)
      );
    case "smart_search":
      return (
        typeof obj.message === "string" &&
        typeof obj.keywords === "object" &&
        obj.keywords !== null
      );
    case "flemish_search":
      return (
        typeof obj.message === "string" &&
        typeof obj.keywords === "object" &&
        obj.keywords !== null
      );
    case "check_profile":
      return Array.isArray(obj.suggestions);
    default:
      return false;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "GEMINI_API_KEY is not configured. Add it as an edge function secret.",
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const body = await req.json();
    const task: string = body.task;
    const context: Record<string, unknown> = body.context || {};

    if (!task || !SYSTEM_PROMPTS[task]) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Unknown task: ${task}. Valid tasks: ${Object.keys(SYSTEM_PROMPTS).join(", ")}`,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const systemPrompt = SYSTEM_PROMPTS[task];
    const schema = SCHEMAS[task];
    const userPrompt = buildUserPrompt(task, context);

    const result = await callGemini(apiKey, systemPrompt, userPrompt, schema);

    if (!validateResponse(task, result)) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "AI response did not match expected schema",
        }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(
      JSON.stringify({ success: true, data: result }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        success: false,
        error: (err as Error).message || "Internal error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
