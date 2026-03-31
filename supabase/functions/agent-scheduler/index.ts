import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, apikey, x-client-info",
};

type AgentType = "discovery" | "verification" | "connection";
type SchedulerAction = "trigger" | "cancel" | "housekeeping";

const AGENT_FUNCTIONS: Record<AgentType, string> = {
  discovery: "agent-discovery",
  verification: "agent-verify",
  connection: "agent-connections",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseKey) {
    return new Response(
      JSON.stringify({ error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const body = req.method === "POST" ? await req.json() : {};
    const action = (body.action as SchedulerAction | undefined) || "trigger";

    if (!["trigger", "cancel", "housekeeping"].includes(action)) {
      return new Response(
        JSON.stringify({ error: "Invalid action. Must be one of: trigger, cancel, housekeeping" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const housekeeping = await runHousekeeping(supabase);

    if (action === "housekeeping") {
      return jsonResponse({
        status: "ok",
        housekeeping,
      });
    }

    if (action === "cancel") {
      const runId = typeof body.run_id === "string" ? body.run_id : "";
      if (!runId) {
        return new Response(
          JSON.stringify({ error: "run_id is required for cancel" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: cancelledRun, error: cancelError } = await supabase
        .from("agent_runs")
        .update({
          status: "failed",
          completed_at: new Date().toISOString(),
          error_message: "Cancelled by user",
        })
        .eq("id", runId)
        .in("status", ["pending", "running"])
        .select("id, status")
        .maybeSingle();

      if (cancelError) {
        return new Response(
          JSON.stringify({ error: "Failed to cancel run", detail: cancelError.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return jsonResponse({
        status: cancelledRun ? "cancelled" : "noop",
        run_id: runId,
        housekeeping,
      });
    }

    const agentType = body.agent_type as AgentType;
    const params = body.params || {};

    if (!agentType || !AGENT_FUNCTIONS[agentType]) {
      return new Response(
        JSON.stringify({
          error: `Invalid agent_type. Must be one of: ${Object.keys(AGENT_FUNCTIONS).join(", ")}`,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const runId = await triggerAgentRun(
      supabase,
      supabaseUrl,
      req,
      agentType,
      params
    );

    return jsonResponse({
      run_id: runId,
      status: "running",
      housekeeping,
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function runHousekeeping(
  supabase: ReturnType<typeof createClient>
): Promise<{ zombies_marked_failed: number; cache_entries_purged: number }> {
  const [zombiesMarked, cacheEntriesPurged] = await Promise.all([
    markZombieRuns(supabase),
    purgeExpiredCache(supabase),
  ]);

  return {
    zombies_marked_failed: zombiesMarked,
    cache_entries_purged: cacheEntriesPurged,
  };
}

async function triggerAgentRun(
  supabase: ReturnType<typeof createClient>,
  supabaseUrl: string,
  req: Request,
  agentType: AgentType,
  params: Record<string, unknown>
): Promise<string> {
  const { data: run, error: insertError } = await supabase
    .from("agent_runs")
    .insert({
      agent_type: agentType,
      status: "pending",
      params,
    })
    .select("id")
    .single();

  if (insertError || !run) {
    throw new Error(insertError?.message || "Failed to create agent run");
  }

  const runId = run.id;

  const { error: runningError } = await supabase
    .from("agent_runs")
    .update({
      status: "running",
      started_at: new Date().toISOString(),
      heartbeat_at: new Date().toISOString(),
    })
    .eq("id", runId);

  if (runningError) {
    throw new Error(runningError.message || "Failed to start agent run");
  }

  const functionName = AGENT_FUNCTIONS[agentType];
  const forwardedAuth = req.headers.get("Authorization") || req.headers.get("authorization");
  const forwardedApiKey = req.headers.get("apikey") || req.headers.get("Apikey");
  const dispatchHeaders: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (forwardedAuth) {
    dispatchHeaders.Authorization = forwardedAuth;
  } else if (forwardedApiKey) {
    dispatchHeaders.Authorization = `Bearer ${forwardedApiKey}`;
  } else {
    throw new Error("Missing caller authorization for downstream agent dispatch");
  }

  if (forwardedApiKey) {
    dispatchHeaders.apikey = forwardedApiKey;
  }

  fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
    method: "POST",
    headers: dispatchHeaders,
    body: JSON.stringify({ ...params, run_id: runId }),
  }).catch(() => {
    supabase
      .from("agent_runs")
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
        error_message: "Failed to dispatch to agent function",
      })
      .eq("id", runId);
  });

  return runId;
}

async function markZombieRuns(
  supabase: ReturnType<typeof createClient>
): Promise<number> {
  const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();

  const { data } = await supabase
    .from("agent_runs")
    .update({
      status: "failed",
      completed_at: new Date().toISOString(),
      error_message: "Zombie: no heartbeat",
    })
    .eq("status", "running")
    .lt("heartbeat_at", twoMinutesAgo)
    .select("id");

  return data?.length || 0;
}

async function purgeExpiredCache(
  supabase: ReturnType<typeof createClient>
): Promise<number> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data } = await supabase
    .from("web_search_cache")
    .delete()
    .lt("searched_at", thirtyDaysAgo)
    .select("id");

  return data?.length || 0;
}

function estimateCost(
  result: Record<string, unknown>,
  agentType: AgentType
): number {
  const llmCalls = (result.llm_calls_made as number) || 0;
  const webSearches = (result.web_searches_made as number) || 0;

  // Rough cost estimates
  const geminiFlashPerCall = 0.001; // ~$0.10/100 calls
  const webSearchPerCall = 0; // Free tier

  let cost = llmCalls * geminiFlashPerCall + webSearches * webSearchPerCall;

  // Apify costs for agents that use it
  if (agentType === "discovery") {
    const linkedinSearches = (result.linkedin_searches_made as number) || 0;
    cost += linkedinSearches * 0.10; // ~$0.10 per LinkedIn search page
  } else if (agentType === "verification") {
    const linkedinScrapes = (result.linkedin_scrapes_made as number) || 0;
    cost += linkedinScrapes * 0.003; // ~$0.003 per profile scrape
  }

  return Math.round(cost * 10000) / 10000;
}
