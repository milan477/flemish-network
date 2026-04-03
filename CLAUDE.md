# Flemish Network Intelligence Platform

## What This Is
A web platform for the Delegation of Flanders to the USA that maps and makes searchable the Flemish professional network across the United States. Replaces fragmented Excel-based tracking with a unified, AI-powered system. Target users: Fayat fellowship coordinators, Flanders Investment & Trade staff, diplomats, and Flemish professionals themselves.

## Recent Notes (2026-04-02)
- Collection "Suggested People" is back on the current embedding stack. `suggest-people` no longer relies only on the older `match_people()` path; it now also consumes `match_person_text_chunks()`, rolls chunk matches back up to candidate people before Gemini reranking, and returns explicit error/message text to the frontend. `CollectionDetail` now includes occupation/bio context in its query seed and shows backend failures instead of silently rendering an empty suggestion state. Dashboard AI search also now surfaces backend search errors inline instead of collapsing to a blank "No results" state.
- Staff auth and role-based access control is live. Migration `20260402153000_staff_auth_access_control.sql` adds `staff_users`, role/status enums, self-service auth RPCs (`can_request_staff_login`, `activate_staff_user_session`), stricter RLS on the main app tables, and staff-only storage policies for `profile-photos`; follow-up migration `20260402170000_make_profile_photos_bucket_private.sql` also flips the bucket itself to `public = false` so photo reads are no longer publicly exposed. The frontend now has `/login`, `/auth/callback`, and `/account`, wraps the app in `AuthProvider`, shows a real account menu in `Navigation`, hides editor-only controls from viewers, and adds an admin-only `Access` tab for managing approved staff users. The remote project `ofzuhajxwxggybkuzefq` has already been migrated and the affected edge functions redeployed; smoke tests confirmed unauthenticated and anon-token calls to `search-people`, `discover-contacts`, and `agent-scheduler` now return `401`. The remote `staff_users` table is currently empty, so the first admin email still needs to be inserted before anyone can complete sign-in.
- Phase 5 cross-cutting model, ops, and evaluation work is live. Migration `20260402103000_phase5_model_ops_metrics.sql` adds the internal `embedding_batch_runs` table plus internal `ops_connection_suggestion_metrics` and an expanded `ops_phase_success_metrics` view covering search benchmark success, discovery source recall/yield, multi-evidence rate, review approval rates, duplicate rate, embedding/location coverage, gap closure, and connection suggestion acceptance. `agent-scheduler` now exposes a privileged `metrics` action, the Admin Agents tab renders a compact `OpsMetricsPanel` showing the current model routes plus those live Phase 5 metrics, and the existing Admin Overview `Embedding Search Index` card now offers an optional offline Gemini Batch API lane alongside the normal queue-based embedding refresh path.
- Shared Gemini model routing now defaults to stable Gemini 2.5 models instead of preview-first fallbacks. `_shared/gemini.ts` now maps `query_parsing` and `page_classification` to `gemini-2.5-flash-lite`, `contact_extraction` and `profile_verification` to `gemini-2.5-flash`, and `lightweight_text_merge` / `offline_evaluation` to `gemini-2.5-pro`, while preview models stay opt-in through explicit per-route env overrides. `discover-contacts` and `suggest-people` now use those shared routes too, so the active stack no longer has stray `gemini-3-flash-preview` defaults.
- `_shared/gemini.ts` now also exposes explicit Gemini context-cache helpers. The current implementation uses them selectively inside `agent-discovery` on repeated extraction retries only, rather than forcing cache creation into every LLM call path. `generate-embeddings` still keeps the queue as the default online refresh mechanism, but can now also start, poll, cancel, and ingest optional async Gemini embedding batches through `embedding_batch_runs`.
- Frontend navigation is now URL-driven instead of in-memory. `react-router-dom` owns top-level routes (`/`, `/people/:id`, `/organizations/:id`, `/collections`, `/collections/:id`, `/admin`, `/admin/:tab`, `/contacts/new`), dashboard view/search/filter/focused-city state is encoded in the query string, admin tabs survive refresh via `/admin/:tab`, and AI search results are cached in `sessionStorage` so going from a search result into a profile and back does not rerun the expensive search in the same browser session. The dashboard also records the last network URL so “Back to directory” and the top nav can return users to their prior network context instead of always resetting to the map.
- Phase 4 labeling, embeddings, and connections is live. Migration `20260401120000_phase4_labeling_embeddings_connections.sql` makes `locations.latitude` / `locations.longitude` nullable, adds `geocode_source` / `geocoded_at`, creates `derived_label_suggestions`, `person_text_chunks`, and `connection_suggestions`, extends `connections` with evidence columns, adds `match_person_text_chunks()`, and expands `discover_connections()` to the hard-edge set `colleague`, `alumni`, `program_peer`, `local_peer`, `lab_peer`, and `event_peer`. Discovery and verification now upsert evidence-bearing derived labels before promotion, Admin renders them through `DerivedLabelsPanel`, discovered-contact review cards show pending label chips, and Person Profile shows soft affinity suggestions from `connection_suggestions` separately from the hard graph. `generate-embeddings` now builds labeled embedding documents plus `bio` / `position` / `combined` chunk vectors via batched Gemini embedding calls, while `search-people` rolls chunk matches back up to people and can use matched chunk text as the snippet. The `geocode` function now accepts both legacy `{pairs}` and pipeline `{candidates}` payloads, parses raw text deterministically, geocodes US candidates, and returns `parser_confidence` plus `review_required`. Production smoke tests after deployment to project `ofzuhajxwxggybkuzefq` confirmed the Phase 4 surfaces end to end: `geocode` returned cached coordinates for `Cambridge, MA`; `agent-verify` upserted 6 derived labels for `Saar Vandenbroucke`; `generate-embeddings` backfill created `person_text_chunks`; `search-people` returned nonzero `chunk_candidates`; `agent-connections` created idempotent `program_peer` / `lab_peer` links and scanned the soft-affinity lane; and one scheduler-triggered `agent-discovery` batch completed through the live orchestration path on 2026-04-01 local time / 2026-04-02 UTC.
- Phase 3 verification unification is live. Migration `20260401100000_phase3_verification_unification.sql` extends `profile_suggestions` with `evidence_url`, `evidence_excerpt`, `confidence`, `method`, `agent_run_id`, and `dedupe_key`, plus supporting indexes for pending-suggestion dedupe, search-click recency, and approved discovery touches. `supabase/functions/_shared/verification.ts` is now the single verification core behind both `update-profile` and `agent-verify`: it centralizes person loading, LinkedIn-first deterministic diffs, web-search + Gemini fallback, field-risk gating, evidence capture, and suggestion dedupe/refresh. The person-side verification modal and admin `SuggestedChanges` queue now consume that same contract and render method/risk/confidence/evidence details instead of the old flat `source` string. Live smoke tests after deployment on 2026-04-01 against project `ofzuhajxwxggybkuzefq` confirmed both paths: `update-profile` returned a `verified` preview payload for `Ms. Aline Aerts`, and `agent-verify` returned the new unified batch payload shape (`suggestions_updated`, `candidate_priorities`, per-step path/status) for the same person.
- Phase 2C discovery compounding is live. Migration `20260401050000_phase2c_discovery_compounding.sql` adds `discovered_contacts.candidate_key`, internal `discovery_entity_pivots` / `discovery_entity_pivot_sources`, and the internal `ops_discovery_entity_pivots` view. `agent-discovery` now merges pending candidates by durable candidate key before falling back to the older identity heuristics, accumulates evidence-backed entity pivots from extracted role/Flemish/page-title signals, and reserves part of each blank-query seeding pass for those proven pivots. `agent-scheduler` also now exposes a privileged `planning` action, and the Admin Agents tab renders a `DiscoveryPlanningPanel` with live gap metrics, accumulated pivots, recent frontier refills, and runnable recommended discovery queries. As of the latest follow-up patch, transient Gemini and fetch failures are treated as retryable upstream errors instead of brittle hard failures: discovery extraction uses a real model chain from `_shared/gemini.ts` even when no fallback env var is set, retries `429`/`5xx`/timeout cases with backoff plus a smaller prompt budget, keeps heuristic classification if LLM classification is deferred, strips control characters like embedded null bytes from fetched page text before persistence, and requeues affected frontier rows as `upstream_retry` instead of recording a hard failure.
- AI review/apply flows now treat `location_city` / `location_state` as suggestion-only fields, not writable `people` columns. `ProfileUpdateModal`, the admin `SuggestedChanges` queue, and the admin chatbot duplicate-merge path now resolve or create a `locations` row and write `people.location_id` instead. The admin suggestion approval flow also no longer marks a suggestion `approved` if the underlying `people` update fails.
- `deno check supabase/functions/agent-discovery/index.ts` is now clean again. Discovery/web-search edge helpers now rely on a local Deno-side Supabase schema shim in `supabase/functions/_shared/database.types.ts`, and `_shared/discovery.ts` explicitly references the DOM libs because the edge-runtime import alone does not give stable `Document`/`DOMParser` typing under `deno check`.
- The shared Deno-side Supabase schema shim in `supabase/functions/_shared/database.types.ts` now also covers the active search, discovery, verification, scheduler, connections, embedding, and single-profile update entrypoints, including the new `discover-contacts` alias, so `deno check` is green across every current `supabase/functions/*/index.ts` file. Because that shim is intentionally lightweight and does not encode relation metadata, joined rows like `locations`, `sectors`, and `person_flemish_connections` should keep being normalized locally inside the edge functions instead of relying on generated relation inference.
- Phase 2B discovery learning is live. Migration `20260401030000_phase2b_discovery_learning.sql` adds gap-aware source-pack targeting (`coverage_target_keys`), domain-yield learning on `discovery_domains`, `discovery_frontier_refills`, metro/state coverage inputs (`metro_areas`, `metro_area_cities`, `coverage_targets`), and internal ops views (`ops_discovery_domain_yield`, `ops_discovery_page_type_mix`, `ops_discovery_coverage_summary`, `coverage_gaps`). `agent-discovery` now revisits due `done` frontier rows, enforces per-domain weekly budgets plus per-run caps, boosts or decays child expansion based on parent/domain yield, and conditionally harvests sitemap/RSS URLs for proven domains. Production smoke tests on 2026-04-01 confirmed both paths: one scheduler-triggered run completed against an existing queued frontier row and surfaced live `gap_targets` in the plan payload, and one custom-query run (`KU Leuven Houston`) seeded 24 new frontier URLs via Tavily and wrote a `search_seed` row into `discovery_frontier_refills`.
- Profile edits no longer fail on `people_search_documents` RLS. Migration `20260401011000_fix_people_search_document_rls.sql` changes the internal search-document sync functions to `SECURITY DEFINER`, so `people` updates from the public client can refresh the lexical search substrate without needing public write policies on the internal table.
- Profile tag edits no longer fail on `embedding_jobs` RLS. Migration `20260401014000_fix_embedding_jobs_rls.sql` changes the internal embedding queue helpers to `SECURITY DEFINER`, so sector/Flemish-connection edits can mark people dirty and enqueue refresh work without needing public write policies on the internal queue table.
- Embedding refresh is now backend-owned instead of browser-owned. Migration `20260331143000_embedding_refresh_queue.sql` adds the internal `embedding_jobs` queue plus `enqueue_*` / `claim_embedding_jobs()` helpers. `generate-embeddings` now enqueues dirty people, claims batches from that queue, and requeues rows if they changed again while a batch was running. Frontend create/edit/import flows only send a best-effort worker kick after commit; they no longer try to generate one embedding per person inline from the browser.
- Production smoke test on 2026-03-31 confirmed the queue works: the first `status_only` run enqueued 518 dirty people, a live worker batch processed 5 with 0 failures, and live `search-people` responses now report non-zero `vector_candidates` / `total_with_embeddings` again.
- Phase 1 search upgrade is live. Migration `20260331120000_phase1_search_upgrade.sql` adds the internal `people_search_documents` lexical substrate, weighted `tsvector` + trigram indexes, and sync triggers across `people`, `person_sectors`, `person_flemish_connections`, `flemish_connections`, and `locations`. The `search-people` edge function now classifies queries into `direct_lookup`, `faceted`, or `exploratory`, retrieves lexical and vector top-K independently, fuses them with reciprocal-rank + exact-name boosts, and generates snippets from the best matching field or bio sentence.
- `npm run benchmark:search` now runs the fixed `benchmark_search_queries_active` set through the live `search-people` edge function. It requires `VITE_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the local environment.
- Admin Overview cards were tightened up on 2026-03-31: the standalone `Availability` and `Connections Summary` cards were removed, the `Locations` card now shows only a ranked city list (no state toggle/drilldown UI), and card subtitles/descriptions were removed so the dense list cards scroll inside the card instead of expanding the whole page.
- Phase 0 benchmark infrastructure is now seeded in Postgres: `benchmark_search_queries` locks the fixed representative search set, `benchmark_discovery_sources` locks the initial discovery source benchmark set, and saved views (`ops_search_benchmark_clicks`, `ops_discovery_review_metrics`, `ops_benchmark_discovery_source_coverage`, `ops_phase_success_metrics`) provide a stable baseline before Phase 1+ changes.
- Benchmark and ops datasets are now locked down from `anon` / `authenticated` reads. They are internal-only database surfaces and should be queried through privileged SQL or a future admin-only backend path, not directly from the public client.
- Discovery review telemetry is now durable. `discovered_contacts` approvals are archived via `status`, `review_outcome`, `reviewed_at`, and `approved_person_id` instead of deleting the row immediately, so approval rate and review-latency metrics survive future search/discovery work. `profile_suggestions.reviewed_at` is also auto-populated on review.
- `supabase/functions/update-profile/index.ts` now runs the shared `check_profile` Gemini contract locally via `supabase/functions/_shared/aiContracts.ts` and `supabase/functions/_shared/gemini.ts` instead of calling `ai-agent` over HTTP. The old edge-to-edge hop was returning empty suggestion sets in production even when the same Tavily + Gemini inputs produced valid suggestions, so single-profile AI Update now uses the shared verification contract directly and returns real errors instead of silently converting them to `suggestions: []`.
- Shared Gemini contract definitions now live in `supabase/functions/_shared/aiContracts.ts`, and shared model-routing / structured-call logic now lives in `supabase/functions/_shared/gemini.ts`. `ai-agent`, `search-people`, and `agent-verify` all read the same `smart_search` and `check_profile` prompts/schemas from those helpers, so prompt drift is no longer possible across those paths.
- `ai-agent` now treats `parse_contacts` and `flemish_search` as frozen legacy tasks: they remain callable for backward compatibility, but only `smart_search`, `merge_text`, and `check_profile` are considered active contracts for product use.
- `AgentDashboard` now routes manual agent runs through `agent-scheduler` instead of writing `agent_runs` and dispatching agent functions directly from the browser. `agent-scheduler` is now the single lifecycle-control path for manual triggers, user cancels, zombie cleanup, and web-search cache housekeeping.
- `agent-scheduler` must forward the caller's function auth headers (`Authorization` / `apikey`) when dispatching downstream agent functions. Using `SUPABASE_SERVICE_ROLE_KEY` as the bearer token for edge-to-edge invocation causes `401` rejections and leaves runs stuck until zombie cleanup marks them failed.
- `AI-strategy.md` documents a full audit of the current AI surface area (search, discovery, verification, connections, updates, embeddings), including what to keep, what to redesign, a recommended model strategy that assumes Google AI Studio Tier 1 access, and a detailed proposal to rebuild discovery around a bounded adaptive frontier crawler with evidence storage, link expansion, domain yield tracking, and geography-aware gap-driven discovery planning.
- `todo.md` is now organized as an execution backlog derived from `AI-strategy.md`; tasks are grouped by roadmap phase and each one includes section references back into the strategy document so future agents can jump to the underlying design notes before implementing.
- Phase 2A discovery foundation is now live. Migration `20260331170000_phase2a_discovery_foundation.sql` adds `discovery_source_packs`, `discovery_frontier`, `discovery_domains`, `discovery_pages`, `discovery_evidence`, and claim/release RPCs. `agent-discovery` now uses search only to seed the frontier, fetches and classifies pages one by one, stores evidence per candidate, and uses LinkedIn only as limited enrichment after a page has already yielded a promising person.
- AI-assisted create, merge, and profile-review flows no longer write `people.flemish_connection` directly. They write the person row without that scalar field, then call `syncPersonFlemishConnectionsAndRequeue()` so normalized `person_flemish_connections` rows and embeddings stay in sync.
- The admin CSV importer now has a real cancel path during the row-write phase. Cancelling requests a stop, waits for the current DB step to finish, then rolls back contacts created in that run and restores the previous scalar fields, sector links, and Flemish connections for any contacts updated earlier in the same run.
- Synthetic importer load-test fixtures now live in `test-csvs/`: `08_large_people_dataset.csv` contains 504 rows, and `09`-`14` are 84-row sector-specific batches. The CSV importer now maps `Sector` / `Sectors` columns directly into `person_sectors`, including multi-value cells, while still keeping the post-import bulk sector assignment control for adding the same sectors to every imported contact.
- Flemish connections are now fully normalized for people: migrations `20260330000000_normalize_flemish_connections.sql`, `20260330000001_refine_flemish_connection_extraction.sql`, and `20260330000002_drop_people_flemish_connection.sql` add `flemish_connections` plus `person_flemish_connections`, backfill existing rows, and remove `people.flemish_connection` entirely.
- Person editing and manual contact creation now use a searchable Flemish-connection selector backed by `flemish_connections`. Users can select multiple existing links or create a new one on the fly with an explicit type (`university`, `government`, `company`, `other`).
- The extractor now prefers real institutions over descriptive prose. Known aliases such as `University of Ghent` -> `UGent`, `Vrije Universiteit Brussel` -> `VUB`, and `imec employee` -> `imec` are canonicalized, while long descriptive phrases are excluded from the normalized join table.
- Dashboard filtering, hybrid search, embeddings, collection suggestion query-building, and admin Flemish-connection charts now read `person_flemish_connections`/`flemish_connections` instead of a text column on `people`. The `discover_connections()` alumni pass and `match_people()` RPC also aggregate from the join table.
- Person and organization profile tags are now navigational: sector chips open the dashboard with the sector filter applied, Flemish connection chips open the matching Flemish filter, and clicking a profile location opens the dashboard map centered on that city while preserving the focused-city list state if the user switches to list view.
- Discovery dedup is stronger now: cross-channel candidates merge on normalized LinkedIn/email/website/name signals before insert, and DB dedup checks `people` and `discovered_contacts` by normalized name, email, LinkedIn URL, and website URL instead of relying on a case-sensitive name lookup.
- Discovery now reports Gemini extraction failures explicitly in `errors`/`steps` and stops burning web-search budget when the current Gemini quota is exhausted, instead of quietly returning zero contacts.
- `supabase/functions/agent-verify/index.ts` now exists. It verifies stale profiles in a LinkedIn-first flow: Apify scrape when `linkedin_url` is present, deterministic field diffing for position/location/bio/photo, then web search + the same Gemini `check_profile` schema locally when LinkedIn is unavailable or missing. The operational default is a 5-profile batch to stay inside the edge timeout.
- Verification can create advisory `profile_suggestions` rows with `field_name = '_status'` and `suggested_value = 'may_have_left_us'` when LinkedIn indicates the person is no longer US-based. These are review-only flags; approving them should not try to write an unknown column onto `people`.
- LinkedIn verification also suggests `profile_photo_url` when the profile has no stored photo and Apify returns one.
- `supabase/functions/agent-connections/index.ts` now exists. It is a pure-SQL agent wrapper around the `discover_connections(text[])` RPC and reports connection runs through `agent_runs` with no LLM or web-search usage.
- Migration `20260328210000_connection_discovery.sql` makes connection discovery idempotent by adding a partial unique index on unordered person-person pairs plus `relationship_type`, so rerunning the agent does not create reverse-direction duplicates.
- The person profile now aggregates `connections` rows by connected person, so one person can surface multiple relationship types (`colleague`, `alumni`, `local_peer`) without inflating the direct-connection count. The `View graph` action opens a modal graph plus a detail list that exposes those type badges.

## Tech Stack
- **Frontend:** React 18 + TypeScript, Vite 5, Tailwind CSS 3, Lucide React (icons)
- **Backend:** Supabase (PostgreSQL + Edge Functions in Deno/TypeScript)
- **Map:** Leaflet + react-leaflet + react-leaflet-cluster (marker clustering)
- **AI:** Google Gemini with stable Gemini 2.5 defaults (`gemini-2.5-flash-lite`, `gemini-2.5-flash`, `gemini-2.5-pro`) plus `gemini-embedding-001`
- **Web Search:** Tavily API (free tier, 1000 calls/mo) with Brave Search fallback via the shared web search module.
- **Geocoding:** Nominatim / OpenStreetMap (cached in `locations` table via `geocode` edge function)
- **Routing:** `react-router-dom` with dashboard/admin state persisted in the URL

## Commands
```bash
npm run dev          # Start Vite dev server (port 5173)
npm run build        # Production build (outputs to dist/)
npm run preview      # Preview production build
npm run lint         # ESLint
npm run typecheck    # TypeScript type checking (tsc --noEmit -p tsconfig.app.json)
npm run benchmark:search  # Run fixed search benchmarks against the live edge function
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
│       ├── AdminChatbot.tsx         # Admin discovery assistant for ad hoc web prospecting
│       ├── DiscoveryPlanningPanel.tsx # Discovery gap/pivot planning surface in the Agents tab
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
├── migrations/                      # Sequential SQL migrations (see Database Schema below)
└── functions/                       # Deno edge functions
    ├── ai-agent/                    # Gemini orchestration (4 tasks: parse_contacts, smart_search, flemish_search, check_profile)
    ├── agent-connections/           # Deterministic colleague/alumni/local-peer discovery
    ├── agent-discovery/             # Web + LinkedIn discovery agent
    ├── agent-scheduler/             # Agent run dispatcher / zombie cleanup
    ├── discover-contacts/           # Ad hoc web discovery for operators (current name)
    ├── agent-verify/                # LinkedIn-first profile verification
    ├── generate-embeddings/         # Batch embedding generation for people
    ├── search-people/               # Hybrid search: keyword extraction + embedding similarity, server-side scoring
    ├── suggest-people/              # Embedding + Gemini ranking for collections
    ├── search-contacts/             # Legacy alias to discover-contacts
    ├── update-profile/              # Web search a person + generate profile suggestions via check_profile
    └── geocode/                     # Nominatim geocoding + locations table caching
scripts/
└── batch_replace.cjs                # One-time migration helper (location column refactor)
public/
├── cities.json                      # US cities dataset (JSON)
└── us_cities.csv                    # US cities dataset (CSV, used for location imports)
```

## Page Routing
The frontend now uses `react-router-dom` with real browser URLs:
```text
/                         dashboard
/people/:personId         person profile
/organizations/:id        organization profile
/collections              collection list
/collections/:id          collection detail
/admin                    admin overview
/admin/:tab               admin sub-tabs (`agents`, `discovered`)
/contacts/new             add-contact page
/login                    magic-link sign-in for approved staff
/auth/callback            session landing page after the Supabase auth redirect
/account                  signed-in staff profile page
```
Dashboard state is encoded in the query string, not component memory. Current params include:
- `view=map|list`
- `q=<search query>`
- `sector=<name>`
- `occupation=<name>`
- repeated `fc=<flemish connection>`
- `city=<filter city>` and `state=<filter state>`
- `people=0`, `organizations=0`, `lectures=1`
- `focusCity=<city>` and `focusState=<state>` for drill-in map/list focus

Navigation callbacks still use `onNavigate(page, id?, preset?)`, but they now map onto routes. Legacy page names (`'directory'`, `'search'`, `'missions'`, `'planner'`) are still aliased to their replacements for older call sites.

## Architecture Decisions
- **React Router owns navigation:** `App.tsx` uses `BrowserRouter` route matching instead of a `currentPage` state machine. Detail-page navigations carry a lightweight `from` route state so in-app back buttons can return to the exact prior screen.
- **Dashboard state is URL + session backed:** the network view reads search/filter/view/focused-city state from query params, and expensive AI search result payloads are cached in `sessionStorage` (`src/lib/dashboardSession.ts`) so refresh/back keeps context without forcing a rerun inside the same browser session.
- **No state management library:** All state via React hooks. Props drilled down from App.tsx.
- **Supabase Auth now gates the app:** the public-facing app shell is gone. Staff sign in through Supabase magic links, then the app loads `public.staff_users` as the authorization source of truth. Role ranking is `viewer < editor < admin`, the login screen checks `can_request_staff_login(email)` before sending OTPs, `activate_staff_user_session()` links the auth user to their approved staff row on first successful sign-in, and the Admin `Access` tab manages the allowlist.
- **AI via edge functions:** All LLM calls go through Supabase Edge Functions. Shared query-parsing and profile-check contracts now live in `supabase/functions/_shared/aiContracts.ts`, with shared Gemini model routing / structured-call logic in `supabase/functions/_shared/gemini.ts`. `ai-agent` remains the generic structured task endpoint, while `search-people`, `agent-verify`, and `update-profile` import the same shared contracts directly. Operator web prospecting now runs through `discover-contacts`, with `search-contacts` kept only as a legacy alias.
- **Locations as separate table:** `people` and `organizations` have `location_id` FK to `locations` table. Old inline `location_city`/`location_state`/`latitude`/`longitude` columns were dropped. Queries use `.select('*, locations(*)')` to join.
- **AI location suggestions are legacy-shaped:** verification and single-profile update suggestions may still arrive as `location_city` / `location_state`, but any frontend write into `people` must translate those into `location_id` first.
- **Types in supabase.ts:** All database entity types (Person, Organization, Collection, etc.), constants, and shared interfaces live in `src/lib/supabase.ts`.
- **Filter parser is deterministic:** `src/lib/filterParser.ts` handles NL-to-filter conversion with keyword matching — no LLM call needed.

## Database Schema (current working-tree state)

### Core Tables
| Table | Key Columns | Notes |
|---|---|---|
| `people` | `id`, `name`, `title`, `first_name`, `last_name`, `current_position`, `organization_id` (FK), `location_id` (FK→locations), `occupation`, `bio`, `profile_photo_url`, `available_for_lectures`, `open_to_mentorship`, `welcomes_visits`, `preferred_contact`, `phone`, `email`, `email_verified`, `linkedin_url`, `website_url`, `twitter_url`, `data_source`, `last_verified_at`, `created_at`, `updated_at` | Main entity. No inline location columns and no scalar `flemish_connection`; Flemish ties are normalized through `person_flemish_connections`. |
| `organizations` | `id`, `name`, `type`, `description`, `logo_url`, `website_url`, `location_id` (FK→locations), `flemish_link`, `created_at`, `updated_at` | No inline location columns. |
| `locations` | `id`, `city`, `state`, `latitude`, `longitude`, `geocode_source`, `geocoded_at` | UNIQUE(city, state). `latitude` / `longitude` are nullable so ambiguous or manually reviewed locations can still be represented before geocoding lands. |
| `sectors` | `id`, `name` (unique) | Seeded: AI, Biotech, Finance, Culture & Arts, Education, Research |
| `connections` | `id`, `from_person_id`, `to_person_id`, `from_organization_id`, `to_organization_id`, `relationship_type`, `strength`, `evidence_url`, `evidence_excerpt`, `evidence_source`, `evidence_key` | Hard graph edges only. Person-person rows are unique per unordered pair + relationship type; current live hard types are `colleague`, `alumni`, `program_peer`, `local_peer`, `lab_peer`, and `event_peer`. |
| `staff_users` | `id`, `user_id` (FK→auth.users), `email`, `full_name`, `avatar_url`, `role`, `status`, `last_sign_in_at`, `created_at`, `updated_at` | App-user auth and authorization table. This is intentionally separate from `people`; app users are not linked to directory contacts. Roles are `viewer`, `editor`, `admin`; statuses are `invited`, `active`, `disabled`. |

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
| `profile_suggestions` | `id`, `person_id` (FK), `field_name`, `current_value`, `suggested_value`, `source`, `status`, `evidence_url`, `evidence_excerpt`, `confidence`, `method`, `agent_run_id`, `dedupe_key` |
| `derived_label_suggestions` | `id`, `person_id` or `discovered_contact_id`, `label_type`, `label_value`, `normalized_value`, `confidence`, `source`, `method`, `evidence_url`, `evidence_excerpt`, `agent_run_id`, `dedupe_key`, `status` |
| `person_text_chunks` | `id`, `person_id` (FK), `chunk_type`, `chunk_index`, `chunk_text`, `embedding`, `created_at`, `updated_at` |
| `connection_suggestions` | `id`, `from_person_id`, `to_person_id`, `suggestion_type`, `confidence`, `strength`, `source`, `evidence_url`, `evidence_excerpt`, `agent_run_id`, `dedupe_key`, `status` |
| `saved_flemish_filters` | `id`, `original_query`, `keywords` (JSONB), `target_fields`, `filter_type`, `usage_count` |
| `search_clicks` | `id`, `query`, `person_id` (FK), `clicked_at`. Tracks which search results users click for relevance feedback. |

### Legacy (still in DB, no longer used in frontend)
| Table | Status |
|---|---|
| `plans`, `plan_actions`, `plan_suggested_people` | Planner feature removed. Tables remain but are unused. |

### RLS Summary
- The main directory app is no longer public. Core reads now require an authenticated active staff session via `is_active_staff()`.
- Writer/admin surfaces are role-gated in SQL using `has_staff_role('editor')` or `has_staff_role('admin')`; `people`, `organizations`, `collections`, discovery review tables, and internal ops tables are no longer writable by `anon`.
- `staff_users` supports self read/update for the signed-in row, while admins can read and manage every approved staff account.
- `person_text_chunks`, `people_search_documents`, embedding queues, and most internal ops/benchmark views stay backend- or staff-only even when frontend features depend on them indirectly through edge functions.
- `storage.objects` for the `profile-photos` bucket is now staff-read / editor-write instead of public-write.

## AI Pipeline (what actually exists)

### Model
Gemini model selection for the shared stack now lives in `supabase/functions/_shared/gemini.ts`, with stable 2.5 production defaults by route. `query_parsing` and `page_classification` default to `gemini-2.5-flash-lite`, `contact_extraction` and `profile_verification` default to `gemini-2.5-flash`, and `lightweight_text_merge` plus `offline_evaluation` default to `gemini-2.5-pro`. Preview Gemini 3.x models are no longer the operational default; use the per-route env overrides only for evaluation lanes. Embeddings still default to `gemini-embedding-001` through `_shared/embeddings.ts`, and switching `GEMINI_EMBEDDING_MODEL` away from that still implies a full re-embed plan.

### Edge Function: `ai-agent`
Central LLM orchestrator. Accepts `{ task, context }`. Uses Gemini structured output (JSON schema) via the shared contract/model helpers in `supabase/functions/_shared/`.

| Task | Purpose | Input Context | Output Schema |
|---|---|---|---|
| `parse_contacts` | Extract contacts from free text. Legacy frozen task. | `{ description, sectors }` | `{ message, contacts[] }` |
| `smart_search` | NL query → keyword arrays for 8 profile fields | `{ query }` | `{ message, keywords: { name[], occupation[], sector[], location_city[], location_state[], current_position[], flemish_connection[], bio[] } }` |
| `flemish_search` | NL query → Flemish-specific keywords. Legacy frozen task. | `{ query }` | `{ message, keywords: { flemish_connection[], bio[] } }` |
| `check_profile` | Compare person data vs web results, suggest updates | `{ person, searchResults }` | `{ suggestions: [{ field_name, current_value, suggested_value, source }] }` |

### Edge Function: `search-people`
Server-side routed hybrid search used by Dashboard NL queries. It now uses a real lexical substrate instead of ad hoc keyword gating.
1. Takes `{ query, max_results }` and attempts Gemini keyword extraction plus query embedding in parallel; if Gemini/embeddings are unavailable it still runs lexical-only search
2. Classifies the query into `direct_lookup`, `faceted`, or `exploratory` using shared routing heuristics in `supabase/functions/_shared/searchRouting.ts`
3. Calls `search_people_lexical()` for lexical top-K from `people_search_documents`, `match_people()` for person-level vector top-K, and `match_person_text_chunks()` for chunk-level vector top-K independently
4. Fuses those ranked lists with reciprocal-rank scoring plus exact-name, field, and matched-chunk boosts
5. Fetches the final person rows plus denormalized search documents, then uses the winning field or chunk text to generate the snippet
6. Returns `{ results, keywords, route, degraded, diagnostics, message, total_with_embeddings }`, with diagnostics including chunk candidate counts

### Edge Function: `discover-contacts`
1. Takes `{ query }` → appends "(flemish/belgian professional)" → calls Tavily (advanced, 10 results)
2. Feeds search results to Gemini for structured extraction
3. Dedup checks against `people` table (email, LinkedIn URL, name)
4. Returns `{ message, contacts[] }` with `is_duplicate` flags
5. `search-contacts` is now only a thin legacy alias that forwards to the same handler

### Edge Function: `update-profile`
1. Takes `{ personId }` or `{ personIds }` → fetches person from DB
2. Searches Tavily for `"{name} {position} {city}"`
3. Runs the shared `check_profile` Gemini contract locally inside the function
4. Returns inline suggestions to `ProfileUpdateModal`; it does not write durable `profile_suggestions` rows

### Edge Function: `agent-discovery`
1. Takes `{ query?, run_id, batch_size? }` and always runs as a bounded frontier batch
2. Seeds `discovery_frontier` from either a custom query, due `discovery_source_packs`, or accumulated evidence-backed entity pivots using the shared Tavily/Brave search module
3. Claims the next 10-20 frontier URLs via `claim_discovery_frontier()`, fetches each page individually, canonicalizes/stores the page in `discovery_pages`, and classifies it heuristically first with optional Gemini fallback for ambiguous pages
4. Runs Gemini structured extraction only on promising pages, writes per-page evidence into `discovery_evidence`, merges new evidence into pending `discovered_contacts` via durable candidate keys plus older identity heuristics, dedups against `people`, and upserts reviewable `derived_label_suggestions` for newly inserted or refreshed candidates
5. Uses Apify LinkedIn search only as limited post-extraction enrichment for already-promising candidates, not as a discovery seed lane
6. Persists evidence-backed entity pivots from organizations/labs/programs/events mentioned in approved or strong-evidence candidates, scores and queues a small set of same-domain child links for future runs, updates `discovery_domains`/frontier state, and writes full telemetry into `agent_runs.results`

### Edge Function: `agent-connections`
1. Takes optional `{ types, run_id, generate_soft_suggestions }`, defaulting to the live hard relationship set plus soft-suggestion generation
2. Calls the `discover_connections()` RPC to compute and insert evidence-backed hard edges directly in Postgres for `colleague`, `alumni`, `program_peer`, `local_peer`, `lab_peer`, and `event_peer`
3. Separately scans chunk-vector similarity to upsert `connection_suggestions` records for soft semantic affinity instead of writing noisy hard graph edges
4. Writes telemetry back to `agent_runs` with per-type hard-edge counts plus `connection_suggestions_upserted`, anchor scan totals, and candidate-pair counts

### Edge Function: `geocode`
1. Takes either legacy `{ pairs: [{ city, state }] }` or pipeline `{ candidates: [{ raw_text, city?, state? }] }` payloads (max 25)
2. Parses raw text deterministically, checks the `locations` cache first, and flags low-confidence or ambiguous cases for review
3. Geocodes likely US candidates through Nominatim with a per-request delay for rate limiting
4. Caches or updates `locations` rows with nullable coordinates plus `geocode_source` / `geocoded_at`
5. Returns structured results including `parser_confidence`, `geocoded`, `review_required`, and the resolved `location_id`

### Edge Function: `generate-embeddings`
1. Maintains person embeddings asynchronously from the server-side `embedding_jobs` queue
2. `status_only` returns the outstanding queue count without processing
3. `backfill: true` reconciles dirty `people` rows into the queue before claiming a batch
4. `kick: true` claims a small batch immediately; frontend save/import flows use this only as a best-effort nudge after commit
5. `action: 'start_batch'` is the optional offline lane: it claims a larger batch, creates an async Gemini Batch API job, persists the manifest in internal `embedding_batch_runs`, and later ingests the returned embeddings back into `people` and `person_text_chunks`
6. `action: 'list_batches' | 'poll_batch' | 'cancel_batch'` lets the admin UI refresh or manage those offline batch runs without exposing the internal table to the public client
7. Each claimed online or offline job reads the latest person + sectors + normalized Flemish connections + location, builds a labeled embedding document, stores the main person embedding plus `person_text_chunks` embeddings, and either deletes or requeues the job depending on whether `embedding_dirty_at` changed again mid-flight

### Frontend AI Functions (in `aiService.ts`)
- `parseContacts(description, sectors)` → calls `ai-agent` parse_contacts
- `discoverContacts(query)` → calls `discover-contacts` for ad hoc operator discovery. `searchContacts()` remains as a compatibility alias in the client helper.
- `smartSearch(query)` → calls `ai-agent` smart_search
- `flemishSearch(query)` → calls `ai-agent` flemish_search
- `hybridSearch(query, maxResults)` → calls `search-people` edge function (server-side hybrid scoring). Primary search path for Dashboard NL queries. Falls back to client-side scoring if edge function fails.
- `suggestPeopleEmbedding(query, options)` → calls `suggest-people` edge function (for collection suggestions)
- `suggestPeople(query)` → client-side keyword scoring fallback (used only when edge functions fail)
- `scorePersonAgainstKeywords(person, keywords)` → weighted field matching (used by fallback path)
- `scorePersonAgainstFilter(person, keywords, fields)` → boolean match
- `logSearchClick(query, personId)` → fire-and-forget insert into `search_clicks` table

### What Does NOT Exist Yet
- The Admin metrics surface is intentionally compact. Detailed benchmark/source drilldowns still live in the underlying internal ops views rather than a heavier bespoke dashboard UI.

### Known Bugs
- **Build size warning:** JS bundle is 688kb (192kb gzipped), above Vite's 500kb warning threshold.
- **25 console.log/error/warn calls in production code:** Across 9 frontend files. Should use a proper logger or remove.
- **9 alert() calls as error handling:** In PersonProfile, OrganizationProfile, CollectionDetail. Should replace with toast/snackbar UI.
- **~~Dashboard NL search loads ALL people:~~** Fixed. Dashboard now uses the routed `search-people` edge function for server-side lexical + vector fusion. The client fallback still exists only as an explicitly degraded 200-row backup if the edge function fails.
- **`@types/leaflet` and `@types/leaflet.markercluster` in dependencies:** Should be in devDependencies in `package.json`.

## Workflow Expectations
- **Always deploy and verify changes end-to-end.** After writing code, run all necessary deployment steps yourself (push migrations with `supabase db push --linked`, deploy edge functions with `supabase functions deploy <name> --project-ref ofzuhajxwxggybkuzefq`, run `npm run typecheck`, `npm run build`, etc.). Do not leave deployment as instructions for the user.
- **Smoke-test after deploying.** After deploying edge functions or migrations, make a quick curl/API call to verify things work. Fix issues immediately if they don't.
- **Run the full loop:** code → typecheck → build → deploy → test. The user expects changes to be live and verified, not just written to disk.
- **Provide manual testing steps for the UI.** After deploying, tell the user exactly how to verify the changes in the browser: which page to go to, which button to click, what they should see. Be specific (e.g., "Go to Admin → scroll to Embedding Search Index → click Generate Embeddings → you should see a progress bar fill up").
- **Document any new environment variables or secrets.** If your code relies on a new env var (e.g., `GEMINI_FLASH_MODEL`), set a default in the code and also tell the user to add it to their `.env` file.
- **Update documentation.** Update this CLAUDE.md file with any new architectural decisions, conventions, or important notes related to your changes. Update a todo item in `todo.md` if the change is related to an existing task, and mark it as done.

## AI Contract Notes
- `update-profile` is the ad hoc single-person preview path only. It returns inline suggestions for `ProfileUpdateModal` and does not write durable `profile_suggestions` rows.
- `agent-verify` owns the durable verification queue. Admin stale-contact verification should call `agent-verify`, and reviewer UIs should treat `profile_suggestions` as batch-verification output rather than modal draft state.
- `derived_label_suggestions` is the review queue for canonical sectors, occupations, Flemish entities, US locations, source quality, and profile confidence. Promote those labels first, then refresh embeddings if the canonical profile changed.
- `agent-scheduler` owns manual `agent_runs` lifecycle writes for dashboard-triggered agents. The admin UI should not insert/update `agent_runs` directly for run start, cancel, timeout, or housekeeping behavior.
- `connection_suggestions` is soft affinity only. Do not write semantic-nearness guesses into `connections`; only evidence-backed hard relationship types belong in the graph.
- Public join tables like `person_sectors` and `person_flemish_connections` currently expose insert/delete policies but not update policies. When client code needs idempotent writes there, use conflict-ignore insert semantics (`ignoreDuplicates`) instead of update-style upserts.

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
- `GEMINI_FLASH_MODEL` (optional override; default production workhorse is `gemini-2.5-flash`)
- `GEMINI_FLASH_LITE_MODEL` (optional override; default low-cost routing/classification model is `gemini-2.5-flash-lite`)
- `GEMINI_PRO_MODEL` (optional override; default high-judgment merge/evaluation model is `gemini-2.5-pro`)
- `GEMINI_QUERY_MODEL`, `GEMINI_QUERY_FALLBACK_MODEL` (optional per-route overrides for search parsing)
- `GEMINI_CLASSIFICATION_MODEL`, `GEMINI_CLASSIFICATION_FALLBACK_MODEL` (optional per-route overrides for discovery page classification)
- `GEMINI_EXTRACTION_MODEL`, `GEMINI_EXTRACTION_FALLBACK_MODEL` (optional per-route overrides for structured extraction)
- `GEMINI_PROFILE_MODEL`, `GEMINI_PROFILE_FALLBACK_MODEL` (optional per-route overrides for verification)
- `GEMINI_MERGE_MODEL`, `GEMINI_MERGE_FALLBACK_MODEL` (optional per-route overrides for text merge / reconciliation)
- `GEMINI_EVAL_MODEL`, `GEMINI_EVAL_FALLBACK_MODEL` (optional per-route overrides for offline reranking/evaluation)
- `GEMINI_EMBEDDING_MODEL` (optional; defaults to `gemini-embedding-001` and should only be changed with a full re-embed plan)
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (required for DB access in edge functions)
- `TAVILY_API_KEY` (primary web search provider for discover-contacts, update-profile, and agent-discovery)
- `BRAVE_API_KEY` (optional fallback provider used by the shared web search module)
- `APIFY_TOKEN` (used by discovery and verification agents for LinkedIn search/scrape)

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
- **Flemish Connection:** A person's tie to Flanders — could be a university (KU Leuven, UGent, VUB, UAntwerp), fellowship (BAEF, Fayat), organization (imec), or city. Stored in normalized `flemish_connections` plus `person_flemish_connections`, not as a text column on `people`.
- **Sectors:** Broad fields (Artificial Intelligence, Biotechnology, Finance, Culture & Arts, Education, Research). Stored in `sectors` table, linked via `person_sectors` junction.
- **Occupation:** Career stage category (Student, Academic/Researcher, Professional, Executive/Leadership). Single text field on `people`.
- **Derived Labels:** Reviewable AI-proposed tags for sectors, occupation, Flemish entities, US location, source quality, and profile confidence. Stored in `derived_label_suggestions` before optional promotion into canonical fields/tables.
- **Connection Suggestions:** Soft semantic affinity proposals kept out of the hard graph. Stored in `connection_suggestions` and reviewed separately from `connections`.
- **Collections:** Named groups of contacts for a specific purpose (e.g., "Contacts for LA Trade Mission"). Replaced the old Missions/Planner system.
- **Profile Suggestions:** AI-generated field update proposals stored in `profile_suggestions`, reviewed via admin panel (approve/reject).
