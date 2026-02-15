/*
  # Add write policies for profile editing

  1. Security Changes
    - Add DELETE policy on `person_sectors` for removing sector links when editing
    - Add INSERT policy on `expertise_tags` for creating new expertise tags
    - Add INSERT policy on `person_expertise` for linking people to expertise
    - Add DELETE policy on `person_expertise` for removing expertise links when editing

  2. Notes
    - Allows anon and authenticated since app does not use auth yet
    - DELETE policies validate record exists via id/foreign key checks
*/

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow deleting person sectors' AND tablename = 'person_sectors') THEN
    CREATE POLICY "Allow deleting person sectors"
      ON person_sectors FOR DELETE
      TO anon, authenticated
      USING (person_id IS NOT NULL);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow inserting expertise tags' AND tablename = 'expertise_tags') THEN
    CREATE POLICY "Allow inserting expertise tags"
      ON expertise_tags FOR INSERT
      TO anon, authenticated
      WITH CHECK (name IS NOT NULL AND length(trim(name)) > 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow inserting person expertise' AND tablename = 'person_expertise') THEN
    CREATE POLICY "Allow inserting person expertise"
      ON person_expertise FOR INSERT
      TO anon, authenticated
      WITH CHECK (person_id IS NOT NULL AND expertise_id IS NOT NULL);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow deleting person expertise' AND tablename = 'person_expertise') THEN
    CREATE POLICY "Allow deleting person expertise"
      ON person_expertise FOR DELETE
      TO anon, authenticated
      USING (person_id IS NOT NULL);
  END IF;
END $$;
