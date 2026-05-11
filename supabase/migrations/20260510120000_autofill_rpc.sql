-- search_people_autofill: fast unified autofill over trigram-indexed
-- search-document tables. Replaces the un-indexed ILIKE chain on raw
-- people/organizations that produced p50 ~1s per keystroke.
--
-- Returns up to `lim` rows from each domain (people + organizations),
-- tagged with entity_type. Trigram GIN on name_normalized makes leading-`%`
-- patterns index-eligible (bitmap scan).

CREATE OR REPLACE FUNCTION search_people_autofill(
  q text,
  lim integer DEFAULT 8
)
RETURNS TABLE (
  entity_type text,
  id uuid,
  name text,
  subtitle text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH q_norm AS (
    SELECT normalize_search_text(q) AS n
  ),
  people_hits AS (
    SELECT
      'person'::text AS entity_type,
      psd.person_id AS id,
      COALESCE(NULLIF(p.name, ''), TRIM(CONCAT(p.first_name, ' ', p.last_name))) AS name,
      NULLIF(p.current_position, '') AS subtitle,
      similarity(psd.name_normalized, (SELECT n FROM q_norm)) AS sim
    FROM people_search_documents psd
    JOIN people p ON p.id = psd.person_id
    WHERE psd.name_normalized ILIKE '%' || (SELECT n FROM q_norm) || '%'
    ORDER BY sim DESC NULLS LAST
    LIMIT GREATEST(lim, 1)
  ),
  org_hits AS (
    SELECT
      'organization'::text AS entity_type,
      osd.organization_id AS id,
      o.name AS name,
      NULLIF(o.type, '') AS subtitle,
      similarity(osd.name_normalized, (SELECT n FROM q_norm)) AS sim
    FROM organization_search_documents osd
    JOIN organizations o ON o.id = osd.organization_id
    WHERE osd.name_normalized ILIKE '%' || (SELECT n FROM q_norm) || '%'
    ORDER BY sim DESC NULLS LAST
    LIMIT GREATEST(lim, 1)
  )
  SELECT entity_type, id, name, subtitle FROM people_hits
  UNION ALL
  SELECT entity_type, id, name, subtitle FROM org_hits;
$$;

REVOKE ALL ON FUNCTION search_people_autofill(text, integer) FROM public;
GRANT EXECUTE ON FUNCTION search_people_autofill(text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION search_people_autofill(text, integer) TO service_role;

COMMENT ON FUNCTION search_people_autofill(text, integer) IS
  'Trigram-indexed unified autofill over people_search_documents + organization_search_documents. Returns up to `lim` rows per domain tagged with entity_type.';
