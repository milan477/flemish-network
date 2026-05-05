-- connection_label is the canonical description for a person's US tie.
-- connection_type was a redundant, less-specific duplicate.

DROP INDEX IF EXISTS idx_person_us_connections_unique_role;
DROP INDEX IF EXISTS idx_person_us_connections_unique_location_label;

ALTER TABLE IF EXISTS person_us_connections
  DROP COLUMN IF EXISTS connection_type;

CREATE UNIQUE INDEX IF NOT EXISTS idx_person_us_connections_unique_location_label
  ON person_us_connections(person_id, location_id, lower(coalesce(connection_label, '')));
