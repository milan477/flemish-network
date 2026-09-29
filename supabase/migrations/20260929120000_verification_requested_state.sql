-- Durable verification queue for discovered records.
-- 'queued' means "discovered, nobody asked for verification yet". Staff
-- clicking Verify now moves a row to 'requested'; the agent-scheduler tick
-- drains 'requested' rows in small batches, so a long "Verify all" no longer
-- depends on one scheduler invocation staying alive.

ALTER TABLE public.discovered_contacts
  DROP CONSTRAINT IF EXISTS discovered_contacts_verification_status_check;
ALTER TABLE public.discovered_contacts
  ADD CONSTRAINT discovered_contacts_verification_status_check
  CHECK (verification_status IN ('queued', 'requested', 'verifying', 'verified', 'failed'));

ALTER TABLE public.discovered_organizations
  DROP CONSTRAINT IF EXISTS discovered_organizations_verification_status_check;
ALTER TABLE public.discovered_organizations
  ADD CONSTRAINT discovered_organizations_verification_status_check
  CHECK (verification_status IN ('queued', 'requested', 'verifying', 'verified', 'failed'));

CREATE INDEX IF NOT EXISTS idx_discovered_contacts_verification_requested
  ON public.discovered_contacts (created_at)
  WHERE verification_status IN ('requested', 'verifying');

CREATE INDEX IF NOT EXISTS idx_discovered_organizations_verification_requested
  ON public.discovered_organizations (created_at)
  WHERE verification_status IN ('requested', 'verifying');
