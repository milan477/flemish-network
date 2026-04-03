import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  createAdminClient,
  HttpError,
  requireStaffRole,
} from "../_shared/auth.ts";
import type { SupabaseAdminClient } from "../_shared/database.types.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, apikey, x-client-info",
};

const ALLOWED_TYPES = [
  "colleague",
  "alumni",
  "program_peer",
  "local_peer",
  "lab_peer",
  "event_peer",
] as const;
type ConnectionType = (typeof ALLOWED_TYPES)[number];

interface DiscoveryRow {
  relationship_type: ConnectionType;
  connections_found: number;
  new_connections_created: number;
  already_existed: number;
}

interface ChunkRow {
  id: string;
  person_id: string;
  chunk_type: string;
  chunk_index: number;
  chunk_text: string;
  embedding: string | null;
}

interface ChunkMatchRow {
  id: string;
  person_id: string;
  chunk_type: string;
  chunk_index: number;
  chunk_text: string;
  similarity: number;
}

interface PersonMetaRow {
  id: string;
  name: string;
  current_position: string | null;
  location_id: string | null;
  locations:
    | { city: string | null; state: string | null }
    | { city: string | null; state: string | null }[]
    | null;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeTypes(input: unknown): ConnectionType[] {
  if (!Array.isArray(input) || input.length === 0) {
    return [...ALLOWED_TYPES];
  }

  const seen = new Set<ConnectionType>();
  for (const value of input) {
    const normalized = String(value || "").trim().toLowerCase();
    if (
      normalized === "colleague" ||
      normalized === "alumni" ||
      normalized === "program_peer" ||
      normalized === "local_peer" ||
      normalized === "lab_peer" ||
      normalized === "event_peer"
    ) {
      seen.add(normalized);
    }
  }

  return seen.size > 0 ? Array.from(seen) : [...ALLOWED_TYPES];
}

function normalizeLocation(
  value: PersonMetaRow["locations"],
): { city: string | null; state: string | null } | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function pairKey(personA: string, personB: string): string {
  return [personA, personB].sort().join("|");
}

function truncateText(value: string, maxLength = 220): string {
  const normalized = String(value || "").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 3)}...`;
}

function normalizeConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(0.99, Number(value.toFixed(2))));
}

async function heartbeat(
  supabase: SupabaseAdminClient,
  runId?: string,
): Promise<void> {
  if (!runId) return;
  await supabase
    .from("agent_runs")
    .update({ heartbeat_at: new Date().toISOString() })
    .eq("id", runId);
}

async function maybeGenerateConnectionSuggestions(
  supabase: SupabaseAdminClient,
  runId?: string,
): Promise<{
  created: number;
  anchors_scanned: number;
  candidate_pairs: number;
}> {
  const { data: chunkRows, error: chunkError } = await supabase
    .from("person_text_chunks")
    .select("id, person_id, chunk_type, chunk_index, chunk_text, embedding")
    .in("chunk_type", ["combined", "bio"])
    .not("embedding", "is", null)
    .order("updated_at", { ascending: false })
    .limit(40);

  if (chunkError) {
    throw new Error(`Failed to load chunk anchors: ${chunkError.message}`);
  }

  const anchorChunks = ((chunkRows || []) as ChunkRow[]).filter((row) => row.embedding).slice(0, 20);
  if (anchorChunks.length === 0) {
    return { created: 0, anchors_scanned: 0, candidate_pairs: 0 };
  }

  const hardConnectionPersonIds = Array.from(new Set(anchorChunks.map((chunk) => chunk.person_id)));
  const orFilters = hardConnectionPersonIds
    .flatMap((personId) => [`from_person_id.eq.${personId}`, `to_person_id.eq.${personId}`])
    .join(",");
  const { data: hardConnectionRows, error: hardConnectionError } = await supabase
    .from("connections")
    .select("from_person_id, to_person_id")
    .or(orFilters)
    .limit(500);

  if (hardConnectionError) {
    throw new Error(`Failed to load existing connections: ${hardConnectionError.message}`);
  }

  const hardPairs = new Set<string>();
  for (const row of (hardConnectionRows || []) as Array<{
    from_person_id: string | null;
    to_person_id: string | null;
  }>) {
    if (row.from_person_id && row.to_person_id) {
      hardPairs.add(pairKey(row.from_person_id, row.to_person_id));
    }
  }

  const candidateSuggestions = new Map<string, {
    from_person_id: string;
    to_person_id: string;
    confidence: number;
    strength: number;
    evidence_excerpt: string;
    metadata: Record<string, unknown>;
  }>();

  for (const anchor of anchorChunks) {
    if (!anchor.embedding) continue;
    const { data: matches, error: matchError } = await supabase.rpc("match_person_text_chunks", {
      query_embedding: anchor.embedding,
      match_count: 8,
      similarity_threshold: 0.84,
      exclude_person_id: anchor.person_id,
    });

    if (matchError) {
      throw new Error(`Failed to match chunk suggestions: ${matchError.message}`);
    }

    for (const match of (matches || []) as ChunkMatchRow[]) {
      const key = pairKey(anchor.person_id, match.person_id);
      if (hardPairs.has(key)) continue;

      const confidence = normalizeConfidence(match.similarity);
      const existing = candidateSuggestions.get(key);
      if (existing && existing.confidence >= confidence) continue;

      const [from_person_id, to_person_id] = [anchor.person_id, match.person_id].sort();
      candidateSuggestions.set(key, {
        from_person_id,
        to_person_id,
        confidence,
        strength: confidence,
        evidence_excerpt: truncateText(match.chunk_text),
        metadata: {
          source_chunk_id: anchor.id,
          source_chunk_type: anchor.chunk_type,
          source_chunk_index: anchor.chunk_index,
          source_chunk_text: truncateText(anchor.chunk_text),
          matched_chunk_id: match.id,
          matched_chunk_type: match.chunk_type,
          matched_chunk_index: match.chunk_index,
          matched_chunk_text: truncateText(match.chunk_text),
          similarity: confidence,
        },
      });
    }
  }

  if (candidateSuggestions.size === 0) {
    return {
      created: 0,
      anchors_scanned: anchorChunks.length,
      candidate_pairs: 0,
    };
  }

  const relatedPersonIds = Array.from(new Set(
    Array.from(candidateSuggestions.values()).flatMap((item) => [item.from_person_id, item.to_person_id]),
  ));
  const [peopleRes, sectorRes] = await Promise.all([
    supabase
      .from("people")
      .select("id, name, current_position, location_id, locations(city, state)")
      .in("id", relatedPersonIds),
    supabase
      .from("person_sectors")
      .select("person_id, sectors(name)")
      .in("person_id", relatedPersonIds),
  ]);

  if (peopleRes.error) {
    throw new Error(`Failed to load suggestion people: ${peopleRes.error.message}`);
  }

  if (sectorRes.error) {
    throw new Error(`Failed to load suggestion sectors: ${sectorRes.error.message}`);
  }

  const peopleById = new Map(
    ((peopleRes.data || []) as unknown as PersonMetaRow[]).map((person) => [
      person.id,
      {
        ...person,
        locations: normalizeLocation(person.locations),
      },
    ]),
  );
  const sectorsByPerson = new Map<string, string[]>();
  for (const row of ((sectorRes.data || []) as unknown as Array<{
    person_id: string;
    sectors: { name: string | null } | { name: string | null }[] | null;
  }>)) {
    const next = sectorsByPerson.get(row.person_id) || [];
    const sector = Array.isArray(row.sectors) ? row.sectors[0]?.name : row.sectors?.name;
    if (sector && !next.includes(sector)) {
      next.push(sector);
      sectorsByPerson.set(row.person_id, next);
    }
  }

  const rows = Array.from(candidateSuggestions.values())
    .map((candidate) => {
      const fromPerson = peopleById.get(candidate.from_person_id);
      const toPerson = peopleById.get(candidate.to_person_id);
      if (!fromPerson || !toPerson) return null;

      const sharedSectors = (sectorsByPerson.get(candidate.from_person_id) || []).filter((sector) =>
        (sectorsByPerson.get(candidate.to_person_id) || []).includes(sector)
      );
      const sharedState = fromPerson.locations?.state &&
          toPerson.locations?.state &&
          fromPerson.locations.state === toPerson.locations.state
        ? fromPerson.locations.state
        : null;

      if (sharedSectors.length === 0 && !sharedState) {
        return null;
      }

      return {
        from_person_id: candidate.from_person_id,
        to_person_id: candidate.to_person_id,
        suggestion_type: "semantic_peer",
        confidence: candidate.confidence,
        strength: candidate.strength,
        source: "chunk_embedding",
        evidence_url: null,
        evidence_excerpt: candidate.evidence_excerpt,
        metadata: {
          ...candidate.metadata,
          from_person_name: fromPerson.name,
          to_person_name: toPerson.name,
          shared_sectors: sharedSectors,
          shared_state: sharedState,
        },
        agent_run_id: runId || null,
        dedupe_key: `${candidate.from_person_id}|${candidate.to_person_id}|semantic_peer`,
        status: "pending",
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  if (rows.length === 0) {
    return {
      created: 0,
      anchors_scanned: anchorChunks.length,
      candidate_pairs: candidateSuggestions.size,
    };
  }

  const { data: insertedRows, error: insertError } = await supabase
    .from("connection_suggestions")
    .upsert(rows, { onConflict: "dedupe_key" })
    .select("id");

  if (insertError) {
    throw new Error(`Failed to upsert connection suggestions: ${insertError.message}`);
  }

  return {
    created: insertedRows?.length || 0,
    anchors_scanned: anchorChunks.length,
    candidate_pairs: candidateSuggestions.size,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  let supabase: SupabaseAdminClient | null = null;

  let runId: string | undefined;
  let requestedTypes: ConnectionType[] = [...ALLOWED_TYPES];

  try {
    supabase = createAdminClient();
    await requireStaffRole(req, supabase, "editor");

    const body = await req.json().catch(() => ({}));
    runId = typeof body.run_id === "string" && body.run_id.trim()
      ? body.run_id.trim()
      : undefined;
    requestedTypes = normalizeTypes(body.types);

    await heartbeat(supabase, runId);

    const { data, error } = await supabase.rpc("discover_connections", {
      p_types: requestedTypes,
    });

    if (error) {
      throw new Error(error.message);
    }

    await heartbeat(supabase, runId);

    const rows = ((data || []) as DiscoveryRow[]).filter(Boolean);
    const byType: Record<ConnectionType, {
      connections_found: number;
      new_connections_created: number;
      already_existed: number;
    }> = {
      colleague: {
        connections_found: 0,
        new_connections_created: 0,
        already_existed: 0,
      },
      alumni: {
        connections_found: 0,
        new_connections_created: 0,
        already_existed: 0,
      },
      program_peer: {
        connections_found: 0,
        new_connections_created: 0,
        already_existed: 0,
      },
      local_peer: {
        connections_found: 0,
        new_connections_created: 0,
        already_existed: 0,
      },
      lab_peer: {
        connections_found: 0,
        new_connections_created: 0,
        already_existed: 0,
      },
      event_peer: {
        connections_found: 0,
        new_connections_created: 0,
        already_existed: 0,
      },
    };

    for (const row of rows) {
      if (!ALLOWED_TYPES.includes(row.relationship_type)) continue;
      byType[row.relationship_type] = {
        connections_found: Number(row.connections_found || 0),
        new_connections_created: Number(row.new_connections_created || 0),
        already_existed: Number(row.already_existed || 0),
      };
    }

    const connectionSuggestions = body.generate_soft_suggestions === false
      ? { created: 0, anchors_scanned: 0, candidate_pairs: 0 }
      : await maybeGenerateConnectionSuggestions(supabase, runId);

    const result = {
      types_requested: requestedTypes,
      connections_found: requestedTypes.reduce(
        (sum, type) => sum + byType[type].connections_found,
        0,
      ),
      new_connections_created: requestedTypes.reduce(
        (sum, type) => sum + byType[type].new_connections_created,
        0,
      ),
      already_existed: requestedTypes.reduce(
        (sum, type) => sum + byType[type].already_existed,
        0,
      ),
      by_type: byType,
      connection_suggestions_upserted: connectionSuggestions.created,
      connection_suggestion_anchors_scanned: connectionSuggestions.anchors_scanned,
      connection_suggestion_candidate_pairs: connectionSuggestions.candidate_pairs,
      llm_calls_made: 0,
      web_searches_made: 0,
    };

    if (runId) {
      await supabase
        .from("agent_runs")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          heartbeat_at: new Date().toISOString(),
          results: result,
          llm_calls_made: 0,
          llm_model_used: null,
          web_searches_made: 0,
          web_search_provider: "none",
          cost_estimate_usd: 0,
        })
        .eq("id", runId);
    }

    return jsonResponse(result);
  } catch (error) {
    if (runId && supabase) {
      await supabase
        .from("agent_runs")
        .update({
          status: "failed",
          completed_at: new Date().toISOString(),
          heartbeat_at: new Date().toISOString(),
          error_message: error instanceof Error ? error.message : "Unknown error",
          llm_calls_made: 0,
          llm_model_used: null,
          web_searches_made: 0,
          web_search_provider: "none",
          cost_estimate_usd: 0,
        })
        .eq("id", runId);
    }

    return jsonResponse(
      { error: error instanceof Error ? error.message : "Internal error" },
      error instanceof HttpError ? error.status : 500,
    );
  }
});
