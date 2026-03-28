-- Staging table for Discovery Agent results.
-- Contacts land here for admin review before being promoted to `people`.
CREATE TABLE discovered_contacts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  email text,
  linkedin_url text,
  current_position text,
  occupation text,
  location_city text,
  location_state text,
  bio text,
  flemish_connection text,
  website_url text,
  sectors text[],
  source text NOT NULL DEFAULT 'discovery_agent',
  source_urls text[],
  status text NOT NULL DEFAULT 'pending',  -- pending, approved, rejected
  agent_run_id uuid REFERENCES agent_runs(id),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_discovered_contacts_status ON discovered_contacts(status);

ALTER TABLE discovered_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read discovered_contacts"
  ON discovered_contacts FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "Public update discovered_contacts"
  ON discovered_contacts FOR UPDATE TO anon, authenticated USING (true);

CREATE POLICY "Public delete discovered_contacts"
  ON discovered_contacts FOR DELETE TO anon, authenticated USING (true);

CREATE POLICY "Public insert discovered_contacts"
  ON discovered_contacts FOR INSERT TO anon, authenticated WITH CHECK (true);
