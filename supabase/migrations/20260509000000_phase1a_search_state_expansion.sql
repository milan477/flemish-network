-- Phase 1A (UX_REMEDIATION 2026-05-08): expand US state abbreviations into search blobs
-- so lexical/BM25 matches "Massachusetts" against rows whose location_text only stores "MA".
-- Owner decision: extend the existing search_text blobs in place; do NOT trigger a re-embed
-- (the embedding column is unaffected by this migration). The RETURNS TABLE signatures of
-- the two build_* functions are preserved exactly so we can CREATE OR REPLACE without
-- cascading drops on the sync_*_bulk consumers.

SET search_path TO public, extensions;

CREATE OR REPLACE FUNCTION expand_us_state(state_code text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE upper(coalesce(trim(state_code), ''))
    WHEN 'AL' THEN 'Alabama'
    WHEN 'AK' THEN 'Alaska'
    WHEN 'AZ' THEN 'Arizona'
    WHEN 'AR' THEN 'Arkansas'
    WHEN 'CA' THEN 'California'
    WHEN 'CO' THEN 'Colorado'
    WHEN 'CT' THEN 'Connecticut'
    WHEN 'DE' THEN 'Delaware'
    WHEN 'FL' THEN 'Florida'
    WHEN 'GA' THEN 'Georgia'
    WHEN 'HI' THEN 'Hawaii'
    WHEN 'ID' THEN 'Idaho'
    WHEN 'IL' THEN 'Illinois'
    WHEN 'IN' THEN 'Indiana'
    WHEN 'IA' THEN 'Iowa'
    WHEN 'KS' THEN 'Kansas'
    WHEN 'KY' THEN 'Kentucky'
    WHEN 'LA' THEN 'Louisiana'
    WHEN 'ME' THEN 'Maine'
    WHEN 'MD' THEN 'Maryland'
    WHEN 'MA' THEN 'Massachusetts'
    WHEN 'MI' THEN 'Michigan'
    WHEN 'MN' THEN 'Minnesota'
    WHEN 'MS' THEN 'Mississippi'
    WHEN 'MO' THEN 'Missouri'
    WHEN 'MT' THEN 'Montana'
    WHEN 'NE' THEN 'Nebraska'
    WHEN 'NV' THEN 'Nevada'
    WHEN 'NH' THEN 'New Hampshire'
    WHEN 'NJ' THEN 'New Jersey'
    WHEN 'NM' THEN 'New Mexico'
    WHEN 'NY' THEN 'New York'
    WHEN 'NC' THEN 'North Carolina'
    WHEN 'ND' THEN 'North Dakota'
    WHEN 'OH' THEN 'Ohio'
    WHEN 'OK' THEN 'Oklahoma'
    WHEN 'OR' THEN 'Oregon'
    WHEN 'PA' THEN 'Pennsylvania'
    WHEN 'RI' THEN 'Rhode Island'
    WHEN 'SC' THEN 'South Carolina'
    WHEN 'SD' THEN 'South Dakota'
    WHEN 'TN' THEN 'Tennessee'
    WHEN 'TX' THEN 'Texas'
    WHEN 'UT' THEN 'Utah'
    WHEN 'VT' THEN 'Vermont'
    WHEN 'VA' THEN 'Virginia'
    WHEN 'WA' THEN 'Washington'
    WHEN 'WV' THEN 'West Virginia'
    WHEN 'WI' THEN 'Wisconsin'
    WHEN 'WY' THEN 'Wyoming'
    WHEN 'DC' THEN 'District of Columbia'
    ELSE NULL
  END;
$$;

COMMENT ON FUNCTION expand_us_state(text) IS
  'Expand US state two-letter code into spelled-out state name; NULL if unknown.';

CREATE OR REPLACE FUNCTION format_location_search_text(p_city text, p_state text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT trim(concat_ws(
    ' ',
    NULLIF(trim(concat_ws(', ', NULLIF(trim(coalesce(p_city, '')), ''), NULLIF(trim(coalesce(p_state, '')), ''))), ''),
    expand_us_state(p_state)
  ));
$$;

COMMENT ON FUNCTION format_location_search_text(text, text) IS
  'Render a location string for the search blob: "City, ST <Spelled-Out-State>".';

-- Rebuild people search document. Signature preserved from
-- 20260507120000_phase6b_flemish_fact_search_canonicalization.sql; only the
-- inner location_text source changes so spelled-out state names land in
-- search_text and search_tsv.
CREATE OR REPLACE FUNCTION build_people_search_document(p_person_id uuid)
RETURNS TABLE (
  person_id uuid,
  name text,
  name_normalized text,
  current_position text,
  current_position_normalized text,
  occupation text,
  occupation_normalized text,
  bio text,
  bio_normalized text,
  flemish_connection_names text,
  flemish_connection_names_normalized text,
  sector_names text,
  sector_names_normalized text,
  location_text text,
  location_text_normalized text,
  search_text text,
  search_tsv tsvector,
  updated_at timestamptz
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH base AS (
    SELECT
      p.id AS person_id,
      coalesce(p.name, '') AS name,
      coalesce(p.current_position, '') AS current_position,
      coalesce(p.occupation, '') AS occupation,
      coalesce(p.bio, '') AS bio,
      coalesce(fc.connection_names, '') AS flemish_connection_names,
      coalesce(ps.sector_names, '') AS sector_names,
      coalesce(format_location_search_text(l.city, l.state), '') AS location_text
    FROM people p
    LEFT JOIN locations l
      ON l.id = p.location_id
    LEFT JOIN LATERAL (
      SELECT string_agg(connection_text, ' | ' ORDER BY canonical_name) AS connection_names
      FROM (
        SELECT DISTINCT
          fc.name AS canonical_name,
          trim(concat_ws(
            ' ',
            fc.name,
            alias_text.aliases,
            pfc.role,
            pfc.evidence_excerpt
          )) AS connection_text
        FROM person_flemish_connections pfc
        JOIN flemish_connections fc
          ON fc.id = pfc.flemish_connection_id
        LEFT JOIN LATERAL (
          SELECT string_agg(fca.alias, ', ' ORDER BY fca.alias) AS aliases
          FROM flemish_connection_aliases fca
          WHERE fca.flemish_connection_id = fc.id
            AND fca.status = 'approved'
        ) alias_text ON true
        WHERE pfc.person_id = p.id
      ) connection_rows
      WHERE connection_text <> ''
    ) fc ON true
    LEFT JOIN LATERAL (
      SELECT string_agg(s.name, ', ' ORDER BY s.name) AS sector_names
      FROM person_sectors ps
      JOIN sectors s
        ON s.id = ps.sector_id
      WHERE ps.person_id = p.id
    ) ps ON true
    WHERE p.id = p_person_id
  )
  SELECT
    person_id,
    name,
    normalize_search_text(name) AS name_normalized,
    current_position,
    normalize_search_text(current_position) AS current_position_normalized,
    occupation,
    normalize_search_text(occupation) AS occupation_normalized,
    bio,
    normalize_search_text(bio) AS bio_normalized,
    flemish_connection_names,
    normalize_search_text(flemish_connection_names) AS flemish_connection_names_normalized,
    sector_names,
    normalize_search_text(sector_names) AS sector_names_normalized,
    location_text,
    normalize_search_text(location_text) AS location_text_normalized,
    normalize_search_text(
      concat_ws(
        ' ',
        name,
        current_position,
        occupation,
        flemish_connection_names,
        sector_names,
        location_text,
        bio
      )
    ) AS search_text,
    build_people_search_tsv(
      name,
      current_position,
      occupation,
      flemish_connection_names,
      sector_names,
      location_text,
      bio
    ) AS search_tsv,
    now() AS updated_at
  FROM base;
$$;

-- Rebuild organization search document. Signature preserved from
-- 20260507130000_phase6d_flemish_fact_cleanup.sql (uses flemish_fact_text, not
-- flemish_link). Only the inner location_text source changes.
CREATE OR REPLACE FUNCTION build_organization_search_document(p_organization_id uuid)
RETURNS TABLE (
  organization_id uuid,
  name text,
  name_normalized text,
  type text,
  type_normalized text,
  description text,
  description_normalized text,
  flemish_fact_text text,
  flemish_fact_text_normalized text,
  sector_names text,
  sector_names_normalized text,
  primary_location_text text,
  primary_location_text_normalized text,
  location_text text,
  location_text_normalized text,
  us_network_status text,
  us_network_status_normalized text,
  search_text text,
  search_tsv tsvector,
  updated_at timestamptz
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH base AS (
    SELECT
      o.id AS organization_id,
      coalesce(o.name, '') AS name,
      coalesce(o.type, '') AS type,
      coalesce(o.description, '') AS description,
      coalesce(flemish_facts.flemish_fact_text, '') AS flemish_fact_text,
      coalesce(sectors.sector_names, '') AS sector_names,
      coalesce(primary_location.location_text, format_location_search_text(l.city, l.state), '') AS primary_location_text,
      coalesce(locations.location_text, format_location_search_text(l.city, l.state), '') AS location_text,
      coalesce(o.us_network_status, '') AS us_network_status
    FROM organizations o
    LEFT JOIN locations l
      ON l.id = o.location_id
    LEFT JOIN LATERAL (
      SELECT string_agg(fact_text, ' | ' ORDER BY canonical_name) AS flemish_fact_text
      FROM (
        SELECT DISTINCT
          fc.name AS canonical_name,
          trim(concat_ws(' ', fc.name, alias_text.aliases, ofc.role, ofc.evidence_excerpt)) AS fact_text
        FROM organization_flemish_connections ofc
        JOIN flemish_connections fc
          ON fc.id = ofc.flemish_connection_id
        LEFT JOIN LATERAL (
          SELECT string_agg(fca.alias, ', ' ORDER BY fca.alias) AS aliases
          FROM flemish_connection_aliases fca
          WHERE fca.flemish_connection_id = fc.id
            AND fca.status = 'approved'
        ) alias_text ON true
        WHERE ofc.organization_id = o.id
      ) fact_rows
      WHERE fact_text <> ''
    ) flemish_facts ON true
    LEFT JOIN LATERAL (
      SELECT string_agg(s.name, ', ' ORDER BY s.name) AS sector_names
      FROM organization_sectors os
      JOIN sectors s
        ON s.id = os.sector_id
      WHERE os.organization_id = o.id
    ) sectors ON true
    LEFT JOIN LATERAL (
      SELECT format_location_search_text(loc.city, loc.state) AS location_text
      FROM organization_us_locations oul
      JOIN locations loc
        ON loc.id = oul.location_id
      WHERE oul.organization_id = o.id
      ORDER BY oul.is_primary DESC, loc.city, loc.state
      LIMIT 1
    ) primary_location ON true
    LEFT JOIN LATERAL (
      SELECT string_agg(location_label, ' | ' ORDER BY is_primary DESC, location_label) AS location_text
      FROM (
        SELECT DISTINCT
          oul.is_primary,
          format_location_search_text(loc.city, loc.state) AS location_label
        FROM organization_us_locations oul
        JOIN locations loc
          ON loc.id = oul.location_id
        WHERE oul.organization_id = o.id
      ) location_rows
      WHERE location_label <> ''
    ) locations ON true
    WHERE o.id = p_organization_id
  )
  SELECT
    organization_id,
    name,
    normalize_search_text(name) AS name_normalized,
    type,
    normalize_search_text(type) AS type_normalized,
    description,
    normalize_search_text(description) AS description_normalized,
    flemish_fact_text,
    normalize_search_text(flemish_fact_text) AS flemish_fact_text_normalized,
    sector_names,
    normalize_search_text(sector_names) AS sector_names_normalized,
    primary_location_text,
    normalize_search_text(primary_location_text) AS primary_location_text_normalized,
    location_text,
    normalize_search_text(location_text) AS location_text_normalized,
    us_network_status,
    normalize_search_text(replace(us_network_status, '_', ' ')) AS us_network_status_normalized,
    normalize_search_text(concat_ws(' ', name, type, description, flemish_fact_text, sector_names, primary_location_text, location_text, replace(us_network_status, '_', ' '))) AS search_text,
    build_organization_search_tsv(name, type, description, flemish_fact_text, sector_names, primary_location_text, location_text, us_network_status) AS search_tsv,
    now() AS updated_at
  FROM base;
$$;

-- Backfill all rows so the new spelled-out states land in search_text.
SELECT sync_people_search_documents_bulk(
  ARRAY(SELECT id FROM people)
);

SELECT sync_organization_search_documents_bulk(
  ARRAY(SELECT id FROM organizations)
);
