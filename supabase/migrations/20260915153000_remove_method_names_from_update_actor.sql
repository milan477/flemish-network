-- Update actors, like creation actors, must be people rather than method labels.

UPDATE public.people
SET updated_by_name = NULL,
    updated_by_staff_id = NULL
WHERE updated_by_name IN (
  'Automated discovery',
  'CSV import',
  'Self-reported',
  'Manual entry (actor unavailable)',
  'Unknown'
);

UPDATE public.people
SET
  updated_by_staff_id = created_by_staff_id,
  updated_by_name = created_by_name
WHERE updated_by_name IS NULL
  AND created_by_name IS NOT NULL
  AND updated_at = created_at;
