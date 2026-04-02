-- Phase 2A discovery foundation:
-- persistent frontier state, source packs, page storage, and evidence records.

ALTER TABLE discovered_contacts
  ADD COLUMN IF NOT EXISTS first_seen_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_evidence_at timestamptz,
  ADD COLUMN IF NOT EXISTS evidence_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discovery_confidence numeric(5,2);

UPDATE discovered_contacts
SET
  first_seen_at = COALESCE(first_seen_at, created_at, now()),
  last_seen_at = COALESCE(last_seen_at, created_at, now()),
  last_evidence_at = COALESCE(last_evidence_at, created_at, now());

CREATE INDEX IF NOT EXISTS idx_discovered_contacts_last_seen_at
  ON discovered_contacts(last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_discovered_contacts_evidence_count
  ON discovered_contacts(evidence_count DESC);

CREATE OR REPLACE FUNCTION set_discovery_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS discovery_source_packs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  key text NOT NULL UNIQUE,
  name text NOT NULL,
  lane text NOT NULL DEFAULT 'head_coverage'
    CHECK (lane IN ('head_coverage', 'adaptive_frontier', 'entity_pivot')),
  description text,
  domains text[] NOT NULL DEFAULT '{}',
  query_templates text[] NOT NULL DEFAULT '{}',
  refresh_interval_days integer NOT NULL DEFAULT 14 CHECK (refresh_interval_days > 0),
  expected_page_types text[] NOT NULL DEFAULT '{}',
  expected_evidence_quality text,
  extraction_expectations jsonb NOT NULL DEFAULT '{}'::jsonb,
  priority_boost numeric(8,2) NOT NULL DEFAULT 0,
  max_seed_urls_per_run integer NOT NULL DEFAULT 8 CHECK (max_seed_urls_per_run > 0),
  active boolean NOT NULL DEFAULT true,
  last_seeded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS tr_set_discovery_source_packs_updated_at ON discovery_source_packs;
CREATE TRIGGER tr_set_discovery_source_packs_updated_at
  BEFORE UPDATE ON discovery_source_packs
  FOR EACH ROW
  EXECUTE FUNCTION set_discovery_updated_at();

ALTER TABLE discovery_source_packs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'discovery_source_packs'
      AND policyname = 'Public read discovery_source_packs'
  ) THEN
    CREATE POLICY "Public read discovery_source_packs"
      ON discovery_source_packs FOR SELECT TO anon, authenticated USING (true);
  END IF;
END
$$;

INSERT INTO discovery_source_packs (
  key,
  name,
  lane,
  description,
  domains,
  query_templates,
  refresh_interval_days,
  expected_page_types,
  expected_evidence_quality,
  extraction_expectations,
  priority_boost,
  max_seed_urls_per_run,
  active
)
VALUES
  (
    'baef_fellows',
    'BAEF Fellows And Alumni',
    'head_coverage',
    'BAEF fellow, alumni, and placement pages that often mention Belgian and Flemish researchers in the US.',
    ARRAY['baef.be', 'baef.org'],
    ARRAY[
      '"BAEF" fellow United States',
      '"Belgian American Educational Foundation" alumni United States',
      '"BAEF" researcher United States'
    ],
    14,
    ARRAY['person_profile', 'team_or_roster', 'article_or_press_release'],
    'high',
    jsonb_build_object(
      'flemish_cues', ARRAY['BAEF', 'Belgian', 'Flemish'],
      'us_cues', ARRAY['United States', 'USA', 'Boston', 'New York', 'California']
    ),
    4,
    8,
    true
  ),
  (
    'flemish_universities',
    'Flemish Universities',
    'head_coverage',
    'Faculty, alumni, lab, and profile pages tied to major Flemish universities.',
    ARRAY['kuleuven.be', 'ugent.be', 'vub.be', 'uantwerpen.be'],
    ARRAY[
      '"KU Leuven" alumni United States',
      '"Ghent University" alumni United States',
      '"UGent" researcher United States',
      '"VUB" alumni United States',
      '"UAntwerp" alumni United States'
    ],
    14,
    ARRAY['person_profile', 'team_or_roster', 'lab_or_group_page', 'article_or_press_release'],
    'high',
    jsonb_build_object(
      'flemish_cues', ARRAY['KU Leuven', 'UGent', 'Ghent University', 'VUB', 'Vrije Universiteit Brussel', 'UAntwerp', 'University of Antwerp']
    ),
    5,
    10,
    true
  ),
  (
    'imec_and_flemish_orgs',
    'imec And Flemish Organizations',
    'head_coverage',
    'Team, leadership, and news pages for imec and similar Flemish institutions with US footprints.',
    ARRAY['imec-int.com', 'imec.be'],
    ARRAY[
      '"imec" United States team',
      '"imec" alumni United States',
      '"Belgian" startup leadership United States'
    ],
    21,
    ARRAY['team_or_roster', 'person_profile', 'article_or_press_release'],
    'medium',
    jsonb_build_object(
      'flemish_cues', ARRAY['imec', 'Belgian', 'Flemish']
    ),
    3,
    8,
    true
  ),
  (
    'labs_and_research_groups',
    'Labs And Research Groups',
    'head_coverage',
    'US lab, faculty, and group roster pages that often surface Flemish researchers.',
    ARRAY[]::text[],
    ARRAY[
      '"Belgian researcher" lab United States',
      '"Flemish researcher" faculty United States',
      '"KU Leuven" lab member United States'
    ],
    21,
    ARRAY['lab_or_group_page', 'team_or_roster', 'person_profile'],
    'medium',
    jsonb_build_object(
      'positive_paths', ARRAY['/lab', '/labs', '/group', '/faculty', '/people', '/members']
    ),
    2,
    8,
    true
  ),
  (
    'events_and_associations',
    'Events And Associations',
    'head_coverage',
    'Speaker rosters, association pages, and conference listings with Belgian or Flemish cues.',
    ARRAY[]::text[],
    ARRAY[
      '"Belgian" speaker United States conference',
      '"Flemish" association United States',
      '"Belgian" event roster United States'
    ],
    21,
    ARRAY['event_or_speaker_page', 'team_or_roster', 'article_or_press_release'],
    'medium',
    jsonb_build_object(
      'positive_terms', ARRAY['speaker', 'roster', 'conference', 'association', 'fellows']
    ),
    2,
    8,
    true
  )
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name,
  lane = EXCLUDED.lane,
  description = EXCLUDED.description,
  domains = EXCLUDED.domains,
  query_templates = EXCLUDED.query_templates,
  refresh_interval_days = EXCLUDED.refresh_interval_days,
  expected_page_types = EXCLUDED.expected_page_types,
  expected_evidence_quality = EXCLUDED.expected_evidence_quality,
  extraction_expectations = EXCLUDED.extraction_expectations,
  priority_boost = EXCLUDED.priority_boost,
  max_seed_urls_per_run = EXCLUDED.max_seed_urls_per_run,
  active = EXCLUDED.active,
  updated_at = now();

CREATE TABLE IF NOT EXISTS discovery_domains (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  domain text NOT NULL UNIQUE,
  source_pack_id uuid REFERENCES discovery_source_packs(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'exhausted', 'blocked')),
  pages_queued integer NOT NULL DEFAULT 0,
  pages_fetched integer NOT NULL DEFAULT 0,
  promising_pages integer NOT NULL DEFAULT 0,
  candidates_extracted integer NOT NULL DEFAULT 0,
  candidates_approved integer NOT NULL DEFAULT 0,
  candidates_rejected integer NOT NULL DEFAULT 0,
  average_evidence_confidence numeric(5,2),
  weekly_fetch_budget integer NOT NULL DEFAULT 20 CHECK (weekly_fetch_budget > 0),
  last_seen_at timestamptz,
  last_fetched_at timestamptz,
  next_fetch_at timestamptz,
  last_approved_contact_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_discovery_domains_status
  ON discovery_domains(status);

DROP TRIGGER IF EXISTS tr_set_discovery_domains_updated_at ON discovery_domains;
CREATE TRIGGER tr_set_discovery_domains_updated_at
  BEFORE UPDATE ON discovery_domains
  FOR EACH ROW
  EXECUTE FUNCTION set_discovery_updated_at();

ALTER TABLE discovery_domains ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'discovery_domains'
      AND policyname = 'Public read discovery_domains'
  ) THEN
    CREATE POLICY "Public read discovery_domains"
      ON discovery_domains FOR SELECT TO anon, authenticated USING (true);
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS discovery_frontier (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  url text NOT NULL,
  canonical_url text NOT NULL UNIQUE,
  domain text NOT NULL,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'fetching', 'done', 'failed', 'ignored')),
  priority_score numeric(10,4) NOT NULL DEFAULT 0,
  depth integer NOT NULL DEFAULT 0 CHECK (depth >= 0),
  discovered_from_url text,
  discovery_reason text,
  source_type text NOT NULL DEFAULT 'search_seed',
  source_pack_id uuid REFERENCES discovery_source_packs(id) ON DELETE SET NULL,
  search_query text,
  anchor_text text,
  title text,
  last_fetched_at timestamptz,
  next_fetch_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  claimed_run_id uuid REFERENCES agent_runs(id) ON DELETE SET NULL,
  fetch_error_count integer NOT NULL DEFAULT 0,
  content_hash text,
  page_type text,
  last_extraction_outcome text,
  last_http_status integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_discovery_frontier_claim
  ON discovery_frontier(status, next_fetch_at, priority_score DESC);

CREATE INDEX IF NOT EXISTS idx_discovery_frontier_domain
  ON discovery_frontier(domain, status);

CREATE INDEX IF NOT EXISTS idx_discovery_frontier_run
  ON discovery_frontier(claimed_run_id);

DROP TRIGGER IF EXISTS tr_set_discovery_frontier_updated_at ON discovery_frontier;
CREATE TRIGGER tr_set_discovery_frontier_updated_at
  BEFORE UPDATE ON discovery_frontier
  FOR EACH ROW
  EXECUTE FUNCTION set_discovery_updated_at();

ALTER TABLE discovery_frontier ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'discovery_frontier'
      AND policyname = 'Public read discovery_frontier'
  ) THEN
    CREATE POLICY "Public read discovery_frontier"
      ON discovery_frontier FOR SELECT TO anon, authenticated USING (true);
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS discovery_pages (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  frontier_id uuid REFERENCES discovery_frontier(id) ON DELETE SET NULL,
  canonical_url text NOT NULL UNIQUE,
  final_url text NOT NULL,
  domain text NOT NULL,
  page_title text,
  page_type text,
  classification_method text,
  classification_confidence numeric(5,2),
  fetch_status integer,
  content_hash text,
  content_excerpt text,
  content_text text,
  extracted_links jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_discovery_pages_domain
  ON discovery_pages(domain, fetched_at DESC);

CREATE INDEX IF NOT EXISTS idx_discovery_pages_type
  ON discovery_pages(page_type, fetched_at DESC);

DROP TRIGGER IF EXISTS tr_set_discovery_pages_updated_at ON discovery_pages;
CREATE TRIGGER tr_set_discovery_pages_updated_at
  BEFORE UPDATE ON discovery_pages
  FOR EACH ROW
  EXECUTE FUNCTION set_discovery_updated_at();

ALTER TABLE discovery_pages ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'discovery_pages'
      AND policyname = 'Public read discovery_pages'
  ) THEN
    CREATE POLICY "Public read discovery_pages"
      ON discovery_pages FOR SELECT TO anon, authenticated USING (true);
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS discovery_evidence (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  discovered_contact_id uuid NOT NULL REFERENCES discovered_contacts(id) ON DELETE CASCADE,
  discovery_page_id uuid REFERENCES discovery_pages(id) ON DELETE SET NULL,
  evidence_key text NOT NULL UNIQUE,
  page_url text NOT NULL,
  page_title text,
  page_type text,
  source_type text,
  evidence_excerpt text,
  raw_location_text text,
  raw_flemish_text text,
  raw_role_text text,
  extraction_confidence numeric(5,2),
  normalized_location_city text,
  normalized_location_state text,
  discovered_via text,
  parent_url text,
  fetched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_discovery_evidence_contact
  ON discovery_evidence(discovered_contact_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_discovery_evidence_page_url
  ON discovery_evidence(page_url);

ALTER TABLE discovery_evidence ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'discovery_evidence'
      AND policyname = 'Public read discovery_evidence'
  ) THEN
    CREATE POLICY "Public read discovery_evidence"
      ON discovery_evidence FOR SELECT TO anon, authenticated USING (true);
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION claim_discovery_frontier(
  p_run_id uuid,
  p_limit integer DEFAULT 10
)
RETURNS SETOF discovery_frontier
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH claimable AS (
    SELECT id
    FROM discovery_frontier
    WHERE
      COALESCE(next_fetch_at, now()) <= now()
      AND (
        status = 'queued'
        OR (
          status = 'fetching'
          AND claimed_at IS NOT NULL
          AND claimed_at < now() - interval '20 minutes'
        )
      )
    ORDER BY priority_score DESC, next_fetch_at ASC, created_at ASC
    LIMIT GREATEST(COALESCE(p_limit, 10), 1)
    FOR UPDATE SKIP LOCKED
  ),
  updated AS (
    UPDATE discovery_frontier frontier
    SET
      status = 'fetching',
      claimed_at = now(),
      claimed_run_id = p_run_id,
      updated_at = now()
    FROM claimable
    WHERE frontier.id = claimable.id
    RETURNING frontier.*
  )
  SELECT * FROM updated;
END;
$$;

REVOKE ALL ON FUNCTION claim_discovery_frontier(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_discovery_frontier(uuid, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION release_discovery_frontier_claims(
  p_run_id uuid,
  p_status text DEFAULT 'queued'
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_status text := CASE
    WHEN p_status IN ('queued', 'failed', 'ignored', 'done') THEN p_status
    ELSE 'queued'
  END;
  v_released integer := 0;
BEGIN
  UPDATE discovery_frontier
  SET
    status = v_status,
    claimed_at = NULL,
    claimed_run_id = NULL,
    updated_at = now()
  WHERE claimed_run_id = p_run_id
    AND status = 'fetching';

  GET DIAGNOSTICS v_released = ROW_COUNT;
  RETURN v_released;
END;
$$;

REVOKE ALL ON FUNCTION release_discovery_frontier_claims(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION release_discovery_frontier_claims(uuid, text) TO authenticated, service_role;
