-- Track which search results users click for relevance feedback
CREATE TABLE search_clicks (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  query text NOT NULL,
  person_id uuid REFERENCES people(id) ON DELETE CASCADE,
  clicked_at timestamptz DEFAULT now()
);

CREATE INDEX idx_search_clicks_query ON search_clicks(query);
CREATE INDEX idx_search_clicks_person ON search_clicks(person_id);

ALTER TABLE search_clicks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read search_clicks" ON search_clicks
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "Public insert search_clicks" ON search_clicks
  FOR INSERT TO anon, authenticated WITH CHECK (true);
