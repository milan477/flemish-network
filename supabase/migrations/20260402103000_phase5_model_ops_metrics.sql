CREATE TABLE IF NOT EXISTS embedding_batch_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gemini_batch_name text NOT NULL UNIQUE,
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'succeeded', 'failed', 'cancelled', 'ingested')),
  request_count integer NOT NULL DEFAULT 0,
  people_count integer NOT NULL DEFAULT 0,
  manifest jsonb NOT NULL DEFAULT '[]'::jsonb,
  batch_state text,
  batch_stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  last_polled_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_embedding_batch_runs_status_created
  ON embedding_batch_runs(status, created_at DESC);

CREATE OR REPLACE FUNCTION set_embedding_batch_runs_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_set_embedding_batch_runs_updated_at ON embedding_batch_runs;
CREATE TRIGGER tr_set_embedding_batch_runs_updated_at
  BEFORE UPDATE ON embedding_batch_runs
  FOR EACH ROW
  EXECUTE FUNCTION set_embedding_batch_runs_updated_at();

ALTER TABLE embedding_batch_runs ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE VIEW ops_connection_suggestion_metrics AS
SELECT
  COUNT(*) FILTER (WHERE status <> 'pending') AS reviewed_suggestions,
  COUNT(*) FILTER (WHERE status = 'approved') AS approved_suggestions,
  COUNT(*) FILTER (WHERE status = 'rejected') AS rejected_suggestions,
  COUNT(*) FILTER (WHERE status = 'dismissed') AS dismissed_suggestions,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE status = 'approved')
    / NULLIF(COUNT(*) FILTER (WHERE status <> 'pending'), 0),
    2
  ) AS acceptance_rate_pct
FROM connection_suggestions;

CREATE OR REPLACE VIEW ops_phase_success_metrics AS
WITH search_success AS (
  SELECT
    COUNT(*) AS total_queries,
    COUNT(*) FILTER (WHERE click_count > 0) AS successful_queries
  FROM ops_search_benchmark_clicks
),
discovery_source_recall AS (
  SELECT
    COUNT(*) AS total_sources,
    COUNT(*) FILTER (WHERE approved_contacts > 0) AS covered_sources
  FROM ops_benchmark_discovery_source_coverage
),
discovery_review AS (
  SELECT * FROM ops_discovery_review_metrics
),
discovery_coverage AS (
  SELECT * FROM ops_discovery_coverage_summary
),
discovery_domain_coverage AS (
  SELECT
    COUNT(DISTINCT domain) AS unique_domains_with_fetches
  FROM discovery_pages
),
discovery_duplicate_totals AS (
  SELECT
    COALESCE(SUM(duplicate_candidates), 0) AS duplicate_candidates,
    COALESCE(SUM(candidates_extracted), 0) AS extracted_candidates
  FROM discovery_domains
),
discovery_evidence AS (
  SELECT
    COUNT(*) FILTER (WHERE review_outcome IN ('approved_new', 'approved_merge')) AS approved_discoveries,
    COUNT(*) FILTER (
      WHERE review_outcome IN ('approved_new', 'approved_merge')
        AND COALESCE(evidence_count, 0) >= 2
    ) AS multi_evidence_approved
  FROM discovered_contacts
),
profile_reviews AS (
  SELECT
    COUNT(*) FILTER (WHERE status <> 'pending') AS reviewed_suggestions,
    COUNT(*) FILTER (WHERE status = 'approved') AS approved_suggestions
  FROM profile_suggestions
),
embedding_coverage AS (
  SELECT
    COUNT(*) AS total_profiles,
    COUNT(*) FILTER (WHERE embedding_generated_at IS NOT NULL) AS profiles_with_embeddings,
    COUNT(*) FILTER (WHERE location_id IS NOT NULL AND last_verified_at IS NOT NULL) AS profiles_with_verified_us_location
  FROM people
),
gap_coverage AS (
  SELECT
    COUNT(*) AS active_targets,
    COUNT(*) FILTER (WHERE gap_score <= 0) AS closed_targets
  FROM coverage_gaps
),
connection_acceptance AS (
  SELECT * FROM ops_connection_suggestion_metrics
)
SELECT
  'search_benchmark_success_rate_pct'::text AS metric_key,
  ROUND(
    100.0 * successful_queries / NULLIF(total_queries, 0),
    2
  )::numeric AS metric_value,
  'percent'::text AS unit,
  'Benchmark queries with at least one recorded click'::text AS description
FROM search_success
UNION ALL
SELECT
  'discovery_source_recall_pct',
  ROUND(
    100.0 * covered_sources / NULLIF(total_sources, 0),
    2
  )::numeric,
  'percent',
  'Benchmark discovery sources that have produced at least one approved contact'
FROM discovery_source_recall
UNION ALL
SELECT
  'discovery_approved_per_100_fetched_pages',
  ROUND(
    100.0 * approved_contacts / NULLIF(pages_fetched, 0),
    2
  )::numeric,
  'count',
  'Approved discoveries per 100 fetched pages'
FROM discovery_review
CROSS JOIN discovery_coverage
UNION ALL
SELECT
  'discovery_approved_per_unique_domain',
  ROUND(
    approved_contacts::numeric / NULLIF(unique_domains_with_fetches, 0),
    2
  )::numeric,
  'count',
  'Approved discoveries per unique fetched domain'
FROM discovery_review
CROSS JOIN discovery_domain_coverage
UNION ALL
SELECT
  'discovery_multi_evidence_rate_pct',
  ROUND(
    100.0 * multi_evidence_approved / NULLIF(approved_discoveries, 0),
    2
  )::numeric,
  'percent',
  'Approved discoveries backed by two or more evidence pages'
FROM discovery_evidence
UNION ALL
SELECT
  'discovery_review_approval_rate_pct',
  approval_rate_pct::numeric,
  'percent',
  'Approved or merged discovered contacts divided by reviewed discovered contacts'
FROM discovery_review
UNION ALL
SELECT
  'profile_suggestion_approval_rate_pct',
  ROUND(
    100.0 * approved_suggestions / NULLIF(reviewed_suggestions, 0),
    2
  )::numeric,
  'percent',
  'Approved profile suggestions divided by reviewed profile suggestions'
FROM profile_reviews
UNION ALL
SELECT
  'discovery_duplicate_rate_pct',
  ROUND(
    100.0 * duplicate_candidates / NULLIF(extracted_candidates + duplicate_candidates, 0),
    2
  )::numeric,
  'percent',
  'Duplicate discoveries relative to extracted plus duplicate candidates'
FROM discovery_duplicate_totals
UNION ALL
SELECT
  'profiles_with_embeddings_pct',
  ROUND(
    100.0 * profiles_with_embeddings / NULLIF(total_profiles, 0),
    2
  )::numeric,
  'percent',
  'Profiles with a usable person-level embedding'
FROM embedding_coverage
UNION ALL
SELECT
  'profiles_with_verified_us_location_pct',
  ROUND(
    100.0 * profiles_with_verified_us_location / NULLIF(total_profiles, 0),
    2
  )::numeric,
  'percent',
  'Profiles with a stored location and verification timestamp'
FROM embedding_coverage
UNION ALL
SELECT
  'gap_closure_rate_pct',
  ROUND(
    100.0 * closed_targets / NULLIF(active_targets, 0),
    2
  )::numeric,
  'percent',
  'Active coverage targets whose current gap score is zero'
FROM gap_coverage
UNION ALL
SELECT
  'connection_suggestion_acceptance_rate_pct',
  acceptance_rate_pct::numeric,
  'percent',
  'Approved connection suggestions divided by reviewed connection suggestions'
FROM connection_acceptance;

REVOKE ALL ON TABLE embedding_batch_runs FROM anon, authenticated;
REVOKE ALL ON TABLE ops_connection_suggestion_metrics FROM anon, authenticated;
REVOKE ALL ON TABLE ops_phase_success_metrics FROM anon, authenticated;
