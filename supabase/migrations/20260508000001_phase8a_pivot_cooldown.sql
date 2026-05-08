-- Phase 8A: pivot cooldown and scheduled refresh.
-- Adds last_recommended_at / recommended_count to discovery_entity_pivots so
-- the planning action can rotate pivots across successive calls (72-hour cooldown).
-- coverage_gaps is a VIEW over coverage_targets; the cooldown columns live on
-- coverage_targets and the view is updated to expose them.

-- ── 1. discovery_entity_pivots cooldown columns ──────────────────────────────

ALTER TABLE discovery_entity_pivots
  ADD COLUMN IF NOT EXISTS last_recommended_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS recommended_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_dep_last_recommended_at
  ON discovery_entity_pivots (last_recommended_at);

-- ── 2. coverage_targets cooldown columns ─────────────────────────────────────
-- coverage_gaps is a view over coverage_targets; we add the cooldown columns
-- here so the view can expose them without requiring a base-table change elsewhere.

ALTER TABLE coverage_targets
  ADD COLUMN IF NOT EXISTS last_recommended_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS recommended_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_ct_last_recommended_at
  ON coverage_targets (last_recommended_at);

-- ── 3. Rebuild ops_discovery_entity_pivots to expose cooldown columns ─────────
-- DROP first because CREATE OR REPLACE cannot insert new columns in the middle
-- of an existing view's column list.

DROP VIEW IF EXISTS ops_discovery_entity_pivots;

CREATE VIEW ops_discovery_entity_pivots AS
SELECT
  p.entity_key,
  p.entity_name,
  p.entity_type,
  p.normalized_domain,
  p.coverage_target_keys,
  p.seed_queries,
  p.source_urls,
  p.last_recommended_at,
  p.recommended_count,
  COUNT(ps.id) AS source_count,
  COUNT(ps.id) FILTER (
    WHERE COALESCE(ps.confidence, 0) >= 0.75
      OR COALESCE(ps.source_strength, 0) >= 3
  ) AS strong_source_count,
  COUNT(DISTINCT ps.discovered_contact_id) FILTER (
    WHERE dc.review_outcome IN ('approved_new', 'approved_merge')
  ) AS approved_contact_count,
  COUNT(DISTINCT ps.discovered_contact_id) FILTER (
    WHERE dc.status = 'pending'
  ) AS pending_contact_count,
  ROUND(COALESCE(AVG(ps.confidence), 0)::numeric, 2) AS avg_confidence,
  ROUND(COALESCE(MAX(ps.source_strength), 0)::numeric, 2) AS max_source_strength,
  p.seeded_frontier_count,
  p.last_seeded_at,
  p.last_seen_at,
  ROUND((
    COUNT(DISTINCT ps.discovered_contact_id) FILTER (
      WHERE dc.review_outcome IN ('approved_new', 'approved_merge')
    ) * 3.00
    + COUNT(ps.id) FILTER (
      WHERE COALESCE(ps.confidence, 0) >= 0.75
        OR COALESCE(ps.source_strength, 0) >= 3
    ) * 1.50
    + COUNT(DISTINCT ps.discovered_contact_id) FILTER (
      WHERE dc.status = 'pending'
    ) * 0.50
    + GREATEST(2 - p.seeded_frontier_count, 0)
    + CASE
      WHEN p.last_seeded_at IS NULL OR p.last_seeded_at < now() - interval '14 days' THEN 1.50
      ELSE 0
    END
  )::numeric, 2) AS priority_score
FROM discovery_entity_pivots p
LEFT JOIN discovery_entity_pivot_sources ps
  ON ps.pivot_id = p.id
LEFT JOIN discovered_contacts dc
  ON dc.id = ps.discovered_contact_id
GROUP BY
  p.entity_key,
  p.entity_name,
  p.entity_type,
  p.normalized_domain,
  p.coverage_target_keys,
  p.seed_queries,
  p.source_urls,
  p.last_recommended_at,
  p.recommended_count,
  p.seeded_frontier_count,
  p.last_seeded_at,
  p.last_seen_at
ORDER BY priority_score DESC, source_count DESC, p.entity_name;

-- ── 4. Rebuild coverage_gaps to expose cooldown columns ──────────────────────
-- ops_phase_success_metrics depends on coverage_gaps, so we cascade the drop
-- and recreate both views in order.

DROP VIEW IF EXISTS coverage_gaps CASCADE;

CREATE VIEW coverage_gaps AS
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
  ct.last_recommended_at,
  ct.recommended_count,
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

REVOKE ALL ON TABLE ops_discovery_entity_pivots FROM anon, authenticated;
REVOKE ALL ON TABLE coverage_gaps FROM anon, authenticated;

-- ── 5. Recreate ops_phase_success_metrics (cascaded away with coverage_gaps) ──

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

REVOKE ALL ON TABLE ops_phase_success_metrics FROM anon, authenticated;
