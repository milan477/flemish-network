import { jsonError } from "./httpError.ts";

export type SchedulerAgentType = "discovery" | "verification";

export const SCHEDULER_AGENT_FUNCTIONS: Record<SchedulerAgentType, string> = {
  discovery: "agent-discovery",
  verification: "agent-verify",
};

export function schedulerAgentTypeError(requestedAgentType: string): Response | null {
  if (requestedAgentType === "connection") {
    return jsonError(
      400,
      "invalid_input",
      "Connection runs have been removed. Use Discovery for database expansion and Network Growth for coverage planning.",
    );
  }

  if (
    !requestedAgentType ||
    !Object.prototype.hasOwnProperty.call(SCHEDULER_AGENT_FUNCTIONS, requestedAgentType)
  ) {
    return jsonError(
      400,
      "invalid_input",
      `Invalid agent_type. Must be one of: ${Object.keys(SCHEDULER_AGENT_FUNCTIONS).join(", ")}`,
    );
  }

  return null;
}

export const VERIFICATION_MAX_ATTEMPTS = 3;

export interface VerifyingRecord {
  id: string;
  verification_run_id: string | null;
  verification_attempts: number | null;
}

/**
 * A discovered record stuck in 'verifying' whose run is no longer pending or
 * running was abandoned (agent-verify was killed or the dispatch died). Each
 * abandonment counts as an attempt; after VERIFICATION_MAX_ATTEMPTS the record
 * becomes 'failed' so staff can retry it explicitly instead of looping forever.
 */
export function planOrphanedVerificationRecovery(
  rows: VerifyingRecord[],
  activeRunIds: Set<string>,
): { requeue: { id: string; attempts: number }[]; fail: { id: string; attempts: number }[] } {
  const requeue: { id: string; attempts: number }[] = [];
  const fail: { id: string; attempts: number }[] = [];
  for (const row of rows) {
    if (row.verification_run_id && activeRunIds.has(row.verification_run_id)) continue;
    const attempts = (row.verification_attempts ?? 0) + 1;
    if (attempts >= VERIFICATION_MAX_ATTEMPTS) fail.push({ id: row.id, attempts });
    else requeue.push({ id: row.id, attempts });
  }
  return { requeue, fail };
}

export interface VerificationBatchRun {
  status: string;
  error_kind: string | null;
  // results->quota_exhausted: a boolean, or its text form from PostgREST.
  quota_exhausted: unknown;
  // results->verified: records the batch verified before stopping.
  verified?: unknown;
  completed_at: string | null;
}

export const VERIFICATION_QUOTA_BACKOFF_BASE_MINUTES = 30;
export const VERIFICATION_QUOTA_BACKOFF_MAX_MINUTES = 180;

// A batch that verified records before a rate limit stopped it made progress:
// the limit is per minute, not a spent daily quota, so it does not count.
function isQuotaBatch(batch: VerificationBatchRun): boolean {
  if (Number(batch.verified ?? 0) > 0) return false;
  return batch.error_kind === "quota_exhausted" ||
    batch.quota_exhausted === true ||
    batch.quota_exhausted === "true";
}

/**
 * Decides whether the staff-requested verification queue should wait before
 * starting another batch. `recentBatches` are finished queue batches, newest
 * first. Each consecutive batch that hit a Gemini or web-search quota doubles
 * the pause (30, 60, 120, then 180 minutes max), measured from the newest one.
 * A batch that finished without a quota hit ends the streak, so the queue
 * recovers on its own once a probe batch succeeds. Other failures (zombies,
 * agent errors) say nothing about quota and neither extend nor end it.
 */
export function planVerificationQueueBackoff(
  recentBatches: VerificationBatchRun[],
  nowMs: number,
): { skip: boolean; backoffUntil: string | null; consecutiveQuotaBatches: number } {
  let consecutiveQuotaBatches = 0;
  let newestQuotaAtMs: number | null = null;
  for (const batch of recentBatches) {
    if (isQuotaBatch(batch)) {
      consecutiveQuotaBatches += 1;
      if (newestQuotaAtMs === null && batch.completed_at) {
        newestQuotaAtMs = Date.parse(batch.completed_at);
      }
      continue;
    }
    if (batch.status === "completed") break;
  }

  if (consecutiveQuotaBatches === 0 || newestQuotaAtMs === null) {
    return { skip: false, backoffUntil: null, consecutiveQuotaBatches: 0 };
  }

  const backoffMinutes = Math.min(
    VERIFICATION_QUOTA_BACKOFF_BASE_MINUTES * 2 ** (consecutiveQuotaBatches - 1),
    VERIFICATION_QUOTA_BACKOFF_MAX_MINUTES,
  );
  const backoffUntilMs = newestQuotaAtMs + backoffMinutes * 60_000;
  return {
    skip: nowMs < backoffUntilMs,
    backoffUntil: new Date(backoffUntilMs).toISOString(),
    consecutiveQuotaBatches,
  };
}
