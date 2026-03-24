# Flemish Network Intelligence Platform

## What This Is
A web platform for the Delegation of Flanders to the USA that maps and makes searchable the Flemish professional network across the United States. Replaces fragmented Excel-based tracking with a unified, AI-powered system. Target users: Fayat fellowship coordinators, Flanders Investment & Trade staff, diplomats, and Flemish professionals themselves.

## Tech Stack
- **Frontend:** React 18 + TypeScript, Vite, Tailwind CSS, Lucide React (icons)
- **Backend:** Supabase (PostgreSQL + Edge Functions in Deno/TypeScript)
- **AI (all Google, two tiers):**
  - **Gemini 1.5 Flash** (`gemini-1.5-flash`) — extraction, keyword generation, profile comparison
  - **Gemini Pro** (`gemini-2.5-pro-preview-05-06`) — reasoning, ranking, contact suggestions, briefing generation
  - **text-embedding-004** — profile embeddings for vector similarity search (768 dimensions)
- **Vector Search:** pgvector extension in Supabase PostgreSQL
- **Web Search:** Tavily API (free tier, 1000 calls/mo) + Brave Search API (free tier, 2000 calls/mo)
- **Geocoding:** Nominatim / OpenStreetMap (cached in `locations` table)
- **No router library** — routing is manual via `useState<Page>` in `App.tsx`

## Commands
```bash
npm run dev          # Start dev server
npm run build        # Production build
npm run preview      # Preview production build
npm run lint         # ESLint
npm run typecheck    # TypeScript type checking (tsc --noEmit)
```

## Project Structure
```
src/
├── App.tsx                     # Manual client-side routing via page state
├── main.tsx                    # Entry point
├── pages/                      # Top-level page components
│   ├── Dashboard.tsx           # Main view: map + directory + search
│   ├── Planner.tsx             # Mission/event planner (being replaced by Collections)
│   ├── Admin.tsx               # Stats dashboard + admin tools
│   ├── PersonProfile.tsx       # Individual contact detail/edit
│   ├── OrganizationProfile.tsx # Organization detail
│   └── AddContact.tsx          # Manual contact creation
├── components/                 # Reusable UI components
│   ├── Navigation.tsx          # Top nav bar with search
│   ├── MapVisualization.tsx    # Interactive US map with clusters
│   ├── FilterPanel.tsx         # Right sidebar filters
│   ├── DirectoryGrid.tsx       # Contact list view
│   ├── PlanForm.tsx            # Event creation form
│   ├── PlanDetail.tsx          # Event detail view
│   ├── PlannerChatbot.tsx      # AI chat for planning
│   ├── ClusterPopover.tsx      # Map cluster click popup
│   ├── ProfileUpdateModal.tsx  # AI profile suggestion review
│   └── admin/                  # Admin sub-components
├── lib/                        # Utilities and services
│   ├── supabase.ts             # DB client, types, helpers (Person, Organization, etc.)
│   ├── aiService.ts            # AI API wrapper + scoring functions
│   ├── plannerUtils.ts         # Event type configs, action templates
│   ├── csvParser.ts            # CSV import with field mapping + dedup
│   ├── geocoding.ts            # Batch geocoding via edge function
│   ├── locations.ts            # Location coordinate cache
│   └── usMapData.ts            # US state SVG paths + Mercator projection
supabase/
├── migrations/                 # Sequential SQL migrations (timestamp-prefixed)
└── functions/                  # Deno edge functions
    ├── ai-agent/               # Gemini orchestration (5 task types, see AI Strategy)
    ├── generate-embeddings/    # Profile embedding generation via text-embedding-004
    ├── suggest-people/         # Embedding pre-filter + Gemini Pro ranking
    ├── search-contacts/        # Web search for new contacts
    ├── geocode/                # Nominatim geocoding + DB caching
    └── update-profile/         # AI profile enrichment
```

## Architecture Decisions
- **No React Router:** Pages are switched via `currentPage` state in `App.tsx`. Navigation is handled by `onNavigate` callbacks. When adding new pages, add a new `Page` union member and conditional render in `App.tsx`.
- **No state management library:** All state via React hooks. Props passed down from App.tsx.
- **No auth yet:** Single-tenant with Supabase anon key. RLS allows public read, selective write.
- **AI via edge functions:** LLM calls go through `supabase/functions/ai-agent/` (Flash or Pro depending on task). Embeddings go through `generate-embeddings/`. Suggest-people has its own edge function (`suggest-people/`) that combines embedding pre-filter + Gemini Pro ranking. Filter interpretation is deterministic (no LLM) via `src/lib/filterParser.ts`.
- **Embeddings & vector search:** Profile embeddings (768-dim, text-embedding-004) stored in `people.embedding`. Used for `suggest-people` pre-filtering and collection "search similar". pgvector extension in PostgreSQL.
- **Types in supabase.ts:** All database entity types (Person, Organization, etc.) and shared types live in `src/lib/supabase.ts`.

## AI Strategy

### Model Tiers (all Google — single provider)

| Tier | Model ID | Use Cases | Approx Cost |
|---|---|---|---|
| Flash | `gemini-2.0-flash` | `parse_contacts`, `smart_search`, `flemish_search`, `check_profile`, `search-contacts` extraction | ~$0.10/1M input tokens |
| Pro | `gemini-2.5-pro-preview-05-06` | `suggest-people` ranking, briefing generation (future) | ~$1.25/1M input tokens |
| Embedding | `text-embedding-004` | Profile embeddings for vector search (768 dimensions) | Free tier |
| No LLM | `src/lib/filterParser.ts` | `interpret_filters` replaced with deterministic keyword matching | $0 |

Model IDs are configured via `GEMINI_FLASH_MODEL` and `GEMINI_PRO_MODEL` env vars so they can be updated when newer versions release.

### Task Details

- **`parse_contacts`** (Flash): Extract structured contact data from free-text user input.
- **`smart_search`** (Flash): Convert NL search query to structured keywords across all profile fields.
- **`flemish_search`** (Flash): Extract Flemish connection keywords from NL query. May merge into `smart_search` in the future.
- **`check_profile`** (Flash): Compare web search results against stored profile, suggest field updates.
- **`search-contacts`** (Flash): Extract structured contacts from web search results.
- **`suggest-people`** (Pro, via own edge function): Rank embedding-pre-filtered candidates (max 50) for a collection. Needs reasoning about relevance.
- **`interpret_filters`** (NO LLM): Deterministic keyword matching in `src/lib/filterParser.ts`. Maps sector names/aliases, US state codes/names, city names, occupation keywords, and Flemish connection names to filter values.

### Embedding Pipeline

1. Profile text = `"{name} | {current_position} | {bio} | {sectors comma-joined} | {flemish_connection} | {location_city}, {location_state}"`.
2. Embedded via text-embedding-004 → 768-dim vector stored in `people.embedding`.
3. Generated on profile create/update (fire-and-forget call to `generate-embeddings` edge function).
4. Queried via `match_people(query_embedding, match_count)` SQL function (cosine distance, pgvector).
5. Used for: `suggest-people` pre-filter (top 50 → Gemini Pro), collection "search similar" (pure vector similarity, no LLM).

### Web Search Budget

- **Tavily** free tier: 1000 searches/month. Primary provider for interactive searches and on-demand enrichment.
- **Brave Search API** free tier: 2000 searches/month. Overflow/fallback for batch agent operations.
- Agent scheduler checks `api_quotas` table before choosing provider. Results cached 30 days to avoid re-searching.
- Target budget: ~$20/month ceiling. Expected: $2-5/month LLM + free-tier web search + free-tier Supabase.

## Coding Conventions
- TypeScript strict mode. Run `npm run typecheck` before committing.
- Tailwind for all styling. No CSS files, no CSS-in-JS.
- Functional components only. No class components.
- Named exports for components, default export for pages.
- Edge functions use Deno APIs and imports from `https://esm.sh/`.

## Database Conventions
- Migrations are in `supabase/migrations/` with timestamp prefixes.
- Table names are snake_case plural (e.g., `people`, `plan_actions`).
- All tables have `id uuid DEFAULT gen_random_uuid() PRIMARY KEY`.
- All tables have `created_at timestamptz DEFAULT now()`.
- Junction tables use composite primary keys (e.g., `person_sectors(person_id, sector_id)`).
- RLS is enabled on all tables. Add policies in migrations.

## Branch Naming
Use feature branches: `feature/<short-description>` (e.g., `feature/unified-search`, `feature/collections`).

## Environment Variables
Frontend (in `.env`):
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Edge functions (set in Supabase dashboard):
- `GEMINI_API_KEY`
- `GEMINI_FLASH_MODEL` (default: `gemini-2.0-flash`)
- `GEMINI_PRO_MODEL` (default: `gemini-2.5-pro-preview-05-06`)
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- `TAVILY_API_KEY`
- `BRAVE_API_KEY`

## Key Domain Concepts
- **Flemish Connection:** A person's tie to Flanders — could be a university (KU Leuven, UGent, VUB, UAntwerp), fellowship (BAEF, Fayat), organization (imec), or city.
- **Sectors:** Broad fields (AI, Biotech, Finance, Culture & Arts, Education, Research). A person can belong to multiple sectors.
- **Occupation:** Career stage category (Student, Academic/Researcher, Professional, Executive/Leadership). Different from sector.
- **Collections (replacing Missions/Plans):** Named groups of contacts for a specific purpose (e.g., "Contacts for LA Trade Mission"). Lightweight — no event types, no action items.
