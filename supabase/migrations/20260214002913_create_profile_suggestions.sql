/*
  # Create profile_suggestions table

  Stores AI-generated profile change suggestions for review by admins.

  1. New Tables
    - `profile_suggestions`
      - `id` (uuid, primary key)
      - `person_id` (uuid, FK to people) - the contact this suggestion is about
      - `field_name` (text) - which profile field to update (e.g. current_position, email)
      - `current_value` (text) - the current value of the field
      - `suggested_value` (text) - the AI-suggested new value
      - `source` (text) - where the suggestion came from (e.g. "Web search")
      - `status` (text) - pending, approved, or rejected
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS on `profile_suggestions`
    - SELECT policy for anon and authenticated to read all suggestions
    - UPDATE policy for anon and authenticated to change status
    - DELETE policy for anon and authenticated to remove suggestions

  3. Notes
    - INSERT is handled by the edge function using service role key
    - When auth is added, policies should be restricted to admin users
*/

CREATE TABLE IF NOT EXISTS profile_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  field_name text NOT NULL,
  current_value text DEFAULT '',
  suggested_value text NOT NULL,
  source text DEFAULT 'Web search',
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE profile_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow reading profile suggestions"
  ON profile_suggestions FOR SELECT
  TO anon, authenticated
  USING (status IS NOT NULL);

CREATE POLICY "Allow updating profile suggestion status"
  ON profile_suggestions FOR UPDATE
  TO anon, authenticated
  USING (id IS NOT NULL)
  WITH CHECK (status IN ('pending', 'approved', 'rejected'));

CREATE POLICY "Allow deleting profile suggestions"
  ON profile_suggestions FOR DELETE
  TO anon, authenticated
  USING (id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_profile_suggestions_person ON profile_suggestions(person_id);
CREATE INDEX IF NOT EXISTS idx_profile_suggestions_status ON profile_suggestions(status);
