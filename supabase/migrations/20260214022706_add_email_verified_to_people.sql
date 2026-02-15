/*
  # Add email_verified column to people

  1. Modified Tables
    - `people`
      - `email_verified` (boolean, default true) - tracks whether an email address has been manually verified
        Existing emails are treated as verified. AI-discovered emails will be inserted as unverified (false).

  2. Important Notes
    - Default is true so existing contacts remain unaffected
    - The add-contacts AI flow will explicitly set this to false for AI-sourced emails
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'people' AND column_name = 'email_verified'
  ) THEN
    ALTER TABLE people ADD COLUMN email_verified boolean DEFAULT true;
  END IF;
END $$;
