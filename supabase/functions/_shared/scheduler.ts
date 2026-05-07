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
