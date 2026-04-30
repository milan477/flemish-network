-- Phase 6.4 System Health panel read access for offline embedding batch status.
-- Batch rows are still backend-written by generate-embeddings; editor staff only
-- need SELECT so Admin -> System can show last success/failure/running batch.

GRANT SELECT ON public.embedding_batch_runs TO authenticated;

DROP POLICY IF EXISTS "Editors can read embedding_batch_runs" ON public.embedding_batch_runs;
CREATE POLICY "Editors can read embedding_batch_runs"
  ON public.embedding_batch_runs FOR SELECT
  TO authenticated
  USING (public.has_staff_role('editor'));
