# Agent Instructions

## Project Context

Flemish Network Intelligence Platform is a React/Vite/Supabase app for mapping and searching the Flemish professional network in the United States. Supabase project ref: `ofzuhajxwxggybkuzefq`.

## Source Of Truth

Keep this file short. It is read by every agent, so it should contain only durable operating rules and pointers to the docs that own details.

Active docs:

- `docs/PRODUCT-SERVICES.md` - product service boundaries and user-facing vocabulary.
- `docs/WEBAPP-MASTERPLAN.md` - current cleanup status, phases, next work, and verification criteria.
- `docs/ROUTES.md` - frontend route, redirect, tab, and API endpoint contract.
- `docs/SCHEMA.md` - database tables, columns, RLS, views, functions, and legacy schema notes.
- `docs/AI-PIPELINE.md` - edge-function ownership, AI behavior contracts, model routing, and legacy AI paths.
- `docs/EVALUATION.md` - quality gates and evaluation expectations for discovery, verification, and growth.

Archived docs under `docs/archive/` are historical context only. Do not treat them as active requirements or restore archived flows unless the user explicitly asks.

## Required Workflow

- Prefer existing patterns and docs over inventing new architecture.
- Use React 18, TypeScript, Vite, Tailwind, Supabase Edge Functions, and the existing helper modules.
- Keep product UI vocabulary aligned with `docs/PRODUCT-SERVICES.md`; do not expose implementation names like `agent-*` as staff-facing labels.
- Route all discovery and verification run lifecycle changes through `agent-scheduler`; the UI must not write `agent_runs` directly.
- Keep edge functions self-authenticated with shared auth helpers. Do not re-enable Supabase gateway JWT verification for functions listed in `supabase/config.toml`.
- Preserve normalized data rules: locations go through `locations.location_id`; Flemish ties go through `flemish_connections` and `person_flemish_connections`.
- Do not reintroduce removed person-to-person graph features or hidden database expansion inside Collections.

## Commands

```bash
npm install
npm run dev
npm run typecheck
npm run lint
npm test
npm run test:deno
npm run build
npm run smoke
```

Run the checks that match the change. For broad source changes, run at least `npm run typecheck`, `npm test`, and `npm run build`; run `npm run lint` before PR-style handoff. For Supabase Edge Function shared logic, also run `npm run test:deno` when relevant.

## Documentation Updates

Before finishing any change, update every affected source-of-truth file in the same session:

- Update `docs/SCHEMA.md` for any migration, table, column, view, RPC, RLS policy, generated type, or database contract change.
- Update `docs/ROUTES.md` for any frontend route, redirect, admin tab, URL state, or API/edge endpoint contract change.
- Update `docs/AI-PIPELINE.md` for any edge-function ownership, AI prompt/schema, model routing, scheduler behavior, error contract, discovery/verification flow, or legacy AI path change.
- Update `docs/PRODUCT-SERVICES.md` for any product service boundary, user-facing workflow, vocabulary, or scope change.
- Update `docs/WEBAPP-MASTERPLAN.md` when completing, adding, removing, or reprioritizing cleanup tasks or phase status.
- Update `docs/EVALUATION.md` when changing quality gates, evaluation cases, benchmarks, or acceptance criteria.
- Update `.env.example` when adding, renaming, or removing environment variables or Supabase secrets.
- Update this `AGENTS.md` only when a rule must be read by every future agent.

If a change does not require docs, say that explicitly in the final response.