import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  createAdminClient,
  HttpError,
  requireStaffRole,
} from "../_shared/auth.ts";
import { errorToResponse, jsonError, wrapHandler } from "../_shared/httpError.ts";
import type { SupabaseAdminClient } from "../_shared/database.types.ts";
import { EMBEDDING_MODEL } from "../_shared/embeddings.ts";
import { getGeminiModelSummary } from "../_shared/gemini.ts";
import { createLogger } from "../_shared/log.ts";
import {
  SCHEDULER_AGENT_FUNCTIONS,
  schedulerAgentTypeError,
  type SchedulerAgentType,
} from "../_shared/scheduler.ts";
import { refreshArmStats } from "../_shared/banditAllocator.ts";

const log = createLogger("agent-scheduler");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, apikey, x-client-info",
};

type SchedulerAction = "trigger" | "cancel" | "housekeeping" | "planning" | "metrics";

Deno.serve(wrapHandler(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    if (!supabaseUrl) {
      throw new HttpError(500, "Missing SUPABASE_URL");
    }

    const supabase = createAdminClient();
    await requireStaffRole(req, supabase, "editor");

    const body = req.method === "POST" ? await req.json() : {};
    const action = (body.action as SchedulerAction | undefined) || "trigger";

    if (!["trigger", "cancel", "housekeeping", "planning", "metrics"].includes(action)) {
      return jsonError(
        400,
        "invalid_input",
        "Invalid action. Must be one of: trigger, cancel, housekeeping, planning, metrics",
      );
    }

    const housekeeping = await runHousekeeping(supabase, supabaseUrl, req);

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

    if (action === "metrics") {
      const metrics = await loadOpsMetrics(supabase);
      return jsonResponse({
        status: "ok",
        housekeeping,
        metrics,
      });
    }

    if (action === "cancel") {
      const runId = typeof body.run_id === "string" ? body.run_id : "";
      if (!runId) {
        return jsonError(400, "invalid_input", "run_id is required for cancel");
      }

      const { data: cancelledRun, error: cancelError } = await supabase
        .from("agent_runs")
        .update({
          status: "failed",
          completed_at: new Date().toISOString(),
          error_message: "Cancelled by user",
          error_kind: "agent_failure",
        })
        .eq("id", runId)
        .in("status", ["pending", "running"])
        .select("id, status")
        .maybeSingle();

      if (cancelError) {
        return jsonError(500, "agent_failure", `Failed to cancel run: ${cancelError.message}`);
      }

      return jsonResponse({
        status: cancelledRun ? "cancelled" : "noop",
        run_id: runId,
        housekeeping,
      });
    }

    const requestedAgentType = typeof body.agent_type === "string" ? body.agent_type : "";
    const params = body.params || {};

    const agentTypeError = schedulerAgentTypeError(requestedAgentType);
    if (agentTypeError) {
      return agentTypeError;
    }

    const agentType = requestedAgentType as SchedulerAgentType;

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
    return errorToResponse(err);
  }
}));

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function runHousekeeping(
  supabase: SupabaseAdminClient,
  supabaseUrl?: string,
  req?: Request,
): Promise<{
  zombies_marked_failed: number;
  cache_entries_purged: number;
  pivots_upserted: number;
  pending_contacts_pre_filtered: number;
  pending_organizations_pre_filtered: number;
  pending_contacts_enqueued: number;
  pending_organizations_enqueued: number;
  arm_stats_refreshed: number;
  reflection_triggered: boolean;
}> {
  const [zombiesMarked, cacheEntriesPurged, pivotsUpserted, verifyEnqueue, armStatsResult] =
    await Promise.all([
      markZombieRuns(supabase),
      purgeExpiredCache(supabase),
      rebuildEntityPivots(supabase),
      autoEnqueueDiscoveredVerification(supabase, supabaseUrl, req),
      refreshArmStats(supabase).catch((err) => {
        log.warn("arm_stats_refresh_failed", err instanceof Error ? err.message : String(err));
        return { arms_refreshed: 0 };
      }),
    ]);

  // Daily reflection: trigger agent-discovery-reflect once per day.
  // We check if there are any active suggestions generated in the last 24 hours;
  // if not, fire the reflection function in the background.
  let reflectionTriggered = false;
  if (supabaseUrl && req) {
    reflectionTriggered = await triggerDailyReflection(supabase, supabaseUrl, req);
  }

  return {
    zombies_marked_failed: zombiesMarked,
    cache_entries_purged: cacheEntriesPurged,
    pivots_upserted: pivotsUpserted,
    pending_contacts_pre_filtered: verifyEnqueue.contacts_pre_filtered,
    pending_organizations_pre_filtered: verifyEnqueue.organizations_pre_filtered,
    pending_contacts_enqueued: verifyEnqueue.contacts_enqueued,
    pending_organizations_enqueued: verifyEnqueue.organizations_enqueued,
    arm_stats_refreshed: armStatsResult.arms_refreshed,
    reflection_triggered: reflectionTriggered,
  };
}

/**
 * Trigger the daily reflection function if no fresh suggestions exist from the last 24 hours.
 * Fires agent-discovery-reflect in the background (fire-and-forget) to avoid blocking housekeeping.
 */
async function triggerDailyReflection(
  supabase: SupabaseAdminClient,
  supabaseUrl: string,
  req: Request,
): Promise<boolean> {
  try {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // Check if a reflection already ran today.
    const { data: recentSuggestions } = await supabase
      .from("discovery_reflection_suggestions")
      .select("id")
      .gte("generated_at", oneDayAgo)
      .limit(1);

    if (recentSuggestions && recentSuggestions.length > 0) {
      // Already ran today.
      return false;
    }

    const forwardedAuth = req.headers.get("Authorization") || req.headers.get("authorization");
    const forwardedApiKey = req.headers.get("apikey") || req.headers.get("Apikey");

    if (!forwardedAuth && !forwardedApiKey) {
      log.warn("reflection_trigger_skipped", "No auth headers available");
      return false;
    }

    const dispatchHeaders: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (forwardedAuth) {
      dispatchHeaders.Authorization = forwardedAuth;
    } else if (forwardedApiKey) {
      dispatchHeaders.Authorization = `Bearer ${forwardedApiKey}`;
    }
    if (forwardedApiKey) {
      dispatchHeaders.apikey = forwardedApiKey;
    }

    // Fire-and-forget: do not await so housekeeping stays fast.
    fetch(`${supabaseUrl}/functions/v1/agent-discovery-reflect`, {
      method: "POST",
      headers: dispatchHeaders,
      body: JSON.stringify({}),
    }).catch((err) => {
      log.warn("reflection_dispatch_failed", err instanceof Error ? err.message : String(err));
    });

    return true;
  } catch (err) {
    log.warn("reflection_trigger_error", err instanceof Error ? err.message : String(err));
    return false;
  }
}

const AUTO_VERIFY_BATCH_SIZE = 5;
const AUTO_VERIFY_MIN_CONFIDENCE = 0.05;

async function autoEnqueueDiscoveredVerification(
  supabase: SupabaseAdminClient,
  supabaseUrl?: string,
  req?: Request,
): Promise<{
  contacts_pre_filtered: number;
  organizations_pre_filtered: number;
  contacts_enqueued: number;
  organizations_enqueued: number;
}> {
  // Pre-filter: hard-delete atrocious-confidence queued rows.
  const { data: deletedContacts } = await supabase
    .from("discovered_contacts")
    .delete()
    .eq("verification_status", "queued")
    .lt("discovery_confidence", AUTO_VERIFY_MIN_CONFIDENCE)
    .select("id");

  const { data: deletedOrgs } = await supabase
    .from("discovered_organizations")
    .delete()
    .eq("verification_status", "queued")
    .lt("confidence", AUTO_VERIFY_MIN_CONFIDENCE)
    .select("id");

  const contactsPreFiltered = (deletedContacts ?? []).length;
  const orgsPreFiltered = (deletedOrgs ?? []).length;

  let contactsEnqueued = 0;
  let orgsEnqueued = 0;

  if (supabaseUrl && req) {
    contactsEnqueued = await enqueueVerificationBatch(
      supabase,
      supabaseUrl,
      req,
      "discovered_contact",
      "discovered_contacts",
    );
    orgsEnqueued = await enqueueVerificationBatch(
      supabase,
      supabaseUrl,
      req,
      "discovered_organization",
      "discovered_organizations",
    );
  }

  return {
    contacts_pre_filtered: contactsPreFiltered,
    organizations_pre_filtered: orgsPreFiltered,
    contacts_enqueued: contactsEnqueued,
    organizations_enqueued: orgsEnqueued,
  };
}

async function enqueueVerificationBatch(
  supabase: SupabaseAdminClient,
  supabaseUrl: string,
  req: Request,
  recordKind: "discovered_contact" | "discovered_organization",
  tableName: "discovered_contacts" | "discovered_organizations",
): Promise<number> {
  const { data: queued, error } = await supabase
    .from(tableName)
    .select("id")
    .eq("verification_status", "queued")
    .order("created_at", { ascending: true })
    .limit(AUTO_VERIFY_BATCH_SIZE);

  if (error || !queued || queued.length === 0) return 0;

  const recordIds = queued.map((row) => row.id);

  // Create the agent_runs row up-front so we can dedupe future enqueues.
  const { data: run, error: runError } = await supabase
    .from("agent_runs")
    .insert({
      agent_type: "verification",
      status: "running",
      started_at: new Date().toISOString(),
      heartbeat_at: new Date().toISOString(),
      params: {
        record_type: recordKind,
        record_ids: recordIds,
        auto_enqueued: true,
      },
    })
    .select("id")
    .single();

  if (runError || !run) {
    log.warn("auto_verify_run_insert_failed", runError?.message ?? "no run");
    return 0;
  }

  // Mark rows as 'verifying' immediately so the next housekeeping tick doesn't re-enqueue them.
  await supabase
    .from(tableName)
    .update({ verification_status: "verifying", verification_run_id: run.id })
    .in("id", recordIds);

  const forwardedAuth = req.headers.get("Authorization") || req.headers.get("authorization");
  const forwardedApiKey = req.headers.get("apikey") || req.headers.get("Apikey");

  if (!forwardedAuth) {
    // Without staff auth we can't dispatch. Reset rows so a future caller can pick them up.
    await supabase
      .from(tableName)
      .update({ verification_status: "queued", verification_run_id: null })
      .in("id", recordIds);
    return 0;
  }

  const dispatchHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: forwardedAuth,
  };
  if (forwardedApiKey) dispatchHeaders.apikey = forwardedApiKey;

  fetch(`${supabaseUrl}/functions/v1/agent-verify`, {
    method: "POST",
    headers: dispatchHeaders,
    body: JSON.stringify({
      record_type: recordKind,
      record_ids: recordIds,
      run_id: run.id,
    }),
  }).catch(async (dispatchError) => {
    log.withRun(run.id).warn("auto_verify_dispatch_failed", dispatchError);
    await supabase
      .from("agent_runs")
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
        error_message: "Failed to dispatch auto-verification",
        error_kind: "network",
      })
      .eq("id", run.id);
    await supabase
      .from(tableName)
      .update({ verification_status: "queued", verification_run_id: null })
      .in("id", recordIds);
  });

  return recordIds.length;
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
  // Rubric fields
  rationale: string;
  basis: {
    kind: "coverage_gap" | "entity_pivot" | "proven_domain";
    key: string;
  };
  target: {
    metro?: string;
    state?: string;
    sector?: string;
    domain?: string;
    entity?: string;
  };
  expected_yield: "high" | "medium" | "low";
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
  geography_type?: string;
  sector_emphasis?: string[] | null;
}): string {
  const sector = pickPrimarySector(gap.sector_emphasis);
  // Template: (Belgian OR Flemish) ${sector} ${metro/state}
  const parts: string[] = ["(Belgian OR Flemish)"];
  if (sector) parts.push(sector);
  parts.push(gap.label);
  return parts.join(" ");
}

function buildEntityPivotQuery(domain: string | null, entityName: string): string {
  // Template: site:${domain} ${entityName} (Belgian OR Flemish OR Vlaams)
  if (domain) {
    return `site:${domain} ${entityName} (Belgian OR Flemish OR Vlaams)`;
  }
  return `${entityName} (Belgian OR Flemish OR Vlaams) team OR faculty OR people`;
}

function buildDomainDiscoveryQuery(domain: string): string {
  // Template: site:${domain} (Belgian OR Flemish OR Vlaams) team OR faculty OR people
  return `site:${domain} (Belgian OR Flemish OR Vlaams) team OR faculty OR people`;
}

function deriveYieldFromScore(yieldScore: number): "high" | "medium" | "low" {
  if (yieldScore > 0.6) return "high";
  if (yieldScore > 0.3) return "medium";
  return "low";
}

function deriveYieldFromEvidenceCount(count: number): "high" | "medium" | "low" {
  if (count >= 3) return "high";
  if (count >= 1) return "medium";
  return "low";
}

async function loadDiscoveryPlanning(
  supabase: SupabaseAdminClient,
): Promise<Record<string, unknown>> {
  // 72-hour cooldown: pivots and gaps recommended within this window are skipped.
  const cooldownCutoff = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();

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
        "geography_key, geography_type, label, sector_emphasis, gap_score, approved_people_count, pending_discovered_count, verified_people_count, recent_activity_30d, expected_coverage_score, last_recommended_at, recommended_count"
      )
      .or(`last_recommended_at.is.null,last_recommended_at.lt.${cooldownCutoff}`)
      .order("gap_score", { ascending: false })
      .limit(16),
    supabase
      .from("ops_discovery_page_type_mix")
      .select("*")
      .order("pages", { ascending: false })
      .limit(6),
    supabase
      .from("ops_discovery_domain_yield")
      .select("domain, status, yield_score, remaining_budget_7d, candidates_approved, candidates_rejected, duplicate_rate_pct, last_approved_contact_at")
      .neq("status", "exhausted")
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
      .or(`last_recommended_at.is.null,last_recommended_at.lt.${cooldownCutoff}`)
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
    .map((pivot) => {
      const domain = pivot.normalized_domain || null;
      const entityName = pivot.entity_name as string;
      const approvedCount = Number(pivot.approved_contact_count || 0);
      const strongCount = Number(pivot.strong_source_count || 0);
      return {
        id: `pivot:${pivot.entity_key}`,
        action_type: "entity_pivot" as const,
        title: `Expand ${entityName}`,
        detail: `${approvedCount} approved contact${approvedCount === 1 ? "" : "s"} and ${strongCount} strong evidence source${strongCount === 1 ? "" : "s"}.`,
        query: buildEntityPivotQuery(domain, entityName),
        priority_score: Number(pivot.priority_score || 0),
        entity_key: pivot.entity_key,
        gap_target_key: Array.isArray(pivot.coverage_target_keys) ? pivot.coverage_target_keys[0] || null : null,
        domain,
        rationale: `${entityName} has ${approvedCount} approved contact${approvedCount === 1 ? "" : "s"} and ${strongCount} strong evidence source${strongCount === 1 ? "" : "s"} — expanding it may surface additional connected Flemish profiles.`,
        basis: {
          kind: "entity_pivot" as const,
          key: entityName,
        },
        target: {
          entity: entityName,
          ...(domain ? { domain } : {}),
        },
        expected_yield: deriveYieldFromEvidenceCount(approvedCount),
      };
    });

  const gapActions: PlanningAction[] = metros
    .map((gap) => {
      const sector = pickPrimarySector(gap.sector_emphasis);
      const gapScore = Number(gap.gap_score || 0);
      return {
        id: `gap:${gap.geography_key}`,
        action_type: "gap_refresh" as const,
        title: `Refresh ${gap.label}`,
        detail: `Gap score ${gapScore.toFixed(2)} with ${gap.approved_people_count || 0} approved and ${gap.pending_discovered_count || 0} pending.`,
        query: buildGapDiscoveryQuery(gap),
        priority_score: gapScore,
        entity_key: null,
        gap_target_key: gap.geography_key,
        domain: null,
        rationale: `${gap.label} has a gap score of ${gapScore.toFixed(2)}${sector ? ` with emphasis on ${sector}` : ""}, indicating underrepresentation relative to expected coverage.`,
        basis: {
          kind: "coverage_gap" as const,
          key: gap.geography_key,
        },
        target: {
          ...(gap.geography_type === "metro" ? { metro: gap.label } : { state: gap.label }),
          ...(sector ? { sector } : {}),
        },
        expected_yield: deriveYieldFromScore(gapScore),
      };
    });

  const domainActions: PlanningAction[] = topDomains
    .map((domainRow) => {
      const yieldScore = Number(domainRow.yield_score || 0);
      const approvedCount = Number(domainRow.candidates_approved || 0);
      return {
        id: `domain:${domainRow.domain}`,
        action_type: "domain_revisit" as const,
        title: `Revisit ${domainRow.domain}`,
        detail: `Yield ${yieldScore.toFixed(2)} with ${domainRow.remaining_budget_7d || 0} fetches left this week.`,
        query: buildDomainDiscoveryQuery(domainRow.domain),
        priority_score: yieldScore,
        entity_key: null,
        gap_target_key: null,
        domain: domainRow.domain,
        rationale: `${domainRow.domain} has yielded ${approvedCount} approved contact${approvedCount === 1 ? "" : "s"} and still has remaining weekly budget — revisiting it may surface untapped pages.`,
        basis: {
          kind: "proven_domain" as const,
          key: domainRow.domain,
        },
        target: {
          domain: domainRow.domain,
        },
        expected_yield: deriveYieldFromScore(yieldScore),
      };
    });

  // Apply diversity cap: ≤2 per domain, ≤2 per metro, sorted by priority_score
  const allActions = uniqueByQuery([
    ...pivotActions,
    ...gapActions,
    ...domainActions,
  ]).sort((a, b) => b.priority_score - a.priority_score);

  const domainCounts = new Map<string, number>();
  const metroCounts = new Map<string, number>();
  const recommendedActions: PlanningAction[] = [];

  for (const action of allActions) {
    if (recommendedActions.length >= 6) break;

    // Enforce ≤2 per domain
    if (action.domain) {
      const domainCount = domainCounts.get(action.domain) || 0;
      if (domainCount >= 2) continue;
      domainCounts.set(action.domain, domainCount + 1);
    }

    // Enforce ≤2 per metro
    const metro = action.target?.metro;
    if (metro) {
      const metroCount = metroCounts.get(metro) || 0;
      if (metroCount >= 2) continue;
      metroCounts.set(metro, metroCount + 1);
    }

    recommendedActions.push(action);
  }

  // Mark recommended pivots and gaps so the 72-hour cooldown applies on the
  // next planning call. Failures are non-fatal — a missed mark just means the
  // same item could be returned again sooner than intended.
  // supabase-js v2 does not support server-side increment expressions, so we
  // select the current count then write the incremented value. Planning is
  // called infrequently enough that this race window is acceptable.
  await Promise.allSettled(
    recommendedActions.map(async (action) => {
      try {
        if (action.basis.kind === "entity_pivot") {
          const { data: pivot } = await supabase
            .from("discovery_entity_pivots")
            .select("recommended_count")
            .eq("entity_key", action.basis.key)
            .maybeSingle();
          const currentCount = Number(pivot?.recommended_count ?? 0);
          await supabase
            .from("discovery_entity_pivots")
            .update({
              last_recommended_at: new Date().toISOString(),
              recommended_count: currentCount + 1,
            })
            .eq("entity_key", action.basis.key);
        } else if (action.basis.kind === "coverage_gap") {
          const { data: target } = await supabase
            .from("coverage_targets")
            .select("recommended_count")
            .eq("geography_key", action.basis.key)
            .maybeSingle();
          const currentCount = Number(target?.recommended_count ?? 0);
          await supabase
            .from("coverage_targets")
            .update({
              last_recommended_at: new Date().toISOString(),
              recommended_count: currentCount + 1,
            })
            .eq("geography_key", action.basis.key);
        }
      } catch {
        // Non-fatal: cooldown marking is best-effort.
      }
    })
  );

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

async function loadOpsMetrics(
  supabase: SupabaseAdminClient,
): Promise<Record<string, unknown>> {
  const [metricsRes, searchBenchmarksRes, discoverySourcesRes] = await Promise.all([
    supabase
      .from("ops_phase_success_metrics")
      .select("metric_key, metric_value, unit, description"),
    supabase
      .from("ops_search_benchmark_clicks")
      .select("slug, query_text, intent, click_count, unique_people_clicked, last_clicked_at")
      .order("query_text", { ascending: true }),
    supabase
      .from("ops_benchmark_discovery_source_coverage")
      .select("slug, label, source_family, approved_contacts, rejected_contacts, last_reviewed_at")
      .order("approved_contacts", { ascending: false })
      .order("label", { ascending: true }),
  ]);

  if (metricsRes.error) {
    throw new Error(`Failed to load phase success metrics: ${metricsRes.error.message}`);
  }
  if (searchBenchmarksRes.error) {
    throw new Error(`Failed to load search benchmark metrics: ${searchBenchmarksRes.error.message}`);
  }
  if (discoverySourcesRes.error) {
    throw new Error(`Failed to load discovery source metrics: ${discoverySourcesRes.error.message}`);
  }

  return {
    generated_at: new Date().toISOString(),
    model_defaults: {
      ...getGeminiModelSummary(),
      embedding_model: EMBEDDING_MODEL,
    },
    phase_metrics: metricsRes.data || [],
    search_benchmarks: searchBenchmarksRes.data || [],
    discovery_sources: discoverySourcesRes.data || [],
  };
}

async function triggerAgentRun(
  supabase: SupabaseAdminClient,
  supabaseUrl: string,
  req: Request,
  agentType: SchedulerAgentType,
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

  const functionName = SCHEDULER_AGENT_FUNCTIONS[agentType];
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
  }).catch(async (dispatchError) => {
    log.withRun(runId).warn("downstream_dispatch_failed", dispatchError);
    await supabase
      .from("agent_runs")
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
        error_message: "Failed to dispatch to agent function",
        error_kind: "network",
      })
      .eq("id", runId);
  });

  return runId;
}

/**
 * Daily pivot rebuild: upserts entity pivots from approved people's Flemish
 * connections where 2 or more approved people share the same connection.
 * This should be called daily via action: 'housekeeping' or an external cron.
 * Existing pivot rows are updated to refresh last_seen_at; cooldown fields
 * (last_recommended_at, recommended_count) are intentionally left unchanged
 * so the rebuild does not reset the cooldown window.
 */
async function rebuildEntityPivots(
  supabase: SupabaseAdminClient
): Promise<number> {
  try {
    // Find canonical Flemish entities that appear on 2+ approved people.
    const { data: candidates, error } = await supabase
      .from("person_flemish_connections")
      .select(
        "flemish_connection_id, flemish_connections!inner(id, name, normalized_name, entity_type)"
      )
      .not("person_id", "is", null);

    if (error || !candidates) {
      log.warn("pivot_rebuild_query_failed", error?.message ?? "no data");
      return 0;
    }

    // Count occurrences per flemish_connection_id.
    const counts = new Map<string, { name: string; normalized_name: string; entity_type: string; count: number }>();
    for (const row of candidates) {
      const fc = (row as Record<string, unknown>).flemish_connections as {
        id: string;
        name: string;
        normalized_name: string;
        entity_type: string;
      } | null;
      if (!fc) continue;
      const existing = counts.get(fc.id);
      if (existing) {
        existing.count += 1;
      } else {
        counts.set(fc.id, {
          name: fc.name,
          normalized_name: fc.normalized_name,
          entity_type: fc.entity_type ?? "organization",
          count: 1,
        });
      }
    }

    // Keep only those with count >= 2.
    const eligible = Array.from(counts.entries()).filter(([, v]) => v.count >= 2);
    if (eligible.length === 0) return 0;

    let upserted = 0;
    const now = new Date().toISOString();

    for (const [, info] of eligible) {
      const entityKey = `flemish:${info.normalized_name}`;
      const entityType = ["organization", "lab", "fellowship", "advisory_board", "event", "association", "institution"].includes(info.entity_type)
        ? info.entity_type as "organization" | "lab" | "fellowship" | "advisory_board" | "event" | "association" | "institution"
        : "organization";

      // Upsert: insert on new key, update last_seen_at on existing.
      // Do NOT update last_recommended_at or recommended_count.
      const { error: upsertError } = await supabase
        .from("discovery_entity_pivots")
        .upsert(
          {
            entity_key: entityKey,
            entity_name: info.name,
            entity_type: entityType,
            last_seen_at: now,
          },
          {
            onConflict: "entity_key",
            ignoreDuplicates: false,
          }
        );

      if (upsertError) {
        log.warn("pivot_upsert_failed", upsertError.message);
      } else {
        upserted += 1;
      }
    }

    return upserted;
  } catch (err) {
    log.warn("pivot_rebuild_failed", err instanceof Error ? err.message : String(err));
    return 0;
  }
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
      error_kind: "db_timeout",
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
