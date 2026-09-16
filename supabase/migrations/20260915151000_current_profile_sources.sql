ALTER TABLE public.person_profile_sources
  ADD COLUMN IF NOT EXISTS is_current boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS person_profile_sources_current_idx
  ON public.person_profile_sources(person_id, field_name, is_current, updated_at DESC);
