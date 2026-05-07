-- Phase 5A discovery organization staging and evidence contract.

ALTER TABLE public.discovered_organizations
  ADD COLUMN IF NOT EXISTS candidate_key text,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'agent_discovery',
  ADD COLUMN IF NOT EXISTS first_seen_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_evidence_at timestamptz,
  ADD COLUMN IF NOT EXISTS evidence_count integer NOT NULL DEFAULT 0;

ALTER TABLE public.discovered_organizations
  DROP CONSTRAINT IF EXISTS discovered_organizations_source_check;

ALTER TABLE public.discovered_organizations
  ADD CONSTRAINT discovered_organizations_source_check
  CHECK (source IN ('agent_discovery', 'manual', 'import', 'legacy'));

UPDATE public.discovered_organizations
SET
  source = COALESCE(NULLIF(source, ''), 'legacy'),
  first_seen_at = COALESCE(first_seen_at, created_at, now()),
  last_seen_at = COALESCE(last_seen_at, created_at, now()),
  last_evidence_at = COALESCE(last_evidence_at, created_at, now()),
  candidate_key = COALESCE(
    NULLIF(candidate_key, ''),
    'org:' || md5(
      lower(
        regexp_replace(
          COALESCE(NULLIF(website_url, ''), name),
          '^https?://(www\.)?',
          '',
          'i'
        )
      )
    )
  )
WHERE candidate_key IS NULL
  OR candidate_key = ''
  OR source IS NULL
  OR source = ''
  OR first_seen_at IS NULL
  OR last_seen_at IS NULL
  OR last_evidence_at IS NULL;

ALTER TABLE public.discovered_organizations
  ALTER COLUMN candidate_key SET NOT NULL,
  ALTER COLUMN last_seen_at SET DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_discovered_organizations_candidate_key
  ON public.discovered_organizations(candidate_key);

CREATE UNIQUE INDEX IF NOT EXISTS discovered_organizations_pending_candidate_key_idx
  ON public.discovered_organizations(candidate_key)
  WHERE status = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS discovered_organizations_pending_website_idx
  ON public.discovered_organizations(
    lower(regexp_replace(website_url, '^https?://(www\.)?', '', 'i'))
  )
  WHERE status = 'pending' AND website_url IS NOT NULL AND website_url <> '';

CREATE INDEX IF NOT EXISTS idx_discovered_organizations_last_seen_at
  ON public.discovered_organizations(last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_discovered_organizations_last_evidence_at
  ON public.discovered_organizations(last_evidence_at DESC);

CREATE INDEX IF NOT EXISTS idx_discovered_organizations_evidence_count
  ON public.discovered_organizations(evidence_count DESC);

DROP TRIGGER IF EXISTS tr_set_discovered_organizations_updated_at ON public.discovered_organizations;
CREATE TRIGGER tr_set_discovered_organizations_updated_at
  BEFORE UPDATE ON public.discovered_organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.set_discovery_updated_at();

CREATE TABLE IF NOT EXISTS public.discovered_organization_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  discovered_organization_id uuid NOT NULL REFERENCES public.discovered_organizations(id) ON DELETE CASCADE,
  discovery_page_id uuid REFERENCES public.discovery_pages(id) ON DELETE SET NULL,
  evidence_key text NOT NULL UNIQUE,
  page_url text NOT NULL,
  page_title text,
  page_type text,
  source_type text,
  source_name text,
  source_url text,
  evidence_excerpt text,
  raw_relevance_text text,
  raw_location_text text,
  raw_sector_text text,
  normalized_location_city text,
  normalized_location_state text,
  normalized_location_country text,
  confidence numeric(5,2) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  observed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_discovered_organization_evidence_org
  ON public.discovered_organization_evidence(discovered_organization_id);

CREATE INDEX IF NOT EXISTS idx_discovered_organization_evidence_page
  ON public.discovered_organization_evidence(discovery_page_id);

CREATE INDEX IF NOT EXISTS idx_discovered_organization_evidence_confidence
  ON public.discovered_organization_evidence(confidence DESC);

CREATE INDEX IF NOT EXISTS idx_discovered_organization_evidence_observed_at
  ON public.discovered_organization_evidence(observed_at DESC);

DROP TRIGGER IF EXISTS tr_set_discovered_organization_evidence_updated_at ON public.discovered_organization_evidence;
CREATE TRIGGER tr_set_discovered_organization_evidence_updated_at
  BEFORE UPDATE ON public.discovered_organization_evidence
  FOR EACH ROW
  EXECUTE FUNCTION public.set_discovery_updated_at();

CREATE OR REPLACE FUNCTION public.refresh_discovered_organization_evidence_rollup()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_organization_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_organization_id := OLD.discovered_organization_id;
  ELSE
    v_organization_id := NEW.discovered_organization_id;
  END IF;

  UPDATE public.discovered_organizations organization_candidate
  SET
    evidence_count = rollup.evidence_count,
    last_evidence_at = rollup.last_evidence_at,
    last_seen_at = GREATEST(
      COALESCE(organization_candidate.last_seen_at, organization_candidate.first_seen_at, organization_candidate.created_at, now()),
      COALESCE(rollup.last_evidence_at, organization_candidate.last_evidence_at, organization_candidate.first_seen_at, organization_candidate.created_at, now())
    )
  FROM (
    SELECT
      count(*)::integer AS evidence_count,
      max(COALESCE(observed_at, created_at)) AS last_evidence_at
    FROM public.discovered_organization_evidence
    WHERE discovered_organization_id = v_organization_id
  ) rollup
  WHERE organization_candidate.id = v_organization_id;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_refresh_discovered_organization_evidence_rollup_insert
  ON public.discovered_organization_evidence;
CREATE TRIGGER tr_refresh_discovered_organization_evidence_rollup_insert
  AFTER INSERT ON public.discovered_organization_evidence
  FOR EACH ROW
  EXECUTE FUNCTION public.refresh_discovered_organization_evidence_rollup();

DROP TRIGGER IF EXISTS tr_refresh_discovered_organization_evidence_rollup_update
  ON public.discovered_organization_evidence;
CREATE TRIGGER tr_refresh_discovered_organization_evidence_rollup_update
  AFTER UPDATE OF discovered_organization_id, observed_at ON public.discovered_organization_evidence
  FOR EACH ROW
  EXECUTE FUNCTION public.refresh_discovered_organization_evidence_rollup();

DROP TRIGGER IF EXISTS tr_refresh_discovered_organization_evidence_rollup_delete
  ON public.discovered_organization_evidence;
CREATE TRIGGER tr_refresh_discovered_organization_evidence_rollup_delete
  AFTER DELETE ON public.discovered_organization_evidence
  FOR EACH ROW
  EXECUTE FUNCTION public.refresh_discovered_organization_evidence_rollup();

ALTER TABLE public.discovered_organization_evidence ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read discovered_organizations" ON public.discovered_organizations;
DROP POLICY IF EXISTS "Public insert discovered_organizations" ON public.discovered_organizations;
DROP POLICY IF EXISTS "Public update discovered_organizations" ON public.discovered_organizations;
DROP POLICY IF EXISTS "Public delete discovered_organizations" ON public.discovered_organizations;
DROP POLICY IF EXISTS "Editors can read discovered_organizations" ON public.discovered_organizations;
DROP POLICY IF EXISTS "Editors can insert discovered_organizations" ON public.discovered_organizations;
DROP POLICY IF EXISTS "Editors can update discovered_organizations" ON public.discovered_organizations;
DROP POLICY IF EXISTS "Editors can delete discovered_organizations" ON public.discovered_organizations;

CREATE POLICY "Editors can read discovered_organizations"
  ON public.discovered_organizations FOR SELECT
  TO authenticated
  USING (public.has_staff_role('editor'));

CREATE POLICY "Editors can insert discovered_organizations"
  ON public.discovered_organizations FOR INSERT
  TO authenticated
  WITH CHECK (public.has_staff_role('editor'));

CREATE POLICY "Editors can update discovered_organizations"
  ON public.discovered_organizations FOR UPDATE
  TO authenticated
  USING (public.has_staff_role('editor'))
  WITH CHECK (public.has_staff_role('editor'));

CREATE POLICY "Editors can delete discovered_organizations"
  ON public.discovered_organizations FOR DELETE
  TO authenticated
  USING (public.has_staff_role('editor'));

DROP POLICY IF EXISTS "Editors can read discovered_organization_evidence" ON public.discovered_organization_evidence;
DROP POLICY IF EXISTS "Editors can insert discovered_organization_evidence" ON public.discovered_organization_evidence;
DROP POLICY IF EXISTS "Editors can update discovered_organization_evidence" ON public.discovered_organization_evidence;
DROP POLICY IF EXISTS "Editors can delete discovered_organization_evidence" ON public.discovered_organization_evidence;

CREATE POLICY "Editors can read discovered_organization_evidence"
  ON public.discovered_organization_evidence FOR SELECT
  TO authenticated
  USING (public.has_staff_role('editor'));

CREATE POLICY "Editors can insert discovered_organization_evidence"
  ON public.discovered_organization_evidence FOR INSERT
  TO authenticated
  WITH CHECK (public.has_staff_role('editor'));

CREATE POLICY "Editors can update discovered_organization_evidence"
  ON public.discovered_organization_evidence FOR UPDATE
  TO authenticated
  USING (public.has_staff_role('editor'))
  WITH CHECK (public.has_staff_role('editor'));

CREATE POLICY "Editors can delete discovered_organization_evidence"
  ON public.discovered_organization_evidence FOR DELETE
  TO authenticated
  USING (public.has_staff_role('editor'));
