import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, apikey, x-client-info",
};

const ALLOWED_TYPES = ["colleague", "alumni", "local_peer"] as const;
type ConnectionType = (typeof ALLOWED_TYPES)[number];

interface DiscoveryRow {
  relationship_type: ConnectionType;
  connections_found: number;
  new_connections_created: number;
  already_existed: number;
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
      normalized === "local_peer"
    ) {
      seen.add(normalized);
    }
  }

  return seen.size > 0 ? Array.from(seen) : [...ALLOWED_TYPES];
}

async function heartbeat(
  supabase: ReturnType<typeof createClient>,
  runId?: string
): Promise<void> {
  if (!runId) return;
  await supabase
    .from("agent_runs")
    .update({ heartbeat_at: new Date().toISOString() })
    .eq("id", runId);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseKey) {
    return jsonResponse(
      { error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" },
      500
    );
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  let runId: string | undefined;
  let requestedTypes: ConnectionType[] = [...ALLOWED_TYPES];

  try {
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
      local_peer: {
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

    const result = {
      types_requested: requestedTypes,
      connections_found: requestedTypes.reduce(
        (sum, type) => sum + byType[type].connections_found,
        0
      ),
      new_connections_created: requestedTypes.reduce(
        (sum, type) => sum + byType[type].new_connections_created,
        0
      ),
      already_existed: requestedTypes.reduce(
        (sum, type) => sum + byType[type].already_existed,
        0
      ),
      by_type: byType,
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
    if (runId) {
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
      500
    );
  }
});
