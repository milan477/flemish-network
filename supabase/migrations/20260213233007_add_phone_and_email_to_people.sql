/*
  # Add phone and email columns to people

  1. Modified Tables
    - `people`
      - `phone` (text) - phone number for the contact
      - `email` (text) - email address for the contact

  2. Notes
    - Both fields are optional
    - LinkedIn, website, and twitter URLs already exist from a prior migration
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'people' AND column_name = 'phone'
  ) THEN
    ALTER TABLE people ADD COLUMN phone text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'people' AND column_name = 'email'
  ) THEN
    ALTER TABLE people ADD COLUMN email text;
  END IF;
END $$;
