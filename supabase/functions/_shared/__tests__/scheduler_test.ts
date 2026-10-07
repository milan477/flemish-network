import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "jsr:@std/assert@^1.0.0";
import {
  planOrphanedVerificationRecovery,
  planVerificationQueueBackoff,
  schedulerAgentTypeError,
  VERIFICATION_MAX_ATTEMPTS,
  type VerificationBatchRun,
} from "../scheduler.ts";

Deno.test("schedulerAgentTypeError: connection runs return invalid_input", async () => {
  const response = schedulerAgentTypeError("connection");

  assert(response);
  assertEquals(response.status, 400);

  const body = await response.json();
  assertEquals(body.error.code, "invalid_input");
  assertStringIncludes(body.error.message, "Connection runs have been removed");
});

Deno.test("planOrphanedVerificationRecovery: rows of active runs are left alone", () => {
  const plan = planOrphanedVerificationRecovery(
    [{ id: "a", verification_run_id: "run-1", verification_attempts: 0 }],
    new Set(["run-1"]),
  );
  assertEquals(plan, { requeue: [], fail: [] });
});

Deno.test("planOrphanedVerificationRecovery: abandoned rows are requeued with one more attempt", () => {
  const plan = planOrphanedVerificationRecovery(
    [
      { id: "a", verification_run_id: "dead-run", verification_attempts: 0 },
      { id: "b", verification_run_id: null, verification_attempts: null },
    ],
    new Set(["run-1"]),
  );
  assertEquals(plan.requeue, [{ id: "a", attempts: 1 }, { id: "b", attempts: 1 }]);
  assertEquals(plan.fail, []);
});

Deno.test("planOrphanedVerificationRecovery: third abandonment marks the row failed", () => {
  const plan = planOrphanedVerificationRecovery(
    [{ id: "a", verification_run_id: "dead-run", verification_attempts: VERIFICATION_MAX_ATTEMPTS - 1 }],
    new Set(),
  );
  assertEquals(plan.requeue, []);
  assertEquals(plan.fail, [{ id: "a", attempts: VERIFICATION_MAX_ATTEMPTS }]);
});

const TICK = Date.parse("2026-10-07T19:10:00.000Z");
const minutesAgo = (minutes: number) => new Date(TICK - minutes * 60_000).toISOString();
const quotaFailed = (minutes: number): VerificationBatchRun => ({
  status: "failed",
  error_kind: "quota_exhausted",
  quota_exhausted: "true",
  completed_at: minutesAgo(minutes),
});
const quotaCompleted = (minutes: number): VerificationBatchRun => ({
  status: "completed",
  error_kind: null,
  quota_exhausted: true,
  completed_at: minutesAgo(minutes),
});
const succeeded = (minutes: number): VerificationBatchRun => ({
  status: "completed",
  error_kind: null,
  quota_exhausted: "false",
  completed_at: minutesAgo(minutes),
});
const zombie = (minutes: number): VerificationBatchRun => ({
  status: "failed",
  error_kind: "db_timeout",
  quota_exhausted: null,
  completed_at: minutesAgo(minutes),
});

Deno.test("planVerificationQueueBackoff: no recent quota failure means drain normally", () => {
  assertEquals(planVerificationQueueBackoff([], TICK), {
    skip: false,
    backoffUntil: null,
    consecutiveQuotaBatches: 0,
  });
  assertEquals(planVerificationQueueBackoff([succeeded(4), quotaFailed(9)], TICK).skip, false);
});

Deno.test("planVerificationQueueBackoff: one quota batch pauses the drain for 30 minutes", () => {
  const plan = planVerificationQueueBackoff([quotaCompleted(10)], TICK);
  assertEquals(plan.skip, true);
  assertEquals(plan.consecutiveQuotaBatches, 1);
  assertEquals(plan.backoffUntil, minutesAgo(10 - 30));
  assertEquals(planVerificationQueueBackoff([quotaCompleted(31)], TICK).skip, false);
});

Deno.test("planVerificationQueueBackoff: consecutive quota batches double the pause up to 3 hours", () => {
  assertEquals(
    planVerificationQueueBackoff([quotaFailed(5), quotaFailed(10)], TICK).backoffUntil,
    minutesAgo(5 - 60),
  );
  assertEquals(
    planVerificationQueueBackoff([quotaFailed(5), quotaFailed(10), quotaFailed(15)], TICK).backoffUntil,
    minutesAgo(5 - 120),
  );
  // The 2026-10-07 incident: five quota failures in a row, with a zombie run in between
  // that says nothing about quota.
  const incident = planVerificationQueueBackoff(
    [quotaFailed(5), quotaFailed(10), quotaFailed(15), quotaFailed(20), quotaFailed(25), zombie(28), succeeded(30)],
    TICK,
  );
  assertEquals(incident.consecutiveQuotaBatches, 5);
  assertEquals(incident.backoffUntil, minutesAgo(5 - 180));
  assertEquals(incident.skip, true);
});

Deno.test("planVerificationQueueBackoff: a quota stop after verifying records keeps draining", () => {
  // 2026-10-07 18:38 and 18:40: each batch verified one record, then hit the
  // per-minute limit and returned the rest. That is progress, not a dead quota.
  const progressed: VerificationBatchRun = { ...quotaCompleted(4), verified: 1 };
  const plan = planVerificationQueueBackoff([progressed, quotaFailed(10)], TICK);
  assertEquals(plan.skip, false);
  assertEquals(plan.consecutiveQuotaBatches, 0);
});

Deno.test("planVerificationQueueBackoff: a successful batch ends the backoff", () => {
  const plan = planVerificationQueueBackoff(
    [succeeded(1), quotaFailed(5), quotaFailed(10), quotaFailed(15)],
    TICK,
  );
  assertEquals(plan, { skip: false, backoffUntil: null, consecutiveQuotaBatches: 0 });
});
