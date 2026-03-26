-- Migration: Add location_id, migrate data, drop old columns

-- 1. Add location_id to people
ALTER TABLE people ADD COLUMN location_id uuid REFERENCES locations(id) ON DELETE SET NULL;

-- 2. Add location_id to organizations
ALTER TABLE organizations ADD COLUMN location_id uuid REFERENCES locations(id) ON DELETE SET NULL;

-- 3. Migrate data for people
UPDATE people p
SET location_id = l.id
FROM locations l
WHERE p.location_city = l.city AND p.location_state = l.state;

-- 4. Migrate data for organizations
UPDATE organizations o
SET location_id = l.id
FROM locations l
WHERE o.location_city = l.city AND o.location_state = l.state;

-- 5. Drop old columns from people
ALTER TABLE people 
  DROP COLUMN IF EXISTS location_city,
  DROP COLUMN IF EXISTS location_state,
  DROP COLUMN IF EXISTS latitude,
  DROP COLUMN IF EXISTS longitude;

-- 6. Drop old columns from organizations
ALTER TABLE organizations
  DROP COLUMN IF EXISTS location_city,
  DROP COLUMN IF EXISTS location_state,
  DROP COLUMN IF EXISTS latitude,
  DROP COLUMN IF EXISTS longitude;
