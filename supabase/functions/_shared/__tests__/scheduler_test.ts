import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "jsr:@std/assert@^1.0.0";
import {
  planOrphanedVerificationRecovery,
  schedulerAgentTypeError,
  VERIFICATION_MAX_ATTEMPTS,
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
