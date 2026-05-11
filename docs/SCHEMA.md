# Database Schema Reference

## Core Tables

| Table | Key Columns | Notes |
|---|---|---|
| `people` | `id`, `name`, `title`, `first_name`, `last_name`, `current_position`, `organization_id` (FK), `location_id` (FK→locations), `us_network_status`, `current_location_city`, `current_location_country`, `occupation`, `bio`, `profile_photo_url`, `available_for_lectures`, `open_to_mentorship`, `welcomes_visits`, `preferred_contact`, `email`, `email_verified`, `linkedin_url`, `website_url`, `twitter_url`, `data_source`, `last_verified_at`, `created_at`, `updated_at` | Main entity. `phone` was dropped (migration `20260508000010_drop_phone_from_people.sql`) — the field is no longer collected or meaningful. `location_id` is the current US base for `us_based` people only. `us_connected_abroad` people use abroad display fields plus `person_us_connections`. No inline location columns; no scalar `flemish_connection`. Flemish ties normalized via `person_flemish_connections`. `data_source` preserves approved-profile provenance such as `manual`, `csv_import`, `ai_agent`, and legacy `discovery_agent`. |
| `organizations` | `id`, `name`, `type`, `description`, `logo_url`, `website_url`, `location_id` (FK→locations), `us_network_status`, `embedding`, `embedding_dirty_at`, `embedding_generated_at`, `created_at`, `updated_at` | `location_id` is optional primary US location only. Full map placement uses `organization_us_locations`. Organization embeddings support approved organization semantic search. Approved organization Flemish/Belgian facts use `organization_flemish_connections` for profile display, profile edits, Discovery approval/merge, collection previews, search, and embeddings. |
| `locations` | `id`, `city`, `state`, `latitude`, `longitude`, `geocode_source`, `geocoded_at` | UNIQUE(city, state). `latitude`/`longitude` nullable (pending geocode or ambiguous). |
| `sectors` | `id`, `name` (unique) | Seeded: Artificial Intelligence, Biotechnology, Finance, Culture & Arts, Education, Research |
| `flemish_connections` | `id`, `name`, `normalized_name`, `entity_type`, `type` (legacy compatibility), `parent_id`, `connection_group`, `is_filterable`, `created_at`, `updated_at` | Canonical Flemish/Belgian fact catalog. `name` is the stable display label; `normalized_name` is the uniqueness/lookup key. `entity_type` is the current canonical category; legacy `type` remains compatibility only while source paths migrate. `parent_id` and `connection_group` support grouped catalog entries. `is_filterable = true` only for broad entities that may appear as default filter chips. Seeded filterable entities include KU Leuven, UGent, imec, BAEF, Flemish Government, FIT, VUB, Vlerick, VITO, Flanders Make, and VIB. |
| `flemish_connection_aliases` | `id`, `flemish_connection_id` (FK), `alias`, `normalized_alias`, `source`, `status`, `confidence`, `source_url`, `evidence_excerpt`, `created_at`, `updated_at` | Dynamic alias table for seeded, staff-approved, model-discovered, and migration aliases. Approved aliases resolve to their canonical `flemish_connections` row; model/import-discovered aliases can be stored without silently creating new filter chips. `University of Ghent` resolves to `UGent`; FIT expansions resolve to the canonical FIT catalog row. `normalized_alias` is unique where active/approved alias status allows canonical lookup. |
| `staff_users` | `id`, `user_id` (FK→auth.users), `email`, `full_name`, `avatar_url`, `role`, `status`, `password_reset_required`, `last_sign_in_at`, `created_at`, `updated_at` | App-user auth/authz. Intentionally separate from `people`. Roles: `viewer`, `editor`, `admin`. Viewers can search/read, editors can maintain approved and pending network records, and admins can manage staff access plus permanent approved contact deletion. Statuses: `invited`, `active`, `disabled`. `password_reset_required` forces invited staff through account password setup before they can use other routes. |

## Junction Tables

| Table | Keys |
|---|---|
| `person_sectors` | `(person_id, sector_id)` PK |
| `organization_sectors` | `(organization_id, sector_id)` PK |
| `person_flemish_connections` | `(person_id, flemish_connection_id)` PK plus `role`, `confidence`, `source_url`, `evidence_excerpt`, `created_at`, `updated_at` |
| `organization_flemish_connections` | `(organization_id, flemish_connection_id)` PK plus `role`, `confidence`, `source_url`, `evidence_excerpt`, `created_at`, `updated_at` |
| `person_us_connections` | `id`, `person_id` (FK), `location_id` (FK), `connection_label`, `source_url`, `evidence_excerpt`, `confidence` |
| `organization_us_locations` | `id`, `organization_id` (FK), `location_id` (FK), `location_role`, `label`, `description`, `source_url`, `evidence_excerpt`, `confidence`, `is_primary` |

## Collections

| Table | Key Columns |
|---|---|
| `collections` | `id`, `name`, `description`, `created_at`, `updated_at` |
| `collection_members` | `id`, `collection_id` (FK), nullable `person_id` (FK), nullable `organization_id` (FK), `notes`, `added_at`. Exactly one of `person_id` or `organization_id` is required. Partial unique indexes prevent duplicate people and duplicate organizations independently per collection. |

Collection suggestion drafts are not persisted to database tables in Phase 4. Rejected and accepted draft candidate IDs stay in client state and request payloads until staff reset the draft or save accepted members; the collection detail route may keep a per-collection browser cache of that draft for route revisits.

## AI & Suggestions

| Table | Key Columns |
|---|---|
| `profile_suggestions` | Record-level suggestion queue for people and organizations. Columns: `id`, `record_type` (`'person'` or `'organization'`), `person_id` (nullable FK people), `organization_id` (nullable FK organizations), `field_name`, `current_value`, `suggested_value`, `source`, `status`, `evidence_url`, `evidence_excerpt`, `confidence`, `method`, `agent_run_id`, `dedupe_key`, `reviewed_at`. CHECK constraint enforces exactly one of (`person_id`, `organization_id`) is set and matches `record_type`. Indexes: `idx_profile_suggestions_organization`, `idx_profile_suggestions_pending_dedupe_org`, `idx_profile_suggestions_record_type_status`. Cosmetic rename to `record_suggestions` is deferred. |
| `derived_label_suggestions` | `id`, `person_id` or `discovered_contact_id`, `label_type`, `label_value`, `normalized_value`, `confidence`, `source`, `method`, `evidence_url`, `evidence_excerpt`, `agent_run_id`, `dedupe_key`, `status` |
| `person_text_chunks` | `id`, `person_id` (FK), `chunk_type`, `chunk_index`, `chunk_text`, `embedding`, `created_at`, `updated_at` |
| `organization_text_chunks` | `id`, `organization_id` (FK), `chunk_type`, `chunk_index`, `chunk_text`, `embedding`, `created_at`, `updated_at` |
| `saved_flemish_filters` | `id`, `original_query`, `keywords` (JSONB), `target_fields`, `filter_type`, `usage_count` |
| `search_clicks` | `id`, `query`, `person_id` (FK), `clicked_at` |
| `people_search_documents` | `person_id` (PK/FK), denormalized name, role, occupation, canonical Flemish connection names plus approved aliases and relationship evidence text, sector names, location text, `search_text`, `search_tsv`, `updated_at` |
| `organization_search_documents` | `organization_id` (PK/FK), denormalized name, type, description, `flemish_fact_text` from `organization_flemish_connections` plus approved aliases and relationship evidence, sector names, primary/all US location text including organization location role/label/description, `us_network_status`, `search_text`, `search_tsv`, `updated_at` |

## Discovery Pipeline

| Table | Key Columns |
|---|---|
| `discovered_contacts` | `id`, `name`, `email`, `linkedin_url`, `website_url`, `candidate_key`, `source`, `source_urls`, `suggested_us_network_status` (nullable: `us_based` or `us_connected_abroad`; `needs_review` removed in 20260508000006), `suggested_us_network_confidence`, `current_location_city`, `current_location_country`, `suggested_us_connections`, `suggested_org_pivots`, `status`, `review_outcome`, `reviewed_at`, `reject_reason`, `reject_reason_note`, `approved_person_id`, `verification_status` (`queued`, `verifying`, `verified`, `failed` — `failed` added 20260510130000 when dispatch attempts reach 3), `verification_run_id`, `verification_attempts` (int, default 0, added 20260510130000), `verified_at`, `verification_payload` (jsonb: scope, location, role, employer, ties, evidence, confidence — populated by `agent-verify`). `reject_reason` values unchanged. Verification contradictions are hard-deleted (no rejected state for those). Published to `supabase_realtime` so the Verification UI receives live status transitions. The Verification UI queries on `verification_status` only; the legacy `status` column is not authoritative for the queue. |
| `discovered_organizations` | `id`, `name`, `website_url`, `description`, `candidate_key`, `source`, `first_seen_at`, `last_seen_at`, `last_evidence_at`, `evidence_count`, `suggested_us_network_status`, `us_locations`, `sectors`, `flemish_belgian_relevance`, `source_urls`, `confidence`, `status` (`pending`, `approved`, `rejected`; `needs_review` removed in 20260508000006), `review_outcome`, `reject_reason`, `reject_reason_note`, `approved_organization_id`, `verification_status` (`queued`, `verifying`, `verified`, `failed` — `failed` added 20260510130000), `verification_run_id`, `verification_attempts` (int, default 0, added 20260510130000), `verified_at`, `verification_payload`. `reject_reason` values unchanged. Verification contradictions are hard-deleted. Published to `supabase_realtime`. |
| `discovery_query_attempts` | `id`, `run_id` (FK→`agent_runs`), `surface` (nullable, FK→`discovery_surfaces.key`), `lens` (nullable, FK→`discovery_lenses.key`), `composition_keys` (text[]), `query_text`, `source_type` (`custom_query`/`surface_lens`/`entity_pivot`/`exploration`/`reflection`), `pivot_entity_key`, `provider`, `urls_returned`, `pages_fetched`, `candidates_extracted`, `new_pending_contacts`, `contacts_later_approved`, `contacts_later_rejected`, `rejected_reason_breakdown` (JSONB), `cost_estimate_usd`, `created_at`, `resolved_at`. One row per `searchWeb` call inside `agent-discovery`; downstream counters resolved via the `resolve_discovery_query_attempts(run_id)` RPC at run completion. `surface`/`lens` reference the active taxonomy in `discovery_surfaces`/`discovery_lenses`; the legacy `source_pack_key` column was dropped in Phase 2 of the Discovery Redesign on 2026-05-08. Staff-read-only; service-role writes. |
| `discovery_arm_stats` | `(surface, lens, context_key)` PK. Per-arm Thompson-sampling state: `attempts`, `candidates_extracted`, `new_pending_contacts`, `contacts_approved`, `contacts_rejected`, `not_flemish_rejections`, `total_cost_usd`, `last_attempt_at`, `last_yielding_attempt_at`, `cooldown_until`. `context_key` is `''` for global arms, or a tag such as `sector:biotech`. The view `discovery_arm_stats_recent` joins to surface/lens name columns, computes `approval_rate` (Bayesian-smoothed), `not_flemish_rate`, and `arm_status` (`untried` / `active` / `no_yield` / `cooling_down`). Staff-read; editor-write. Added in Phase 3 of the Discovery Redesign on 2026-05-08. |
| `discovery_reflection_suggestions` | `id`, `surface` (nullable FK→`discovery_surfaces.key`), `lens` (nullable FK→`discovery_lenses.key`), `context_key` (e.g. `sector:finance`, `geo:midwest`, `''` for global), `rationale`, `population_summary` (JSONB — sector/state/employer/career-stage/rejection counts at generation time), `generated_at`, `consumed_attempt_count` (incremented each time the bandit picks this suggestion for an exploration slot), `expires_at` (default now() + 14 days). Index on `expires_at` for efficient active-suggestion queries. Staff-read/write. Added in Phase 4 of the Discovery Redesign on 2026-05-08. |
| `discovery_surfaces` | `key` (PK), `name`, `description`, `example_url_patterns` (text[]), `preferred_site_operators` (text[]), `active`. Catalog of discovery page types (linkedin_profile, faculty_page, lab_roster, company_team, board_of_directors, news_article, press_release, podcast_transcript, conference_speakers, alumni_magazine, op_ed, crunchbase_profile, university_news, fellowship_announcement, embassy_event, substack_post, wikipedia, chamber_directory, trade_mission_roster, sec_filing, awards_page, patent_filing, nonprofit_filing, obituary_wedding). Replaces `discovery_source_packs` for the page-type axis. Seeded by Phase 2 migration. Staff-read; admin-write. |
| `discovery_lenses` | `key` (PK), `name`, `description`, `prompt_guidance`, `active`. Catalog of discovery signal angles (named_entity, surface_phrase, nationality_role, sector_geo, alumni_network, company_affiliation, event_participation). Replaces `discovery_source_packs` for the signal-angle axis. Staff-read; admin-write. |
| `discovery_seed_domains` | `id`, `domain` (UNIQUE), `surfaces` (text[] of surface keys), `lenses` (text[] of lens keys), `notes`, `active`, `reputation_score numeric(4,3) DEFAULT 0` (Bayesian-smoothed approval rate: (approved+1)/(extracted+5)), `reputation_window_started_at timestamptz`, `reputation_recompute_at timestamptz` (set by nightly housekeeping), `manually_blocked boolean DEFAULT false` (staff can suppress a domain regardless of score), `total_candidates_extracted int DEFAULT 0`, `total_approved_contacts int DEFAULT 0`. High-value seed domains tagged with the surfaces they host and the lenses they support. Replaces the `domains` array on `discovery_source_packs`. Seeded with Flemish academic, US-side institutional, Belgian-founded US-active companies, and US public-records / business-journalism domains. Phase 6 migration `20260508000016_phase6_domain_reputation.sql` added the reputation columns. Staff-read; admin-write. |
| `discovered_organization_evidence` | `id`, `discovered_organization_id` (FK), nullable `discovery_page_id` (FK), unique `evidence_key`, `page_url`, `page_title`, `page_type`, `source_type`, `source_name`, `source_url`, `evidence_excerpt`, `raw_relevance_text`, `raw_location_text`, `raw_sector_text`, normalized location fields, `confidence`, `observed_at`, `created_at`, `updated_at` |
| `discovery_frontier` | `id`, `url`, `status`, `source_type`, `parent_url`, `domain`, `claimed_at`, `done_at`. The legacy `source_pack_id` FK was dropped in Phase 2 of the Discovery Redesign on 2026-05-08. |
| `discovery_domains` | `id`, `domain`, `yield_score`, `weekly_budget`, `weekly_used`, `last_run_at`. The legacy `source_pack_id` FK was dropped in Phase 2 of the Discovery Redesign on 2026-05-08. |
| `discovery_pages` | `id`, `url`, `domain`, `page_type`, `raw_text`, `fetched_at` |
| `discovery_evidence` | `id`, `page_id` (FK), `candidate_key`, `field_name`, `value`, `confidence` |
| `discovery_frontier_refills` | `id`, `trigger`, `query`, `urls_added`, `created_at`. The legacy `source_pack_ids uuid[]` column was dropped in Phase 2 of the Discovery Redesign on 2026-05-08; refill provenance is now expressed through `surface`, `lens`, `domain_hint`, and `composition_keys` in `planned_queries`. |
| `discovery_entity_pivots` | `id`, `entity_key` (UNIQUE), `entity_name`, `entity_type`, `normalized_domain`, `coverage_target_keys`, `source_urls`, `seeded_frontier_count`, `last_seeded_at`, `last_seen_at`, `last_recommended_at` (nullable TIMESTAMPTZ), `recommended_count` (INT DEFAULT 0), `created_at`, `updated_at`. Phase 5 added: `validation_score numeric(3,2)`, `validation_rationale text`, `validation_at timestamptz` (Gemini quality score for new pivots; pivots scoring < 0.5 are filtered from the active rotation), `saturation_cooldown_until timestamptz` (set to now+30d when a pivot yields zero new approved people for 3+ runs over 7+ days), `rolling_new_approved int NOT NULL DEFAULT 0`, `rolling_window_started_at timestamptz NOT NULL DEFAULT now()`. The legacy `seed_queries text[]` column was dropped on 2026-05-08 (Phase 1 of the Discovery Redesign); queries are generated per-run by `_shared/queryGeneration.ts`. The `ops_discovery_entity_pivots` view was rebuilt to expose all Phase 5 columns and to filter saturated pivots at load time. |
| `discovery_composition_pivots` | `id`, `pivot_type` (CHECK IN 'sector_cluster','geo_cluster','sector_geo_cluster'), `context jsonb` (e.g. `{sector, state}`), `approved_people_count int`, `last_approved_match_at timestamptz`, `saturation_cooldown_until timestamptz`, `created_at`, `updated_at`. UNIQUE (pivot_type, context). RLS: staff-only read/write. Created by weekly `buildCompositionPivots` job in `agent-scheduler` housekeeping when 4+ approved people share (sector, state) or 6+ share a sector alone. Consumed by `agent-discovery` to generate `source_type='composition'` query plans. |
| `embedding_jobs` | `person_id` (PK/FK), `status`, `queued_at`, `claimed_at`, `attempts`, `last_error` |
| `organization_embedding_jobs` | `organization_id` (PK/FK), `status`, `queued_at`, `claimed_at`, `attempts`, `last_error` |
| `embedding_batch_runs` | `id`, `status`, `batch_id`, `manifest` (JSONB), `started_at`, `completed_at` |
| `agent_runs` | `id`, `agent_type`, `status`, `started_at`, `completed_at`, `results` (JSONB), `error_message`, `error_kind` |
| `agent_schedules` | `job_kind` (PK; `discovery`/`verify_stale`/`embeddings_drain`), `cadence_preset` (`off`/`low`/`normal`/`high`), `last_run_at`, `last_run_id`, `next_run_at`, `last_status` (`ok`/`failed`/`skipped`), `last_error`, `last_manual_at`, `last_manual_by`, `updated_by`, `updated_at`. Driven by the `agent-scheduler-tick` pg_cron job (every 5 minutes) which posts `{ action: 'tick' }` to `agent-scheduler`. RLS: editors can `SELECT`; writes are service-role only. Two `vault.secrets` entries (`project_url`, `service_role_key`) supply credentials to the cron job. See `docs/AI-PIPELINE.md` "Edge Function: `agent-scheduler` → `tick` action". |

`agent_runs.error_kind` is the Phase 6.3 operator-facing failure class. Allowed values: `quota_exhausted`, `auth_failed`, `network`, `db_timeout`, `invalid_input`, `agent_failure`, `unknown`. Failed runs should set both `error_message` and `error_kind`; running/completed runs normally leave `error_kind` null.

## Benchmark / Ops (internal, staff-only)

| View/Table | Purpose |
|---|---|
| `benchmark_search_queries` | Fixed representative search query set for regression testing |
| `benchmark_discovery_sources` | Initial discovery source benchmark set |
| `ops_search_benchmark_clicks` | Search benchmark click-through metrics |
| `ops_discovery_review_metrics` | Discovery candidate review rates and latency |
| `ops_phase_success_metrics` | Cross-phase success metrics (search benchmark pass rate, discovery yield, multi-evidence rate, embedding coverage, etc.) |
| `ops_discovery_domain_yield` | Per-domain yield scores |
| `ops_discovery_coverage_summary` | Geography coverage summary |
| `coverage_gaps` | Underrepresented metros/states for gap-driven discovery. View over `coverage_targets`. Exposes `last_recommended_at` and `recommended_count` from `coverage_targets` for cooldown filtering. |
| `people_search_documents` | Denormalized people lexical search substrate (internal sync triggers) |
| `organization_search_documents` | Denormalized organization lexical search substrate (internal sync triggers) |

## Map RPCs

| RPC | Contract |
|---|---|
| `get_network_location_summary()` | Returns one row per (city, state, lat, lng) UNION leg: `{city, state, lat, lng, person_count, org_count, person_ids, org_ids}`. Four legs: (1) us-based people via `people.location_id`, (2) us-connected-abroad people via `person_us_connections`, (3) organizations via `organization_us_locations`, (4) organizations via `organizations.location_id` for those without `organization_us_locations` rows. Frontend merges legs by `city\|state`. SECURITY DEFINER; GRANT EXECUTE TO authenticated. Used by Dashboard Tier 1 for fast initial map circle render. |

## Search RPCs

| RPC | Contract |
|---|---|
| `search_people_lexical(search_query, search_route, match_count)` | Returns approved people lexical candidates with score components, `match_field`, and `match_text`; fused with vectors/chunks in `search-people`. |
| `search_organizations_lexical(search_query, search_route, match_count)` | Returns approved organization lexical candidates with score components, `match_field`, and `match_text`. |
| `match_people(query_embedding, match_count, similarity_threshold)` | Returns approved people vector candidates from `people.embedding`. |
| `match_person_text_chunks(query_embedding, match_count, similarity_threshold, exclude_person_id)` | Returns approved people text-chunk vector candidates. |
| `match_organizations(query_embedding, match_count, similarity_threshold)` | Returns approved organization vector candidates from `organizations.embedding`. |
| `match_organization_text_chunks(query_embedding, match_count, similarity_threshold, exclude_organization_id)` | Returns approved organization text-chunk vector candidates. |
| `expand_us_state(state_code)` | Returns the spelled-out US state name for a two-letter code (or NULL). Added in `20260509000000_phase1a_search_state_expansion.sql` so the search blob carries "Boston, MA Massachusetts" and lexical/BM25 matches a query like "Massachusetts" against rows whose location only stores `MA`. |
| `format_location_search_text(city, state)` | Renders `"<City>, <ST> <SpelledOutState>"` for use inside `build_people_search_document` / `build_organization_search_document`. Same migration. |
| `search_people_autofill(q, lim)` | Trigram-indexed unified autofill over `people_search_documents.name_normalized` and `organization_search_documents.name_normalized`. Returns up to `lim` rows per domain tagged `entity_type='person'` or `'organization'` with `id`, `name`, `subtitle`. Backs the global search dropdown. Added in `20260510120000_autofill_rpc.sql`. |

Phase 6A adds SQL lookup helpers for Flemish/Belgian facts. They normalize raw input, resolve exact canonical names and approved aliases, and can create/reuse canonical rows for migration or editor-owned write paths. SQL and TypeScript canonicalization must stay aligned; 6B owns moving active search/filter code to alias-aware helper behavior.

`people_search_documents` and `organization_search_documents` include canonical Flemish/Belgian fact names, approved aliases, role text, and evidence excerpts where present. `organization_search_documents` refreshes from `organizations`, `organization_sectors`, `sectors`, `organization_us_locations`, `locations`, and `organization_flemish_connections`/`flemish_connections`/approved aliases. `organization_us_locations` also keeps `organizations.location_id` aligned to the primary or first approved US location. Organization embedding jobs refresh when organization profile fields, sectors, US locations, referenced location names, or approved organization Flemish/Belgian facts change. Phase 6A triggers also refresh people/organization search documents and queue embeddings when person or organization Flemish fact rows or aliases change.

Approved-record profile edits and Discovery approval/merge paths maintain Flemish/Belgian facts through `person_flemish_connections` and `organization_flemish_connections`. Relationship rows preserve available role, confidence, source URL, and evidence excerpt; staff-created aliases can be added through `flemish_connection_aliases` without turning raw phrases into default filter chips.

Derived-label approval resolves Flemish/Belgian labels through canonical names and approved aliases before upserting `person_flemish_connections`; relationship evidence, source URL, confidence, and role are preserved when present. Model-discovered aliases are stored as pending `flemish_connection_aliases` rows and do not become filter chips until reviewed.

## Seed Data
Seed data is carried by migrations so a clean Supabase project can be reconstructed with `supabase db push --linked`.

| Migration | Seed Contract |
|---|---|
| `20260324000001_populate_sample_data.sql` | Initial sectors |
| `20260331000000_phase0_benchmarks_and_metrics.sql` | Fixed search benchmark queries and discovery source benchmarks |
| `20260331170000_phase2a_discovery_foundation.sql` | Discovery source packs (dropped in `20260508000012_phase2_surfaces_lenses_taxonomy.sql`; replaced by surfaces × lenses taxonomy) |
| `20260508000012_phase2_surfaces_lenses_taxonomy.sql` | Surfaces × lenses taxonomy: `discovery_surfaces` (24 page types), `discovery_lenses` (7 signal angles), `discovery_seed_domains` (Flemish academic, US-side institutional, Belgian-founded US companies, US public records/business journalism), plus FKs on `discovery_query_attempts.surface`/`lens` and removal of legacy `source_pack` columns. |
| `20260508000013_phase3_bandit_allocator.sql` | `discovery_arm_stats` table and `discovery_arm_stats_recent` view for the Thompson-sampling bandit allocator. Staff-read, editor-write. |
| `20260508000014_phase4_reflection_loop.sql` | `discovery_reflection_suggestions` table with `expires_at` index and staff-only RLS. Stores AI-generated exploration suggestions from the daily `agent-discovery-reflect` run. |
| `20260508000015_phase5_pivot_upgrades.sql` | `discovery_composition_pivots` table; `discovery_entity_pivots` extended with validation, saturation, and rolling-window columns. |
| `20260508000016_phase6_domain_reputation.sql` | Phase 6: reputation columns added to `discovery_seed_domains` (`reputation_score`, `reputation_window_started_at`, `reputation_recompute_at`, `manually_blocked`, `total_candidates_extracted`, `total_approved_contacts`). Applied to linked project `ofzuhajxwxggybkuzefq` on 2026-05-08. |
| `20260401030000_phase2b_discovery_learning.sql` | Metro areas and coverage targets |
| Phase 6A Flemish fact normalization migration | Canonical Flemish/Belgian catalog fields, dynamic aliases, evidence-backed person and organization fact junctions, lookup helpers, RLS, triggers, broad filterable seeds, alias seeds, and idempotent person/organization fact backfills. Applied to linked project `ofzuhajxwxggybkuzefq` with `supabase db push --linked`; generated Supabase types were refreshed from the remote schema. |
| `scripts/seed_phase3_search_dataset.ts` (`npm run seed:phase3`) | Destructive synthetic Phase 3 reset/reseed. Requires `VITE_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `PHASE3_RESET_CONFIRM=ofzuhajxwxggybkuzefq`. Deletes approved people/organizations and dependent search, embedding, sector/Flemish/location-link, and collection membership rows; preserves staff users, discovery history, surfaces/lenses/seed domains, sectors, locations, and Flemish catalog rows; seeds 160 fake people and 75 fake organizations. |

Future seed edits should land in new migrations and use idempotent SQL (`ON CONFLICT`, `IF NOT EXISTS`, or equivalent) so repeated pushes on a fresh project remain safe.

## RLS Summary
- Core reads require an authenticated active staff session via `is_active_staff()`.
- Writes are role-gated via `has_staff_role('editor')` or `has_staff_role('admin')`; permanent `people` deletion is admin-only because it cascades related approved-record data. Legacy public write policies have been removed from collection membership and US location link tables.
- `staff_users` supports self read/update for the signed-in row; admins manage all rows.
- Staff auth users live in Supabase Auth. The app does not store password hashes; `staff_users.password_reset_required` only gates first-password setup after an invite.
- `discovered_contacts`, `discovered_organizations`, and `discovered_organization_evidence` are editor-only pending Discovery tables; manual intake and import inserts require `has_staff_role('editor')` and do not expose anon or broad authenticated public policies.
- `person_text_chunks`, `organization_text_chunks`, `people_search_documents`, `organization_search_documents`, and ops/benchmark views are backend-owned. `embedding_jobs`, `organization_embedding_jobs`, and `embedding_batch_runs` are read-only for editor staff solely for Admin -> System record-index queue/batch health; writes still go through queue RPCs and embedding workers.
- `profile-photos` storage bucket: staff-read, editor-write (`public = false`).
- `flemish_connections`, `flemish_connection_aliases`, `person_flemish_connections`, and `organization_flemish_connections` are staff-read and editor/admin-write. Use the shared staff-role helpers (`is_active_staff()`, `has_staff_role('editor')`, `has_staff_role('admin')`) and do not expose anon/public writes.
- `person_sectors` and Flemish/Belgian fact junctions use idempotent insert/delete semantics for relationship maintenance. Evidence fields on the fact junctions may be updated by editor/admin-owned approved-record workflows.

## Legacy (in DB, unused in frontend)
| Table | Status |
|---|---|
| `plans`, `plan_actions`, `plan_suggested_people` | Dropped in migration `20260508000002_phase8b_drop_legacy_planner.sql`. Zero code references confirmed before drop. |
| `connections`, `connection_suggestions`, `discover_connections()` | Person-to-person connection layer removed from product and scheduler/UI surfaces. Drop in a follow-up migration after confirming no backend references remain. |
