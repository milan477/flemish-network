-- Re-schedule the agent-scheduler tick with a 30 s pg_net timeout.
--
-- The default net.http_post timeout is 5 s. agent-scheduler's tick now runs
-- zombie cleanup and hourly housekeeping before dispatching, which regularly
-- takes longer than 5 s, and every timed-out call was logged in
-- net._http_response as an error even though the function kept running.
--
-- The vault secret `service_role_key` must hold the same secret key that edge
-- functions receive as SUPABASE_SERVICE_ROLE_KEY (the project's secret API
-- key). agent-scheduler compares the bearer against that key with constant-time
-- equality; a JWT that merely claims role=service_role is rejected.

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
    body := jsonb_build_object('action', 'tick', 'source', 'pg_cron'),
    timeout_milliseconds := 30000
  );
  $cron$
);
