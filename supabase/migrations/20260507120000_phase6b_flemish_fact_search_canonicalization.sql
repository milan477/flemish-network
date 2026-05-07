-- Phase 6B: use canonical Flemish/Belgian facts in search documents, lexical scoring, and filters.

SET search_path TO public, extensions;

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
      coalesce(trim(concat_ws(', ', l.city, l.state)), '') AS location_text
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

CREATE OR REPLACE FUNCTION build_organization_search_document(p_organization_id uuid)
RETURNS TABLE (
  organization_id uuid,
  name text,
  name_normalized text,
  type text,
  type_normalized text,
  description text,
  description_normalized text,
  flemish_link text,
  flemish_link_normalized text,
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
      coalesce(flemish_facts.flemish_fact_text, '') AS flemish_link,
      coalesce(sectors.sector_names, '') AS sector_names,
      coalesce(primary_location.location_text, trim(concat_ws(', ', l.city, l.state)), '') AS primary_location_text,
      coalesce(locations.location_text, trim(concat_ws(', ', l.city, l.state)), '') AS location_text,
      coalesce(o.us_network_status, '') AS us_network_status
    FROM organizations o
    LEFT JOIN locations l
      ON l.id = o.location_id
    LEFT JOIN LATERAL (
      SELECT string_agg(fact_text, ' | ' ORDER BY canonical_name) AS flemish_fact_text
      FROM (
        SELECT DISTINCT
          fc.name AS canonical_name,
          trim(concat_ws(
            ' ',
            fc.name,
            alias_text.aliases,
            ofc.role,
            ofc.evidence_excerpt
          )) AS fact_text
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
      SELECT trim(concat_ws(', ', loc.city, loc.state)) AS location_text
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
          trim(concat_ws(', ', loc.city, loc.state)) AS location_label
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
    flemish_link,
    normalize_search_text(flemish_link) AS flemish_link_normalized,
    sector_names,
    normalize_search_text(sector_names) AS sector_names_normalized,
    primary_location_text,
    normalize_search_text(primary_location_text) AS primary_location_text_normalized,
    location_text,
    normalize_search_text(location_text) AS location_text_normalized,
    us_network_status,
    normalize_search_text(replace(us_network_status, '_', ' ')) AS us_network_status_normalized,
    normalize_search_text(
      concat_ws(
        ' ',
        name,
        type,
        description,
        flemish_link,
        sector_names,
        primary_location_text,
        location_text,
        replace(us_network_status, '_', ' ')
      )
    ) AS search_text,
    build_organization_search_tsv(
      name,
      type,
      description,
      flemish_link,
      sector_names,
      primary_location_text,
      location_text,
      us_network_status
    ) AS search_tsv,
    now() AS updated_at
  FROM base;
$$;

CREATE OR REPLACE FUNCTION search_organizations_lexical(
  search_query text,
  search_route text DEFAULT 'exploratory',
  match_count int DEFAULT 50
)
RETURNS TABLE (
  organization_id uuid,
  lexical_score double precision,
  exact_name_match boolean,
  name_score double precision,
  text_score double precision,
  ts_score double precision,
  match_field text,
  match_text text
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH params AS (
    SELECT
      trim(coalesce(search_query, '')) AS raw_query,
      normalize_search_text(search_query) AS normalized_query,
      CASE
        WHEN search_route IN ('direct_lookup', 'faceted', 'exploratory') THEN search_route
        ELSE 'exploratory'
      END AS resolved_route,
      plainto_tsquery('simple', trim(coalesce(search_query, ''))) AS simple_query,
      plainto_tsquery('english', trim(coalesce(search_query, ''))) AS english_query
  ),
  scored AS (
    SELECT
      d.organization_id,
      d.name,
      d.type,
      d.description,
      d.flemish_link,
      d.sector_names,
      d.primary_location_text,
      d.location_text,
      d.us_network_status,
      description_snippet.description_snippet,
      d.search_text,
      (d.name_normalized = p.normalized_query) AS exact_name_match,
      search_field_score(d.name, p.raw_query) AS name_score,
      search_field_score(d.type, p.raw_query) AS type_score,
      search_field_score(d.flemish_link, p.raw_query) AS flemish_link_score,
      search_field_score(d.sector_names, p.raw_query) AS sector_score,
      GREATEST(
        search_field_score(d.primary_location_text, p.raw_query),
        search_field_score(d.location_text, p.raw_query)
      ) AS location_score,
      search_field_score(replace(d.us_network_status, '_', ' '), p.raw_query) AS status_score,
      search_field_score(description_snippet.description_snippet, p.raw_query) AS description_score,
      search_field_score(d.search_text, p.raw_query) AS text_score,
      GREATEST(
        ts_rank_cd(d.search_tsv, p.simple_query),
        ts_rank_cd(d.search_tsv, p.english_query)
      ) AS ts_score,
      p.resolved_route
    FROM organization_search_documents d
    CROSS JOIN params p
    CROSS JOIN LATERAL (
      SELECT best_matching_bio_sentence(d.description, p.raw_query) AS description_snippet
    ) AS description_snippet
    WHERE p.normalized_query <> ''
      AND (
        d.name_normalized = p.normalized_query
        OR d.search_tsv @@ p.simple_query
        OR d.search_tsv @@ p.english_query
        OR d.name_normalized % p.normalized_query
        OR d.flemish_link_normalized % p.normalized_query
        OR d.search_text % p.normalized_query
        OR d.search_text LIKE '%' || p.normalized_query || '%'
      )
  ),
  matched AS (
    SELECT
      s.organization_id,
      s.exact_name_match,
      s.name_score,
      s.text_score,
      s.ts_score,
      s.resolved_route,
      best.field_name AS match_field,
      best.field_text AS match_text,
      CASE s.resolved_route
        WHEN 'direct_lookup' THEN
          (CASE WHEN s.exact_name_match THEN 0.45 ELSE 0 END)
          + 0.40 * s.name_score
          + 0.18 * s.flemish_link_score
          + 0.10 * s.location_score
          + 0.08 * s.type_score
          + 0.08 * s.ts_score
        WHEN 'faceted' THEN
          0.12 * s.name_score
          + 0.12 * s.type_score
          + 0.24 * s.flemish_link_score
          + 0.18 * s.sector_score
          + 0.14 * s.location_score
          + 0.10 * s.status_score
          + 0.08 * s.description_score
          + 0.12 * s.ts_score
        ELSE
          0.10 * s.name_score
          + 0.10 * s.type_score
          + 0.22 * s.flemish_link_score
          + 0.12 * s.sector_score
          + 0.12 * s.location_score
          + 0.08 * s.status_score
          + 0.14 * s.description_score
          + 0.10 * s.ts_score
      END AS lexical_score
    FROM scored s
    CROSS JOIN LATERAL (
      SELECT field_name, field_text, field_score
      FROM (
        VALUES
          ('name'::text, s.name, s.name_score),
          ('type'::text, s.type, s.type_score),
          ('flemish_connection'::text, s.flemish_link, s.flemish_link_score),
          ('sector'::text, s.sector_names, s.sector_score),
          ('location'::text, s.location_text, s.location_score),
          ('us_network_status'::text, replace(s.us_network_status, '_', ' '), s.status_score),
          ('description'::text, s.description_snippet, s.description_score)
      ) AS candidate(field_name, field_text, field_score)
      WHERE coalesce(field_text, '') <> ''
      ORDER BY field_score DESC, char_length(field_text) ASC
      LIMIT 1
    ) AS best
    WHERE s.exact_name_match
      OR s.ts_score > 0
      OR s.name_score >= 0.35
      OR s.text_score >= 0.35
      OR s.type_score >= 0.40
      OR s.flemish_link_score >= 0.35
      OR s.sector_score >= 0.40
      OR s.location_score >= 0.40
      OR s.status_score >= 0.40
      OR s.description_score >= 0.45
  )
  SELECT
    organization_id,
    lexical_score,
    exact_name_match,
    name_score,
    text_score,
    ts_score,
    match_field,
    left(match_text, 220) AS match_text
  FROM matched
  ORDER BY lexical_score DESC, exact_name_match DESC, name_score DESC, ts_score DESC
  LIMIT GREATEST(match_count, 1);
$$;

SELECT sync_people_search_documents_bulk(
  ARRAY(
    SELECT DISTINCT person_id
    FROM person_flemish_connections
  )
);

SELECT sync_organization_search_documents_bulk(
  ARRAY(
    SELECT DISTINCT organization_id
    FROM organization_flemish_connections
  )
);

SELECT enqueue_dirty_embedding_jobs();
SELECT enqueue_dirty_organization_embedding_jobs();
