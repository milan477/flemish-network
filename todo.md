# Flemish Network Platform — AI Strategy TODO

This backlog replaces the old generic wishlist. It is derived from `AI-strategy.md` and follows the roadmap order from that document.

Working rule for every task:
- finish the relevant validation/deploy loop for the area you touched (`npm run typecheck`, `npm run build`, `supabase db push --linked`, deploy changed edge functions, and smoke-test the affected UI/API flow)
- read the `Strategy refs` line before implementation so the exact rationale and design detail comes from `AI-strategy.md`, not from this summary

## UX Hardening

- [x] Convert frontend navigation from in-memory page state to real routes and persistent dashboard URL state.
  Do: replace the `currentPage` state machine with browser routes, make dashboard search/filter/view context refresh-safe via query params, preserve expensive AI search results across profile/detail navigation in the same session, and make admin subtabs/addressable detail pages survive refresh and back/forward correctly.
  Update (2026-04-01): Added `react-router-dom` routes for the dashboard, people, organizations, collections, admin tabs, and add-contact flow. Dashboard state now serializes into the URL, admin tabs use `/admin/:tab`, and session-backed search caching plus smart back-navigation preserve context when moving into profile/detail pages and back.
  Repo touchpoints: `src/App.tsx`, `src/main.tsx`, `src/pages/Dashboard.tsx`, `src/pages/Admin.tsx`, `src/components/Navigation.tsx`, `src/lib/appRouting.ts`, `src/lib/dashboardSession.ts`.

- [x] Add staff-only authentication, account management, and role gates for the application shell.
  Do: require approved staff sign-in before the app loads, add a self-service account page, separate app-user auth from directory contacts, gate editor/admin tools in both the UI and the backend, and remove public access to internal edge functions and storage writes.
  Update (2026-04-02): Added `public.staff_users` plus auth RPCs and tighter RLS in migration `20260402153000_staff_auth_access_control.sql`; wrapped the frontend in `AuthProvider`; added `/login`, `/auth/callback`, and `/account`; turned the top-right nav avatar into a real account menu; hid viewer-ineligible editing controls across collections/profile/admin surfaces; and deployed staff-role checks into the live edge functions (`search-people`, `geocode`, `ai-agent`, `discover-contacts`, `search-contacts`, `suggest-people`, `update-profile`, `agent-verify`, `agent-scheduler`, `agent-discovery`, `agent-connections`, `generate-embeddings`). Remote smoke tests confirmed those endpoints now reject unauthenticated and anon-token requests with `401`, and the linked project’s `staff_users` table is live but still needs the first admin email inserted before anyone can sign in.
  Repo touchpoints: `src/lib/auth.tsx`, `src/pages/Login.tsx`, `src/pages/AuthCallback.tsx`, `src/pages/Account.tsx`, `src/App.tsx`, `src/components/Navigation.tsx`, `src/pages/Admin.tsx`, `src/components/admin/AccessManagementPanel.tsx`, `supabase/migrations/20260402153000_staff_auth_access_control.sql`, `supabase/functions/_shared/auth.ts`, role-gated edge functions.
  Strategy refs: follow-up security hardening task; not derived from `AI-strategy.md`.

## Phase 0 — Contract Cleanup

- [x] Remove dead `people.flemish_connection` writes from every AI-assisted create, merge, and review flow.
  Do: stop writing a scalar `flemish_connection` onto `people`; create/update the person row, normalize via `syncPersonFlemishConnections()`, and regenerate or requeue embeddings after the normalized links change.
  Repo touchpoints: `src/components/admin/AdminChatbot.tsx`, `src/components/admin/DiscoveredContactsPanel.tsx`, `src/components/ProfileUpdateModal.tsx`, `src/components/admin/ContactCard.tsx`, `src/lib/flemishConnectionSync.ts`.
  Strategy refs: `AI-strategy.md` §Critical Findings -> `1. Data-contract drift is breaking AI flows` (line 50), §Immediate Fixes -> `P0.1 Fix all broken flemish_connection writes` (line 272), §What To Remove Or Rename (line 1398), §Roadmap -> `Phase 0: Contract Cleanup` (line 1409).

- [x] Fix the ad hoc profile-update contract and make the modal/API behavior consistent.
  Do: pick one contract and implement it end to end. Preferred path: the single-person modal gets preview suggestions directly, while batch verification owns the durable `profile_suggestions` queue.
  Update (2026-03-31): `update-profile` now runs the shared `check_profile` contract locally instead of calling `ai-agent` over HTTP. That edge-to-edge hop was silently returning empty suggestion arrays in production, so the modal path now uses the same shared Gemini contract/model helpers directly and surfaces real upstream failures.
  Update (2026-04-01): the lightweight Deno-side Supabase schema shim in `supabase/functions/_shared/database.types.ts` now covers `update-profile`, `agent-verify`, `search-people`, `search-contacts`, `discover-contacts`, `generate-embeddings`, `agent-scheduler`, and `agent-connections`, and `deno check` is green for every current function entrypoint. Nested relation selects still normalize joined rows locally inside those functions because the shim intentionally does not carry full generated relationship metadata.
  Update (2026-04-01): frontend approval/apply flows now also respect the post-location-refactor contract. `ProfileUpdateModal`, admin `SuggestedChanges`, and the admin chatbot merge flow translate `location_city` / `location_state` suggestions into `people.location_id` writes instead of trying to update dropped columns, and the durable suggestion queue no longer marks rows approved if the `people` write fails.
  Repo touchpoints: `src/components/ProfileUpdateModal.tsx`, `supabase/functions/update-profile/index.ts`, `supabase/functions/agent-verify/index.ts`, the suggestions UI in Admin and Person Profile.
  Strategy refs: §Critical Findings -> `4. Verification and updates are duplicated and partly disconnected` (line 130), §Immediate Fixes -> `P0.2 Unify the profile-update contract` (line 293), §Verification And Updates Strategy -> `1. Collapse update-profile into the verification system` (line 1130), §Roadmap -> `Phase 0: Contract Cleanup` (line 1409).

- [x] Route agent triggering through one orchestration path.
  Do: either make `AgentDashboard` always trigger work via `agent-scheduler`, or remove the scheduler entirely. Lifecycle control, zombie cleanup, run claiming, and telemetry should live in one path only.
  Repo touchpoints: `src/components/admin/AgentDashboard.tsx`, `supabase/functions/agent-scheduler/index.ts`, `agent_runs` writes in agent functions and UI triggers.
  Strategy refs: §Critical Findings -> `5. Several "agent" pieces are not really operating as an agent system` (line 161), §Immediate Fixes -> `P0.3 Use one orchestration path` (line 304), §Roadmap -> `Phase 0: Contract Cleanup` (line 1409).

- [x] Centralize shared prompts, schemas, and model-selection rules.
  Do: move query parsing, profile-check schemas, and model routing into shared helpers used by `ai-agent`, `search-people`, and `agent-verify`; remove or freeze unused `ai-agent` tasks unless they have a live product call site.
  Repo touchpoints: `supabase/functions/ai-agent/index.ts`, `supabase/functions/search-people/index.ts`, `supabase/functions/agent-verify/index.ts`, `supabase/functions/_shared/`.
  Strategy refs: §Critical Findings -> `6. The centralized ai-agent function is not actually central` (line 177), §Immediate Fixes -> `P0.4 Remove prompt duplication` (line 318), §What To Remove Or Rename (line 1398), §Roadmap -> `Phase 0: Contract Cleanup` (line 1409).

- [x] Lock in benchmark datasets and success metrics before Phase 1 starts.
  Do: create a fixed search query set, benchmark discovery sources, and saved metrics queries so every later phase can be measured against the same baseline.
  Update (2026-03-31): Added seeded `benchmark_search_queries` and `benchmark_discovery_sources` tables, durable review telemetry on `discovered_contacts` / `profile_suggestions`, and saved ops views (`ops_search_benchmark_clicks`, `ops_discovery_review_metrics`, `ops_benchmark_discovery_source_coverage`, `ops_phase_success_metrics`) to establish a stable pre-Phase-1 baseline.
  Repo touchpoints: admin analytics queries/views, benchmark fixtures/docs, `search_clicks`, `agent_runs`, discovery review metrics.
  Strategy refs: §Search Strategy -> `Scope` (line 417), §Discovery Strategy -> `Suggested discovery metrics for geographic coverage` (line 1007), §Success Metrics (line 1469).

## Phase 1 — Search Upgrade

- [x] Build a denormalized lexical search substrate for people.
  Do: add a `people_search_documents` table or materialized view that combines name, role, bio, occupation, normalized Flemish connections, sectors, and location text; add `tsvector` and any trigram-friendly fields/indexes needed for lexical retrieval.
  Update (2026-03-31): Added the internal `people_search_documents` table with denormalized people/location/sector/Flemish-connection text, trigram + `tsvector` indexes, and sync triggers/functions so inserts and updates stay searchable without manual refresh jobs.
  Repo touchpoints: new migration(s), search SQL/RPC, `supabase/functions/search-people/index.ts`.
  Strategy refs: §Search Strategy -> `1. Add a lexical retrieval layer` (line 346), §Search Strategy -> `Scope` (line 417), §Roadmap -> `Phase 1: Search Upgrade` (line 1420).

- [x] Replace candidate gating with lexical + vector fusion ranking.
  Do: retrieve lexical top K and vector top K separately, add exact/trigram boosts, and use reciprocal-rank or normalized weighted fusion instead of the current narrow candidate gate.
  Update (2026-03-31): `search-people` now pulls lexical candidates from `search_people_lexical()` and vector candidates from `match_people()` independently, then fuses them with reciprocal-rank scoring plus exact-name, field, and name-similarity boosts instead of manual `ilike` gating.
  Repo touchpoints: `supabase/functions/search-people/index.ts`, `match_people()`-related SQL/migrations, any search ranking helpers.
  Strategy refs: §Search Strategy -> `2. Switch from candidate gating to rank fusion` (line 367), §Roadmap -> `Phase 1: Search Upgrade` (line 1420).

- [x] Add query routing for direct lookup, faceted search, and exploratory semantic search.
  Do: classify each query and change retrieval order and weights per route instead of pushing every query through the same pipeline.
  Update (2026-03-31): Added shared search-route classification (`direct_lookup`, `faceted`, `exploratory`) plus route-specific lexical/vector top-K, fusion weights, and benchmarkable route diagnostics in the live function response.
  Repo touchpoints: `supabase/functions/search-people/index.ts`, shared query parsing/router helpers.
  Strategy refs: §Search Strategy -> `3. Add query routing` (line 382), §Roadmap -> `Phase 1: Search Upgrade` (line 1420).

- [x] Rewrite snippets so they come from the best matching field, chunk, or evidence sentence.
  Do: pick snippets from lexical field hits, matched bio chunks, or evidence text instead of defaulting to generic bio output.
  Update (2026-03-31): Search results now prefer lexical field hits or the best matching bio sentence, and the Dashboard dedupes exact-name matches from fused AI results so snippets surface only on the non-duplicate search section.
  Repo touchpoints: `supabase/functions/search-people/index.ts`, future chunk/evidence tables.
  Strategy refs: §Search Strategy -> `4. Improve snippets` (line 396), §Embeddings Strategy -> `2. Add bio-chunk vectors` (line 1270), §Roadmap -> `Phase 1: Search Upgrade` (line 1420).

- [x] Remove weak fallback assumptions and validate the new stack against the fixed benchmark set.
  Do: demote the 200-row client-side fallback mentality, run the representative query set before/after the changes, and compare with click data and the success metrics dashboard.
  Update (2026-03-31): The client fallback is now explicitly marked as degraded and limited, `npm run benchmark:search` runs the fixed benchmark query set through the live edge function, and live validation on production data confirmed the new direct/faceted/exploratory routes even though several seeded benchmark queries currently have zero matching records in the dataset.
  Repo touchpoints: `src/lib/aiService.ts`, dashboard search flow, analytics queries.
  Strategy refs: §Search Strategy -> `What To Scrap` (line 406), §Search Strategy -> `Scope` (line 417), §Success Metrics (line 1469).

## Phase 2A — Discovery Redesign Foundation

- [x] Rebuild discovery around a persistent frontier.
  Do: add `discovery_frontier` plus supporting domain/page state so discovery persists across runs with statuses, priorities, budgets, revisit timestamps, content hashes, and extraction outcomes.
  Update (2026-03-31): Added `discovery_frontier`, `discovery_domains`, `discovery_pages`, and batch claim/release RPCs so discovery now persists URL/domain/page state across runs with priority, depth, revisit timing, fetch outcomes, and content hashes instead of resetting every run.
  Repo touchpoints: new migration(s), `supabase/functions/agent-discovery/index.ts`, `supabase/functions/agent-scheduler/index.ts`, `agent_runs`.
  Strategy refs: §Discovery Strategy (line 428), `1. Turn discovery into a bounded frontier crawler` (line 473), `Implementation Shape` (line 1065), `Scope` (line 1090), §Roadmap -> `Phase 2: Discovery Redesign` (line 1431).

- [x] Define source packs for head coverage.
  Do: create configurable source packs with domains, query templates, refresh cadence, and extraction expectations for BAEF, universities, labs, team pages, event rosters, associations, and similar high-yield source families.
  Update (2026-03-31): Added seeded `discovery_source_packs` for BAEF, Flemish universities, imec/Flemish orgs, labs/research groups, and events/associations, including query templates, expected page types, cadence, and priority boosts used by the discovery runner.
  Repo touchpoints: discovery config tables/files, `agent-discovery`, scheduler/admin controls.
  Strategy refs: §Discovery Strategy -> `2. Use three discovery lanes, not one` (line 529), §Roadmap -> `Phase 2: Discovery Redesign` (line 1431).

- [x] Make search seed the frontier instead of acting as the extraction substrate.
  Do: save Tavily/Brave results as frontier URLs/domains and stop doing mainline extraction from merged search result blobs.
  Update (2026-03-31, amended 2026-04-01): `agent-discovery` now uses the shared web search layer only to create frontier seeds from search results; extraction happens only after the run claims and fetches individual pages. Shared discovery/web-search helpers now also carry a local Deno-side Supabase schema shim plus explicit DOM lib references so `deno check supabase/functions/agent-discovery/index.ts` stays green.
  Repo touchpoints: `supabase/functions/_shared/webSearch.ts`, `supabase/functions/agent-discovery/index.ts`.
  Strategy refs: §Discovery Strategy -> `3. Search should seed the frontier, not be the frontier` (line 581), `4. Extract per page, not from a merged search blob` (line 605).

- [x] Add per-page fetch, canonicalization, and cheap page classification.
  Do: fetch pages individually, canonicalize URL/content, store page records, and classify page type with deterministic heuristics first and low-cost model help only when rules are ambiguous.
  Update (2026-03-31): Added shared page fetch/canonicalization helpers, page text/title/link extraction, heuristic page classification, and low-cost Gemini fallback for ambiguous pages, with page records stored in `discovery_pages`.
  Repo touchpoints: discovery fetch/classification helpers, `agent-discovery`, new `discovery_pages` data.
  Strategy refs: §Discovery Strategy -> `4. Extract per page, not from a merged search blob` (line 605), `5. Classify pages cheaply before running expensive extraction` (line 626), `Implementation Shape` (line 1065).

- [x] Store discovery evidence as first-class records.
  Do: add evidence rows carrying source URL, title, type, excerpt, raw location/Flemish/role text, confidence, parent URL, discovered-via reason, and fetch time; allow multiple evidence rows per candidate.
  Update (2026-03-31): Added `discovery_evidence`, evidence-aware discovered-contact fields, page-level extraction with excerpts/raw text/confidence, and admin review UI that shows evidence snippets per pending discovery candidate.
  Repo touchpoints: `discovered_contacts`, new `discovery_evidence` table, admin review UI.
  Strategy refs: §Discovery Strategy -> `9. Store evidence, not just final fields` (line 737), §Roadmap -> `Phase 2: Discovery Redesign` (line 1431).

- [x] Move LinkedIn to enrichment-only use inside discovery.
  Do: stop using LinkedIn search as the primary top-of-funnel channel; use it after a page or person is already promising to enrich role/location/photo/profile URL and to support verification.
  Update (2026-03-31): Removed LinkedIn from the top-of-funnel discovery lane. Discovery now uses Apify only as a limited enrichment step for already-extracted promising candidates that are missing LinkedIn/profile detail.
  Repo touchpoints: `supabase/functions/agent-discovery/index.ts`, `supabase/functions/agent-verify/index.ts`, Apify integration.
  Strategy refs: §Discovery Strategy -> `11. Use LinkedIn as enrichment, not as the main discovery engine` (line 809), `Scope` (line 1090), §Roadmap -> `Phase 2: Discovery Redesign` (line 1431).

- [x] Run discovery as small scheduled batches with bounded budgets.
  Do: claim the next 10-20 frontier URLs, process them, update domain/page state, enqueue the best next links only, and release the batch cleanly instead of treating discovery as a one-shot prompt run.
  Update (2026-03-31): Discovery runs now seed when needed, claim a bounded batch from the frontier, fetch/classify/extract page by page, queue the best child links, and release unfinished claimed rows back to the queue if a run times out.
  Repo touchpoints: `supabase/functions/agent-scheduler/index.ts`, `supabase/functions/agent-discovery/index.ts`, frontier/domain/page tables, `agent_runs`.
  Strategy refs: §Discovery Strategy -> `Implementation Shape` (line 1065), `1. Turn discovery into a bounded frontier crawler` (line 473), `6. Expand links selectively, not blindly` (line 662).

## Phase 2B — Discovery Expansion, Coverage, and Yield Learning

- [x] Add selective child-link expansion and hard crawl budgets.
  Do: score outgoing links, follow only promising children, enforce max depth/per-domain/per-run budgets, and expand aggressively only when the parent page yielded a candidate or strong person-like signals.
  Update (2026-04-01): `claim_discovery_frontier()` now enforces per-run/per-domain limits and weekly domain budgets, due `done` frontier rows can be revisited, and child-link scoring now penalizes pagination/nav noise while boosting strong parent pages and proven domains before queuing only the highest-value children.
  Repo touchpoints: `agent-discovery`, frontier tables, page/domain telemetry.
  Strategy refs: §Discovery Strategy -> `6. Expand links selectively, not blindly` (line 662), `1. Turn discovery into a bounded frontier crawler` (line 473), `Scope` (line 1090).

- [x] Teach discovery which domains deserve budget.
  Do: track per-domain fetches, promising pages, approvals, rejections, duplicates, evidence quality, and last approved contact date; use those metrics to set revisit cadence and decay low-yield domains.
  Update (2026-04-01): Migration `20260401030000_phase2b_discovery_learning.sql` adds derived domain-yield tracking on `discovery_domains` plus `ops_discovery_domain_yield`; triggers now refresh per-domain fetch/promising/approval/rejection/evidence stats automatically, duplicates are counted from live discovery runs, and yield score now drives weekly budget plus revisit interval.
  Repo touchpoints: `discovery_domains`, scheduler/discovery scoring logic, admin analytics.
  Strategy refs: §Discovery Strategy -> `7. Use domain yield learning so the crawler gets smarter over time` (line 695), `Scope` (line 1090), §Success Metrics (line 1469).

- [x] Add sitemap and RSS harvesting for proven domains.
  Do: once a domain has shown yield, seed the frontier from `sitemap.xml`, RSS/Atom, and obvious directory/news pages instead of relying on deeper random crawling.
  Update (2026-04-01): Shared discovery helpers can now harvest same-domain URLs from `sitemap.xml` / sitemap indexes and common RSS/Atom feeds, and `agent-discovery` uses those harvesters only for proven domains with remaining budget, recording each refill in `discovery_frontier_refills`.
  Repo touchpoints: discovery fetch helpers, frontier seeding, domain-yield policy.
  Strategy refs: §Discovery Strategy -> `8. Add sitemap and RSS harvesting for proven domains` (line 718), `Scope` (line 1090).

- [x] Make discovery coverage tracking first-class.
  Do: persist and surface frontier size, queued/fetched/ignored counts, high-yield and exhausted domains, page-type mix, duplicates, average evidence count per candidate, frontier refills, and revisit latency.
  Update (2026-04-01): Added `discovery_frontier_refills` plus internal ops views `ops_discovery_coverage_summary` and `ops_discovery_page_type_mix`; live smoke tests now confirm run payloads and SQL views expose frontier size, refill events, yield buckets, duplicates, evidence density, and revisit latency.
  Repo touchpoints: `agent_runs`, discovery tables/views, admin analytics.
  Strategy refs: §Discovery Strategy -> `12. Coverage tracking must become first-class` (line 829), `18. Suggested discovery metrics for geographic coverage` (line 1007), §Success Metrics (line 1469).

- [x] Build geographic coverage inputs and gap scoring.
  Do: add metro mapping, `coverage_targets`, and `coverage_gaps` so approved/pending/verified counts, sector mix, recent activity, expected coverage, and gap score can be computed by state and metro.
  Update (2026-04-01): Added `metro_areas`, `metro_area_cities`, `coverage_targets`, and the internal `coverage_gaps` view so the system now computes approved/pending/verified counts, sector mix, recent activity, expected coverage, and ranked gap score for seeded priority states and metros.
  Repo touchpoints: new migration/views, locations/geography mapping, admin reporting.
  Strategy refs: §Discovery Strategy -> `13. Add geographic coverage intelligence and gap-seeking` (line 854), `14. Gap detection should be based on expected presence, not just low counts` (line 891), `17. Suggested data model for geographic coverage` (line 974).

- [x] Feed gap scores back into discovery planning.
  Do: bias frontier revisits, source pack refresh order, and seed generation toward undercovered but high-expected metros/sectors instead of repeating naive geography queries.
  Update (2026-04-01): `agent-discovery` now loads top `coverage_gaps`, uses them to reprioritize source packs, decorates source-pack seed queries with undercovered metro/sector context, and records the selected gap targets in the run plan/results so operators can see which gaps influenced discovery.
  Repo touchpoints: scheduler/discovery planner, frontier priority scoring.
  Strategy refs: §Discovery Strategy -> `15. Geographic gaps should steer the frontier and the search planner` (line 925), `16. Add a discovery-planning surface for operators` (line 953).

## Phase 2C — Discovery Compounding and Operator Tooling

- [x] Add entity-pivot discovery from approved contacts and strong evidence.
  Do: generate follow-up frontier seeds from organizations, labs, fellowships, advisory boards, events, and co-mentioned institutions that already carry evidence, never from vague model summaries.
  Update (2026-04-01): Migration `20260401050000_phase2c_discovery_compounding.sql` adds internal `discovery_entity_pivots` plus `discovery_entity_pivot_sources`, and `agent-discovery` now derives evidence-backed pivot entities from extracted role/Flemish/page-title signals, persists them with source URLs and seed queries, and automatically reserves blank-query seed slots for high-priority approved or strong-evidence pivots before marking those pivots as seeded.
  Repo touchpoints: approval flows, `agent-discovery`, frontier seeding.
  Strategy refs: §Discovery Strategy -> `10. Add entity-pivot discovery` (line 779), `2. Use three discovery lanes, not one` (line 529), `Scope` (line 1090).

- [x] Improve multi-page candidate merging so evidence can accumulate over time.
  Do: merge mentions across pages into one candidate strength profile instead of inserting thin one-page records that reviewers have to reconstruct manually.
  Update (2026-04-01): `discovered_contacts` now carries a durable `candidate_key`, frontier extraction computes that key from hard identity fields or a name-plus-entity signal, and pending discovery merges now look up by that key before falling back to email/LinkedIn/website/name heuristics. Evidence and pivot sources therefore accumulate onto one staged candidate across multiple pages instead of fragmenting into repeated thin rows.
  Repo touchpoints: discovery merge logic, `discovered_contacts`, `discovery_evidence`, admin review UI.
  Strategy refs: §Discovery Strategy -> `9. Store evidence, not just final fields` (line 737), `Scope` (line 1090).

- [x] Build an operator-facing discovery planning panel in Admin.
  Do: show state/metro coverage, top undercovered metros, gap score, recent discovery activity, and recommended next actions such as frontier expansion or source-pack refreshes.
  Update (2026-04-01): `agent-scheduler` now exposes a privileged `planning` action that reads the internal coverage/yield/pivot views with the service role, and the Agents tab now renders a `DiscoveryPlanningPanel` with frontier summary metrics, top undercovered metros, priority states, accumulated entity pivots, recent frontier refills, and one-click recommended discovery queries.
  Repo touchpoints: admin pages/components, coverage views, scheduler trigger UI.
  Strategy refs: §Discovery Strategy -> `16. Add a discovery-planning surface for operators` (line 953), `13. Add geographic coverage intelligence and gap-seeking` (line 854), `17. Suggested data model for geographic coverage` (line 974).

- [x] Rename or fold `search-contacts` into the discovery system.
  Do: stop presenting web prospecting as directory search; either rename the endpoint/UI to `discover-contacts` or absorb it fully into the frontier-based discovery pipeline.
  Update (2026-04-01): Added `supabase/functions/discover-contacts/` backed by shared `_shared/discoverContacts.ts`, switched `src/lib/aiService.ts` and the admin chatbot UI copy to `discover-contacts`, and left `search-contacts` as a thin legacy alias so older call sites keep working while the product surface now speaks in discovery terms instead of directory-search terms.
  Repo touchpoints: `supabase/functions/search-contacts/index.ts`, `supabase/functions/discover-contacts/index.ts`, `src/lib/aiService.ts`, admin UI labels/docs.
  Strategy refs: §What To Remove Or Rename (line 1398), §Discovery Strategy (line 428).

## Phase 3 — Verification Unification

- [x] Build one shared verification core for modal and batch modes.
  Do: move single-person review and scheduled verification onto the same core pipeline with shared fetching, deterministic diffs, evidence capture, dedupe, and model usage.
  Update (2026-04-01): Added `supabase/functions/_shared/verification.ts` as the single verification engine. `update-profile` now runs a preview-only pass through that shared core, while `agent-verify` uses the same fetch/diff/evidence/dedupe path for durable queue creation and verification bookkeeping.
  Repo touchpoints: `supabase/functions/update-profile/index.ts`, `supabase/functions/agent-verify/index.ts`, `src/components/ProfileUpdateModal.tsx`.
  Strategy refs: §Verification And Updates Strategy -> `1. Collapse update-profile into the verification system` (line 1130), `Scope` (line 1192), §Roadmap -> `Phase 3: Verification Unification` (line 1448).

- [x] Add evidence-bearing fields to `profile_suggestions`.
  Do: extend the table/UI with `evidence_url`, `evidence_excerpt`, `confidence`, `method`, `agent_run_id`, and `dedupe_key`, then show that evidence in the reviewer workflow.
  Update (2026-04-01): Migration `20260401100000_phase3_verification_unification.sql` adds the evidence/dedupe columns plus supporting indexes. The shared verification core now persists those fields for batch suggestions, and both the modal preview and admin `SuggestedChanges` queue render evidence links, excerpts, method badges, and confidence.
  Repo touchpoints: new migration(s), `agent-verify`, admin/person suggestion review UI.
  Strategy refs: §Verification And Updates Strategy -> `2. Add evidence columns to profile_suggestions` (line 1139), `Scope` (line 1192), §Roadmap -> `Phase 3: Verification Unification` (line 1448).

- [x] Route verification behavior by field risk.
  Do: use deterministic extraction for low-risk fields first, explicit review for medium-risk fields, and stricter evidence/LLM judgment for high-risk changes such as bio rewrites or “may have left the US” status.
  Update (2026-04-01): The shared core now tags every suggestion with a low/medium/high risk level, filters candidate suggestions through field-specific confidence/evidence thresholds, keeps advisory `_status` flags review-only, and shows reviewer guidance in both the modal and admin queue.
  Repo touchpoints: verification core, suggestion UI, reviewer guidance.
  Strategy refs: §Verification And Updates Strategy -> `3. Route by field risk` (line 1152), `Devil's Advocate` (line 1188).

- [x] Add smarter verification scheduling.
  Do: prioritize stale profiles by stale age, LinkedIn presence, source importance, user activity/search volume, and recent discovery evidence touching an existing person.
  Update (2026-04-01): Scheduled verification candidate selection now scores stale people by stale age, LinkedIn presence, `data_source`, `search_clicks` activity, recent `discovered_contacts.approved_person_id` touches, and pending suggestion backlog. Because `agent-scheduler` triggers `agent-verify`, scheduled runs automatically inherit the smarter prioritization without a separate scheduler-side queue.
  Repo touchpoints: `agent-scheduler`, `agent-verify`, analytics/priority queries.
  Strategy refs: §Verification And Updates Strategy -> `4. Add smarter scheduling` (line 1174), `Scope` (line 1192), §Success Metrics (line 1469).

## Phase 4 — Labeling, Embeddings, and Connections

- [x] Build an evidence-first derived labeling pipeline.
  Do: extract proposed sectors, occupation/career stage, Flemish entities, US location, source quality, and profile confidence into reviewable derived-label records before promoting them into canonical tables or filter fields.
  Update (2026-04-01): Migration `20260401120000_phase4_labeling_embeddings_connections.sql` adds `derived_label_suggestions` with evidence, confidence, dedupe, and review status fields. `agent-discovery` and `agent-verify` now upsert reviewable derived labels, Admin renders them through `DerivedLabelsPanel`, discovered-contact cards show pending label chips, and approval promotes canonical fields (`people.occupation`, `person_sectors`, `person_flemish_connections`, `people.location_id`) before requeueing embeddings when needed.
  Repo touchpoints: new label tables/views or suggestion extensions, admin review UI, discovery/verification outputs.
  Strategy refs: §Automatic Labeling And Location Extraction (line 1327), `Recommended derived labels` (line 1331), `Recommended implementation pattern` (line 1340), §Roadmap -> `Phase 4: Labeling, Embeddings, Connections` (line 1459).

- [x] Turn location extraction into a pipeline instead of a single model field.
  Do: store raw location text, parse city/state/country deterministically, geocode US candidates, score confidence, and require review when location remains ambiguous.
  Update (2026-04-01): the shared location pipeline now parses raw location text before any DB write, resolves or creates `locations` rows through the `geocode` edge function, and stores nullable placeholder locations when review is still required. `locations` now carries `geocode_source` and `geocoded_at`, while `geocode` accepts both legacy `{pairs}` and pipeline `{candidates}` payloads and returns `parser_confidence`, `geocoded`, and `review_required`.
  Repo touchpoints: discovery evidence, verification core, `supabase/functions/geocode/index.ts`, location-related tables/views.
  Strategy refs: §Automatic Labeling And Location Extraction -> `Location extraction` (line 1349), `Recommended implementation pattern` (line 1340).

- [x] Improve embedding document construction and backfill accounting before any model migration.
  Do: build structured embedding text with explicit field labels, fix stale/null progress accounting, and batch embedding requests where practical.
  Update (2026-03-31): Embedding refresh is now queue-based. `embedding_jobs` tracks dirty people server-side, `generate-embeddings` claims batches from that queue, and frontend create/edit/import flows only kick the worker best-effort after commit instead of trying to generate each person embedding inline from the browser. The document format itself is still the old flat concatenation and still needs the Phase 4 structured rewrite.
  Update (2026-04-01): `generate-embeddings` now builds labeled embedding documents from name, position, bio, sectors, normalized Flemish connections, and location signals; batches Gemini embedding requests through the shared helper; and writes chunk embeddings alongside the primary `people.embedding`. Live smoke tests after deployment confirmed queue backfill, batch claiming, and chunk creation on project `ofzuhajxwxggybkuzefq`.
  Repo touchpoints: `supabase/functions/generate-embeddings/index.ts`, embedding tables/migrations, nightly refresh jobs.
  Strategy refs: §Embeddings Strategy -> `1. Build a better embedding document` (line 1256), `3. Fix backfill accounting and batching` (line 1286), `4. Delay the embedding-model migration until the pipeline is stable` (line 1296).

- [x] Add bio-chunk vectors once lexical + single-vector search is stable.
  Do: create `person_text_chunks`, embed chunks, retrieve top chunks, roll results back up to people, and reuse matched chunk text for snippets/evidence.
  Update (2026-04-01): Phase 4 adds `person_text_chunks`, the `match_person_text_chunks()` RPC, and HNSW chunk-vector indexing. `generate-embeddings` now writes `bio`, `position`, and `combined` chunks, while `search-people` retrieves chunk matches separately, folds them into the fused ranking, and uses matched chunk text as the returned snippet when that signal wins.
  Update (2026-04-03): `suggest-people` now also uses the chunk-vector lane instead of relying only on legacy person-level matches, so collection recommendations stay aligned with the live embedding/search stack and no longer fail silently when the older retrieval path underperforms or errors.
  Repo touchpoints: new migration(s), `generate-embeddings`, `search-people`.
  Strategy refs: §Embeddings Strategy -> `2. Add bio-chunk vectors` (line 1270), `Devil's Advocate` (line 1314), §Roadmap -> `Phase 4: Labeling, Embeddings, Connections` (line 1459).

- [x] Expand connections conservatively and keep soft affinity separate from hard graph edges.
  Do: add evidence-backed connection types such as same organization/program/lab/event roster, and keep softer semantic affinity in a separate `connection_suggestions` surface rather than writing noisy graph edges directly.
  Update (2026-04-01): `discover_connections()` now writes evidence-backed `colleague`, `alumni`, `program_peer`, `local_peer`, `lab_peer`, and `event_peer` hard edges, and `connections` stores `evidence_url`, `evidence_excerpt`, `evidence_source`, and `evidence_key`. Softer semantic affinity now lands in `connection_suggestions` only; `agent-connections` generates those suggestions from chunk-vector similarity, and Person Profile renders them in a separate “Affinity Suggestions” section instead of mixing them into the hard graph.
  Repo touchpoints: `discover_connections()` SQL/RPC, connection migrations/views, profile/graph UI.
  Strategy refs: §Connections Strategy (line 1201), `What To Change` (line 1213), `Scope` (line 1238), §Roadmap -> `Phase 4: Labeling, Embeddings, Connections` (line 1459).

## Phase 5 – Cross-Cutting Model, Ops, and Evaluation Work

- [x] Move production defaults to stable Gemini 2.5 models.
  Do: replace preview-first hardcoded defaults with shared env/config-based model selection using `gemini-2.5-flash-lite`, `gemini-2.5-flash`, and `gemini-2.5-pro`; keep Gemini 3.x preview models opt-in for evaluation lanes only.
  Update (2026-04-02): `_shared/gemini.ts` now owns stable route defaults across the active stack: query parsing and page classification default to `gemini-2.5-flash-lite`, extraction and verification default to `gemini-2.5-flash`, and merge/offline evaluation routes default to `gemini-2.5-pro`, while preview models remain opt-in through per-route env overrides. `discover-contacts`, `suggest-people`, `agent-discovery`, `search-people`, `agent-verify`, `update-profile`, and `ai-agent` now all read that shared routing instead of carrying preview-first hardcoded fallbacks.
  Repo touchpoints: all AI edge functions, shared model helper, env docs.
  Strategy refs: §Critical Findings -> `8. The current model strategy leans too hard on preview models` (line 220), §Model Strategy -> `Production Defaults` (line 1363), `Why Not Make Gemini 3.x Preview The Core` (line 1379).

- [x] Add the caching and batch patterns the strategy depends on.
  Do: use context caching for repeated large prompt/evidence prefixes and Gemini Batch API for large embedding refreshes or other offline high-volume jobs.
  Update (2026-04-02): `_shared/gemini.ts` now exposes explicit Gemini context-cache helpers, and `agent-discovery` uses them opportunistically on repeated extraction retries instead of forcing caching into every path. `generate-embeddings` keeps the existing queue-first worker for immediate refreshes, but now also supports an optional async Gemini Batch API lane backed by internal `embedding_batch_runs`, with Admin showing recent offline batch status in the existing Embedding Search Index card.
  Repo touchpoints: shared AI helpers, embedding jobs, offline admin tooling.
  Strategy refs: §Caching And Batch Strategy (line 1385).

- [x] Track the success metrics phase by phase in Admin or saved ops queries.
  Do: implement dashboards or materialized views for search benchmark success, discovery recall/yield, multi-evidence rate, review approval rates, duplicate rate, verified-US-location rate, gap-closure rate, and connection suggestion acceptance.
  Update (2026-04-02): Migration `20260402103000_phase5_model_ops_metrics.sql` adds internal `ops_connection_suggestion_metrics`, expands `ops_phase_success_metrics` to cover search benchmark success, discovery source recall/yield, multi-evidence rate, review approval rates, duplicate rate, embedding/location coverage, gap closure, and connection suggestion acceptance, and adds internal `embedding_batch_runs` for offline embedding batch bookkeeping. The Admin Agents tab now renders a compact `OpsMetricsPanel` with live model-default summaries plus those phase metrics through the privileged `agent-scheduler` `metrics` action.
  Repo touchpoints: admin analytics, SQL views/materialized views, benchmark fixtures.
  Strategy refs: §Success Metrics (line 1469), §Final Recommendation (line 1491).
