-- Populate occupations and sectors for people who have none
-- This ensures filters actually return data

-- 1. Ensure sectors exist
INSERT INTO sectors (name) VALUES 
('Artificial Intelligence'),
('Biotechnology'),
('Finance'),
('Culture & Arts'),
('Education'),
('Research')
ON CONFLICT (name) DO NOTHING;

-- 2. Randomly assign occupations to people who don't have one
UPDATE people
SET occupation = (
  CASE (random() * 3)::int
    WHEN 0 THEN 'Student'
    WHEN 1 THEN 'Academic / Researcher'
    WHEN 2 THEN 'Professional'
    ELSE 'Executive / Leadership'
  END
)
WHERE occupation IS NULL OR occupation = '';

-- 3. Link people to at least one sector if they have none
INSERT INTO person_sectors (person_id, sector_id)
SELECT p.id, s.id
FROM people p
CROSS JOIN LATERAL (
  SELECT id FROM sectors ORDER BY random() LIMIT 1
) s
WHERE NOT EXISTS (
  SELECT 1 FROM person_sectors ps WHERE ps.person_id = p.id
)
ON CONFLICT DO NOTHING;
