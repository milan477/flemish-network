/*
  # Add Occupation/Job Type to People

  1. Changes
    - Add `occupation` column to `people` table (text, optional)
    - This field captures the person's job type/role category
      (e.g., Researcher, Creative, Executive, Engineer)
    - Separate from `current_position` which holds the full title
    - Separate from sectors which describe the industry/domain

  2. Notes
    - Uses conditional check to avoid errors if column already exists
    - No default value; existing records will have null until populated
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'people' AND column_name = 'occupation'
  ) THEN
    ALTER TABLE people ADD COLUMN occupation text;
  END IF;
END $$;
