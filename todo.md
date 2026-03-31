# Flemish Network Platform — AI Strategy TODO

This backlog replaces the old generic wishlist. It is derived from `AI-strategy.md` and follows the roadmap order from that document.

Working rule for every task:
- finish the relevant validation/deploy loop for the area you touched (`npm run typecheck`, `npm run build`, `supabase db push --linked`, deploy changed edge functions, and smoke-test the affected UI/API flow)
- read the `Strategy refs` line before implementation so the exact rationale and design detail comes from `AI-strategy.md`, not from this summary

## Phase 0 — Contract Cleanup

- [x] Remove dead `people.flemish_connection` writes from every AI-assisted create, merge, and review flow.
  Do: stop writing a scalar `flemish_connection` onto `people`; create/update the person row, normalize via `syncPersonFlemishConnections()`, and regenerate or requeue embeddings after the normalized links change.
  Repo touchpoints: `src/components/admin/AdminChatbot.tsx`, `src/components/admin/DiscoveredContactsPanel.tsx`, `src/components/ProfileUpdateModal.tsx`, `src/components/admin/ContactCard.tsx`, `src/lib/flemishConnectionSync.ts`.
  Strategy refs: `AI-strategy.md` §Critical Findings -> `1. Data-contract drift is breaking AI flows` (line 50), §Immediate Fixes -> `P0.1 Fix all broken flemish_connection writes` (line 272), §What To Remove Or Rename (line 1398), §Roadmap -> `Phase 0: Contract Cleanup` (line 1409).

- [x] Fix the ad hoc profile-update contract and make the modal/API behavior consistent.
  Do: pick one contract and implement it end to end. Preferred path: the single-person modal gets preview suggestions directly, while batch verification owns the durable `profile_suggestions` queue.
  Repo touchpoints: `src/components/ProfileUpdateModal.tsx`, `supabase/functions/update-profile/index.ts`, `supabase/functions/agent-verify/index.ts`, the suggestions UI in Admin and Person Profile.
  Strategy refs: §Critical Findings -> `4. Verification and updates are duplicated and partly disconnected` (line 130), §Immediate Fixes -> `P0.2 Unify the profile-update contract` (line 293), §Verification And Updates Strategy -> `1. Collapse update-profile into the verification system` (line 1130), §Roadmap -> `Phase 0: Contract Cleanup` (line 1409).

- [x] Route agent triggering through one orchestration path.
  Do: either make `AgentDashboard` always trigger work via `agent-scheduler`, or remove the scheduler entirely. Lifecycle control, zombie cleanup, run claiming, and telemetry should live in one path only.
  Repo touchpoints: `src/components/admin/AgentDashboard.tsx`, `supabase/functions/agent-scheduler/index.ts`, `agent_runs` writes in agent functions and UI triggers.
  Strategy refs: §Critical Findings -> `5. Several "agent" pieces are not really operating as an agent system` (line 161), §Immediate Fixes -> `P0.3 Use one orchestration path` (line 304), §Roadmap -> `Phase 0: Contract Cleanup` (line 1409).

- [ ] Centralize shared prompts, schemas, and model-selection rules.
  Do: move query parsing, profile-check schemas, and model routing into shared helpers used by `ai-agent`, `search-people`, and `agent-verify`; remove or freeze unused `ai-agent` tasks unless they have a live product call site.
  Repo touchpoints: `supabase/functions/ai-agent/index.ts`, `supabase/functions/search-people/index.ts`, `supabase/functions/agent-verify/index.ts`, `supabase/functions/_shared/`.
  Strategy refs: §Critical Findings -> `6. The centralized ai-agent function is not actually central` (line 177), §Immediate Fixes -> `P0.4 Remove prompt duplication` (line 318), §What To Remove Or Rename (line 1398), §Roadmap -> `Phase 0: Contract Cleanup` (line 1409).

- [ ] Lock in benchmark datasets and success metrics before Phase 1 starts.
  Do: create a fixed search query set, benchmark discovery sources, and saved metrics queries so every later phase can be measured against the same baseline.
  Repo touchpoints: admin analytics queries/views, benchmark fixtures/docs, `search_clicks`, `agent_runs`, discovery review metrics.
  Strategy refs: §Search Strategy -> `Scope` (line 417), §Discovery Strategy -> `Suggested discovery metrics for geographic coverage` (line 1007), §Success Metrics (line 1469).

## Phase 1 — Search Upgrade

- [ ] Build a denormalized lexical search substrate for people.
  Do: add a `people_search_documents` table or materialized view that combines name, role, bio, occupation, normalized Flemish connections, sectors, and location text; add `tsvector` and any trigram-friendly fields/indexes needed for lexical retrieval.
  Repo touchpoints: new migration(s), search SQL/RPC, `supabase/functions/search-people/index.ts`.
  Strategy refs: §Search Strategy -> `1. Add a lexical retrieval layer` (line 346), §Search Strategy -> `Scope` (line 417), §Roadmap -> `Phase 1: Search Upgrade` (line 1420).

- [ ] Replace candidate gating with lexical + vector fusion ranking.
  Do: retrieve lexical top K and vector top K separately, add exact/trigram boosts, and use reciprocal-rank or normalized weighted fusion instead of the current narrow candidate gate.
  Repo touchpoints: `supabase/functions/search-people/index.ts`, `match_people()`-related SQL/migrations, any search ranking helpers.
  Strategy refs: §Search Strategy -> `2. Switch from candidate gating to rank fusion` (line 367), §Roadmap -> `Phase 1: Search Upgrade` (line 1420).

- [ ] Add query routing for direct lookup, faceted search, and exploratory semantic search.
  Do: classify each query and change retrieval order and weights per route instead of pushing every query through the same pipeline.
  Repo touchpoints: `supabase/functions/search-people/index.ts`, shared query parsing/router helpers.
  Strategy refs: §Search Strategy -> `3. Add query routing` (line 382), §Roadmap -> `Phase 1: Search Upgrade` (line 1420).

- [ ] Rewrite snippets so they come from the best matching field, chunk, or evidence sentence.
  Do: pick snippets from lexical field hits, matched bio chunks, or evidence text instead of defaulting to generic bio output.
  Repo touchpoints: `supabase/functions/search-people/index.ts`, future chunk/evidence tables.
  Strategy refs: §Search Strategy -> `4. Improve snippets` (line 396), §Embeddings Strategy -> `2. Add bio-chunk vectors` (line 1270), §Roadmap -> `Phase 1: Search Upgrade` (line 1420).

- [ ] Remove weak fallback assumptions and validate the new stack against the fixed benchmark set.
  Do: demote the 200-row client-side fallback mentality, run the representative query set before/after the changes, and compare with click data and the success metrics dashboard.
  Repo touchpoints: `src/lib/aiService.ts`, dashboard search flow, analytics queries.
  Strategy refs: §Search Strategy -> `What To Scrap` (line 406), §Search Strategy -> `Scope` (line 417), §Success Metrics (line 1469).

## Phase 2A — Discovery Redesign Foundation

- [ ] Rebuild discovery around a persistent frontier.
  Do: add `discovery_frontier` plus supporting domain/page state so discovery persists across runs with statuses, priorities, budgets, revisit timestamps, content hashes, and extraction outcomes.
  Repo touchpoints: new migration(s), `supabase/functions/agent-discovery/index.ts`, `supabase/functions/agent-scheduler/index.ts`, `agent_runs`.
  Strategy refs: §Discovery Strategy (line 428), `1. Turn discovery into a bounded frontier crawler` (line 473), `Implementation Shape` (line 1065), `Scope` (line 1090), §Roadmap -> `Phase 2: Discovery Redesign` (line 1431).

- [ ] Define source packs for head coverage.
  Do: create configurable source packs with domains, query templates, refresh cadence, and extraction expectations for BAEF, universities, labs, team pages, event rosters, associations, and similar high-yield source families.
  Repo touchpoints: discovery config tables/files, `agent-discovery`, scheduler/admin controls.
  Strategy refs: §Discovery Strategy -> `2. Use three discovery lanes, not one` (line 529), §Roadmap -> `Phase 2: Discovery Redesign` (line 1431).

- [ ] Make search seed the frontier instead of acting as the extraction substrate.
  Do: save Tavily/Brave results as frontier URLs/domains and stop doing mainline extraction from merged search result blobs.
  Repo touchpoints: `supabase/functions/_shared/webSearch.ts`, `supabase/functions/agent-discovery/index.ts`.
  Strategy refs: §Discovery Strategy -> `3. Search should seed the frontier, not be the frontier` (line 581), `4. Extract per page, not from a merged search blob` (line 605).

- [ ] Add per-page fetch, canonicalization, and cheap page classification.
  Do: fetch pages individually, canonicalize URL/content, store page records, and classify page type with deterministic heuristics first and low-cost model help only when rules are ambiguous.
  Repo touchpoints: discovery fetch/classification helpers, `agent-discovery`, new `discovery_pages` data.
  Strategy refs: §Discovery Strategy -> `4. Extract per page, not from a merged search blob` (line 605), `5. Classify pages cheaply before running expensive extraction` (line 626), `Implementation Shape` (line 1065).

- [ ] Store discovery evidence as first-class records.
  Do: add evidence rows carrying source URL, title, type, excerpt, raw location/Flemish/role text, confidence, parent URL, discovered-via reason, and fetch time; allow multiple evidence rows per candidate.
  Repo touchpoints: `discovered_contacts`, new `discovery_evidence` table, admin review UI.
  Strategy refs: §Discovery Strategy -> `9. Store evidence, not just final fields` (line 737), §Roadmap -> `Phase 2: Discovery Redesign` (line 1431).

- [ ] Move LinkedIn to enrichment-only use inside discovery.
  Do: stop using LinkedIn search as the primary top-of-funnel channel; use it after a page or person is already promising to enrich role/location/photo/profile URL and to support verification.
  Repo touchpoints: `supabase/functions/agent-discovery/index.ts`, `supabase/functions/agent-verify/index.ts`, Apify integration.
  Strategy refs: §Discovery Strategy -> `11. Use LinkedIn as enrichment, not as the main discovery engine` (line 809), `Scope` (line 1090), §Roadmap -> `Phase 2: Discovery Redesign` (line 1431).

- [ ] Run discovery as small scheduled batches with bounded budgets.
  Do: claim the next 10-20 frontier URLs, process them, update domain/page state, enqueue the best next links only, and release the batch cleanly instead of treating discovery as a one-shot prompt run.
  Repo touchpoints: `supabase/functions/agent-scheduler/index.ts`, `supabase/functions/agent-discovery/index.ts`, frontier/domain/page tables, `agent_runs`.
  Strategy refs: §Discovery Strategy -> `Implementation Shape` (line 1065), `1. Turn discovery into a bounded frontier crawler` (line 473), `6. Expand links selectively, not blindly` (line 662).

## Phase 2B — Discovery Expansion, Coverage, and Yield Learning

- [ ] Add selective child-link expansion and hard crawl budgets.
  Do: score outgoing links, follow only promising children, enforce max depth/per-domain/per-run budgets, and expand aggressively only when the parent page yielded a candidate or strong person-like signals.
  Repo touchpoints: `agent-discovery`, frontier tables, page/domain telemetry.
  Strategy refs: §Discovery Strategy -> `6. Expand links selectively, not blindly` (line 662), `1. Turn discovery into a bounded frontier crawler` (line 473), `Scope` (line 1090).

- [ ] Teach discovery which domains deserve budget.
  Do: track per-domain fetches, promising pages, approvals, rejections, duplicates, evidence quality, and last approved contact date; use those metrics to set revisit cadence and decay low-yield domains.
  Repo touchpoints: `discovery_domains`, scheduler/discovery scoring logic, admin analytics.
  Strategy refs: §Discovery Strategy -> `7. Use domain yield learning so the crawler gets smarter over time` (line 695), `Scope` (line 1090), §Success Metrics (line 1469).

- [ ] Add sitemap and RSS harvesting for proven domains.
  Do: once a domain has shown yield, seed the frontier from `sitemap.xml`, RSS/Atom, and obvious directory/news pages instead of relying on deeper random crawling.
  Repo touchpoints: discovery fetch helpers, frontier seeding, domain-yield policy.
  Strategy refs: §Discovery Strategy -> `8. Add sitemap and RSS harvesting for proven domains` (line 718), `Scope` (line 1090).

- [ ] Make discovery coverage tracking first-class.
  Do: persist and surface frontier size, queued/fetched/ignored counts, high-yield and exhausted domains, page-type mix, duplicates, average evidence count per candidate, frontier refills, and revisit latency.
  Repo touchpoints: `agent_runs`, discovery tables/views, admin analytics.
  Strategy refs: §Discovery Strategy -> `12. Coverage tracking must become first-class` (line 829), `18. Suggested discovery metrics for geographic coverage` (line 1007), §Success Metrics (line 1469).

- [ ] Build geographic coverage inputs and gap scoring.
  Do: add metro mapping, `coverage_targets`, and `coverage_gaps` so approved/pending/verified counts, sector mix, recent activity, expected coverage, and gap score can be computed by state and metro.
  Repo touchpoints: new migration/views, locations/geography mapping, admin reporting.
  Strategy refs: §Discovery Strategy -> `13. Add geographic coverage intelligence and gap-seeking` (line 854), `14. Gap detection should be based on expected presence, not just low counts` (line 891), `17. Suggested data model for geographic coverage` (line 974).

- [ ] Feed gap scores back into discovery planning.
  Do: bias frontier revisits, source pack refresh order, and seed generation toward undercovered but high-expected metros/sectors instead of repeating naive geography queries.
  Repo touchpoints: scheduler/discovery planner, frontier priority scoring.
  Strategy refs: §Discovery Strategy -> `15. Geographic gaps should steer the frontier and the search planner` (line 925), `16. Add a discovery-planning surface for operators` (line 953).

## Phase 2C — Discovery Compounding and Operator Tooling

- [ ] Add entity-pivot discovery from approved contacts and strong evidence.
  Do: generate follow-up frontier seeds from organizations, labs, fellowships, advisory boards, events, and co-mentioned institutions that already carry evidence, never from vague model summaries.
  Repo touchpoints: approval flows, `agent-discovery`, frontier seeding.
  Strategy refs: §Discovery Strategy -> `10. Add entity-pivot discovery` (line 779), `2. Use three discovery lanes, not one` (line 529), `Scope` (line 1090).

- [ ] Improve multi-page candidate merging so evidence can accumulate over time.
  Do: merge mentions across pages into one candidate strength profile instead of inserting thin one-page records that reviewers have to reconstruct manually.
  Repo touchpoints: discovery merge logic, `discovered_contacts`, `discovery_evidence`, admin review UI.
  Strategy refs: §Discovery Strategy -> `9. Store evidence, not just final fields` (line 737), `Scope` (line 1090).

- [ ] Build an operator-facing discovery planning panel in Admin.
  Do: show state/metro coverage, top undercovered metros, gap score, recent discovery activity, and recommended next actions such as frontier expansion or source-pack refreshes.
  Repo touchpoints: admin pages/components, coverage views, scheduler trigger UI.
  Strategy refs: §Discovery Strategy -> `16. Add a discovery-planning surface for operators` (line 953), `13. Add geographic coverage intelligence and gap-seeking` (line 854), `17. Suggested data model for geographic coverage` (line 974).

- [ ] Rename or fold `search-contacts` into the discovery system.
  Do: stop presenting web prospecting as directory search; either rename the endpoint/UI to `discover-contacts` or absorb it fully into the frontier-based discovery pipeline.
  Repo touchpoints: `supabase/functions/search-contacts/index.ts`, `src/lib/aiService.ts`, admin UI labels/docs.
  Strategy refs: §What To Remove Or Rename (line 1398), §Discovery Strategy (line 428).

## Phase 3 — Verification Unification

- [ ] Build one shared verification core for modal and batch modes.
  Do: move single-person review and scheduled verification onto the same core pipeline with shared fetching, deterministic diffs, evidence capture, dedupe, and model usage.
  Repo touchpoints: `supabase/functions/update-profile/index.ts`, `supabase/functions/agent-verify/index.ts`, `src/components/ProfileUpdateModal.tsx`.
  Strategy refs: §Verification And Updates Strategy -> `1. Collapse update-profile into the verification system` (line 1130), `Scope` (line 1192), §Roadmap -> `Phase 3: Verification Unification` (line 1448).

- [ ] Add evidence-bearing fields to `profile_suggestions`.
  Do: extend the table/UI with `evidence_url`, `evidence_excerpt`, `confidence`, `method`, `agent_run_id`, and `dedupe_key`, then show that evidence in the reviewer workflow.
  Repo touchpoints: new migration(s), `agent-verify`, admin/person suggestion review UI.
  Strategy refs: §Verification And Updates Strategy -> `2. Add evidence columns to profile_suggestions` (line 1139), `Scope` (line 1192), §Roadmap -> `Phase 3: Verification Unification` (line 1448).

- [ ] Route verification behavior by field risk.
  Do: use deterministic extraction for low-risk fields first, explicit review for medium-risk fields, and stricter evidence/LLM judgment for high-risk changes such as bio rewrites or “may have left the US” status.
  Repo touchpoints: verification core, suggestion UI, reviewer guidance.
  Strategy refs: §Verification And Updates Strategy -> `3. Route by field risk` (line 1152), `Devil's Advocate` (line 1188).

- [ ] Add smarter verification scheduling.
  Do: prioritize stale profiles by stale age, LinkedIn presence, source importance, user activity/search volume, and recent discovery evidence touching an existing person.
  Repo touchpoints: `agent-scheduler`, `agent-verify`, analytics/priority queries.
  Strategy refs: §Verification And Updates Strategy -> `4. Add smarter scheduling` (line 1174), `Scope` (line 1192), §Success Metrics (line 1469).

## Phase 4 — Labeling, Embeddings, and Connections

- [ ] Build an evidence-first derived labeling pipeline.
  Do: extract proposed sectors, occupation/career stage, Flemish entities, US location, source quality, and profile confidence into reviewable derived-label records before promoting them into canonical tables or filter fields.
  Repo touchpoints: new label tables/views or suggestion extensions, admin review UI, discovery/verification outputs.
  Strategy refs: §Automatic Labeling And Location Extraction (line 1327), `Recommended derived labels` (line 1331), `Recommended implementation pattern` (line 1340), §Roadmap -> `Phase 4: Labeling, Embeddings, Connections` (line 1459).

- [ ] Turn location extraction into a pipeline instead of a single model field.
  Do: store raw location text, parse city/state/country deterministically, geocode US candidates, score confidence, and require review when location remains ambiguous.
  Repo touchpoints: discovery evidence, verification core, `supabase/functions/geocode/index.ts`, location-related tables/views.
  Strategy refs: §Automatic Labeling And Location Extraction -> `Location extraction` (line 1349), `Recommended implementation pattern` (line 1340).

- [ ] Improve embedding document construction and backfill accounting before any model migration.
  Do: build structured embedding text with explicit field labels, fix stale/null progress accounting, and batch embedding requests where practical.
  Repo touchpoints: `supabase/functions/generate-embeddings/index.ts`, embedding tables/migrations, nightly refresh jobs.
  Strategy refs: §Embeddings Strategy -> `1. Build a better embedding document` (line 1256), `3. Fix backfill accounting and batching` (line 1286), `4. Delay the embedding-model migration until the pipeline is stable` (line 1296).

- [ ] Add bio-chunk vectors once lexical + single-vector search is stable.
  Do: create `person_text_chunks`, embed chunks, retrieve top chunks, roll results back up to people, and reuse matched chunk text for snippets/evidence.
  Repo touchpoints: new migration(s), `generate-embeddings`, `search-people`.
  Strategy refs: §Embeddings Strategy -> `2. Add bio-chunk vectors` (line 1270), `Devil's Advocate` (line 1314), §Roadmap -> `Phase 4: Labeling, Embeddings, Connections` (line 1459).

- [ ] Expand connections conservatively and keep soft affinity separate from hard graph edges.
  Do: add evidence-backed connection types such as same organization/program/lab/event roster, and keep softer semantic affinity in a separate `connection_suggestions` surface rather than writing noisy graph edges directly.
  Repo touchpoints: `discover_connections()` SQL/RPC, connection migrations/views, profile/graph UI.
  Strategy refs: §Connections Strategy (line 1201), `What To Change` (line 1213), `Scope` (line 1238), §Roadmap -> `Phase 4: Labeling, Embeddings, Connections` (line 1459).

## Cross-Cutting Model, Ops, and Evaluation Work

- [ ] Move production defaults to stable Gemini 2.5 models.
  Do: replace preview-first hardcoded defaults with shared env/config-based model selection using `gemini-2.5-flash-lite`, `gemini-2.5-flash`, and `gemini-2.5-pro`; keep Gemini 3.x preview models opt-in for evaluation lanes only.
  Repo touchpoints: all AI edge functions, shared model helper, env docs.
  Strategy refs: §Critical Findings -> `8. The current model strategy leans too hard on preview models` (line 220), §Model Strategy -> `Production Defaults` (line 1363), `Why Not Make Gemini 3.x Preview The Core` (line 1379).

- [ ] Add the caching and batch patterns the strategy depends on.
  Do: use context caching for repeated large prompt/evidence prefixes and Gemini Batch API for large embedding refreshes or other offline high-volume jobs.
  Repo touchpoints: shared AI helpers, embedding jobs, offline admin tooling.
  Strategy refs: §Caching And Batch Strategy (line 1385).

- [ ] Track the success metrics phase by phase in Admin or saved ops queries.
  Do: implement dashboards or materialized views for search benchmark success, discovery recall/yield, multi-evidence rate, review approval rates, duplicate rate, verified-US-location rate, gap-closure rate, and connection suggestion acceptance.
  Repo touchpoints: admin analytics, SQL views/materialized views, benchmark fixtures.
  Strategy refs: §Success Metrics (line 1469), §Final Recommendation (line 1491).
