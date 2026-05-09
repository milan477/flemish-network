-- Agent schedules: cadence presets per scheduled job, driven by a 5-min pg_cron tick
-- that calls the agent-scheduler edge function with action='tick'.
--
-- Three jobs:
--   discovery         -- 'off' | 'low' | 'normal' (2x/day) | 'high'
--   verify_stale      -- 'off' | 'low' (5/day) | 'normal' (15/day) | 'high' (40/day)
--   embeddings_drain  -- always 'normal' in UI; drains pending embedding_jobs

CREATE TABLE IF NOT EXISTS public.agent_schedules (
  job_kind        text PRIMARY KEY
                    CHECK (job_kind IN ('discovery','verify_stale','embeddings_drain')),
  cadence_preset  text NOT NULL DEFAULT 'normal'
                    CHECK (cadence_preset IN ('off','low','normal','high')),
  last_run_at     timestamptz,
  last_run_id     uuid,
  next_run_at     timestamptz NOT NULL DEFAULT now(),
  last_status     text CHECK (last_status IS NULL OR last_status IN ('ok','failed','skipped')),
  last_error      text,
  last_manual_at  timestamptz,
  last_manual_by  uuid,
  updated_by      uuid,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.set_agent_schedules_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_agent_schedules_updated_at ON public.agent_schedules;
CREATE TRIGGER tr_agent_schedules_updated_at
  BEFORE UPDATE ON public.agent_schedules
  FOR EACH ROW EXECUTE FUNCTION public.set_agent_schedules_updated_at();

ALTER TABLE public.agent_schedules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Editors can read agent_schedules" ON public.agent_schedules;
CREATE POLICY "Editors can read agent_schedules"
  ON public.agent_schedules
  FOR SELECT
  TO authenticated
  USING (public.has_staff_role('editor'));

-- Writes go through the edge function (service role); no UPDATE policy for end users.

-- Seed default schedule rows (idempotent).
INSERT INTO public.agent_schedules (job_kind, cadence_preset, next_run_at)
VALUES
  ('discovery', 'normal', now()),
  ('verify_stale', 'normal', now()),
  ('embeddings_drain', 'normal', now())
ON CONFLICT (job_kind) DO NOTHING;

-- pg_cron + pg_net: 5-minute tick that POSTs to agent-scheduler with action='tick'.
-- The edge function handles all routing, idempotency, and budget logic.
--
-- Secrets live in vault.secrets (created out-of-band). Required keys:
--   'project_url'        -> https://<ref>.supabase.co
--   'service_role_key'   -> service role key
--
-- If the vault entries are absent, the cron job will be created but its
-- inner SELECT will raise; the migration itself does not fail.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove any prior schedule with this name so the body stays in sync.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'agent-scheduler-tick') THEN
    PERFORM cron.unschedule('agent-scheduler-tick');
  END IF;
END $$;

SELECT cron.schedule(
  'agent-scheduler-tick',
  '*/5 * * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/agent-scheduler',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := jsonb_build_object('action', 'tick', 'source', 'pg_cron')
  );
  $cron$
);

COMMENT ON TABLE public.agent_schedules IS
  'Cadence presets per scheduled agent job. Driven by pg_cron job agent-scheduler-tick (every 5 min). See docs/plans/AGENT-SCHEDULES.md.';
