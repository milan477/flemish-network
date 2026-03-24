/*
  # Create Collections Tables

  1. New Tables
    - `collections` - stores groups of contacts
      - `id` (uuid, primary key)
      - `name` (text, not null)
      - `description` (text)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

    - `collection_members` - stores people belonging to each collection
      - `id` (uuid, primary key)
      - `collection_id` (uuid, FK -> collections, cascade delete)
      - `person_id` (uuid, FK -> people, cascade delete)
      - `notes` (text) - per-member notes for this collection
      - `added_at` (timestamptz)
      - Unique constraint on (collection_id, person_id)

  2. Security
    - Enable RLS on both tables
    - Allow public read/write access (anon and authenticated) for prototype

  3. Indexes
    - collection_id on collection_members for fast joins
*/

CREATE TABLE IF NOT EXISTS collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS collection_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id uuid REFERENCES collections(id) ON DELETE CASCADE NOT NULL,
  person_id uuid REFERENCES people(id) ON DELETE CASCADE NOT NULL,
  notes text,
  added_at timestamptz DEFAULT now(),
  UNIQUE(collection_id, person_id)
);

ALTER TABLE collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE collection_members ENABLE ROW LEVEL SECURITY;

-- Collections Policies
CREATE POLICY "Allow public read access on collections"
  ON collections FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Allow public insert access on collections"
  ON collections FOR INSERT
  TO anon, authenticated
  WITH CHECK (name IS NOT NULL AND length(trim(name)) > 0);

CREATE POLICY "Allow public update access on collections"
  ON collections FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (name IS NOT NULL AND length(trim(name)) > 0);

CREATE POLICY "Allow public delete access on collections"
  ON collections FOR DELETE
  TO anon, authenticated
  USING (true);

-- Collection Members Policies
CREATE POLICY "Allow public read access on collection_members"
  ON collection_members FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Allow public insert access on collection_members"
  ON collection_members FOR INSERT
  TO anon, authenticated
  WITH CHECK (collection_id IS NOT NULL AND person_id IS NOT NULL);

CREATE POLICY "Allow public update access on collection_members"
  ON collection_members FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow public delete access on collection_members"
  ON collection_members FOR DELETE
  TO anon, authenticated
  USING (true);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_collection_members_collection ON collection_members(collection_id);
CREATE INDEX IF NOT EXISTS idx_collection_members_person ON collection_members(person_id);
