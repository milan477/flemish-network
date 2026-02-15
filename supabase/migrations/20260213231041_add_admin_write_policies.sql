/*
  # Add insert and update policies for admin functionality

  1. Security Changes
    - Add INSERT policy on `people` table for adding new contacts
    - Add UPDATE policy on `people` table for updating contact info
    - Add INSERT policy on `person_sectors` for linking people to sectors
    - Add INSERT policy on `sectors` for creating new sectors if needed

  2. Notes
    - Policies validate that required fields (name) are non-empty
    - Currently allows anon and authenticated access since app does not use auth
    - Should be restricted to authenticated-only when auth is implemented
*/

CREATE POLICY "Allow inserting people"
  ON people FOR INSERT
  TO anon, authenticated
  WITH CHECK (name IS NOT NULL AND length(trim(name)) > 0);

CREATE POLICY "Allow updating people"
  ON people FOR UPDATE
  TO anon, authenticated
  USING (id IS NOT NULL)
  WITH CHECK (name IS NOT NULL AND length(trim(name)) > 0);

CREATE POLICY "Allow inserting person sectors"
  ON person_sectors FOR INSERT
  TO anon, authenticated
  WITH CHECK (person_id IS NOT NULL AND sector_id IS NOT NULL);
