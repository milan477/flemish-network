/*
  # Add suggestion reason to plan_suggested_people

  1. Modified Tables
    - `plan_suggested_people`
      - Added `suggestion_reason` (text) - AI-generated brief explanation of why the person was suggested

  2. Notes
    - Column is nullable since existing rows won't have a reason
    - Defaults to empty string for new rows
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'plan_suggested_people' AND column_name = 'suggestion_reason'
  ) THEN
    ALTER TABLE plan_suggested_people ADD COLUMN suggestion_reason text DEFAULT '';
  END IF;
END $$;
