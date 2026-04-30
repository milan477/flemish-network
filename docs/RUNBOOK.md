# Operator Runbook

Use Admin -> System for the first check. Failed agent runs show an error code that maps to the entries below.

## [quota_exhausted]

Root cause: Gemini, Tavily, Brave, or Apify rejected work because the configured quota or account limit was reached.

Fix steps:
- In Admin -> System, check today's API usage and the failed run details.
- Check the provider dashboard for the same date: Google AI Studio for Gemini, Tavily dashboard for Tavily, Brave Search API dashboard for Brave, Apify console for Apify.
- If the quota is expected, wait for the provider period to reset.
- If the limit is too low for operations, raise the provider quota or update the relevant edge-function secret/account plan.
- Re-run the agent from Admin -> System after quota is available.

## [auth_failed]

Root cause: the user session, Supabase anon key, service role key, or provider API secret is missing, expired, or invalid.

Fix steps:
- Confirm the operator is signed in as an active staff user with editor or admin role.
- Confirm frontend `.env` has the correct `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
- In Supabase, rotate or verify `SUPABASE_SERVICE_ROLE_KEY`, then run `supabase secrets set SUPABASE_SERVICE_ROLE_KEY=... --project-ref <ref>`.
- Verify provider secrets with `supabase secrets list --project-ref <ref>` and reset any stale key.
- Deploy the affected edge function if secrets or code changed.

## [network]

Root cause: Supabase could not reach an edge function or an upstream provider such as Tavily, Brave, Gemini, or Apify.

Fix steps:
- Click Test Supabase in Admin -> System. If it fails, check Supabase project status and frontend environment values.
- Check Supabase Edge Function logs for the failed run id.
- Check upstream provider status pages and account dashboards.
- Tavily search falls back to Brave when configured. If both fail, verify both `TAVILY_API_KEY` and `BRAVE_API_KEY`.
- Re-run housekeeping, then retry the agent once the provider is reachable.

## [db_timeout]

Root cause: a database operation exceeded the expected run heartbeat window or a long query held the agent past timeout.

Fix steps:
- Run housekeeping in Admin -> System to mark stale runs failed.
- In Supabase SQL editor, inspect `pg_stat_activity` for long-running queries.
- Common offender: first-run `agent-connections` backfills. Run one connection type at a time if needed.
- Retry the run after the database is clear.
- If timeouts repeat, capture the run id and inspect the function logs for the slow step.

## Discovery Has Not Found Anyone In N Days

Root cause: source packs are exhausted, coverage gaps are stale, provider quota is exhausted, or discovered contacts are pending review and not yet promoted.

Fix steps:
- Open Admin -> Agents and review Discovery Planning for undercovered metros, proven domains, and recommended actions.
- Open Admin -> Discovered and clear the pending review queue.
- In Admin -> System, confirm discovery has recent successful runs and Tavily/Brave usage is not exhausted.
- Trigger a focused Discovery run from Admin -> Agents or System using a recommended planning query.
- If no candidates appear, check source pack health and provider search logs.

## Embedding Queue Keeps Growing

Root cause: Gemini embedding quota is exhausted, the worker is not being kicked, or jobs are failing and returning to pending.

Fix steps:
- In Admin -> System, check pending count, running count, and oldest pending age.
- Click Run Now on Embeddings to process a small batch.
- If the run fails, check the visible error and Supabase logs for `generate-embeddings`.
- Verify `GEMINI_API_KEY` and Gemini quota.
- If async batches are running, use the embedding batch controls in Admin -> Overview to poll or cancel stuck batches.
