/*
  # Create saved Flemish Connection AI filters table

  1. New Tables
    - `saved_flemish_filters`
      - `id` (uuid, primary key)
      - `original_query` (text) - The raw user input
      - `keywords` (jsonb) - AI-generated keywords object with target fields
      - `target_fields` (text[]) - Which fields to search (flemish_connection, bio)
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS on `saved_flemish_filters` table
    - Add policies for authenticated users to manage their own filters
    - Add policy for anon users to read/write (single-tenant app)
*/

CREATE TABLE IF NOT EXISTS saved_flemish_filters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_query text NOT NULL DEFAULT '',
  keywords jsonb NOT NULL DEFAULT '{}',
  target_fields text[] NOT NULL DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE saved_flemish_filters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read saved flemish filters"
  ON saved_flemish_filters
  FOR SELECT
  TO anon, authenticated
  USING (created_at IS NOT NULL);

CREATE POLICY "Anyone can insert saved flemish filters"
  ON saved_flemish_filters
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (original_query <> '');

CREATE POLICY "Anyone can delete saved flemish filters"
  ON saved_flemish_filters
  FOR DELETE
  TO anon, authenticated
  USING (created_at IS NOT NULL);
