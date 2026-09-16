-- Keep the human actor separate from the mechanism that created a record.

SET search_path TO public, extensions;

ALTER TABLE public.agent_runs
  ADD COLUMN IF NOT EXISTS initiated_by_staff_id uuid REFERENCES public.staff_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS initiated_by_name text;

ALTER TABLE public.discovered_contacts
  ADD COLUMN IF NOT EXISTS created_by_staff_id uuid REFERENCES public.staff_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_by_name text;

ALTER TABLE public.discovered_organizations
  ADD COLUMN IF NOT EXISTS created_by_staff_id uuid REFERENCES public.staff_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_by_name text;

CREATE OR REPLACE FUNCTION public.capture_discovery_intake_actor()
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

  IF actor.id IS NOT NULL THEN
    NEW.created_by_staff_id := COALESCE(NEW.created_by_staff_id, actor.id);
    NEW.created_by_name := COALESCE(NEW.created_by_name, actor.full_name, actor.email);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_capture_discovered_contact_actor ON public.discovered_contacts;
CREATE TRIGGER tr_capture_discovered_contact_actor
  BEFORE INSERT ON public.discovered_contacts
  FOR EACH ROW EXECUTE FUNCTION public.capture_discovery_intake_actor();

DROP TRIGGER IF EXISTS tr_capture_discovered_organization_actor ON public.discovered_organizations;
CREATE TRIGGER tr_capture_discovered_organization_actor
  BEFORE INSERT ON public.discovered_organizations
  FOR EACH ROW EXECUTE FUNCTION public.capture_discovery_intake_actor();

-- Method labels are not people. Remove old fallback values where no human
-- actor was retained, then recover actors where a linked intake/run has one.
UPDATE public.people
SET created_by_name = NULL,
    created_by_staff_id = NULL
WHERE created_by_name IN (
  'Automated discovery',
  'CSV import',
  'Self-reported',
  'Manual entry (actor unavailable)',
  'Unknown'
);

UPDATE public.people person
SET
  created_by_staff_id = COALESCE(contact.created_by_staff_id, run.initiated_by_staff_id),
  created_by_name = COALESCE(contact.created_by_name, run.initiated_by_name)
FROM public.discovered_contacts contact
LEFT JOIN public.agent_runs run ON run.id = contact.agent_run_id
WHERE contact.approved_person_id = person.id
  AND COALESCE(contact.created_by_name, run.initiated_by_name) IS NOT NULL;

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

  IF TG_OP = 'INSERT'
    AND actor.id IS NOT NULL
    AND NEW.created_by_staff_id IS NULL
    AND NEW.created_by_name IS NULL THEN
    NEW.created_by_staff_id := actor.id;
    NEW.created_by_name := COALESCE(actor.full_name, actor.email);
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
