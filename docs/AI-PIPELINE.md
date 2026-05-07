# AI Pipeline Reference

## Service Map

| Product service | Route/UI | Edge/API owner | Notes |
|---|---|---|---|
| Search The Network | `/` | `search-people` | Server-side routed hybrid people search plus Phase 3 lexical organization search. |
| Build A Collection | `/collections`, `/collections/:id` | `suggest-people` | Collection suggestion service over existing approved people and organizations. Suggestions remain draft-only until staff approval. |
| Expand The Database | `/admin/discovery` | `agent-scheduler` -> `agent-discovery` | Prompted and autonomous discovery. Evidence-first review queues; no auto-promotion. |
| Verify And Enrich Records | `/admin/verification` | `agent-verify`, `update-profile` preview | Target is one verification service with preview and durable modes. |
| Understand And Grow The Network | `/admin/growth` | `agent-scheduler` planning/metrics | Coverage gaps, source yield, entity pivots, and recommended next discovery actions. |
| System | `/admin/system` | `agent-scheduler`, `generate-embeddings` | Health, record-index queues, cancellation, housekeeping, API usage. |
| Staff Access | `/admin/access` | `invite-staff-user`, Supabase Auth | Admin-only staff invitation and role/status management. |

## Behavioral Contracts

- Staff login uses Supabase Auth email/password. Magic-link login is not part of the active auth flow.
- `invite-staff-user` is the only frontend-facing staff invitation endpoint. It requires admin staff auth, writes the approved `staff_users` row with `password_reset_required = true`, and delegates email delivery/user invitation to Supabase Auth `inviteUserByEmail`.
- `agent-scheduler` owns `agent_runs` lifecycle for discovery and verification. UI must not insert/update run rows directly.
- `agent-scheduler` rejects `agent_type = "connection"`; the person-to-person connection service has been removed.
- `agent-discovery` is the durable Discovery service. Prompted discovery must call `agent-scheduler` with `agent_type = "discovery"`; retired Discovery compatibility endpoints must not be reintroduced.
- `/admin/discovery?prompt=<encoded prompt>` is a staff-controlled handoff only: it pre-fills the Discovery intake prompt box and must not call `agent-scheduler` until staff explicitly starts Discovery.
- `agent-verify` owns durable verification suggestions.
- `update-profile` is preview mode only for inline profile checks and must not write durable suggestion rows.
- `derived_label_suggestions` remains the review queue for inferred sectors, occupations, Flemish/Belgian entities, locations, and confidence before promotion.
- `person_sectors` / `person_flemish_connections` have insert/delete RLS policies but no update. Use conflict-ignore insert semantics (`ignoreDuplicates`) for idempotent writes.
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
| `query_parsing`, `page_classification` | `gemini-2.5-flash-lite` | `GEMINI_FLASH_LITE_MODEL`, `GEMINI_QUERY_MODEL`, `GEMINI_CLASSIFICATION_MODEL` |
| `contact_extraction`, `profile_verification` | `gemini-2.5-flash` | `GEMINI_FLASH_MODEL`, `GEMINI_EXTRACTION_MODEL`, `GEMINI_PROFILE_MODEL` |
| `lightweight_text_merge`, `offline_evaluation` | `gemini-2.5-pro` | `GEMINI_PRO_MODEL`, `GEMINI_MERGE_MODEL`, `GEMINI_EVAL_MODEL` |
| embeddings | `gemini-embedding-001` | `GEMINI_EMBEDDING_MODEL` |

## Edge Function: `search-people`

Server-side Search The Network endpoint for approved people and organizations.

1. Takes `{ query, max_results, match_mode?, filters? }`.
2. Supported filters include `show_people`, `show_organizations`, `sector`, `person_scope`, `occupation`, `city`, `state`, and `flemish_connections`.
3. Runs Gemini keyword extraction and original-query embedding in parallel, degrading to lexical-only when needed.
4. Parses shared search intent, preserving `original_query` for semantic retrieval while using canonical structured terms for lexical retrieval.
5. Calls people and organization lexical, record-vector, and text-chunk retrieval, then fuses those ranking signals.
6. Applies structured criteria coverage for sector, location, occupation/type, and Flemish/Belgian relevance.
7. Returns `{ results, people, organizations, keywords, match_mode, route, degraded, diagnostics, message, total_with_embeddings }`.

Each item in `results` includes `entity_type`, `id`, `name`, `score`, `snippet`, and `rationale`. `entity_type = "person"` rows preserve the people fields used by the existing UI; `entity_type = "organization"` rows include organization type, description, website/logo, `flemish_link`, US network status, and US locations. Search and profile surfaces can add approved people or organizations to Collections.

## Edge Function: `agent-discovery`

Durable Discovery.

1. Takes `{ query?, run_id, batch_size? }`.
2. Seeds and claims `discovery_frontier` from prompts, source packs, or evidence-backed pivots.
3. Fetches pages, stores `discovery_pages`, classifies pages, extracts candidates, and stores evidence.
4. Merges people into `discovered_contacts` and target organizations into `discovered_organizations`.
5. Writes `derived_label_suggestions`, entity pivots, follow-up searches, and telemetry.
6. Returns people metrics plus organization insert, merge, and duplicate metrics for Discovery dashboard history. Never auto-promotes candidates into approved `people` or `organizations`.

Discovery operating principles:

- Treat web search as a way to seed the frontier, not as the evidence substrate.
- Crawl as a bounded best-first frontier: `seed -> frontier -> fetch -> classify -> extract -> expand -> review -> revisit`.
- Extract from individual pages with source URLs and excerpts so reviewers can audit every candidate.
- Use source packs for head coverage; use high-yield domains, same-domain child links, sitemap/RSS URLs, entity pivots, and coverage gaps for adaptive expansion.
- Use LinkedIn as post-extraction enrichment after a page or candidate is already interesting, not as the main seed lane.
- Generate entity pivots only from evidence-bearing entities, then feed those pivots into Network Growth planning.

Organization discovery writes one pending row per candidate to `discovered_organizations`:

- `candidate_key`, `source`, first/last seen timestamps, evidence rollup timestamps/counts, `name`, `website_url`, and a concise evidence-backed `description`.
- `suggested_us_network_status`: `us_based_organization`, `belgian_organization_with_us_presence`, `us_organization_connected_to_flanders`, or `institutional_connector`.
- `us_locations`: JSON items with city/state, role, label, description, source URL, evidence excerpt, confidence, and `is_primary`.
- `sectors`, `flemish_belgian_relevance`, `source_urls`, `confidence`, `status = pending`, and `agent_run_id`.

Organization page evidence is stored separately in `discovered_organization_evidence` with the pending organization FK, optional `discovery_page_id`, a unique `evidence_key`, page/source metadata, excerpts, raw relevance/location/sector text, normalized location fields, confidence, and timestamps. Repeated evidence updates the pending organization's `evidence_count`, `last_evidence_at`, and `last_seen_at`; it does not promote the organization.

Each organization location requires direct evidence from an organization page, press release, trusted institutional page, or high-quality partner page. Expansion targets require explicit evidence of US expansion intent. People discovery may create organization pivots, but approved organization records require organization-specific evidence and review through `discovered_organizations`.

Manual Discovery intake and CSV/XLSX imports share the pending-candidate contract. People intake/import writes `discovered_contacts` with `source = manual` or `source = import`, candidate keys, source URLs, suggested US scope, optional US connection evidence, sectors, and Flemish/Belgian text. Organization intake/import writes `discovered_organizations` with `source = manual` or `source = import`, candidate keys, source URLs, sectors, US locations, Flemish/Belgian relevance, and `discovered_organization_evidence` rows when source evidence is supplied. Manual forms and CSV/XLSX templates do not ask staff to enter confidence scores; confidence is reserved for automated evidence assessment and reviewer judgment. These paths check approved and pending conflicts, refresh the pending review queues after writes, and never create or update approved `people` or `organizations`.

Discovery review has separate pending people and pending organization queues. People can be approved, rejected, or merged using the existing pending-contact review behavior; approval preserves pending provenance by writing `people.data_source = manual` for manual intake, `csv_import` for CSV/XLSX imports, and `ai_agent` for Discovery-created people. Organization approval is reviewer-controlled: it writes the approved `organizations` row, `organization_sectors`, normalized `organization_us_locations`, `organizations.flemish_link`, review metadata on `discovered_organizations`, and then queues organization embeddings. Organization rejection leaves the approved organization tables unchanged. Organization merge updates the selected approved organization, adds sectors/locations, records `approved_merge`, and queues organization embeddings.

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
- Prompted Discovery UI lives in the Discovery intake card and triggers only `agent-scheduler` with `{ action: "trigger", agent_type: "discovery", params: { query? } }`; prompt URL handoffs prefill the query but do not start a run.

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
7. Reranks with Gemini route `offline_evaluation`, which defaults to `gemini-2.5-pro`. Reranked IDs are validated against retrieved candidates; unknown IDs are ignored.
8. Backfills by deterministic retrieved score order when reranking fails or returns too few valid candidates.
9. Returns `{ message, searches, candidates, gap }`, plus legacy `suggestions` for people-only callers.

Each `candidates` item includes `entity_type = "person" | "organization"`, `id`, `name`, `reason`, `score`, optional `snippet`, and `source_search`. `gap.should_offer` may include `reason` and `suggested_prompt` for a staff-controlled handoff to `/admin/discovery?prompt=<encoded prompt>`; the function never starts Discovery.

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
