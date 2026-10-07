import type { SupabaseAdminClient } from "./database.types.ts";

// Statuses claim_discovery_frontier treats as claimable once next_fetch_at is due.
const CLAIMABLE_STATUSES = ["queued", "done"];
const CLOSED_DOMAIN_STATUSES = new Set(["paused", "blocked"]);
const DEFAULT_WEEKLY_FETCH_BUDGET = 20;

interface OwnSeedCandidate {
  id: string;
  canonical_url: string;
  domain: string;
  priority_score: number | string | null;
  next_fetch_at: string | null;
  created_at: string | null;
}

interface DomainClaimPolicy {
  domain: string;
  status: string | null;
  weekly_fetch_budget: number | string | null;
  recent_fetches_7d: number | string | null;
}

// Same eligibility and order as claim_discovery_frontier: open domains under
// their weekly fetch budget, priority first, then due date and age, at most
// perDomainLimit pages per domain.
function rankOwnSeedCandidates(
  candidates: OwnSeedCandidate[],
  policies: DomainClaimPolicy[],
  limit: number,
  perDomainLimit: number,
): string[] {
  const policyByDomain = new Map(policies.map((policy) => [policy.domain, policy]));
  const open = candidates.filter((candidate) => {
    const policy = policyByDomain.get(candidate.domain);
    if (!policy) return true;
    if (CLOSED_DOMAIN_STATUSES.has(String(policy.status || "active"))) return false;
    return Number(policy.recent_fetches_7d || 0) <
      Number(policy.weekly_fetch_budget ?? DEFAULT_WEEKLY_FETCH_BUDGET);
  });

  open.sort((a, b) =>
    Number(b.priority_score || 0) - Number(a.priority_score || 0) ||
    String(a.next_fetch_at || "").localeCompare(String(b.next_fetch_at || "")) ||
    String(a.created_at || "").localeCompare(String(b.created_at || ""))
  );

  const perDomain = new Map<string, number>();
  const ids: string[] = [];
  for (const candidate of open) {
    if (ids.length >= limit) break;
    const count = perDomain.get(candidate.domain) || 0;
    if (count >= Math.max(perDomainLimit, 1)) continue;
    perDomain.set(candidate.domain, count + 1);
    ids.push(candidate.id);
  }
  return ids;
}

// Claims this run's own seed results. The conditional update is the arbiter:
// a row another run claimed after the candidate read no longer matches
// status IN ('queued','done') and is left alone.
async function claimOwnSeeds<Row extends { id: string }>(
  supabase: SupabaseAdminClient,
  options: {
    runId: string;
    batchSize: number;
    perDomainLimit: number;
    ownSeedUrls: string[];
    nowIso: string;
  },
): Promise<Row[]> {
  const urls = [...new Set(options.ownSeedUrls.filter(Boolean))];
  if (urls.length === 0 || options.batchSize <= 0) return [];

  const { data: candidates, error: candidateError } = await supabase
    .from("discovery_frontier")
    .select("id, canonical_url, domain, priority_score, next_fetch_at, created_at")
    .in("canonical_url", urls)
    .in("status", CLAIMABLE_STATUSES)
    .lte("next_fetch_at", options.nowIso);
  if (candidateError) {
    throw new Error(
      `Failed to load this run's frontier seeds: ${candidateError.message}`,
    );
  }
  const candidateRows = (candidates || []) as OwnSeedCandidate[];
  if (candidateRows.length === 0) return [];

  const { data: policies, error: policyError } = await supabase
    .from("ops_discovery_domain_yield")
    .select("domain, status, weekly_fetch_budget, recent_fetches_7d")
    .in("domain", [...new Set(candidateRows.map((row) => row.domain))]);
  if (policyError) {
    throw new Error(
      `Failed to load domain policies for seed claim: ${policyError.message}`,
    );
  }

  const ids = rankOwnSeedCandidates(
    candidateRows,
    (policies || []) as DomainClaimPolicy[],
    options.batchSize,
    options.perDomainLimit,
  );
  if (ids.length === 0) return [];

  const { data: claimed, error: claimError } = await supabase
    .from("discovery_frontier")
    .update({
      status: "fetching",
      claimed_at: options.nowIso,
      claimed_run_id: options.runId,
      updated_at: options.nowIso,
    })
    .in("id", ids)
    .in("status", CLAIMABLE_STATUSES)
    .lte("next_fetch_at", options.nowIso)
    .select("*");
  if (claimError) {
    throw new Error(`Failed to claim this run's frontier seeds: ${claimError.message}`);
  }

  const order = new Map(ids.map((id, index) => [id, index]));
  return ((claimed || []) as unknown as Row[])
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

// A prompted run first claims the frontier rows its own seed search created or
// re-queued, so leftovers from earlier runs cannot take its batch no matter
// how high their stored priority is. Remaining slots go through the shared
// claim_discovery_frontier queue. Scheduled runs pass no seed URLs and use the
// shared queue alone.
export async function claimFrontierForRun<Row extends { id: string }>(
  supabase: SupabaseAdminClient,
  options: {
    runId: string;
    batchSize: number;
    perDomainLimit: number;
    ownSeedUrls: string[];
    nowIso: string;
  },
): Promise<{ rows: Row[]; ownClaimed: number }> {
  const own = await claimOwnSeeds<Row>(supabase, options);
  const remaining = options.batchSize - own.length;
  if (remaining <= 0) return { rows: own, ownClaimed: own.length };

  const { data, error } = await supabase.rpc("claim_discovery_frontier", {
    p_run_id: options.runId,
    p_limit: remaining,
    p_per_domain_limit: options.perDomainLimit,
  });
  if (error) {
    throw new Error(`Failed to claim discovery frontier: ${error.message}`);
  }

  return {
    rows: [...own, ...((data || []) as unknown as Row[])],
    ownClaimed: own.length,
  };
}

// Background seeds score roughly 3-20; a requeued page lands mid-range.
export const HARD_STOP_REQUEUE_PRIORITY = 10;
const HARD_STOP_RETRY_HOURS = 6;
const HARD_STOP_MAX_RETRY_HOURS = 24 * 7;

// A page still running at the run's hard stop goes back to the queue at a
// normal priority with a growing delay, so one slow page cannot be claimed
// first by every following run.
export function hardStopRequeuePatch(
  frontier: {
    priority_score: number | string | null;
    fetch_error_count: number | null;
  },
  nowMs: number,
): Record<string, unknown> {
  const attempts = Number(frontier.fetch_error_count || 0) + 1;
  const retryHours = Math.min(
    HARD_STOP_RETRY_HOURS * attempts,
    HARD_STOP_MAX_RETRY_HOURS,
  );
  return {
    status: "queued",
    claimed_at: null,
    claimed_run_id: null,
    priority_score: Math.min(
      Number(frontier.priority_score || 0),
      HARD_STOP_REQUEUE_PRIORITY,
    ),
    fetch_error_count: attempts,
    last_extraction_outcome: "hard_stop",
    next_fetch_at: new Date(nowMs + retryHours * 3_600_000).toISOString(),
  };
}
