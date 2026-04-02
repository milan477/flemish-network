-- Phase 1 search upgrade: lexical retrieval substrate + rank-fusion primitives

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

CREATE OR REPLACE FUNCTION normalize_search_text(raw_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT lower(
    trim(
      regexp_replace(
        regexp_replace(coalesce(raw_text, ''), '[^[:alnum:][:space:]&/+.-]+', ' ', 'g'),
        '[[:space:]]+',
        ' ',
        'g'
      )
    )
  );
$$;

CREATE OR REPLACE FUNCTION build_people_search_tsv(
  p_name text,
  p_current_position text,
  p_occupation text,
  p_flemish_connection_names text,
  p_sector_names text,
  p_location_text text,
  p_bio text
)
RETURNS tsvector
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT
    setweight(to_tsvector('simple', coalesce(p_name, '')), 'A')
    || setweight(to_tsvector('english', coalesce(p_current_position, '')), 'A')
    || setweight(to_tsvector('english', coalesce(p_occupation, '')), 'B')
    || setweight(to_tsvector('simple', coalesce(p_flemish_connection_names, '')), 'A')
    || setweight(to_tsvector('simple', coalesce(p_sector_names, '')), 'B')
    || setweight(to_tsvector('simple', coalesce(p_location_text, '')), 'B')
    || setweight(to_tsvector('english', coalesce(p_bio, '')), 'C');
$$;

CREATE OR REPLACE FUNCTION search_field_score(field_value text, raw_query text)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  WITH normalized AS (
    SELECT
      normalize_search_text(field_value) AS field_text,
      normalize_search_text(raw_query) AS query_text
  )
  SELECT CASE
    WHEN field_text = '' OR query_text = '' THEN 0::double precision
    ELSE GREATEST(
      similarity(field_text, query_text),
      word_similarity(query_text, field_text),
      CASE
        WHEN field_text = query_text THEN 1.5
        WHEN field_text LIKE query_text || '%' THEN 1.2
        WHEN field_text LIKE '%' || query_text || '%' THEN 1.0
        ELSE 0
      END
    )
  END
  FROM normalized;
$$;

CREATE OR REPLACE FUNCTION best_matching_bio_sentence(source_text text, raw_query text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH sentences AS (
    SELECT trim(sentence) AS sentence
    FROM regexp_split_to_table(coalesce(source_text, ''), E'[.!?]+') AS sentence
    WHERE trim(sentence) <> ''
  ),
  ranked AS (
    SELECT
      sentence,
      search_field_score(sentence, raw_query) AS sentence_score
    FROM sentences
  )
  SELECT coalesce(
    (
      SELECT sentence
      FROM ranked
      ORDER BY sentence_score DESC, char_length(sentence) ASC
      LIMIT 1
    ),
    ''
  );
$$;

CREATE TABLE IF NOT EXISTS people_search_documents (
  person_id uuid PRIMARY KEY REFERENCES people(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '',
  name_normalized text NOT NULL DEFAULT '',
  current_position text NOT NULL DEFAULT '',
  current_position_normalized text NOT NULL DEFAULT '',
  occupation text NOT NULL DEFAULT '',
  occupation_normalized text NOT NULL DEFAULT '',
  bio text NOT NULL DEFAULT '',
  bio_normalized text NOT NULL DEFAULT '',
  flemish_connection_names text NOT NULL DEFAULT '',
  flemish_connection_names_normalized text NOT NULL DEFAULT '',
  sector_names text NOT NULL DEFAULT '',
  sector_names_normalized text NOT NULL DEFAULT '',
  location_text text NOT NULL DEFAULT '',
  location_text_normalized text NOT NULL DEFAULT '',
  search_text text NOT NULL DEFAULT '',
  search_tsv tsvector NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE people_search_documents ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE people_search_documents IS
  'Internal denormalized lexical retrieval substrate for people search.';

CREATE INDEX IF NOT EXISTS people_search_documents_search_tsv_idx
  ON people_search_documents USING gin (search_tsv);

CREATE INDEX IF NOT EXISTS people_search_documents_name_trgm_idx
  ON people_search_documents USING gin (name_normalized gin_trgm_ops);

CREATE INDEX IF NOT EXISTS people_search_documents_search_text_trgm_idx
  ON people_search_documents USING gin (search_text gin_trgm_ops);

CREATE INDEX IF NOT EXISTS people_search_documents_name_lookup_idx
  ON people_search_documents (name_normalized);

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
      SELECT string_agg(fc.name, ', ' ORDER BY fc.name) AS connection_names
      FROM person_flemish_connections pfc
      JOIN flemish_connections fc
        ON fc.id = pfc.flemish_connection_id
      WHERE pfc.person_id = p.id
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

CREATE OR REPLACE FUNCTION sync_person_search_document(p_person_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF p_person_id IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM people
    WHERE id = p_person_id
  ) THEN
    DELETE FROM people_search_documents
    WHERE person_id = p_person_id;
    RETURN;
  END IF;

  INSERT INTO people_search_documents (
    person_id,
    name,
    name_normalized,
    current_position,
    current_position_normalized,
    occupation,
    occupation_normalized,
    bio,
    bio_normalized,
    flemish_connection_names,
    flemish_connection_names_normalized,
    sector_names,
    sector_names_normalized,
    location_text,
    location_text_normalized,
    search_text,
    search_tsv,
    updated_at
  )
  SELECT
    person_id,
    name,
    name_normalized,
    current_position,
    current_position_normalized,
    occupation,
    occupation_normalized,
    bio,
    bio_normalized,
    flemish_connection_names,
    flemish_connection_names_normalized,
    sector_names,
    sector_names_normalized,
    location_text,
    location_text_normalized,
    search_text,
    search_tsv,
    updated_at
  FROM build_people_search_document(p_person_id)
  ON CONFLICT (person_id) DO UPDATE
  SET
    name = EXCLUDED.name,
    name_normalized = EXCLUDED.name_normalized,
    current_position = EXCLUDED.current_position,
    current_position_normalized = EXCLUDED.current_position_normalized,
    occupation = EXCLUDED.occupation,
    occupation_normalized = EXCLUDED.occupation_normalized,
    bio = EXCLUDED.bio,
    bio_normalized = EXCLUDED.bio_normalized,
    flemish_connection_names = EXCLUDED.flemish_connection_names,
    flemish_connection_names_normalized = EXCLUDED.flemish_connection_names_normalized,
    sector_names = EXCLUDED.sector_names,
    sector_names_normalized = EXCLUDED.sector_names_normalized,
    location_text = EXCLUDED.location_text,
    location_text_normalized = EXCLUDED.location_text_normalized,
    search_text = EXCLUDED.search_text,
    search_tsv = EXCLUDED.search_tsv,
    updated_at = EXCLUDED.updated_at;
END;
$$;

CREATE OR REPLACE FUNCTION sync_people_search_documents_bulk(person_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  affected_person_id uuid;
BEGIN
  IF person_ids IS NULL THEN
    RETURN;
  END IF;

  FOR affected_person_id IN
    SELECT DISTINCT person_id_value
    FROM unnest(person_ids) AS person_id_value
    WHERE person_id_value IS NOT NULL
  LOOP
    PERFORM sync_person_search_document(affected_person_id);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION sync_person_search_document_from_people_trigger()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM sync_person_search_document(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_sync_people_search_document ON people;
CREATE TRIGGER tr_sync_people_search_document
  AFTER INSERT OR UPDATE OF name, current_position, occupation, bio, location_id
  ON people
  FOR EACH ROW
  EXECUTE FUNCTION sync_person_search_document_from_people_trigger();

CREATE OR REPLACE FUNCTION sync_person_search_document_from_person_sectors_trigger()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  new_person_id uuid;
  old_person_id uuid;
BEGIN
  new_person_id := CASE
    WHEN TG_OP IN ('INSERT', 'UPDATE') THEN NEW.person_id
    ELSE NULL
  END;

  old_person_id := CASE
    WHEN TG_OP IN ('UPDATE', 'DELETE') THEN OLD.person_id
    ELSE NULL
  END;

  PERFORM sync_people_search_documents_bulk(
    ARRAY[
      new_person_id,
      old_person_id
    ]::uuid[]
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS tr_sync_people_search_document_person_sectors ON person_sectors;
CREATE TRIGGER tr_sync_people_search_document_person_sectors
  AFTER INSERT OR UPDATE OR DELETE
  ON person_sectors
  FOR EACH ROW
  EXECUTE FUNCTION sync_person_search_document_from_person_sectors_trigger();

CREATE OR REPLACE FUNCTION sync_people_search_documents_from_sector_trigger()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM sync_people_search_documents_bulk(
    ARRAY(
      SELECT ps.person_id
      FROM person_sectors ps
      WHERE ps.sector_id = COALESCE(NEW.id, OLD.id)
    )
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS tr_sync_people_search_document_sector ON sectors;
CREATE TRIGGER tr_sync_people_search_document_sector
  AFTER UPDATE OF name
  ON sectors
  FOR EACH ROW
  EXECUTE FUNCTION sync_people_search_documents_from_sector_trigger();

CREATE OR REPLACE FUNCTION sync_person_search_document_from_flemish_links_trigger()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  new_person_id uuid;
  old_person_id uuid;
BEGIN
  new_person_id := CASE
    WHEN TG_OP IN ('INSERT', 'UPDATE') THEN NEW.person_id
    ELSE NULL
  END;

  old_person_id := CASE
    WHEN TG_OP IN ('UPDATE', 'DELETE') THEN OLD.person_id
    ELSE NULL
  END;

  PERFORM sync_people_search_documents_bulk(
    ARRAY[
      new_person_id,
      old_person_id
    ]::uuid[]
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS tr_sync_people_search_document_flemish_links ON person_flemish_connections;
CREATE TRIGGER tr_sync_people_search_document_flemish_links
  AFTER INSERT OR UPDATE OR DELETE
  ON person_flemish_connections
  FOR EACH ROW
  EXECUTE FUNCTION sync_person_search_document_from_flemish_links_trigger();

CREATE OR REPLACE FUNCTION sync_people_search_documents_from_flemish_connection_trigger()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM sync_people_search_documents_bulk(
    ARRAY(
      SELECT pfc.person_id
      FROM person_flemish_connections pfc
      WHERE pfc.flemish_connection_id = COALESCE(NEW.id, OLD.id)
    )
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS tr_sync_people_search_document_flemish_connection ON flemish_connections;
CREATE TRIGGER tr_sync_people_search_document_flemish_connection
  AFTER UPDATE OF name, type
  ON flemish_connections
  FOR EACH ROW
  EXECUTE FUNCTION sync_people_search_documents_from_flemish_connection_trigger();

CREATE OR REPLACE FUNCTION sync_people_search_documents_from_location_trigger()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM sync_people_search_documents_bulk(
    ARRAY(
      SELECT p.id
      FROM people p
      WHERE p.location_id = COALESCE(NEW.id, OLD.id)
    )
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS tr_sync_people_search_document_location ON locations;
CREATE TRIGGER tr_sync_people_search_document_location
  AFTER UPDATE OF city, state
  ON locations
  FOR EACH ROW
  EXECUTE FUNCTION sync_people_search_documents_from_location_trigger();

INSERT INTO people_search_documents (
  person_id,
  name,
  name_normalized,
  current_position,
  current_position_normalized,
  occupation,
  occupation_normalized,
  bio,
  bio_normalized,
  flemish_connection_names,
  flemish_connection_names_normalized,
  sector_names,
  sector_names_normalized,
  location_text,
  location_text_normalized,
  search_text,
  search_tsv,
  updated_at
)
SELECT
  doc.person_id,
  doc.name,
  doc.name_normalized,
  doc.current_position,
  doc.current_position_normalized,
  doc.occupation,
  doc.occupation_normalized,
  doc.bio,
  doc.bio_normalized,
  doc.flemish_connection_names,
  doc.flemish_connection_names_normalized,
  doc.sector_names,
  doc.sector_names_normalized,
  doc.location_text,
  doc.location_text_normalized,
  doc.search_text,
  doc.search_tsv,
  doc.updated_at
FROM people p
CROSS JOIN LATERAL build_people_search_document(p.id) AS doc
ON CONFLICT (person_id) DO UPDATE
SET
  name = EXCLUDED.name,
  name_normalized = EXCLUDED.name_normalized,
  current_position = EXCLUDED.current_position,
  current_position_normalized = EXCLUDED.current_position_normalized,
  occupation = EXCLUDED.occupation,
  occupation_normalized = EXCLUDED.occupation_normalized,
  bio = EXCLUDED.bio,
  bio_normalized = EXCLUDED.bio_normalized,
  flemish_connection_names = EXCLUDED.flemish_connection_names,
  flemish_connection_names_normalized = EXCLUDED.flemish_connection_names_normalized,
  sector_names = EXCLUDED.sector_names,
  sector_names_normalized = EXCLUDED.sector_names_normalized,
  location_text = EXCLUDED.location_text,
  location_text_normalized = EXCLUDED.location_text_normalized,
  search_text = EXCLUDED.search_text,
  search_tsv = EXCLUDED.search_tsv,
  updated_at = EXCLUDED.updated_at;

CREATE OR REPLACE FUNCTION search_people_lexical(
  search_query text,
  search_route text DEFAULT 'exploratory',
  match_count int DEFAULT 50
)
RETURNS TABLE (
  person_id uuid,
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
      d.person_id,
      d.name,
      d.current_position,
      d.occupation,
      d.flemish_connection_names,
      d.sector_names,
      d.location_text,
      bio_snippet.bio_snippet,
      d.search_text,
      (d.name_normalized = p.normalized_query) AS exact_name_match,
      search_field_score(d.name, p.raw_query) AS name_score,
      search_field_score(d.current_position, p.raw_query) AS current_position_score,
      search_field_score(d.occupation, p.raw_query) AS occupation_score,
      search_field_score(d.flemish_connection_names, p.raw_query) AS flemish_connection_score,
      search_field_score(d.sector_names, p.raw_query) AS sector_score,
      search_field_score(d.location_text, p.raw_query) AS location_score,
      search_field_score(bio_snippet.bio_snippet, p.raw_query) AS bio_score,
      search_field_score(d.search_text, p.raw_query) AS text_score,
      GREATEST(
        ts_rank_cd(d.search_tsv, p.simple_query),
        ts_rank_cd(d.search_tsv, p.english_query)
      ) AS ts_score,
      p.resolved_route
    FROM people_search_documents d
    CROSS JOIN params p
    CROSS JOIN LATERAL (
      SELECT best_matching_bio_sentence(d.bio, p.raw_query) AS bio_snippet
    ) AS bio_snippet
    WHERE p.normalized_query <> ''
      AND (
        d.name_normalized = p.normalized_query
        OR d.search_tsv @@ p.simple_query
        OR d.search_tsv @@ p.english_query
        OR d.name_normalized % p.normalized_query
        OR d.search_text % p.normalized_query
        OR d.search_text LIKE '%' || p.normalized_query || '%'
      )
  ),
  matched AS (
    SELECT
      s.person_id,
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
          + 0.14 * s.current_position_score
          + 0.08 * s.flemish_connection_score
          + 0.05 * s.location_score
          + 0.08 * s.ts_score
        WHEN 'faceted' THEN
          0.12 * s.name_score
          + 0.14 * s.current_position_score
          + 0.14 * s.occupation_score
          + 0.18 * s.flemish_connection_score
          + 0.18 * s.sector_score
          + 0.14 * s.location_score
          + 0.10 * s.bio_score
          + 0.10 * s.ts_score
        ELSE
          0.10 * s.name_score
          + 0.16 * s.current_position_score
          + 0.10 * s.occupation_score
          + 0.12 * s.flemish_connection_score
          + 0.12 * s.sector_score
          + 0.12 * s.location_score
          + 0.16 * s.bio_score
          + 0.12 * s.ts_score
      END AS lexical_score
    FROM scored s
    CROSS JOIN LATERAL (
      SELECT field_name, field_text, field_score
      FROM (
        VALUES
          ('name'::text, s.name, s.name_score),
          ('current_position'::text, s.current_position, s.current_position_score),
          ('occupation'::text, s.occupation, s.occupation_score),
          ('flemish_connection'::text, s.flemish_connection_names, s.flemish_connection_score),
          ('sector'::text, s.sector_names, s.sector_score),
          ('location'::text, s.location_text, s.location_score),
          ('bio'::text, s.bio_snippet, s.bio_score)
      ) AS candidate(field_name, field_text, field_score)
      WHERE coalesce(field_text, '') <> ''
      ORDER BY field_score DESC, char_length(field_text) ASC
      LIMIT 1
    ) AS best
    WHERE s.exact_name_match
      OR s.ts_score > 0
      OR s.name_score >= 0.35
      OR s.text_score >= 0.35
      OR s.current_position_score >= 0.40
      OR s.flemish_connection_score >= 0.40
      OR s.sector_score >= 0.40
      OR s.location_score >= 0.40
      OR s.bio_score >= 0.45
  )
  SELECT
    person_id,
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
