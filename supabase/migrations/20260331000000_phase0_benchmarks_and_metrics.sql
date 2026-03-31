-- Phase 0 benchmark contract: fixed benchmark datasets plus saved metrics views

CREATE TABLE IF NOT EXISTS benchmark_search_queries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  query_text text NOT NULL UNIQUE,
  intent text NOT NULL CHECK (intent IN ('direct_lookup', 'faceted_search', 'exploratory_semantic')),
  priority smallint NOT NULL DEFAULT 100,
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE benchmark_search_queries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read benchmark_search_queries"
  ON benchmark_search_queries FOR SELECT TO anon, authenticated USING (true);

INSERT INTO benchmark_search_queries (slug, query_text, intent, priority, notes)
VALUES
  ('ku-leuven-boston', 'KU Leuven alumni in Boston', 'faceted_search', 10, 'University + metro lookup'),
  ('imec-california', 'imec people in California', 'faceted_search', 20, 'Flemish institution + state lookup'),
  ('fayat-new-york', 'Fayat fellows in New York', 'faceted_search', 30, 'Fellowship + metro lookup'),
  ('belgian-ai-seattle', 'Belgian AI researchers in Seattle', 'exploratory_semantic', 40, 'Sector + city exploratory search'),
  ('ghent-biotech-san-diego', 'biotech founders in San Diego with Ghent background', 'exploratory_semantic', 50, 'Sector + geography + Flemish connection'),
  ('finance-antwerp-chicago', 'finance professionals from Antwerp in Chicago', 'exploratory_semantic', 60, 'Sector + Flemish city + metro'),
  ('stanford-flemish-academics', 'Flemish academics at Stanford', 'direct_lookup', 70, 'Named organization direct lookup'),
  ('semiconductor-leuven-austin', 'semiconductor executives with Leuven ties in Austin', 'exploratory_semantic', 80, 'Industry + Flemish link + metro'),
  ('culture-los-angeles', 'culture and arts leaders from Flanders in Los Angeles', 'exploratory_semantic', 90, 'Sector + region + metro'),
  ('ugent-texas-students', 'students from Ghent University in Texas', 'faceted_search', 100, 'University + state lookup'),
  ('belgian-professors-dc', 'Belgian professors in Washington DC', 'exploratory_semantic', 110, 'Role + metro lookup'),
  ('vub-massachusetts-research', 'VUB researchers in Massachusetts', 'faceted_search', 120, 'University + state lookup')
ON CONFLICT (slug) DO UPDATE SET
  query_text = EXCLUDED.query_text,
  intent = EXCLUDED.intent,
  priority = EXCLUDED.priority,
  notes = EXCLUDED.notes,
  active = true;

CREATE TABLE IF NOT EXISTS benchmark_discovery_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  label text NOT NULL,
  source_family text NOT NULL,
  seed_query text NOT NULL,
  domain_pattern text,
  expected_signal text NOT NULL,
  priority_metro text,
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE benchmark_discovery_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read benchmark_discovery_sources"
  ON benchmark_discovery_sources FOR SELECT TO anon, authenticated USING (true);

INSERT INTO benchmark_discovery_sources (
  slug,
  label,
  source_family,
  seed_query,
  domain_pattern,
  expected_signal,
  priority_metro,
  notes
)
VALUES
  ('baef-fellows', 'BAEF fellows and alumni pages', 'fellowship', 'site:baef.be fellowship usa alumni', 'baef.be', 'Named fellows with current US affiliation', 'New York', 'High-signal fellowship benchmark'),
  ('kuleuven-us-pages', 'KU Leuven US-facing alumni and lab pages', 'university', 'site:kuleuven.be usa alumni lab', 'kuleuven.be', 'Faculty, alumni, or research staff tied to KU Leuven', 'Boston', 'Head-coverage university source'),
  ('ugent-us-pages', 'UGent US-facing alumni and lab pages', 'university', 'site:ugent.be usa alumni lab', 'ugent.be', 'Faculty, alumni, or research staff tied to UGent', 'Boston', 'Head-coverage university source'),
  ('vub-us-pages', 'VUB US-facing alumni and lab pages', 'university', 'site:vub.be usa alumni research', 'vub.be', 'Faculty, alumni, or research staff tied to VUB', 'Washington DC', 'Head-coverage university source'),
  ('uantwerpen-us-pages', 'UAntwerp US-facing alumni and lab pages', 'university', 'site:uantwerpen.be usa alumni research', 'uantwerpen.be', 'Faculty, alumni, or research staff tied to UAntwerp', 'Chicago', 'Head-coverage university source'),
  ('imec-us-pages', 'imec team, lab, and partner pages', 'research_institute', 'site:imec.com usa team research', 'imec.com', 'Researchers or executives tied to imec with US presence', 'San Francisco', 'Research institute benchmark'),
  ('belgian-chamber', 'Belgian-American chamber and association rosters', 'association', 'belgian american chamber directory usa', null, 'Business leaders with Belgian or Flemish ties', 'New York', 'Association roster benchmark'),
  ('event-rosters', 'Conference and event speaker rosters', 'event_roster', 'flemish belgian speaker roster usa conference', null, 'Speaker pages with organization and location evidence', 'Austin', 'Event roster benchmark'),
  ('team-pages', 'US university lab and team pages mentioning Belgian or Flemish backgrounds', 'lab_team_page', 'belgian flemish lab team usa', null, 'Lab staff pages with explicit Flemish institution ties', 'San Diego', 'Long-tail lab/team benchmark'),
  ('advisory-boards', 'Advisory boards and nonprofit leadership pages', 'advisory_board', 'flemish belgian advisory board usa', null, 'Board members with high-quality organization evidence', 'Washington DC', 'Leadership benchmark')
ON CONFLICT (slug) DO UPDATE SET
  label = EXCLUDED.label,
  source_family = EXCLUDED.source_family,
  seed_query = EXCLUDED.seed_query,
  domain_pattern = EXCLUDED.domain_pattern,
  expected_signal = EXCLUDED.expected_signal,
  priority_metro = EXCLUDED.priority_metro,
  notes = EXCLUDED.notes,
  active = true;

ALTER TABLE discovered_contacts
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_outcome text,
  ADD COLUMN IF NOT EXISTS approved_person_id uuid REFERENCES people(id) ON DELETE SET NULL;

ALTER TABLE profile_suggestions
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

CREATE OR REPLACE FUNCTION set_reviewed_at_from_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'pending' THEN
    NEW.reviewed_at := NULL;
  ELSIF OLD.status IS DISTINCT FROM NEW.status AND NEW.reviewed_at IS NULL THEN
    NEW.reviewed_at := now();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_set_discovered_contact_reviewed_at ON discovered_contacts;
CREATE TRIGGER tr_set_discovered_contact_reviewed_at
  BEFORE UPDATE ON discovered_contacts
  FOR EACH ROW
  EXECUTE FUNCTION set_reviewed_at_from_status();

DROP TRIGGER IF EXISTS tr_set_profile_suggestion_reviewed_at ON profile_suggestions;
CREATE TRIGGER tr_set_profile_suggestion_reviewed_at
  BEFORE UPDATE ON profile_suggestions
  FOR EACH ROW
  EXECUTE FUNCTION set_reviewed_at_from_status();

CREATE INDEX IF NOT EXISTS idx_discovered_contacts_reviewed_at
  ON discovered_contacts(reviewed_at);

CREATE INDEX IF NOT EXISTS idx_discovered_contacts_review_outcome
  ON discovered_contacts(review_outcome);

CREATE INDEX IF NOT EXISTS idx_profile_suggestions_reviewed_at
  ON profile_suggestions(reviewed_at);

CREATE OR REPLACE VIEW benchmark_search_queries_active AS
SELECT
  id,
  slug,
  query_text,
  intent,
  priority,
  notes
FROM benchmark_search_queries
WHERE active = true
ORDER BY priority, query_text;

CREATE OR REPLACE VIEW benchmark_discovery_sources_active AS
SELECT
  id,
  slug,
  label,
  source_family,
  seed_query,
  domain_pattern,
  expected_signal,
  priority_metro,
  notes
FROM benchmark_discovery_sources
WHERE active = true
ORDER BY source_family, label;

CREATE OR REPLACE VIEW ops_search_benchmark_clicks AS
WITH normalized_clicks AS (
  SELECT
    lower(btrim(query)) AS normalized_query,
    person_id,
    clicked_at
  FROM search_clicks
)
SELECT
  b.slug,
  b.query_text,
  b.intent,
  COUNT(c.person_id) AS click_count,
  COUNT(DISTINCT c.person_id) AS unique_people_clicked,
  MAX(c.clicked_at) AS last_clicked_at
FROM benchmark_search_queries_active b
LEFT JOIN normalized_clicks c
  ON c.normalized_query = lower(btrim(b.query_text))
GROUP BY b.slug, b.query_text, b.intent, b.priority
ORDER BY b.priority, b.query_text;

CREATE OR REPLACE VIEW ops_discovery_review_metrics AS
SELECT
  COUNT(*) FILTER (WHERE status = 'pending') AS pending_contacts,
  COUNT(*) FILTER (WHERE status <> 'pending') AS reviewed_contacts,
  COUNT(*) FILTER (WHERE review_outcome IN ('approved_new', 'approved_merge')) AS approved_contacts,
  COUNT(*) FILTER (WHERE review_outcome = 'approved_new') AS approved_new_contacts,
  COUNT(*) FILTER (WHERE review_outcome = 'approved_merge') AS merged_into_existing_contacts,
  COUNT(*) FILTER (WHERE status = 'rejected') AS rejected_contacts,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE review_outcome IN ('approved_new', 'approved_merge'))
    / NULLIF(COUNT(*) FILTER (WHERE status <> 'pending'), 0),
    2
  ) AS approval_rate_pct,
  ROUND(
    PERCENTILE_DISC(0.5) WITHIN GROUP (
      ORDER BY EXTRACT(EPOCH FROM (reviewed_at - created_at)) / 3600.0
    )::numeric,
    2
  ) AS median_review_hours
FROM discovered_contacts;

CREATE OR REPLACE VIEW ops_benchmark_discovery_source_coverage AS
WITH contact_domains AS (
  SELECT DISTINCT
    dc.id,
    dc.review_outcome,
    dc.reviewed_at,
    lower(regexp_replace(url, '^https?://(www\\.)?([^/]+).*$','\\2')) AS source_domain
  FROM discovered_contacts dc
  CROSS JOIN LATERAL unnest(COALESCE(dc.source_urls, ARRAY[]::text[])) AS url
)
SELECT
  b.slug,
  b.label,
  b.source_family,
  b.domain_pattern,
  COUNT(DISTINCT cd.id) FILTER (WHERE cd.review_outcome IN ('approved_new', 'approved_merge')) AS approved_contacts,
  COUNT(DISTINCT cd.id) FILTER (WHERE cd.review_outcome = 'approved_new') AS approved_new_contacts,
  COUNT(DISTINCT cd.id) FILTER (WHERE cd.review_outcome = 'approved_merge') AS merged_contacts,
  COUNT(DISTINCT cd.id) FILTER (WHERE cd.review_outcome = 'rejected') AS rejected_contacts,
  MAX(cd.reviewed_at) AS last_reviewed_at
FROM benchmark_discovery_sources_active b
LEFT JOIN contact_domains cd
  ON b.domain_pattern IS NOT NULL
  AND (
    cd.source_domain = lower(b.domain_pattern)
    OR cd.source_domain LIKE '%.' || lower(b.domain_pattern)
  )
GROUP BY b.slug, b.label, b.source_family, b.domain_pattern
ORDER BY b.source_family, b.label;

CREATE OR REPLACE VIEW ops_phase_success_metrics AS
WITH discovery AS (
  SELECT * FROM ops_discovery_review_metrics
),
profile_reviews AS (
  SELECT
    COUNT(*) FILTER (WHERE status <> 'pending') AS reviewed_suggestions,
    COUNT(*) FILTER (WHERE status = 'approved') AS approved_suggestions
  FROM profile_suggestions
),
embeddings AS (
  SELECT
    COUNT(*) AS total_profiles,
    COUNT(*) FILTER (WHERE embedding_generated_at IS NOT NULL) AS profiles_with_embeddings,
    COUNT(*) FILTER (WHERE location_id IS NOT NULL AND last_verified_at IS NOT NULL) AS profiles_with_verified_us_location
  FROM people
)
SELECT
  'search_benchmark_query_count'::text AS metric_key,
  COUNT(*)::numeric AS metric_value,
  'count'::text AS unit,
  'Fixed benchmark search queries currently active'::text AS description
FROM benchmark_search_queries_active
UNION ALL
SELECT
  'discovery_benchmark_source_count',
  COUNT(*)::numeric,
  'count',
  'Fixed benchmark discovery sources currently active'
FROM benchmark_discovery_sources_active
UNION ALL
SELECT
  'search_benchmark_clicks',
  COALESCE(SUM(click_count), 0)::numeric,
  'count',
  'Clicks recorded on benchmark queries'
FROM ops_search_benchmark_clicks
UNION ALL
SELECT
  'discovery_review_approval_rate_pct',
  approval_rate_pct::numeric,
  'percent',
  'Approved or merged discovered contacts divided by reviewed discovered contacts'
FROM discovery
UNION ALL
SELECT
  'discovery_median_review_hours',
  median_review_hours::numeric,
  'hours',
  'Median time from discovered contact creation to review'
FROM discovery
UNION ALL
SELECT
  'profile_suggestion_approval_rate_pct',
  ROUND(100.0 * approved_suggestions / NULLIF(reviewed_suggestions, 0), 2)::numeric,
  'percent',
  'Approved profile suggestions divided by reviewed profile suggestions'
FROM profile_reviews
UNION ALL
SELECT
  'profiles_with_embeddings_pct',
  ROUND(100.0 * profiles_with_embeddings / NULLIF(total_profiles, 0), 2)::numeric,
  'percent',
  'People rows with a generated embedding'
FROM embeddings
UNION ALL
SELECT
  'profiles_with_verified_us_location_pct',
  ROUND(100.0 * profiles_with_verified_us_location / NULLIF(total_profiles, 0), 2)::numeric,
  'percent',
  'People rows with both a location and a verification timestamp'
FROM embeddings;
