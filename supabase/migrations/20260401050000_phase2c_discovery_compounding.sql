-- Phase 2C discovery compounding:
-- stronger multi-page candidate merging, durable entity pivots, and internal planner analytics.

ALTER TABLE discovered_contacts
  ADD COLUMN IF NOT EXISTS candidate_key text;

CREATE INDEX IF NOT EXISTS idx_discovered_contacts_candidate_key
  ON discovered_contacts(candidate_key)
  WHERE candidate_key IS NOT NULL;

UPDATE discovered_contacts
SET candidate_key = CASE
  WHEN COALESCE(linkedin_url, '') <> '' THEN
    'linkedin:' || lower(regexp_replace(linkedin_url, '/+$', ''))
  WHEN COALESCE(email, '') <> '' THEN
    'email:' || lower(trim(email))
  WHEN COALESCE(website_url, '') <> '' THEN
    'site:' || lower(regexp_replace(regexp_replace(website_url, '/+$', ''), '^https?://(www\.)?', ''))
  WHEN COALESCE(name, '') <> ''
    AND (COALESCE(location_state, '') <> '' OR COALESCE(current_position, '') <> '') THEN
    lower(
      trim(
        regexp_replace(
          COALESCE(name, '') || '|' || COALESCE(location_state, '') || '|' || COALESCE(current_position, ''),
          '[^a-zA-Z0-9]+',
          ' ',
          'g'
        )
      )
    )
  ELSE candidate_key
END
WHERE candidate_key IS NULL;

ALTER TABLE discovery_frontier
  ADD COLUMN IF NOT EXISTS pivot_entity_key text,
  ADD COLUMN IF NOT EXISTS pivot_entity_name text,
  ADD COLUMN IF NOT EXISTS pivot_entity_type text;

CREATE INDEX IF NOT EXISTS idx_discovery_frontier_pivot_entity_key
  ON discovery_frontier(pivot_entity_key)
  WHERE pivot_entity_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS discovery_entity_pivots (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  entity_key text NOT NULL UNIQUE,
  entity_name text NOT NULL,
  entity_type text NOT NULL DEFAULT 'organization'
    CHECK (
      entity_type IN (
        'organization',
        'lab',
        'fellowship',
        'advisory_board',
        'event',
        'association',
        'institution'
      )
    ),
  normalized_domain text,
  coverage_target_keys text[] NOT NULL DEFAULT '{}'::text[],
  seed_queries text[] NOT NULL DEFAULT '{}'::text[],
  source_urls text[] NOT NULL DEFAULT '{}'::text[],
  seeded_frontier_count integer NOT NULL DEFAULT 0,
  last_seeded_at timestamptz,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_discovery_entity_pivots_last_seen_at
  ON discovery_entity_pivots(last_seen_at DESC);

DROP TRIGGER IF EXISTS tr_set_discovery_entity_pivots_updated_at ON discovery_entity_pivots;
CREATE TRIGGER tr_set_discovery_entity_pivots_updated_at
  BEFORE UPDATE ON discovery_entity_pivots
  FOR EACH ROW
  EXECUTE FUNCTION set_discovery_updated_at();

ALTER TABLE discovery_entity_pivots ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS discovery_entity_pivot_sources (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  pivot_id uuid NOT NULL REFERENCES discovery_entity_pivots(id) ON DELETE CASCADE,
  discovered_contact_id uuid NOT NULL REFERENCES discovered_contacts(id) ON DELETE CASCADE,
  discovery_evidence_id uuid REFERENCES discovery_evidence(id) ON DELETE SET NULL,
  source_page_url text NOT NULL,
  source_page_title text,
  source_page_type text,
  source_domain text,
  source_excerpt text,
  confidence numeric(5,2),
  source_strength numeric(6,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pivot_id, discovered_contact_id, source_page_url)
);

CREATE INDEX IF NOT EXISTS idx_discovery_entity_pivot_sources_pivot
  ON discovery_entity_pivot_sources(pivot_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_discovery_entity_pivot_sources_contact
  ON discovery_entity_pivot_sources(discovered_contact_id, created_at DESC);

ALTER TABLE discovery_entity_pivot_sources ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE VIEW ops_discovery_entity_pivots AS
SELECT
  p.entity_key,
  p.entity_name,
  p.entity_type,
  p.normalized_domain,
  p.coverage_target_keys,
  p.seed_queries,
  p.source_urls,
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
  p.seeded_frontier_count,
  p.last_seeded_at,
  p.last_seen_at
ORDER BY priority_score DESC, source_count DESC, p.entity_name;

REVOKE ALL ON TABLE discovery_entity_pivots FROM anon, authenticated;
REVOKE ALL ON TABLE discovery_entity_pivot_sources FROM anon, authenticated;
REVOKE ALL ON TABLE ops_discovery_entity_pivots FROM anon, authenticated;
