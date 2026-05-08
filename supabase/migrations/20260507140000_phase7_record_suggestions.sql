-- Phase 7: extend profile_suggestions to support both people and organizations.
-- Mirrors the collection_members pattern: nullable FK pair plus a CHECK that
-- exactly one of person_id / organization_id is set and matches record_type.
-- A future cosmetic migration may rename profile_suggestions -> record_suggestions.

ALTER TABLE profile_suggestions
  ADD COLUMN IF NOT EXISTS record_type text NOT NULL DEFAULT 'person',
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE profile_suggestions
  ALTER COLUMN person_id DROP NOT NULL;

UPDATE profile_suggestions
SET record_type = 'person'
WHERE record_type IS NULL OR record_type = '';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'profile_suggestions_record_type_check'
  ) THEN
    ALTER TABLE profile_suggestions
      ADD CONSTRAINT profile_suggestions_record_type_check
      CHECK (record_type IN ('person', 'organization'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'profile_suggestions_record_target_check'
  ) THEN
    ALTER TABLE profile_suggestions
      ADD CONSTRAINT profile_suggestions_record_target_check
      CHECK (
        (record_type = 'person'
          AND person_id IS NOT NULL
          AND organization_id IS NULL)
        OR
        (record_type = 'organization'
          AND organization_id IS NOT NULL
          AND person_id IS NULL)
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_profile_suggestions_organization
  ON profile_suggestions(organization_id)
  WHERE organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_profile_suggestions_pending_dedupe_org
  ON profile_suggestions(organization_id, dedupe_key)
  WHERE status = 'pending' AND organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_profile_suggestions_record_type_status
  ON profile_suggestions(record_type, status);
