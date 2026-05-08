-- Phase 0 (Discovery Redesign): RPC to resolve downstream yield counters on
-- discovery_query_attempts after a discovery run completes. Joins frontier →
-- pages → evidence → contacts to attribute candidate yield to each query.

CREATE OR REPLACE FUNCTION public.resolve_discovery_query_attempts(p_run_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_updated integer := 0;
BEGIN
  WITH attempts AS (
    SELECT id, query_text
    FROM public.discovery_query_attempts
    WHERE run_id = p_run_id
  ),
  pages_per_query AS (
    SELECT df.search_query AS query_text,
           COUNT(DISTINCT dp.id) AS pages_fetched
    FROM public.discovery_pages dp
    JOIN public.discovery_frontier df ON df.id = dp.frontier_id
    WHERE df.search_query IS NOT NULL
    GROUP BY df.search_query
  ),
  contacts_per_query AS (
    SELECT df.search_query AS query_text,
           dc.id AS contact_id,
           dc.status,
           dc.review_outcome,
           dc.reject_reason
    FROM public.discovered_contacts dc
    JOIN public.discovery_evidence de ON de.discovered_contact_id = dc.id
    JOIN public.discovery_pages dp ON dp.id = de.discovery_page_id
    JOIN public.discovery_frontier df ON df.id = dp.frontier_id
    WHERE dc.agent_run_id = p_run_id
      AND df.search_query IS NOT NULL
    GROUP BY df.search_query, dc.id, dc.status, dc.review_outcome, dc.reject_reason
  ),
  contact_aggs AS (
    SELECT query_text,
           COUNT(DISTINCT contact_id) AS candidates_extracted,
           COUNT(DISTINCT contact_id) FILTER (
             WHERE status = 'pending' OR review_outcome IS NULL
           ) AS new_pending_contacts,
           COUNT(DISTINCT contact_id) FILTER (
             WHERE review_outcome IN ('approved_new', 'approved_merge')
           ) AS contacts_later_approved,
           COUNT(DISTINCT contact_id) FILTER (
             WHERE review_outcome = 'rejected'
           ) AS contacts_later_rejected
    FROM contacts_per_query
    GROUP BY query_text
  ),
  reject_breakdown AS (
    SELECT query_text,
           jsonb_object_agg(reason, n) AS rejected_reason_breakdown
    FROM (
      SELECT query_text,
             COALESCE(reject_reason, 'unspecified') AS reason,
             COUNT(DISTINCT contact_id) AS n
      FROM contacts_per_query
      WHERE review_outcome = 'rejected'
      GROUP BY query_text, reject_reason
    ) r
    GROUP BY query_text
  )
  UPDATE public.discovery_query_attempts qa
  SET pages_fetched = COALESCE(p.pages_fetched, 0),
      candidates_extracted = COALESCE(ca.candidates_extracted, 0),
      new_pending_contacts = COALESCE(ca.new_pending_contacts, 0),
      contacts_later_approved = COALESCE(ca.contacts_later_approved, 0),
      contacts_later_rejected = COALESCE(ca.contacts_later_rejected, 0),
      rejected_reason_breakdown = COALESCE(rb.rejected_reason_breakdown, '{}'::jsonb),
      resolved_at = now()
  FROM attempts a
  LEFT JOIN pages_per_query p ON p.query_text = a.query_text
  LEFT JOIN contact_aggs ca ON ca.query_text = a.query_text
  LEFT JOIN reject_breakdown rb ON rb.query_text = a.query_text
  WHERE qa.id = a.id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_discovery_query_attempts(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_discovery_query_attempts(uuid) TO service_role;
