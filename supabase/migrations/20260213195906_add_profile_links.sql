/*
  # Add Profile Links to People

  1. Changes
    - Add `linkedin_url` column to people table
    - Add `website_url` column to people table
    - Add `twitter_url` column to people table

  2. Notes
    - These fields are optional and allow storing social media and professional profile links
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'people' AND column_name = 'linkedin_url'
  ) THEN
    ALTER TABLE people ADD COLUMN linkedin_url text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'people' AND column_name = 'website_url'
  ) THEN
    ALTER TABLE people ADD COLUMN website_url text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'people' AND column_name = 'twitter_url'
  ) THEN
    ALTER TABLE people ADD COLUMN twitter_url text;
  END IF;
END $$;