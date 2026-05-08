-- Phase 6D: remove the deprecated organization Flemish text field and
-- rename active organization search-document fields to canonical fact terms.

SET search_path TO public, extensions;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'organization_search_documents'
      AND column_name = 'flemish_link'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'organization_search_documents'
      AND column_name = 'flemish_fact_text'
  ) THEN
    ALTER TABLE public.organization_search_documents
      RENAME COLUMN flemish_link TO flemish_fact_text;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'organization_search_documents'
      AND column_name = 'flemish_link_normalized'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'organization_search_documents'
      AND column_name = 'flemish_fact_text_normalized'
  ) THEN
    ALTER TABLE public.organization_search_documents
      RENAME COLUMN flemish_link_normalized TO flemish_fact_text_normalized;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION build_organization_search_tsv(
  p_name text,
  p_type text,
  p_description text,
  p_flemish_link text,
  p_sector_names text,
  p_primary_location_text text,
  p_location_text text,
  p_us_network_status text
)
RETURNS tsvector
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT
    setweight(to_tsvector('simple', coalesce(p_name, '')), 'A')
    || setweight(to_tsvector('english', coalesce(p_type, '')), 'B')
    || setweight(to_tsvector('simple', coalesce(p_flemish_link, '')), 'A')
    || setweight(to_tsvector('simple', coalesce(p_sector_names, '')), 'B')
    || setweight(to_tsvector('simple', coalesce(p_primary_location_text, '')), 'A')
    || setweight(to_tsvector('simple', coalesce(p_location_text, '')), 'B')
    || setweight(to_tsvector('simple', replace(coalesce(p_us_network_status, ''), '_', ' ')), 'C')
    || setweight(to_tsvector('english', coalesce(p_description, '')), 'C');
$$;

DROP FUNCTION IF EXISTS public.build_organization_search_document(uuid) CASCADE;

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

CREATE OR REPLACE FUNCTION sync_organization_search_document(p_organization_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF p_organization_id IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = p_organization_id) THEN
    DELETE FROM organization_search_documents
    WHERE organization_id = p_organization_id;
    RETURN;
  END IF;

  INSERT INTO organization_search_documents (
    organization_id,
    name,
    name_normalized,
    type,
    type_normalized,
    description,
    description_normalized,
    flemish_fact_text,
    flemish_fact_text_normalized,
    sector_names,
    sector_names_normalized,
    primary_location_text,
    primary_location_text_normalized,
    location_text,
    location_text_normalized,
    us_network_status,
    us_network_status_normalized,
    search_text,
    search_tsv,
    updated_at
  )
  SELECT
    organization_id,
    name,
    name_normalized,
    type,
    type_normalized,
    description,
    description_normalized,
    flemish_fact_text,
    flemish_fact_text_normalized,
    sector_names,
    sector_names_normalized,
    primary_location_text,
    primary_location_text_normalized,
    location_text,
    location_text_normalized,
    us_network_status,
    us_network_status_normalized,
    search_text,
    search_tsv,
    updated_at
  FROM build_organization_search_document(p_organization_id)
  ON CONFLICT (organization_id) DO UPDATE
  SET
    name = EXCLUDED.name,
    name_normalized = EXCLUDED.name_normalized,
    type = EXCLUDED.type,
    type_normalized = EXCLUDED.type_normalized,
    description = EXCLUDED.description,
    description_normalized = EXCLUDED.description_normalized,
    flemish_fact_text = EXCLUDED.flemish_fact_text,
    flemish_fact_text_normalized = EXCLUDED.flemish_fact_text_normalized,
    sector_names = EXCLUDED.sector_names,
    sector_names_normalized = EXCLUDED.sector_names_normalized,
    primary_location_text = EXCLUDED.primary_location_text,
    primary_location_text_normalized = EXCLUDED.primary_location_text_normalized,
    location_text = EXCLUDED.location_text,
    location_text_normalized = EXCLUDED.location_text_normalized,
    us_network_status = EXCLUDED.us_network_status,
    us_network_status_normalized = EXCLUDED.us_network_status_normalized,
    search_text = EXCLUDED.search_text,
    search_tsv = EXCLUDED.search_tsv,
    updated_at = EXCLUDED.updated_at;
END;
$$;

CREATE OR REPLACE FUNCTION sync_organization_search_documents_bulk(organization_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  affected_organization_id uuid;
BEGIN
  IF organization_ids IS NULL THEN
    RETURN;
  END IF;

  FOR affected_organization_id IN
    SELECT DISTINCT organization_id_value
    FROM unnest(organization_ids) AS organization_id_value
    WHERE organization_id_value IS NOT NULL
  LOOP
    PERFORM sync_organization_search_document(affected_organization_id);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION sync_organization_search_document_from_organizations_trigger()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM sync_organization_search_document(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_sync_organization_search_document ON organizations;
CREATE TRIGGER tr_sync_organization_search_document
  AFTER INSERT OR UPDATE OF name, type, description, location_id, us_network_status
  ON organizations
  FOR EACH ROW
  EXECUTE FUNCTION sync_organization_search_document_from_organizations_trigger();

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
      d.flemish_fact_text,
      d.sector_names,
      d.primary_location_text,
      d.location_text,
      d.us_network_status,
      description_snippet.description_snippet,
      d.search_text,
      (d.name_normalized = p.normalized_query) AS exact_name_match,
      search_field_score(d.name, p.raw_query) AS name_score,
      search_field_score(d.type, p.raw_query) AS type_score,
      search_field_score(d.flemish_fact_text, p.raw_query) AS flemish_fact_score,
      search_field_score(d.sector_names, p.raw_query) AS sector_score,
      GREATEST(search_field_score(d.primary_location_text, p.raw_query), search_field_score(d.location_text, p.raw_query)) AS location_score,
      search_field_score(replace(d.us_network_status, '_', ' '), p.raw_query) AS status_score,
      search_field_score(description_snippet.description_snippet, p.raw_query) AS description_score,
      search_field_score(d.search_text, p.raw_query) AS text_score,
      GREATEST(ts_rank_cd(d.search_tsv, p.simple_query), ts_rank_cd(d.search_tsv, p.english_query)) AS ts_score,
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
        OR d.flemish_fact_text_normalized % p.normalized_query
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
          + 0.18 * s.flemish_fact_score
          + 0.10 * s.location_score
          + 0.08 * s.type_score
          + 0.08 * s.ts_score
        WHEN 'faceted' THEN
          0.12 * s.name_score
          + 0.12 * s.type_score
          + 0.24 * s.flemish_fact_score
          + 0.18 * s.sector_score
          + 0.14 * s.location_score
          + 0.10 * s.status_score
          + 0.08 * s.description_score
          + 0.12 * s.ts_score
        ELSE
          0.10 * s.name_score
          + 0.10 * s.type_score
          + 0.22 * s.flemish_fact_score
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
          ('flemish_connection'::text, s.flemish_fact_text, s.flemish_fact_score),
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
      OR s.flemish_fact_score >= 0.35
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

DROP TRIGGER IF EXISTS tr_mark_organization_embedding_dirty ON organizations;
CREATE TRIGGER tr_mark_organization_embedding_dirty
  BEFORE UPDATE OF name, type, description, location_id, us_network_status
  ON organizations
  FOR EACH ROW
  EXECUTE FUNCTION mark_organization_embedding_dirty();

ALTER TABLE public.organizations
  DROP COLUMN IF EXISTS flemish_link;

SELECT sync_organization_search_documents_bulk(ARRAY(SELECT id FROM organizations));
SELECT enqueue_dirty_organization_embedding_jobs();
