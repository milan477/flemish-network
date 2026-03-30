CREATE OR REPLACE FUNCTION person_flemish_connection_summary(p_person_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT string_agg(fc.name, ', ' ORDER BY fc.name)
  FROM person_flemish_connections pfc
  JOIN flemish_connections fc
    ON fc.id = pfc.flemish_connection_id
  WHERE pfc.person_id = p_person_id;
$$;

DROP TRIGGER IF EXISTS tr_normalize_people_flemish_connection_text ON people;
DROP TRIGGER IF EXISTS tr_sync_person_flemish_connections_from_people_text ON people;

DROP FUNCTION IF EXISTS normalize_people_flemish_connection_text();
DROP FUNCTION IF EXISTS sync_person_flemish_connections_from_people_text();

DROP TRIGGER IF EXISTS tr_mark_embedding_dirty ON people;
CREATE TRIGGER tr_mark_embedding_dirty
  BEFORE UPDATE OF name, bio, current_position, occupation, location_id
  ON people
  FOR EACH ROW
  EXECUTE FUNCTION mark_embedding_dirty();

DROP FUNCTION IF EXISTS match_people(extensions.vector, int, float);

CREATE OR REPLACE FUNCTION match_people(
  query_embedding extensions.vector(768),
  match_count int DEFAULT 50,
  similarity_threshold float DEFAULT 0.3
)
RETURNS TABLE (
  id uuid,
  name text,
  first_name text,
  last_name text,
  current_position text,
  location_id uuid,
  flemish_connection text,
  bio text,
  occupation text,
  similarity float
)
LANGUAGE plpgsql
SET search_path TO public, extensions
AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    p.name,
    p.first_name,
    p.last_name,
    p.current_position,
    p.location_id,
    person_flemish_connection_summary(p.id) AS flemish_connection,
    p.bio,
    p.occupation,
    1 - (p.embedding <=> query_embedding) AS similarity
  FROM people p
  WHERE p.embedding IS NOT NULL
    AND 1 - (p.embedding <=> query_embedding) > similarity_threshold
  ORDER BY p.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

ALTER TABLE people
  DROP COLUMN IF EXISTS flemish_connection;
