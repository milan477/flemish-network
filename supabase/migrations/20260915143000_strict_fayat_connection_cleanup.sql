-- Treat the Fayat programme as one canonical person connection. Programme
-- sponsorship is source context, not a Flemish Government affiliation.

SET search_path TO public, extensions;

INSERT INTO public.flemish_connections (
  name,
  type,
  entity_type,
  connection_group,
  is_filterable
)
VALUES (
  'Fayat Scholarship',
  'other'::flemish_connection_type,
  'other'::flemish_connection_type,
  'funding_exchange',
  true
)
ON CONFLICT (normalized_name) DO UPDATE
SET
  name = EXCLUDED.name,
  type = EXCLUDED.type,
  entity_type = EXCLUDED.entity_type,
  connection_group = EXCLUDED.connection_group,
  is_filterable = EXCLUDED.is_filterable,
  updated_at = now();

CREATE TEMP TABLE strict_fayat_duplicate_ids (
  id uuid PRIMARY KEY
) ON COMMIT DROP;

INSERT INTO strict_fayat_duplicate_ids (id)
SELECT id
FROM public.flemish_connections
WHERE normalized_name IN (
  'fayatbeurzen',
  'fayat scholarships',
  'fayat fellowship'
)
AND normalized_name <> 'fayat scholarship';

INSERT INTO public.person_flemish_connections (
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
  link.person_id,
  canonical.id,
  link.role,
  link.confidence,
  link.source_url,
  link.evidence_excerpt,
  link.created_at,
  now()
FROM public.person_flemish_connections link
JOIN strict_fayat_duplicate_ids duplicate
  ON duplicate.id = link.flemish_connection_id
CROSS JOIN LATERAL (
  SELECT id
  FROM public.flemish_connections
  WHERE normalized_name = 'fayat scholarship'
  LIMIT 1
) canonical
ON CONFLICT (person_id, flemish_connection_id) DO UPDATE
SET
  role = COALESCE(public.person_flemish_connections.role, EXCLUDED.role),
  confidence = GREATEST(
    COALESCE(public.person_flemish_connections.confidence, 0),
    COALESCE(EXCLUDED.confidence, 0)
  ),
  source_url = COALESCE(public.person_flemish_connections.source_url, EXCLUDED.source_url),
  evidence_excerpt = COALESCE(public.person_flemish_connections.evidence_excerpt, EXCLUDED.evidence_excerpt),
  updated_at = now();

INSERT INTO public.organization_flemish_connections (
  organization_id,
  flemish_connection_id,
  role,
  confidence,
  source_url,
  evidence_excerpt,
  created_at,
  updated_at
)
SELECT
  link.organization_id,
  canonical.id,
  link.role,
  link.confidence,
  link.source_url,
  link.evidence_excerpt,
  link.created_at,
  now()
FROM public.organization_flemish_connections link
JOIN strict_fayat_duplicate_ids duplicate
  ON duplicate.id = link.flemish_connection_id
CROSS JOIN LATERAL (
  SELECT id
  FROM public.flemish_connections
  WHERE normalized_name = 'fayat scholarship'
  LIMIT 1
) canonical
ON CONFLICT (organization_id, flemish_connection_id) DO UPDATE
SET
  role = COALESCE(public.organization_flemish_connections.role, EXCLUDED.role),
  confidence = GREATEST(
    COALESCE(public.organization_flemish_connections.confidence, 0),
    COALESCE(EXCLUDED.confidence, 0)
  ),
  source_url = COALESCE(public.organization_flemish_connections.source_url, EXCLUDED.source_url),
  evidence_excerpt = COALESCE(public.organization_flemish_connections.evidence_excerpt, EXCLUDED.evidence_excerpt),
  updated_at = now();

UPDATE public.flemish_connections child
SET parent_id = canonical.id
FROM strict_fayat_duplicate_ids duplicate
CROSS JOIN LATERAL (
  SELECT id
  FROM public.flemish_connections
  WHERE normalized_name = 'fayat scholarship'
  LIMIT 1
) canonical
WHERE child.parent_id = duplicate.id;

DELETE FROM public.person_flemish_connections link
USING strict_fayat_duplicate_ids duplicate
WHERE link.flemish_connection_id = duplicate.id;

DELETE FROM public.organization_flemish_connections link
USING strict_fayat_duplicate_ids duplicate
WHERE link.flemish_connection_id = duplicate.id;

DELETE FROM public.flemish_connection_aliases alias
USING strict_fayat_duplicate_ids duplicate
WHERE alias.flemish_connection_id = duplicate.id;

DELETE FROM public.flemish_connections connection
USING strict_fayat_duplicate_ids duplicate
WHERE connection.id = duplicate.id;

DELETE FROM public.flemish_connection_aliases
WHERE normalized_alias IN (
  'fayat',
  'fayatbeurzen',
  'fayat scholarships',
  'fayat fellowship'
);

INSERT INTO public.flemish_connection_aliases (
  flemish_connection_id,
  alias,
  source,
  status,
  confidence
)
SELECT
  connection.id,
  alias_name,
  'migration',
  'approved',
  1
FROM public.flemish_connections connection
CROSS JOIN (
  VALUES
    ('Fayat'),
    ('Fayatbeurzen'),
    ('Fayat Scholarships'),
    ('Fayat Fellowship')
) aliases(alias_name)
WHERE connection.normalized_name = 'fayat scholarship'
ON CONFLICT (flemish_connection_id, normalized_alias) DO UPDATE
SET
  status = 'approved',
  confidence = 1,
  updated_at = now();

INSERT INTO public.flemish_connections (
  name,
  type,
  entity_type,
  connection_group,
  is_filterable
)
VALUES (
  'Belgian',
  'other'::flemish_connection_type,
  'other'::flemish_connection_type,
  'nationality_origin',
  false
)
ON CONFLICT (normalized_name) DO UPDATE
SET
  type = EXCLUDED.type,
  entity_type = EXCLUDED.entity_type,
  connection_group = EXCLUDED.connection_group,
  updated_at = now();

CREATE OR REPLACE FUNCTION public.extract_person_flemish_connection_entities_strict(
  raw_text text
)
RETURNS TABLE (
  name text,
  type flemish_connection_type
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
WITH tokens AS (
  SELECT trim(token) AS token
  FROM regexp_split_to_table(
    coalesce(raw_text, ''),
    E'[,;|\\n]+'
  ) token
  WHERE trim(token) <> ''
),
matches AS (
  SELECT extracted.name, extracted.type, tokens.token
  FROM tokens
  CROSS JOIN LATERAL extract_flemish_connection_entities(tokens.token) extracted
)
SELECT DISTINCT matches.name, matches.type
FROM matches
WHERE matches.name <> 'Belgian'
   OR normalize_flemish_connection_key(matches.token) IN (
     'belgian',
     'belgian national',
     'from belgium'
   )
ORDER BY matches.name;
$$;

CREATE OR REPLACE FUNCTION public.refresh_person_flemish_connections(
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
  FROM extract_person_flemish_connection_entities_strict(p_raw_text) AS extracted
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
    connection.id,
    'affiliation',
    NULLIF(trim(p_raw_text), '')
  FROM extract_person_flemish_connection_entities_strict(p_raw_text) AS extracted
  JOIN flemish_connections connection
    ON connection.normalized_name = normalize_flemish_connection_key(extracted.name)
  ON CONFLICT (person_id, flemish_connection_id) DO UPDATE
  SET
    role = COALESCE(person_flemish_connections.role, EXCLUDED.role),
    evidence_excerpt = COALESCE(person_flemish_connections.evidence_excerpt, EXCLUDED.evidence_excerpt),
    updated_at = now();
END;
$$;

-- Remove the sponsor affiliation created by the old Fayat discovery text. A
-- genuine Government link with non-Fayat evidence is retained.
DELETE FROM public.person_flemish_connections government_link
USING public.flemish_connections government_connection
WHERE government_link.flemish_connection_id = government_connection.id
  AND government_connection.normalized_name = 'flemish government'
  AND government_link.role = 'discovery_review'
  AND coalesce(government_link.evidence_excerpt, '') ~* 'fayat'
  AND EXISTS (
    SELECT 1
    FROM public.person_flemish_connections fayat_link
    JOIN public.flemish_connections fayat_connection
      ON fayat_connection.id = fayat_link.flemish_connection_id
    WHERE fayat_link.person_id = government_link.person_id
      AND fayat_connection.normalized_name = 'fayat scholarship'
  );

UPDATE public.person_flemish_connections link
SET
  role = 'laureate',
  evidence_excerpt = 'Fayat Scholarship',
  updated_at = now()
FROM public.flemish_connections connection
WHERE link.flemish_connection_id = connection.id
  AND connection.normalized_name = 'fayat scholarship'
  AND coalesce(link.evidence_excerpt, '') ~* 'fayat';

-- Education was a hard-coded discovery default for the imported roster. It is
-- removed and may be re-added only when current professional evidence supports it.
DELETE FROM public.person_sectors person_sector
USING public.sectors sector
WHERE person_sector.sector_id = sector.id
  AND sector.name = 'Education'
  AND EXISTS (
    SELECT 1
    FROM public.person_flemish_connections link
    JOIN public.flemish_connections connection
      ON connection.id = link.flemish_connection_id
    WHERE link.person_id = person_sector.person_id
      AND connection.normalized_name = 'fayat scholarship'
  );

UPDATE public.people person
SET occupation = NULL
WHERE lower(trim(coalesce(person.occupation, ''))) IN (
  'fayat scholarship laureate',
  'fayatbeurzen laureate'
)
AND EXISTS (
  SELECT 1
  FROM public.person_flemish_connections link
  JOIN public.flemish_connections connection
    ON connection.id = link.flemish_connection_id
  WHERE link.person_id = person.id
    AND connection.normalized_name = 'fayat scholarship'
);

UPDATE public.discovered_contacts
SET
  occupation = NULL,
  current_position = NULL,
  location_city = NULL,
  location_state = NULL,
  flemish_connection = 'Fayat Scholarship',
  sectors = NULL,
  suggested_us_network_status = NULL,
  suggested_us_network_confidence = NULL,
  current_location_city = NULL,
  current_location_country = NULL,
  profile_photo_url = NULL,
  verification_status = 'queued',
  verification_payload = NULL,
  verification_run_id = NULL,
  verified_at = NULL
WHERE source = 'official_fayat_directory'
  AND approved_person_id IS NULL;
