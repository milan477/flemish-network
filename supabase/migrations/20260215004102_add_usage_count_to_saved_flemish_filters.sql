/*
  # Add usage_count to saved_flemish_filters for Popular Filters feature

  1. Modified Tables
    - `saved_flemish_filters`
      - Add `usage_count` (integer, default 1) - tracks how many times the filter has been activated
      - Add `filter_type` (text, default 'ai') - distinguishes between 'ai' generated and 'predefined' filters

  2. Important Notes
    - usage_count increments every time a filter is activated
    - Filters with usage_count > 2 qualify for the Popular Filters section
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'saved_flemish_filters' AND column_name = 'usage_count'
  ) THEN
    ALTER TABLE saved_flemish_filters ADD COLUMN usage_count integer NOT NULL DEFAULT 1;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'saved_flemish_filters' AND column_name = 'filter_type'
  ) THEN
    ALTER TABLE saved_flemish_filters ADD COLUMN filter_type text NOT NULL DEFAULT 'ai';
  END IF;
END $$;

CREATE POLICY "Anyone can update saved flemish filters"
  ON saved_flemish_filters
  FOR UPDATE
  TO anon, authenticated
  USING (created_at IS NOT NULL)
  WITH CHECK (created_at IS NOT NULL);
