# Flemish Network Platform — TODO

Updated 2026-03-25. Reflects actual codebase state. Checked items are merged and working.

---

## P0 — Completed Features

These are done and merged into main. Listed for reference only.

### Unified Search Bar [DONE]
- [x] Consolidated three search experiences into one UnifiedSearchBar
- [x] Name/org autocomplete + NL AI search mode
- [x] Active search context as removable chips
- [x] Profile name decomposition (title, first_name, last_name)

### Auto-Apply Filters & Deterministic Parser [DONE]
- [x] Filters auto-apply on change (no "Apply" button)
- [x] Occupation dropdown (4 categories)
- [x] Flemish Connection multi-select
- [x] `filterParser.ts` — deterministic keyword matching, no LLM
- [x] Removed `interpret_filters` LLM task

### Collections [DONE]
- [x] `collections` + `collection_members` tables
- [x] Collections page with list/detail views
- [x] Add/remove members, per-member notes
- [x] Add-to-collection dropdown on person cards and profiles
- [x] Removed Planner/Missions system (tables remain in DB unused)

### Data Quality Fields [DONE]
- [x] `data_source` and `last_verified_at` columns on `people`
- [x] Verification badge on profiles
- [x] Data source indicator on profiles

### Profile Form UX [DONE]
- [x] Occupation proper dropdown
- [x] State dropdown, city search autocomplete (CitySearch component)
- [x] Flemish Connection tag selector
- [x] Bio auto-inference for flemish connections

### Location Refactor [DONE]
- [x] Separate `locations` table with city/state/lat/lng
- [x] `location_id` FK on people and organizations
- [x] Old inline location columns dropped
- [x] Bulk US cities imported from CSV

---

## P0 — Critical Bug Fixes (Do First)

### 0a. Fix TypeScript Errors
**Scope:** AdminChatbot.tsx, ContactCard.tsx, CitySearch.tsx, PersonProfile.tsx, supabase.ts
**Effort:** Small (< 1 hour)

12 TypeScript errors currently block `npm run typecheck`:
- [x] `DiscoveredContact` type in AdminChatbot/ContactCard uses `location_id` and `locations` — but discovered contacts from web search have inline `location_city`/`location_state`. Fix: keep DiscoveredContact type with inline fields, don't try to use the locations FK pattern.
- [x] `PersonProfile.tsx` references `location_display` which doesn't exist on `Partial<Person>`. Fix: use proper location fields or a local state variable.
- [x] `CitySearch.tsx` has unused `value` variable. Fix: remove or use it.
- [x] `Person` interface in `supabase.ts` is missing `available_for_lectures`, `open_to_mentorship`, `welcomes_visits` boolean fields (exist in DB, used in Dashboard queries). Fix: add them.

### 0b. Fix Broken Edge Functions
**Scope:** `supabase/functions/geocode/index.ts`, `supabase/functions/update-profile/index.ts`
**Effort:** Small (< 1 hour)

Both functions reference columns that were dropped in the location refactor migration:
- [x] **`geocode`:** Lines 110-121 try to `UPDATE people SET latitude = ..., longitude = ... WHERE location_city = ...` — these columns don't exist anymore. Fix: the geocode function should just cache into `locations` table. Remove the people/organizations update logic (linking is now done via `location_id` FK).
- [x] **`update-profile`:** Lines 166-170 read `person.location_city` and `person.location_state` from `people.*` — these columns were dropped. Fix: join `locations` table via `location_id` and use `locations.city`/`locations.state`.

### 0c. Remove console.log/alert from Production Code
**Scope:** 9 frontend files
**Effort:** Small (< 1 hour)

- [x] **25 console.log/error/warn calls** across PersonProfile.tsx (8), CollectionDetail.tsx (4), OrganizationProfile.tsx (3), AddToCollectionDropdown.tsx (3), Admin.tsx (2), CollectionModal.tsx (2), aiService.ts (1), Collections.tsx (1), Dashboard.tsx (1). Remove or replace with a lightweight logger that can be silenced in production.
- [x] **9 alert() calls** in PersonProfile.tsx (3), OrganizationProfile.tsx (3), CollectionDetail.tsx (3). Replace with a toast/snackbar notification component (e.g., react-hot-toast or a custom Tailwind toast).

### 0d. Fix search-contacts Dedup Performance
**Scope:** `supabase/functions/search-contacts/index.ts`
**Effort:** Small (< 0.5 hour)

- [x] Currently fetches ALL `people` rows (`SELECT name, email, linkedin_url FROM people`) to check for duplicates. Replace with targeted per-contact lookups: `WHERE email = $1 OR linkedin_url = $2 OR LOWER(name) = LOWER($3)`.

### 0e. Fix @types in Wrong Dependency Section
**Scope:** `package.json`
**Effort:** Trivial

- [x] Move `@types/leaflet` and `@types/leaflet.markercluster` from `dependencies` to `devDependencies`.

---

## P0 — AI Infrastructure (Next Priority)

### 1. Model Configuration Refactor
**Scope:** `ai-agent/index.ts`, `search-contacts/index.ts`
**Effort:** Small (< 1 hour)

- [x] Replace hardcoded `const GEMINI_MODEL = "gemini-3-flash-preview"` with `Deno.env.get("GEMINI_FLASH_MODEL") || "gemini-3-flash-preview"` in both edge functions
- [x] Document in Supabase dashboard: set `GEMINI_FLASH_MODEL` env var

### 2. Embeddings & Vector Search
**Scope:** New migration, new edge function, admin UI, frontend trigger points
**Depends on:** Nothing
**Effort:** Medium (1-2 days)

- [x] **Migration:** Enable pgvector, add `embedding vector(768)`, `embedding_dirty_at`, `embedding_generated_at` to `people`, create HNSW index, create `match_people()` RPC function, create dirty-marking triggers on `people` (name, bio, current_position, flemish_connection, occupation, location_id) AND on `person_sectors` insert/delete (see `ai-implementation-strategy.md` Phase 1.1 for exact SQL)
- [x] **Edge function `generate-embeddings`:** Accept `{ personId | personIds | backfill }`, call text-embedding-004, store 768-dim vector. Batch mode: 20 per invocation (Supabase 60s limit). For backfill, return `{ processed, remaining }` — frontend loops until remaining=0. (see strategy Phase 1.2)
- [x] **Frontend triggers:** After person INSERT (AddContact.tsx) and UPDATE (PersonProfile.tsx), fire-and-forget call to generate-embeddings
- [x] **Admin backfill:** Add "Generate Embeddings" button in Admin.tsx with progress bar. Calls generate-embeddings in a loop (20 per call) until `remaining === 0`. Shows progress: "Processed 120/500".

### 3. Suggest-People Edge Function
**Scope:** New edge function, updated aiService.ts, CollectionDetail.tsx
**Depends on:** Task 2 (embeddings)
**Effort:** Medium (1-2 days)

- [x] **Edge function `suggest-people`:** Embed query → `match_people(50)` → exclude existing members → Gemini Pro ranking → return top 15 with reasons (see strategy Phase 1.3)
- [x] **Update `aiService.ts`:** Replace current `suggestPeople()` (client-side scoring) with call to suggest-people edge function
- [x] **Collection "Find Similar":** Add button to CollectionDetail.tsx. Build query from collection description or top member bios. Show suggestions in slide-out panel with "Add to Collection" buttons.

---

## P0 — Data & Content

### 4. Export & Briefing Documents
**Scope:** New `lib/exportService.ts`, DirectoryGrid.tsx, CollectionDetail.tsx, PersonProfile.tsx
**Effort:** Medium (1-2 days)
keep in mind that sector(s) and flemish connections are multi-valued and need to be aggregated properly in exports. For the PDF briefing, keep in mind that the export formats should be clean and professional, suitable for sharing with external stakeholders or for internal briefings.
- [x] **CSV export of filtered results:** "Export" button on DirectoryGrid header. Columns: Title, First Name, Last Name, Position, Organization, About, City, State, Sector(s), Flemish Connections, Email, Phone, LinkedIn, website, X url
- [x] **Collection PDF briefing:** "Export Briefing" button on CollectionDetail. For each member: photo placeholder, name, title, position, location, bio, contact info, flemish connection. Use `window.print()` with print CSS or jsPDF.
- [x] **Print-friendly profiles:** Print stylesheet for PersonProfile.tsx (hide nav, sidebar, action buttons). "Print" button.

### 5. Profile Pictures (Automatic)
**Scope:** PersonProfile.tsx, AddContact.tsx, DirectoryGrid.tsx, new utility
**Effort:** Small-Medium (0.5-1 day)

Currently `profile_photo_url` is a text field with no automatic population.

- [x] **Gravatar fallback:** ProfileAvatar component uses SHA-256 hash of email for Gravatar URL with `?d=404` fallback. Falls back to initials if Gravatar returns 404.
- [ ] **LinkedIn photo (via Apify):** For contacts with `linkedin_url` and no photo, the Verification Agent's LinkedIn scrape (Task 9) automatically suggests `profile_photo_url` from LinkedIn profile data. Manual paste in edit mode as fallback.
- [x] **Upload support:** PersonProfile.tsx edit mode has photo upload (Supabase Storage `profile-photos` bucket) + URL paste field. 5MB limit, stores public URL to `profile_photo_url`.
- [x] **Display priority:** ProfileAvatar component implements: profile_photo_url > Gravatar (if email exists) > initials circle. Used across DirectoryGrid, PersonProfile, CollectionDetail, ClusterPopover, OrganizationProfile, CollectionModal.

### 6. Improve Database Population Pipeline
**Scope:** CsvImport.tsx, new import features
**Effort:** Medium (1-2 days)

Current CSV import works but needs improvements for bulk population.

- [ ] **CSV import improvements:**
  - Progress bar during import (currently no feedback)
  - Better error reporting (show which rows failed and why)
  - Post-import summary: created, updated, skipped, errors
  - Auto-trigger embedding generation after import completes
  - Auto-link imported people to locations table (match city+state → location_id)
- [ ] **Bulk sector assignment:** After import, allow selecting imported people and assigning sectors in bulk
- [ ] **Excel support:** Accept .xlsx files in addition to .csv (use SheetJS/xlsx library)
- [ ] **Template download:** "Download template" button with expected columns and example data

---

## P1 — Agent System

### 7. Agent Infrastructure
**Scope:** New migration, shared module, scheduler edge function, admin dashboard
**Depends on:** Tasks 1-3 (AI infrastructure) should be stable
**Effort:** Large (2-3 days)

- [ ] **Migration:** Create `agent_runs`, `api_quotas`, `web_search_cache` tables (see strategy Phase 2.1)
- [ ] **Shared web search module:** `supabase/functions/_shared/webSearch.ts` with Tavily/Brave cascading, quota tracking, 30-day caching, TTL cleanup of expired cache entries (see strategy Phase 2.2)
- [ ] **Shared Apify module:** `supabase/functions/_shared/apifyClient.ts` — wrapper for Apify REST API. Sync/async actor execution, credit tracking. Used by Discovery Agent (LinkedIn search) and Verification Agent (LinkedIn profile scrape). Env var: `APIFY_TOKEN`. (see strategy Phase 2.3)
- [ ] **Agent scheduler edge function:** `supabase/functions/agent-scheduler/index.ts` — dispatches to agents, manages run lifecycle, zombie detection, purges `web_search_cache` entries older than 30 days on each invocation (see strategy Phase 2.4)
- [ ] **Admin Agent Dashboard:** `components/admin/AgentDashboard.tsx` — run history table, manual trigger buttons, API quota bars (Tavily, Brave, Apify credits), pending suggestions count. Add "Agents" tab to Admin.tsx.

### 8. Discovery Agent
**Scope:** New edge function, new migration (`discovered_contacts` table)
**Depends on:** Task 7 (agent infrastructure)
**Effort:** Medium (1-2 days)

- [ ] **Migration:** Create `discovered_contacts` staging table (see strategy Phase 3.1). Required because `profile_suggestions.person_id` is NOT NULL — can't store new contacts there.
- [ ] **Admin UI:** Add "Discovered Contacts" tab in Admin.tsx to review/approve/reject. On approve: create `people` row, delete from `discovered_contacts`. Reuse existing ContactCard component.
- [ ] `supabase/functions/agent-discovery/index.ts` — dual-channel discovery: web search (Tavily/Brave) + LinkedIn search (Apify `harvestapi/linkedin-profile-search`). Gemini extraction for web results, structured mapping for LinkedIn results. Dedup against BOTH `people` AND `discovered_contacts` → insert into `discovered_contacts` (see strategy Phase 3.1)
- [ ] 8 predefined web search queries + 7 LinkedIn-specific queries (university/company filters via Apify)
- [ ] Max 3 web searches + 2 LinkedIn searches per invocation (cost control). Graceful fallback if Apify credits exhausted.

### 9. Verification Agent
**Scope:** New edge function
**Depends on:** Task 7 (agent infrastructure)
**Effort:** Medium (1-2 days)

- [ ] `supabase/functions/agent-verify/index.ts` — LinkedIn-first verification: for contacts with `linkedin_url`, scrape via Apify (`supreme_coder/linkedin-profile-scraper`) and deterministically diff against stored data (no LLM needed). Falls back to web search + `check_profile` LLM if no LinkedIn URL or Apify unavailable. Auto-suggests profile photos from LinkedIn. (see strategy Phase 3.2)
- [ ] Handle edge cases: person left US, career change, LinkedIn profile not found

### 10. Connection Discovery Agent
**Scope:** New edge function
**Depends on:** Task 7 (agent infrastructure)
**Effort:** Small-Medium (0.5-1 day)

- [ ] `supabase/functions/agent-connections/index.ts` — deterministic SQL: colleague (same org), alumni (same flemish_connection), local_peer (same location + sector) (see strategy Phase 3.3)
- [ ] No LLM, no web search — pure SQL

---

## P1 — UX Improvements

### 11. AI Search Quality & Relevance
**Scope:** aiService.ts, UnifiedSearchBar.tsx, DirectoryGrid.tsx
**Effort:** Medium (1-2 days)

Current smart_search extracts keywords then loads ALL people (limit 200) to score client-side. This does not scale.

- [ ] **Move scoring server-side (critical):** Replace `suggestPeople()` client-side scoring with server-side endpoint. After embeddings exist (Task 2), use `suggest-people` edge function. Before embeddings: at minimum move the `scorePersonAgainstKeywords` logic into an RPC or edge function to avoid transferring all person data to the client.
- [ ] **Hybrid search (after embeddings exist):** For NL queries, run BOTH keyword scoring AND embedding similarity. Combine scores: `final = 0.4 * keyword_score + 0.6 * embedding_similarity`. This captures semantic meaning that keywords miss.
- [ ] **Search result snippets:** After NL search, show 1-sentence snippet below each person card explaining WHY they matched (highlight matching bio text or show filter match)
- [ ] **Relevance feedback loop:** Track which search results users click. Log `{ query, person_id, clicked_at }` to a `search_clicks` table. Use to tune scoring weights over time.
- [ ] **Empty state improvement:** When search returns 0 results, suggest: "Try broader terms" or show nearest matches below threshold with "(low relevance)" label

### 12. Interactive Stats Dashboard
**Scope:** Admin.tsx, admin components
**Effort:** Medium (1 day)

- [ ] Make data bars/labels/counts clickable for cross-filtering
- [ ] Click "Finance" in sectors → other charts filter to Finance people only
- [ ] Active cross-filter shown as chip with X to clear
- [ ] "View in Network" link: navigate to Dashboard with filter pre-applied

### 13. Profile Page Clickable Tags
**Scope:** PersonProfile.tsx, OrganizationProfile.tsx
**Effort:** Small (< 0.5 day)

- [ ] Sector tags clickable → Dashboard with sector filter
- [ ] Flemish Connection clickable → Dashboard with connection filter
- [ ] Location clickable → Dashboard centered on city

### 14. Map Improvements
**Scope:** MapVisualization.tsx, ClusterPopover.tsx
**Effort:** Medium (1 day)

Map already uses Leaflet + markercluster. Improvements:

- [ ] Cluster circles scale proportionally to count
- [ ] Click cluster → zoom to show sub-clusters
- [ ] Individual marker popup: name, occupation, org, link to profile
- [ ] Heat density overlay option (toggle on/off)
- [ ] Performance: virtualize marker rendering for > 500 contacts

### 15. Interaction Tracking / Notes
**Scope:** New migration, PersonProfile.tsx, new component
**Effort:** Medium (1 day)

- [ ] `interactions` table: `person_id`, `interaction_type` (email/call/meeting/note/event), `summary`, `interaction_date`
- [ ] InteractionLog component on profile pages: chronological list, "+ Add Note" form
- [ ] "Last contacted: [date]" on person cards in DirectoryGrid

---

## P1 — Operational Readiness

### 16. Performance Optimization
**Scope:** Various frontend files, Supabase queries
**Effort:** Medium (1-2 days)

- [ ] **Pagination:** DirectoryGrid currently loads all contacts. Add cursor-based pagination (50 per page) with "Load more" or infinite scroll.
- [ ] **Query optimization:** Profile queries currently do `.select('*, locations(*)')` — add `.limit()` and index usage analysis via `EXPLAIN ANALYZE`
- [ ] **Bundle size (currently 688kb JS, warns at 500kb):** Audit with `npx vite-bundle-visualizer`. Leaflet + react-leaflet + markercluster are large. Use `React.lazy()` + `Suspense` to code-split: load map only when Dashboard is active, load admin components only when Admin page is active. Add `build.rollupOptions.output.manualChunks` for vendor splitting.
- [ ] **Image lazy loading:** Defer profile photo loads until visible (native `loading="lazy"` on img tags)
- [ ] **Debounce search:** Ensure UnifiedSearchBar debounces API calls (currently may fire on every keystroke for autocomplete)
- [ ] **Memoization:** Wrap expensive computations (scoring, filtering) in useMemo. Wrap stable callbacks in useCallback.
- [ ] **Mobile responsiveness:** MapVisualization, FilterPanel, UnifiedSearchBar, ClusterPopover have no responsive breakpoints. The filter sidebar should collapse into a drawer/modal on mobile. Map should be full-width on small screens.

### 17. Deployment
**Scope:** New Dockerfile, docker-compose.yml, nginx.conf, .env.example
**Effort:** Small (< 0.5 day)

- [ ] **Dockerfile:** Multi-stage build: Node 20 builder → nginx:alpine static server
- [ ] **nginx.conf:** SPA routing (try_files → index.html), gzip, asset caching (1 year for hashed files), no-cache for index.html
- [ ] **docker-compose.yml:** Single frontend service, build args for VITE_* env vars
- [ ] **.env.example:** Document all required env vars with descriptions and where to find them
- [ ] **.dockerignore:** node_modules, dist, .git, .env, .claude

### 18. Documentation & Handover
**Scope:** New docs/ directory
**Effort:** Medium (1 day)

- [ ] **docs/SETUP.md** — Deploy from scratch: Supabase project setup, run migrations, env vars, deploy edge functions, Docker option, initial data import
- [ ] **docs/USER_GUIDE.md** — How to use: search, filter, collections, review AI suggestions, export
- [ ] **docs/AGENTS.md** — Agent system: what each does, manual triggers, scheduling, monitoring costs, quota management
- [ ] **docs/DATA_IMPORT.md** — CSV format spec, handling duplicates, post-import steps (backfill embeddings, assign sectors)
- [ ] **docs/ARCHITECTURE.md** — High-level architecture diagram, data flow, AI pipeline, tech decisions

### 19. Maintainability & Code Quality
**Scope:** Various
**Effort:** Small-Medium (0.5-1 day)

- [ ] **Remove dead code:** Delete unused `generate_migration.js`, `generate_migration.cjs` (one-time scripts already run). Delete `scripts/batch_replace.cjs`. Clean up any remaining Planner references.
- [ ] **Edge function DRY:** Extract shared CORS headers, Gemini call wrapper, and error response builder into `supabase/functions/_shared/` modules
- [ ] **TypeScript coverage:** Run `npm run typecheck` and fix any remaining `any` types in components. Ensure all Supabase query results are properly typed.
- [ ] **Error boundaries:** Add React error boundary around map and AI search components (these depend on external APIs and can fail)
- [ ] **Stale migration cleanup:** The `geocode` edge function still references `people.latitude` and `people.longitude` (dropped in location refactor migration). Fix to use `locations` table via `location_id`.

---

## P1 — Testing, CI/CD & Security

### 25. Testing Strategy
**Scope:** New test setup, new test files
**Effort:** Medium (1-2 days)

No tests exist currently.

- [ ] **Test setup:** Add Vitest (`npm i -D vitest @testing-library/react @testing-library/jest-dom`). Configure in `vite.config.ts`.
- [ ] **Unit tests for critical logic:**
  - `filterParser.ts` — test every keyword mapping, edge cases, combined queries
  - `aiService.ts` — test scoring functions with mock data
  - `csvParser.ts` — test field mapping, dedup logic
  - `supabase.ts` — test `displayName`, `parseTitleFromName`, `personInitials`
- [ ] **Edge function tests:** Add basic request/response tests for each edge function using Deno test runner
- [ ] **Add `npm run test` script** to package.json

### 26. CI/CD Pipeline
**Scope:** New `.github/workflows/` config
**Effort:** Small (< 0.5 day)

- [ ] **GitHub Actions workflow:**
  - On push/PR to main: `npm run typecheck` + `npm run lint` + `npm run build`
  - Fail PR if any step fails
- [ ] **Optional:** Add Supabase CLI migration check (`supabase db diff --linked`)
- [ ] **Optional:** Deploy preview builds for PRs (Vercel/Netlify integration)

### 27. Security Hardening
**Scope:** RLS policies, edge functions, frontend
**Effort:** Medium (1 day)

- [ ] **RLS audit:** All tables currently allow anon INSERT/UPDATE/DELETE — this is a security risk. Before production: lock down write operations to authenticated users at minimum.
- [ ] **Edge function auth:** `search-contacts` and `update-profile` use service role key internally but are callable by anyone with the anon key. Add rate limiting or auth check.
- [ ] **Input validation:** Edge functions do minimal input validation. Add length limits, sanitize SQL-injectable strings.
- [ ] **CORS tightening:** All edge functions use `Access-Control-Allow-Origin: *`. Before production: restrict to the actual frontend domain.
- [ ] **Environment secrets:** Ensure `.env` is in `.gitignore` (check this exists)

---

## P2 — Future Enhancements

### 20. Authentication & Multi-User
**Scope:** Broad — touches every page and component
**Effort:** Large (3-5 days)

- [ ] Enable Supabase Auth (email/password for staff, magic link for professionals)
- [ ] `user_profiles` table: role (admin, staff, viewer, network_member)
- [ ] Update all RLS policies for role-based access
- [ ] `created_by`, `updated_by` audit columns on key tables
- [ ] Profile claiming: network member links auth account to their `people` record

### 21. Network Analysis & Visualization
**Scope:** New component, D3 or vis.js
**Depends on:** Task 10 (connection discovery agent)
**Effort:** Large (2-3 days)

- [ ] Force-directed network graph component
- [ ] Show on profile pages: person's immediate connections
- [ ] Full network view toggle on Dashboard (alongside Map/List)
- [ ] Bridge node identification (people connecting different clusters)

### 22. Geographic Coverage Analysis
**Scope:** Admin components
**Effort:** Medium (1 day)

- [ ] US choropleth/heatmap showing contact density by state
- [ ] Coverage gaps: "15 contacts in Boston, 0 in Houston"
- [ ] Suggest discovery agent searches for underrepresented areas

### 23. Notification System
**Scope:** New migration, Navigation.tsx
**Depends on:** Task 20 (auth)
**Effort:** Medium (1-2 days)

- [ ] In-app notification bell
- [ ] Notification types: new suggestions, agent run complete, stale profiles
- [ ] Optional email digest

### 24. Multi-Language Support (Dutch + English)
**Scope:** All UI components
**Effort:** Large (2-3 days)

- [ ] Extract UI strings to translation files
- [ ] Language toggle in Navigation

---

## Notes

- **suggest-people uses Flash instead of Pro:** The `suggest-people` edge function currently defaults to `gemini-3-flash-preview` for ranking because the API tier doesn't allow Gemini Pro. When upgrading, set `GEMINI_PRO_MODEL=gemini-2.5-pro-preview-05-06` in Supabase secrets (or update the default in `supabase/functions/suggest-people/index.ts`).

---

## Dependency Graph

```
(no deps)    1. Model config refactor
(no deps)    2. Embeddings + vector search
(no deps)    4. Export & briefing
(no deps)    5. Profile pictures
(no deps)    6. DB population pipeline
(no deps)    12-15. UX improvements
(no deps)    16-19. Operational readiness

2 → 3. Suggest-people (needs embeddings)
2 → 11. Hybrid search (needs embeddings)
3+7 merged → 7. Agent infrastructure (includes Apify module)
7 → 8. Discovery agent (uses Apify LinkedIn search + web search)
7 → 9. Verification agent (uses Apify LinkedIn scrape + web search fallback)
7 → 10. Connection agent
9 → 5. Profile photos (verification agent auto-suggests LinkedIn photos)
10 → 21. Network visualization
20 → 23. Notifications
```

**Recommended implementation order:**
1. Tasks 0a-0e (critical bug fixes) — unblock typecheck, fix broken edge functions, clean up console/alert
2. Tasks 1 + 2 (model config + embeddings) — foundation for all AI
3. Tasks 4 + 5 + 6 (export, photos, import) — immediate user value
4. Task 3 (suggest-people) — needs embeddings
5. Tasks 16 + 17 + 19 (performance, deployment, code quality) — ship-readiness
6. Task 7 (agent infrastructure) — foundation for agents
7. Tasks 8 + 9 + 10 (agents) — autonomous enrichment (Task 8 needs `discovered_contacts` migration)
8. Task 18 (documentation) — handover readiness
9. Everything else based on priority
