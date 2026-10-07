/**
 * Plain-language next steps for structured `error_kind` codes, shown to staff
 * on failure cards. docs/RUNBOOK.md holds the full engineering detail; staff
 * cannot open repository docs from the app, so the UI never links there.
 */
const FAILURE_HINTS: Record<string, string> = {
  db_timeout:
    'The run stopped responding and was closed automatically. Queued records are picked up again on the next cycle.',
  network:
    'A connection to an outside service failed. Retry once; if it keeps failing, contact engineering.',
  auth_failed: 'Your session was not accepted. Reload the page or sign in again.',
  quota_exhausted:
    'An AI or search service reached its usage limit. Wait a few minutes; queued verification records are retried automatically.',
  agent_failure:
    'A step in this run failed. Retry once; if the same step fails again, contact engineering with this run.',
};

const DEFAULT_HINT = 'If this keeps happening, contact engineering with this run.';

export function staffFailureHint(code: string | null | undefined): string {
  return (code && FAILURE_HINTS[code]) || DEFAULT_HINT;
}
