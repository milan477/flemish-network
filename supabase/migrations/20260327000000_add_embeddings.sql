-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- Make vector types resolvable without schema prefix
SET search_path TO public, extensions;

-- Add embedding columns to people
ALTER TABLE people ADD COLUMN embedding vector(768);
ALTER TABLE people ADD COLUMN embedding_dirty_at timestamptz DEFAULT now();
ALTER TABLE people ADD COLUMN embedding_generated_at timestamptz;

-- HNSW index for fast similarity search
CREATE INDEX people_embedding_hnsw_idx
  ON people USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Trigger: mark embedding dirty when relevant fields change
CREATE OR REPLACE FUNCTION mark_embedding_dirty()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.embedding_dirty_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER tr_mark_embedding_dirty
  BEFORE UPDATE OF name, bio, current_position, flemish_connection, occupation, location_id
  ON people
  FOR EACH ROW
  EXECUTE FUNCTION mark_embedding_dirty();

-- Mark embedding dirty when person_sectors changes
CREATE OR REPLACE FUNCTION mark_person_embedding_dirty_from_sector()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE people SET embedding_dirty_at = now()
  WHERE id = COALESCE(NEW.person_id, OLD.person_id);
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER tr_mark_embedding_dirty_sector_insert
  AFTER INSERT ON person_sectors
  FOR EACH ROW
  EXECUTE FUNCTION mark_person_embedding_dirty_from_sector();

CREATE TRIGGER tr_mark_embedding_dirty_sector_delete
  AFTER DELETE ON person_sectors
  FOR EACH ROW
  EXECUTE FUNCTION mark_person_embedding_dirty_from_sector();

-- Similarity search function (SET search_path ensures vector ops resolve at call time)
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
  available_for_lectures boolean,
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
    p.available_for_lectures,
    1 - (p.embedding <=> query_embedding) AS similarity
  FROM people p
  WHERE p.embedding IS NOT NULL
    AND 1 - (p.embedding <=> query_embedding) > similarity_threshold
  ORDER BY p.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
