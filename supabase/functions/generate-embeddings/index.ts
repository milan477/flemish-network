import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, apikey, x-client-info",
};

const EMBEDDING_MODEL = "gemini-embedding-001";
const EMBEDDING_DIM = 768;
const DEFAULT_BATCH_SIZE = 20;

interface PersonRow {
  id: string;
  name: string | null;
  current_position: string | null;
  bio: string | null;
  occupation: string | null;
  location_id: string | null;
  person_flemish_connections?: {
    flemish_connections:
      | { name: string | null }
      | { name: string | null }[]
      | null;
  }[] | null;
}

interface SectorRow {
  sectors: { name: string } | null;
}

interface LocationRow {
  city: string | null;
  state: string | null;
}

function buildFlemishConnectionText(person: PersonRow): string {
  const names = new Set<string>();

  for (const link of person.person_flemish_connections || []) {
    const raw = link.flemish_connections;
    const rows = Array.isArray(raw) ? raw : raw ? [raw] : [];
    for (const row of rows) {
      const name = row?.name?.trim();
      if (name) names.add(name);
    }
  }

  return Array.from(names).sort().join(", ");
}

function buildEmbeddingText(
  person: PersonRow,
  sectorNames: string[],
  location: LocationRow | null
): string {
  const parts: string[] = [];
  if (person.name) parts.push(person.name);
  if (person.current_position) parts.push(person.current_position);
  if (person.bio) parts.push(person.bio);
  if (sectorNames.length > 0) parts.push(sectorNames.join(", "));
  const flemishConnections = buildFlemishConnectionText(person);
  if (flemishConnections) parts.push(flemishConnections);
  if (location) {
    const loc = [location.city, location.state].filter(Boolean).join(", ");
    if (loc) parts.push(loc);
  }
  if (person.occupation) parts.push(person.occupation);
  return parts.join(" | ");
}

async function getEmbedding(
  apiKey: string,
  text: string
): Promise<number[] | null> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent`;

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      content: { parts: [{ text }] },
      outputDimensionality: EMBEDDING_DIM,
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Embedding API error ${resp.status}: ${errText}`);
  }

  const data = await resp.json();
  const values: number[] | undefined = data?.embedding?.values;

  if (!values || values.length !== EMBEDDING_DIM) {
    throw new Error(
      `Expected ${EMBEDDING_DIM} dimensions, got ${values?.length ?? 0}`
    );
  }

  return values;
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
    const { personId, personIds, backfill, batch_size } = body;
    const batchSize = batch_size || DEFAULT_BATCH_SIZE;

    // Determine which person IDs to process
    let idsToProcess: string[] = [];

    if (personId) {
      idsToProcess = [personId];
    } else if (personIds && Array.isArray(personIds)) {
      idsToProcess = personIds;
    } else if (backfill) {
      // Get one batch of people missing embeddings or with stale embeddings
      // Use embedding_generated_at IS NULL as proxy (vector columns can't be filtered via PostgREST)
      const { data: rows } = await supabase
        .from("people")
        .select("id")
        .is("embedding_generated_at", null)
        .order("created_at", { ascending: true })
        .limit(batchSize);

      idsToProcess = (rows || []).map((r: { id: string }) => r.id);

      // Also get stale embeddings (dirty_at > generated_at)
      if (idsToProcess.length < batchSize) {
        const { data: staleRows } = await supabase
          .from("people")
          .select("id")
          .not("embedding_generated_at", "is", null)
          .gt("embedding_dirty_at", "embedding_generated_at")
          .limit(batchSize - idsToProcess.length);

        const staleIds = (staleRows || []).map((r: { id: string }) => r.id);
        idsToProcess.push(...staleIds);
      }

      if (idsToProcess.length === 0) {
        return new Response(
          JSON.stringify({ processed: 0, failed: 0, remaining: 0, errors: [] }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Count remaining after this batch
      const { count: nullCount } = await supabase
        .from("people")
        .select("id", { count: "exact", head: true })
        .is("embedding_generated_at", null);

      const count = nullCount || 0;

      const remaining = Math.max(0, (count || 0) - idsToProcess.length);

      // Process this batch
      const result = await processBatch(supabase, geminiKey, idsToProcess);

      return new Response(
        JSON.stringify({ ...result, remaining }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } else {
      return new Response(
        JSON.stringify({ error: "Provide personId, personIds, or backfill: true" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Process specific IDs
    const result = await processBatch(supabase, geminiKey, idsToProcess);

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message || "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function processBatch(
  supabase: ReturnType<typeof createClient>,
  apiKey: string,
  ids: string[]
): Promise<{ processed: number; failed: number; errors: string[] }> {
  let processed = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const id of ids) {
    try {
      // Fetch person data
      const { data: person } = await supabase
        .from("people")
        .select("id, name, current_position, bio, occupation, location_id, person_flemish_connections(flemish_connections(name))")
        .eq("id", id)
        .single();

      if (!person) {
        errors.push(`Person ${id} not found`);
        failed++;
        continue;
      }

      // Fetch sectors
      const { data: sectorRows } = await supabase
        .from("person_sectors")
        .select("sectors(name)")
        .eq("person_id", id);

      const sectorNames = (sectorRows || [])
        .map((r: SectorRow) => r.sectors?.name)
        .filter(Boolean) as string[];

      // Fetch location
      let location: LocationRow | null = null;
      if (person.location_id) {
        const { data: locData } = await supabase
          .from("locations")
          .select("city, state")
          .eq("id", person.location_id)
          .single();
        location = locData;
      }

      // Build text and generate embedding
      const text = buildEmbeddingText(person as PersonRow, sectorNames, location);

      if (!text.trim()) {
        errors.push(`Person ${id}: empty embedding text`);
        failed++;
        continue;
      }

      const embedding = await getEmbedding(apiKey, text);

      if (!embedding) {
        errors.push(`Person ${id}: failed to generate embedding`);
        failed++;
        continue;
      }

      // Store embedding — format as pgvector string
      const vectorStr = `[${embedding.join(",")}]`;
      const { error: updateErr } = await supabase
        .from("people")
        .update({
          embedding: vectorStr,
          embedding_generated_at: new Date().toISOString(),
        })
        .eq("id", id);

      if (updateErr) {
        errors.push(`Person ${id}: ${updateErr.message}`);
        failed++;
        continue;
      }

      processed++;
    } catch (err) {
      errors.push(`Person ${id}: ${(err as Error).message}`);
      failed++;
    }
  }

  return { processed, failed, errors };
}
