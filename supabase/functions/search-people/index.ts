import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, apikey, x-client-info",
};

const GEMINI_FLASH_MODEL =
  Deno.env.get("GEMINI_FLASH_MODEL") || "gemini-3-flash-preview";
const EMBEDDING_MODEL = "gemini-embedding-001";

const KEYWORD_WEIGHT = 0.4;
const EMBEDDING_WEIGHT = 0.6;

// ---------- types ----------

interface SmartSearchKeywords {
  name: string[];
  occupation: string[];
  sector: string[];
  location_city: string[];
  location_state: string[];
  current_position: string[];
  flemish_connection: string[];
  bio: string[];
}

interface SearchResultItem {
  id: string;
  name: string;
  first_name: string | null;
  last_name: string | null;
  title: string | null;
  current_position: string | null;
  bio: string | null;
  occupation: string | null;
  flemish_connection: string | null;
  profile_photo_url: string | null;
  email: string | null;
  linkedin_url: string | null;
  last_verified_at: string | null;
  available_for_lectures: boolean | null;
  location_id: string | null;
  locations: { city: string; state: string } | null;
  score: number;
  snippet: string;
}

interface FlemishConnectionLinkRow {
  flemish_connections:
    | { name: string | null }
    | { name: string | null }[]
    | null;
}

function buildFlemishConnectionText(
  links: FlemishConnectionLinkRow[] | null | undefined
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

// ---------- Gemini helpers ----------

async function extractKeywords(
  apiKey: string,
  query: string
): Promise<SmartSearchKeywords> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_FLASH_MODEL}:generateContent`;

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      system_instruction: {
        parts: [
          {
            text: `You are a search assistant for a professional network directory of Flemish-connected people in the United States.

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
- Maximum 5 keywords per field`,
          },
        ],
      },
      contents: [{ role: "user", parts: [{ text: `Search query: "${query}"` }] }],
      generation_config: {
        response_mime_type: "application/json",
        response_schema: {
          type: "OBJECT",
          properties: {
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
          required: ["keywords"],
        },
        temperature: 0.3,
      },
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Keyword extraction failed (${resp.status}): ${text}`);
  }

  const data = await resp.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Empty keyword extraction response");

  const parsed = JSON.parse(text);
  const kw: SmartSearchKeywords = parsed.keywords;

  // Normalize all values to lowercase, filter empty
  for (const key of Object.keys(kw) as (keyof SmartSearchKeywords)[]) {
    if (!Array.isArray(kw[key])) kw[key] = [];
    kw[key] = kw[key]
      .map((v: string) => (typeof v === "string" ? v.toLowerCase().trim() : ""))
      .filter(Boolean);
  }

  return kw;
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

// ---------- scoring ----------

function scoreAgainstKeywords(
  person: Record<string, unknown>,
  keywords: SmartSearchKeywords
): number {
  let score = 0;
  let totalWeight = 0;

  const fields: {
    key: keyof SmartSearchKeywords;
    personField: string;
    weight: number;
  }[] = [
    { key: "name", personField: "name", weight: 3 },
    { key: "occupation", personField: "occupation", weight: 2 },
    { key: "sector", personField: "sectors_text", weight: 2 },
    { key: "location_city", personField: "location_city", weight: 1.5 },
    { key: "location_state", personField: "location_state", weight: 1 },
    { key: "current_position", personField: "current_position", weight: 2 },
    { key: "flemish_connection", personField: "flemish_connection", weight: 2 },
    { key: "bio", personField: "bio", weight: 1 },
  ];

  for (const { key, personField, weight } of fields) {
    const kws = keywords[key];
    if (!kws || kws.length === 0) continue;

    totalWeight += weight;

    const val = String(person[personField] || "").toLowerCase();
    if (!val) continue;

    let fieldHits = 0;
    for (const kw of kws) {
      if (val.includes(kw)) fieldHits++;
    }

    score += (fieldHits / kws.length) * weight;
  }

  return totalWeight > 0 ? score / totalWeight : 0;
}

// ---------- snippets ----------

function generateSnippet(
  person: Record<string, unknown>,
  keywords: SmartSearchKeywords
): string {
  const bio = String(person.bio || "");
  const currentPosition = String(person.current_position || "");

  if (bio && keywords.bio.length > 0) {
    const sentences = bio.split(/[.!?]+/).filter((s: string) => s.trim());
    for (const sentence of sentences) {
      const lower = sentence.toLowerCase();
      if (keywords.bio.some((kw: string) => lower.includes(kw))) {
        return sentence.trim();
      }
    }
  }

  if (currentPosition && keywords.current_position.length > 0) {
    const lower = currentPosition.toLowerCase();
    if (keywords.current_position.some((kw: string) => lower.includes(kw))) {
      return currentPosition;
    }
  }

  if (bio) {
    const sentences = bio.split(/[.!?]+/).filter((s: string) => s.trim());
    const allKw = [
      ...keywords.name,
      ...keywords.occupation,
      ...keywords.sector,
      ...keywords.location_city,
      ...keywords.location_state,
      ...keywords.current_position,
      ...keywords.flemish_connection,
      ...keywords.bio,
    ];
    for (const sentence of sentences) {
      const lower = sentence.toLowerCase();
      if (allKw.some((kw: string) => lower.includes(kw))) {
        return sentence.trim();
      }
    }
    if (sentences[0]) return sentences[0].trim();
  }

  return "";
}

// ---------- main handler ----------

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

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();
    const { query, max_results } = body;
    const limit = max_results || 30;

    if (!query || typeof query !== "string") {
      return new Response(
        JSON.stringify({ error: "query is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Step 1: Run keyword extraction and embedding in parallel
    const [keywords, queryEmbedding] = await Promise.all([
      extractKeywords(geminiKey, query),
      getEmbedding(geminiKey, query).catch(() => null),
    ]);

    // Step 2: Get embedding candidates (if embedding succeeded)
    let embeddingCandidates: Map<
      string,
      { similarity: number }
    > = new Map();

    if (queryEmbedding) {
      const vectorStr = `[${queryEmbedding.join(",")}]`;
      const { data: matches } = await supabase.rpc("match_people", {
        query_embedding: vectorStr,
        match_count: 50,
        similarity_threshold: 0.2, // lower threshold — hybrid scoring will filter further
      });

      if (matches) {
        for (const m of matches) {
          embeddingCandidates.set(m.id, { similarity: m.similarity });
        }
      }
    }

    // Step 3: Also find keyword-only candidates not in embedding results
    // Build a targeted query for people who match key fields
    const keywordCandidateIds = new Set<string>();

    // Only do targeted keyword queries if we have meaningful keywords
    const hasNameKw = keywords.name.length > 0;
    const hasPositionKw = keywords.current_position.length > 0;
    const hasFlemishKw = keywords.flemish_connection.length > 0;
    const hasBioKw = keywords.bio.length > 0;

    if (hasNameKw || hasPositionKw || hasFlemishKw || hasBioKw) {
      const orClauses: string[] = [];
      for (const kw of keywords.name) {
        orClauses.push(`name.ilike.%${kw}%`);
      }
      for (const kw of keywords.current_position) {
        orClauses.push(`current_position.ilike.%${kw}%`);
      }
      for (const kw of keywords.bio.slice(0, 3)) {
        orClauses.push(`bio.ilike.%${kw}%`);
      }

      if (orClauses.length > 0) {
        const { data: kwMatches } = await supabase
          .from("people")
          .select("id")
          .or(orClauses.join(","))
          .limit(50);

        if (kwMatches) {
          for (const m of kwMatches) {
            keywordCandidateIds.add(m.id);
          }
        }
      }

      if (hasFlemishKw) {
        const { data: connectionMatches } = await supabase
          .from("flemish_connections")
          .select("id")
          .or(
            keywords.flemish_connection
              .map((kw) => `name.ilike.%${kw}%`)
              .join(",")
          )
          .limit(50);

        const connectionIds = (connectionMatches || []).map(
          (row: { id: string }) => row.id
        );

        if (connectionIds.length > 0) {
          const { data: personLinks } = await supabase
            .from("person_flemish_connections")
            .select("person_id")
            .in("flemish_connection_id", connectionIds);

          for (const link of personLinks || []) {
            keywordCandidateIds.add(link.person_id);
          }
        }
      }
    }

    // Merge candidate IDs
    const allCandidateIds = new Set([
      ...embeddingCandidates.keys(),
      ...keywordCandidateIds,
    ]);

    if (allCandidateIds.size === 0) {
      return new Response(
        JSON.stringify({
          results: [],
          keywords,
          message: "No matching profiles found.",
          total_with_embeddings: 0,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Step 4: Fetch full person data for all candidates
    const candidateIdArray = Array.from(allCandidateIds);
    const { data: people } = await supabase
      .from("people")
      .select("*, locations(*), person_flemish_connections(flemish_connections(name))")
      .in("id", candidateIdArray);

    if (!people || people.length === 0) {
      return new Response(
        JSON.stringify({
          results: [],
          keywords,
          message: "No matching profiles found.",
          total_with_embeddings: 0,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Also fetch sector names for keyword scoring
    const { data: sectorRows } = await supabase
      .from("person_sectors")
      .select("person_id, sectors(name)")
      .in("person_id", candidateIdArray);

    const sectorsByPerson = new Map<string, string>();
    if (sectorRows) {
      for (const row of sectorRows) {
        const existing = sectorsByPerson.get(row.person_id) || "";
        const sectorName =
          (row.sectors as unknown as { name: string })?.name || "";
        if (sectorName) {
          sectorsByPerson.set(
            row.person_id,
            existing ? `${existing}, ${sectorName}` : sectorName
          );
        }
      }
    }

    // Step 5: Score each candidate with hybrid scoring
    const scored: {
      person: Record<string, unknown>;
      keywordScore: number;
      embeddingScore: number;
      combinedScore: number;
      snippet: string;
    }[] = [];

    for (const person of people) {
      // Prepare flat record for keyword scoring
      const flat: Record<string, unknown> = {
        ...person,
        location_city: person.locations?.city || "",
        location_state: person.locations?.state || "",
        sectors_text: sectorsByPerson.get(person.id) || "",
        flemish_connection: buildFlemishConnectionText(
          person.person_flemish_connections as FlemishConnectionLinkRow[] | undefined
        ),
      };

      const keywordScore = scoreAgainstKeywords(flat, keywords);
      const embeddingScore =
        embeddingCandidates.get(person.id)?.similarity || 0;

      // Hybrid: 0.4 * keyword + 0.6 * embedding
      // If no embedding for this person, fall back to keyword only
      const hasEmbedding = embeddingCandidates.has(person.id);
      const combinedScore = hasEmbedding
        ? KEYWORD_WEIGHT * keywordScore + EMBEDDING_WEIGHT * embeddingScore
        : keywordScore;

      // Filter: require at least some relevance
      if (combinedScore < 0.05) continue;

      const snippet = generateSnippet(flat, keywords);
      scored.push({ person, keywordScore, embeddingScore, combinedScore, snippet });
    }

    // Sort by combined score descending
    scored.sort((a, b) => b.combinedScore - a.combinedScore);

    // Take top N
    const topResults = scored.slice(0, limit);

    // Step 6: Build response
    const results: SearchResultItem[] = topResults.map((s) => ({
      id: s.person.id as string,
      name: s.person.name as string,
      first_name: s.person.first_name as string | null,
      last_name: s.person.last_name as string | null,
      title: s.person.title as string | null,
      current_position: s.person.current_position as string | null,
      bio: s.person.bio as string | null,
      occupation: s.person.occupation as string | null,
      flemish_connection: buildFlemishConnectionText(
        s.person.person_flemish_connections as FlemishConnectionLinkRow[] | undefined
      ) || null,
      profile_photo_url: s.person.profile_photo_url as string | null,
      email: s.person.email as string | null,
      linkedin_url: s.person.linkedin_url as string | null,
      last_verified_at: s.person.last_verified_at as string | null,
      available_for_lectures: s.person.available_for_lectures as boolean | null,
      location_id: s.person.location_id as string | null,
      locations: s.person.locations as { city: string; state: string } | null,
      score: Math.round(s.combinedScore * 1000) / 1000,
      snippet: s.snippet,
    }));

    // Count people with embeddings for diagnostics
    const { count: embeddingCount } = await supabase
      .from("people")
      .select("id", { count: "exact", head: true })
      .not("embedding", "is", null);

    return new Response(
      JSON.stringify({
        results,
        keywords,
        message: `Found ${results.length} relevant people using hybrid search.`,
        total_with_embeddings: embeddingCount || 0,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message || "Internal error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
