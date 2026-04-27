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
  - `AI-strategy.md` — significant AI architectural decisions or strategy shifts
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
- **`_shared/database.types.ts`** is a lightweight Deno-side schema shim. It does not encode relation metadata, so joined rows (`locations`, `sectors`, `person_flemish_connections`) must be normalized locally inside edge functions.

## AI Contract Notes
- `update-profile` → ad hoc single-person preview only. Returns inline suggestions to `ProfileUpdateModal`; never writes durable `profile_suggestions` rows.
- `agent-verify` → owns the durable verification queue. Admin stale-contact flows must call this, not `update-profile`.
- `derived_label_suggestions` → review queue for sectors, occupation, Flemish entities, locations, and confidence. Promote here first, then refresh embeddings.
- `agent-scheduler` → owns `agent_runs` lifecycle (start, cancel, timeout, cleanup). UI must not insert/update these rows directly.
- `connection_suggestions` → soft affinity only. Hard `connections` table gets only evidence-backed relationship types (`colleague`, `alumni`, `program_peer`, `local_peer`, `lab_peer`, `event_peer`).
- `person_sectors` / `person_flemish_connections` have insert/delete RLS policies but no update. Use conflict-ignore insert semantics (`ignoreDuplicates`) for idempotent writes.
- `ai-agent` tasks `parse_contacts` and `flemish_search` are frozen legacy. Active contracts: `smart_search`, `merge_text`, `check_profile`.
- `search-contacts` is a legacy alias for `discover-contacts`. Use `discover-contacts` for new code.

## Coding Conventions
- TypeScript strict mode. 2-space indentation. Run `npm run typecheck` before committing.
- Naming: components and pages in `PascalCase` (`ProfileUpdateModal.tsx`), utilities in `camelCase` (`csvParser.ts`), SQL migrations with timestamp prefixes (`20260328000000_description.sql`).
- Tailwind for all styling. No CSS files or CSS-in-JS.
- Functional components only. Named exports for components, default export for pages.
- Edge functions: `jsr:` and `npm:` imports only (NOT `https://esm.sh/`). Always include `corsHeaders` object and OPTIONS handler.
- Keep secrets out of client code. Never log credentials.

## Commit & PR Guidelines
- Short, lowercase, descriptive commit messages (`csv imports`, `agent infrastructure`). One concern per commit when practical.
- PRs should explain user-visible behavior, note any schema or environment changes, and include screenshots for UI changes.

## Database Conventions
- Migrations in `supabase/migrations/` with `YYYYMMDDHHMMSS_description.sql` naming.
- `snake_case` plural table names. All tables: `id uuid DEFAULT gen_random_uuid() PRIMARY KEY` + `created_at timestamptz DEFAULT now()`.
- Junction tables use composite PKs. RLS enabled on all tables; add policies in the same migration.
- Location data always goes via `locations` table + `location_id` FK.

## Environment Variables
Frontend (`.env`): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`

Edge functions (Supabase dashboard secrets):
- `GEMINI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — required
- `TAVILY_API_KEY` — primary web search; `BRAVE_API_KEY` — fallback
- `APIFY_TOKEN` — LinkedIn scrape (discovery + verification agents)
- `GEMINI_FLASH_MODEL`, `GEMINI_FLASH_LITE_MODEL`, `GEMINI_PRO_MODEL` — optional model overrides (defaults: `gemini-2.5-flash`, `gemini-2.5-flash-lite`, `gemini-2.5-pro`)
- Per-route overrides: `GEMINI_QUERY_MODEL`, `GEMINI_CLASSIFICATION_MODEL`, `GEMINI_EXTRACTION_MODEL`, `GEMINI_PROFILE_MODEL`, `GEMINI_MERGE_MODEL`, `GEMINI_EVAL_MODEL` (each with `_FALLBACK_MODEL` variant)
- `GEMINI_EMBEDDING_MODEL` — default `gemini-embedding-001`; changing requires a full re-embed plan

## Routes
```
/                     dashboard (URL state: view, q, sector, occupation, fc×N, city, state, people, organizations, lectures, focusCity, focusState)
/people/:id           person profile
/organizations/:id    organization profile
/collections          collection list
/collections/:id      collection detail
/admin                admin overview
/admin/:tab           admin sub-tabs (agents, discovered)
/contacts/new         add-contact
/login                staff magic-link sign-in
/auth/callback        auth redirect landing
/account              staff profile
```

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
- `docs/AI-PIPELINE.md` — detailed edge function flows, model routing, frontend AI functions, known bugs
- `AI-strategy.md` — full AI audit, model strategy, and design rationale for all phases
- `todo.md` — execution backlog by roadmap phase with strategy section refs
