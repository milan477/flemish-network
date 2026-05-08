-- Phase 0 (Discovery Redesign): foundations.
-- Adds reject-reason taxonomy on discovered_contacts/discovered_organizations,
-- a held-out evaluation set, and a per-query attempt log so later phases
-- (bandit allocator, reflection loop) can be measured against ground truth.

-- ── 1. Reject-reason taxonomy ─────────────────────────────────────────────────

ALTER TABLE public.discovered_contacts
  ADD COLUMN IF NOT EXISTS reject_reason text,
  ADD COLUMN IF NOT EXISTS reject_reason_note text;

ALTER TABLE public.discovered_contacts
  DROP CONSTRAINT IF EXISTS discovered_contacts_reject_reason_check;

ALTER TABLE public.discovered_contacts
  ADD CONSTRAINT discovered_contacts_reject_reason_check
  CHECK (
    reject_reason IS NULL
    OR reject_reason IN (
      'not_flemish',
      'walloon_or_francophone',
      'not_us_based',
      'duplicate',
      'insufficient_evidence',
      'low_signal',
      'other'
    )
  );

ALTER TABLE public.discovered_organizations
  ADD COLUMN IF NOT EXISTS reject_reason text,
  ADD COLUMN IF NOT EXISTS reject_reason_note text;

ALTER TABLE public.discovered_organizations
  DROP CONSTRAINT IF EXISTS discovered_organizations_reject_reason_check;

ALTER TABLE public.discovered_organizations
  ADD CONSTRAINT discovered_organizations_reject_reason_check
  CHECK (
    reject_reason IS NULL
    OR reject_reason IN (
      'not_flemish_relevant',
      'not_us_present',
      'duplicate',
      'insufficient_evidence',
      'low_signal',
      'other'
    )
  );

-- ── 2. Held-out evaluation set ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.discovery_eval_holdout (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  known_aliases text[] NOT NULL DEFAULT '{}',
  known_employer text,
  known_city text,
  known_state text,
  flemish_signal text NOT NULL,
  source_note text,
  added_at timestamptz NOT NULL DEFAULT now(),
  added_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  last_seen_as_candidate_at timestamptz,
  last_seen_candidate_id uuid REFERENCES public.discovered_contacts(id) ON DELETE SET NULL,
  last_seen_run_id uuid REFERENCES public.agent_runs(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_eval_holdout_full_name
  ON public.discovery_eval_holdout (lower(full_name));

ALTER TABLE public.discovery_eval_holdout ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Editors can read discovery_eval_holdout" ON public.discovery_eval_holdout;
DROP POLICY IF EXISTS "Editors can insert discovery_eval_holdout" ON public.discovery_eval_holdout;
DROP POLICY IF EXISTS "Editors can update discovery_eval_holdout" ON public.discovery_eval_holdout;
DROP POLICY IF EXISTS "Editors can delete discovery_eval_holdout" ON public.discovery_eval_holdout;

CREATE POLICY "Editors can read discovery_eval_holdout"
  ON public.discovery_eval_holdout FOR SELECT
  TO authenticated
  USING (public.has_staff_role('editor'));

CREATE POLICY "Editors can insert discovery_eval_holdout"
  ON public.discovery_eval_holdout FOR INSERT
  TO authenticated
  WITH CHECK (public.has_staff_role('editor'));

CREATE POLICY "Editors can update discovery_eval_holdout"
  ON public.discovery_eval_holdout FOR UPDATE
  TO authenticated
  USING (public.has_staff_role('editor'))
  WITH CHECK (public.has_staff_role('editor'));

CREATE POLICY "Editors can delete discovery_eval_holdout"
  ON public.discovery_eval_holdout FOR DELETE
  TO authenticated
  USING (public.has_staff_role('admin'));

-- ── 3. Discovery query attempt log ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.discovery_query_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.agent_runs(id) ON DELETE CASCADE,
  surface text,
  lens text,
  composition_keys text[] NOT NULL DEFAULT '{}',
  query_text text NOT NULL,
  source_type text NOT NULL,
  source_pack_key text,
  pivot_entity_key text,
  provider text,
  urls_returned integer NOT NULL DEFAULT 0,
  pages_fetched integer NOT NULL DEFAULT 0,
  candidates_extracted integer NOT NULL DEFAULT 0,
  new_pending_contacts integer NOT NULL DEFAULT 0,
  contacts_later_approved integer NOT NULL DEFAULT 0,
  contacts_later_rejected integer NOT NULL DEFAULT 0,
  rejected_reason_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  cost_estimate_usd numeric(10, 4) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_query_attempts_surface_lens
  ON public.discovery_query_attempts (surface, lens);

CREATE INDEX IF NOT EXISTS idx_query_attempts_run
  ON public.discovery_query_attempts (run_id);

CREATE INDEX IF NOT EXISTS idx_query_attempts_created_at
  ON public.discovery_query_attempts (created_at DESC);

ALTER TABLE public.discovery_query_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Editors can read discovery_query_attempts" ON public.discovery_query_attempts;
DROP POLICY IF EXISTS "Editors can insert discovery_query_attempts" ON public.discovery_query_attempts;
DROP POLICY IF EXISTS "Editors can update discovery_query_attempts" ON public.discovery_query_attempts;

CREATE POLICY "Editors can read discovery_query_attempts"
  ON public.discovery_query_attempts FOR SELECT
  TO authenticated
  USING (public.has_staff_role('editor'));

-- INSERT/UPDATE happen exclusively via the service role from agent-discovery.
-- The downstream-yield attribution RPC lives in
-- 20260508000009_phase0_resolve_query_attempts_rpc.sql.
