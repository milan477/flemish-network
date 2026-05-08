-- Phase 1 (Discovery Redesign): drop legacy query-template storage.
--
-- Every search query is now generated per-run by the universal Gemini-Flash
-- query generator (`supabase/functions/_shared/queryGeneration.ts`). The agent
-- no longer reads pre-baked query strings from these columns, so they are
-- removed to avoid drift between the schema and the runtime.

ALTER TABLE public.discovery_source_packs
  DROP COLUMN IF EXISTS query_templates;

-- ops_discovery_entity_pivots references seed_queries; rebuild it without
-- that column before dropping the underlying column.

DROP VIEW IF EXISTS public.ops_discovery_entity_pivots;

ALTER TABLE public.discovery_entity_pivots
  DROP COLUMN IF EXISTS seed_queries;

CREATE VIEW public.ops_discovery_entity_pivots AS
SELECT
  p.entity_key,
  p.entity_name,
  p.entity_type,
  p.normalized_domain,
  p.coverage_target_keys,
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
FROM public.discovery_entity_pivots p
LEFT JOIN public.discovery_entity_pivot_sources ps
  ON ps.pivot_id = p.id
LEFT JOIN public.discovered_contacts dc
  ON dc.id = ps.discovered_contact_id
GROUP BY
  p.entity_key,
  p.entity_name,
  p.entity_type,
  p.normalized_domain,
  p.coverage_target_keys,
  p.source_urls,
  p.last_recommended_at,
  p.recommended_count,
  p.seeded_frontier_count,
  p.last_seeded_at,
  p.last_seen_at
ORDER BY priority_score DESC, source_count DESC, p.entity_name;

REVOKE ALL ON TABLE public.ops_discovery_entity_pivots FROM anon, authenticated;
