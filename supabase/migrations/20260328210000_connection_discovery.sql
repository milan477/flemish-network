-- Deterministic connection discovery infrastructure for the Connections agent.
-- Adds an idempotent RPC plus a unique index to prevent duplicate person-person
-- connection rows regardless of insertion direction.

CREATE UNIQUE INDEX IF NOT EXISTS idx_connections_unique_person_pair_type
  ON connections (
    LEAST(from_person_id, to_person_id),
    GREATEST(from_person_id, to_person_id),
    lower(relationship_type)
  )
  WHERE from_person_id IS NOT NULL
    AND to_person_id IS NOT NULL
    AND from_organization_id IS NULL
    AND to_organization_id IS NULL;

CREATE OR REPLACE FUNCTION discover_connections(
  p_types text[] DEFAULT ARRAY['colleague', 'alumni', 'local_peer']
)
RETURNS TABLE (
  relationship_type text,
  connections_found bigint,
  new_connections_created bigint,
  already_existed bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
WITH selected_types AS (
  SELECT DISTINCT lower(trim(value)) AS type
  FROM unnest(COALESCE(p_types, ARRAY['colleague', 'alumni', 'local_peer'])) AS value
  WHERE lower(trim(value)) IN ('colleague', 'alumni', 'local_peer')
),
normalized_positions AS (
  SELECT
    p.id,
    lower(
      trim(
        regexp_replace(
          COALESCE(
            NULLIF(substring(p.current_position from '(?i)(?:\s+at\s+|\s+@\s+)(.+)$'), ''),
            ''
          ),
          '\s+',
          ' ',
          'g'
        )
      )
    ) AS organization_key
  FROM people p
  WHERE p.current_position IS NOT NULL
),
candidate_colleagues AS (
  SELECT
    LEAST(p1.id, p2.id) AS from_person_id,
    GREATEST(p1.id, p2.id) AS to_person_id,
    'colleague'::text AS relationship_type,
    8::integer AS strength
  FROM normalized_positions p1
  JOIN normalized_positions p2
    ON p1.id < p2.id
   AND p1.organization_key <> ''
   AND p1.organization_key = p2.organization_key
  WHERE EXISTS (SELECT 1 FROM selected_types WHERE type = 'colleague')
),
normalized_connections AS (
  SELECT
    p.id AS person_id,
    lower(trim(regexp_replace(token, '\s+', ' ', 'g'))) AS connection_key
  FROM people p
  CROSS JOIN LATERAL regexp_split_to_table(COALESCE(p.flemish_connection, ''), ',') AS token
  WHERE trim(token) <> ''
),
candidate_alumni AS (
  SELECT
    LEAST(c1.person_id, c2.person_id) AS from_person_id,
    GREATEST(c1.person_id, c2.person_id) AS to_person_id,
    'alumni'::text AS relationship_type,
    6::integer AS strength
  FROM normalized_connections c1
  JOIN normalized_connections c2
    ON c1.person_id < c2.person_id
   AND c1.connection_key <> ''
   AND c1.connection_key = c2.connection_key
  WHERE EXISTS (SELECT 1 FROM selected_types WHERE type = 'alumni')
  GROUP BY 1, 2, 3, 4
),
candidate_local_peers AS (
  SELECT
    LEAST(p1.id, p2.id) AS from_person_id,
    GREATEST(p1.id, p2.id) AS to_person_id,
    'local_peer'::text AS relationship_type,
    4::integer AS strength
  FROM people p1
  JOIN people p2
    ON p1.id < p2.id
   AND p1.location_id IS NOT NULL
   AND p1.location_id = p2.location_id
  JOIN person_sectors ps1
    ON ps1.person_id = p1.id
  JOIN person_sectors ps2
    ON ps2.person_id = p2.id
   AND ps1.sector_id = ps2.sector_id
  WHERE EXISTS (SELECT 1 FROM selected_types WHERE type = 'local_peer')
  GROUP BY 1, 2, 3, 4
),
candidates AS (
  SELECT * FROM candidate_colleagues
  UNION
  SELECT * FROM candidate_alumni
  UNION
  SELECT * FROM candidate_local_peers
),
existing AS (
  SELECT
    c.*,
    EXISTS (
      SELECT 1
      FROM connections existing
      WHERE existing.relationship_type = c.relationship_type
        AND existing.from_person_id IS NOT NULL
        AND existing.to_person_id IS NOT NULL
        AND (
          (existing.from_person_id = c.from_person_id AND existing.to_person_id = c.to_person_id)
          OR
          (existing.from_person_id = c.to_person_id AND existing.to_person_id = c.from_person_id)
        )
    ) AS already_exists
  FROM candidates c
),
inserted AS (
  INSERT INTO connections (
    from_person_id,
    to_person_id,
    relationship_type,
    strength
  )
  SELECT
    from_person_id,
    to_person_id,
    relationship_type,
    strength
  FROM existing
  WHERE NOT already_exists
  ON CONFLICT DO NOTHING
  RETURNING from_person_id, to_person_id, relationship_type
),
stats AS (
  SELECT
    e.relationship_type,
    COUNT(*)::bigint AS connections_found,
    COUNT(i.relationship_type)::bigint AS new_connections_created,
    (COUNT(*) - COUNT(i.relationship_type))::bigint AS already_existed
  FROM existing e
  LEFT JOIN inserted i
    ON i.from_person_id = e.from_person_id
   AND i.to_person_id = e.to_person_id
   AND i.relationship_type = e.relationship_type
  GROUP BY e.relationship_type
)
SELECT
  relationship_type,
  connections_found,
  new_connections_created,
  already_existed
FROM stats
ORDER BY CASE relationship_type
  WHEN 'colleague' THEN 1
  WHEN 'alumni' THEN 2
  WHEN 'local_peer' THEN 3
  ELSE 99
END;
$$;
