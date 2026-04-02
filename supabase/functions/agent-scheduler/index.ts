import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import type { Database, SupabaseAdminClient } from "../_shared/database.types.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, apikey, x-client-info",
};

type AgentType = "discovery" | "verification" | "connection";
type SchedulerAction = "trigger" | "cancel" | "housekeeping" | "planning";

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

  const supabase = createClient<Database>(supabaseUrl, supabaseKey);

  try {
    const body = req.method === "POST" ? await req.json() : {};
    const action = (body.action as SchedulerAction | undefined) || "trigger";

    if (!["trigger", "cancel", "housekeeping", "planning"].includes(action)) {
      return new Response(
        JSON.stringify({ error: "Invalid action. Must be one of: trigger, cancel, housekeeping, planning" }),
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

    if (action === "planning") {
      const planning = await loadDiscoveryPlanning(supabase);
      return jsonResponse({
        status: "ok",
        housekeeping,
        planning,
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
  supabase: SupabaseAdminClient
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

interface PlanningAction {
  id: string;
  action_type: "entity_pivot" | "gap_refresh" | "domain_revisit";
  title: string;
  detail: string;
  query: string;
  priority_score: number;
  entity_key: string | null;
  gap_target_key: string | null;
  domain: string | null;
}

function uniqueByQuery<T extends { query: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const item of items) {
    const key = item.query.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }

  return result;
}

function pickPrimarySector(sectors: string[] | null | undefined): string | null {
  if (!Array.isArray(sectors)) return null;
  return sectors.find((value) => typeof value === "string" && value.trim().length > 0) || null;
}

function buildGapDiscoveryQuery(gap: {
  label: string;
  sector_emphasis?: string[] | null;
}): string {
  const sector = pickPrimarySector(gap.sector_emphasis);
  return [
    `"${gap.label}"`,
    sector ? `"${sector}"` : null,
    "Belgian OR Flemish",
    "team faculty lab fellows advisory board",
  ].filter(Boolean).join(" ");
}

function buildDomainDiscoveryQuery(domain: string): string {
  return `site:${domain} Belgian OR Flemish team faculty fellows advisory board`;
}

async function loadDiscoveryPlanning(
  supabase: SupabaseAdminClient,
): Promise<Record<string, unknown>> {
  const [
    coverageSummaryRes,
    coverageGapsRes,
    pageTypeMixRes,
    topDomainsRes,
    recentRefillsRes,
    pivotsRes,
  ] = await Promise.all([
    supabase
      .from("ops_discovery_coverage_summary")
      .select("*")
      .maybeSingle(),
    supabase
      .from("coverage_gaps")
      .select(
        "geography_key, geography_type, label, sector_emphasis, gap_score, approved_people_count, pending_discovered_count, verified_people_count, recent_activity_30d, expected_coverage_score"
      )
      .order("gap_score", { ascending: false })
      .limit(16),
    supabase
      .from("ops_discovery_page_type_mix")
      .select("*")
      .order("pages", { ascending: false })
      .limit(6),
    supabase
      .from("ops_discovery_domain_yield")
      .select("domain, yield_score, remaining_budget_7d, candidates_approved, candidates_rejected, duplicate_rate_pct, last_approved_contact_at")
      .order("yield_score", { ascending: false })
      .limit(6),
    supabase
      .from("discovery_frontier_refills")
      .select("created_at, refill_reason, seeded_count, metadata, planned_queries")
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("ops_discovery_entity_pivots")
      .select("*")
      .order("priority_score", { ascending: false })
      .limit(6),
  ]);

  if (coverageSummaryRes.error) {
    throw new Error(`Failed to load discovery coverage summary: ${coverageSummaryRes.error.message}`);
  }
  if (coverageGapsRes.error) {
    throw new Error(`Failed to load coverage gaps: ${coverageGapsRes.error.message}`);
  }
  if (pageTypeMixRes.error) {
    throw new Error(`Failed to load page type mix: ${pageTypeMixRes.error.message}`);
  }
  if (topDomainsRes.error) {
    throw new Error(`Failed to load domain yield: ${topDomainsRes.error.message}`);
  }
  if (recentRefillsRes.error) {
    throw new Error(`Failed to load discovery refills: ${recentRefillsRes.error.message}`);
  }
  if (pivotsRes.error) {
    throw new Error(`Failed to load entity pivots: ${pivotsRes.error.message}`);
  }

  const coverageSummary = coverageSummaryRes.data;
  const gaps = coverageGapsRes.data || [];
  const metros = gaps.filter((gap) => gap.geography_type === "metro").slice(0, 6);
  const states = gaps.filter((gap) => gap.geography_type === "state").slice(0, 6);
  const topDomains = (topDomainsRes.data || []).filter((row) => Number(row.remaining_budget_7d || 0) > 0);
  const pivots = pivotsRes.data || [];

  const pivotActions: PlanningAction[] = pivots
    .filter((pivot) => Array.isArray(pivot.seed_queries) && pivot.seed_queries.length > 0)
    .slice(0, 2)
    .map((pivot) => ({
      id: `pivot:${pivot.entity_key}`,
      action_type: "entity_pivot",
      title: `Expand ${pivot.entity_name}`,
      detail: `${pivot.approved_contact_count} approved contact${pivot.approved_contact_count === 1 ? "" : "s"} and ${pivot.strong_source_count} strong evidence source${pivot.strong_source_count === 1 ? "" : "s"}.`,
      query: pivot.seed_queries[0],
      priority_score: Number(pivot.priority_score || 0),
      entity_key: pivot.entity_key,
      gap_target_key: Array.isArray(pivot.coverage_target_keys) ? pivot.coverage_target_keys[0] || null : null,
      domain: pivot.normalized_domain || null,
    }));

  const gapActions: PlanningAction[] = metros
    .slice(0, 2)
    .map((gap) => ({
      id: `gap:${gap.geography_key}`,
      action_type: "gap_refresh",
      title: `Refresh ${gap.label}`,
      detail: `Gap score ${Number(gap.gap_score || 0).toFixed(2)} with ${gap.approved_people_count || 0} approved and ${gap.pending_discovered_count || 0} pending.`,
      query: buildGapDiscoveryQuery(gap),
      priority_score: Number(gap.gap_score || 0),
      entity_key: null,
      gap_target_key: gap.geography_key,
      domain: null,
    }));

  const domainActions: PlanningAction[] = topDomains
    .slice(0, 2)
    .map((domain) => ({
      id: `domain:${domain.domain}`,
      action_type: "domain_revisit",
      title: `Revisit ${domain.domain}`,
      detail: `Yield ${Number(domain.yield_score || 0).toFixed(2)} with ${domain.remaining_budget_7d || 0} fetches left this week.`,
      query: buildDomainDiscoveryQuery(domain.domain),
      priority_score: Number(domain.yield_score || 0),
      entity_key: null,
      gap_target_key: null,
      domain: domain.domain,
    }));

  const recommendedActions = uniqueByQuery([
    ...pivotActions,
    ...gapActions,
    ...domainActions,
  ])
    .sort((a, b) => b.priority_score - a.priority_score)
    .slice(0, 6);

  return {
    generated_at: new Date().toISOString(),
    coverage_summary: coverageSummary,
    top_undercovered_metros: metros,
    priority_states: states,
    page_type_mix: pageTypeMixRes.data || [],
    top_domains: topDomains,
    recent_refills: recentRefillsRes.data || [],
    top_entity_pivots: pivots,
    recommended_actions: recommendedActions,
  };
}

async function triggerAgentRun(
  supabase: SupabaseAdminClient,
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
  supabase: SupabaseAdminClient
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
  supabase: SupabaseAdminClient
): Promise<number> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data } = await supabase
    .from("web_search_cache")
    .delete()
    .lt("searched_at", thirtyDaysAgo)
    .select("id");

  return data?.length || 0;
}
