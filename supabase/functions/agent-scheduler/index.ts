import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, apikey, x-client-info",
};

type AgentType = "discovery" | "verification" | "connection";

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
    // Detect and mark zombie runs (no heartbeat for >2 minutes)
    await markZombieRuns(supabase);

    // Purge expired cache entries (>30 days old)
    await purgeExpiredCache(supabase);

    const body = await req.json();
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

    // 1. Create agent_runs row with status 'pending'
    const { data: run, error: insertError } = await supabase
      .from("agent_runs")
      .insert({
        agent_type: agentType,
        status: "pending",
        params,
      })
      .select()
      .single();

    if (insertError || !run) {
      return new Response(
        JSON.stringify({ error: "Failed to create agent run", detail: insertError?.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const runId = run.id;

    // 2. Update to 'running'
    await supabase
      .from("agent_runs")
      .update({
        status: "running",
        started_at: new Date().toISOString(),
        heartbeat_at: new Date().toISOString(),
      })
      .eq("id", runId);

    // 3. Dispatch to the agent edge function
    const functionName = AGENT_FUNCTIONS[agentType];
    try {
      const agentResp = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({ ...params, run_id: runId }),
      });

      if (!agentResp.ok) {
        const errorText = await agentResp.text();
        // 4b. Agent function failed
        await supabase
          .from("agent_runs")
          .update({
            status: "failed",
            completed_at: new Date().toISOString(),
            error_message: `Agent function returned ${agentResp.status}: ${errorText.slice(0, 500)}`,
          })
          .eq("id", runId);

        return new Response(
          JSON.stringify({
            run_id: runId,
            status: "failed",
            error: `Agent function failed: ${agentResp.status}`,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const agentResult = await agentResp.json();

      // 4a. Success: update run with results
      const costEstimate = estimateCost(agentResult, agentType);
      await supabase
        .from("agent_runs")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          results: agentResult,
          llm_calls_made: agentResult.llm_calls_made || 0,
          llm_model_used: agentResult.llm_model_used || null,
          web_searches_made: agentResult.web_searches_made || 0,
          web_search_provider: agentResult.web_search_provider || null,
          cost_estimate_usd: costEstimate,
        })
        .eq("id", runId);

      return new Response(
        JSON.stringify({
          run_id: runId,
          status: "completed",
          results: agentResult,
          cost_estimate_usd: costEstimate,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch (err) {
      // Network or other dispatch error
      await supabase
        .from("agent_runs")
        .update({
          status: "failed",
          completed_at: new Date().toISOString(),
          error_message: err instanceof Error ? err.message : "Unknown dispatch error",
        })
        .eq("id", runId);

      return new Response(
        JSON.stringify({
          run_id: runId,
          status: "failed",
          error: err instanceof Error ? err.message : "Unknown error",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

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
): Promise<void> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  await supabase
    .from("web_search_cache")
    .delete()
    .lt("searched_at", thirtyDaysAgo);
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
