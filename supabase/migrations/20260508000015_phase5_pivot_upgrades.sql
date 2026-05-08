-- Phase 5 (Discovery Redesign): Pivot upgrades — validation, saturation, multi-hop, composition.
--
-- Adds validation and saturation tracking to entity pivots, and creates
-- discovery_composition_pivots for sector/geo cluster pivots.

-- ── 1. Add validation and saturation columns to discovery_entity_pivots ────────

ALTER TABLE public.discovery_entity_pivots
  ADD COLUMN IF NOT EXISTS validation_score numeric(3,2),
  ADD COLUMN IF NOT EXISTS validation_rationale text,
  ADD COLUMN IF NOT EXISTS validation_at timestamptz,
  ADD COLUMN IF NOT EXISTS saturation_cooldown_until timestamptz,
  ADD COLUMN IF NOT EXISTS rolling_new_approved int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rolling_window_started_at timestamptz NOT NULL DEFAULT now();

-- ── 2. Rebuild ops_discovery_entity_pivots to expose new columns ───────────────

DROP VIEW IF EXISTS public.ops_discovery_entity_pivots;

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
  p.validation_score,
  p.validation_rationale,
  p.validation_at,
  p.saturation_cooldown_until,
  p.rolling_new_approved,
  p.rolling_window_started_at,
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
  p.validation_score,
  p.validation_rationale,
  p.validation_at,
  p.saturation_cooldown_until,
  p.rolling_new_approved,
  p.rolling_window_started_at,
  p.seeded_frontier_count,
  p.last_seeded_at,
  p.last_seen_at
ORDER BY priority_score DESC, source_count DESC, p.entity_name;

REVOKE ALL ON TABLE public.ops_discovery_entity_pivots FROM anon, authenticated;

-- ── 3. Create discovery_composition_pivots ────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.discovery_composition_pivots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pivot_type text NOT NULL CHECK (pivot_type IN ('sector_cluster', 'geo_cluster', 'sector_geo_cluster')),
  context jsonb NOT NULL,
  approved_people_count int NOT NULL,
  last_approved_match_at timestamptz NOT NULL,
  saturation_cooldown_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pivot_type, context)
);

-- RLS: staff-only read/write
ALTER TABLE public.discovery_composition_pivots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff_read_composition_pivots"
  ON public.discovery_composition_pivots
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.staff_users su
      WHERE su.user_id = auth.uid()
        AND su.status = 'active'
    )
  );

CREATE POLICY "staff_write_composition_pivots"
  ON public.discovery_composition_pivots
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.staff_users su
      WHERE su.user_id = auth.uid()
        AND su.status = 'active'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.staff_users su
      WHERE su.user_id = auth.uid()
        AND su.status = 'active'
    )
  );
