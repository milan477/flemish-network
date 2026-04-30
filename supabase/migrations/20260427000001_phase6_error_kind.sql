-- Phase 6.3 — surface real errors instead of swallowing them.
-- Adds a structured error_kind column on agent_runs so the System Health panel
-- (Phase 6.4) can group failures and the RUNBOOK can key entries off the kind.

ALTER TABLE public.agent_runs
  ADD COLUMN IF NOT EXISTS error_kind text;

-- Backfill any existing rows. Failed runs get 'unknown'; in-flight rows stay null.
UPDATE public.agent_runs
SET error_kind = 'unknown'
WHERE status = 'failed' AND error_kind IS NULL;

-- Constraint over the fixed enum. Values match HttpErrorCode in
-- supabase/functions/_shared/auth.ts so the edge layer can write them straight.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_runs_error_kind_check'
  ) THEN
    ALTER TABLE public.agent_runs
      ADD CONSTRAINT agent_runs_error_kind_check
      CHECK (
        error_kind IS NULL OR error_kind IN (
          'quota_exhausted',
          'auth_failed',
          'network',
          'db_timeout',
          'invalid_input',
          'agent_failure',
          'unknown'
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS agent_runs_error_kind_idx
  ON public.agent_runs (error_kind)
  WHERE error_kind IS NOT NULL;

COMMENT ON COLUMN public.agent_runs.error_kind IS
  'Phase 6.3 structured failure code. Set by edge functions when a run fails or the scheduler marks a zombie. Cross-references docs/RUNBOOK.md.';
