-- Phase 8c: verify-before-promote.
-- Discovered contacts and organizations land as `queued`, get auto-enriched by
-- agent-verification, and only show approve/reject UI once verified. Contradictions
-- and atrocious-confidence rows are hard-deleted (no `needs_review` state).

-- 1. discovered_contacts: verification columns + drop needs_review from suggested scope.

ALTER TABLE public.discovered_contacts
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'queued',
  ADD COLUMN IF NOT EXISTS verification_run_id uuid REFERENCES public.agent_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS verification_payload jsonb;

ALTER TABLE public.discovered_contacts
  DROP CONSTRAINT IF EXISTS discovered_contacts_verification_status_check;

ALTER TABLE public.discovered_contacts
  ADD CONSTRAINT discovered_contacts_verification_status_check
  CHECK (verification_status IN ('queued', 'verifying', 'verified'));

-- Backfill: rows with a non-null suggested scope already had a usable signal.
UPDATE public.discovered_contacts
SET verification_status = 'verified',
    verified_at = COALESCE(verified_at, last_seen_at, created_at, now())
WHERE verification_status = 'queued'
  AND suggested_us_network_status IS NOT NULL
  AND suggested_us_network_status <> 'needs_review';

-- Rewrite legacy needs_review suggestions: contacts go back into the queue.
UPDATE public.discovered_contacts
SET suggested_us_network_status = NULL,
    verification_status = 'queued',
    verified_at = NULL
WHERE suggested_us_network_status = 'needs_review';

ALTER TABLE public.discovered_contacts
  DROP CONSTRAINT IF EXISTS discovered_contacts_suggested_us_network_status_check;

ALTER TABLE public.discovered_contacts
  ADD CONSTRAINT discovered_contacts_suggested_us_network_status_check
  CHECK (
    suggested_us_network_status IS NULL OR
    suggested_us_network_status IN ('us_based', 'us_connected_abroad')
  );

CREATE INDEX IF NOT EXISTS idx_discovered_contacts_verification_status
  ON public.discovered_contacts(verification_status);

-- 2. discovered_organizations: same treatment.

ALTER TABLE public.discovered_organizations
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'queued',
  ADD COLUMN IF NOT EXISTS verification_run_id uuid REFERENCES public.agent_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS verification_payload jsonb;

ALTER TABLE public.discovered_organizations
  DROP CONSTRAINT IF EXISTS discovered_organizations_verification_status_check;

ALTER TABLE public.discovered_organizations
  ADD CONSTRAINT discovered_organizations_verification_status_check
  CHECK (verification_status IN ('queued', 'verifying', 'verified'));

UPDATE public.discovered_organizations
SET verification_status = 'verified',
    verified_at = COALESCE(verified_at, updated_at, created_at, now())
WHERE verification_status = 'queued'
  AND suggested_us_network_status IS NOT NULL;

-- Rewrite legacy needs_review status to pending so the row re-enters verification.
UPDATE public.discovered_organizations
SET status = 'pending',
    verification_status = 'queued',
    verified_at = NULL
WHERE status = 'needs_review';

-- The original CREATE TABLE used an inline CHECK; drop any auto-named status check
-- so we can replace it without `needs_review`.
DO $$
DECLARE
  v_conname text;
BEGIN
  FOR v_conname IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.discovered_organizations'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%needs_review%'
  LOOP
    EXECUTE format('ALTER TABLE public.discovered_organizations DROP CONSTRAINT %I', v_conname);
  END LOOP;
END
$$;

ALTER TABLE public.discovered_organizations
  DROP CONSTRAINT IF EXISTS discovered_organizations_status_check;

ALTER TABLE public.discovered_organizations
  ADD CONSTRAINT discovered_organizations_status_check
  CHECK (status IN ('pending', 'approved', 'rejected'));

CREATE INDEX IF NOT EXISTS idx_discovered_organizations_verification_status
  ON public.discovered_organizations(verification_status);

-- 3. Realtime: subscribe Verification UI to live transitions.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.discovered_contacts;
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.discovered_organizations;
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    END;
  END IF;
END
$$;
