-- Preserve a reviewable profile-photo candidate found by Discovery. The URL is
-- copied to people.profile_photo_url only when an editor approves the person.
ALTER TABLE public.discovered_contacts
  ADD COLUMN IF NOT EXISTS profile_photo_url text;
