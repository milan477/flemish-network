-- Sourced person profiles: retain evidence for every displayed fact and keep
-- contact verification separate from general profile verification.

SET search_path TO public, extensions;

ALTER TABLE public.people
  ADD COLUMN IF NOT EXISTS created_by_staff_id uuid REFERENCES public.staff_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by_staff_id uuid REFERENCES public.staff_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_by_name text,
  ADD COLUMN IF NOT EXISTS updated_by_name text;

CREATE OR REPLACE FUNCTION public.capture_people_audit_actor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor public.staff_users;
BEGIN
  SELECT *
  INTO actor
  FROM public.staff_users
  WHERE user_id = auth.uid()
    AND status = 'active'
  LIMIT 1;

  IF TG_OP = 'INSERT' THEN
    NEW.created_by_staff_id := COALESCE(NEW.created_by_staff_id, actor.id);
    NEW.created_by_name := COALESCE(
      NEW.created_by_name,
      actor.full_name,
      actor.email,
      CASE
        WHEN NEW.data_source IN ('ai_agent', 'discovery_agent') THEN 'Automated discovery'
        WHEN NEW.data_source = 'csv_import' THEN 'CSV import'
        WHEN NEW.data_source = 'self_reported' THEN 'Self-reported'
        ELSE 'Unknown'
      END
    );
  END IF;

  IF actor.id IS NOT NULL THEN
    NEW.updated_by_staff_id := actor.id;
    NEW.updated_by_name := COALESCE(actor.full_name, actor.email);
  ELSIF TG_OP = 'INSERT' THEN
    NEW.updated_by_staff_id := NEW.created_by_staff_id;
    NEW.updated_by_name := NEW.created_by_name;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_capture_people_audit_actor ON public.people;
CREATE TRIGGER tr_capture_people_audit_actor
  BEFORE INSERT OR UPDATE ON public.people
  FOR EACH ROW
  EXECUTE FUNCTION public.capture_people_audit_actor();

UPDATE public.people
SET
  created_by_name = COALESCE(
    created_by_name,
    CASE
      WHEN data_source IN ('ai_agent', 'discovery_agent') THEN 'Automated discovery'
      WHEN data_source = 'csv_import' THEN 'CSV import'
      WHEN data_source = 'self_reported' THEN 'Self-reported'
      WHEN data_source = 'manual' THEN 'Manual entry (actor unavailable)'
      ELSE 'Unknown'
    END
  ),
  updated_by_name = COALESCE(
    updated_by_name,
    created_by_name,
    CASE
      WHEN data_source IN ('ai_agent', 'discovery_agent') THEN 'Automated discovery'
      WHEN data_source = 'csv_import' THEN 'CSV import'
      WHEN data_source = 'self_reported' THEN 'Self-reported'
      WHEN data_source = 'manual' THEN 'Manual entry (actor unavailable)'
      ELSE 'Unknown'
    END
  );

CREATE TABLE IF NOT EXISTS public.person_profile_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES public.people(id) ON DELETE CASCADE,
  field_name text NOT NULL,
  field_value text,
  source_type text NOT NULL DEFAULT 'unknown',
  source_label text NOT NULL DEFAULT 'Source retained',
  source_url text,
  evidence_excerpt text,
  verification_status text NOT NULL DEFAULT 'unverified'
    CHECK (verification_status IN ('unverified', 'sourced', 'verified', 'rejected')),
  verified_at timestamptz,
  created_by_staff_id uuid REFERENCES public.staff_users(id) ON DELETE SET NULL,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS person_profile_sources_person_field_idx
  ON public.person_profile_sources(person_id, field_name, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.person_contact_details (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES public.people(id) ON DELETE CASCADE,
  contact_type text NOT NULL
    CHECK (contact_type IN ('email', 'linkedin', 'website', 'twitter', 'other')),
  contact_value text NOT NULL,
  is_primary boolean NOT NULL DEFAULT true,
  verification_status text NOT NULL DEFAULT 'unverified'
    CHECK (verification_status IN ('unverified', 'sourced', 'verified', 'rejected')),
  verification_method text,
  verified_at timestamptz,
  source_label text NOT NULL DEFAULT 'Source retained',
  source_url text,
  evidence_excerpt text,
  created_by_staff_id uuid REFERENCES public.staff_users(id) ON DELETE SET NULL,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (person_id, contact_type, contact_value)
);

CREATE INDEX IF NOT EXISTS person_contact_details_person_idx
  ON public.person_contact_details(person_id, contact_type, is_primary DESC);

CREATE TABLE IF NOT EXISTS public.person_experiences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES public.people(id) ON DELETE CASCADE,
  experience_type text NOT NULL CHECK (experience_type IN ('education', 'occupation')),
  title text NOT NULL,
  organization_name text,
  location_city text,
  location_state text,
  location_country text,
  start_date date,
  end_date date,
  is_current boolean,
  source_label text NOT NULL DEFAULT 'Source retained',
  source_url text,
  evidence_excerpt text,
  verification_status text NOT NULL DEFAULT 'unverified'
    CHECK (verification_status IN ('unverified', 'sourced', 'verified', 'rejected')),
  verified_at timestamptz,
  created_by_staff_id uuid REFERENCES public.staff_users(id) ON DELETE SET NULL,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS person_experiences_person_idx
  ON public.person_experiences(person_id, experience_type, is_current DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS public.person_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES public.people(id) ON DELETE CASCADE,
  tag text NOT NULL,
  source_label text NOT NULL DEFAULT 'Source retained',
  source_url text,
  evidence_excerpt text,
  verification_status text NOT NULL DEFAULT 'unverified'
    CHECK (verification_status IN ('unverified', 'sourced', 'verified', 'rejected')),
  verified_at timestamptz,
  created_by_staff_id uuid REFERENCES public.staff_users(id) ON DELETE SET NULL,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (person_id, tag)
);

CREATE INDEX IF NOT EXISTS person_tags_person_idx
  ON public.person_tags(person_id, tag);

DROP TRIGGER IF EXISTS tr_person_profile_sources_updated_at ON public.person_profile_sources;
CREATE TRIGGER tr_person_profile_sources_updated_at
  BEFORE UPDATE ON public.person_profile_sources
  FOR EACH ROW EXECUTE FUNCTION public.set_phase6a_updated_at();

DROP TRIGGER IF EXISTS tr_person_contact_details_updated_at ON public.person_contact_details;
CREATE TRIGGER tr_person_contact_details_updated_at
  BEFORE UPDATE ON public.person_contact_details
  FOR EACH ROW EXECUTE FUNCTION public.set_phase6a_updated_at();

DROP TRIGGER IF EXISTS tr_person_experiences_updated_at ON public.person_experiences;
CREATE TRIGGER tr_person_experiences_updated_at
  BEFORE UPDATE ON public.person_experiences
  FOR EACH ROW EXECUTE FUNCTION public.set_phase6a_updated_at();

DROP TRIGGER IF EXISTS tr_person_tags_updated_at ON public.person_tags;
CREATE TRIGGER tr_person_tags_updated_at
  BEFORE UPDATE ON public.person_tags
  FOR EACH ROW EXECUTE FUNCTION public.set_phase6a_updated_at();

ALTER TABLE public.person_profile_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.person_contact_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.person_experiences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.person_tags ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'person_profile_sources',
    'person_contact_details',
    'person_experiences',
    'person_tags'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_active_staff())',
      'Staff can read ' || table_name,
      table_name
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.has_staff_role(''editor''))',
      'Editors can insert ' || table_name,
      table_name
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.has_staff_role(''editor'')) WITH CHECK (public.has_staff_role(''editor''))',
      'Editors can update ' || table_name,
      table_name
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.has_staff_role(''editor''))',
      'Editors can delete ' || table_name,
      table_name
    );
  END LOOP;
END $$;

-- Backfill retained sources for existing scalar profile facts.
WITH person_sources AS (
  SELECT
    person.id AS person_id,
    person.data_source,
    person.last_verified_at,
    person.created_at,
    person.updated_at,
    person.created_by_staff_id,
    person.created_by_name,
    discovered.source_url,
    discovered.evidence_excerpt
  FROM public.people person
  LEFT JOIN LATERAL (
    SELECT
      COALESCE(evidence.page_url, contact.source_urls[1]) AS source_url,
      COALESCE(evidence.evidence_excerpt, contact.bio) AS evidence_excerpt
    FROM public.discovered_contacts contact
    LEFT JOIN public.discovery_evidence evidence
      ON evidence.discovered_contact_id = contact.id
    WHERE contact.approved_person_id = person.id
    ORDER BY evidence.created_at DESC NULLS LAST, contact.created_at DESC
    LIMIT 1
  ) discovered ON true
)
INSERT INTO public.person_profile_sources (
  person_id,
  field_name,
  field_value,
  source_type,
  source_label,
  source_url,
  evidence_excerpt,
  verification_status,
  verified_at,
  created_by_staff_id,
  created_by_name,
  created_at,
  updated_at
)
SELECT
  person.id,
  field.field_name,
  field.field_value,
  COALESCE(person.data_source, 'legacy'),
  CASE
    WHEN person.data_source IN ('ai_agent', 'discovery_agent') THEN 'Discovery evidence'
    WHEN person.data_source = 'csv_import' THEN 'CSV import'
    WHEN person.data_source = 'self_reported' THEN 'Self-reported'
    WHEN person.data_source = 'manual' THEN 'Manual entry'
    ELSE 'Existing profile data'
  END,
  person_sources.source_url,
  person_sources.evidence_excerpt,
  CASE WHEN person.last_verified_at IS NOT NULL THEN 'verified' ELSE 'sourced' END,
  person.last_verified_at,
  person.created_by_staff_id,
  person.created_by_name,
  person.created_at,
  person.updated_at
FROM public.people person
JOIN person_sources ON person_sources.person_id = person.id
LEFT JOIN public.locations person_location ON person_location.id = person.location_id
CROSS JOIN LATERAL (
  VALUES
    ('photo', NULLIF(trim(person.profile_photo_url), '')),
    ('about', NULLIF(trim(person.bio), '')),
    ('location', NULLIF(trim(concat_ws(', ', person_location.city, person_location.state)), '')),
    ('current_location', NULLIF(trim(concat_ws(', ', person.current_location_city, person.current_location_country)), '')),
    ('current_position', NULLIF(trim(person.current_position), '')),
    ('occupation', NULLIF(trim(person.occupation), ''))
) field(field_name, field_value)
WHERE field.field_value IS NOT NULL;

INSERT INTO public.person_profile_sources (
  person_id,
  field_name,
  field_value,
  source_type,
  source_label,
  verification_status,
  verified_at,
  created_by_staff_id,
  created_by_name,
  created_at,
  updated_at
)
SELECT
  person.id,
  'sector',
  sector.name,
  COALESCE(person.data_source, 'legacy'),
  CASE
    WHEN person.data_source IN ('ai_agent', 'discovery_agent') THEN 'Discovery evidence'
    WHEN person.data_source = 'manual' THEN 'Manual entry'
    ELSE 'Existing profile data'
  END,
  CASE WHEN person.last_verified_at IS NOT NULL THEN 'verified' ELSE 'unverified' END,
  person.last_verified_at,
  person.created_by_staff_id,
  person.created_by_name,
  person.created_at,
  person.updated_at
FROM public.people person
JOIN public.person_sectors person_sector ON person_sector.person_id = person.id
JOIN public.sectors sector ON sector.id = person_sector.sector_id;

-- Backfill contact details. A retained source does not by itself verify that a
-- contact route still belongs to the person.
INSERT INTO public.person_contact_details (
  person_id,
  contact_type,
  contact_value,
  verification_status,
  verification_method,
  verified_at,
  source_label,
  source_url,
  evidence_excerpt,
  created_by_staff_id,
  created_by_name,
  created_at,
  updated_at
)
SELECT
  person.id,
  contact.contact_type,
  contact.contact_value,
  CASE
    WHEN contact.contact_type = 'email' AND person.email_verified THEN 'verified'
    WHEN suggestion.evidence_url IS NOT NULL THEN 'sourced'
    ELSE 'unverified'
  END,
  CASE
    WHEN contact.contact_type = 'email' AND person.email_verified THEN 'email_verified'
    ELSE suggestion.method
  END,
  CASE
    WHEN contact.contact_type = 'email' AND person.email_verified THEN person.updated_at
    ELSE NULL
  END,
  COALESCE(suggestion.source, 'Existing profile data'),
  suggestion.evidence_url,
  suggestion.evidence_excerpt,
  person.created_by_staff_id,
  person.created_by_name,
  person.created_at,
  person.updated_at
FROM public.people person
CROSS JOIN LATERAL (
  VALUES
    ('email', NULLIF(trim(person.email), '')),
    ('linkedin', NULLIF(trim(person.linkedin_url), '')),
    ('website', NULLIF(trim(person.website_url), '')),
    ('twitter', NULLIF(trim(person.twitter_url), ''))
) contact(contact_type, contact_value)
LEFT JOIN LATERAL (
  SELECT
    profile_suggestion.source,
    profile_suggestion.evidence_url,
    profile_suggestion.evidence_excerpt,
    profile_suggestion.method
  FROM public.profile_suggestions profile_suggestion
  WHERE profile_suggestion.person_id = person.id
    AND profile_suggestion.field_name = CASE contact.contact_type
      WHEN 'linkedin' THEN 'linkedin_url'
      WHEN 'website' THEN 'website_url'
      WHEN 'twitter' THEN 'twitter_url'
      ELSE contact.contact_type
    END
    AND profile_suggestion.status = 'approved'
  ORDER BY profile_suggestion.created_at DESC
  LIMIT 1
) suggestion ON true
WHERE contact.contact_value IS NOT NULL
ON CONFLICT (person_id, contact_type, contact_value) DO NOTHING;

-- Preserve current work as a structured occupation record.
INSERT INTO public.person_experiences (
  person_id,
  experience_type,
  title,
  organization_name,
  location_city,
  location_state,
  location_country,
  is_current,
  source_label,
  source_url,
  evidence_excerpt,
  verification_status,
  verified_at,
  created_by_staff_id,
  created_by_name,
  created_at,
  updated_at
)
SELECT
  person.id,
  'occupation',
  COALESCE(NULLIF(trim(person.occupation), ''), NULLIF(trim(person.current_position), '')),
  CASE
    WHEN person.current_position LIKE '% at %' THEN split_part(person.current_position, ' at ', 2)
    ELSE NULL
  END,
  location.city,
  location.state,
  CASE WHEN location.id IS NOT NULL THEN 'United States' ELSE person.current_location_country END,
  true,
  CASE
    WHEN person.data_source IN ('ai_agent', 'discovery_agent') THEN 'Discovery evidence'
    WHEN person.data_source = 'manual' THEN 'Manual entry'
    ELSE 'Existing profile data'
  END,
  discovered.source_url,
  discovered.evidence_excerpt,
  CASE WHEN person.last_verified_at IS NOT NULL THEN 'verified' ELSE 'unverified' END,
  person.last_verified_at,
  person.created_by_staff_id,
  person.created_by_name,
  person.created_at,
  person.updated_at
FROM public.people person
LEFT JOIN public.locations location ON location.id = person.location_id
LEFT JOIN LATERAL (
  SELECT
    COALESCE(evidence.page_url, contact.source_urls[1]) AS source_url,
    COALESCE(evidence.evidence_excerpt, contact.bio) AS evidence_excerpt
  FROM public.discovered_contacts contact
  LEFT JOIN public.discovery_evidence evidence
    ON evidence.discovered_contact_id = contact.id
  WHERE contact.approved_person_id = person.id
  ORDER BY evidence.created_at DESC NULLS LAST, contact.created_at DESC
  LIMIT 1
) discovered ON true
WHERE COALESCE(NULLIF(trim(person.occupation), ''), NULLIF(trim(person.current_position), '')) IS NOT NULL;

-- Preserve Fayat study evidence as education rather than current occupation.
INSERT INTO public.person_experiences (
  person_id,
  experience_type,
  title,
  organization_name,
  location_city,
  location_state,
  location_country,
  is_current,
  source_label,
  source_url,
  evidence_excerpt,
  verification_status,
  created_by_staff_id,
  created_by_name,
  created_at,
  updated_at
)
SELECT
  person.id,
  'education',
  COALESCE(
    (regexp_match(person.bio, 'studied (.+?) at ', 'i'))[1],
    'Fayat Scholarship study'
  ),
  COALESCE(
    (regexp_match(person.bio, ' at (.+?) in the United States', 'i'))[1],
    regexp_replace(connection.connection_label, '^Fayat study at ', '', 'i')
  ),
  location.city,
  location.state,
  'United States',
  false,
  'Official Fayat directory',
  connection.source_url,
  connection.evidence_excerpt,
  'sourced',
  person.created_by_staff_id,
  person.created_by_name,
  person.created_at,
  person.updated_at
FROM public.people person
JOIN public.person_us_connections connection ON connection.person_id = person.id
JOIN public.locations location ON location.id = connection.location_id
WHERE connection.connection_label ILIKE 'Fayat study at %';
