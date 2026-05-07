/*
  # Phase 4 Collection Organizations

  Collections can contain either approved people or approved organizations.
  Suggestions remain draft-only in the client until staff accept a candidate.
*/

ALTER TABLE collection_members
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE collection_members
  ALTER COLUMN person_id DROP NOT NULL;

ALTER TABLE collection_members
  DROP CONSTRAINT IF EXISTS collection_members_collection_id_person_id_key;

ALTER TABLE collection_members
  DROP CONSTRAINT IF EXISTS collection_members_exactly_one_entity;

ALTER TABLE collection_members
  ADD CONSTRAINT collection_members_exactly_one_entity
  CHECK (
    (person_id IS NOT NULL AND organization_id IS NULL)
    OR (person_id IS NULL AND organization_id IS NOT NULL)
  );

DROP INDEX IF EXISTS collection_members_collection_person_unique_idx;
DROP INDEX IF EXISTS collection_members_collection_organization_unique_idx;

CREATE UNIQUE INDEX collection_members_collection_person_unique_idx
  ON collection_members(collection_id, person_id)
  WHERE person_id IS NOT NULL;

CREATE UNIQUE INDEX collection_members_collection_organization_unique_idx
  ON collection_members(collection_id, organization_id)
  WHERE organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_collection_members_organization
  ON collection_members(organization_id);

DROP POLICY IF EXISTS "Allow public insert access on collection_members" ON collection_members;
CREATE POLICY "Allow public insert access on collection_members"
  ON collection_members FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    collection_id IS NOT NULL
    AND (
      (person_id IS NOT NULL AND organization_id IS NULL)
      OR (person_id IS NULL AND organization_id IS NOT NULL)
    )
  );

DROP POLICY IF EXISTS "Allow public update access on collection_members" ON collection_members;
CREATE POLICY "Allow public update access on collection_members"
  ON collection_members FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (
    collection_id IS NOT NULL
    AND (
      (person_id IS NOT NULL AND organization_id IS NULL)
      OR (person_id IS NULL AND organization_id IS NOT NULL)
    )
  );
