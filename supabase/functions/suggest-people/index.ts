import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, apikey, x-client-info",
};

const EMBEDDING_MODEL = "gemini-embedding-001";
const GEMINI_PRO_MODEL =
  Deno.env.get("GEMINI_PRO_MODEL") || "gemini-3-flash-preview";

interface MatchedPerson {
  id: string;
  name: string;
  first_name: string | null;
  last_name: string | null;
  current_position: string | null;
  location_id: string | null;
  flemish_connection: string | null;
  bio: string | null;
  occupation: string | null;
  available_for_lectures: boolean | null;
  similarity: number;
}

async function getEmbedding(
  apiKey: string,
  text: string
): Promise<number[]> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent`;

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      content: { parts: [{ text }] },
      outputDimensionality: 768,
    }),
  });

  if (!resp.ok) {
    throw new Error(`Embedding API error: ${resp.status}`);
  }

  const data = await resp.json();
  const values: number[] = data?.embedding?.values;

  if (!values || values.length !== 768) {
    throw new Error(`Invalid embedding dimensions: ${values?.length}`);
  }

  return values;
}

async function rankWithGemini(
  apiKey: string,
  query: string,
  candidates: MatchedPerson[]
): Promise<{ message: string; suggestions: { id: string; reason: string }[] }> {
  const candidateList = candidates
    .map((c) => {
      const bio = c.bio ? c.bio.slice(0, 200) : "";
      return `- ID: ${c.id} | Name: ${c.name} | Position: ${c.current_position || "?"} | Flemish: ${c.flemish_connection || "?"} | Bio: ${bio} | Similarity: ${c.similarity.toFixed(3)}`;
    })
    .join("\n");

  const prompt = `You are helping find people in a Flemish-American professional network.

Query: "${query}"

Candidates (ranked by embedding similarity):
${candidateList}

Select the most relevant candidates for this query. For each, provide a brief reason why they match.
Return JSON: { "message": "summary", "suggestions": [{ "id": "uuid", "reason": "why they match" }] }
Order by relevance. Include only genuinely relevant candidates.`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_PRO_MODEL}:generateContent`;

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generation_config: {
        response_mime_type: "application/json",
        response_schema: {
          type: "OBJECT",
          properties: {
            message: { type: "STRING" },
            suggestions: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  id: { type: "STRING" },
                  reason: { type: "STRING" },
                },
                required: ["id", "reason"],
              },
            },
          },
          required: ["message", "suggestions"],
        },
        temperature: 0.3,
      },
    }),
  });

  if (!resp.ok) {
    throw new Error(`Gemini Pro error: ${resp.status}`);
  }

  const data = await resp.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Empty Gemini Pro response");

  return JSON.parse(text);
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
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();
    const { query, collection_id, exclude_ids, max_results } = body;
    const limit = max_results || 15;

    if (!query || typeof query !== "string") {
      return new Response(
        JSON.stringify({ error: "query is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Step 1: Embed the query
    let queryEmbedding: number[];
    try {
      queryEmbedding = await getEmbedding(geminiKey, query);
    } catch (err) {
      return new Response(
        JSON.stringify({ error: `Query embedding failed: ${(err as Error).message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Step 2: Call match_people RPC
    const vectorStr = `[${queryEmbedding.join(",")}]`;
    const { data: matches, error: rpcError } = await supabase.rpc(
      "match_people",
      {
        query_embedding: vectorStr,
        match_count: 50,
        similarity_threshold: 0.3,
      }
    );

    if (rpcError) {
      // If RPC fails (e.g. no embeddings), return helpful message
      return new Response(
        JSON.stringify({
          message: "No embeddings found. Run the embedding backfill first.",
          suggestions: [],
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!matches || matches.length === 0) {
      return new Response(
        JSON.stringify({
          message: "No matching profiles found.",
          suggestions: [],
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Step 3: Exclude IDs
    const excludeSet = new Set<string>(exclude_ids || []);

    // Also exclude existing collection members if collection_id provided
    if (collection_id) {
      const { data: members } = await supabase
        .from("collection_members")
        .select("person_id")
        .eq("collection_id", collection_id);
      (members || []).forEach((m: { person_id: string }) =>
        excludeSet.add(m.person_id)
      );
    }

    const filtered = (matches as MatchedPerson[]).filter(
      (m) => !excludeSet.has(m.id)
    );

    if (filtered.length === 0) {
      return new Response(
        JSON.stringify({
          message: "All matching profiles are already in the collection.",
          suggestions: [],
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Step 4: Rank with Gemini Pro
    const similarityMap = new Map(filtered.map((m) => [m.id, m.similarity]));

    let suggestions: { id: string; name: string; reason: string; similarity: number }[];

    try {
      const ranked = await rankWithGemini(geminiKey, query, filtered.slice(0, 30));

      suggestions = ranked.suggestions
        .filter((s) => similarityMap.has(s.id))
        .map((s) => ({
          id: s.id,
          name: filtered.find((m) => m.id === s.id)?.name || "",
          reason: s.reason,
          similarity: similarityMap.get(s.id) || 0,
        }))
        .slice(0, limit);

      // If Gemini returned fewer than expected, backfill from similarity
      if (suggestions.length < limit) {
        const usedIds = new Set(suggestions.map((s) => s.id));
        const remaining = filtered
          .filter((m) => !usedIds.has(m.id))
          .slice(0, limit - suggestions.length)
          .map((m) => ({
            id: m.id,
            name: m.name,
            reason: "Ranked by profile similarity",
            similarity: m.similarity,
          }));
        suggestions.push(...remaining);
      }

      return new Response(
        JSON.stringify({
          message: ranked.message || `Found ${suggestions.length} relevant people.`,
          suggestions,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch {
      // Gemini Pro fallback: return top matches by similarity only
      suggestions = filtered.slice(0, limit).map((m) => ({
        id: m.id,
        name: m.name,
        reason: "Ranked by profile similarity",
        similarity: m.similarity,
      }));

      return new Response(
        JSON.stringify({
          message: `Found ${suggestions.length} people by profile similarity.`,
          suggestions,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message || "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
