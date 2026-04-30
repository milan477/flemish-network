-- Phase 6.4 System Health panel read access.
-- embedding_jobs remains backend-owned; editors only need read access for
-- queue depth and oldest pending job age in the operator dashboard.

GRANT SELECT ON public.embedding_jobs TO authenticated;

DROP POLICY IF EXISTS "Editors can read embedding_jobs" ON public.embedding_jobs;
CREATE POLICY "Editors can read embedding_jobs"
  ON public.embedding_jobs FOR SELECT
  TO authenticated
  USING (public.has_staff_role('editor'));
