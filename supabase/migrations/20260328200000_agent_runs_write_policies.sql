-- Allow anon/authenticated to create and update agent runs (frontend triggers agents directly)
CREATE POLICY "Public insert agent_runs" ON agent_runs FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Public update agent_runs" ON agent_runs FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
