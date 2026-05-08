-- Fast RPC that returns per-location counts for the map's Tier 1 load.
-- The frontend merges rows by city|state, so multiple UNION legs may share a city.
CREATE OR REPLACE FUNCTION get_network_location_summary()
RETURNS TABLE (
  city        text,
  state       text,
  lat         double precision,
  lng         double precision,
  person_count bigint,
  org_count   bigint,
  person_ids  uuid[],
  org_ids     uuid[]
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  -- US-based people (primary location)
  SELECT
    l.city,
    l.state,
    l.latitude  AS lat,
    l.longitude AS lng,
    COUNT(DISTINCT p.id)      AS person_count,
    0::bigint                 AS org_count,
    array_agg(DISTINCT p.id) AS person_ids,
    ARRAY[]::uuid[]           AS org_ids
  FROM people p
  JOIN locations l ON l.id = p.location_id
  WHERE (p.us_network_status IS NULL OR p.us_network_status != 'us_connected_abroad')
    AND l.city      IS NOT NULL
    AND l.latitude  IS NOT NULL
  GROUP BY l.city, l.state, l.latitude, l.longitude

  UNION ALL

  -- US-connected-abroad people (cluster at their US connection locations)
  SELECT
    l.city,
    l.state,
    l.latitude  AS lat,
    l.longitude AS lng,
    COUNT(DISTINCT p.id)      AS person_count,
    0::bigint                 AS org_count,
    array_agg(DISTINCT p.id) AS person_ids,
    ARRAY[]::uuid[]           AS org_ids
  FROM person_us_connections puc
  JOIN people      p ON p.id  = puc.person_id
  JOIN locations   l ON l.id  = puc.location_id
  WHERE p.us_network_status = 'us_connected_abroad'
    AND l.city      IS NOT NULL
    AND l.latitude  IS NOT NULL
  GROUP BY l.city, l.state, l.latitude, l.longitude

  UNION ALL

  -- Organizations via organization_us_locations
  SELECT
    l.city,
    l.state,
    l.latitude  AS lat,
    l.longitude AS lng,
    0::bigint                 AS person_count,
    COUNT(DISTINCT o.id)      AS org_count,
    ARRAY[]::uuid[]           AS person_ids,
    array_agg(DISTINCT o.id) AS org_ids
  FROM organization_us_locations oul
  JOIN organizations o ON o.id = oul.organization_id
  JOIN locations     l ON l.id = oul.location_id
  WHERE l.city     IS NOT NULL
    AND l.latitude IS NOT NULL
  GROUP BY l.city, l.state, l.latitude, l.longitude

  UNION ALL

  -- Organizations via primary location only (those without any us_locations rows)
  SELECT
    l.city,
    l.state,
    l.latitude  AS lat,
    l.longitude AS lng,
    0::bigint                 AS person_count,
    COUNT(DISTINCT o.id)      AS org_count,
    ARRAY[]::uuid[]           AS person_ids,
    array_agg(DISTINCT o.id) AS org_ids
  FROM organizations o
  JOIN locations l ON l.id = o.location_id
  WHERE l.city     IS NOT NULL
    AND l.latitude IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM organization_us_locations oul WHERE oul.organization_id = o.id
    )
  GROUP BY l.city, l.state, l.latitude, l.longitude
$$;

GRANT EXECUTE ON FUNCTION get_network_location_summary() TO authenticated;
