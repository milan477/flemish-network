ALTER TABLE profile_suggestions
  ADD COLUMN IF NOT EXISTS evidence_url text,
  ADD COLUMN IF NOT EXISTS evidence_excerpt text,
  ADD COLUMN IF NOT EXISTS confidence numeric(5,2),
  ADD COLUMN IF NOT EXISTS method text,
  ADD COLUMN IF NOT EXISTS agent_run_id uuid REFERENCES agent_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS dedupe_key text;

UPDATE profile_suggestions
SET
  method = COALESCE(
    method,
    CASE
      WHEN lower(COALESCE(source, '')) LIKE '%linkedin%' THEN 'linkedin_scrape'
      ELSE 'web_search_llm'
    END
  ),
  confidence = COALESCE(confidence, 0.70),
  dedupe_key = COALESCE(
    dedupe_key,
    field_name || '::' || regexp_replace(lower(COALESCE(suggested_value, '')), '[^a-z0-9]+', ' ', 'g')
  )
WHERE method IS NULL
   OR confidence IS NULL
   OR dedupe_key IS NULL;

CREATE INDEX IF NOT EXISTS idx_profile_suggestions_pending_dedupe
  ON profile_suggestions(person_id, dedupe_key)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_profile_suggestions_agent_run
  ON profile_suggestions(agent_run_id);

CREATE INDEX IF NOT EXISTS idx_search_clicks_person_clicked_at
  ON search_clicks(person_id, clicked_at DESC);

CREATE INDEX IF NOT EXISTS idx_discovered_contacts_approved_person_recent
  ON discovered_contacts(approved_person_id, created_at DESC)
  WHERE approved_person_id IS NOT NULL;
