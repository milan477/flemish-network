import { HttpError, type HttpErrorCode } from "./auth.ts";
import { createLogger } from "./log.ts";

const log = createLogger("httpError");

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, apikey, x-client-info",
};

export interface StructuredErrorBody {
  error: {
    code: HttpErrorCode;
    message: string;
    hint?: string;
  };
}

export function jsonError(
  status: number,
  code: HttpErrorCode,
  message: string,
  hint?: string,
): Response {
  const body: StructuredErrorBody = {
    error: { code, message, ...(hint ? { hint } : {}) },
  };
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function structuredErrorBody(error: unknown): StructuredErrorBody {
  if (error instanceof HttpError) {
    return {
      error: {
        code: error.code,
        message: error.message,
        ...(error.hint ? { hint: error.hint } : {}),
      },
    };
  }
  const message = error instanceof Error ? error.message : "Internal error";
  return { error: { code: "agent_failure", message } };
}

export function statusForError(error: unknown): number {
  if (error instanceof HttpError) return error.status;
  return 500;
}

export function errorKindFor(error: unknown): HttpErrorCode {
  if (error instanceof HttpError) return error.code;
  return "unknown";
}

export function agentRunErrorKindFor(
  error: unknown,
):
  | "quota_exhausted"
  | "auth_failed"
  | "network"
  | "db_timeout"
  | "invalid_input"
  | "agent_failure"
  | "unknown" {
  const code = errorKindFor(error);
  switch (code) {
    case "forbidden":
      return "auth_failed";
    case "not_found":
      return "invalid_input";
    case "quota_exhausted":
    case "auth_failed":
    case "network":
    case "db_timeout":
    case "invalid_input":
    case "agent_failure":
    case "unknown":
      return code;
  }
}

export function errorToResponse(error: unknown): Response {
  if (!(error instanceof HttpError)) {
    log.error("uncaught_error", error);
  }
  const body = structuredErrorBody(error);
  return new Response(JSON.stringify(body), {
    status: statusForError(error),
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Higher-order helper that wraps a Deno.serve handler so uncaught errors
 * produce the standardized { error: { code, message, hint? } } shape and CORS
 * preflight is handled.
 */
export function wrapHandler(
  handler: (req: Request) => Promise<Response> | Response,
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 200, headers: corsHeaders });
    }
    try {
      return await handler(req);
    } catch (error) {
      return errorToResponse(error);
    }
  };
}
