DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'flemish_connection_type'
  ) THEN
    CREATE TYPE flemish_connection_type AS ENUM (
      'university',
      'government',
      'company',
      'other'
    );
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS flemish_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  type flemish_connection_type NOT NULL DEFAULT 'other',
  normalized_name text GENERATED ALWAYS AS (
    lower(regexp_replace(trim(name), '\s+', ' ', 'g'))
  ) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT flemish_connections_name_not_blank CHECK (char_length(trim(name)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS flemish_connections_normalized_name_idx
  ON flemish_connections (normalized_name);

CREATE TABLE IF NOT EXISTS person_flemish_connections (
  person_id uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  flemish_connection_id uuid NOT NULL REFERENCES flemish_connections(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (person_id, flemish_connection_id)
);

CREATE INDEX IF NOT EXISTS person_flemish_connections_person_idx
  ON person_flemish_connections (person_id);

CREATE INDEX IF NOT EXISTS person_flemish_connections_connection_idx
  ON person_flemish_connections (flemish_connection_id);

ALTER TABLE flemish_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE person_flemish_connections ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'flemish_connections'
      AND policyname = 'Public read flemish_connections'
  ) THEN
    CREATE POLICY "Public read flemish_connections"
      ON flemish_connections FOR SELECT TO anon, authenticated USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'flemish_connections'
      AND policyname = 'Public insert flemish_connections'
  ) THEN
    CREATE POLICY "Public insert flemish_connections"
      ON flemish_connections FOR INSERT TO anon, authenticated WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'flemish_connections'
      AND policyname = 'Public update flemish_connections'
  ) THEN
    CREATE POLICY "Public update flemish_connections"
      ON flemish_connections FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'person_flemish_connections'
      AND policyname = 'Public read person_flemish_connections'
  ) THEN
    CREATE POLICY "Public read person_flemish_connections"
      ON person_flemish_connections FOR SELECT TO anon, authenticated USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'person_flemish_connections'
      AND policyname = 'Public insert person_flemish_connections'
  ) THEN
    CREATE POLICY "Public insert person_flemish_connections"
      ON person_flemish_connections FOR INSERT TO anon, authenticated WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'person_flemish_connections'
      AND policyname = 'Public delete person_flemish_connections'
  ) THEN
    CREATE POLICY "Public delete person_flemish_connections"
      ON person_flemish_connections FOR DELETE TO anon, authenticated USING (true);
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION set_flemish_connections_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_set_flemish_connections_updated_at ON flemish_connections;
CREATE TRIGGER tr_set_flemish_connections_updated_at
  BEFORE UPDATE ON flemish_connections
  FOR EACH ROW
  EXECUTE FUNCTION set_flemish_connections_updated_at();

CREATE OR REPLACE FUNCTION infer_flemish_connection_type(connection_name text)
RETURNS flemish_connection_type
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  normalized text := lower(trim(coalesce(connection_name, '')));
BEGIN
  IF normalized = '' THEN
    RETURN 'other';
  END IF;

  IF normalized ~ '(university|universiteit|college|campus)' THEN
    RETURN 'university';
  END IF;

  IF normalized ~ '(government|ministry|department|delegation|agency|embassy|consulate|public)' THEN
    RETURN 'government';
  END IF;

  IF normalized ~ '(^imec$|inc\b|llc\b|ltd\b|corp\b|corporation|company|technologies|labs?\b|group|ventures|industries)' THEN
    RETURN 'company';
  END IF;

  RETURN 'other';
END;
$$;

CREATE OR REPLACE FUNCTION canonicalize_flemish_connection_name(raw_name text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  normalized text := lower(trim(regexp_replace(coalesce(raw_name, ''), '\s+', ' ', 'g')));
BEGIN
  IF normalized = '' THEN
    RETURN NULL;
  END IF;

  IF normalized ~ '(ku\s*leuven|katholieke universiteit leuven|catholic university of leuven)' THEN
    RETURN 'KU Leuven';
  END IF;

  IF normalized ~ '((^|[^a-z])ugent($|[^a-z])|ghent university|university of ghent|universiteit gent)' THEN
    RETURN 'UGent';
  END IF;

  IF normalized ~ '((^|[^a-z])vub($|[^a-z])|vrije universiteit brussel)' THEN
    RETURN 'VUB';
  END IF;

  IF normalized ~ '((^|[^a-z])uantwerp($|[^a-z])|university of antwerp|universiteit antwerpen|universiteit van antwerpen)' THEN
    RETURN 'UAntwerp';
  END IF;

  IF normalized ~ '((^|[^a-z])uhasselt($|[^a-z])|hasselt university|universiteit hasselt)' THEN
    RETURN 'UHasselt';
  END IF;

  IF normalized ~ '((^|[^a-z])imec($|[^a-z])|interuniversity microelectronics centre)' THEN
    RETURN 'imec';
  END IF;

  IF normalized ~ '((^|[^a-z])baef($|[^a-z])|belgian american educational foundation)' THEN
    RETURN 'BAEF';
  END IF;

  IF normalized ~ '(fayat|fayat fellowship)' THEN
    RETURN 'Fayat Fellowship';
  END IF;

  IF normalized ~ '(flemish government|government of flanders|flanders government)' THEN
    RETURN 'Flemish Government';
  END IF;

  IF normalized ~ '(flanders investment ?& ?trade|flanders investment and trade|(^|[^a-z])fit($|[^a-z]))' THEN
    RETURN 'Flanders Investment & Trade';
  END IF;

  RETURN initcap(normalized);
END;
$$;

CREATE OR REPLACE FUNCTION extract_flemish_connection_entities(raw_text text)
RETURNS TABLE (
  name text,
  type flemish_connection_type
)
LANGUAGE sql
IMMUTABLE
AS $$
WITH source AS (
  SELECT trim(coalesce(raw_text, '')) AS text_value
),
known_matches AS (
  SELECT DISTINCT
    known.name,
    known.type
  FROM source
  CROSS JOIN LATERAL (
    VALUES
      ('KU Leuven'::text, 'university'::flemish_connection_type, '(ku\s*leuven|katholieke universiteit leuven|catholic university of leuven)'),
      ('UGent'::text, 'university'::flemish_connection_type, '(^|[^a-z])(ugent|ghent university|university of ghent|universiteit gent)($|[^a-z])'),
      ('VUB'::text, 'university'::flemish_connection_type, '(^|[^a-z])(vub|vrije universiteit brussel)($|[^a-z])'),
      ('UAntwerp'::text, 'university'::flemish_connection_type, '(^|[^a-z])(uantwerp|university of antwerp|universiteit antwerpen|universiteit van antwerpen)($|[^a-z])'),
      ('UHasselt'::text, 'university'::flemish_connection_type, '(^|[^a-z])(uhasselt|hasselt university|universiteit hasselt)($|[^a-z])'),
      ('imec'::text, 'company'::flemish_connection_type, '(^|[^a-z])(imec|interuniversity microelectronics centre)($|[^a-z])'),
      ('BAEF'::text, 'other'::flemish_connection_type, '(^|[^a-z])(baef|belgian american educational foundation)($|[^a-z])'),
      ('Fayat Fellowship'::text, 'other'::flemish_connection_type, '(fayat|fayat fellowship)'),
      ('Flemish Government'::text, 'government'::flemish_connection_type, '(flemish government|government of flanders|flanders government)'),
      ('Flanders Investment & Trade'::text, 'government'::flemish_connection_type, '(flanders investment ?& ?trade|flanders investment and trade|(^|[^a-z])fit($|[^a-z]))')
  ) AS known(name, type, pattern)
  WHERE lower(source.text_value) ~ known.pattern
),
generic_tokens AS (
  SELECT DISTINCT
    trim(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(token, '^[,;:. -]+|[,;:. -]+$', '', 'g'),
            '^(researcher|professor|director|scientist|engineer|founder|ceo|cto|president|student|recipient|fellow(ship)?|alumn(us|a|i)?|member|visiting|former|current)\s+(at|of|with)?\s*',
            '',
            'i'
          ),
          '\s+(fellow(ship)?|programme|program)$',
          '',
          'i'
        ),
        '\s+',
        ' ',
        'g'
      )
    ) AS raw_token
  FROM source
  CROSS JOIN LATERAL regexp_split_to_table(
    regexp_replace(
      regexp_replace(
        regexp_replace(source.text_value, '\band\b', ',', 'gi'),
        '[;/|]+',
        ',',
        'g'
      ),
      E'\\n+',
      ',',
      'g'
    ),
    ','
  ) AS token
),
generic_matches AS (
  SELECT DISTINCT
    canonicalize_flemish_connection_name(raw_token) AS name,
    infer_flemish_connection_type(canonicalize_flemish_connection_name(raw_token)) AS type
  FROM generic_tokens
  WHERE raw_token <> ''
    AND raw_token ~* '[A-Za-z]'
    AND array_length(regexp_split_to_array(raw_token, '\s+'), 1) <= 6
    AND raw_token !~* '(authored|report|detailed|ecosystem|innovation|chapter|article|paper|study)'
    AND (
      raw_token ~* '(flem|belg|leuven|ghent|gent|brussel|brussels|antwerp|antwerpen|hasselt|imec|baef|flanders|vlaanderen|fayat)'
      OR raw_token ~* '(university|universiteit|government|ministry|company|foundation|association|institute|centre|center|agency|fellow(ship)?)'
    )
),
all_matches AS (
  SELECT * FROM known_matches
  UNION
  SELECT * FROM generic_matches
),
ranked_matches AS (
  SELECT
    name,
    type,
    row_number() OVER (
      PARTITION BY name
      ORDER BY CASE type
        WHEN 'university' THEN 1
        WHEN 'government' THEN 2
        WHEN 'company' THEN 3
        ELSE 4
      END
    ) AS rn
  FROM all_matches
)
SELECT
  name,
  type
FROM ranked_matches
WHERE name IS NOT NULL
  AND rn = 1
ORDER BY name;
$$;

CREATE OR REPLACE FUNCTION canonicalize_flemish_connection_text(raw_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
WITH extracted AS (
  SELECT name
  FROM extract_flemish_connection_entities(raw_text)
)
SELECT COALESCE(
  (
    SELECT string_agg(name, ', ' ORDER BY name)
    FROM extracted
  ),
  NULLIF(trim(coalesce(raw_text, '')), '')
);
$$;

CREATE OR REPLACE FUNCTION normalize_people_flemish_connection_text()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.flemish_connection := canonicalize_flemish_connection_text(NEW.flemish_connection);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_normalize_people_flemish_connection_text ON people;
CREATE TRIGGER tr_normalize_people_flemish_connection_text
  BEFORE INSERT OR UPDATE OF flemish_connection
  ON people
  FOR EACH ROW
  EXECUTE FUNCTION normalize_people_flemish_connection_text();

CREATE OR REPLACE FUNCTION refresh_person_flemish_connections(
  p_person_id uuid,
  p_raw_text text
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM person_flemish_connections
  WHERE person_id = p_person_id;

  INSERT INTO flemish_connections (name, type)
  SELECT
    extracted.name,
    extracted.type
  FROM extract_flemish_connection_entities(p_raw_text) AS extracted
  ON CONFLICT (normalized_name) DO UPDATE
  SET
    type = CASE
      WHEN flemish_connections.type = 'other' AND EXCLUDED.type <> 'other' THEN EXCLUDED.type
      ELSE flemish_connections.type
    END,
    updated_at = now();

  INSERT INTO person_flemish_connections (person_id, flemish_connection_id)
  SELECT
    p_person_id,
    fc.id
  FROM extract_flemish_connection_entities(p_raw_text) AS extracted
  JOIN flemish_connections fc
    ON fc.normalized_name = lower(regexp_replace(trim(extracted.name), '\s+', ' ', 'g'))
  ON CONFLICT DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION sync_person_flemish_connections_from_people_text()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM refresh_person_flemish_connections(NEW.id, NEW.flemish_connection);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_sync_person_flemish_connections_from_people_text ON people;
CREATE TRIGGER tr_sync_person_flemish_connections_from_people_text
  AFTER INSERT OR UPDATE OF flemish_connection
  ON people
  FOR EACH ROW
  EXECUTE FUNCTION sync_person_flemish_connections_from_people_text();

CREATE OR REPLACE FUNCTION mark_person_embedding_dirty_from_flemish_connection()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE people
  SET embedding_dirty_at = now()
  WHERE id = COALESCE(NEW.person_id, OLD.person_id);
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS tr_mark_embedding_dirty_person_flemish_insert ON person_flemish_connections;
CREATE TRIGGER tr_mark_embedding_dirty_person_flemish_insert
  AFTER INSERT ON person_flemish_connections
  FOR EACH ROW
  EXECUTE FUNCTION mark_person_embedding_dirty_from_flemish_connection();

DROP TRIGGER IF EXISTS tr_mark_embedding_dirty_person_flemish_delete ON person_flemish_connections;
CREATE TRIGGER tr_mark_embedding_dirty_person_flemish_delete
  AFTER DELETE ON person_flemish_connections
  FOR EACH ROW
  EXECUTE FUNCTION mark_person_embedding_dirty_from_flemish_connection();

CREATE OR REPLACE FUNCTION mark_people_embeddings_dirty_from_flemish_connection_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE people
  SET embedding_dirty_at = now()
  WHERE id IN (
    SELECT person_id
    FROM person_flemish_connections
    WHERE flemish_connection_id = NEW.id
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_mark_embedding_dirty_flemish_connection_update ON flemish_connections;
CREATE TRIGGER tr_mark_embedding_dirty_flemish_connection_update
  AFTER UPDATE OF name, type ON flemish_connections
  FOR EACH ROW
  EXECUTE FUNCTION mark_people_embeddings_dirty_from_flemish_connection_update();

UPDATE people
SET flemish_connection = canonicalize_flemish_connection_text(flemish_connection)
WHERE flemish_connection IS NOT NULL;

SELECT refresh_person_flemish_connections(id, flemish_connection)
FROM people
WHERE NULLIF(trim(coalesce(flemish_connection, '')), '') IS NOT NULL;

CREATE OR REPLACE FUNCTION discover_connections(
  p_types text[] DEFAULT ARRAY['colleague', 'alumni', 'local_peer']
)
RETURNS TABLE (
  relationship_type text,
  connections_found bigint,
  new_connections_created bigint,
  already_existed bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
WITH selected_types AS (
  SELECT DISTINCT lower(trim(value)) AS type
  FROM unnest(COALESCE(p_types, ARRAY['colleague', 'alumni', 'local_peer'])) AS value
  WHERE lower(trim(value)) IN ('colleague', 'alumni', 'local_peer')
),
normalized_positions AS (
  SELECT
    p.id,
    lower(
      trim(
        regexp_replace(
          COALESCE(
            NULLIF(substring(p.current_position from '(?i)(?:\s+at\s+|\s+@\s+)(.+)$'), ''),
            ''
          ),
          '\s+',
          ' ',
          'g'
        )
      )
    ) AS organization_key
  FROM people p
  WHERE p.current_position IS NOT NULL
),
candidate_colleagues AS (
  SELECT
    LEAST(p1.id, p2.id) AS from_person_id,
    GREATEST(p1.id, p2.id) AS to_person_id,
    'colleague'::text AS relationship_type,
    8::integer AS strength
  FROM normalized_positions p1
  JOIN normalized_positions p2
    ON p1.id < p2.id
   AND p1.organization_key <> ''
   AND p1.organization_key = p2.organization_key
  WHERE EXISTS (SELECT 1 FROM selected_types WHERE type = 'colleague')
),
normalized_connections AS (
  SELECT DISTINCT
    pfc.person_id,
    fc.normalized_name AS connection_key
  FROM person_flemish_connections pfc
  JOIN flemish_connections fc
    ON fc.id = pfc.flemish_connection_id
),
candidate_alumni AS (
  SELECT
    LEAST(c1.person_id, c2.person_id) AS from_person_id,
    GREATEST(c1.person_id, c2.person_id) AS to_person_id,
    'alumni'::text AS relationship_type,
    6::integer AS strength
  FROM normalized_connections c1
  JOIN normalized_connections c2
    ON c1.person_id < c2.person_id
   AND c1.connection_key <> ''
   AND c1.connection_key = c2.connection_key
  WHERE EXISTS (SELECT 1 FROM selected_types WHERE type = 'alumni')
  GROUP BY 1, 2, 3, 4
),
candidate_local_peers AS (
  SELECT
    LEAST(p1.id, p2.id) AS from_person_id,
    GREATEST(p1.id, p2.id) AS to_person_id,
    'local_peer'::text AS relationship_type,
    4::integer AS strength
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
  GROUP BY 1, 2, 3, 4
),
candidates AS (
  SELECT * FROM candidate_colleagues
  UNION
  SELECT * FROM candidate_alumni
  UNION
  SELECT * FROM candidate_local_peers
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
  FROM candidates c
),
inserted AS (
  INSERT INTO connections (
    from_person_id,
    to_person_id,
    relationship_type,
    strength
  )
  SELECT
    from_person_id,
    to_person_id,
    relationship_type,
    strength
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
  WHEN 'local_peer' THEN 3
  ELSE 99
END;
$$;
