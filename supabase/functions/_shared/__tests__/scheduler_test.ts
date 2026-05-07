import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "jsr:@std/assert@^1.0.0";
import { schedulerAgentTypeError } from "../scheduler.ts";

Deno.test("schedulerAgentTypeError: connection runs return invalid_input", async () => {
  const response = schedulerAgentTypeError("connection");

  assert(response);
  assertEquals(response.status, 400);

  const body = await response.json();
  assertEquals(body.error.code, "invalid_input");
  assertStringIncludes(body.error.message, "Connection runs have been removed");
});
