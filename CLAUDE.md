# Flemish Network Intelligence Platform

## What This Is
A web platform for the Delegation of Flanders to the USA that maps and makes searchable the Flemish professional network across the United States. Replaces fragmented Excel-based tracking with a unified, AI-powered system. Target users: Fayat fellowship coordinators, Flanders Investment & Trade staff, diplomats, and Flemish professionals themselves.

## Tech Stack
- **Frontend:** React 18 + TypeScript, Vite 5, Tailwind CSS 3, Lucide React (icons)
- **Backend:** Supabase (PostgreSQL + Edge Functions in Deno/TypeScript)
- **Map:** Leaflet + react-leaflet + react-leaflet-cluster (marker clustering)
- **AI:** Google Gemini (`gemini-3-flash-preview`, hardcoded in edge functions)
- **Web Search:** Tavily API (free tier, 1000 calls/mo). Brave Search API key configured but not yet integrated.
- **Geocoding:** Nominatim / OpenStreetMap (cached in `locations` table via `geocode` edge function)
- **No router library** — routing is manual via `useState<Page>` in `App.tsx`

## Commands
```bash
npm run dev          # Start Vite dev server (port 5173)
npm run build        # Production build (outputs to dist/)
npm run preview      # Preview production build
npm run lint         # ESLint
npm run typecheck    # TypeScript type checking (tsc --noEmit -p tsconfig.app.json)
```

## Project Structure (actual, as of 2026-03-25)
```
src/
├── App.tsx                          # Manual routing via Page union type + conditional renders
├── main.tsx                         # Entry point
├── pages/
│   ├── Dashboard.tsx                # Main view: map + directory grid + unified search + filter panel
│   ├── Collections.tsx              # Collection list + detail view (handles both pages)
│   ├── Admin.tsx                    # Stats dashboard + admin tools (tabbed: Overview, Suggestions, Contacts, Occupations, Stale, Duplicates)
│   ├── PersonProfile.tsx            # Individual contact detail/edit with AI enrichment
│   ├── OrganizationProfile.tsx      # Organization detail/edit
│   └── AddContact.tsx               # Manual contact creation form
├── components/
│   ├── Navigation.tsx               # Top nav bar (Dashboard, Collections, Admin links + search input)
│   ├── UnifiedSearchBar.tsx         # Combined name-autocomplete + NL AI search bar
│   ├── MapVisualization.tsx         # Leaflet map with marker clusters
│   ├── FilterPanel.tsx              # Right sidebar: sector, occupation, state, city, flemish connection, lectures toggle
│   ├── DirectoryGrid.tsx            # Contact card grid with sorting and collection bookmark buttons
│   ├── ClusterPopover.tsx           # Popup when clicking map marker clusters
│   ├── CollectionDetail.tsx         # Collection detail: member list, notes, add/remove
│   ├── CollectionModal.tsx          # Create/edit collection dialog
│   ├── AddToCollectionDropdown.tsx  # Dropdown to add a person to collections
│   ├── CitySearch.tsx               # City autocomplete using locations table
│   ├── ProfileUpdateModal.tsx       # Review/approve AI-suggested profile changes
│   └── admin/
│       ├── AddContactPanel.tsx      # Admin quick-add contact form
│       ├── AdminChatbot.tsx         # AI chatbot for admin (search contacts, parse contacts)
│       ├── ContactCard.tsx          # Card component for admin contact results
│       ├── CsvImport.tsx            # CSV file import with column mapping + dedup
│       ├── DuplicateCompare.tsx     # Side-by-side duplicate contact comparison
│       ├── OccupationOverview.tsx   # Occupation distribution stats
│       ├── StaleContactsBar.tsx     # Contacts needing verification
│       └── SuggestedChanges.tsx     # Review AI profile suggestions (approve/reject)
├── lib/
│   ├── supabase.ts                  # Supabase client + all TS types (Person, Organization, Collection, etc.) + constants (OCCUPATION_OPTIONS, FLEMISH_OPTIONS, US_STATES, MAJOR_CITIES)
│   ├── aiService.ts                 # AI API wrappers: parseContacts, searchContacts, smartSearch, flemishSearch, suggestPeople, scoring functions
│   ├── filterParser.ts              # Deterministic NL→filter parsing (no LLM): sector aliases, states, cities, occupations, flemish connections
│   ├── csvParser.ts                 # CSV import: field mapping, validation, dedup checking
│   ├── geocoding.ts                 # Batch geocoding via edge function
│   └── locations.ts                 # Location coordinate helpers
supabase/
├── migrations/                      # 23 sequential SQL migrations (see Database Schema below)
└── functions/                       # 4 deployed Deno edge functions
    ├── ai-agent/                    # Gemini orchestration (4 tasks: parse_contacts, smart_search, flemish_search, check_profile)
    ├── search-contacts/             # Tavily web search + Gemini extraction + dedup check
    ├── update-profile/              # Web search a person + generate profile suggestions via check_profile
    └── geocode/                     # Nominatim geocoding + locations table caching
scripts/
└── batch_replace.cjs                # One-time migration helper (location column refactor)
public/
├── cities.json                      # US cities dataset (JSON)
└── us_cities.csv                    # US cities dataset (CSV, used for location imports)
```

## Page Routing
Pages are switched via `currentPage` state in `App.tsx`. The `Page` type union is:
```typescript
type Page = 'dashboard' | 'person' | 'organization' | 'collections' | 'collection-detail' | 'admin' | 'add-contact';
```
Navigation callbacks use `onNavigate(page, id?, preset?)`. Legacy page names (`'directory'`, `'search'`, `'missions'`, `'planner'`) are aliased to their replacements.

## Architecture Decisions
- **No React Router:** Pages switched via `currentPage` state in `App.tsx` with `onNavigate` callbacks.
- **No state management library:** All state via React hooks. Props drilled down from App.tsx.
- **No auth:** Single-tenant with Supabase anon key. RLS allows public read, selective write. All write operations are open.
- **AI via edge functions:** All LLM calls go through Supabase Edge Functions. The `ai-agent` function handles 4 structured task types. `search-contacts` does its own Tavily + Gemini pipeline. `update-profile` orchestrates web search + `check_profile` for enrichment.
- **Locations as separate table:** `people` and `organizations` have `location_id` FK to `locations` table. Old inline `location_city`/`location_state`/`latitude`/`longitude` columns were dropped. Queries use `.select('*, locations(*)')` to join.
- **Types in supabase.ts:** All database entity types (Person, Organization, Collection, etc.), constants, and shared interfaces live in `src/lib/supabase.ts`.
- **Filter parser is deterministic:** `src/lib/filterParser.ts` handles NL-to-filter conversion with keyword matching — no LLM call needed.

## Database Schema (current state after all 23 migrations)

### Core Tables
| Table | Key Columns | Notes |
|---|---|---|
| `people` | `id`, `name`, `title`, `first_name`, `last_name`, `current_position`, `organization_id` (FK), `location_id` (FK→locations), `occupation`, `bio`, `profile_photo_url`, `flemish_connection`, `available_for_lectures`, `open_to_mentorship`, `welcomes_visits`, `preferred_contact`, `phone`, `email`, `email_verified`, `linkedin_url`, `website_url`, `twitter_url`, `data_source`, `last_verified_at`, `created_at`, `updated_at` | Main entity. No inline location columns (use locations FK). |
| `organizations` | `id`, `name`, `type`, `description`, `logo_url`, `website_url`, `location_id` (FK→locations), `flemish_link`, `created_at`, `updated_at` | No inline location columns. |
| `locations` | `id`, `city`, `state`, `latitude`, `longitude` | UNIQUE(city, state). Populated from us_cities.csv import. |
| `sectors` | `id`, `name` (unique) | Seeded: AI, Biotech, Finance, Culture & Arts, Education, Research |
| `connections` | `id`, `from_person_id`, `to_person_id`, `from_organization_id`, `to_organization_id`, `relationship_type`, `strength` | CHECK constraint requires at least one from/to pair |

### Junction Tables
| Table | Keys |
|---|---|
| `person_sectors` | `(person_id, sector_id)` PK |
| `organization_sectors` | `(organization_id, sector_id)` PK |

### Collections
| Table | Key Columns |
|---|---|
| `collections` | `id`, `name`, `description`, `created_at`, `updated_at` |
| `collection_members` | `id`, `collection_id` (FK), `person_id` (FK), `notes`, `added_at`. UNIQUE(collection_id, person_id) |

### AI & Suggestions
| Table | Key Columns |
|---|---|
| `profile_suggestions` | `id`, `person_id` (FK), `field_name`, `current_value`, `suggested_value`, `source`, `status` (pending/approved/rejected) |
| `saved_flemish_filters` | `id`, `original_query`, `keywords` (JSONB), `target_fields`, `filter_type`, `usage_count` |

### Legacy (still in DB, no longer used in frontend)
| Table | Status |
|---|---|
| `plans`, `plan_actions`, `plan_suggested_people` | Planner feature removed. Tables remain but are unused. |

### RLS Summary
- All tables: SELECT allowed for `anon, authenticated`
- `people`, `organizations`: INSERT/UPDATE allowed for `anon, authenticated` (added in later migrations)
- `collections`, `collection_members`: Full CRUD for `anon, authenticated`
- `profile_suggestions`: SELECT, UPDATE (status changes), DELETE for `anon, authenticated`. INSERT via service role only.
- `locations`: SELECT and INSERT for `anon, authenticated`

## AI Pipeline (what actually exists)

### Model
All edge functions use `gemini-3-flash-preview` hardcoded. No env var override exists yet. No Pro model is used.

### Edge Function: `ai-agent`
Central LLM orchestrator. Accepts `{ task, context }`. Uses Gemini structured output (JSON schema).

| Task | Purpose | Input Context | Output Schema |
|---|---|---|---|
| `parse_contacts` | Extract contacts from free text | `{ description, sectors }` | `{ message, contacts[] }` |
| `smart_search` | NL query → keyword arrays for 8 profile fields | `{ query }` | `{ message, keywords: { name[], occupation[], sector[], location_city[], location_state[], current_position[], flemish_connection[], bio[] } }` |
| `flemish_search` | NL query → Flemish-specific keywords | `{ query }` | `{ message, keywords: { flemish_connection[], bio[] } }` |
| `check_profile` | Compare person data vs web results, suggest updates | `{ person, searchResults }` | `{ suggestions: [{ field_name, current_value, suggested_value, source }] }` |

### Edge Function: `search-contacts`
1. Takes `{ query }` → appends "(flemish/belgian professional)" → calls Tavily (advanced, 10 results)
2. Feeds search results to Gemini for structured extraction
3. Dedup checks against `people` table (email, LinkedIn URL, name)
4. Returns `{ message, contacts[] }` with `is_duplicate` flags

### Edge Function: `update-profile`
1. Takes `{ personId }` or `{ personIds }` → fetches person from DB
2. Searches Tavily for `"{name} {position} {city} flemish belgian"`
3. Calls `ai-agent` with `check_profile` task
4. Inserts resulting suggestions into `profile_suggestions` table

### Edge Function: `geocode`
1. Takes `{ pairs: [{ city, state }] }` (max 25)
2. Checks `locations` table cache first
3. Falls back to Nominatim API (1.1s delay between requests for rate limiting)
4. Caches results in `locations` table

### Frontend AI Functions (in `aiService.ts`)
- `parseContacts(description, sectors)` → calls `ai-agent` parse_contacts
- `searchContacts(query)` → calls `search-contacts` edge function
- `smartSearch(query)` → calls `ai-agent` smart_search
- `flemishSearch(query)` → calls `ai-agent` flemish_search
- `suggestPeople(query)` → uses `smartSearch` + scores all people client-side (no embeddings yet)
- `scorePersonAgainstKeywords(person, keywords)` → weighted field matching
- `scorePersonAgainstFilter(person, keywords, fields)` → boolean match

### What Does NOT Exist Yet
- `generate-embeddings` edge function (planned)
- `suggest-people` edge function (planned)
- pgvector / `people.embedding` column (planned)
- `match_people` SQL function (planned)
- `agent_runs`, `api_quotas`, `web_search_cache` tables (planned)
- Agent scheduler / orchestrator (planned)
- Discovery, verification, connection agents (planned)
- Apify integration for LinkedIn scraping (API key in `.env`, no code yet) — planned for Discovery Agent (LinkedIn people search) and Verification Agent (LinkedIn profile scrape + photo extraction)
- Brave Search integration (API key configured but no code uses it)
- Model env vars (`GEMINI_FLASH_MODEL`, `GEMINI_PRO_MODEL`) — not used, model is hardcoded

### Known Bugs
- **`geocode` edge function broken:** References `people.latitude`, `people.longitude`, `people.location_city`, `people.location_state` — all dropped in location refactor migration. Needs rewrite to use `locations` table via `location_id`.
- **`update-profile` edge function partially broken:** `processOnePerson()` reads `person.location_city` and `person.location_state` from `people.*` query — those columns no longer exist. The search query will be incomplete.
- **12 TypeScript errors:** `DiscoveredContact` type doesn't have `location_id`/`locations` (it uses inline city/state from web search). `PersonProfile.tsx` uses non-existent `location_display` property. `CitySearch.tsx` has an unused variable.
- **Person interface incomplete:** `src/lib/supabase.ts` Person interface is missing `available_for_lectures`, `open_to_mentorship`, `welcomes_visits` boolean fields that exist in the DB.
- **Build size warning:** JS bundle is 688kb (192kb gzipped), above Vite's 500kb warning threshold.
- **25 console.log/error/warn calls in production code:** Across 9 frontend files. Should use a proper logger or remove.
- **9 alert() calls as error handling:** In PersonProfile, OrganizationProfile, CollectionDetail. Should replace with toast/snackbar UI.
- **`search-contacts` dedup loads ALL people:** Fetches entire `people` table to check for duplicates by name. Will degrade as DB grows. Should use targeted queries (e.g., `WHERE name ILIKE $1`).
- **Dashboard NL search loads ALL people:** `suggestPeople()` in `aiService.ts` fetches up to 200 people then scores client-side. No server-side filtering. Will not scale.
- **`profile_suggestions.person_id` is NOT NULL:** The Discovery Agent design (Phase 3.1 in AI strategy) inserts discovered NEW contacts into `profile_suggestions` — but new contacts have no `people` row yet, so the FK constraint will reject the insert. Design blocker for discovery agent.
- **`@types/leaflet` and `@types/leaflet.markercluster` in dependencies:** Should be in devDependencies in `package.json`.

## Workflow Expectations
- **Always deploy and verify changes end-to-end.** After writing code, run all necessary deployment steps yourself (push migrations with `supabase db push --linked`, deploy edge functions with `supabase functions deploy <name> --project-ref ofzuhajxwxggybkuzefq`, run `npm run typecheck`, `npm run build`, etc.). Do not leave deployment as instructions for the user.
- **Smoke-test after deploying.** After deploying edge functions or migrations, make a quick curl/API call to verify things work. Fix issues immediately if they don't.
- **Run the full loop:** code → typecheck → build → deploy → test. The user expects changes to be live and verified, not just written to disk.
- **Provide manual testing steps for the UI.** After deploying, tell the user exactly how to verify the changes in the browser: which page to go to, which button to click, what they should see. Be specific (e.g., "Go to Admin → scroll to Embedding Search Index → click Generate Embeddings → you should see a progress bar fill up").

## Coding Conventions
- TypeScript strict mode. Run `npm run typecheck` before committing.
- Tailwind for all styling. No CSS files, no CSS-in-JS.
- Functional components only. No class components.
- Named exports for components, default export for pages.
- Edge functions use `jsr:` and `npm:` imports (NOT `https://esm.sh/`).
- Edge function CORS pattern: all functions include `corsHeaders` object and OPTIONS handler.

## Database Conventions
- Migrations are in `supabase/migrations/` with timestamp prefixes (format: `YYYYMMDDHHMMSS_description.sql`).
- Table names are snake_case plural (e.g., `people`, `collections`).
- All tables have `id uuid DEFAULT gen_random_uuid() PRIMARY KEY`.
- All tables have `created_at timestamptz DEFAULT now()`.
- Junction tables use composite primary keys (e.g., `person_sectors(person_id, sector_id)`).
- RLS is enabled on all tables. Add policies in migrations.
- Location data is stored in the `locations` table, referenced via `location_id` FK.

## Environment Variables
Frontend (in `.env`):
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Edge functions (set in Supabase dashboard):
- `GEMINI_API_KEY` (required for all AI features)
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (required for DB access in edge functions)
- `TAVILY_API_KEY` (required for web search in search-contacts and update-profile)
- `BRAVE_API_KEY` (configured but not yet used in code)
- `APIFY_TOKEN` (configured in `.env`, not yet used in code — planned for LinkedIn scraping in Discovery/Verification agents, $5/mo free tier)

## Deploying Edge Functions
```bash
# Deploy a single function
supabase functions deploy ai-agent --project-ref <your-project-ref>

# Deploy all functions
supabase functions deploy --project-ref <your-project-ref>

# Set secrets (required per function)
supabase secrets set GEMINI_API_KEY=... TAVILY_API_KEY=... BRAVE_API_KEY=... APIFY_TOKEN=... --project-ref <your-project-ref>
```
Edge functions require the Supabase CLI (`npm i -g supabase`). The project ref is in the Supabase dashboard URL.

## Key Domain Concepts
- **Flemish Connection:** A person's tie to Flanders — could be a university (KU Leuven, UGent, VUB, UAntwerp), fellowship (BAEF, Fayat), organization (imec), or city. Stored as single text field on `people`.
- **Sectors:** Broad fields (Artificial Intelligence, Biotechnology, Finance, Culture & Arts, Education, Research). Stored in `sectors` table, linked via `person_sectors` junction.
- **Occupation:** Career stage category (Student, Academic/Researcher, Professional, Executive/Leadership). Single text field on `people`.
- **Collections:** Named groups of contacts for a specific purpose (e.g., "Contacts for LA Trade Mission"). Replaced the old Missions/Planner system.
- **Profile Suggestions:** AI-generated field update proposals stored in `profile_suggestions`, reviewed via admin panel (approve/reject).
