-- Agent Infrastructure: agent_runs, api_quotas, web_search_cache tables

CREATE TABLE agent_runs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_type text NOT NULL,            -- 'discovery', 'verification', 'connection'
  status text NOT NULL DEFAULT 'pending', -- 'pending', 'running', 'completed', 'failed'
  params jsonb,                        -- input parameters for this run
  started_at timestamptz,
  completed_at timestamptz,
  heartbeat_at timestamptz,            -- last heartbeat for zombie detection
  results jsonb,                       -- { profiles_found, suggestions_created, errors, ... }
  error_message text,
  llm_calls_made integer DEFAULT 0,
  llm_model_used text,
  web_searches_made integer DEFAULT 0,
  web_search_provider text,            -- 'tavily', 'brave', 'mixed'
  cost_estimate_usd numeric(10,4) DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE api_quotas (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  provider text NOT NULL,              -- 'tavily', 'brave', 'apify'
  month text NOT NULL,                 -- 'YYYY-MM' format
  calls_used integer DEFAULT 0,
  calls_limit integer NOT NULL,        -- 1000 for tavily, 2000 for brave
  created_at timestamptz DEFAULT now(),
  UNIQUE(provider, month)
);

CREATE TABLE web_search_cache (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  query_hash text NOT NULL,            -- SHA-256 of normalized query
  query_text text NOT NULL,
  provider text NOT NULL,              -- 'tavily' or 'brave'
  results jsonb NOT NULL,              -- cached search results
  searched_at timestamptz DEFAULT now(),
  UNIQUE(query_hash, provider)
);

CREATE INDEX idx_agent_runs_status ON agent_runs(status);
CREATE INDEX idx_agent_runs_type ON agent_runs(agent_type);
CREATE INDEX idx_web_search_cache_hash ON web_search_cache(query_hash);
CREATE INDEX idx_web_search_cache_searched ON web_search_cache(searched_at);

-- RLS: read for all, write for service_role only
ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_quotas ENABLE ROW LEVEL SECURITY;
ALTER TABLE web_search_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read agent_runs" ON agent_runs FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Public read api_quotas" ON api_quotas FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Public read web_search_cache" ON web_search_cache FOR SELECT TO anon, authenticated USING (true);

-- RPC function for atomic quota increment (prevents double-counting under concurrent access)
CREATE OR REPLACE FUNCTION increment_api_quota(p_provider text, p_month text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE api_quotas
  SET calls_used = calls_used + 1
  WHERE provider = p_provider AND month = p_month;
END;
$$;
