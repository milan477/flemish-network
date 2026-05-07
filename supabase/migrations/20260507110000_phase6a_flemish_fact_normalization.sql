-- Phase 6A: canonical Flemish/Belgian facts, aliases, and organization fact backfill.

SET search_path TO public, extensions;

ALTER TABLE public.flemish_connections
  ADD COLUMN IF NOT EXISTS entity_type flemish_connection_type,
  ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES public.flemish_connections(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS connection_group text,
  ADD COLUMN IF NOT EXISTS is_filterable boolean NOT NULL DEFAULT false;

UPDATE flemish_connections
SET entity_type = COALESCE(entity_type, type);

ALTER TABLE flemish_connections
  ALTER COLUMN entity_type SET DEFAULT 'other'::flemish_connection_type,
  ALTER COLUMN entity_type SET NOT NULL;

CREATE INDEX IF NOT EXISTS flemish_connections_entity_type_idx
  ON flemish_connections(entity_type);

CREATE INDEX IF NOT EXISTS flemish_connections_filterable_idx
  ON flemish_connections(is_filterable, name)
  WHERE is_filterable;

CREATE INDEX IF NOT EXISTS flemish_connections_parent_idx
  ON flemish_connections(parent_id)
  WHERE parent_id IS NOT NULL;

ALTER TABLE public.person_flemish_connections
  ADD COLUMN IF NOT EXISTS role text,
  ADD COLUMN IF NOT EXISTS confidence numeric(5,2),
  ADD COLUMN IF NOT EXISTS source_url text,
  ADD COLUMN IF NOT EXISTS evidence_excerpt text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS public.flemish_connection_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flemish_connection_id uuid NOT NULL REFERENCES public.flemish_connections(id) ON DELETE CASCADE,
  alias text NOT NULL,
  normalized_alias text GENERATED ALWAYS AS (
    lower(regexp_replace(trim(alias), '\s+', ' ', 'g'))
  ) STORED,
  source text NOT NULL DEFAULT 'seed' CHECK (source IN ('seed', 'staff', 'model', 'migration')),
  status text NOT NULL DEFAULT 'approved' CHECK (status IN ('pending', 'approved', 'rejected')),
  confidence numeric(5,2),
  source_url text,
  evidence_excerpt text,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT flemish_connection_aliases_alias_not_blank CHECK (char_length(trim(alias)) > 0),
  CONSTRAINT flemish_connection_aliases_confidence_range CHECK (
    confidence IS NULL OR (confidence >= 0 AND confidence <= 1)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS flemish_connection_aliases_normalized_alias_approved_idx
  ON flemish_connection_aliases(normalized_alias)
  WHERE status = 'approved';

CREATE UNIQUE INDEX IF NOT EXISTS flemish_connection_aliases_connection_alias_idx
  ON flemish_connection_aliases(flemish_connection_id, normalized_alias);

CREATE INDEX IF NOT EXISTS flemish_connection_aliases_connection_idx
  ON flemish_connection_aliases(flemish_connection_id);

CREATE INDEX IF NOT EXISTS flemish_connection_aliases_status_idx
  ON flemish_connection_aliases(status, source, created_at DESC);

CREATE TABLE IF NOT EXISTS public.organization_flemish_connections (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  flemish_connection_id uuid NOT NULL REFERENCES public.flemish_connections(id) ON DELETE CASCADE,
  role text,
  confidence numeric(5,2),
  source_url text,
  evidence_excerpt text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, flemish_connection_id),
  CONSTRAINT organization_flemish_connections_confidence_range CHECK (
    confidence IS NULL OR (confidence >= 0 AND confidence <= 1)
  )
);

CREATE INDEX IF NOT EXISTS organization_flemish_connections_organization_idx
  ON organization_flemish_connections(organization_id);

CREATE INDEX IF NOT EXISTS organization_flemish_connections_connection_idx
  ON organization_flemish_connections(flemish_connection_id);

ALTER TABLE public.flemish_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flemish_connection_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_flemish_connections ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION normalize_flemish_connection_key(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT lower(regexp_replace(trim(coalesce(p_text, '')), '\s+', ' ', 'g'));
$$;

CREATE OR REPLACE FUNCTION set_phase6a_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_set_person_flemish_connections_updated_at ON person_flemish_connections;
CREATE TRIGGER tr_set_person_flemish_connections_updated_at
  BEFORE UPDATE ON person_flemish_connections
  FOR EACH ROW
  EXECUTE FUNCTION set_phase6a_updated_at();

DROP TRIGGER IF EXISTS tr_set_flemish_connection_aliases_updated_at ON flemish_connection_aliases;
CREATE TRIGGER tr_set_flemish_connection_aliases_updated_at
  BEFORE UPDATE ON flemish_connection_aliases
  FOR EACH ROW
  EXECUTE FUNCTION set_phase6a_updated_at();

DROP TRIGGER IF EXISTS tr_set_organization_flemish_connections_updated_at
  ON organization_flemish_connections;
CREATE TRIGGER tr_set_organization_flemish_connections_updated_at
  BEFORE UPDATE ON organization_flemish_connections
  FOR EACH ROW
  EXECUTE FUNCTION set_phase6a_updated_at();

CREATE OR REPLACE FUNCTION lookup_flemish_connection(p_name_or_alias text)
RETURNS TABLE (
  id uuid,
  name text,
  type flemish_connection_type,
  entity_type flemish_connection_type,
  is_filterable boolean,
  matched_on text
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH normalized AS (
    SELECT normalize_flemish_connection_key(p_name_or_alias) AS value
  ),
  canonical AS (
    SELECT
      fc.id,
      fc.name,
      fc.type,
      fc.entity_type,
      fc.is_filterable,
      'name'::text AS matched_on,
      1 AS rank
    FROM flemish_connections fc
    JOIN normalized n
      ON fc.normalized_name = n.value
    WHERE n.value <> ''
  ),
  alias AS (
    SELECT
      fc.id,
      fc.name,
      fc.type,
      fc.entity_type,
      fc.is_filterable,
      'alias'::text AS matched_on,
      2 AS rank
    FROM flemish_connection_aliases fca
    JOIN flemish_connections fc
      ON fc.id = fca.flemish_connection_id
    JOIN normalized n
      ON fca.normalized_alias = n.value
    WHERE n.value <> ''
      AND fca.status = 'approved'
  )
  SELECT id, name, type, entity_type, is_filterable, matched_on
  FROM (
    SELECT *
    FROM canonical
    UNION ALL
    SELECT *
    FROM alias
  ) matches
  ORDER BY rank, name
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION ensure_flemish_connection(
  p_name text,
  p_type flemish_connection_type DEFAULT 'other'::flemish_connection_type,
  p_is_filterable boolean DEFAULT false,
  p_connection_group text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NULLIF(trim(coalesce(p_name, '')), '') IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT l.id
  INTO v_id
  FROM lookup_flemish_connection(p_name) l
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    UPDATE flemish_connections
    SET
      type = CASE
        WHEN flemish_connections.type = 'other' AND p_type <> 'other' THEN p_type
        ELSE flemish_connections.type
      END,
      entity_type = CASE
        WHEN flemish_connections.entity_type = 'other' AND p_type <> 'other' THEN p_type
        ELSE flemish_connections.entity_type
      END,
      is_filterable = flemish_connections.is_filterable OR p_is_filterable,
      connection_group = COALESCE(flemish_connections.connection_group, p_connection_group),
      updated_at = now()
    WHERE flemish_connections.id = v_id;

    RETURN v_id;
  END IF;

  INSERT INTO flemish_connections (name, type, entity_type, is_filterable, connection_group)
  VALUES (trim(p_name), p_type, p_type, p_is_filterable, p_connection_group)
  ON CONFLICT (normalized_name) DO UPDATE
  SET
    type = CASE
      WHEN flemish_connections.type = 'other' AND EXCLUDED.type <> 'other' THEN EXCLUDED.type
      ELSE flemish_connections.type
    END,
    entity_type = CASE
      WHEN flemish_connections.entity_type = 'other' AND EXCLUDED.entity_type <> 'other' THEN EXCLUDED.entity_type
      ELSE flemish_connections.entity_type
    END,
    is_filterable = flemish_connections.is_filterable OR EXCLUDED.is_filterable,
    connection_group = COALESCE(flemish_connections.connection_group, EXCLUDED.connection_group),
    updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION add_flemish_connection_alias(
  p_connection_name text,
  p_alias text,
  p_source text DEFAULT 'seed',
  p_status text DEFAULT 'approved',
  p_confidence numeric DEFAULT NULL,
  p_source_url text DEFAULT NULL,
  p_evidence_excerpt text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_connection_id uuid;
  v_alias_id uuid;
BEGIN
  SELECT l.id
  INTO v_connection_id
  FROM lookup_flemish_connection(p_connection_name) l
  LIMIT 1;

  IF v_connection_id IS NULL THEN
    v_connection_id := ensure_flemish_connection(p_connection_name, 'other', false, NULL);
  END IF;

  INSERT INTO flemish_connection_aliases (
    flemish_connection_id,
    alias,
    source,
    status,
    confidence,
    source_url,
    evidence_excerpt
  )
  VALUES (
    v_connection_id,
    trim(p_alias),
    COALESCE(NULLIF(trim(p_source), ''), 'seed'),
    COALESCE(NULLIF(trim(p_status), ''), 'approved'),
    p_confidence,
    p_source_url,
    p_evidence_excerpt
  )
  ON CONFLICT (flemish_connection_id, normalized_alias) DO UPDATE
  SET
    source = EXCLUDED.source,
    status = EXCLUDED.status,
    confidence = COALESCE(EXCLUDED.confidence, flemish_connection_aliases.confidence),
    source_url = COALESCE(EXCLUDED.source_url, flemish_connection_aliases.source_url),
    evidence_excerpt = COALESCE(EXCLUDED.evidence_excerpt, flemish_connection_aliases.evidence_excerpt),
    updated_at = now()
  RETURNING id INTO v_alias_id;

  RETURN v_alias_id;
END;
$$;

CREATE OR REPLACE FUNCTION canonicalize_flemish_connection_name(raw_name text)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  normalized text := normalize_flemish_connection_key(raw_name);
  matched_name text;
BEGIN
  IF normalized = '' THEN
    RETURN NULL;
  END IF;

  SELECT l.name
  INTO matched_name
  FROM lookup_flemish_connection(raw_name) l
  LIMIT 1;

  IF matched_name IS NOT NULL THEN
    RETURN matched_name;
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

  IF normalized ~ '((^|[^a-z])imec($|[^a-z])|interuniversity microelectronics centre)' THEN
    RETURN 'imec';
  END IF;

  IF normalized ~ '((^|[^a-z])baef($|[^a-z])|belgian american educational foundation)' THEN
    RETURN 'BAEF';
  END IF;

  IF normalized ~ '(flemish government|government of flanders|flanders government)' THEN
    RETURN 'Flemish Government';
  END IF;

  IF normalized ~ '(flanders investment ?& ?trade|flanders investment and trade|(^|[^a-z])fit($|[^a-z]))' THEN
    RETURN 'FIT';
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
STABLE
SET search_path = public
AS $$
WITH source AS (
  SELECT trim(coalesce(raw_text, '')) AS text_value
),
alias_matches AS (
  SELECT DISTINCT fc.name, fc.entity_type AS type
  FROM source
  JOIN flemish_connection_aliases fca
    ON fca.status = 'approved'
   AND normalize_flemish_connection_key(source.text_value) LIKE '%' || fca.normalized_alias || '%'
  JOIN flemish_connections fc
    ON fc.id = fca.flemish_connection_id
),
canonical_matches AS (
  SELECT DISTINCT fc.name, fc.entity_type AS type
  FROM source
  JOIN flemish_connections fc
    ON normalize_flemish_connection_key(source.text_value) LIKE '%' || fc.normalized_name || '%'
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
      ('imec'::text, 'company'::flemish_connection_type, '(^|[^a-z])(imec|interuniversity microelectronics centre)($|[^a-z])'),
      ('BAEF'::text, 'other'::flemish_connection_type, '(^|[^a-z])(baef|belgian american educational foundation)($|[^a-z])'),
      ('Flemish Government'::text, 'government'::flemish_connection_type, '(flemish government|government of flanders|flanders government)'),
      ('FIT'::text, 'government'::flemish_connection_type, '(flanders investment ?& ?trade|flanders investment and trade|(^|[^a-z])fit($|[^a-z]))')
  ) AS known(name, type, pattern)
  WHERE lower(source.text_value) ~ known.pattern
),
generic_tokens AS (
  SELECT DISTINCT
    trim(
      regexp_replace(
        regexp_replace(token, '^[,;:. -]+|[,;:. -]+$', '', 'g'),
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
    AND array_length(regexp_split_to_array(raw_token, '\s+'), 1) <= 8
    AND raw_token !~* '(authored|report|detailed|ecosystem|innovation|chapter|article|paper|study)'
    AND (
      raw_token ~* '(flem|belg|leuven|ghent|gent|brussel|brussels|antwerp|antwerpen|hasselt|imec|baef|flanders|vlaanderen|vub|vlerick|vito|vib)'
      OR raw_token ~* '(university|universiteit|government|ministry|company|foundation|association|institute|centre|center|agency|fellow(ship)?)'
    )
),
all_matches AS (
  SELECT * FROM alias_matches
  UNION
  SELECT * FROM canonical_matches
  UNION
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
SELECT name, type
FROM ranked_matches
WHERE name IS NOT NULL
  AND rn = 1
ORDER BY name;
$$;

CREATE OR REPLACE FUNCTION canonicalize_flemish_connection_text(raw_text text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
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

CREATE OR REPLACE FUNCTION refresh_person_flemish_connections(
  p_person_id uuid,
  p_raw_text text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM person_flemish_connections
  WHERE person_id = p_person_id;

  INSERT INTO flemish_connections (name, type, entity_type, is_filterable)
  SELECT
    extracted.name,
    extracted.type,
    extracted.type,
    false
  FROM extract_flemish_connection_entities(p_raw_text) AS extracted
  ON CONFLICT (normalized_name) DO UPDATE
  SET
    type = CASE
      WHEN flemish_connections.type = 'other' AND EXCLUDED.type <> 'other' THEN EXCLUDED.type
      ELSE flemish_connections.type
    END,
    entity_type = CASE
      WHEN flemish_connections.entity_type = 'other' AND EXCLUDED.entity_type <> 'other' THEN EXCLUDED.entity_type
      ELSE flemish_connections.entity_type
    END,
    updated_at = now();

  INSERT INTO person_flemish_connections (
    person_id,
    flemish_connection_id,
    role,
    evidence_excerpt
  )
  SELECT
    p_person_id,
    fc.id,
    'affiliation',
    NULLIF(trim(p_raw_text), '')
  FROM extract_flemish_connection_entities(p_raw_text) AS extracted
  JOIN flemish_connections fc
    ON fc.normalized_name = normalize_flemish_connection_key(extracted.name)
  ON CONFLICT (person_id, flemish_connection_id) DO UPDATE
  SET
    role = COALESCE(person_flemish_connections.role, EXCLUDED.role),
    evidence_excerpt = COALESCE(person_flemish_connections.evidence_excerpt, EXCLUDED.evidence_excerpt),
    updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION upsert_organization_flemish_connections_from_text(
  p_organization_id uuid,
  p_raw_text text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted_count integer := 0;
BEGIN
  IF p_organization_id IS NULL OR NULLIF(trim(coalesce(p_raw_text, '')), '') IS NULL THEN
    RETURN 0;
  END IF;

  INSERT INTO flemish_connections (name, type, entity_type, is_filterable)
  SELECT
    extracted.name,
    extracted.type,
    extracted.type,
    false
  FROM extract_flemish_connection_entities(p_raw_text) AS extracted
  ON CONFLICT (normalized_name) DO UPDATE
  SET
    type = CASE
      WHEN flemish_connections.type = 'other' AND EXCLUDED.type <> 'other' THEN EXCLUDED.type
      ELSE flemish_connections.type
    END,
    entity_type = CASE
      WHEN flemish_connections.entity_type = 'other' AND EXCLUDED.entity_type <> 'other' THEN EXCLUDED.entity_type
      ELSE flemish_connections.entity_type
    END,
    updated_at = now();

  WITH extracted AS (
    SELECT name
    FROM extract_flemish_connection_entities(p_raw_text)
  ),
  upserted AS (
    INSERT INTO organization_flemish_connections (
      organization_id,
      flemish_connection_id,
      role,
      confidence,
      evidence_excerpt
    )
    SELECT
      p_organization_id,
      fc.id,
      'relevance',
      CASE WHEN fc.is_filterable THEN 0.90 ELSE 0.60 END,
      NULLIF(trim(p_raw_text), '')
    FROM extracted
    JOIN flemish_connections fc
      ON fc.normalized_name = normalize_flemish_connection_key(extracted.name)
    ON CONFLICT (organization_id, flemish_connection_id) DO UPDATE
    SET
      role = COALESCE(organization_flemish_connections.role, EXCLUDED.role),
      confidence = COALESCE(organization_flemish_connections.confidence, EXCLUDED.confidence),
      evidence_excerpt = COALESCE(organization_flemish_connections.evidence_excerpt, EXCLUDED.evidence_excerpt),
      updated_at = now()
    RETURNING 1
  )
  SELECT COUNT(*) INTO inserted_count FROM upserted;

  IF inserted_count = 0 THEN
    WITH raw_connection AS (
      SELECT ensure_flemish_connection(left(trim(p_raw_text), 180), 'other', false, 'migration_raw') AS id
    ),
    raw_alias AS (
      SELECT add_flemish_connection_alias(
        left(trim(p_raw_text), 180),
        left(trim(p_raw_text), 240),
        'migration',
        'pending',
        0.40,
        NULL,
        trim(p_raw_text)
      )
    ),
    upserted_raw AS (
      INSERT INTO organization_flemish_connections (
        organization_id,
        flemish_connection_id,
        role,
        confidence,
        evidence_excerpt
      )
      SELECT
        p_organization_id,
        raw_connection.id,
        'raw_relevance',
        0.40,
        trim(p_raw_text)
      FROM raw_connection
      CROSS JOIN raw_alias
      WHERE raw_connection.id IS NOT NULL
      ON CONFLICT (organization_id, flemish_connection_id) DO UPDATE
      SET
        role = COALESCE(organization_flemish_connections.role, EXCLUDED.role),
        confidence = COALESCE(organization_flemish_connections.confidence, EXCLUDED.confidence),
        evidence_excerpt = COALESCE(organization_flemish_connections.evidence_excerpt, EXCLUDED.evidence_excerpt),
        updated_at = now()
      RETURNING 1
    )
    SELECT COUNT(*) INTO inserted_count FROM upserted_raw;
  END IF;

  RETURN inserted_count;
END;
$$;

WITH seeds(name, type, connection_group) AS (
  VALUES
    ('KU Leuven', 'university'::flemish_connection_type, 'education_research'),
    ('UGent', 'university'::flemish_connection_type, 'education_research'),
    ('imec', 'company'::flemish_connection_type, 'innovation_research'),
    ('BAEF', 'other'::flemish_connection_type, 'funding_exchange'),
    ('Flemish Government', 'government'::flemish_connection_type, 'government_trade'),
    ('FIT', 'government'::flemish_connection_type, 'government_trade'),
    ('VUB', 'university'::flemish_connection_type, 'education_research'),
    ('Vlerick', 'university'::flemish_connection_type, 'education_research'),
    ('VITO', 'company'::flemish_connection_type, 'innovation_research'),
    ('Flanders Make', 'company'::flemish_connection_type, 'innovation_research'),
    ('VIB', 'company'::flemish_connection_type, 'innovation_research')
)
INSERT INTO flemish_connections (name, type, entity_type, connection_group, is_filterable)
SELECT name, type, type, connection_group, true
FROM seeds
ON CONFLICT (normalized_name) DO UPDATE
SET
  name = EXCLUDED.name,
  type = EXCLUDED.type,
  entity_type = EXCLUDED.entity_type,
  connection_group = EXCLUDED.connection_group,
  is_filterable = true,
  updated_at = now();

SELECT add_flemish_connection_alias('KU Leuven', alias, 'seed', 'approved', 1, NULL, NULL)
FROM (VALUES
  ('Katholieke Universiteit Leuven'),
  ('Catholic University of Leuven')
) AS aliases(alias);

SELECT add_flemish_connection_alias('UGent', alias, 'seed', 'approved', 1, NULL, NULL)
FROM (VALUES
  ('University of Ghent'),
  ('Ghent University'),
  ('Universiteit Gent')
) AS aliases(alias);

SELECT add_flemish_connection_alias('imec', alias, 'seed', 'approved', 1, NULL, NULL)
FROM (VALUES
  ('Interuniversity Microelectronics Centre'),
  ('IMEC')
) AS aliases(alias);

SELECT add_flemish_connection_alias('BAEF', alias, 'seed', 'approved', 1, NULL, NULL)
FROM (VALUES
  ('Belgian American Educational Foundation')
) AS aliases(alias);

SELECT add_flemish_connection_alias('Flemish Government', alias, 'seed', 'approved', 1, NULL, NULL)
FROM (VALUES
  ('Government of Flanders'),
  ('Flanders Government'),
  ('Vlaamse overheid')
) AS aliases(alias);

SELECT add_flemish_connection_alias('FIT', alias, 'seed', 'approved', 1, NULL, NULL)
FROM (VALUES
  ('Flanders Investment & Trade'),
  ('Flanders Investment and Trade'),
  ('Flanders Investment Trade')
) AS aliases(alias);

SELECT add_flemish_connection_alias('VUB', alias, 'seed', 'approved', 1, NULL, NULL)
FROM (VALUES
  ('Vrije Universiteit Brussel'),
  ('Free University of Brussels')
) AS aliases(alias);

SELECT add_flemish_connection_alias('Vlerick', alias, 'seed', 'approved', 1, NULL, NULL)
FROM (VALUES
  ('Vlerick Business School')
) AS aliases(alias);

SELECT add_flemish_connection_alias('VITO', alias, 'seed', 'approved', 1, NULL, NULL)
FROM (VALUES
  ('Flemish Institute for Technological Research'),
  ('Vlaamse Instelling voor Technologisch Onderzoek')
) AS aliases(alias);

SELECT add_flemish_connection_alias('Flanders Make', alias, 'seed', 'approved', 1, NULL, NULL)
FROM (VALUES
  ('Flanders Make strategic research centre')
) AS aliases(alias);

SELECT add_flemish_connection_alias('VIB', alias, 'seed', 'approved', 1, NULL, NULL)
FROM (VALUES
  ('Vlaams Instituut voor Biotechnologie'),
  ('Flanders Institute for Biotechnology')
) AS aliases(alias);

WITH duplicate_pairs AS (
  SELECT old_fc.id AS old_id, new_fc.id AS new_id
  FROM flemish_connections old_fc
  JOIN flemish_connection_aliases fca
    ON fca.normalized_alias = old_fc.normalized_name
   AND fca.status = 'approved'
  JOIN flemish_connections new_fc
    ON new_fc.id = fca.flemish_connection_id
  WHERE old_fc.id <> new_fc.id
    AND new_fc.is_filterable
),
person_moved AS (
  INSERT INTO person_flemish_connections (
    person_id,
    flemish_connection_id,
    role,
    confidence,
    source_url,
    evidence_excerpt,
    created_at,
    updated_at
  )
  SELECT
    pfc.person_id,
    dp.new_id,
    pfc.role,
    pfc.confidence,
    pfc.source_url,
    pfc.evidence_excerpt,
    pfc.created_at,
    now()
  FROM person_flemish_connections pfc
  JOIN duplicate_pairs dp
    ON dp.old_id = pfc.flemish_connection_id
  ON CONFLICT (person_id, flemish_connection_id) DO UPDATE
  SET
    role = COALESCE(person_flemish_connections.role, EXCLUDED.role),
    confidence = COALESCE(person_flemish_connections.confidence, EXCLUDED.confidence),
    source_url = COALESCE(person_flemish_connections.source_url, EXCLUDED.source_url),
    evidence_excerpt = COALESCE(person_flemish_connections.evidence_excerpt, EXCLUDED.evidence_excerpt),
    updated_at = now()
  RETURNING 1
)
DELETE FROM person_flemish_connections pfc
USING duplicate_pairs dp
WHERE pfc.flemish_connection_id = dp.old_id;

SELECT upsert_organization_flemish_connections_from_text(
  organizations.id,
  organizations.flemish_link
)
FROM public.organizations AS organizations
WHERE NULLIF(trim(coalesce(organizations.flemish_link, '')), '') IS NOT NULL;

CREATE OR REPLACE FUNCTION mark_person_embedding_dirty_from_flemish_connection()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  UPDATE people
  SET embedding_dirty_at = now()
  WHERE id = COALESCE(NEW.person_id, OLD.person_id);

  PERFORM enqueue_person_embedding_job(COALESCE(NEW.person_id, OLD.person_id));

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS tr_mark_embedding_dirty_person_flemish_update ON person_flemish_connections;
CREATE TRIGGER tr_mark_embedding_dirty_person_flemish_update
  AFTER UPDATE OF flemish_connection_id, role, confidence, source_url, evidence_excerpt
  ON person_flemish_connections
  FOR EACH ROW
  EXECUTE FUNCTION mark_person_embedding_dirty_from_flemish_connection();

CREATE OR REPLACE FUNCTION sync_person_search_document_from_phase6a_flemish_links_trigger()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM sync_person_search_document(COALESCE(NEW.person_id, OLD.person_id));
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS tr_sync_people_search_document_flemish_links ON person_flemish_connections;
CREATE TRIGGER tr_sync_people_search_document_flemish_links
  AFTER INSERT OR UPDATE OR DELETE
  ON person_flemish_connections
  FOR EACH ROW
  EXECUTE FUNCTION sync_person_search_document_from_phase6a_flemish_links_trigger();

CREATE OR REPLACE FUNCTION mark_organization_embedding_dirty_from_flemish_connection()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM mark_organization_embedding_dirty_bulk(
    ARRAY[COALESCE(NEW.organization_id, OLD.organization_id)]::uuid[]
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS tr_mark_embedding_dirty_organization_flemish_insert
  ON organization_flemish_connections;
CREATE TRIGGER tr_mark_embedding_dirty_organization_flemish_insert
  AFTER INSERT ON organization_flemish_connections
  FOR EACH ROW
  EXECUTE FUNCTION mark_organization_embedding_dirty_from_flemish_connection();

DROP TRIGGER IF EXISTS tr_mark_embedding_dirty_organization_flemish_update
  ON organization_flemish_connections;
CREATE TRIGGER tr_mark_embedding_dirty_organization_flemish_update
  AFTER UPDATE OF flemish_connection_id, role, confidence, source_url, evidence_excerpt
  ON organization_flemish_connections
  FOR EACH ROW
  EXECUTE FUNCTION mark_organization_embedding_dirty_from_flemish_connection();

DROP TRIGGER IF EXISTS tr_mark_embedding_dirty_organization_flemish_delete
  ON organization_flemish_connections;
CREATE TRIGGER tr_mark_embedding_dirty_organization_flemish_delete
  AFTER DELETE ON organization_flemish_connections
  FOR EACH ROW
  EXECUTE FUNCTION mark_organization_embedding_dirty_from_flemish_connection();

CREATE OR REPLACE FUNCTION sync_organization_search_document_from_flemish_links_trigger()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM sync_organization_search_document(COALESCE(NEW.organization_id, OLD.organization_id));
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS tr_sync_organization_search_document_flemish_links
  ON organization_flemish_connections;
CREATE TRIGGER tr_sync_organization_search_document_flemish_links
  AFTER INSERT OR UPDATE OR DELETE
  ON organization_flemish_connections
  FOR EACH ROW
  EXECUTE FUNCTION sync_organization_search_document_from_flemish_links_trigger();

CREATE OR REPLACE FUNCTION refresh_records_from_flemish_connection_catalog_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  affected_connection_id uuid;
  affected_person_ids uuid[];
  affected_organization_ids uuid[];
BEGIN
  IF TG_TABLE_NAME = 'flemish_connection_aliases' THEN
    affected_connection_id := COALESCE(NEW.flemish_connection_id, OLD.flemish_connection_id);
  ELSE
    affected_connection_id := COALESCE(NEW.id, OLD.id);
  END IF;

  SELECT ARRAY(
    SELECT pfc.person_id
    FROM person_flemish_connections pfc
    WHERE pfc.flemish_connection_id = affected_connection_id
  )
  INTO affected_person_ids;

  SELECT ARRAY(
    SELECT ofc.organization_id
    FROM organization_flemish_connections ofc
    WHERE ofc.flemish_connection_id = affected_connection_id
  )
  INTO affected_organization_ids;

  PERFORM sync_people_search_documents_bulk(
    affected_person_ids
  );

  PERFORM sync_organization_search_documents_bulk(
    affected_organization_ids
  );

  UPDATE people
  SET embedding_dirty_at = now()
  WHERE id = ANY(affected_person_ids);

  PERFORM enqueue_people_embedding_jobs(affected_person_ids);

  PERFORM mark_organization_embedding_dirty_bulk(
    affected_organization_ids
  );

  PERFORM enqueue_organization_embedding_jobs(affected_organization_ids);

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS tr_refresh_records_flemish_connection_aliases
  ON flemish_connection_aliases;
CREATE TRIGGER tr_refresh_records_flemish_connection_aliases
  AFTER INSERT OR UPDATE OR DELETE
  ON flemish_connection_aliases
  FOR EACH ROW
  EXECUTE FUNCTION refresh_records_from_flemish_connection_catalog_change();

DROP TRIGGER IF EXISTS tr_refresh_records_flemish_connection_catalog
  ON flemish_connections;
CREATE TRIGGER tr_refresh_records_flemish_connection_catalog
  AFTER UPDATE OF name, type, entity_type, is_filterable
  ON flemish_connections
  FOR EACH ROW
  EXECUTE FUNCTION refresh_records_from_flemish_connection_catalog_change();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.flemish_connection_aliases TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_flemish_connections TO authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_flemish_connection(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_flemish_connection(text, flemish_connection_type, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_flemish_connection_alias(text, text, text, text, numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_organization_flemish_connections_from_text(uuid, text) TO authenticated;

-- RLS write policies use public.has_staff_role('editor').
DO $$
DECLARE
  policy_name text;
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'flemish_connections',
    'person_flemish_connections',
    'flemish_connection_aliases',
    'organization_flemish_connections'
  ] LOOP
    FOR policy_name IN
      SELECT p.policyname
      FROM pg_policies p
      WHERE p.schemaname = 'public'
        AND p.tablename = table_name
        AND (
          p.policyname LIKE 'Public %'
          OR p.policyname LIKE 'Staff can read %'
          OR p.policyname LIKE 'Editors can insert %'
          OR p.policyname LIKE 'Editors can update %'
          OR p.policyname LIKE 'Editors can delete %'
        )
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', policy_name, table_name);
    END LOOP;

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_active_staff())',
      'Staff can read ' || table_name,
      table_name
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.has_staff_role(''editor''))',
      'Editors can insert ' || table_name,
      table_name
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.has_staff_role(''editor'')) WITH CHECK (public.has_staff_role(''editor''))',
      'Editors can update ' || table_name,
      table_name
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.has_staff_role(''editor''))',
      'Editors can delete ' || table_name,
      table_name
    );
  END LOOP;
END $$;

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

UPDATE people
SET embedding_dirty_at = COALESCE(embedding_dirty_at, updated_at, created_at, now())
WHERE id IN (
  SELECT DISTINCT person_id
  FROM person_flemish_connections
);

UPDATE organizations
SET embedding_dirty_at = COALESCE(embedding_dirty_at, updated_at, created_at, now())
WHERE id IN (
  SELECT DISTINCT organization_id
  FROM organization_flemish_connections
);

SELECT enqueue_dirty_embedding_jobs();
SELECT enqueue_dirty_organization_embedding_jobs();
