# AI Pipeline Reference

## Service Map

| Product service | Route/UI | Edge/API owner | Notes |
|---|---|---|---|
| Search The Network | `/` | `search-people` | Server-side routed hybrid people search. Organization search is moving server-side next. |
| Build A Collection | `/collections`, `/collections/:id` | `suggest-people` | Uses existing records only. Target workflow adds draft approval and organization candidates. |
| Expand The Database | `/admin/discovery` | `agent-scheduler` -> `agent-discovery` | Prompted and autonomous discovery. Evidence-first review queues; no auto-promotion. |
| Verify And Enrich Records | `/admin/verification` | `agent-verify`, `update-profile` preview | Target is one verification service with preview and durable modes. |
| Understand And Grow The Network | `/admin/growth` | `agent-scheduler` planning/metrics | Coverage gaps, source yield, entity pivots, and recommended next discovery actions. |
| System | `/admin/system` | `agent-scheduler`, `generate-embeddings` | Health, queues, cancellation, housekeeping, API usage. |

## Behavioral Contracts

- `agent-scheduler` owns `agent_runs` lifecycle for discovery and verification. UI must not insert/update run rows directly.
- `agent-scheduler` rejects `agent_type = "connection"`; the person-to-person connection service has been removed.
- `agent-discovery` is the durable Discovery service. Prompted discovery must call `agent-scheduler` with `agent_type = "discovery"`, not `discover-contacts`.
- `agent-verify` owns durable verification suggestions.
- `update-profile` is preview mode only for inline profile checks and must not write durable suggestion rows.
- `derived_label_suggestions` remains the review queue for inferred sectors, occupations, Flemish/Belgian entities, locations, and confidence before promotion.
- `person_sectors` / `person_flemish_connections` have insert/delete RLS policies but no update. Use conflict-ignore insert semantics (`ignoreDuplicates`) for idempotent writes.
- `ai-agent` active tasks are `smart_search`, `merge_text`, and `check_profile`. `parse_contacts` and `flemish_search` are legacy and should not be used by new UI.
- `discover-contacts` and `search-contacts` are legacy compatibility functions and are not product routes.

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
| `query_parsing`, `page_classification` | `gemini-2.5-flash-lite` | `GEMINI_FLASH_LITE_MODEL`, `GEMINI_QUERY_MODEL`, `GEMINI_CLASSIFICATION_MODEL` |
| `contact_extraction`, `profile_verification` | `gemini-2.5-flash` | `GEMINI_FLASH_MODEL`, `GEMINI_EXTRACTION_MODEL`, `GEMINI_PROFILE_MODEL` |
| `lightweight_text_merge`, `offline_evaluation` | `gemini-2.5-pro` | `GEMINI_PRO_MODEL`, `GEMINI_MERGE_MODEL`, `GEMINI_EVAL_MODEL` |
| embeddings | `gemini-embedding-001` | `GEMINI_EMBEDDING_MODEL` |

## Edge Function: `search-people`

Server-side routed hybrid search for Search.

1. Takes `{ query, max_results }`.
2. Runs Gemini keyword extraction and embedding in parallel, degrading to lexical-only when needed.
3. Classifies query through `_shared/searchRouting.ts`.
4. Calls lexical, person-vector, and text-chunk retrieval.
5. Fuses ranked lists and returns snippets.

## Edge Function: `agent-discovery`

Durable Discovery.

1. Takes `{ query?, run_id, batch_size? }`.
2. Seeds and claims `discovery_frontier` from prompts, source packs, or evidence-backed pivots.
3. Fetches pages, stores `discovery_pages`, classifies pages, extracts candidates, and stores evidence.
4. Merges people into `discovered_contacts` and target organizations into `discovered_organizations`.
5. Writes `derived_label_suggestions`, entity pivots, follow-up searches, and telemetry.
6. Never auto-promotes candidates into approved `people` or `organizations`.

Discovery operating principles:

- Treat web search as a way to seed the frontier, not as the evidence substrate.
- Crawl as a bounded best-first frontier: `seed -> frontier -> fetch -> classify -> extract -> expand -> review -> revisit`.
- Extract from individual pages with source URLs and excerpts so reviewers can audit every candidate.
- Use source packs for head coverage; use high-yield domains, same-domain child links, sitemap/RSS URLs, entity pivots, and coverage gaps for adaptive expansion.
- Use LinkedIn as post-extraction enrichment after a page or candidate is already interesting, not as the main seed lane.
- Generate entity pivots only from evidence-bearing entities, then feed those pivots into Network Growth planning.

Organization discovery writes one pending row per candidate to `discovered_organizations`:

- `name`, `website_url`, and a concise evidence-backed `description`.
- `suggested_us_network_status`: `us_based_organization`, `belgian_organization_with_us_presence`, `us_organization_connected_to_flanders`, or `institutional_connector`.
- `us_locations`: JSON items with city/state, role, label, description, source URL, evidence excerpt, confidence, and `is_primary`.
- `sectors`, `flemish_belgian_relevance`, `source_urls`, `confidence`, `status = pending`, and `agent_run_id`.

Each organization location requires direct evidence from an organization page, press release, trusted institutional page, or high-quality partner page. Expansion targets require explicit evidence of US expansion intent. People discovery may create organization pivots, but approved organization records require organization-specific evidence and review through `discovered_organizations`.

## Edge Function: `agent-verify`

Durable verification.

1. Takes `{ personIds? | person_ids?, batch_size? }`.
2. Uses LinkedIn-first evidence when available, falling back to trusted web search.
3. Writes reviewable suggestions with method, confidence, evidence URL, and evidence excerpt.
4. Target expansion includes organization verification and a record-level suggestion queue.

## Edge Function: `agent-scheduler`

Lifecycle and planning service.

- Actions: `trigger`, `cancel`, `housekeeping`, `metrics`, `planning`
- Valid trigger `agent_type` values: `discovery`, `verification`
- Removed trigger values: `connection`
- `planning` feeds `/admin/growth`.
- `metrics` feeds `/admin/growth` quality and benchmark panels.
- `housekeeping` and `cancel` feed `/admin/system`.

## Edge Function: `generate-embeddings`

Backend-owned embedding refresh through `embedding_jobs`.

| Action/Flag | Behavior |
|---|---|
| `status_only` | Return outstanding queue count without processing |
| `backfill: true` | Reconcile dirty `people` rows into queue, then claim a batch |
| `kick: true` | Claim a small batch immediately |
| `action: 'start_batch'` | Offline Gemini Batch API lane |
| `action: 'list_batches' \| 'poll_batch' \| 'cancel_batch'` | Manage offline batch runs |

Use Gemini context caching only when repeatedly sending large shared prefixes or reusable evidence sets. Use the offline batch path for large embedding refreshes that do not need interactive latency.

## Edge Function: `suggest-people`

Collection suggestion via embeddings and Gemini reranking. Current output is people-only; target output includes organizations and an approval/rejection draft workflow.

## Legacy Removal

Removed from the product surface:

- Profile graph section and graph modal
- Connection scheduler controls
- `agent-connections`
- `connections` / `connection_suggestions` UI usage
- `discover_connections()` scheduling path

Legacy compatibility still present until follow-up migrations/functions are removed:

- `discover-contacts`
- `search-contacts`
- `ai-agent` tasks `parse_contacts` and `flemish_search`

## Known Work

- Move organization search server-side with ranked snippets.
- Add organization collection membership and collection draft approval.
- Add organization discovery review and organization verification.
- Normalize Flemish/Belgian facts into canonical, filterable entities with evidence.
- Code-split Admin, map, XLSX export, and heavy staff panels to remove the Vite chunk warning.
