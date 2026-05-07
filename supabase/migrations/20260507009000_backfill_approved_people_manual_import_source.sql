-- Keep approved profile provenance aligned with the reviewed pending source.
-- Older approval code wrote discovery_agent for all discovered_contacts rows,
-- including manual intake and CSV/XLSX imports.

UPDATE public.people person
SET data_source = CASE discovered.source
  WHEN 'manual' THEN 'manual'
  WHEN 'import' THEN 'csv_import'
  ELSE person.data_source
END
FROM public.discovered_contacts discovered
WHERE discovered.approved_person_id = person.id
  AND discovered.source IN ('manual', 'import')
  AND COALESCE(person.data_source, '') NOT IN ('manual', 'csv_import');
