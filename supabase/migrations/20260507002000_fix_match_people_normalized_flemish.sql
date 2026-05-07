-- Keep vector people search compatible with normalized Flemish ties.

SET search_path TO public, extensions;

DROP FUNCTION IF EXISTS match_people(vector, int, float);

CREATE OR REPLACE FUNCTION match_people(
  query_embedding vector(768),
  match_count int DEFAULT 50,
  similarity_threshold float DEFAULT 0.3
)
RETURNS TABLE (
  id uuid,
  similarity float
)
LANGUAGE plpgsql
SET search_path TO public, extensions
AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    1 - (p.embedding <=> query_embedding) AS similarity
  FROM people p
  WHERE p.embedding IS NOT NULL
    AND 1 - (p.embedding <=> query_embedding) > similarity_threshold
  ORDER BY p.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
