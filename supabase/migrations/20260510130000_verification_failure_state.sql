-- Verification dispatch failure handling
-- Adds `verification_attempts` counter and 'failed' state so chronically
-- failing rows escalate rather than silently re-queueing forever.

ALTER TABLE public.discovered_contacts
  ADD COLUMN IF NOT EXISTS verification_attempts integer NOT NULL DEFAULT 0;

ALTER TABLE public.discovered_organizations
  ADD COLUMN IF NOT EXISTS verification_attempts integer NOT NULL DEFAULT 0;

ALTER TABLE public.discovered_contacts
  DROP CONSTRAINT IF EXISTS discovered_contacts_verification_status_check;
ALTER TABLE public.discovered_contacts
  ADD CONSTRAINT discovered_contacts_verification_status_check
  CHECK (verification_status IN ('queued', 'verifying', 'verified', 'failed'));

ALTER TABLE public.discovered_organizations
  DROP CONSTRAINT IF EXISTS discovered_organizations_verification_status_check;
ALTER TABLE public.discovered_organizations
  ADD CONSTRAINT discovered_organizations_verification_status_check
  CHECK (verification_status IN ('queued', 'verifying', 'verified', 'failed'));

COMMENT ON COLUMN public.discovered_contacts.verification_attempts IS
  'Number of times verification dispatch has been attempted. >= 3 escalates verification_status to failed.';
COMMENT ON COLUMN public.discovered_organizations.verification_attempts IS
  'Number of times verification dispatch has been attempted. >= 3 escalates verification_status to failed.';
