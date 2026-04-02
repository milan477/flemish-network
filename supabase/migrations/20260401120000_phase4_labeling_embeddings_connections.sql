-- Phase 4: evidence-first labeling, structured embeddings, chunk vectors, and
-- conservative connection expansion.

SET search_path TO public, extensions;

ALTER TABLE locations
  ALTER COLUMN latitude DROP NOT NULL,
  ALTER COLUMN longitude DROP NOT NULL;

ALTER TABLE locations
  ADD COLUMN IF NOT EXISTS geocode_source text,
  ADD COLUMN IF NOT EXISTS geocoded_at timestamptz;

CREATE TABLE IF NOT EXISTS derived_label_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid REFERENCES people(id) ON DELETE CASCADE,
  discovered_contact_id uuid REFERENCES discovered_contacts(id) ON DELETE CASCADE,
  label_type text NOT NULL CHECK (
    label_type IN (
      'sector',
      'occupation',
      'flemish_entity',
      'us_location',
      'source_quality',
      'profile_confidence'
    )
  ),
  label_value text NOT NULL,
  normalized_value text NOT NULL,
  raw_value text,
  confidence numeric(5,2) NOT NULL DEFAULT 0,
  source text,
  method text,
  evidence_url text,
  evidence_excerpt text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  agent_run_id uuid REFERENCES agent_runs(id) ON DELETE SET NULL,
  dedupe_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  promoted_at timestamptz,
  CONSTRAINT derived_label_subject_check CHECK (
    (person_id IS NOT NULL AND discovered_contact_id IS NULL)
    OR (person_id IS NULL AND discovered_contact_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_derived_label_suggestions_dedupe
  ON derived_label_suggestions(dedupe_key);

CREATE INDEX IF NOT EXISTS idx_derived_label_suggestions_status
  ON derived_label_suggestions(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_derived_label_suggestions_person
  ON derived_label_suggestions(person_id, status, created_at DESC)
  WHERE person_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_derived_label_suggestions_discovered
  ON derived_label_suggestions(discovered_contact_id, status, created_at DESC)
  WHERE discovered_contact_id IS NOT NULL;

ALTER TABLE derived_label_suggestions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'derived_label_suggestions'
      AND policyname = 'Public read derived_label_suggestions'
  ) THEN
    CREATE POLICY "Public read derived_label_suggestions"
      ON derived_label_suggestions FOR SELECT TO anon, authenticated USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'derived_label_suggestions'
      AND policyname = 'Public update derived_label_suggestions'
  ) THEN
    CREATE POLICY "Public update derived_label_suggestions"
      ON derived_label_suggestions FOR UPDATE TO anon, authenticated USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'derived_label_suggestions'
      AND policyname = 'Public delete derived_label_suggestions'
  ) THEN
    CREATE POLICY "Public delete derived_label_suggestions"
      ON derived_label_suggestions FOR DELETE TO anon, authenticated USING (true);
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS person_text_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  chunk_type text NOT NULL CHECK (chunk_type IN ('bio', 'position', 'combined')),
  chunk_index integer NOT NULL DEFAULT 0,
  chunk_text text NOT NULL,
  embedding extensions.vector(768),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT person_text_chunks_unique_position UNIQUE (person_id, chunk_type, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_person_text_chunks_person
  ON person_text_chunks(person_id, chunk_type, chunk_index);

CREATE INDEX IF NOT EXISTS idx_person_text_chunks_embedding_hnsw
  ON person_text_chunks USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

ALTER TABLE person_text_chunks ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'person_text_chunks'
      AND policyname = 'Public read person_text_chunks'
  ) THEN
    CREATE POLICY "Public read person_text_chunks"
      ON person_text_chunks FOR SELECT TO anon, authenticated USING (true);
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS connection_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_person_id uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  to_person_id uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  suggestion_type text NOT NULL CHECK (suggestion_type IN ('semantic_peer')),
  confidence numeric(5,2) NOT NULL DEFAULT 0,
  strength numeric(5,2) NOT NULL DEFAULT 0,
  source text,
  evidence_url text,
  evidence_excerpt text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  agent_run_id uuid REFERENCES agent_runs(id) ON DELETE SET NULL,
  dedupe_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'dismissed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  CONSTRAINT connection_suggestions_distinct_people CHECK (from_person_id <> to_person_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_connection_suggestions_dedupe
  ON connection_suggestions(dedupe_key);

CREATE INDEX IF NOT EXISTS idx_connection_suggestions_status
  ON connection_suggestions(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_connection_suggestions_from_person
  ON connection_suggestions(from_person_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_connection_suggestions_to_person
  ON connection_suggestions(to_person_id, status, created_at DESC);

ALTER TABLE connection_suggestions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'connection_suggestions'
      AND policyname = 'Public read connection_suggestions'
  ) THEN
    CREATE POLICY "Public read connection_suggestions"
      ON connection_suggestions FOR SELECT TO anon, authenticated USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'connection_suggestions'
      AND policyname = 'Public update connection_suggestions'
  ) THEN
    CREATE POLICY "Public update connection_suggestions"
      ON connection_suggestions FOR UPDATE TO anon, authenticated USING (true);
  END IF;
END
$$;

ALTER TABLE connections
  ADD COLUMN IF NOT EXISTS evidence_url text,
  ADD COLUMN IF NOT EXISTS evidence_excerpt text,
  ADD COLUMN IF NOT EXISTS evidence_source text,
  ADD COLUMN IF NOT EXISTS evidence_key text;

CREATE INDEX IF NOT EXISTS idx_connections_relationship_type
  ON connections(relationship_type);

CREATE OR REPLACE FUNCTION set_phase4_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_set_derived_label_suggestions_updated_at ON derived_label_suggestions;
CREATE TRIGGER tr_set_derived_label_suggestions_updated_at
  BEFORE UPDATE ON derived_label_suggestions
  FOR EACH ROW
  EXECUTE FUNCTION set_phase4_updated_at();

DROP TRIGGER IF EXISTS tr_set_person_text_chunks_updated_at ON person_text_chunks;
CREATE TRIGGER tr_set_person_text_chunks_updated_at
  BEFORE UPDATE ON person_text_chunks
  FOR EACH ROW
  EXECUTE FUNCTION set_phase4_updated_at();

DROP TRIGGER IF EXISTS tr_set_connection_suggestions_updated_at ON connection_suggestions;
CREATE TRIGGER tr_set_connection_suggestions_updated_at
  BEFORE UPDATE ON connection_suggestions
  FOR EACH ROW
  EXECUTE FUNCTION set_phase4_updated_at();

CREATE OR REPLACE FUNCTION normalize_connection_entity_key(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT trim(
    regexp_replace(
      lower(
        regexp_replace(
          coalesce(p_text, ''),
          '[^a-z0-9]+',
          ' ',
          'g'
        )
      ),
      '\s+',
      ' ',
      'g'
    )
  );
$$;

CREATE OR REPLACE FUNCTION match_person_text_chunks(
  query_embedding extensions.vector(768),
  match_count integer DEFAULT 30,
  similarity_threshold float DEFAULT 0.3,
  exclude_person_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  person_id uuid,
  chunk_type text,
  chunk_index integer,
  chunk_text text,
  similarity float
)
LANGUAGE sql
SET search_path = public, extensions
AS $$
  SELECT
    c.id,
    c.person_id,
    c.chunk_type,
    c.chunk_index,
    c.chunk_text,
    1 - (c.embedding <=> query_embedding) AS similarity
  FROM person_text_chunks c
  WHERE c.embedding IS NOT NULL
    AND (exclude_person_id IS NULL OR c.person_id <> exclude_person_id)
    AND 1 - (c.embedding <=> query_embedding) > similarity_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
$$;

CREATE OR REPLACE FUNCTION discover_connections(
  p_types text[] DEFAULT ARRAY[
    'colleague',
    'alumni',
    'program_peer',
    'local_peer',
    'lab_peer',
    'event_peer'
  ]
)
RETURNS TABLE (
  relationship_type text,
  connections_found bigint,
  new_connections_created bigint,
  already_existed bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
WITH selected_types AS (
  SELECT DISTINCT lower(trim(value)) AS type
  FROM unnest(
    COALESCE(
      p_types,
      ARRAY['colleague', 'alumni', 'program_peer', 'local_peer', 'lab_peer', 'event_peer']
    )
  ) AS value
  WHERE lower(trim(value)) IN (
    'colleague',
    'alumni',
    'program_peer',
    'local_peer',
    'lab_peer',
    'event_peer'
  )
),
normalized_positions AS (
  SELECT
    p.id,
    trim(
      COALESCE(
        NULLIF(substring(p.current_position from '(?i)(?:\s+at\s+|\s+@\s+)(.+)$'), ''),
        p.current_position
      )
    ) AS organization_label,
    normalize_connection_entity_key(
      COALESCE(
        NULLIF(substring(p.current_position from '(?i)(?:\s+at\s+|\s+@\s+)(.+)$'), ''),
        p.current_position
      )
    ) AS organization_key
  FROM people p
  WHERE coalesce(trim(p.current_position), '') <> ''
),
candidate_colleagues AS (
  SELECT
    LEAST(p1.id, p2.id) AS from_person_id,
    GREATEST(p1.id, p2.id) AS to_person_id,
    'colleague'::text AS relationship_type,
    8::integer AS strength,
    NULL::text AS evidence_url,
    CONCAT(
      'Shared organization in current positions: ',
      COALESCE(NULLIF(p1.organization_label, ''), p1.organization_key)
    ) AS evidence_excerpt,
    'normalized_current_position'::text AS evidence_source,
    md5(
      CONCAT(
        'colleague|',
        LEAST(p1.id, p2.id)::text,
        '|',
        GREATEST(p1.id, p2.id)::text,
        '|',
        p1.organization_key
      )
    ) AS evidence_key
  FROM normalized_positions p1
  JOIN normalized_positions p2
    ON p1.id < p2.id
   AND p1.organization_key <> ''
   AND p1.organization_key = p2.organization_key
  WHERE EXISTS (SELECT 1 FROM selected_types WHERE type = 'colleague')
),
normalized_flemish_links AS (
  SELECT
    pfc.person_id,
    fc.name AS entity_name,
    coalesce(fc.type, 'other') AS entity_type,
    normalize_connection_entity_key(fc.name) AS entity_key
  FROM person_flemish_connections pfc
  JOIN flemish_connections fc
    ON fc.id = pfc.flemish_connection_id
  WHERE coalesce(trim(fc.name), '') <> ''
),
candidate_alumni AS (
  SELECT
    LEAST(c1.person_id, c2.person_id) AS from_person_id,
    GREATEST(c1.person_id, c2.person_id) AS to_person_id,
    'alumni'::text AS relationship_type,
    6::integer AS strength,
    NULL::text AS evidence_url,
    CONCAT('Shared Flemish university connection: ', c1.entity_name) AS evidence_excerpt,
    'normalized_flemish_connection'::text AS evidence_source,
    md5(
      CONCAT(
        'alumni|',
        LEAST(c1.person_id, c2.person_id)::text,
        '|',
        GREATEST(c1.person_id, c2.person_id)::text,
        '|',
        c1.entity_key
      )
    ) AS evidence_key
  FROM normalized_flemish_links c1
  JOIN normalized_flemish_links c2
    ON c1.person_id < c2.person_id
   AND c1.entity_type = 'university'
   AND c1.entity_key <> ''
   AND c1.entity_key = c2.entity_key
  WHERE EXISTS (SELECT 1 FROM selected_types WHERE type = 'alumni')
),
candidate_program_peers AS (
  SELECT
    LEAST(c1.person_id, c2.person_id) AS from_person_id,
    GREATEST(c1.person_id, c2.person_id) AS to_person_id,
    'program_peer'::text AS relationship_type,
    6::integer AS strength,
    NULL::text AS evidence_url,
    CONCAT('Shared fellowship or program connection: ', c1.entity_name) AS evidence_excerpt,
    'normalized_flemish_connection'::text AS evidence_source,
    md5(
      CONCAT(
        'program_peer|',
        LEAST(c1.person_id, c2.person_id)::text,
        '|',
        GREATEST(c1.person_id, c2.person_id)::text,
        '|',
        c1.entity_key
      )
    ) AS evidence_key
  FROM normalized_flemish_links c1
  JOIN normalized_flemish_links c2
    ON c1.person_id < c2.person_id
   AND c1.entity_type <> 'university'
   AND c1.entity_key <> ''
   AND c1.entity_key = c2.entity_key
  WHERE c1.entity_name ~* '(baef|fayat|fellow|fellowship|program|programme|exchange|scholar|foundation)'
    AND EXISTS (SELECT 1 FROM selected_types WHERE type = 'program_peer')
),
approved_discovery_evidence AS (
  SELECT
    dc.approved_person_id AS person_id,
    de.page_url,
    de.page_title,
    de.page_type,
    coalesce(
      NULLIF(trim(de.evidence_excerpt), ''),
      NULLIF(trim(de.raw_role_text), ''),
      NULLIF(trim(de.page_title), ''),
      de.page_url
    ) AS evidence_excerpt
  FROM discovery_evidence de
  JOIN discovered_contacts dc
    ON dc.id = de.discovered_contact_id
  WHERE dc.approved_person_id IS NOT NULL
),
candidate_lab_peers AS (
  SELECT
    LEAST(d1.person_id, d2.person_id) AS from_person_id,
    GREATEST(d1.person_id, d2.person_id) AS to_person_id,
    'lab_peer'::text AS relationship_type,
    5::integer AS strength,
    d1.page_url AS evidence_url,
    CONCAT(
      'Shared roster or lab evidence from ',
      COALESCE(NULLIF(d1.page_title, ''), d1.page_url)
    ) AS evidence_excerpt,
    'discovery_evidence'::text AS evidence_source,
    md5(
      CONCAT(
        'lab_peer|',
        LEAST(d1.person_id, d2.person_id)::text,
        '|',
        GREATEST(d1.person_id, d2.person_id)::text,
        '|',
        d1.page_url
      )
    ) AS evidence_key
  FROM approved_discovery_evidence d1
  JOIN approved_discovery_evidence d2
    ON d1.person_id < d2.person_id
   AND d1.page_url = d2.page_url
   AND d1.page_type = d2.page_type
  WHERE d1.page_type IN ('team_or_roster', 'lab_or_group_page')
    AND EXISTS (SELECT 1 FROM selected_types WHERE type = 'lab_peer')
),
candidate_event_peers AS (
  SELECT
    LEAST(d1.person_id, d2.person_id) AS from_person_id,
    GREATEST(d1.person_id, d2.person_id) AS to_person_id,
    'event_peer'::text AS relationship_type,
    4::integer AS strength,
    d1.page_url AS evidence_url,
    CONCAT(
      'Shared event roster evidence from ',
      COALESCE(NULLIF(d1.page_title, ''), d1.page_url)
    ) AS evidence_excerpt,
    'discovery_evidence'::text AS evidence_source,
    md5(
      CONCAT(
        'event_peer|',
        LEAST(d1.person_id, d2.person_id)::text,
        '|',
        GREATEST(d1.person_id, d2.person_id)::text,
        '|',
        d1.page_url
      )
    ) AS evidence_key
  FROM approved_discovery_evidence d1
  JOIN approved_discovery_evidence d2
    ON d1.person_id < d2.person_id
   AND d1.page_url = d2.page_url
   AND d1.page_type = d2.page_type
  WHERE d1.page_type = 'event_or_speaker_page'
    AND EXISTS (SELECT 1 FROM selected_types WHERE type = 'event_peer')
),
candidate_local_peers AS (
  SELECT
    LEAST(p1.id, p2.id) AS from_person_id,
    GREATEST(p1.id, p2.id) AS to_person_id,
    'local_peer'::text AS relationship_type,
    4::integer AS strength,
    NULL::text AS evidence_url,
    'Shared location and at least one sector'::text AS evidence_excerpt,
    'location_and_sector'::text AS evidence_source,
    md5(
      CONCAT(
        'local_peer|',
        LEAST(p1.id, p2.id)::text,
        '|',
        GREATEST(p1.id, p2.id)::text,
        '|',
        p1.location_id::text,
        '|',
        ps1.sector_id::text
      )
    ) AS evidence_key
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
),
candidates AS (
  SELECT * FROM candidate_colleagues
  UNION ALL
  SELECT * FROM candidate_alumni
  UNION ALL
  SELECT * FROM candidate_program_peers
  UNION ALL
  SELECT * FROM candidate_lab_peers
  UNION ALL
  SELECT * FROM candidate_event_peers
  UNION ALL
  SELECT * FROM candidate_local_peers
),
ranked_candidates AS (
  SELECT
    c.*,
    ROW_NUMBER() OVER (
      PARTITION BY c.from_person_id, c.to_person_id, c.relationship_type
      ORDER BY c.strength DESC, c.evidence_url NULLS LAST, c.evidence_key
    ) AS row_number
  FROM candidates c
),
best_candidates AS (
  SELECT
    from_person_id,
    to_person_id,
    relationship_type,
    strength,
    evidence_url,
    evidence_excerpt,
    evidence_source,
    evidence_key
  FROM ranked_candidates
  WHERE row_number = 1
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
  FROM best_candidates c
),
updated_existing AS (
  UPDATE connections target
  SET
    strength = GREATEST(coalesce(target.strength, 0), source.strength),
    evidence_url = COALESCE(target.evidence_url, source.evidence_url),
    evidence_excerpt = COALESCE(NULLIF(target.evidence_excerpt, ''), source.evidence_excerpt),
    evidence_source = COALESCE(target.evidence_source, source.evidence_source),
    evidence_key = COALESCE(target.evidence_key, source.evidence_key)
  FROM existing source
  WHERE source.already_exists
    AND target.relationship_type = source.relationship_type
    AND target.from_person_id IS NOT NULL
    AND target.to_person_id IS NOT NULL
    AND (
      (target.from_person_id = source.from_person_id AND target.to_person_id = source.to_person_id)
      OR
      (target.from_person_id = source.to_person_id AND target.to_person_id = source.from_person_id)
    )
  RETURNING source.relationship_type
),
inserted AS (
  INSERT INTO connections (
    from_person_id,
    to_person_id,
    relationship_type,
    strength,
    evidence_url,
    evidence_excerpt,
    evidence_source,
    evidence_key
  )
  SELECT
    from_person_id,
    to_person_id,
    relationship_type,
    strength,
    evidence_url,
    evidence_excerpt,
    evidence_source,
    evidence_key
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
  WHEN 'program_peer' THEN 3
  WHEN 'local_peer' THEN 4
  WHEN 'lab_peer' THEN 5
  WHEN 'event_peer' THEN 6
  ELSE 99
END;
$$;
