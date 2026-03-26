/*
  # Add write policies for organizations and organization_sectors

  1. Security Changes
    - Add INSERT policy on `organizations` table
    - Add UPDATE policy on `organizations` table
    - Add INSERT policy on `organization_sectors` table
    - Add DELETE policy on `organization_sectors` table

  2. Notes
    - Allows anon and authenticated access since app does not use auth yet
    - Policies validate that required fields (name) are non-empty
*/

-- Policies for organizations
CREATE POLICY "Allow inserting organizations"
  ON organizations FOR INSERT
  TO anon, authenticated
  WITH CHECK (name IS NOT NULL AND length(trim(name)) > 0);

CREATE POLICY "Allow updating organizations"
  ON organizations FOR UPDATE
  TO anon, authenticated
  USING (id IS NOT NULL)
  WITH CHECK (name IS NOT NULL AND length(trim(name)) > 0);

-- Policies for organization_sectors
CREATE POLICY "Allow inserting organization sectors"
  ON organization_sectors FOR INSERT
  TO anon, authenticated
  WITH CHECK (organization_id IS NOT NULL AND sector_id IS NOT NULL);

CREATE POLICY "Allow deleting organization sectors"
  ON organization_sectors FOR DELETE
  TO anon, authenticated
  USING (organization_id IS NOT NULL);
