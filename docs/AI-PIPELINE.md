# AI Pipeline Reference

## Gemini Model Routing
Defined in `supabase/functions/_shared/gemini.ts`. Production defaults:

| Route | Default Model | Env Override |
|---|---|---|
| `query_parsing`, `page_classification` | `gemini-2.5-flash-lite` | `GEMINI_FLASH_LITE_MODEL`, `GEMINI_QUERY_MODEL`, `GEMINI_CLASSIFICATION_MODEL` |
| `contact_extraction`, `profile_verification` | `gemini-2.5-flash` | `GEMINI_FLASH_MODEL`, `GEMINI_EXTRACTION_MODEL`, `GEMINI_PROFILE_MODEL` |
| `lightweight_text_merge`, `offline_evaluation` | `gemini-2.5-pro` | `GEMINI_PRO_MODEL`, `GEMINI_MERGE_MODEL`, `GEMINI_EVAL_MODEL` |
| embeddings | `gemini-embedding-001` | `GEMINI_EMBEDDING_MODEL` (changing requires full re-embed) |

Gemini 3.x preview models are not operational defaults — use per-route env overrides for evaluation lanes only.

`_shared/gemini.ts` also exposes Gemini context-cache helpers, used selectively inside `agent-discovery` on repeated extraction retries.

## Edge Function: `ai-agent`
Central LLM orchestrator. Accepts `{ task, context }`. Uses Gemini structured output via shared helpers in `_shared/`.

| Task | Status | Input | Output |
|---|---|---|---|
| `smart_search` | Active | `{ query }` | `{ message, keywords: { name[], occupation[], sector[], location_city[], location_state[], current_position[], flemish_connection[], bio[] } }` |
| `merge_text` | Active | `{ texts[] }` | `{ result }` |
| `check_profile` | Active | `{ person, searchResults }` | `{ suggestions: [{ field_name, current_value, suggested_value, source }] }` |
| `parse_contacts` | **Legacy frozen** | `{ description, sectors }` | `{ message, contacts[] }` |
| `flemish_search` | **Legacy frozen** | `{ query }` | `{ message, keywords: { flemish_connection[], bio[] } }` |

## Edge Function: `search-people`
Server-side routed hybrid search for Dashboard NL queries.

1. Takes `{ query, max_results }`. Attempts Gemini keyword extraction + query embedding in parallel; degrades to lexical-only if unavailable.
2. Classifies query into `direct_lookup`, `faceted`, or `exploratory` via `_shared/searchRouting.ts`.
3. Calls `search_people_lexical()` (lexical top-K from `people_search_documents`), `match_people()` (person-level vector), and `match_person_text_chunks()` (chunk-level vector) independently.
4. Fuses ranked lists via reciprocal-rank + exact-name/field/chunk boosts.
5. Generates snippets from the winning field or matched chunk text.
6. Returns `{ results, keywords, route, degraded, diagnostics, message, total_with_embeddings }`.

## Edge Function: `discover-contacts`
Ad hoc web discovery for operators. (`search-contacts` is a legacy alias.)

1. Takes `{ query }` → appends "(flemish/belgian professional)" → calls Tavily (advanced, 10 results).
2. Feeds results to Gemini for structured extraction.
3. Dedup-checks against `people` (email, LinkedIn URL, normalized name).
4. Returns `{ message, contacts[] }` with `is_duplicate` flags.

## Edge Function: `update-profile`
Single-person ad hoc preview. Does **not** write durable `profile_suggestions` rows.

1. Takes `{ personId }` or `{ personIds }` → fetches person from DB.
2. Searches Tavily for `"{name} {position} {city}"`.
3. Runs the shared `check_profile` Gemini contract locally (not via `ai-agent` HTTP hop).
4. Returns inline suggestions to `ProfileUpdateModal`.

## Edge Function: `agent-verify`
Durable batch verification — writes `profile_suggestions` rows. LinkedIn-first flow.

1. Takes `{ personIds?, batch_size? }` (default 5 to stay inside edge timeout).
2. For people with `linkedin_url`: Apify scrape → deterministic field diff (position, location, bio, photo).
3. Fallback when LinkedIn unavailable: Tavily web search + shared `check_profile` Gemini contract.
4. Writes `profile_suggestions` with `method`, `confidence`, `evidence_url`.
5. Can write advisory `field_name = '_status', suggested_value = 'may_have_left_us'` suggestions — approving these must not try to write an unknown column onto `people`.
6. Suggests `profile_photo_url` when Apify returns a photo and none is stored.

## Edge Function: `agent-discovery`
Bounded adaptive frontier crawler.

1. Takes `{ query?, run_id, batch_size? }`.
2. Seeds `discovery_frontier` from: custom query, due `discovery_source_packs`, or evidence-backed entity pivots (blank-query pass reserves space for proven pivots).
3. Claims 10-20 frontier URLs via `claim_discovery_frontier()`, fetches each page, canonicalizes/stores in `discovery_pages`.
4. Classifies heuristically first; Gemini fallback for ambiguous pages only.
5. Runs Gemini extraction on promising pages only. Writes evidence to `discovery_evidence`, merges into `discovered_contacts` via durable `candidate_key` (falls back to identity heuristics).
6. Upserts `derived_label_suggestions` for new/refreshed candidates.
7. Uses Apify LinkedIn as limited post-extraction enrichment only — not as a seed lane.
8. Persists entity pivots (orgs/labs/programs/events from strong candidates), queues same-domain child links.
9. Enforces per-domain weekly budgets and per-run caps. Revisits due `done` frontier rows.
10. Transient Gemini/fetch failures → `upstream_retry` (not hard failure). Retries `429`/`5xx`/timeout with backoff + smaller prompt budget.
11. Writes full telemetry to `agent_runs.results`.

## Edge Function: `agent-connections`
Pure-SQL wrapper around `discover_connections()` RPC. No LLM or web search.

1. Takes optional `{ types, run_id, generate_soft_suggestions }`.
2. Calls `discover_connections()` one relationship type per invocation (avoids DB statement timeout).
3. Computes and inserts hard edges for: `colleague`, `alumni`, `program_peer`, `local_peer`, `lab_peer`, `event_peer`.
4. Separately scans chunk-vector similarity to upsert `connection_suggestions` (soft affinity only).
5. Writes telemetry to `agent_runs` with per-type counts + suggestion counts.

## Edge Function: `agent-scheduler`
Single lifecycle-control path for all agent runs.

- Actions: `run` (dispatch), `cancel`, `cleanup` (zombie), `metrics`, `planning`
- Dispatches downstream functions while forwarding the caller's `Authorization`/`apikey` headers.
- Exposes `metrics` action consumed by `OpsMetricsPanel` in Admin Agents tab.
- Exposes `planning` action consumed by `DiscoveryPlanningPanel` (gap metrics, entity pivots, refill history).

## Edge Function: `geocode`
1. Accepts `{ pairs: [{ city, state }] }` (legacy) or `{ candidates: [{ raw_text, city?, state? }] }` (max 25).
2. Parses raw text deterministically, checks `locations` cache first.
3. Geocodes US candidates via Nominatim (rate-limited per request).
4. Caches/updates `locations` with nullable coordinates + `geocode_source`/`geocoded_at`.
5. Returns `{ parser_confidence, geocoded, review_required, location_id }` per candidate.

## Edge Function: `generate-embeddings`
Asynchronous backend-owned embedding refresh via `embedding_jobs` queue.

| Action/Flag | Behavior |
|---|---|
| `status_only` | Return outstanding queue count without processing |
| `backfill: true` | Reconcile dirty `people` rows into queue, then claim a batch |
| `kick: true` | Claim a small batch immediately (best-effort nudge from frontend saves) |
| `action: 'start_batch'` | Offline lane: create async Gemini Batch API job, persist manifest in `embedding_batch_runs` |
| `action: 'list_batches' \| 'poll_batch' \| 'cancel_batch'` | Manage offline batch runs without exposing internal table to public client |

Each job builds: labeled embedding document + `person_text_chunks` embeddings (`bio`, `position`, `combined`). Requeues if `embedding_dirty_at` changed mid-flight.

## Edge Function: `suggest-people`
Collection suggestion via embeddings + Gemini reranking.

1. Takes collection context (members + query seed including occupation/bio).
2. Calls `match_people()` (person-level vector) and `match_person_text_chunks()` (chunk-level vector).
3. Rolls chunk matches back up to candidate people.
4. Gemini reranks candidates.
5. Returns explicit error/message text on failure (does not silently return empty list).

## Frontend AI Functions (`src/lib/aiService.ts`)

| Function | Target | Notes |
|---|---|---|
| `hybridSearch(query, maxResults)` | `search-people` | Primary Dashboard NL search path. Falls back to client-side scoring on failure. |
| `discoverContacts(query)` | `discover-contacts` | Ad hoc operator discovery. `searchContacts()` is a compat alias. |
| `smartSearch(query)` | `ai-agent` smart_search | |
| `suggestPeopleEmbedding(query, options)` | `suggest-people` | Collection suggestions. |
| `parseContacts(description, sectors)` | `ai-agent` parse_contacts | Legacy frozen. |
| `flemishSearch(query)` | `ai-agent` flemish_search | Legacy frozen. |
| `suggestPeople(query)` | client-side keyword scoring | Fallback only when edge functions fail. |
| `scorePersonAgainstKeywords(person, keywords)` | — | Weighted field matching for fallback path. |
| `logSearchClick(query, personId)` | `search_clicks` table | Fire-and-forget relevance feedback. |

## Known Bugs
- **Build size:** JS bundle is ~688kb (192kb gzipped), above Vite's 500kb warning threshold.
- **25 console.log/error/warn calls in production code** across 9 frontend files. Should use a proper logger or be removed.
- **9 `alert()` calls as error handling** in PersonProfile, OrganizationProfile, CollectionDetail. Should be replaced with toast/snackbar UI.
- **`@types/leaflet` and `@types/leaflet.markercluster` in `dependencies`** instead of `devDependencies` in `package.json`.
