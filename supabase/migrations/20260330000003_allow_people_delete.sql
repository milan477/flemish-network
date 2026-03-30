/*
  # Allow deleting people from the client

  1. Security Changes
    - Add DELETE policy on `people` so client-side rollback can remove contacts
      that were just created by a cancelled CSV import.

  2. Notes
    - Allows anon and authenticated because the app still runs without auth.
    - This matches the repo's existing open-write posture for admin flows.
*/

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE policyname = 'Allow deleting people'
      AND tablename = 'people'
  ) THEN
    CREATE POLICY "Allow deleting people"
      ON people FOR DELETE
      TO anon, authenticated
      USING (id IS NOT NULL);
  END IF;
END $$;
