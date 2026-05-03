-- Name parts are optional metadata. `people.name` remains the required display
-- identity; title/first/last may be unknown for discovered or imported contacts.
ALTER TABLE people
  ALTER COLUMN title DROP NOT NULL,
  ALTER COLUMN title DROP DEFAULT,
  ALTER COLUMN first_name DROP NOT NULL,
  ALTER COLUMN first_name DROP DEFAULT,
  ALTER COLUMN last_name DROP NOT NULL,
  ALTER COLUMN last_name DROP DEFAULT;

UPDATE people
SET
  title = NULLIF(btrim(title), ''),
  first_name = NULLIF(btrim(first_name), ''),
  last_name = NULLIF(btrim(last_name), '');
