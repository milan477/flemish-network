# Flemish Network Intelligence Platform

## What This Is
A web platform for the Delegation of Flanders to the USA that maps and makes searchable the Flemish professional network. Replaces fragmented Excel-based tracking with a unified, AI-powered system. Supabase project ref: `ofzuhajxwxggybkuzefq`.

## Tech Stack
- **Frontend:** React 18 + TypeScript, Vite 5, Tailwind CSS 3, Lucide React, `react-router-dom`
- **Backend:** Supabase (PostgreSQL + Deno Edge Functions)
- **Map:** Leaflet + react-leaflet + react-leaflet-cluster
- **AI:** Google Gemini 2.5 (`gemini-2.5-flash-lite` / `gemini-2.5-flash` / `gemini-2.5-pro` by route) + `gemini-embedding-001`
- **Web Search:** Tavily (primary, 1000 calls/mo free) + Brave Search (fallback)
- **Geocoding:** Nominatim/OpenStreetMap, cached in `locations` table

## Commands
```bash
npm install               # Install deps from package-lock.json
npm run dev               # Vite dev server (port 5173)
npm run build             # Production build → dist/
npm run preview           # Serve built app locally
npm run typecheck         # tsc --noEmit -p tsconfig.app.json
npm run lint              # ESLint (treat existing findings as baseline; don't add new ones)
npm run benchmark:search  # Run fixed search benchmarks against live search-people function
```

## Workflow Expectations
- **Run the full loop:** code → typecheck → build → deploy → smoke test. Never leave deployment to the user.
- Deploy migrations: `supabase db push --linked`
- Deploy functions: `supabase functions deploy <name> --project-ref ofzuhajxwxggybkuzefq`
- Deploy all functions: `supabase functions deploy --project-ref ofzuhajxwxggybkuzefq`
- Set secrets: `supabase secrets set KEY=value ... --project-ref ofzuhajxwxggybkuzefq`
- After deploying, make a curl/API call to verify. Fix issues immediately.
- Give the user exact browser steps to verify UI changes (which page, which button, what to expect).
- Document any new environment variables (add a code default + tell user to set the secret).
- Run `npm run lint` before opening a PR. Treat existing findings as baseline; don't add new ones.
- **Update docs at the end of every session that changes any of the following:**
  - `CLAUDE.md` — new architectural decisions or non-obvious constraints
  - `docs/SCHEMA.md` — any table/column/RLS/view changes
  - `docs/AI-PIPELINE.md` — any edge function behavior, model routing, or AI contract changes
  - `docs/AI-strategy.md` — significant AI architectural decisions or strategy shifts
  - `todo.md` — mark completed tasks, add new ones from the session

## Architecture Decisions
- **React Router owns navigation:** `App.tsx` uses `BrowserRouter`. Dashboard state is URL-encoded (see Routes below). AI search results cached in `sessionStorage` via `src/lib/dashboardSession.ts`.
- **No state management library:** React hooks + props drilled from `App.tsx`. All DB types in `src/lib/supabase.ts`.
- **Supabase Auth gates the app:** Staff sign in via magic links. `public.staff_users` is the authorization source. Roles: `viewer < editor < admin`. RPCs: `can_request_staff_login()`, `activate_staff_user_session()`. Admin `Access` tab manages the allowlist.
- **Edge Functions self-authenticate:** `supabase/config.toml` sets `verify_jwt = false` for every function (required by Supabase's newer asymmetric auth tokens). Each handler enforces auth via `requireStaffRole()`. Do not re-enable the gateway JWT check.
- **AI via edge functions:** All LLM calls go through edge functions. Shared prompts/schemas in `_shared/aiContracts.ts`, model routing in `_shared/gemini.ts`. `agent-scheduler` is the single lifecycle-control path for all agent runs — the UI must never write `agent_runs` directly.
- **`agent-scheduler` must forward caller headers:** Pass `Authorization`/`apikey` from the original request when dispatching downstream functions. Using `SUPABASE_SERVICE_ROLE_KEY` as bearer causes `401` rejections.
- **Locations as separate table:** `people`/`organizations` use `location_id` FK → `locations(city, state, latitude, longitude)`. No inline location columns. AI suggestions may arrive as `location_city`/`location_state` but writes must resolve to `location_id`.
- **Flemish connections normalized:** No `people.flemish_connection` text column. All Flemish ties go through `flemish_connections` + `person_flemish_connections`. Call `syncPersonFlemishConnectionsAndRequeue()` after writes that affect these links.
- **Embedding refresh is backend-owned:** `embedding_jobs` queue, not browser-side inline generation. Frontend kicks with `generate-embeddings?kick=true` after saves.
- **`agent-connections` runs one relationship type per invocation** to stay under the DB statement timeout on first-run backfills.
- **Filter parser is deterministic:** `src/lib/filterParser.ts` — no LLM call needed.
- **Structured errors are the Phase 6.3 contract:** Edge functions return `{ error: { code, message, hint? } }` via `_shared/httpError.ts`; frontend callers preserve these as `EdgeFunctionError` and admin surfaces render them with `StructuredErrorBanner`.
- **System Health is the Phase 6.4 operator surface:** `/admin/system` reads `agent_runs`, `embedding_jobs`, and `embedding_batch_runs`, starts/cancels work through edge functions, and maps visible errors to `docs/RUNBOOK.md`.
- **Edge logs are structured:** use `_shared/log.ts` with `[fn:<name>] [run:<id>] [evt:<event>]` prefixes for Supabase log searches.
- **`_shared/database.types.ts`** is a lightweight Deno-side schema shim. It does not encode relation metadata, so joined rows (`locations`, `sectors`, `person_flemish_connections`) must be normalized locally inside edge functions.

## AI Contract Notes
See `docs/AI-PIPELINE.md` § Behavioral Contracts for full rules on which function owns which responsibility.

## Coding Conventions
- TypeScript strict mode. 2-space indentation. Run `npm run typecheck` before committing.
- Naming: components and pages in `PascalCase` (`ProfileUpdateModal.tsx`), utilities in `camelCase` (`csvParser.ts`), SQL migrations with timestamp prefixes (`20260328000000_description.sql`).
- Tailwind for all styling. No CSS files or CSS-in-JS.
- Functional components only. Named exports for components, default export for pages.
- Edge functions: `jsr:` and `npm:` imports only (NOT `https://esm.sh/`). Always include `corsHeaders` object and OPTIONS handler.
- Keep secrets out of client code. Never log credentials.

## Database Conventions
- Migrations in `supabase/migrations/` with `YYYYMMDDHHMMSS_description.sql` naming.
- `snake_case` plural table names. All tables: `id uuid DEFAULT gen_random_uuid() PRIMARY KEY` + `created_at timestamptz DEFAULT now()`.
- Junction tables use composite PKs. RLS enabled on all tables; add policies in the same migration.
- Location data always goes via `locations` table + `location_id` FK.

## Environment Variables
Frontend (`.env`): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. See `docs/ENV.md` for all edge-function secrets.

## Routes
See `docs/ROUTES.md` for the full route table.

## Key Domain Concepts
- **Flemish Connection:** A person's tie to Flanders — university (KU Leuven, UGent, VUB, UAntwerp), fellowship (BAEF, Fayat), org (imec), or city. Stored in `flemish_connections` + `person_flemish_connections`.
- **Sectors:** AI, Biotech, Finance, Culture & Arts, Education, Research. `sectors` table + `person_sectors` junction.
- **Occupation:** Student / Academic/Researcher / Professional / Executive/Leadership. Single text field on `people`.
- **Derived Labels:** AI-proposed tags in `derived_label_suggestions`. Review before promoting to canonical fields.
- **Connection Suggestions:** Soft affinity in `connection_suggestions`. Separate from hard `connections` graph.
- **Collections:** Named contact groups (e.g. "LA Trade Mission"). Replaced old Missions/Planner system.
- **Profile Suggestions:** AI field-update proposals in `profile_suggestions`. Reviewed via admin panel.

## Reference Docs
Read these when working on the relevant area — they are not auto-loaded but contain the full detail. Keep them up to date (see Workflow Expectations above).
- `docs/SCHEMA.md` — full database schema (tables, columns, RLS, ops/internal views)
- `docs/AI-PIPELINE.md` — detailed edge function flows, model routing, behavioral contracts, known bugs
- `docs/AI-STRATEGY.md` — full AI audit, model strategy, and design rationale for all phases
- `docs/ENV.md` — all environment variables and secrets
- `docs/ROUTES.md` — frontend route table

## graphify

This project has a graphify knowledge graph at graphify-out/.

Rules:
- Before answering architecture or codebase questions, read graphify-out/GRAPH_REPORT.md for god nodes and community structure
- If graphify-out/wiki/index.md exists, navigate it instead of reading raw files
- For cross-module "how does X relate to Y" questions, prefer `graphify query "<question>"`, `graphify path "<A>" "<B>"`, or `graphify explain "<concept>"` over grep — these traverse the graph's EXTRACTED + INFERRED edges instead of scanning files
- After modifying code files in this session, run `graphify update .` to keep the graph current (AST-only, no API cost)
