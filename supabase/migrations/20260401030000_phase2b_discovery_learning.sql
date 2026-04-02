-- Phase 2B discovery expansion, yield learning, and geographic coverage.

ALTER TABLE discovery_source_packs
  ADD COLUMN IF NOT EXISTS coverage_target_keys text[] NOT NULL DEFAULT '{}'::text[];

UPDATE discovery_source_packs
SET coverage_target_keys = CASE key
  WHEN 'baef_fellows' THEN ARRAY[
    'metro:new-york-newark',
    'metro:boston-cambridge',
    'metro:chicago',
    'metro:washington-dc'
  ]::text[]
  WHEN 'flemish_universities' THEN ARRAY[
    'metro:boston-cambridge',
    'metro:washington-dc',
    'metro:chicago',
    'metro:san-diego',
    'metro:research-triangle'
  ]::text[]
  WHEN 'imec_and_flemish_orgs' THEN ARRAY[
    'metro:san-francisco-bay-area',
    'metro:seattle',
    'metro:austin',
    'metro:los-angeles'
  ]::text[]
  WHEN 'labs_and_research_groups' THEN ARRAY[
    'metro:boston-cambridge',
    'metro:san-diego',
    'metro:research-triangle',
    'metro:houston',
    'metro:seattle'
  ]::text[]
  WHEN 'events_and_associations' THEN ARRAY[
    'metro:new-york-newark',
    'metro:washington-dc',
    'metro:chicago',
    'metro:austin',
    'metro:houston'
  ]::text[]
  ELSE coverage_target_keys
END;

ALTER TABLE discovery_domains
  ADD COLUMN IF NOT EXISTS duplicate_candidates integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS yield_score numeric(8,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS revisit_interval_hours integer NOT NULL DEFAULT 336 CHECK (revisit_interval_hours > 0),
  ADD COLUMN IF NOT EXISTS last_rejected_contact_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_sitemap_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_rss_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_discovery_domains_yield_score
  ON discovery_domains(yield_score DESC);

CREATE INDEX IF NOT EXISTS idx_discovery_domains_next_fetch_at
  ON discovery_domains(next_fetch_at);

CREATE TABLE IF NOT EXISTS discovery_frontier_refills (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_run_id uuid REFERENCES agent_runs(id) ON DELETE SET NULL,
  refill_reason text NOT NULL,
  provider text,
  frontier_before integer,
  seeded_count integer NOT NULL DEFAULT 0,
  source_pack_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  planned_queries jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_discovery_frontier_refills_created_at
  ON discovery_frontier_refills(created_at DESC);

ALTER TABLE discovery_frontier_refills ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS metro_areas (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  metro_key text NOT NULL UNIQUE,
  metro_name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS tr_set_metro_areas_updated_at ON metro_areas;
CREATE TRIGGER tr_set_metro_areas_updated_at
  BEFORE UPDATE ON metro_areas
  FOR EACH ROW
  EXECUTE FUNCTION set_discovery_updated_at();

ALTER TABLE metro_areas ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS metro_area_cities (
  metro_area_id uuid NOT NULL REFERENCES metro_areas(id) ON DELETE CASCADE,
  city text NOT NULL,
  state text NOT NULL,
  primary_city boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (metro_area_id, city, state)
);

CREATE INDEX IF NOT EXISTS idx_metro_area_cities_city_state
  ON metro_area_cities(lower(city), upper(state));

ALTER TABLE metro_area_cities ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS coverage_targets (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  geography_key text NOT NULL UNIQUE,
  geography_type text NOT NULL CHECK (geography_type IN ('state', 'metro')),
  label text NOT NULL,
  state_code text,
  metro_area_id uuid REFERENCES metro_areas(id) ON DELETE SET NULL,
  priority_weight numeric(6,2) NOT NULL DEFAULT 1,
  expected_presence_score numeric(6,2) NOT NULL DEFAULT 1,
  sector_emphasis text[] NOT NULL DEFAULT '{}'::text[],
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (geography_type = 'state' AND state_code IS NOT NULL AND metro_area_id IS NULL)
    OR
    (geography_type = 'metro' AND state_code IS NULL AND metro_area_id IS NOT NULL)
  )
);

DROP TRIGGER IF EXISTS tr_set_coverage_targets_updated_at ON coverage_targets;
CREATE TRIGGER tr_set_coverage_targets_updated_at
  BEFORE UPDATE ON coverage_targets
  FOR EACH ROW
  EXECUTE FUNCTION set_discovery_updated_at();

CREATE INDEX IF NOT EXISTS idx_coverage_targets_active_type
  ON coverage_targets(active, geography_type);

ALTER TABLE coverage_targets ENABLE ROW LEVEL SECURITY;

WITH metro_seed(metro_key, metro_name, notes) AS (
  VALUES
    ('boston-cambridge', 'Boston-Cambridge', 'Universities, biotech, research labs, and fellowship density.'),
    ('new-york-newark', 'New York-Newark', 'Finance, arts, chambers, fellows, and major employer concentration.'),
    ('washington-dc', 'Washington DC', 'Policy, nonprofit, embassy, and university-adjacent coverage.'),
    ('chicago', 'Chicago', 'Midwest university, finance, and association hub.'),
    ('san-francisco-bay-area', 'San Francisco Bay Area', 'Startup, semiconductor, AI, and imec-adjacent ecosystem.'),
    ('san-diego', 'San Diego', 'Biotech and research-heavy metro.'),
    ('los-angeles', 'Los Angeles', 'Culture, trade, startup, and university-adjacent coverage.'),
    ('seattle', 'Seattle', 'Cloud, AI, biotech, and research concentration.'),
    ('austin', 'Austin', 'Startup, semiconductor, and conference ecosystem.'),
    ('houston', 'Houston', 'Medical, energy, and research hub.'),
    ('dallas-fort-worth', 'Dallas-Fort Worth', 'Corporate, startup, and university ecosystem.'),
    ('research-triangle', 'Research Triangle', 'Duke, UNC, NC State, biotech, and lab density.'),
    ('philadelphia', 'Philadelphia', 'Biotech, medicine, and university ecosystem.'),
    ('atlanta', 'Atlanta', 'Corporate, university, and nonprofit ecosystem.')
)
INSERT INTO metro_areas (metro_key, metro_name, notes, active)
SELECT metro_key, metro_name, notes, true
FROM metro_seed
ON CONFLICT (metro_key) DO UPDATE SET
  metro_name = EXCLUDED.metro_name,
  notes = EXCLUDED.notes,
  active = true,
  updated_at = now();

WITH city_seed(metro_key, city, state, primary_city) AS (
  VALUES
    ('boston-cambridge', 'Boston', 'MA', true),
    ('boston-cambridge', 'Cambridge', 'MA', false),
    ('boston-cambridge', 'Somerville', 'MA', false),
    ('boston-cambridge', 'Brookline', 'MA', false),
    ('new-york-newark', 'New York', 'NY', true),
    ('new-york-newark', 'Brooklyn', 'NY', false),
    ('new-york-newark', 'Queens', 'NY', false),
    ('new-york-newark', 'Jersey City', 'NJ', false),
    ('new-york-newark', 'Hoboken', 'NJ', false),
    ('new-york-newark', 'Newark', 'NJ', false),
    ('washington-dc', 'Washington', 'DC', true),
    ('washington-dc', 'Arlington', 'VA', false),
    ('washington-dc', 'Alexandria', 'VA', false),
    ('washington-dc', 'Bethesda', 'MD', false),
    ('washington-dc', 'Rockville', 'MD', false),
    ('chicago', 'Chicago', 'IL', true),
    ('chicago', 'Evanston', 'IL', false),
    ('san-francisco-bay-area', 'San Francisco', 'CA', true),
    ('san-francisco-bay-area', 'Oakland', 'CA', false),
    ('san-francisco-bay-area', 'Berkeley', 'CA', false),
    ('san-francisco-bay-area', 'Palo Alto', 'CA', false),
    ('san-francisco-bay-area', 'Mountain View', 'CA', false),
    ('san-francisco-bay-area', 'Menlo Park', 'CA', false),
    ('san-francisco-bay-area', 'Sunnyvale', 'CA', false),
    ('san-francisco-bay-area', 'San Jose', 'CA', false),
    ('san-francisco-bay-area', 'Redwood City', 'CA', false),
    ('san-francisco-bay-area', 'Santa Clara', 'CA', false),
    ('san-francisco-bay-area', 'Cupertino', 'CA', false),
    ('san-diego', 'San Diego', 'CA', true),
    ('san-diego', 'La Jolla', 'CA', false),
    ('los-angeles', 'Los Angeles', 'CA', true),
    ('los-angeles', 'Santa Monica', 'CA', false),
    ('los-angeles', 'Pasadena', 'CA', false),
    ('los-angeles', 'Irvine', 'CA', false),
    ('seattle', 'Seattle', 'WA', true),
    ('seattle', 'Bellevue', 'WA', false),
    ('seattle', 'Redmond', 'WA', false),
    ('austin', 'Austin', 'TX', true),
    ('houston', 'Houston', 'TX', true),
    ('houston', 'The Woodlands', 'TX', false),
    ('dallas-fort-worth', 'Dallas', 'TX', true),
    ('dallas-fort-worth', 'Fort Worth', 'TX', false),
    ('dallas-fort-worth', 'Plano', 'TX', false),
    ('dallas-fort-worth', 'Richardson', 'TX', false),
    ('dallas-fort-worth', 'Irving', 'TX', false),
    ('research-triangle', 'Durham', 'NC', true),
    ('research-triangle', 'Chapel Hill', 'NC', false),
    ('research-triangle', 'Raleigh', 'NC', false),
    ('philadelphia', 'Philadelphia', 'PA', true),
    ('atlanta', 'Atlanta', 'GA', true)
)
INSERT INTO metro_area_cities (metro_area_id, city, state, primary_city)
SELECT ma.id, city_seed.city, city_seed.state, city_seed.primary_city
FROM city_seed
JOIN metro_areas ma
  ON ma.metro_key = city_seed.metro_key
ON CONFLICT (metro_area_id, city, state) DO UPDATE SET
  primary_city = EXCLUDED.primary_city;

WITH state_target_seed(geography_key, label, state_code, priority_weight, expected_presence_score, sector_emphasis, notes) AS (
  VALUES
    ('state:CA', 'California', 'CA', 4.50, 5.00, ARRAY['Artificial Intelligence', 'Biotechnology', 'Research']::text[], 'High expected coverage across Bay Area, LA, and San Diego.'),
    ('state:MA', 'Massachusetts', 'MA', 4.25, 5.00, ARRAY['Biotechnology', 'Education', 'Research']::text[], 'Boston-Cambridge university and biotech density.'),
    ('state:NY', 'New York', 'NY', 4.00, 4.50, ARRAY['Finance', 'Culture & Arts', 'Education']::text[], 'Finance and cultural institutions with strong Belgian/Flemish relevance.'),
    ('state:TX', 'Texas', 'TX', 3.75, 4.50, ARRAY['Research', 'Biotechnology', 'Finance']::text[], 'Austin, Houston, and Dallas-Fort Worth merit separate metro attention.'),
    ('state:WA', 'Washington', 'WA', 3.25, 4.00, ARRAY['Artificial Intelligence', 'Research']::text[], 'Seattle region expected presence.'),
    ('state:IL', 'Illinois', 'IL', 3.00, 3.75, ARRAY['Finance', 'Education', 'Research']::text[], 'Chicago and university ecosystem.'),
    ('state:DC', 'District of Columbia', 'DC', 2.75, 3.50, ARRAY['Education', 'Research']::text[], 'Captures DC proper alongside metro target.'),
    ('state:MD', 'Maryland', 'MD', 2.50, 3.25, ARRAY['Research', 'Biotechnology']::text[], 'NIH, biotech, and policy-adjacent coverage.'),
    ('state:VA', 'Virginia', 'VA', 2.50, 3.25, ARRAY['Research', 'Education']::text[], 'Northern Virginia and DC-adjacent employer density.'),
    ('state:NC', 'North Carolina', 'NC', 2.75, 3.75, ARRAY['Biotechnology', 'Research', 'Education']::text[], 'Research Triangle expected presence.')
)
INSERT INTO coverage_targets (
  geography_key,
  geography_type,
  label,
  state_code,
  priority_weight,
  expected_presence_score,
  sector_emphasis,
  notes,
  active
)
SELECT
  geography_key,
  'state',
  label,
  state_code,
  priority_weight,
  expected_presence_score,
  sector_emphasis,
  notes,
  true
FROM state_target_seed
ON CONFLICT (geography_key) DO UPDATE SET
  label = EXCLUDED.label,
  state_code = EXCLUDED.state_code,
  priority_weight = EXCLUDED.priority_weight,
  expected_presence_score = EXCLUDED.expected_presence_score,
  sector_emphasis = EXCLUDED.sector_emphasis,
  notes = EXCLUDED.notes,
  active = true,
  updated_at = now();

WITH metro_target_seed(geography_key, label, metro_key, priority_weight, expected_presence_score, sector_emphasis, notes) AS (
  VALUES
    ('metro:boston-cambridge', 'Boston-Cambridge', 'boston-cambridge', 5.00, 5.00, ARRAY['Biotechnology', 'Education', 'Research']::text[], 'Top university and biotech metro.'),
    ('metro:new-york-newark', 'New York-Newark', 'new-york-newark', 4.75, 4.75, ARRAY['Finance', 'Culture & Arts', 'Education']::text[], 'Chambers, fellows, finance, and arts leadership.'),
    ('metro:washington-dc', 'Washington DC', 'washington-dc', 4.25, 4.25, ARRAY['Education', 'Research', 'Culture & Arts']::text[], 'Policy, nonprofit, embassy, and university-adjacent network.'),
    ('metro:chicago', 'Chicago', 'chicago', 4.00, 4.00, ARRAY['Finance', 'Education', 'Research']::text[], 'Finance and university ecosystem.'),
    ('metro:san-francisco-bay-area', 'San Francisco Bay Area', 'san-francisco-bay-area', 4.75, 4.75, ARRAY['Artificial Intelligence', 'Research', 'Finance']::text[], 'AI, semiconductor, startup, and imec-adjacent coverage.'),
    ('metro:san-diego', 'San Diego', 'san-diego', 4.25, 4.50, ARRAY['Biotechnology', 'Research']::text[], 'Biotech and research-heavy metro.'),
    ('metro:los-angeles', 'Los Angeles', 'los-angeles', 3.75, 3.75, ARRAY['Culture & Arts', 'Finance']::text[], 'Creative, trade, and startup coverage.'),
    ('metro:seattle', 'Seattle', 'seattle', 4.00, 4.00, ARRAY['Artificial Intelligence', 'Research', 'Biotechnology']::text[], 'Cloud, AI, biotech, and research ecosystem.'),
    ('metro:austin', 'Austin', 'austin', 3.75, 4.00, ARRAY['Artificial Intelligence', 'Research']::text[], 'Startup, semiconductor, and event ecosystem.'),
    ('metro:houston', 'Houston', 'houston', 4.00, 4.25, ARRAY['Biotechnology', 'Research']::text[], 'Medical and energy-adjacent research coverage.'),
    ('metro:dallas-fort-worth', 'Dallas-Fort Worth', 'dallas-fort-worth', 3.25, 3.50, ARRAY['Finance', 'Research']::text[], 'Corporate and university ecosystem.'),
    ('metro:research-triangle', 'Research Triangle', 'research-triangle', 4.00, 4.25, ARRAY['Biotechnology', 'Research', 'Education']::text[], 'Duke/UNC/NC State and biotech.'),
    ('metro:philadelphia', 'Philadelphia', 'philadelphia', 3.00, 3.25, ARRAY['Biotechnology', 'Research', 'Education']::text[], 'University and medicine ecosystem.'),
    ('metro:atlanta', 'Atlanta', 'atlanta', 2.75, 3.00, ARRAY['Finance', 'Education']::text[], 'Corporate and university ecosystem.')
)
INSERT INTO coverage_targets (
  geography_key,
  geography_type,
  label,
  metro_area_id,
  priority_weight,
  expected_presence_score,
  sector_emphasis,
  notes,
  active
)
SELECT
  metro_target_seed.geography_key,
  'metro',
  metro_target_seed.label,
  ma.id,
  metro_target_seed.priority_weight,
  metro_target_seed.expected_presence_score,
  metro_target_seed.sector_emphasis,
  metro_target_seed.notes,
  true
FROM metro_target_seed
JOIN metro_areas ma
  ON ma.metro_key = metro_target_seed.metro_key
ON CONFLICT (geography_key) DO UPDATE SET
  label = EXCLUDED.label,
  metro_area_id = EXCLUDED.metro_area_id,
  priority_weight = EXCLUDED.priority_weight,
  expected_presence_score = EXCLUDED.expected_presence_score,
  sector_emphasis = EXCLUDED.sector_emphasis,
  notes = EXCLUDED.notes,
  active = true,
  updated_at = now();

CREATE OR REPLACE FUNCTION discovery_extract_domain(p_url text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN COALESCE(p_url, '') ~* '^https?://'
      THEN lower(regexp_replace(p_url, '^https?://(www\.)?([^/]+).*$','\2'))
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION refresh_discovery_domain_metrics(p_domain text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_domain text := lower(btrim(COALESCE(p_domain, '')));
BEGIN
  IF v_domain = '' THEN
    RETURN;
  END IF;

  INSERT INTO discovery_domains (domain)
  VALUES (v_domain)
  ON CONFLICT (domain) DO NOTHING;

  WITH frontier_stats AS (
    SELECT
      domain,
      COUNT(*) FILTER (WHERE status = 'queued') AS pages_queued
    FROM discovery_frontier
    WHERE domain = v_domain
    GROUP BY domain
  ),
  page_stats AS (
    SELECT
      domain,
      COUNT(*) AS pages_fetched,
      COUNT(*) FILTER (
        WHERE COALESCE(fetch_status, 0) BETWEEN 200 AND 399
          AND COALESCE(page_type, '') NOT IN ('low_value_boilerplate', 'irrelevant')
      ) AS promising_pages
    FROM discovery_pages
    WHERE domain = v_domain
    GROUP BY domain
  ),
  evidence_stats AS (
    SELECT
      discovery_extract_domain(page_url) AS domain,
      COUNT(DISTINCT discovered_contact_id) AS candidates_extracted,
      AVG(extraction_confidence) AS average_evidence_confidence
    FROM discovery_evidence
    WHERE discovery_extract_domain(page_url) = v_domain
    GROUP BY discovery_extract_domain(page_url)
  ),
  review_stats AS (
    SELECT
      domain,
      COUNT(DISTINCT discovered_contact_id) FILTER (
        WHERE review_outcome IN ('approved_new', 'approved_merge')
      ) AS candidates_approved,
      COUNT(DISTINCT discovered_contact_id) FILTER (
        WHERE status = 'rejected' OR review_outcome = 'rejected'
      ) AS candidates_rejected,
      MAX(reviewed_at) FILTER (
        WHERE review_outcome IN ('approved_new', 'approved_merge')
      ) AS last_approved_contact_at,
      MAX(reviewed_at) FILTER (
        WHERE status = 'rejected' OR review_outcome = 'rejected'
      ) AS last_rejected_contact_at
    FROM (
      SELECT DISTINCT
        discovery_extract_domain(de.page_url) AS domain,
        de.discovered_contact_id,
        dc.status,
        dc.review_outcome,
        dc.reviewed_at
      FROM discovery_evidence de
      JOIN discovered_contacts dc
        ON dc.id = de.discovered_contact_id
      WHERE discovery_extract_domain(de.page_url) = v_domain
    ) reviewed
    GROUP BY domain
  ),
  recent_fetches AS (
    SELECT
      domain,
      COUNT(*) FILTER (WHERE fetched_at >= now() - interval '7 days') AS recent_fetches_7d
    FROM discovery_pages
    WHERE domain = v_domain
    GROUP BY domain
  ),
  computed AS (
    SELECT
      d.id,
      d.domain,
      d.status AS current_status,
      d.duplicate_candidates,
      COALESCE(fs.pages_queued, 0) AS pages_queued,
      COALESCE(ps.pages_fetched, 0) AS pages_fetched,
      COALESCE(ps.promising_pages, 0) AS promising_pages,
      COALESCE(es.candidates_extracted, 0) AS candidates_extracted,
      COALESCE(rs.candidates_approved, 0) AS candidates_approved,
      COALESCE(rs.candidates_rejected, 0) AS candidates_rejected,
      rs.last_approved_contact_at,
      rs.last_rejected_contact_at,
      es.average_evidence_confidence,
      COALESCE(rf.recent_fetches_7d, 0) AS recent_fetches_7d,
      ROUND((
        COALESCE(rs.candidates_approved, 0) * 4.00
        + COALESCE(ps.promising_pages, 0) * 1.20
        + COALESCE(es.average_evidence_confidence, 0) * 3.00
        + COALESCE(es.candidates_extracted, 0) * 0.80
        - COALESCE(rs.candidates_rejected, 0) * 1.50
        - COALESCE(d.duplicate_candidates, 0) * 1.00
      ) / GREATEST(COALESCE(ps.pages_fetched, 0), 1), 4) AS yield_score_calc
    FROM discovery_domains d
    LEFT JOIN frontier_stats fs
      ON fs.domain = d.domain
    LEFT JOIN page_stats ps
      ON ps.domain = d.domain
    LEFT JOIN evidence_stats es
      ON es.domain = d.domain
    LEFT JOIN review_stats rs
      ON rs.domain = d.domain
    LEFT JOIN recent_fetches rf
      ON rf.domain = d.domain
    WHERE d.domain = v_domain
  )
  UPDATE discovery_domains d
  SET
    pages_queued = computed.pages_queued,
    pages_fetched = computed.pages_fetched,
    promising_pages = computed.promising_pages,
    candidates_extracted = computed.candidates_extracted,
    candidates_approved = computed.candidates_approved,
    candidates_rejected = computed.candidates_rejected,
    average_evidence_confidence = CASE
      WHEN computed.average_evidence_confidence IS NULL THEN NULL
      ELSE ROUND(computed.average_evidence_confidence::numeric, 2)
    END,
    last_approved_contact_at = computed.last_approved_contact_at,
    last_rejected_contact_at = computed.last_rejected_contact_at,
    yield_score = computed.yield_score_calc,
    weekly_fetch_budget = CASE
      WHEN computed.yield_score_calc >= 2.00 OR computed.candidates_approved >= 4 THEN 30
      WHEN computed.yield_score_calc >= 1.00 OR computed.candidates_approved >= 1 THEN 18
      WHEN computed.yield_score_calc >= 0.35 OR computed.candidates_extracted >= 1 THEN 12
      ELSE 6
    END,
    revisit_interval_hours = CASE
      WHEN computed.yield_score_calc >= 2.00 OR computed.candidates_approved >= 4 THEN 72
      WHEN computed.yield_score_calc >= 1.00 OR computed.candidates_approved >= 1 THEN 168
      WHEN computed.yield_score_calc >= 0.35 OR computed.candidates_extracted >= 1 THEN 336
      ELSE 720
    END,
    status = CASE
      WHEN computed.current_status IN ('paused', 'blocked') THEN computed.current_status
      WHEN computed.recent_fetches_7d >= CASE
        WHEN computed.yield_score_calc >= 2.00 OR computed.candidates_approved >= 4 THEN 30
        WHEN computed.yield_score_calc >= 1.00 OR computed.candidates_approved >= 1 THEN 18
        WHEN computed.yield_score_calc >= 0.35 OR computed.candidates_extracted >= 1 THEN 12
        ELSE 6
      END
      AND computed.yield_score_calc < 0.20
      AND COALESCE(computed.last_approved_contact_at, to_timestamp(0)) < now() - interval '90 days'
        THEN 'exhausted'
      ELSE 'active'
    END
  FROM computed
  WHERE d.id = computed.id;
END;
$$;

CREATE OR REPLACE FUNCTION refresh_discovery_domain_metrics_from_frontier()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.domain IS NOT NULL THEN
    PERFORM refresh_discovery_domain_metrics(NEW.domain);
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE')
    AND OLD.domain IS NOT NULL
    AND (TG_OP = 'DELETE' OR OLD.domain IS DISTINCT FROM NEW.domain) THEN
    PERFORM refresh_discovery_domain_metrics(OLD.domain);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS tr_refresh_discovery_domain_metrics_frontier ON discovery_frontier;
CREATE TRIGGER tr_refresh_discovery_domain_metrics_frontier
  AFTER INSERT OR UPDATE OR DELETE ON discovery_frontier
  FOR EACH ROW
  EXECUTE FUNCTION refresh_discovery_domain_metrics_from_frontier();

CREATE OR REPLACE FUNCTION refresh_discovery_domain_metrics_from_pages()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.domain IS NOT NULL THEN
    PERFORM refresh_discovery_domain_metrics(NEW.domain);
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE')
    AND OLD.domain IS NOT NULL
    AND (TG_OP = 'DELETE' OR OLD.domain IS DISTINCT FROM NEW.domain) THEN
    PERFORM refresh_discovery_domain_metrics(OLD.domain);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS tr_refresh_discovery_domain_metrics_pages ON discovery_pages;
CREATE TRIGGER tr_refresh_discovery_domain_metrics_pages
  AFTER INSERT OR UPDATE OR DELETE ON discovery_pages
  FOR EACH ROW
  EXECUTE FUNCTION refresh_discovery_domain_metrics_from_pages();

CREATE OR REPLACE FUNCTION refresh_discovery_domain_metrics_from_evidence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_new_domain text;
  v_old_domain text;
BEGIN
  IF TG_OP <> 'DELETE' THEN
    v_new_domain := discovery_extract_domain(NEW.page_url);
  END IF;

  IF TG_OP <> 'INSERT' THEN
    v_old_domain := discovery_extract_domain(OLD.page_url);
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') AND v_new_domain IS NOT NULL THEN
    PERFORM refresh_discovery_domain_metrics(v_new_domain);
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE')
    AND v_old_domain IS NOT NULL
    AND (TG_OP = 'DELETE' OR v_old_domain IS DISTINCT FROM v_new_domain) THEN
    PERFORM refresh_discovery_domain_metrics(v_old_domain);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS tr_refresh_discovery_domain_metrics_evidence ON discovery_evidence;
CREATE TRIGGER tr_refresh_discovery_domain_metrics_evidence
  AFTER INSERT OR UPDATE OR DELETE ON discovery_evidence
  FOR EACH ROW
  EXECUTE FUNCTION refresh_discovery_domain_metrics_from_evidence();

CREATE OR REPLACE FUNCTION refresh_discovery_domain_metrics_from_review()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_domain text;
BEGIN
  IF TG_OP = 'UPDATE'
    AND (
      OLD.status IS DISTINCT FROM NEW.status
      OR OLD.review_outcome IS DISTINCT FROM NEW.review_outcome
    ) THEN
    FOR v_domain IN
      SELECT DISTINCT discovery_extract_domain(page_url)
      FROM discovery_evidence
      WHERE discovered_contact_id = NEW.id
        AND discovery_extract_domain(page_url) IS NOT NULL
    LOOP
      PERFORM refresh_discovery_domain_metrics(v_domain);
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_refresh_discovery_domain_metrics_review ON discovered_contacts;
CREATE TRIGGER tr_refresh_discovery_domain_metrics_review
  AFTER UPDATE ON discovered_contacts
  FOR EACH ROW
  EXECUTE FUNCTION refresh_discovery_domain_metrics_from_review();

DROP FUNCTION IF EXISTS claim_discovery_frontier(uuid, integer, integer);
DROP FUNCTION IF EXISTS claim_discovery_frontier(uuid, integer);
CREATE OR REPLACE FUNCTION claim_discovery_frontier(
  p_run_id uuid,
  p_limit integer DEFAULT 10,
  p_per_domain_limit integer DEFAULT 3
)
RETURNS SETOF discovery_frontier
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH recent_fetches AS (
    SELECT
      domain,
      COUNT(*) FILTER (WHERE fetched_at >= now() - interval '7 days') AS recent_fetches_7d
    FROM discovery_pages
    GROUP BY domain
  ),
  ranked AS (
    SELECT
      frontier.id,
      frontier.priority_score,
      COALESCE(frontier.next_fetch_at, now()) AS frontier_due_at,
      frontier.created_at,
      ROW_NUMBER() OVER (
        PARTITION BY frontier.domain
        ORDER BY frontier.priority_score DESC, COALESCE(frontier.next_fetch_at, now()) ASC, frontier.created_at ASC
      ) AS domain_rank
    FROM discovery_frontier frontier
    LEFT JOIN discovery_domains domains
      ON domains.domain = frontier.domain
    LEFT JOIN recent_fetches rf
      ON rf.domain = frontier.domain
    WHERE COALESCE(frontier.next_fetch_at, now()) <= now()
      AND (
        frontier.status IN ('queued', 'done')
        OR (
          frontier.status = 'fetching'
          AND frontier.claimed_at IS NOT NULL
          AND frontier.claimed_at < now() - interval '20 minutes'
        )
      )
      AND COALESCE(domains.status, 'active') NOT IN ('paused', 'blocked')
      AND COALESCE(rf.recent_fetches_7d, 0) < COALESCE(domains.weekly_fetch_budget, 20)
  ),
  claimable AS (
    SELECT frontier.id
    FROM discovery_frontier frontier
    JOIN ranked
      ON ranked.id = frontier.id
    WHERE ranked.domain_rank <= GREATEST(COALESCE(p_per_domain_limit, 3), 1)
    ORDER BY ranked.priority_score DESC, ranked.frontier_due_at ASC, ranked.created_at ASC
    LIMIT GREATEST(COALESCE(p_limit, 10), 1)
    FOR UPDATE OF frontier SKIP LOCKED
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

REVOKE ALL ON FUNCTION claim_discovery_frontier(uuid, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_discovery_frontier(uuid, integer, integer) TO authenticated, service_role;

CREATE OR REPLACE VIEW ops_discovery_domain_yield AS
WITH recent_fetches AS (
  SELECT
    domain,
    COUNT(*) FILTER (WHERE fetched_at >= now() - interval '7 days') AS recent_fetches_7d,
    COUNT(*) FILTER (WHERE fetched_at >= now() - interval '30 days') AS recent_fetches_30d
  FROM discovery_pages
  GROUP BY domain
),
evidence_per_candidate AS (
  SELECT
    domain,
    AVG(evidence_count)::numeric(10,2) AS avg_evidence_per_candidate
  FROM (
    SELECT
      discovery_extract_domain(page_url) AS domain,
      discovered_contact_id,
      COUNT(*) AS evidence_count
    FROM discovery_evidence
    GROUP BY discovery_extract_domain(page_url), discovered_contact_id
  ) evidence_counts
  GROUP BY domain
)
SELECT
  d.domain,
  d.status,
  d.pages_queued,
  d.pages_fetched,
  d.promising_pages,
  d.candidates_extracted,
  d.candidates_approved,
  d.candidates_rejected,
  d.duplicate_candidates,
  d.average_evidence_confidence,
  d.weekly_fetch_budget,
  d.yield_score,
  d.revisit_interval_hours,
  COALESCE(rf.recent_fetches_7d, 0) AS recent_fetches_7d,
  COALESCE(rf.recent_fetches_30d, 0) AS recent_fetches_30d,
  GREATEST(d.weekly_fetch_budget - COALESCE(rf.recent_fetches_7d, 0), 0) AS remaining_budget_7d,
  ROUND(100.0 * d.candidates_approved / NULLIF(d.candidates_extracted, 0), 2) AS approval_rate_pct,
  ROUND(
    100.0 * d.duplicate_candidates / NULLIF(d.candidates_extracted + d.duplicate_candidates, 0),
    2
  ) AS duplicate_rate_pct,
  ROUND(COALESCE(epc.avg_evidence_per_candidate, 0)::numeric, 2) AS avg_evidence_per_candidate,
  d.last_seen_at,
  d.last_fetched_at,
  d.next_fetch_at,
  d.last_approved_contact_at,
  d.last_rejected_contact_at,
  d.last_sitemap_at,
  d.last_rss_at
FROM discovery_domains d
LEFT JOIN recent_fetches rf
  ON rf.domain = d.domain
LEFT JOIN evidence_per_candidate epc
  ON epc.domain = d.domain
ORDER BY d.yield_score DESC, d.candidates_approved DESC, d.domain;

CREATE OR REPLACE VIEW ops_discovery_page_type_mix AS
SELECT
  page_type,
  COUNT(*) AS pages,
  COUNT(DISTINCT domain) AS domains,
  MAX(fetched_at) AS last_fetched_at
FROM discovery_pages
GROUP BY page_type
ORDER BY pages DESC, page_type;

CREATE OR REPLACE VIEW ops_discovery_coverage_summary AS
WITH frontier AS (
  SELECT
    COUNT(*) AS frontier_size,
    COUNT(*) FILTER (WHERE status = 'queued') AS queued_urls,
    COUNT(*) FILTER (WHERE status = 'fetching') AS fetching_urls,
    COUNT(*) FILTER (WHERE status = 'done') AS done_urls,
    COUNT(*) FILTER (WHERE status = 'failed') AS failed_urls,
    COUNT(*) FILTER (WHERE status = 'ignored') AS ignored_urls,
    COUNT(*) FILTER (WHERE status = 'done' AND COALESCE(next_fetch_at, now()) <= now()) AS due_for_revisit_urls
  FROM discovery_frontier
),
domains AS (
  SELECT
    COUNT(*) FILTER (WHERE yield_score >= 1.00 OR candidates_approved > 0) AS high_yield_domains,
    COUNT(*) FILTER (WHERE status = 'exhausted') AS exhausted_domains,
    COALESCE(SUM(duplicate_candidates), 0) AS duplicates_total
  FROM discovery_domains
),
refills AS (
  SELECT
    COUNT(*) AS frontier_refill_events,
    COUNT(*) FILTER (WHERE created_at >= now() - interval '30 days') AS frontier_refill_events_30d,
    MAX(created_at) AS last_frontier_refill_at
  FROM discovery_frontier_refills
),
pages AS (
  SELECT COUNT(*) AS pages_fetched
  FROM discovery_pages
),
candidates AS (
  SELECT AVG(evidence_count)::numeric(10,2) AS avg_evidence_count_per_candidate
  FROM discovered_contacts
  WHERE evidence_count > 0
),
revisits AS (
  SELECT AVG(EXTRACT(EPOCH FROM (next_fetch_at - last_fetched_at)) / 3600.0)::numeric(10,2) AS avg_revisit_latency_hours
  FROM discovery_frontier
  WHERE last_fetched_at IS NOT NULL
    AND next_fetch_at IS NOT NULL
)
SELECT
  frontier.frontier_size,
  frontier.queued_urls,
  frontier.fetching_urls,
  frontier.done_urls,
  frontier.failed_urls,
  frontier.ignored_urls,
  frontier.due_for_revisit_urls,
  domains.high_yield_domains,
  domains.exhausted_domains,
  pages.pages_fetched,
  domains.duplicates_total,
  ROUND(COALESCE(candidates.avg_evidence_count_per_candidate, 0)::numeric, 2) AS avg_evidence_count_per_candidate,
  refills.frontier_refill_events,
  refills.frontier_refill_events_30d,
  refills.last_frontier_refill_at,
  ROUND(COALESCE(revisits.avg_revisit_latency_hours, 0)::numeric, 2) AS avg_revisit_latency_hours
FROM frontier
CROSS JOIN domains
CROSS JOIN refills
CROSS JOIN pages
CROSS JOIN candidates
CROSS JOIN revisits;

CREATE OR REPLACE VIEW coverage_gaps AS
WITH people_geo AS (
  SELECT
    'state:' || upper(l.state) AS geography_key,
    p.id AS person_id,
    p.last_verified_at,
    p.created_at
  FROM people p
  JOIN locations l
    ON l.id = p.location_id
  UNION ALL
  SELECT
    'metro:' || ma.metro_key AS geography_key,
    p.id AS person_id,
    p.last_verified_at,
    p.created_at
  FROM people p
  JOIN locations l
    ON l.id = p.location_id
  JOIN metro_area_cities mac
    ON lower(mac.city) = lower(l.city)
   AND upper(mac.state) = upper(l.state)
  JOIN metro_areas ma
    ON ma.id = mac.metro_area_id
   AND ma.active = true
),
people_sector_mix AS (
  SELECT
    geography_key,
    jsonb_object_agg(sector_name, sector_count ORDER BY sector_name) AS sector_mix
  FROM (
    SELECT
      pg.geography_key,
      s.name AS sector_name,
      COUNT(DISTINCT pg.person_id) AS sector_count
    FROM people_geo pg
    JOIN person_sectors ps
      ON ps.person_id = pg.person_id
    JOIN sectors s
      ON s.id = ps.sector_id
    GROUP BY pg.geography_key, s.name
  ) sector_counts
  GROUP BY geography_key
),
approved_people AS (
  SELECT geography_key, COUNT(DISTINCT person_id) AS approved_people_count
  FROM people_geo
  GROUP BY geography_key
),
verified_people AS (
  SELECT geography_key, COUNT(DISTINCT person_id) AS verified_people_count
  FROM people_geo
  WHERE last_verified_at IS NOT NULL
  GROUP BY geography_key
),
discovered_geo AS (
  SELECT
    'state:' || upper(location_state) AS geography_key,
    id AS discovered_contact_id,
    status,
    created_at,
    reviewed_at,
    last_seen_at
  FROM discovered_contacts
  WHERE COALESCE(location_state, '') <> ''
  UNION ALL
  SELECT
    'metro:' || ma.metro_key AS geography_key,
    dc.id AS discovered_contact_id,
    dc.status,
    dc.created_at,
    dc.reviewed_at,
    dc.last_seen_at
  FROM discovered_contacts dc
  JOIN metro_area_cities mac
    ON lower(mac.city) = lower(dc.location_city)
   AND upper(mac.state) = upper(dc.location_state)
  JOIN metro_areas ma
    ON ma.id = mac.metro_area_id
   AND ma.active = true
  WHERE COALESCE(dc.location_city, '') <> ''
    AND COALESCE(dc.location_state, '') <> ''
),
pending_discovered AS (
  SELECT geography_key, COUNT(DISTINCT discovered_contact_id) AS pending_discovered_count
  FROM discovered_geo
  WHERE status = 'pending'
  GROUP BY geography_key
),
recent_activity AS (
  SELECT geography_key, COUNT(*) AS recent_activity_30d
  FROM (
    SELECT
      geography_key,
      COALESCE(reviewed_at, last_seen_at, created_at) AS activity_at
    FROM discovered_geo
    UNION ALL
    SELECT
      geography_key,
      COALESCE(last_verified_at, created_at) AS activity_at
    FROM people_geo
  ) activity
  WHERE activity_at >= now() - interval '30 days'
  GROUP BY geography_key
),
benchmark_pressure AS (
  SELECT
    lower(priority_metro) AS metro_label_key,
    COUNT(*) AS benchmark_source_count
  FROM benchmark_discovery_sources_active
  WHERE priority_metro IS NOT NULL
  GROUP BY lower(priority_metro)
)
SELECT
  ct.geography_key,
  ct.geography_type,
  ct.label,
  ct.state_code,
  ma.metro_key,
  ma.metro_name,
  ct.priority_weight,
  ct.expected_presence_score,
  ct.sector_emphasis,
  COALESCE(ap.approved_people_count, 0) AS approved_people_count,
  COALESCE(pd.pending_discovered_count, 0) AS pending_discovered_count,
  COALESCE(vp.verified_people_count, 0) AS verified_people_count,
  COALESCE(ra.recent_activity_30d, 0) AS recent_activity_30d,
  COALESCE(psm.sector_mix, '{}'::jsonb) AS sector_mix,
  ROUND((
    ct.priority_weight * ct.expected_presence_score
    + COALESCE(bp.benchmark_source_count, 0) * 1.25
    + GREATEST(cardinality(ct.sector_emphasis), 0) * 0.50
  )::numeric, 2) AS expected_coverage_score,
  ROUND(GREATEST((
    ct.priority_weight * ct.expected_presence_score
    + COALESCE(bp.benchmark_source_count, 0) * 1.25
    + GREATEST(cardinality(ct.sector_emphasis), 0) * 0.50
  ) - (
    COALESCE(ap.approved_people_count, 0) * 1.50
    + COALESCE(pd.pending_discovered_count, 0) * 0.75
    + COALESCE(vp.verified_people_count, 0) * 0.50
    + COALESCE(ra.recent_activity_30d, 0) * 0.25
  ), 0)::numeric, 2) AS gap_score
FROM coverage_targets ct
LEFT JOIN metro_areas ma
  ON ma.id = ct.metro_area_id
LEFT JOIN approved_people ap
  ON ap.geography_key = ct.geography_key
LEFT JOIN pending_discovered pd
  ON pd.geography_key = ct.geography_key
LEFT JOIN verified_people vp
  ON vp.geography_key = ct.geography_key
LEFT JOIN recent_activity ra
  ON ra.geography_key = ct.geography_key
LEFT JOIN people_sector_mix psm
  ON psm.geography_key = ct.geography_key
LEFT JOIN benchmark_pressure bp
  ON bp.metro_label_key = lower(ct.label)
WHERE ct.active = true
ORDER BY gap_score DESC, ct.priority_weight DESC, ct.label;

REVOKE ALL ON TABLE discovery_frontier_refills FROM anon, authenticated;
REVOKE ALL ON TABLE metro_areas FROM anon, authenticated;
REVOKE ALL ON TABLE metro_area_cities FROM anon, authenticated;
REVOKE ALL ON TABLE coverage_targets FROM anon, authenticated;
REVOKE ALL ON TABLE ops_discovery_domain_yield FROM anon, authenticated;
REVOKE ALL ON TABLE ops_discovery_page_type_mix FROM anon, authenticated;
REVOKE ALL ON TABLE ops_discovery_coverage_summary FROM anon, authenticated;
REVOKE ALL ON TABLE coverage_gaps FROM anon, authenticated;

DO $$
DECLARE
  v_domain text;
BEGIN
  FOR v_domain IN
    SELECT domain FROM discovery_domains
    UNION
    SELECT domain FROM discovery_frontier
    UNION
    SELECT domain FROM discovery_pages
  LOOP
    PERFORM refresh_discovery_domain_metrics(v_domain);
  END LOOP;
END;
$$;
