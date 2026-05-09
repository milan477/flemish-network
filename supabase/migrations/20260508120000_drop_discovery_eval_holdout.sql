-- Remove the held-out evaluation set. The DiscoveryEvalPanel UI and
-- eval-holdout-check edge function have been deleted; recall is no longer
-- tracked through this table.

DROP POLICY IF EXISTS "Editors can read discovery_eval_holdout" ON public.discovery_eval_holdout;
DROP POLICY IF EXISTS "Editors can insert discovery_eval_holdout" ON public.discovery_eval_holdout;
DROP POLICY IF EXISTS "Editors can update discovery_eval_holdout" ON public.discovery_eval_holdout;
DROP POLICY IF EXISTS "Editors can delete discovery_eval_holdout" ON public.discovery_eval_holdout;

DROP INDEX IF EXISTS public.idx_eval_holdout_full_name;

DROP TABLE IF EXISTS public.discovery_eval_holdout;
