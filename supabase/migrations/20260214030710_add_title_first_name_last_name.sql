/*
  # Split name into title, first_name, last_name

  1. New Columns on `people`
    - `title` (text) - honorific/prefix such as Dr, Prof, Ms, Mr
    - `first_name` (text) - given name
    - `last_name` (text) - surname / family name

  2. Data Migration
    - Populate first_name and last_name from existing `name` column
    - Extract known title prefixes (Dr, Prof, Ms, Mr, Mrs, Miss) into `title`
    - Keep `name` column intact as a computed display name for backwards compatibility

  3. Important Notes
    - Existing data is preserved; `name` column is NOT dropped
    - first_name and last_name default to empty string
    - title defaults to empty string
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'people' AND column_name = 'title'
  ) THEN
    ALTER TABLE people ADD COLUMN title text DEFAULT '' NOT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'people' AND column_name = 'first_name'
  ) THEN
    ALTER TABLE people ADD COLUMN first_name text DEFAULT '' NOT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'people' AND column_name = 'last_name'
  ) THEN
    ALTER TABLE people ADD COLUMN last_name text DEFAULT '' NOT NULL;
  END IF;
END $$;

UPDATE people
SET
  title = CASE
    WHEN name ~* '^\s*(dr\.?|prof\.?|professor|ms\.?|mrs\.?|mr\.?|miss)\s+'
    THEN trim(regexp_replace(
      (regexp_match(name, '^\s*(dr\.?|prof\.?|professor|ms\.?|mrs\.?|mr\.?|miss)\s+', 'i'))[1],
      '\.$', ''
    ))
    ELSE ''
  END,
  first_name = CASE
    WHEN name ~* '^\s*(dr\.?|prof\.?|professor|ms\.?|mrs\.?|mr\.?|miss)\s+'
    THEN split_part(
      trim(regexp_replace(name, '^\s*(dr\.?|prof\.?|professor|ms\.?|mrs\.?|mr\.?|miss)\s+', '', 'i')),
      ' ', 1
    )
    ELSE split_part(trim(name), ' ', 1)
  END,
  last_name = CASE
    WHEN name ~* '^\s*(dr\.?|prof\.?|professor|ms\.?|mrs\.?|mr\.?|miss)\s+'
    THEN trim(substring(
      trim(regexp_replace(name, '^\s*(dr\.?|prof\.?|professor|ms\.?|mrs\.?|mr\.?|miss)\s+', '', 'i'))
      FROM position(' ' IN trim(regexp_replace(name, '^\s*(dr\.?|prof\.?|professor|ms\.?|mrs\.?|mr\.?|miss)\s+', '', 'i'))) + 1
    ))
    ELSE trim(substring(trim(name) FROM position(' ' IN trim(name)) + 1))
  END
WHERE first_name = '' OR first_name IS NULL;