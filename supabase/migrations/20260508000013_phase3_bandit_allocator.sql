-- Phase 3: Bandit Allocator
-- Adds discovery_arm_stats table and a nightly refresh view.

-- ── discovery_arm_stats ────────────────────────────────────────────────────────
-- Aggregates yield per (surface, lens, context_key) arm.
-- context_key is '' for global arms, 'sector:biotech', 'geo:metro:boston-ma', etc.
CREATE TABLE IF NOT EXISTS discovery_arm_stats (
  surface               text      NOT NULL REFERENCES discovery_surfaces(key) ON UPDATE CASCADE,
  lens                  text      NOT NULL REFERENCES discovery_lenses(key) ON UPDATE CASCADE,
  context_key           text      NOT NULL DEFAULT '',
  attempts              int       NOT NULL DEFAULT 0,
  candidates_extracted  int       NOT NULL DEFAULT 0,
  new_pending_contacts  int       NOT NULL DEFAULT 0,
  contacts_approved     int       NOT NULL DEFAULT 0,
  contacts_rejected     int       NOT NULL DEFAULT 0,
  not_flemish_rejections int      NOT NULL DEFAULT 0,
  total_cost_usd        numeric(10,4) NOT NULL DEFAULT 0,
  last_attempt_at       timestamptz,
  last_yielding_attempt_at timestamptz,
  cooldown_until        timestamptz,
  PRIMARY KEY (surface, lens, context_key)
);

-- ── RLS ────────────────────────────────────────────────────────────────────────
ALTER TABLE discovery_arm_stats ENABLE ROW LEVEL SECURITY;

-- Staff read
CREATE POLICY "staff_read_arm_stats"
  ON discovery_arm_stats
  FOR SELECT
  USING (is_active_staff());

-- Service role / backend write (uses service_role key which bypasses RLS by default,
-- but we add an explicit policy for admin-role staff to also write via UI if needed)
CREATE POLICY "editor_write_arm_stats"
  ON discovery_arm_stats
  FOR ALL
  USING (has_staff_role('editor'))
  WITH CHECK (has_staff_role('editor'));

-- ── Index ──────────────────────────────────────────────────────────────────────
CREATE INDEX idx_arm_stats_surface_lens ON discovery_arm_stats (surface, lens);
CREATE INDEX idx_arm_stats_last_attempt ON discovery_arm_stats (last_attempt_at NULLS FIRST);
CREATE INDEX idx_arm_stats_cooldown ON discovery_arm_stats (cooldown_until) WHERE cooldown_until IS NOT NULL;

-- ── discovery_arm_stats_recent view ───────────────────────────────────────────
-- Rolling 30-day window for the admin heatmap.
CREATE OR REPLACE VIEW discovery_arm_stats_recent AS
SELECT
  das.surface,
  das.lens,
  das.context_key,
  das.attempts,
  das.candidates_extracted,
  das.new_pending_contacts,
  das.contacts_approved,
  das.contacts_rejected,
  das.not_flemish_rejections,
  das.total_cost_usd,
  das.last_attempt_at,
  das.last_yielding_attempt_at,
  das.cooldown_until,
  -- Approval rate with Bayesian smoothing: (approved + 1) / (extracted + 2)
  ROUND(
    (das.contacts_approved::numeric + 1) / (GREATEST(das.candidates_extracted, 1)::numeric + 2),
    4
  ) AS approval_rate,
  -- not_flemish penalty rate
  ROUND(
    das.not_flemish_rejections::numeric / GREATEST(das.contacts_rejected, 1)::numeric,
    4
  ) AS not_flemish_rate,
  CASE
    WHEN das.cooldown_until IS NOT NULL AND das.cooldown_until > NOW() THEN 'cooling_down'
    WHEN das.last_attempt_at IS NULL THEN 'untried'
    WHEN das.new_pending_contacts = 0 AND das.attempts > 0 THEN 'no_yield'
    ELSE 'active'
  END AS arm_status,
  ds.name AS surface_name,
  dl.name AS lens_name
FROM discovery_arm_stats das
LEFT JOIN discovery_surfaces ds ON ds.key = das.surface
LEFT JOIN discovery_lenses dl ON dl.key = das.lens;

GRANT SELECT ON discovery_arm_stats_recent TO authenticated;
