# Agent Schedules — Phased Plan

Goal: give non-technical admins visible, controllable cron-driven runs of Discovery, stale-record Verification, and Search Index drain — directly on `Admin → System`. Replace today's "Run now" cards with cards that also expose a cadence preset + next-run time.

## Decisions (locked)

- **Three scheduled jobs** (not four): `discovery`, `verify_stale`, `embeddings_drain`.
  - `verify_new` is **not** a separate job: discovery completion already auto-enqueues verification of newly-discovered profiles inside `agent-scheduler.runHousekeeping` → `autoEnqueueDiscoveredVerification`. Keep that piggyback.
- **Presets, not cron strings.** Each job has `off | low | normal | high`. UI never exposes raw cron syntax.
- **One pg_cron tick** every 5 minutes calls `agent-scheduler` with `action: tick`. Scheduler reads `agent_schedules`, runs whatever is due, advances `next_run_at`. All scheduling logic lives in TypeScript, not in cron entries.
- **Manual "Run now" stays.** Goes through the same `triggerAgentRun` path as cron, with a min-interval guard (default 10 min) to prevent double-runs / budget burn.
- **Embeddings drain is plumbing.** Hidden from preset UI (Normal-only behavior: drain every 5 min if pending > 0). Surfaced as a one-line footer on the System page.
- **Stale-cycle visibility.** The `verify_stale` card shows "X contacts need refresh · at N/day, full cycle in ~D days" so admins can feel the cadence consequence before bumping.

## Cadence presets

| Job | Off | Light | Normal (default) | High |
|---|---|---|---|---|
| `discovery` | – | 1×/day at 09:00 | 2×/day at 09:00 + 21:00 | 4×/day (00, 06, 12, 18) |
| `verify_stale` | – | 5/day | 15/day | 40/day |
| `embeddings_drain` | – (hidden) | – | every 5 min when pending > 0 | – |

Times resolved in scheduler code in UTC; admin user is single-timezone for now (US/EU mix is fine — these are batch jobs, exact wall-clock isn't critical).

## Schema

New table `public.agent_schedules`:

```sql
job_kind       text PRIMARY KEY,              -- 'discovery' | 'verify_stale' | 'embeddings_drain'
cadence_preset text NOT NULL DEFAULT 'normal',-- 'off' | 'low' | 'normal' | 'high'
last_run_at    timestamptz,
last_run_id    uuid,
next_run_at    timestamptz,
last_status    text,                          -- 'ok' | 'failed' | 'skipped'
last_error     text,
last_manual_at timestamptz,                   -- gate min-interval
last_manual_by uuid,
updated_by     uuid,
updated_at     timestamptz NOT NULL DEFAULT now()
```

RLS: editors can `SELECT`; admins can `UPDATE` `cadence_preset`. Service role for all else.

Seed three rows on migration with cadence_preset='normal' and next_run_at=now().

## pg_cron + pg_net

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'agent-tick',
  '*/5 * * * *',
  $$ select net.http_post(
       url := <SUPABASE_URL>/functions/v1/agent-scheduler,
       headers := jsonb_build_object(
         'Content-Type', 'application/json',
         'Authorization', 'Bearer ' || <service_role_key>
       ),
       body := jsonb_build_object('action', 'tick')
     ) $$
);
```

Service role key + URL injected via Supabase Vault or env in migration. Approach: store in `vault.secrets`, look up at job time. (Verify Supabase Vault is available on this project; if not, fall back to a deploy-time interpolation using `set` + `current_setting`.)

## agent-scheduler changes

New actions:
- `tick` — service-role only. For each row in `agent_schedules` where `cadence_preset != 'off'` and `next_run_at <= now()`:
  - If kind in `discovery|verify_stale`: call `triggerAgentRun(kind, params)` (params for verify_stale: `{ batch_size: presetToBatch(preset) }`).
  - If kind = `embeddings_drain`: only fire when `embedding_jobs.status='pending'` count > 0; invoke `generate-embeddings` with `{ kick: true, batch_size: 50 }`.
  - Update `last_run_at`, `last_run_id`, `last_status`, advance `next_run_at` per preset.
  - Idempotency: a job whose previous run is still `running`/`pending` is skipped (status='skipped').
- `set_schedule` — admin only. Body: `{ job_kind, cadence_preset }`. Updates row, recomputes `next_run_at`.

Modify `triggerAgentRun` (or add wrapper): when `body.source !== 'tick'`, enforce min-interval against `last_manual_at` (10 min). Reject with 429 if too soon.

## UI

Replace `AgentHealthCard` with `AgentScheduleCard`. Per kind:

```
┌─ Discovery ────────────────── [▶ Run now] ┐
│ idle · last success: 2h ago (2m 14s)      │
│                                            │
│ Schedule:  [Off] [Light] [Normal*] [High]  │
│ Next: today 21:00 (in 7h 12m)              │
└────────────────────────────────────────────┘
```

For `verify_stale` add line: `"412 contacts need refresh — at 15/day, full cycle in ~28 days"` (count from `people.updated_at < now()-30d` and not deleted/excluded).

Move "Record Index Queue" panel → small footer strip:
- `Search index: up to date` (pending=0)
- `Search index: 47 pending, draining` (pending>0, last drain <10min)
- `Search index: 47 pending, last drain 1h ago — Run drain` (warning state)

Drop the embeddings AgentHealthCard from the top grid.

## Phases

- [x] **Phase 0** — Plan written (this file)
- [ ] **Phase 1** — Migration: `agent_schedules` table, RLS, seed rows, pg_cron + pg_net job
- [ ] **Phase 2** — `agent-scheduler` edge function: `tick`, `set_schedule`, min-interval guard
- [ ] **Phase 3** — UI: `AgentScheduleCard`, preset selector, embeddings footer; remove old card for embeddings
- [ ] **Phase 4** — Deploy migration + edge function to linked project; smoke-test tick fires, preset change persists, run-now still works
- [ ] **Phase 5** — Docs: SCHEMA.md (table + RLS), AI-PIPELINE.md (tick contract + preset semantics), ROUTES.md (admin/system surface change), EVALUATION.md (only if cadence affects gates)
- [ ] **Phase 6** — Quality checks: `npm run typecheck`, `npm test`, `npm run build`, `npm run lint`

## Risks / open items

- pg_cron + pg_net availability on this project ref. If Vault isn't configured, use a one-off SQL block at migration time that reads from `current_setting('app.settings.service_role_key', true)` set via `ALTER DATABASE ... SET`. Confirm at deploy.
- Time-zone of preset hours. Defaulting to UTC. If admin asks for ET, easy follow-up.
- Daily budget interplay: existing budget guards already cap; manual + scheduled runs share that budget. Out of scope for this plan to refactor budgets.
