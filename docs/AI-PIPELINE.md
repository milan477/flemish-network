# AI Pipeline Reference

## Service Map

| Product service | Route/UI | Edge/API owner | Notes |
|---|---|---|---|
| Search The Network | `/` | `search-people` | Server-side routed hybrid people search plus Phase 3 lexical organization search. |
| Build A Collection | `/collections`, `/collections/:id` | `suggest-people` | Collection suggestion service over existing approved people and organizations. Suggestions remain draft-only until staff approval. |
| Expand The Database | `/admin/discovery` | `agent-scheduler` -> `agent-discovery` | Prompted and autonomous discovery. Evidence-first review queues; no auto-promotion. |
| Verify And Enrich Records | `/admin/verification` | `agent-verify`, `update-profile` preview | Target is one verification service with preview and durable modes. |
| Understand And Grow The Network | `/admin/growth` | `agent-scheduler` planning/metrics, `agent-discovery-reflect` (daily cron via housekeeping) | Coverage gaps, source yield, entity pivots, reflection suggestions, and recommended next discovery actions. |
| System | `/admin/system` | `agent-scheduler`, `generate-embeddings` | Health, record-index queues, cancellation, housekeeping, API usage. Today's API Usage tile reports Gemini, Tavily, and estimated cost by default; the legacy Apify call/credit metrics are hidden unless `VITE_SHOW_APIFY=1` or actual usage is non-zero. |
| Staff Access | `/admin/access` | `invite-staff-user`, `remove-staff-user`, Supabase Auth | Admin-only staff invitation, role management, and removal. |

## Behavioral Contracts

- Staff login uses Supabase Auth email/password. Magic-link login is not part of the active auth flow.
- `invite-staff-user` is the only frontend-facing staff invitation endpoint. It requires admin staff auth, writes the approved `staff_users` row with `password_reset_required = true`, and delegates email delivery/user invitation to Supabase Auth `inviteUserByEmail`.
- `remove-staff-user` is the only frontend-facing staff removal endpoint. It requires admin staff auth, refuses self-removal, deletes the `staff_users` row, and deletes the linked `auth.users` record. The access list does not retain revoked entries; granting access again requires a fresh invite.
- `agent-scheduler` owns `agent_runs` lifecycle for discovery and verification. UI must not insert/update run rows directly.
- `agent-scheduler` rejects `agent_type = "connection"`; the person-to-person connection service has been removed.
- `agent-discovery` is the durable Discovery service. Prompted discovery must call `agent-scheduler` with `agent_type = "discovery"`; retired Discovery compatibility endpoints must not be reintroduced.
- `/admin/discovery?prompt=<encoded prompt>` is a staff-controlled handoff only: it pre-fills the Discovery intake prompt box and must not call `agent-scheduler` until staff explicitly starts Discovery.
- `agent-verify` owns durable verification suggestions.
- `update-profile` is preview mode only for inline profile checks and must not write durable suggestion rows.
- `derived_label_suggestions` remains the review queue for inferred sectors, occupations, Flemish/Belgian entities, locations, and confidence before promotion.
- `person_sectors` use idempotent insert/delete maintenance. Flemish/Belgian fact junctions support editor-owned upserts and evidence-field updates for approved profile and Discovery review workflows.
- `ai-agent` active tasks are `smart_search`, `merge_text`, and `check_profile`.

## Error Contract

Edge-function failures use `{ error: { code, message, hint? } }`.

- `code` is one of `auth_failed`, `forbidden`, `invalid_input`, `not_found`, `quota_exhausted`, `network`, `db_timeout`, `agent_failure`, `unknown`.
- Agent run persistence maps this to `agent_runs.error_kind`, whose database enum intentionally excludes UI-only `forbidden`/`not_found`.
- `src/lib/aiService.ts` preserves structured edge errors as `EdgeFunctionError`.
- Edge function handlers should be wrapped with `_shared/httpError.ts` `wrapHandler(fn)` and use `jsonError(...)` for expected validation failures.

## Gemini Model Routing

Defined in `supabase/functions/_shared/gemini.ts`.

| Route | Default Model | Env Override |
|---|---|---|
| `query_parsing`, `query_generation`, `page_classification` | `gemini-2.5-flash-lite` | `GEMINI_FLASH_LITE_MODEL`, `GEMINI_QUERY_MODEL`, `GEMINI_QUERY_GENERATION_MODEL`, `GEMINI_CLASSIFICATION_MODEL` |
| `contact_extraction`, `profile_verification` | `gemini-2.5-flash` | `GEMINI_FLASH_MODEL`, `GEMINI_EXTRACTION_MODEL`, `GEMINI_PROFILE_MODEL` |
| `lightweight_text_merge`, `offline_evaluation` | `gemini-2.5-pro` | `GEMINI_PRO_MODEL`, `GEMINI_MERGE_MODEL`, `GEMINI_EVAL_MODEL` |
| `search_rerank` | `gemini-2.5-flash` (thinking budget = 0) | `GEMINI_SEARCH_RERANK_MODEL`, `GEMINI_SEARCH_RERANK_FALLBACK_MODEL` |
| embeddings | `gemini-embedding-001` | `GEMINI_EMBEDDING_MODEL` |

## Edge Function: `search-people`

Server-side Search The Network endpoint for approved people and organizations.

The architecture is two stages with no natural-language filter parser
(`src/lib/filterParser.ts` was deleted in UX_REMEDIATION Phase 1A — chips are
click-only on the dashboard, never auto-extracted from the query).

**Stage 1 — hybrid retrieval (~100–500 ms).** Lexical (`search_people_lexical`
/ `search_organizations_lexical`) + record-vector (`match_people` /
`match_organizations`) + text-chunk vector (`match_person_text_chunks` /
`match_organization_text_chunks`) run in parallel. Signals are fused with
Reciprocal Rank Fusion (`k = 60`) plus per-route weights and small boosts for
exact-name matches, name overlap, and structured-criteria coverage. The
`people_search_documents.search_text` and
`organization_search_documents.search_text` blobs include city, two-letter
state, and the spelled-out US state name (via `expand_us_state` /
`format_location_search_text`, migration `20260509000000`) so a query like
"Massachusetts" matches rows whose location only stores `MA`.
Structured-criteria coverage is now a soft boost only — it never drops
candidates from the result set (the old strict gate produced the
Boston→Indiana surprise documented in the 2026-05-08 UX review).

**Stage 2 — Gemini rerank (best-effort, 0–12 s timeout).** The top mixed
people+organization candidates from Stage 1 (capped at 30 by
`supabase/functions/search-people/rerank.ts`) are sent to Gemini route
`search_rerank` (default `gemini-2.5-flash` with `thinking_budget = 0`,
override via `GEMINI_SEARCH_RERANK_MODEL`) with structured output. Each
candidate is rendered as a compact `KIND | ID | BLOB` line covering name,
title, role, sectors, Flemish ties, location, and bio. The model returns
`{ ranked: [{ id, kind, reason }] }`; any IDs not in the supplied list are
discarded. On success the response carries `rerank_status = "ok"` and the
`results` array is reordered with the model's ranking; Stage-1 candidates the
model omitted are appended at the bottom so nothing disappears. On timeout,
error, or empty key the response carries
`rerank_status ∈ {"timeout","error","skipped"}`, the Stage 1 ordering is kept,
and the per-row rationale falls back to the lexical-derived text.

**Request / response.**

1. Takes `{ query, max_results, match_mode?, filters? }`.
2. Supported filters include `show_people`, `show_organizations`, `sector`,
   `person_scope`, `occupation`, `city`, `state`, and `flemish_connections`.
   `filters.flemish_connections` is alias-aware and resolves broad filterable
   facts such as KU Leuven, UGent, imec, BAEF, Flemish Government, FIT, VUB,
   Vlerick, VITO, Flanders Make, and VIB. Filters are applied as soft
   coverage signals — the Gemini rerank decides what actually matches the
   user's intent.
3. Runs Gemini keyword extraction and original-query embedding in parallel,
   degrading to lexical-only when needed.
4. Parses shared search intent, preserving `original_query` for semantic
   retrieval while using canonical structured terms for lexical retrieval.
5. Calls Stage 1 retrieval (six parallel RPCs), fuses signals, then runs
   Stage 2 Gemini rerank.
6. Returns
   `{ results, people, organizations, keywords, match_mode, route, degraded, rerank, rerank_status, rerank_model, rerank_duration_ms, diagnostics, message, total_with_embeddings }`.

Each item in `results` includes `entity_type`, `id`, `name`, `score`,
`snippet`, and `rationale`. `entity_type = "person"` rows preserve the people
fields used by the existing UI; `entity_type = "organization"` rows include
organization type, description, website/logo, canonical Flemish/Belgian fact
text, US network status, and US locations. Search and profile surfaces can
add approved people or organizations to Collections.

## Edge Function: `agent-discovery`

Durable Discovery.

1. Takes `{ query?, run_id, batch_size? }`.
2. Seeds and claims `discovery_frontier` from prompts, surface×lens query plans, seed domains, or evidence-backed pivots.
3. Fetches pages, stores `discovery_pages`, classifies pages, extracts candidates, and stores evidence.
4. Merges people into `discovered_contacts` and target organizations into `discovered_organizations`.
5. Writes `derived_label_suggestions`, entity pivots, follow-up searches, and telemetry.
6. Returns people metrics plus organization insert, merge, and duplicate metrics for Discovery dashboard history. Never auto-promotes candidates into approved `people` or `organizations`.

Discovery operating principles:

- Treat web search as a way to seed the frontier, not as the evidence substrate.
- Crawl as a bounded best-first frontier: `seed -> frontier -> fetch -> classify -> extract -> expand -> review -> revisit`.
- Extract from individual pages with source URLs and excerpts so reviewers can audit every candidate.
- Use the surfaces × lenses taxonomy (`discovery_surfaces`, `discovery_lenses`, `discovery_seed_domains`) for head coverage; use high-yield domains, same-domain child links, sitemap/RSS URLs, entity pivots, and coverage gaps for adaptive expansion. Each query plan is composed from a `(surface, lens, optional domain hint)` tuple plus optional sector/geography axes when a coverage gap drives the plan.
- Use LinkedIn as post-extraction enrichment after a page or candidate is already interesting, not as the main seed lane.
- Generate entity pivots only from evidence-bearing entities, then feed those pivots into Network Growth planning.

Every `searchWeb` call inside `agent-discovery` writes one row to `discovery_query_attempts`, capturing `run_id`, `query_text`, `surface` (FK→`discovery_surfaces.key`), `lens` (FK→`discovery_lenses.key`), `composition_keys` (e.g. `surface:faculty_page`, `lens:alumni_network`, `geo:metro:boston-ma`, `sector:biotech`, `entity:flemish:imec`), `source_type` (`custom_query` / `surface_lens` / `entity_pivot`), `pivot_entity_key`, `provider`, and `urls_returned`. The `surface` and `lens` values come from the universal query generator (see below). After the run finishes, `agent-discovery` calls the `resolve_discovery_query_attempts(run_id)` RPC to populate downstream attribution counters (`pages_fetched`, `candidates_extracted`, `new_pending_contacts`, `contacts_later_approved`, `contacts_later_rejected`, `rejected_reason_breakdown`) by joining frontier → pages → evidence → contacts. The `composition_keys` column stays empty until later phases wire in compositional queries.

All search queries — Mode A custom intent, surface×lens expansion, and entity pivots — flow through the universal query generator in `supabase/functions/_shared/queryGeneration.ts` (`generateSearchQueries({ intent, surfaces?, lenses?, context, maxQueries }, apiKey)`). The helper calls Gemini route `query_generation` (defaults to `gemini-2.5-flash-lite`, override with `GEMINI_QUERY_GENERATION_MODEL`) with a structured-output schema and produces up to 6 semantically distinct queries per call, each tagged with a `surface`, `lens`, and `rationale`. The system prompt enforces proper boolean operators with parentheses, quoted multi-word entities, surface-specific `site:` operators, surface-form phrasings ("from Ghent", "Belgian-born", "PhD KU Leuven"), and a mix of US-based and US-connected-abroad angles. Callers pass `context.rotationSeed` (derived from `run_id` plus the surface/lens/pivot key) so re-runs of the same intent vary the angle mix. There are no hand-written query templates anywhere in the discovery pipeline: the `discovery_source_packs` table was dropped in Phase 2 of the Discovery Redesign on 2026-05-08 (replaced by `discovery_surfaces` × `discovery_lenses` × `discovery_seed_domains`), and entity pivots no longer carry a `seed_queries` column. On Gemini timeout, transport error, or empty/malformed output the helper logs a fallback reason and returns a single boolean-grouped origin-surface fallback query so seeding still progresses; the fallback is intentionally minimal and does not reintroduce per-shape templates. Each generation logs a `query_generation:<scope>` step in `agent_runs.results.steps` (with intent, rotation seed, model, surface/lens hints, and the resulting queries) and the run-level `llm_calls_made` counter is incremented for non-fallback calls.

Phase 3 bandit allocator. `agent-discovery` picks query plans using Thompson sampling over `(surface, lens)` arms tracked in `discovery_arm_stats`. At run start, `allocateBudget(supabase, budget, runId)` in `supabase/functions/_shared/banditAllocator.ts` loads all arm stats and all active `(surface, lens)` combinations. It reserves ≥ 25% of slots (`Math.ceil(budget * 0.25)`) for exploration — using a three-tier priority: (1) unconsumed `discovery_reflection_suggestions` with `expires_at > now()`, (2) arms where `last_attempt_at IS NULL` (untried), (3) oldest-attempted arm. When a reflection suggestion is used, `consumed_attempt_count` is incremented on the suggestion row. Remaining slots go to Thompson-sampled exploitation using a Beta prior on `contacts_approved / candidates_extracted`, with a penalty applied when `not_flemish_rejections > 50%` of rejections. Arms with `cooldown_until > now()` are excluded from allocation; an arm enters cooldown when it yields `new_pending_contacts = 0` for ≥ 3 attempts and its `last_yielding_attempt_at` is older than 7 days (or null). At run completion, `updateArmStats` increments `attempts` for each surface_lens plan that ran. The nightly `refreshArmStats` call in `agent-scheduler` housekeeping re-aggregates all `discovery_query_attempts` rows from the last 30 days into `discovery_arm_stats`, providing accurate approved/rejected/not_flemish counters for the next run's sampling. A `bandit_allocation` step is logged in `agent_runs.results.steps` listing all slots with their `is_exploration` flag. Each plan composes up to four axes — surface, lens, optional sector emphasis, and optional metro/state geography — passed to the generator as `surface_hints`, `lens_hints`, `coverageGapLabel`, and `coverageGapSector`. Domain hints (`discovery_seed_domains`) are included when a tuple matches a seeded domain so the generator can emit `site:` operators against high-yield surfaces. Plans always include at least one exploration slot with no coverage-gap context. Entity-pivot plans are kept and propagate surface/lens tags from the generator into `discovery_query_attempts`.

Phase 4 reflection loop. `agent-discovery-reflect` runs daily and builds a structured population summary via SQL aggregations over `people`, `discovered_contacts` (rejected rows), and `person_sectors`: counts by sector (top 10), US state (top 10), current employer (top 10), career stage (executive/academic/researcher/engineer/investor/consultant/other buckets derived from `occupation`), and recent rejection reasons (last 30 days). The prompt also includes a recent bandit-arm-history summary loaded from `discovery_arm_stats` (top 25 most-recently-attempted arms with their attempt counts and approval rates) so Gemini can avoid recommending arms with poor yield and focus on genuine gaps. It then calls Gemini route `query_generation` (`gemini-2.5-flash-lite`) with the `REFLECTION_SYSTEM_PROMPT` and the formatted population + arm-history summary. The structured-output schema returns `{ suggestions: [{ surface, lens, context_key, rationale }] }` with 3–10 entries. Surface/lens keys are validated against active rows in `discovery_surfaces`/`discovery_lenses`; invalid keys fall back to null (bandit resolves them at slot-fill time). Suggestions are written to `discovery_reflection_suggestions` with `expires_at = now() + 14 days` and `consumed_attempt_count = 0`. On Gemini failure the function logs and returns `suggestions_written: 0` without erroring. `agent-scheduler` housekeeping triggers the function daily (fire-and-forget, skipped when a suggestion was already generated in the last 24 hours). Staff can also trigger manually from the admin Reflection panel.

Suggestion-driven discovery (unifies reflection and bandit). When a discovery run is triggered with `params.suggestion_id` set (UI "Explore" button on a reflection suggestion, or the header "Start discovery run" which auto-picks the top unconsumed suggestion), `agent-discovery` skips `allocateBudget` entirely and builds a single exploration `AllocationSlot` from the suggestion's `surface`/`lens`/`context_key` (falling back to the first active surface/lens when keys are missing or stale). It increments `consumed_attempt_count` on that suggestion row at the start of the run. When no `suggestion_id` is provided (e.g. the daily cron tick or a fully prompted intent with no suggestions available), the bandit `allocateBudget` fallback runs as before. Query attempts generated from reflection-driven runs carry `source_type = 'reflection'` in `discovery_query_attempts`; frontier rows for those plans carry `source_type = 'reflection'` and `discovery_reason = 'reflection:<surface>:<lens>'`. Result: every Explore click is traceable to a specific suggestion, the bandit's history feeds the reflection prompt instead of competing with it at runtime, and the "Where to look next" panel is the actual queue the agent works through.

Phase 5 pivot upgrades. Four mechanisms make entity pivots more useful for finding genuinely new people.

**Pivot validation.** When `upsertEntityPivots` inserts a new pivot for the first time, it calls `validatePivot` in `supabase/functions/_shared/pivotValidation.ts`. This sends the entity name, type, and source excerpts to Gemini route `query_generation` (`gemini-2.5-flash-lite`) with a scoring prompt: "Is this entity Flemish/Belgian-relevant in a way that makes it useful for finding more Flemish-Americans? Score 0–1 with rationale." The result is stored in `discovery_entity_pivots.validation_score`, `validation_rationale`, `validation_at`. `loadEntityPivots` filters out any pivot where `validation_score < 0.5`. Pivots scored below threshold remain in the table for audit but never enter the active query rotation. On Gemini error, the fallback score of `0.5` is used so transient failures do not silently discard legitimate pivots.

**Saturation tracking.** At the end of each discovery run, `updatePivotSaturation` is called for entity-pivot plans that ran. It increments `rolling_new_approved` and checks whether the pivot's rolling window (started at `rolling_window_started_at`) is older than 7 days with zero new approved people. When that threshold is met, `saturation_cooldown_until` is set to `now() + 30 days`. `loadEntityPivots` skips pivots where `saturation_cooldown_until > now()`. Cooldown clears when new approvals arrive.

**Multi-hop expansion.** At run start, `loadMultiHopEmployers` queries `people` for anyone approved in the last 7 days with a non-null `current_employer`, then filters out employers already covered by a named-entity pivot. The resulting employer list is passed to `buildQueryPlans`, which generates up to 2 `source_type='multi_hop'` query plans using lenses `company_affiliation` and `named_entity`. These plans appear in `discovery_query_attempts` with `source_type='multi_hop'`.

**Composition pivots.** `agent-scheduler` housekeeping calls `buildCompositionPivots` weekly (gated by a 7-day freshness check on `discovery_composition_pivots.updated_at`). It groups approved people by `(sector, state)` — creating `sector_geo_cluster` pivots where count ≥ 4 — and by `sector` alone — creating `sector_cluster` pivots where count ≥ 6. Results are upserted into `discovery_composition_pivots`. At run start, `loadCompositionPivots` loads active (not-saturated) composition pivots and passes them to `buildQueryPlans`, which generates up to 2 `source_type='composition'` plans per run using lens `sector_geo` and the cluster's sector/state context.

Phase 6 domain reputation feedback. `agent-scheduler` housekeeping calls `recomputeDomainReputation` on every housekeeping tick (nightly). The function loads all active `discovery_seed_domains` rows, then loads all `discovered_contacts` and counts per-domain candidates by matching `source_urls` hostnames against seed-domain values. `reputation_score = (approved_count + 1) / (extracted_count + 5)` (Bayesian smoothing). Updated columns: `total_candidates_extracted`, `total_approved_contacts`, `reputation_score`, `reputation_recompute_at`. Staff can also set `manually_blocked = true` from the admin Domain Reputation leaderboard to suppress a domain regardless of score.

At discovery run start, `loadSurfaceLensTaxonomy` fetches `reputation_score` and `manually_blocked` from `discovery_seed_domains`. Inside `buildQueryPlans`, `preferredSiteOperators` is derived from the top 20 non-blocked domains sorted by descending `reputation_score`; `blockedDomains` is the set of manually-blocked or very-low-score (< 0.1) domains. Both lists are injected into the `context` of every `runQueryGeneration` call so the Gemini query generator can:
- Prefer `site:` operators for high-reputation domains when a surface hint suggests relevance.
- Avoid `site:` operators for blocked or low-yield domains.

`QueryGenerationContext` in `supabase/functions/_shared/queryGeneration.ts` now has two optional fields: `preferredSiteOperators: string[]` and `blockedDomains: string[]`. These are surfaced to Gemini via `PREFERRED_SITE_OPERATORS` and `BLOCKED_DOMAINS` lines in the user prompt.

The admin Domain Reputation section in `DiscoveryPlanningPanel` shows a sortable table of all seed domains with columns: Domain, Score, Candidates, Approved, Status badge (high yield / moderate / low yield / blocked), and a Block/Unblock toggle button that writes `manually_blocked` directly via a Supabase update.

Organization discovery writes one pending row per candidate to `discovered_organizations`:

- `candidate_key`, `source`, first/last seen timestamps, evidence rollup timestamps/counts, `name`, `website_url`, and a concise evidence-backed `description`.
- `suggested_us_network_status`: `us_based_organization`, `belgian_organization_with_us_presence`, `us_organization_connected_to_flanders`, or `institutional_connector`.
- `us_locations`: JSON items with city/state, role, label, description, source URL, evidence excerpt, confidence, and `is_primary`.
- `sectors`, `flemish_belgian_relevance`, canonical `flemish_fact_candidates` for identifiable entities, `source_urls`, `confidence`, `status = pending`, and `agent_run_id`.

`agent-discovery` extraction emits canonical Flemish/Belgian entity candidates with candidate aliases, role, source URL, evidence excerpt, confidence, and raw evidence when the page supports a specific entity. Vague relevance stays in raw evidence. Model-discovered aliases are stored as pending aliases for review and do not create broad filter chips.

Organization page evidence is stored separately in `discovered_organization_evidence` with the pending organization FK, optional `discovery_page_id`, a unique `evidence_key`, page/source metadata, excerpts, raw relevance/location/sector text, normalized location fields, confidence, and timestamps. Repeated evidence updates the pending organization's `evidence_count`, `last_evidence_at`, and `last_seen_at`; it does not promote the organization.

Each organization location requires direct evidence from an organization page, press release, trusted institutional page, or high-quality partner page. Expansion targets require explicit evidence of US expansion intent. People discovery may create organization pivots, but approved organization records require organization-specific evidence and review through `discovered_organizations`.

Manual Discovery intake and CSV/XLSX imports share the pending-candidate contract. People intake/import writes `discovered_contacts` with `source = manual` or `source = import`, candidate keys, source URLs, suggested US scope, optional US connection evidence, sectors, and Flemish/Belgian text. Organization intake/import writes `discovered_organizations` with `source = manual` or `source = import`, candidate keys, source URLs, sectors, US locations, Flemish/Belgian relevance, and `discovered_organization_evidence` rows when source evidence is supplied. Manual forms and CSV/XLSX templates do not ask staff to enter confidence scores; confidence is reserved for automated evidence assessment and reviewer judgment. These paths check approved and pending conflicts, refresh the pending review queues after writes, and never create or update approved `people` or `organizations`.

Discovery review has separate pending people and pending organization queues. People can be approved, rejected, or merged using the existing pending-contact review behavior; approval preserves pending provenance by writing `people.data_source = manual` for manual intake, `csv_import` for CSV/XLSX imports, and `ai_agent` for Discovery-created people. Person Flemish/Belgian approval or merge writes evidence-backed `person_flemish_connections` rows. Organization approval is reviewer-controlled: it writes the approved `organizations` row, `organization_sectors`, normalized `organization_us_locations`, normalized `organization_flemish_connections` rows from pending relevance text, review metadata on `discovered_organizations`, and then queues organization embeddings. Organization rejection leaves the approved organization tables unchanged. Organization merge updates the selected approved organization, adds sectors/locations and normalized Flemish/Belgian fact rows, records `approved_merge`, and queues organization embeddings.

Derived-label approval canonicalizes Flemish/Belgian labels through approved names and aliases before writing `person_flemish_connections`; it preserves confidence, evidence URL, evidence excerpt, and relationship role where available.

### Discovery telemetry presentation layer

Agent telemetry written to `agent_runs.results.steps` uses internal step IDs that may include parameterized suffixes (`page_extraction_<uuid>`, `linkedin_enrichment_2`, `frontier_process_<uuid>`). The `AgentDashboard` panel never renders these IDs raw; it routes them through `formatStepLabel` in `src/components/admin/AgentDashboard.tsx`, which strips a trailing `_<uuid>` or `_<n>` suffix and looks the prefix up in `STEP_LABELS`. New agent steps render readably without a UI code change as long as their ID prefix matches a known label, otherwise the cleaned prefix shows through. Step `params` values that are strings are displayed unescaped (`renderParamValue`); only non-string values are JSON-stringified. The full label table lives in `docs/PRODUCT-SERVICES.md` under "Discovery step-label vocabulary."

## Edge Function: `agent-verify`

Unified record verification with preview and durable modes.

Request shape:

- `mode`: `"preview"` or `"durable"` (default `"durable"`).
- `record_type`: `"person"`, `"organization"`, `"discovered_contact"`, or `"discovered_organization"` (default `"person"`).
- Preview mode: `record_id` is required. Returns suggestions for one record without persisting anything (no `profile_suggestions`, no `agent_runs`, no `derived_label_suggestions`, no `last_verified_at` bump).
- Durable mode (people): `person_ids?` or `person_id?` to target a batch, plus `batch_size?`, `max_age_months?`, and `run_id?` for scheduler integration. Writes reviewable suggestions to `profile_suggestions` with `record_type='person'`.
- Durable mode (organizations): `organization_ids?` or `organization_id?` to target a batch, plus `batch_size?`, `max_age_months?`, and `run_id?`. Writes reviewable suggestions to `profile_suggestions` with `record_type='organization'`.
- Verify-before-promote (discovered records): `record_type` is `"discovered_contact"` or `"discovered_organization"`, with `record_ids?` (batch) or `record_id?`, plus `run_id?`. The function flips each row to `verification_status='verifying'`, runs web search + Gemini enrichment, then either hard-deletes the row on contradiction or sets `verification_status='verified'` with a `verification_payload` (scope, location, role, employer, ties, evidence, confidence). Auto-enqueued by `agent-scheduler` housekeeping.

Behavior:

1. Person path uses LinkedIn-first evidence when available, falling back to trusted web search + Gemini `check_profile`.
2. Organization path uses web search + Gemini `check_organization` (fields: `name`, `description`, `website_url`, `type`). No LinkedIn scraping for organizations in this phase.
3. Discovered-record path uses web search + Gemini structured output. The prompt requires `network_scope` to be `null` when no clear residence/tie signal is present (no guessing). `contradiction=true` triggers a hard delete; ambiguity does not.
4. Suggestions are evidence-backed (source URL, evidence excerpt, confidence, method) and pass risk policy gates before being returned. High-risk fields stay review-first.
5. Suggestions are deduped per record by `dedupe_key`; the dedupe key is `field_name::normalized_value`. Higher-confidence or better-evidenced suggestions refresh existing rows instead of duplicating them.

### Verification approval guards (Phase 5C)

**Destination-locale guard.** The Flemish Network platform assumes persons of interest are US-based. When approving a `location_city` or `location_state` Profile Update Suggestion in `SuggestedChanges.tsx`, the UI inspects the destination state (combining the suggestion under review with any paired city/state suggestion and the person's existing location). If the destination is not a recognized US state name or code, the approval pauses and an in-app modal asks the staff user to confirm the move explicitly. Native `confirm()` is never used. Cancelling the modal aborts the approval with an explanatory error, leaving the suggestion pending.

**Risk vs Confidence presentation.** Risk and Confidence describe different things and must be shown together with a tooltip explaining precedence. **Risk** is the field's intrinsic sensitivity (set by `getSuggestionRisk` in `src/lib/verification.ts`: `bio` and `_status` are high-risk; `current_position`, `occupation`, `email`, `title`, names are medium-risk; everything else is low-risk). **Confidence** is the model's evidence strength for this specific suggestion. The Verification panel renders one combined chip in the form `Confidence 90% · Low-risk field` colored by risk, with an info icon whose `title` reads: "Confidence = how strong the evidence is. Risk = how sensitive the field is. Approve only when confidence is high AND the risk class is acceptable for this field." Both `SuggestedChanges.tsx` and `OrganizationSuggestedChanges.tsx` follow this contract.

**Bio diff layout.** Bio suggestions render as a vertical stack (strikethrough current value above, new value below, full width) instead of side-by-side, since prose does not fit in a 40%-width column.

## Edge Function: `update-profile`

Thin preview-mode wrapper for inline person verification (called by `ProfileUpdateModal`). Equivalent to `agent-verify { mode: "preview", record_type: "person", record_id: <personId> }`. Marked for retirement once callers move to the unified contract.

## Edge Function: `agent-scheduler`

Lifecycle and planning service.

- Actions: `trigger`, `cancel`, `housekeeping`, `metrics`, `planning`, `tick`, `set_schedule`, `list_schedules`
- Valid trigger `agent_type` values: `discovery`, `verification`
- Removed trigger values: `connection`
- `planning` feeds `/admin/growth`.
- `metrics` feeds `/admin/growth` quality and benchmark panels.
- `housekeeping` and `cancel` feed `/admin/system`. Housekeeping additionally (a) hard-deletes any `discovered_contacts`/`discovered_organizations` rows with `verification_status='queued'` and confidence below 0.05 and (b) auto-enqueues remaining queued rows for `agent-verify` in batches, marking them `verifying` so subsequent ticks dedupe. Counters: `pending_contacts_pre_filtered`, `pending_organizations_pre_filtered`, `pending_contacts_enqueued`, `pending_organizations_enqueued`.
- Verification dispatch falls back to `SUPABASE_SERVICE_ROLE_KEY` for the `agent-verify` invocation when the caller did not forward an `Authorization` header (e.g. anonymous housekeeping). Dispatch failures are persisted to `agent_runs.error_message`/`error_kind` (`auth_missing` or `network`) and increment `discovered_contacts.verification_attempts` / `discovered_organizations.verification_attempts`. At ≥3 attempts the row escalates to `verification_status='failed'` and is surfaced in `/admin/verification` rather than silently re-queued.
- Edge functions pin `npm:@supabase/supabase-js@2.57.4` in their imports. Floating `@2` tags can leave warm Deno workers stuck on a pre-rotation JWKS (kid mismatch → `auth_failed`). After any Auth signing-key rotation, redeploy every function in one pass (`supabase functions deploy --project-ref ofzuhajxwxggybkuzefq`) so every worker cold-starts and re-fetches JWKS.
- Prompted Discovery UI lives in the Discovery intake card and triggers only `agent-scheduler` with `{ action: "trigger", agent_type: "discovery", params: { query? } }`; prompt URL handoffs prefill the query but do not start a run.

### `planning` action — `recommended_actions` payload

Each item in `recommended_actions` carries rubric fields used by the Growth UI and EVALUATION.md rubric:

| Field | Type | Semantics |
|---|---|---|
| `rationale` | `string` | One sentence explaining why this action is valuable. |
| `basis.kind` | `"coverage_gap" \| "entity_pivot" \| "proven_domain"` | What signal generated this recommendation. The legacy `"source_pack"` basis was removed in Phase 2 of the Discovery Redesign on 2026-05-08. |
| `basis.key` | `string` | Domain name, gap geography key, or entity name. |
| `target.metro` | `string?` | Metro name when the recommendation targets a metro gap. |
| `target.state` | `string?` | State name when the recommendation targets a state gap. |
| `target.sector` | `string?` | Primary sector from gap `sector_emphasis`. |
| `target.domain` | `string?` | Domain when basis is `proven_domain` or `entity_pivot` has a domain. |
| `target.entity` | `string?` | Entity name when basis is `entity_pivot`. |
| `expected_yield` | `"high" \| "medium" \| "low"` | Derived from `yield_score` (proven domain) or approved contact count (entity pivot): `>0.6` / `>=3` → high, `>0.3` / `>=1` → medium, else low. |

Query templates per basis:
- `entity_pivot`: `site:${domain} ${entityName} (Belgian OR Flemish OR Vlaams)` — falls back to open-web form when no domain is available.
- `coverage_gap` / `gap_refresh`: `(Belgian OR Flemish) ${sector} ${metro/state label}`
- `proven_domain`: `site:${domain} (Belgian OR Flemish OR Vlaams) team OR faculty OR people`

Diversity caps: ≤2 recommendations per domain, ≤2 per metro; actions are sorted by `priority_score` before caps are applied.

Novelty filter: `discovery_domains` with `status = 'exhausted'` are excluded from domain recommendations.

Cooldown filter (Phase 8A): entity pivots and coverage gaps recommended within the last 72 hours are excluded from candidates. On each planning call, recommended pivots write `last_recommended_at = now()` and increment `recommended_count` on `discovery_entity_pivots`; recommended gaps write the same fields on `coverage_targets` (exposed through the `coverage_gaps` view). This ensures successive planning calls rotate to different top pivots and gaps.

### `housekeeping` action — pivot rebuild

Each `housekeeping` call (and on every other action as a side-effect) runs a daily pivot rebuild step that upserts canonical Flemish/Belgian entity pivots from `person_flemish_connections` where 2 or more approved people share the same connection. The step:

1. Queries `person_flemish_connections` joined to `flemish_connections` to find entities with 2+ approved-person associations.
2. Upserts rows into `discovery_entity_pivots` with `entity_key = flemish:<normalized_name>` on conflict, refreshing `last_seen_at` only — it intentionally does not reset cooldown fields.

This step should be triggered daily by calling `action: 'housekeeping'` from an external cron or operator action. The result is reported as `housekeeping.pivots_upserted`.

### `tick` action — scheduled cadence driver

`tick` is service-role-only (the Authorization bearer must be a JWT with `role=service_role` and matching project `ref`). It is invoked every 5 minutes by the `agent-scheduler-tick` pg_cron job. The job posts to `<project_url>/functions/v1/agent-scheduler` with `{ "action": "tick", "source": "pg_cron" }`, reading `project_url` and `service_role_key` from `vault.decrypted_secrets`.

For each row in `public.agent_schedules` where `cadence_preset != 'off'` and `next_run_at <= now()`:

- `discovery` and `verify_stale`: dispatched via `triggerAgentRunInternal` (same insert-then-fetch flow as manual triggers, but using service-role auth instead of forwarded user auth). Skipped with `last_status='skipped'` if a prior run for the same `agent_type` is still `pending` or `running`.
- `embeddings_drain`: invokes `generate-embeddings` with `{ kick: true, batch_size: 50 }` only when `embedding_jobs.status='pending'` count > 0; otherwise records `skipped_empty`.

After dispatch, the row's `last_run_at`, `last_run_id`, `last_status`, `last_error`, and `next_run_at` are updated. `next_run_at` is recomputed by `computeNextRunAt(jobKind, preset)`:

| Job | low | normal | high |
|---|---|---|---|
| `discovery` | 09:00 UTC daily | 09:00 + 21:00 UTC | 00/06/12/18 UTC |
| `verify_stale` | 5 contacts/day (every 4h 48m) | 15/day (~96 min) | 40/day (~36 min) |
| `embeddings_drain` | — | every 5 min when pending > 0 | — |

`embeddings_drain` only accepts `'normal'` or `'off'`. Discovery/verify_stale accept all four presets.

### `set_schedule` and `list_schedules` actions

- `list_schedules` (editor) returns all rows from `agent_schedules`; powers the System page schedule cards.
- `set_schedule` (admin) updates `cadence_preset` for a `job_kind` and recomputes `next_run_at`. Body: `{ job_kind, cadence_preset }`.

### Manual `trigger` min-interval guard

When `action: trigger` resolves to a job kind tracked by `agent_schedules` (i.e. `discovery` or `verify_stale` for non-discovered targets):

1. The scheduler first runs `markZombieRuns` so a stale `running` row whose heartbeat is older than 2 minutes is flipped to `failed` before its `last_run_at` timestamp is consulted. This prevents zombie rows from blocking fresh manual runs (UX_REMEDIATION Phase 1B).
2. It then reads `last_manual_at` and `last_run_at`; if either is within the last 10 minutes the call is rejected. Pass `force: true` in the body to bypass.
3. Successful manual triggers stamp `last_manual_at` and `last_manual_by` so multi-admin workspaces can see who clicked Run.

**Response envelope (in-body signaling, not HTTP status).** Edge functions must signal in the body because the supabase-js client surfaces non-2xx responses as `error: null` for many call sites. `agent-scheduler` returns HTTP 200 with one of:

- `{ status: "running", run_id, housekeeping }` — the run was created and dispatched to the downstream agent function.
- `{ status: "rejected", reason: "quota_exhausted", job_kind, wait_minutes, message, housekeeping: null }` — the min-interval guard fired; the UI should toast the `message` (informative) and keep the form state intact.
- `{ status: "cancelled" | "noop", run_id, housekeeping }` — for `action: "cancel"`.

UI contract: callers inspect `data?.status` and `data?.reason`. On `running` they toast success; on `rejected/quota_exhausted` they toast an info-level message; on any other shape they toast a generic "Discovery run did not start" error so the user always gets feedback. The Discovery intake textarea persists on submit so staff can re-run without retyping.

## Edge Function: `generate-embeddings`

Backend-owned embedding refresh for approved people and organizations. Person jobs still use `embedding_jobs`; organization jobs use the organization embedding queue when that schema is present. Manifests are record-level and include `entity_type`, `entity_id`, optional `person_id` / `organization_id`, document text, and chunk plans.

| Action/Flag | Behavior |
|---|---|
| `status_only` | Return outstanding queue count without processing |
| `entity_type: 'person' \| 'organization' \| 'all'` | Select person jobs, organization jobs, or a mixed queue; default is `person` for backwards compatibility |
| `person_ids` / `personIds` | Queue and target specific people |
| `organization_ids` / `organizationIds` | Queue and target specific organizations |
| `backfill: true` | Reconcile dirty rows for the selected entity type into queue, then claim a batch |
| `kick: true` | Claim a small batch immediately for the selected entity type |
| `action: 'start_batch'` | Offline Gemini Batch API lane with mixed person/organization manifests |
| `action: 'list_batches' \| 'poll_batch' \| 'cancel_batch'` | Manage offline batch runs |

Use Gemini context caching only when repeatedly sending large shared prefixes or reusable evidence sets. Use the offline batch path for large embedding refreshes that do not need interactive latency.

## Edge Function: `suggest-people`

Collection suggestion service. The deployed function name remains `suggest-people` for compatibility, but product copy should describe it as collection suggestions.

1. Takes `{ query, collection_id?, exclude_ids?, exclude_organization_ids?, max_results? }`.
2. Parses the collection goal with Gemini route `query_parsing`, which defaults to `gemini-2.5-flash-lite`.
3. Produces up to four focused searches, each targeting people, organizations, or both. Parser failure falls back to one search equal to the original prompt, targeting both people and organizations, with `gap.should_offer = false`.
4. Retrieves people through lexical search plus `gemini-embedding-001` original-query embeddings against `match_people` and `match_person_text_chunks`; degraded embedding coverage keeps lexical people search active.
5. Retrieves organizations through lexical search plus `match_organizations` and `match_organization_text_chunks` when organization embeddings are available.
6. Excludes current collection members when `collection_id` is supplied, plus rejected or already accepted draft IDs supplied as `exclude_ids` and `exclude_organization_ids`.
7. Reranks with Gemini route `search_rerank` (`gemini-2.5-flash`, `thinking_budget = 0`). Switched from `offline_evaluation`/`gemini-2.5-pro` on 2026-05-14 after benchmarking showed pro p50 ≈ 46 s vs flash-no-thinking p50 ≈ 11 s with no observable ranking-quality difference across four representative collection prompts. Reranked IDs are validated against retrieved candidates; unknown IDs are ignored.
8. Backfills by deterministic retrieved score order when reranking fails or returns too few valid candidates.
9. Returns `{ message, searches, candidates, gap }`, plus legacy `suggestions` for people-only callers.

Each `candidates` item includes `entity_type = "person" | "organization"`, `id`, `name`, `reason`, `score`, optional `snippet`, and `source_search`. `gap.should_offer` may include `reason` and `suggested_prompt` for a staff-controlled handoff to `/admin/discovery?prompt=<encoded prompt>`; the function never starts Discovery.

### `suggest-people` response envelope (Phase 3A)

The UI parses the response through a hand-rolled schema (`parseSuggestPeopleResponse` in `src/lib/aiService.ts`) that returns safe defaults on every branch — `gap` defaults to `{ should_offer: false }`, missing `candidates`/`suggestions` collapse to `[]`, malformed entries are dropped. This eliminates the "`Cannot read properties of undefined (reading 'rest')`" class of crashes when the model returns an unexpected shape.

**Edge functions must return validated shapes; the UI converts thrown errors into friendly banners, never raw JS messages.** Both Collection call sites (`CollectionModal`, `CollectionDetail`) wrap suggestion calls and surface the fixed copy "Suggestions unavailable — please retry." When the server-side `parseCollectionSuggestionPlan` or `parseRerankedCollectionCandidates` parser throws, `suggest-people` logs the raw model output (truncated to 4 KB) so we can diagnose without leaking implementation detail to staff.

Phase 4 Collections does not add autonomous Discovery, canonical organization Flemish/Belgian facts, persistent gap analytics, or persistent draft tables. Draft approval/rejection state is client-side until staff save accepted candidates into `collection_members`; `/collections/:id` may cache that client draft in browser storage so suggestions survive route revisits without becoming durable database rows.

## Legacy Removal

Removed from the product surface:

- Profile graph section and graph modal
- Connection scheduler controls
- `agent-connections`
- `connections` / `connection_suggestions` UI usage
- `discover_connections()` scheduling path

Retired in Phase 5:

- Legacy Discovery compatibility edge functions.
- Legacy `ai-agent` Discovery parsing/search tasks.

## Known Work

- Add organization discovery review and organization verification.
- Normalize Flemish/Belgian facts into canonical, filterable entities with evidence.
- Keep Admin, map, XLSX export, and heavy staff panels under the build chunk warning budget as new features land.
