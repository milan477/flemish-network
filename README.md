# Flemish Network Intelligence Platform

A web platform for the Delegation of Flanders to the USA that maps, verifies, and makes searchable the Flemish professional network across the United States.

## Agent Roles

The platform uses specialized backend agents with distinct responsibilities:
- `agent-scheduler`: Orchestrates agent run lifecycle (manual triggers, dispatch, status updates, cleanup, and ops/metrics actions).
- `agent-discovery`: Runs the bounded frontier discovery pipeline to find new contacts from web evidence.
- `agent-verify`: Verifies existing profiles (LinkedIn-first, then web+LLM fallback) and writes durable review suggestions.
- `agent-connections`: Discovers hard relationship edges in SQL and updates soft affinity suggestions.
- `ai-agent`: Shared structured LLM task endpoint for query parsing and profile-check contracts used across flows.

Related non-agent endpoints that support the same workflows:
- `discover-contacts`: Ad hoc operator prospecting endpoint (legacy alias: `search-contacts`).
- `update-profile`: Single-profile verification preview path for inline suggestions.
- `search-people`: Hybrid lexical/vector retrieval for directory search.

## Overview

The platform combines a React frontend with Supabase (Postgres + Edge Functions) and AI-assisted workflows for:
- hybrid people search (lexical + vector)
- contact discovery from web evidence
- profile verification and suggestion review
- relationship and affinity mapping
- collections and mission-specific contact curation

## Core Capabilities

- Staff-only app access with role-based permissions (`viewer`, `editor`, `admin`)
- Directory of people and organizations with map/list exploration
- Hybrid search with query routing (`direct_lookup`, `faceted`, `exploratory`)
- AI-assisted discovery and verification pipelines
- Collection management and AI-suggested people
- Admin operations panels for discovery planning and model/ops metrics
- CSV import pipeline with dedup and rollback-aware cancellation

## Tech Stack

- Frontend: React 18, TypeScript, Vite, Tailwind CSS
- Backend: Supabase Postgres + Deno Edge Functions
- Map: Leaflet + react-leaflet + marker clustering
- AI: Gemini 2.5 family + `gemini-embedding-001`
- Web search: Tavily (primary), Brave (fallback)

## Repository Structure

```text
src/
  pages/             Route-level screens
  components/        Shared UI and admin panels
  lib/               Supabase client, AI service wrappers, parser/helpers
supabase/
  migrations/        SQL schema and policy migrations
  functions/         Edge Functions (search, discovery, verify, scheduler, etc.)
public/              Static datasets and assets
scripts/             Utility and benchmark scripts
test-csvs/           CSV fixtures for importer validation
benchmarks/          Benchmark contract documentation
```

## Local Development

### Prerequisites

- Node.js 20+
- npm
- Supabase CLI (for local or remote function/migration workflows)

### Install

```bash
npm install
```

### Run

```bash
npm run dev
```

### Build and Validate

```bash
npm run typecheck
npm run build
npm run lint
```

## Environment Variables

Create a `.env` file for frontend and local scripts.

### Frontend

```bash
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

### Edge Functions / Server-side Secrets

Set in Supabase secrets (not in frontend `.env`):

- `GEMINI_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `TAVILY_API_KEY`
- `BRAVE_API_KEY` (optional fallback)
- `APIFY_TOKEN` (discovery/verification enrichment)

Optional model overrides:
- `GEMINI_FLASH_MODEL`
- `GEMINI_FLASH_LITE_MODEL`
- `GEMINI_PRO_MODEL`
- route-specific overrides such as `GEMINI_QUERY_MODEL`, `GEMINI_PROFILE_MODEL`, `GEMINI_EXTRACTION_MODEL`, etc.

## Supabase Workflow

### Apply Migrations

```bash
supabase db push --linked
```

### Deploy Edge Functions

Single function:

```bash
supabase functions deploy search-people --project-ref <project-ref>
```

All functions:

```bash
supabase functions deploy --project-ref <project-ref>
```

Set secrets:

```bash
supabase secrets set GEMINI_API_KEY=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... TAVILY_API_KEY=... BRAVE_API_KEY=... APIFY_TOKEN=... --project-ref <project-ref>
```

### Auth/JWT Note

This project uses in-function staff auth checks. In `supabase/config.toml`, function-level `verify_jwt = false` is intentionally set because the built-in legacy gate can reject newer asymmetric auth tokens before handler-level auth runs.

## Routing

Main routes:

- `/` dashboard
- `/people/:personId`
- `/organizations/:id`
- `/collections`
- `/collections/:id`
- `/admin`
- `/admin/:tab`
- `/contacts/new`
- `/login`
- `/auth/callback`
- `/account`

Dashboard search/filter state is URL-driven and preserved via query params.

## AI and Data Pipelines

Key functions in `supabase/functions/`:

- `search-people`: hybrid lexical/vector search with reranking and snippets
- `discover-contacts`: ad hoc operator discovery (legacy alias: `search-contacts`)
- `agent-discovery`: frontier-based bounded crawler with evidence storage
- `agent-verify`: LinkedIn-first profile verification + durable suggestions
- `update-profile`: single-profile preview suggestions
- `agent-connections`: SQL-driven hard-edge relationship discovery + soft affinity suggestions
- `generate-embeddings`: queue-driven embedding refresh and optional batch lane
- `agent-scheduler`: lifecycle orchestration for agent runs
- `geocode`: location parsing + geocoding/cache flow

## Search and Discovery Benchmarks

Use canonical benchmark datasets and views documented in `benchmarks/README.md`:
- `benchmark_search_queries_active`
- `benchmark_discovery_sources_active`
- ops views such as `ops_phase_success_metrics`

Run search benchmark script:

```bash
npm run benchmark:search
```

## Testing Guidance

No dedicated unit/integration runner is currently configured. Minimum validation loop:

```bash
npm run typecheck
npm run build
npm run lint
```

For importer changes, validate with fixtures in `test-csvs/`.
For function changes, smoke test the affected endpoint and related UI flow.

## Security Notes

- Keep all API keys and service role credentials out of client code.
- Treat internal ops and benchmark views as privileged surfaces.
- Staff access is enforced through `staff_users` + role checks.

## Contributing

- Keep commits short, lowercase, and focused.
- Prefer one concern per commit.
- For schema/function changes, include migration/deploy/smoke-test notes in PRs.
- Add screenshots for UI-affecting changes.

## Useful Commands

```bash
npm run dev
npm run typecheck
npm run build
npm run preview
npm run lint
npm run benchmark:search
```
