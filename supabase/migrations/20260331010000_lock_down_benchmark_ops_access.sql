-- Lock down benchmark contracts and ops views from anon/authenticated clients.

DROP POLICY IF EXISTS "Public read benchmark_search_queries" ON benchmark_search_queries;
DROP POLICY IF EXISTS "Public read benchmark_discovery_sources" ON benchmark_discovery_sources;

REVOKE ALL ON TABLE benchmark_search_queries FROM anon, authenticated;
REVOKE ALL ON TABLE benchmark_discovery_sources FROM anon, authenticated;

REVOKE ALL ON TABLE benchmark_search_queries_active FROM anon, authenticated;
REVOKE ALL ON TABLE benchmark_discovery_sources_active FROM anon, authenticated;
REVOKE ALL ON TABLE ops_search_benchmark_clicks FROM anon, authenticated;
REVOKE ALL ON TABLE ops_discovery_review_metrics FROM anon, authenticated;
REVOKE ALL ON TABLE ops_benchmark_discovery_source_coverage FROM anon, authenticated;
REVOKE ALL ON TABLE ops_phase_success_metrics FROM anon, authenticated;
