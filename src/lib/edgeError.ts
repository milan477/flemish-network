/**
 * Phase 6.3 — preserve structured edge function errors on the client.
 *
 * Edge functions return `{ error: { code, message, hint? } }` on failure.
 * supabase-js v2 surfaces non-2xx responses as a `FunctionsHttpError` whose
 * `.context` is the raw `Response`. We unwrap that here so callers can throw
 * an `EdgeFunctionError` carrying the same `code`/`hint` rather than a flat
 * string, and admin surfaces can render `error.hint` directly.
 */

export type EdgeErrorCode =
  | 'auth_failed'
  | 'forbidden'
  | 'invalid_input'
  | 'not_found'
  | 'quota_exhausted'
  | 'network'
  | 'db_timeout'
  | 'agent_failure'
  | 'unknown';

export class EdgeFunctionError extends Error {
  code: EdgeErrorCode;
  hint?: string;

  constructor(message: string, code: string = 'unknown', hint?: string) {
    super(message);
    this.name = 'EdgeFunctionError';
    this.code = (code as EdgeErrorCode) || 'unknown';
    this.hint = hint;
  }
}

export async function extractEdgeError(
  raw: unknown,
  fallbackMessage = 'Edge function failed'
): Promise<EdgeFunctionError> {
  // supabase-js v2 FunctionsHttpError shape: { context: Response, message: string }
  const ctx = (raw as { context?: Response } | null)?.context;
  if (ctx && typeof ctx.text === 'function') {
    try {
      const text = await ctx.text();
      if (text) {
        try {
          const parsed = JSON.parse(text);
          if (parsed && typeof parsed === 'object' && parsed.error && typeof parsed.error === 'object') {
            return new EdgeFunctionError(
              String(parsed.error.message || fallbackMessage),
              String(parsed.error.code || 'unknown'),
              parsed.error.hint ? String(parsed.error.hint) : undefined
            );
          }
          if (parsed && typeof parsed.error === 'string') {
            return new EdgeFunctionError(parsed.error);
          }
        } catch {
          // Body was not JSON — fall through to message-based.
        }
      }
    } catch {
      // Reading the body failed — fall through.
    }
  }

  const message =
    raw instanceof Error
      ? raw.message
      : typeof raw === 'string'
      ? raw
      : fallbackMessage;
  return new EdgeFunctionError(message);
}

export function describeError(error: unknown): {
  message: string;
  code?: string;
  hint?: string;
} {
  if (error instanceof EdgeFunctionError) {
    return { message: error.message, code: error.code, hint: error.hint };
  }
  if (error instanceof Error) {
    return { message: error.message };
  }
  if (error && typeof error === 'object' && 'message' in error) {
    const row = error as { message?: unknown; code?: unknown; hint?: unknown };
    return {
      message: typeof row.message === 'string' ? row.message : 'Unknown error',
      code: typeof row.code === 'string' ? row.code : undefined,
      hint: typeof row.hint === 'string' ? row.hint : undefined,
    };
  }
  return { message: 'Unknown error' };
}
