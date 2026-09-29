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
