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

UPDATE people
SET flemish_connection = canonicalize_flemish_connection_text(flemish_connection)
WHERE flemish_connection IS NOT NULL;

SELECT refresh_person_flemish_connections(id, flemish_connection)
FROM people;

DELETE FROM flemish_connections fc
WHERE NOT EXISTS (
  SELECT 1
  FROM person_flemish_connections pfc
  WHERE pfc.flemish_connection_id = fc.id
);
