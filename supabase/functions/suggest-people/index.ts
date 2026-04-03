import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  createAdminClient,
  HttpError,
  requireStaffRole,
} from "../_shared/auth.ts";
import { embedTexts } from "../_shared/embeddings.ts";
import { callGeminiStructured } from "../_shared/gemini.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, apikey, x-client-info",
};

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
  similarity: number;
}

interface ChunkMatch {
  person_id: string;
  similarity: number;
}

interface FlemishConnectionRow {
  name: string | null;
}

interface PersonFlemishConnectionRow {
  flemish_connections: FlemishConnectionRow | FlemishConnectionRow[] | null;
}

interface PersonQueryRow {
  id: string;
  name: string;
  first_name: string | null;
  last_name: string | null;
  current_position: string | null;
  location_id: string | null;
  bio: string | null;
  occupation: string | null;
  person_flemish_connections: PersonFlemishConnectionRow[] | null;
}

function summarizeFlemishConnections(
  rows: PersonFlemishConnectionRow[] | null | undefined,
): string | null {
  if (!Array.isArray(rows) || rows.length === 0) return null;

  const names = rows
    .flatMap((row) => {
      const relation = row.flemish_connections;
      if (Array.isArray(relation)) {
        return relation.map((item) => item?.name || "");
      }
      return [relation?.name || ""];
    })
    .map((name) => name.trim())
    .filter(Boolean);

  if (names.length === 0) return null;

  return Array.from(new Set(names)).join(", ");
}

async function getEmbedding(
  apiKey: string,
  text: string
): Promise<number[]> {
  const [embedding] = await embedTexts(apiKey, [{
    text,
    taskType: "RETRIEVAL_QUERY",
  }]);
  return embedding;
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
  const { data } = await callGeminiStructured({
    apiKey,
    route: "offline_evaluation",
    systemPrompt:
      "You rank candidate profiles for a Flemish-American network search. Return only relevant suggestions in structured JSON.",
    userPrompt: prompt,
    schema: {
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
    parse: (payload: unknown) => {
      const parsed =
        payload && typeof payload === "object"
          ? (payload as Record<string, unknown>)
          : {};

      return {
        message: typeof parsed.message === "string" ? parsed.message : "",
        suggestions: Array.isArray(parsed.suggestions)
          ? parsed.suggestions
            .map((suggestion) => {
              const row =
                suggestion && typeof suggestion === "object"
                  ? (suggestion as Record<string, unknown>)
                  : {};

              return {
                id: typeof row.id === "string" ? row.id : "",
                reason: typeof row.reason === "string" ? row.reason : "",
              };
            })
            .filter((suggestion) => suggestion.id && suggestion.reason)
          : [],
      };
    },
    temperature: 0.3,
  });

  return data;
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

    const supabase = createAdminClient();
    const rawSupabase = supabase as unknown as any;
    await requireStaffRole(req, supabase, "editor");

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

    // Step 2: Retrieve both person-level and chunk-level semantic matches.
    const vectorStr = `[${queryEmbedding.join(",")}]`;
    const [vectorResponse, chunkResponse] = await Promise.all([
      supabase.rpc("match_people", {
        query_embedding: vectorStr,
        match_count: 50,
        similarity_threshold: 0.3,
      }),
      supabase.rpc("match_person_text_chunks", {
        query_embedding: vectorStr,
        match_count: 100,
        similarity_threshold: 0.35,
      }),
    ]);

    if (vectorResponse.error && chunkResponse.error) {
      return new Response(
        JSON.stringify({
          message: "No embeddings found. Run the embedding backfill first.",
          suggestions: [],
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const vectorMatches = (vectorResponse.data || []) as MatchedPerson[];
    const chunkMatches = (chunkResponse.data || []) as ChunkMatch[];
    const bestChunkSimilarityByPerson = new Map<string, number>();

    for (const match of chunkMatches) {
      const current = bestChunkSimilarityByPerson.get(match.person_id) || 0;
      if (match.similarity > current) {
        bestChunkSimilarityByPerson.set(match.person_id, match.similarity);
      }
    }

    const candidateIds = Array.from(
      new Set([
        ...vectorMatches.map((match) => match.id),
        ...bestChunkSimilarityByPerson.keys(),
      ]),
    );

    if (candidateIds.length === 0) {
      return new Response(
        JSON.stringify({
          message: "No matching profiles found.",
          suggestions: [],
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: candidatePeople, error: peopleError } = await rawSupabase
      .from("people")
      .select(
        "id, name, first_name, last_name, current_position, location_id, bio, occupation, person_flemish_connections(flemish_connections(name))",
      )
      .in("id", candidateIds);

    if (peopleError) {
      throw peopleError;
    }

    const vectorById = new Map(vectorMatches.map((match) => [match.id, match]));
    const peopleById = new Map(
      ((candidatePeople || []) as unknown as PersonQueryRow[]).map((person) => [
        person.id,
        person,
      ]),
    );

    // Step 3: Exclude IDs
    const excludeSet = new Set<string>(exclude_ids || []);

    // Also exclude existing collection members if collection_id provided
    if (collection_id) {
      const { data: members } = await rawSupabase
        .from("collection_members")
        .select("person_id")
        .eq("collection_id", collection_id);
      (((members || []) as unknown as Array<{ person_id: string }>)).forEach((m) =>
        excludeSet.add(m.person_id)
      );
    }

    const filtered = candidateIds
      .filter((personId) => !excludeSet.has(personId))
      .map((personId) => {
        const person = peopleById.get(personId);
        if (!person) return null;

        const vectorMatch = vectorById.get(personId);
        const chunkSimilarity = bestChunkSimilarityByPerson.get(personId) || 0;

        return {
          id: person.id,
          name: person.name,
          first_name: person.first_name,
          last_name: person.last_name,
          current_position: person.current_position,
          location_id: person.location_id,
          flemish_connection: summarizeFlemishConnections(
            person.person_flemish_connections,
          ),
          bio: person.bio,
          occupation: person.occupation,
          similarity: Math.max(vectorMatch?.similarity || 0, chunkSimilarity),
        } satisfies MatchedPerson;
      })
      .filter((match): match is MatchedPerson => Boolean(match))
      .sort((a, b) => b.similarity - a.similarity);

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
      // If reranking fails, fall back to raw vector similarity.
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
      {
        status: err instanceof HttpError ? err.status : 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
