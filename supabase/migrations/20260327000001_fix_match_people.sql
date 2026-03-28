-- Fix match_people: remove available_for_lectures column reference (doesn't exist in DB)
SET search_path TO public, extensions;

DROP FUNCTION IF EXISTS match_people(vector, int, float);

CREATE OR REPLACE FUNCTION match_people(
  query_embedding vector(768),
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
    p.id, p.name, p.first_name, p.last_name,
    p.current_position, p.location_id,
    p.flemish_connection, p.bio, p.occupation,
    1 - (p.embedding <=> query_embedding) AS similarity
  FROM people p
  WHERE p.embedding IS NOT NULL
    AND 1 - (p.embedding <=> query_embedding) > similarity_threshold
  ORDER BY p.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
