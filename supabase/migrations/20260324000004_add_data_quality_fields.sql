-- Add data quality and privacy fields to people table
ALTER TABLE people ADD COLUMN IF NOT EXISTS data_source TEXT DEFAULT 'manual';
ALTER TABLE people ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ;

-- Add comment explaining how these fields are used
COMMENT ON COLUMN people.data_source IS 'Source of the contact data: manual, csv_import, ai_agent, self_reported';
COMMENT ON COLUMN people.last_verified_at IS 'Timestamp of when the profile was last reviewed or edited by a human';
