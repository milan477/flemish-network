# Phase 6 — Handoff Hardening

This file tracks Phase 6 progress across sessions. It mirrors the format of the deleted `todo.md` (Phases 0–5, see `git show HEAD:todo.md`).

## How to use this file

- The full rationale and architecture for Phase 6 lives in `~/.claude/plans/so-the-current-lazy-deer.md`. Read that for context before starting work in a new session.
- This file is the **source of truth for status**. Mark `- [x]` and add an `Update (YYYY-MM-DD):` line capturing what shipped, file paths, and any deviations from the plan.
- Working rule for every task: finish the validation/deploy loop before flipping the checkbox — `npm run typecheck`, `npm test`, `npm run test:deno`, `npm run build`, `supabase db push --linked` (if migrations changed), deploy changed edge functions, smoke-test the affected UI/API.
- For Phase 6 tasks not derived from `AI-strategy.md`, the strategy-refs line reads: `Strategy refs: handoff-readiness; not derived from AI-strategy.md.`

## Goal

Take the platform from feature-complete to handoff-ready for the Delegation of Flanders to the USA, who will fully self-host (frontend Docker + their own Supabase project). Six workstreams: testing, resilience, observability, installability, autonomous agents, performance.

## Recommended sequencing

1. **6.2 testing first** — the harness gives safety for everything that follows.
2. **6.3 resilience** — surfaces real errors so 6.4 has something to display.
3. **6.4 observability** — IT panel + runbook.
4. **6.1 installability** — by now the system is ready to ship to a fresh Supabase project.
5. **6.5 autonomous agents** — only enable cron after the system is observable and recoverable.
6. **6.6 performance** — last, with measurement.

---

## 6.1 — Installability for full self-host

- [ ] Add `README.md` at repo root.
  Do: 60-second quickstart + links to HANDOFF/RUNBOOK/SCHEMA/AI-PIPELINE/CLAUDE. Keep < 100 lines.
  Repo touchpoints: `README.md` (new).
  Strategy refs: handoff-readiness; not derived from AI-strategy.md.

- [ ] Write `docs/HANDOFF.md` — full bootstrap walkthrough on a fresh Supabase project.
  Do: prerequisites (Docker, Node 20, Supabase CLI, accounts for Google AI Studio, Tavily, Brave, Apify), `supabase link`, `db push`, `functions deploy --project-ref`, `secrets set` (full list from `CLAUDE.md` Environment Variables), first admin SQL (`INSERT INTO public.staff_users`), frontend `.env` + `docker build` + `docker run`, smoke checklist.
  Repo touchpoints: `docs/HANDOFF.md` (new), references to existing `CLAUDE.md` env vars section.
  Strategy refs: handoff-readiness; not derived from AI-strategy.md.

- [ ] Add `.env.example` (frontend) and `docs/edge-secrets.example` (edge function secrets).
  Do: comments + sources for every secret in CLAUDE.md "Environment Variables".
  Repo touchpoints: `.env.example` (new), `docs/edge-secrets.example` (new).
  Strategy refs: handoff-readiness; not derived from AI-strategy.md.

- [ ] Fix Dockerfile to accept `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as `ARG` build args.
  Do: Vite inlines these at build time, so the current Dockerfile silently bakes in whatever was in the local `.env`. Use `ARG` + `ENV` so HANDOFF.md can document `--build-arg`.
  Repo touchpoints: `Dockerfile`, `docs/HANDOFF.md`.
  Strategy refs: handoff-readiness; not derived from AI-strategy.md.

- [ ] Add `docker-compose.yml` for the frontend service.
  Do: single service, configurable via `.env`, exposes 8080.
  Repo touchpoints: `docker-compose.yml` (new).
  Strategy refs: handoff-readiness; not derived from AI-strategy.md.

- [ ] Rename `package.json` `"name"` to `"flemish-network"` and `"version"` to `"1.0.0"`.
  Repo touchpoints: `package.json`.
  Strategy refs: handoff-readiness; not derived from AI-strategy.md.

- [ ] Verify migration idempotency on a throwaway Supabase project.
  Do: bootstrap a virgin project, run `supabase db push --linked` twice; both must succeed. Fix non-idempotent migrations (typically: `CREATE TABLE` without `IF NOT EXISTS`, seed `INSERT` without `ON CONFLICT`, `CREATE EXTENSION` without `IF NOT EXISTS`).
  Repo touchpoints: `supabase/migrations/*.sql` (whichever fail).
  Strategy refs: handoff-readiness; not derived from AI-strategy.md.

- [ ] Document seed-data flow.
  Do: list which migrations carry seed data (sectors, source packs, metro areas, benchmark queries) and the contract for re-seeding on a clean install.
  Repo touchpoints: `docs/HANDOFF.md`, `docs/SCHEMA.md`.
  Strategy refs: handoff-readiness; not derived from AI-strategy.md.

- [ ] (Optional) Add `scripts/bootstrap.sh` that prompts for project ref + secrets, runs deploy loop, prints smoke checklist.
  Repo touchpoints: `scripts/bootstrap.sh` (new).
  Strategy refs: handoff-readiness; not derived from AI-strategy.md.

---

## 6.2 — Focused testing for refactor safety

Update (2026-04-28): Phase 6.2 complete. 52 vitest tests + 32 Deno tests + smoke harness + CI workflow shipped. `npm test`, `npm run test:deno`, `npm run typecheck`, `npm run build` all green. Vitest pinned to ^2.1.9 for Vite 5 compatibility (Vitest 4 needs Vite 6+).

- [x] Add testing dependencies and `vitest.config.ts`.
  Do: install `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom` as devDeps. Configure `jsdom` environment for React lib tests. Add scripts `"test": "vitest run"` and `"test:watch": "vitest"`.
  Repo touchpoints: `package.json`, `vitest.config.ts` (new).
  Strategy refs: handoff-readiness; not derived from AI-strategy.md.

- [x] Unit tests for `src/lib/filterParser.ts`.
  Do: every supported filter (sector, occupation, fc, city, state) plus edge cases — empty query, malformed input, mixed-case, non-ASCII city names.
  Repo touchpoints: `src/lib/__tests__/filterParser.test.ts` (new).
  Strategy refs: handoff-readiness; not derived from AI-strategy.md.

- [x] Unit tests for `src/lib/dashboardSession.ts`.
  Do: encode/decode roundtrip, sessionStorage cache hit/miss/eviction, `canUseSessionStorage()` fallback.
  Repo touchpoints: `src/lib/__tests__/dashboardSession.test.ts` (new).
  Strategy refs: handoff-readiness; not derived from AI-strategy.md.

- [x] Unit tests for `src/lib/flemishConnectionSync.ts`.
  Do: normalization, canonicalization, dedupe of variants ("KU Leuven" / "Katholieke Universiteit Leuven" / "kuleuven"). (Note: source file is a thin RPC wrapper; tests cover its call surface — the canonicalization tests properly belong on the Deno side via `derivedLabels` Flemish-entity inference, which they do.)
  Repo touchpoints: `src/lib/__tests__/flemishConnectionSync.test.ts` (new).
  Strategy refs: handoff-readiness; not derived from AI-strategy.md.

- [x] Unit tests for `src/lib/appRouting.ts` URL ↔ state roundtrip.
  Do: every dashboard view config (people / organizations / lectures, all combinations of focus filters).
  Repo touchpoints: `src/lib/__tests__/appRouting.test.ts` (new).
  Strategy refs: handoff-readiness; not derived from AI-strategy.md.

- [x] Deno tests for shared edge function helpers.
  Do: `searchRouting_test.ts` (route classification fixtures), `locationPipeline_test.ts` (text parser cases), `derivedLabels_test.ts` (clamp/canonicalize/dedupe), `aiContracts_test.ts` (schema validators) under `supabase/functions/_shared/__tests__/`. Add `"test:deno": "deno test --allow-env --allow-net supabase/functions/_shared/__tests__/"`.
  Repo touchpoints: `supabase/functions/_shared/__tests__/*_test.ts` (new), `package.json`.
  Strategy refs: handoff-readiness; not derived from AI-strategy.md.
  Latent bug surfaced (out of scope to fix here): `buildLocationSeed` in `supabase/functions/_shared/derivedLabels.ts` returns `dedupe_key: ""` because it bypasses `pushSeed`. Test asserts the dedupe_key invariant only on non-location seeds.

- [x] Smoke harness `scripts/smoke_edge_functions.ts`.
  Do: Node + tsx script that provisions a temporary staff session (or uses `SMOKE_TEST_ACCESS_TOKEN`), hits every deployed edge function with a known fixture, validates response shape (no `{}`, expected keys, no top-level `error` for happy path), prints `PASS`/`FAIL` + timing per function. Add `"smoke": "tsx scripts/smoke_edge_functions.ts"` to `package.json`.
  Repo touchpoints: `scripts/smoke_edge_functions.ts` (new), `package.json`.
  Strategy refs: handoff-readiness; not derived from AI-strategy.md.

- [x] CI workflow `.github/workflows/ci.yml`.
  Do: on PR run `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:deno`, `npm run build`. Use `denoland/setup-deno` for the Deno step.
  Repo touchpoints: `.github/workflows/ci.yml` (new).
  Strategy refs: handoff-readiness; not derived from AI-strategy.md.

---

## 6.3 — Resilience and no silent failures

Update (2026-04-28): Phase 6.3 complete. Shipped non-empty `buildLocationSeed` dedupe keys, route-level `ErrorBoundary`, Sonner-backed `src/lib/toast.ts`, structured frontend edge errors (`EdgeFunctionError`), admin `StructuredErrorBanner` in AgentDashboard/ProfileUpdateModal, `_shared/httpError.ts` with `{ error: { code, message, hint? } }`, `wrapHandler` coverage for deployed edge entrypoints, `agent_runs.error_kind` migration + scheduler timeout/dispatch failure writes, and visible/logged handling for audited silent catches. Validation/deploy loop completed: `npm run typecheck`, `npm test`, `npm run test:deno`, `deno check supabase/functions/*/index.ts`, `npm run build`, `supabase db push --linked`, `supabase functions deploy --project-ref ofzuhajxwxggybkuzefq`, and `npm run smoke` (11 passed, 0 failed, 1 skipped because `SMOKE_TEST_PERSON_ID` was unset). `npm run lint` still fails on pre-existing baseline issues plus script/test lint outside this workstream; no 6.3 runtime validation is blocked by that.

-  [x] buildLocationSeed in supabase/functions/_shared/derivedLabels.ts    returns dedupe_key: "" because it bypasses pushSeed. Test asserts the invariant only on non-location seeds and notes this in docs/phase6.md. The silent dedupe-key collisions could let duplicate location suggestions slip through.

- [x] `src/components/ErrorBoundary.tsx` with copy-error fallback.
  Do: class component rendering a friendly fallback that includes a copy-to-clipboard error block (stack + run-id-equivalent + browser/version). Wrap each route in `App.tsx`.
  Repo touchpoints: `src/components/ErrorBoundary.tsx` (new), `src/App.tsx`.
  Strategy refs: handoff-readiness; not derived from AI-strategy.md.

- [x] Toast system.
  Do: pick `sonner` (~3KB) or roll a tiny `src/lib/toast.tsx`. Replace bare `console.error` in user-facing flows with `toast.error(humanMessage, { hint })`.
  Repo touchpoints: `package.json` (if sonner) or `src/lib/toast.tsx` (new), various pages/components.
  Strategy refs: handoff-readiness; not derived from AI-strategy.md.

- [x] Audit silent catches in `src/`.
  Do: `grep -rE 'catch\s*\([^)]*\)\s*\{\s*\}' src/`, plus `console.error`-only catches, plus `.catch(() =>`. Each gets one of: re-throw, structured log, or visible toast. Document the audit in this Update line.
  Repo touchpoints: various files in `src/`.
  Strategy refs: handoff-readiness; not derived from AI-strategy.md.

- [x] Audit silent catches in `supabase/functions/`.
  Do: same grep patterns. Many edge functions return success even when downstream calls fail.
  Repo touchpoints: various files in `supabase/functions/`.
  Strategy refs: handoff-readiness; not derived from AI-strategy.md.

- [x] Standardize edge function error response shape.
  Do: `{ error: { code, message, hint? } }`. Extend `HttpError` in `_shared/auth.ts` with a `hint` field. Add `_shared/httpError.ts` with `wrapHandler(fn)` higher-order helper that catches uncaught errors and returns the structured shape so handlers don't have to remember.
  Repo touchpoints: `supabase/functions/_shared/auth.ts`, `supabase/functions/_shared/httpError.ts` (new), all edge function `index.ts` (light edits to use `wrapHandler`).
  Strategy refs: handoff-readiness; not derived from AI-strategy.md.

- [x] Add `agent_runs.error_kind` enum column.
  Do: new migration adding the column with check constraint over a fixed enum (`quota_exhausted`, `auth_failed`, `network`, `db_timeout`, `invalid_input`, `agent_failure`, `unknown`). Backfill `unknown` for existing rows. Update `agent-scheduler` housekeeping to set it on timeout.
  Repo touchpoints: `supabase/migrations/20260427000001_phase6_error_kind.sql` (new), `supabase/functions/agent-scheduler/index.ts`.
  Strategy refs: handoff-readiness; not derived from AI-strategy.md.

- [x] Update `src/lib/aiService.ts` to preserve structured edge-function errors.
  Do: replace `throw new Error(...)` with throws that preserve the `{ code, message, hint }` from the edge function so callers can render `error.hint` without parsing strings.
  Repo touchpoints: `src/lib/aiService.ts`.
  Strategy refs: handoff-readiness; not derived from AI-strategy.md.

- [x] `src/components/admin/StructuredErrorBanner.tsx` shared by admin surfaces.
  Do: shared component used by SystemHealthPanel, AgentDashboard, ProfileUpdateModal so error rendering is consistent.
  Repo touchpoints: `src/components/admin/StructuredErrorBanner.tsx` (new).
  Strategy refs: handoff-readiness; not derived from AI-strategy.md.

---

## 6.4 — Observability for IT operators

Update (2026-04-28): Phase 6.4 complete. Shipped `/admin/system` via `src/components/admin/SystemHealthPanel.tsx`, Admin tab routing, read-only editor access for `embedding_jobs` (`supabase/migrations/20260428000001_phase6_system_health.sql`), `docs/RUNBOOK.md`, structured edge logger `_shared/log.ts`, and migrated direct agent/shared `console.*` calls to logger events. Docs updated in `CLAUDE.md`, `docs/SCHEMA.md`, `docs/AI-PIPELINE.md`, and `docs/ROUTES.md`. Validation/deploy loop completed: `npm run typecheck`, `npm test`, `npm run test:deno`, `deno check supabase/functions/agent-scheduler/index.ts supabase/functions/agent-discovery/index.ts supabase/functions/agent-verify/index.ts supabase/functions/generate-embeddings/index.ts`, `npm run lint`, `npm run build`, `supabase db push --linked`, `supabase functions deploy --project-ref ofzuhajxwxggybkuzefq`, and `npm run smoke` (11 passed, 0 failed, 1 skipped because `SMOKE_TEST_PERSON_ID` was unset).

Update (2026-04-28): Fixed System Health warning for editors reading `embedding_batch_runs` by adding read-only policy/grant migration `supabase/migrations/20260428000002_phase6_embedding_batch_health.sql`.

Update (2026-04-28): Removed the direct browser read from `embedding_batch_runs` in `SystemHealthPanel`; embedding batch status now loads through `generate-embeddings` `action: 'list_batches'`, avoiding table-level RLS/grant drift.

Update (2026-04-28): Made embedding batch telemetry best-effort in `SystemHealthPanel`; a non-2xx from `generate-embeddings` no longer blocks the rest of System Health from loading.

- [x] `src/components/admin/SystemHealthPanel.tsx` mounted at `/admin/system`.
  Do: per-agent type (discovery / verify / connections / embeddings) — last successful run + duration, last failed run + structured error, currently running (with cancel), "Run now" button (already exists via scheduler — surface here). Embedding queue depth + age of oldest job. Stuck runs (`agent_runs.status='running'` past timeout) with cancel. Today's API spend (Gemini / Tavily / Apify) sourced from `agent_runs.results.usage`. Supabase connectivity test button. "Run housekeeping now" button.
  Repo touchpoints: `src/components/admin/SystemHealthPanel.tsx` (new), `src/pages/Admin.tsx`, `src/lib/appRouting.ts`.
  Strategy refs: handoff-readiness; not derived from AI-strategy.md.

- [x] `docs/RUNBOOK.md` keyed by error code/kind.
  Do: entries for `[quota_exhausted]`, `[auth_failed]`, `[network]`, `[db_timeout]`, plus narrative entries for "Discovery hasn't found anyone in N days" and "Embedding queue keeps growing". Each entry has root cause + fix steps.
  Repo touchpoints: `docs/RUNBOOK.md` (new).
  Strategy refs: handoff-readiness; not derived from AI-strategy.md.

- [x] `supabase/functions/_shared/log.ts` structured logger.
  Do: prefixes every line `[fn:<name>] [run:<id>] [evt:<event>] ...` so Supabase dashboard logs are grep-able by run.
  Repo touchpoints: `supabase/functions/_shared/log.ts` (new).
  Strategy refs: handoff-readiness; not derived from AI-strategy.md.

- [x] Migrate edge functions to use `_shared/log.ts`.
  Do: replace direct `console.log` calls in agent functions and shared helpers.
  Repo touchpoints: various edge function `index.ts` files and `_shared/`.
  Strategy refs: handoff-readiness; not derived from AI-strategy.md.

---

## 6.5 — Autonomous agents with budget cap and kill switch

The frontier framework already tracks "where agents have been" (`discovery_frontier`, `discovery_domains.yield_score`, `discovery_pages.content_hash`, `last_seen`, `revisit_after`) and "promising directions" (`discovery_domains.yield_score`, `coverage_gaps`, `discovery_entity_pivots`, `discovery_frontier_refills`). This workstream adds the missing **heartbeat + spend governance** layer.

- [ ] Migration `20260427000002_phase6_autonomous_scheduling.sql`.
  Do: `agent_schedules` (`agent_type`, `cron_expression`, `enabled`, `last_triggered_at`, `last_succeeded_at`). `agent_budgets` (`provider` enum: `gemini`/`tavily`/`apify`, `period`: `daily`, `limit_calls`, `limit_tokens`, current period totals + `period_start`, auto-reset trigger on day rollover). `system_settings` row `agents_kill_switch` (boolean, default `true` so first deploy is safe). Enable `pg_cron` extension; create cron jobs that `net.http_post` into `agent-scheduler` for each enabled `agent_type` with a service-role bearer. Default schedules: discovery every 6h, verify nightly, connections nightly (after verify), embeddings drain every 30 min.
  Repo touchpoints: `supabase/migrations/20260427000002_phase6_autonomous_scheduling.sql` (new).
  Strategy refs: handoff-readiness; not derived from AI-strategy.md.

- [ ] Update `agent-scheduler` to accept `source: "cron"` mode.
  Do: cron mode auths via service role JWT (skip `requireStaffRole`). Before dispatching: check `agents_kill_switch` (no-op if true), check `agent_budgets` for the providers the target agent uses (no-op if exhausted), record telemetry in `agent_runs`. After agent run: increment `agent_budgets` running totals from `agent_runs.results.usage`.
  Repo touchpoints: `supabase/functions/agent-scheduler/index.ts`.
  Strategy refs: handoff-readiness; not derived from AI-strategy.md.

- [ ] `supabase/functions/_shared/budget.ts` helpers.
  Do: `checkBudget(provider, kind)` and `recordSpend(provider, calls, tokens)` used by the scheduler.
  Repo touchpoints: `supabase/functions/_shared/budget.ts` (new).
  Strategy refs: handoff-readiness; not derived from AI-strategy.md.

- [ ] `src/components/admin/AutomationPanel.tsx` mounted at `/admin/automation`.
  Do: per-agent toggle (enable/disable scheduled run, edit cron expression with validation, show next-fire time). Per-provider budget editor + today's used vs. limit progress bar. Big red "Stop all agents" button toggling the kill switch. "Reset budgets now" admin-role-only action.
  Repo touchpoints: `src/components/admin/AutomationPanel.tsx` (new), `src/pages/Admin.tsx`, `src/lib/appRouting.ts`.
  Strategy refs: handoff-readiness; not derived from AI-strategy.md.

- [ ] Verify auto-runs land in pending review.
  Do: write a smoke check or test that a cron-triggered discovery run produces `discovered_contacts.status = 'pending'` (never auto-promoted). The contract is already this; this task protects it under cron.
  Repo touchpoints: `scripts/smoke_edge_functions.ts` or new test.
  Strategy refs: handoff-readiness; not derived from AI-strategy.md.

- [ ] Document autonomous architecture in `docs/AI-PIPELINE.md`.
  Do: append "Autonomous scheduling" section covering schedules, budgets, kill switch, and how the existing frontier framework drives discovery direction.
  Repo touchpoints: `docs/AI-PIPELINE.md`.
  Strategy refs: handoff-readiness; not derived from AI-strategy.md.

---

## 6.6 — Performance pass (after profiling, not before)

Defer until 6.1–6.5 land. Then measure, then fix. Don't guess.

- [ ] Bundle analysis with `vite-bundle-visualizer`.
  Do: identify heavy deps (likely `leaflet`, `react-leaflet-cluster`, `country-state-city`, `xlsx`). Code-split via `React.lazy` so routes that don't use the map don't pull leaflet.
  Repo touchpoints: TBD per profiling.
  Strategy refs: handoff-readiness; not derived from AI-strategy.md.

- [ ] React DevTools Profiler on `Dashboard`, `MapVisualization`, `FlemishConnectionChart`.
  Do: capture flamegraph; only optimize the top 3 hotspots.
  Repo touchpoints: TBD per profiling.
  Strategy refs: handoff-readiness; not derived from AI-strategy.md.

- [ ] `EXPLAIN ANALYZE` slowest queries from `pg_stat_statements`.
  Do: likely offenders are `search-people` lexical+vector fusion, `agent-discovery` claim RPC under contention, `discover_connections` first run.
  Repo touchpoints: TBD per profiling.
  Strategy refs: handoff-readiness; not derived from AI-strategy.md.

- [ ] Cache rarely-changing admin lookups (`sectors`, `flemish_connections`, `metro_areas`) in `sessionStorage` with a 1-hour TTL.
  Repo touchpoints: TBD.
  Strategy refs: handoff-readiness; not derived from AI-strategy.md.

- [ ] (Deferred) Aesthetic polish.
  Do: separate pass after handoff lands. Lower priority than performance per user.
  Strategy refs: handoff-readiness; not derived from AI-strategy.md.

---

## Cross-cutting docs

- [ ] Update `CLAUDE.md` with a "Handoff" subsection.
  Do: point to `docs/HANDOFF.md` and `docs/RUNBOOK.md`; note the cron + budget + kill-switch architecture so future agents know the system is autonomous after Phase 6.
  Repo touchpoints: `CLAUDE.md`.

- [ ] Append "Autonomous scheduling" section to `docs/AI-PIPELINE.md`.
  Do: after 6.5 lands.
  Repo touchpoints: `docs/AI-PIPELINE.md`.

- [ ] Update `docs/SCHEMA.md` for new tables/columns.
  Do: document `agent_schedules`, `agent_budgets`, `system_settings.agents_kill_switch`, `agent_runs.error_kind`.
  Repo touchpoints: `docs/SCHEMA.md`.

---

## End-to-end verification (run after sequencing is complete)

1. **Tests:** `npm test && npm run test:deno` → all green. CI on a PR shows green.
2. **Smoke harness:** `npm run smoke` against staging → every edge function returns structured success.
3. **Bootstrap from scratch:** Create a throwaway Supabase project, follow `docs/HANDOFF.md` step by step, end with the dashboard loading and a successful sign-in. Time the run; if >2 hours, simplify.
4. **Docker handoff:** `docker build --build-arg VITE_SUPABASE_URL=... --build-arg VITE_SUPABASE_ANON_KEY=... -t flemish-network . && docker run -p 8080:8080 flemish-network` → app loads at `http://localhost:8080`.
5. **Resilience:** Force-break one secret (e.g. invalid `GEMINI_API_KEY`), trigger a discovery run, confirm Admin → System Health surfaces a structured `[auth_failed]` error with a hint cross-referenced in `docs/RUNBOOK.md`.
6. **Kill switch:** Enable cron for one agent; wait one tick; confirm a run lands. Flip kill switch; wait one tick; confirm next tick is a no-op recorded in telemetry. Flip back; confirm runs resume.
7. **Budget cap:** Set Gemini daily limit to 10 calls; trigger discovery; on the 11th call confirm it short-circuits with `[quota_exhausted]` and waits for tomorrow.
8. **Refactor confidence loop:** Make a cosmetic change to `filterParser.ts` that subtly breaks one case; confirm `npm test` catches it.
