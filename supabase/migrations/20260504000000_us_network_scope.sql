-- US network scope model for US-based and US-connected-abroad people,
-- plus multi-location US presence for organizations.

ALTER TABLE people
  ADD COLUMN IF NOT EXISTS us_network_status text NOT NULL DEFAULT 'us_based',
  ADD COLUMN IF NOT EXISTS current_location_city text,
  ADD COLUMN IF NOT EXISTS current_location_country text;

ALTER TABLE people
  DROP CONSTRAINT IF EXISTS people_us_network_status_check;

ALTER TABLE people
  ADD CONSTRAINT people_us_network_status_check
  CHECK (us_network_status IN ('us_based', 'us_connected_abroad', 'needs_review'));

UPDATE people
SET us_network_status = 'us_based'
WHERE us_network_status IS NULL OR us_network_status = '';

CREATE TABLE IF NOT EXISTS person_us_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  connection_label text,
  source_url text,
  evidence_excerpt text,
  confidence numeric(5,2) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_person_us_connections_person
  ON person_us_connections(person_id);

CREATE INDEX IF NOT EXISTS idx_person_us_connections_location
  ON person_us_connections(location_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_person_us_connections_unique_location_label
  ON person_us_connections(person_id, location_id, lower(coalesce(connection_label, '')));

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS us_network_status text NOT NULL DEFAULT 'us_based_organization';

ALTER TABLE organizations
  DROP CONSTRAINT IF EXISTS organizations_us_network_status_check;

ALTER TABLE organizations
  ADD CONSTRAINT organizations_us_network_status_check
  CHECK (
    us_network_status IN (
      'us_based_organization',
      'belgian_organization_with_us_presence',
      'us_organization_connected_to_flanders',
      'institutional_connector'
    )
  );

UPDATE organizations
SET us_network_status = 'us_based_organization'
WHERE us_network_status IS NULL OR us_network_status = '';

CREATE TABLE IF NOT EXISTS organization_us_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  location_role text NOT NULL DEFAULT 'office',
  label text,
  description text,
  source_url text,
  evidence_excerpt text,
  confidence numeric(5,2) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    location_role IN (
      'hq',
      'office',
      'branch',
      'factory',
      'lab',
      'accelerator',
      'partner_site',
      'expansion_target',
      'event_site',
      'other'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_organization_us_locations_org
  ON organization_us_locations(organization_id);

CREATE INDEX IF NOT EXISTS idx_organization_us_locations_location
  ON organization_us_locations(location_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_organization_us_locations_unique_role
  ON organization_us_locations(organization_id, location_id, location_role, lower(coalesce(label, '')));

CREATE UNIQUE INDEX IF NOT EXISTS idx_organization_us_locations_one_primary
  ON organization_us_locations(organization_id)
  WHERE is_primary;

INSERT INTO organization_us_locations (
  organization_id,
  location_id,
  location_role,
  label,
  description,
  confidence,
  is_primary
)
SELECT
  o.id,
  o.location_id,
  CASE
    WHEN o.us_network_status = 'us_based_organization' THEN 'hq'
    ELSE 'office'
  END,
  CASE
    WHEN o.us_network_status = 'us_based_organization' THEN 'HQ'
    ELSE 'Primary US location'
  END,
  'Backfilled from organizations.location_id',
  1,
  true
FROM organizations o
WHERE o.location_id IS NOT NULL
ON CONFLICT DO NOTHING;

ALTER TABLE discovered_contacts
  ADD COLUMN IF NOT EXISTS suggested_us_network_status text,
  ADD COLUMN IF NOT EXISTS suggested_us_network_confidence numeric(5,2)
    CHECK (
      suggested_us_network_confidence IS NULL OR
      (suggested_us_network_confidence >= 0 AND suggested_us_network_confidence <= 1)
    ),
  ADD COLUMN IF NOT EXISTS current_location_city text,
  ADD COLUMN IF NOT EXISTS current_location_country text,
  ADD COLUMN IF NOT EXISTS suggested_us_connections jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS suggested_org_pivots jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE discovered_contacts
  DROP CONSTRAINT IF EXISTS discovered_contacts_suggested_us_network_status_check;

ALTER TABLE discovered_contacts
  ADD CONSTRAINT discovered_contacts_suggested_us_network_status_check
  CHECK (
    suggested_us_network_status IS NULL OR
    suggested_us_network_status IN ('us_based', 'us_connected_abroad', 'needs_review')
  );

UPDATE discovered_contacts
SET
  suggested_us_network_status = COALESCE(suggested_us_network_status, 'us_based'),
  suggested_us_network_confidence = COALESCE(suggested_us_network_confidence, discovery_confidence)
WHERE suggested_us_network_status IS NULL;

CREATE TABLE IF NOT EXISTS discovered_organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  website_url text,
  description text,
  suggested_us_network_status text,
  us_locations jsonb NOT NULL DEFAULT '[]'::jsonb,
  sectors text[] DEFAULT '{}',
  flemish_belgian_relevance text,
  source_urls text[] DEFAULT '{}',
  confidence numeric(5,2) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  status text NOT NULL DEFAULT 'pending',
  review_outcome text,
  reviewed_at timestamptz,
  approved_organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  agent_run_id uuid REFERENCES agent_runs(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    suggested_us_network_status IS NULL OR
    suggested_us_network_status IN (
      'us_based_organization',
      'belgian_organization_with_us_presence',
      'us_organization_connected_to_flanders',
      'institutional_connector'
    )
  ),
  CHECK (status IN ('pending', 'approved', 'rejected', 'needs_review'))
);

CREATE INDEX IF NOT EXISTS idx_discovered_organizations_status
  ON discovered_organizations(status);

CREATE INDEX IF NOT EXISTS idx_discovered_organizations_confidence
  ON discovered_organizations(confidence DESC);

ALTER TABLE person_us_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_us_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE discovered_organizations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'person_us_connections'
      AND policyname = 'Public read person_us_connections'
  ) THEN
    CREATE POLICY "Public read person_us_connections"
      ON person_us_connections FOR SELECT TO anon, authenticated USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'person_us_connections'
      AND policyname = 'Public insert person_us_connections'
  ) THEN
    CREATE POLICY "Public insert person_us_connections"
      ON person_us_connections FOR INSERT TO anon, authenticated WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'person_us_connections'
      AND policyname = 'Public update person_us_connections'
  ) THEN
    CREATE POLICY "Public update person_us_connections"
      ON person_us_connections FOR UPDATE TO anon, authenticated USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'person_us_connections'
      AND policyname = 'Public delete person_us_connections'
  ) THEN
    CREATE POLICY "Public delete person_us_connections"
      ON person_us_connections FOR DELETE TO anon, authenticated USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'organization_us_locations'
      AND policyname = 'Public read organization_us_locations'
  ) THEN
    CREATE POLICY "Public read organization_us_locations"
      ON organization_us_locations FOR SELECT TO anon, authenticated USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'organization_us_locations'
      AND policyname = 'Public insert organization_us_locations'
  ) THEN
    CREATE POLICY "Public insert organization_us_locations"
      ON organization_us_locations FOR INSERT TO anon, authenticated WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'organization_us_locations'
      AND policyname = 'Public update organization_us_locations'
  ) THEN
    CREATE POLICY "Public update organization_us_locations"
      ON organization_us_locations FOR UPDATE TO anon, authenticated USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'discovered_organizations'
      AND policyname = 'Public read discovered_organizations'
  ) THEN
    CREATE POLICY "Public read discovered_organizations"
      ON discovered_organizations FOR SELECT TO anon, authenticated USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'discovered_organizations'
      AND policyname = 'Public insert discovered_organizations'
  ) THEN
    CREATE POLICY "Public insert discovered_organizations"
      ON discovered_organizations FOR INSERT TO anon, authenticated WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'discovered_organizations'
      AND policyname = 'Public update discovered_organizations'
  ) THEN
    CREATE POLICY "Public update discovered_organizations"
      ON discovered_organizations FOR UPDATE TO anon, authenticated USING (true);
  END IF;
END
$$;
