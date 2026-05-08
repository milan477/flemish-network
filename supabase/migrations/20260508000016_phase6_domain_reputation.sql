-- Phase 6: Domain Reputation Feedback
-- Add reputation columns to discovery_seed_domains so the agent can
-- promote high-yield domains as site: operators and soft-block noise domains.

ALTER TABLE discovery_seed_domains
  ADD COLUMN IF NOT EXISTS reputation_score numeric(4,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reputation_window_started_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS reputation_recompute_at timestamptz,
  ADD COLUMN IF NOT EXISTS manually_blocked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS total_candidates_extracted int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_approved_contacts int NOT NULL DEFAULT 0;

-- Index to efficiently query top/bottom domains by reputation.
CREATE INDEX IF NOT EXISTS idx_seed_domains_reputation
  ON discovery_seed_domains (reputation_score DESC)
  WHERE active = true;

-- RLS: discovery_seed_domains already has staff-read / admin-write policy
-- inherited from Phase 2. No change needed.

COMMENT ON COLUMN discovery_seed_domains.reputation_score IS
  'Bayesian-smoothed approval rate: (approved_count + 1) / (extracted_count + 5). Recomputed nightly.';
COMMENT ON COLUMN discovery_seed_domains.manually_blocked IS
  'When true, this domain is excluded from site: operators and suppressed in query generation regardless of reputation_score.';
