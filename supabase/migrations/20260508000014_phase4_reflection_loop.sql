-- Phase 4: Reflection Loop
-- Creates the discovery_reflection_suggestions table for storing AI-generated
-- exploration suggestions based on network population analysis.

CREATE TABLE IF NOT EXISTS discovery_reflection_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  surface text REFERENCES discovery_surfaces(key) ON UPDATE CASCADE,
  lens text REFERENCES discovery_lenses(key) ON UPDATE CASCADE,
  context_key text NOT NULL DEFAULT '',
  rationale text NOT NULL,
  population_summary jsonb NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  consumed_attempt_count int NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '14 days')
);

-- Index on expires_at to efficiently filter active (non-expired) suggestions.
-- Note: partial index on now() is not allowed in PostgreSQL (non-immutable);
-- a plain index on expires_at is equivalent for the query pattern used.
CREATE INDEX idx_reflection_active
  ON discovery_reflection_suggestions (expires_at);

-- RLS: staff-only read/write (same pattern as other discovery tables)
ALTER TABLE discovery_reflection_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can read reflection suggestions"
  ON discovery_reflection_suggestions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM staff_users
      WHERE staff_users.user_id = auth.uid()
        AND staff_users.status = 'active'
    )
  );

CREATE POLICY "Staff can insert reflection suggestions"
  ON discovery_reflection_suggestions
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM staff_users
      WHERE staff_users.user_id = auth.uid()
        AND staff_users.status = 'active'
    )
  );

CREATE POLICY "Staff can update reflection suggestions"
  ON discovery_reflection_suggestions
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM staff_users
      WHERE staff_users.user_id = auth.uid()
        AND staff_users.status = 'active'
    )
  );
