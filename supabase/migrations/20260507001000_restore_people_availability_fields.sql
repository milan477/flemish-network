-- Restore availability/contact preference columns used by the current app and seed data.

ALTER TABLE people
  ADD COLUMN IF NOT EXISTS available_for_lectures boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS open_to_mentorship boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS welcomes_visits boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS preferred_contact text;
