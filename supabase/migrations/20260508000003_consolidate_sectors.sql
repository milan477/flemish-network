/*
  # Consolidate sectors and remove non-canonical entries

  1. Changes
    - Ensures 'Artificial Intelligence' exists
    - Merges 'AI' into 'Artificial Intelligence'
    - Merges 'Life Sciences' into 'Biotechnology'
    - Removes any sectors that are not in the canonical list
    - Re-links any affected people and organizations to their new canonical sectors

  2. Canonical List
    - Artificial Intelligence
    - Biotechnology
    - Finance
    - Culture & Arts
    - Education
    - Research
*/

DO $$
DECLARE
  v_ai_id uuid;
  v_biotech_id uuid;
BEGIN
  -- 1. Ensure canonical sectors exist and get their IDs
  INSERT INTO sectors (name) VALUES ('Artificial Intelligence') ON CONFLICT (name) DO NOTHING;
  SELECT id INTO v_ai_id FROM sectors WHERE name = 'Artificial Intelligence';

  INSERT INTO sectors (name) VALUES ('Biotechnology') ON CONFLICT (name) DO NOTHING;
  SELECT id INTO v_biotech_id FROM sectors WHERE name = 'Biotechnology';

  -- 2. Migrate links from 'AI' to 'Artificial Intelligence'
  UPDATE person_sectors
  SET sector_id = v_ai_id
  WHERE sector_id IN (SELECT id FROM sectors WHERE name = 'AI')
  AND person_id NOT IN (
    SELECT person_id FROM person_sectors WHERE sector_id = v_ai_id
  );

  UPDATE organization_sectors
  SET sector_id = v_ai_id
  WHERE sector_id IN (SELECT id FROM sectors WHERE name = 'AI')
  AND organization_id NOT IN (
    SELECT organization_id FROM organization_sectors WHERE sector_id = v_ai_id
  );

  -- 3. Migrate links from 'Life Sciences' to 'Biotechnology'
  UPDATE person_sectors
  SET sector_id = v_biotech_id
  WHERE sector_id IN (SELECT id FROM sectors WHERE name = 'Life Sciences')
  AND person_id NOT IN (
    SELECT person_id FROM person_sectors WHERE sector_id = v_biotech_id
  );

  UPDATE organization_sectors
  SET sector_id = v_biotech_id
  WHERE sector_id IN (SELECT id FROM sectors WHERE name = 'Life Sciences')
  AND organization_id NOT IN (
    SELECT organization_id FROM organization_sectors WHERE sector_id = v_biotech_id
  );

  -- 4. Delete non-canonical sectors (links will be deleted by ON DELETE CASCADE if they exist)
  -- If there's no cascade, we should delete links first.
  -- The initial schema doesn't specify CASCADE for person_sectors, let's be safe.
  DELETE FROM person_sectors WHERE sector_id IN (
    SELECT id FROM sectors WHERE name NOT IN (
      'Artificial Intelligence', 'Biotechnology', 'Finance', 'Culture & Arts', 'Education', 'Research'
    )
  );
  
  DELETE FROM organization_sectors WHERE sector_id IN (
    SELECT id FROM sectors WHERE name NOT IN (
      'Artificial Intelligence', 'Biotechnology', 'Finance', 'Culture & Arts', 'Education', 'Research'
    )
  );

  DELETE FROM sectors WHERE name NOT IN (
    'Artificial Intelligence', 'Biotechnology', 'Finance', 'Culture & Arts', 'Education', 'Research'
  );
END $$;
