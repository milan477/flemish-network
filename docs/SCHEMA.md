# Database Schema Reference

## Core Tables

| Table | Key Columns | Notes |
|---|---|---|
| `people` | `id`, `name`, `title`, `first_name`, `last_name`, `current_position`, `organization_id` (FK), `location_id` (FK→locations), `us_network_status`, `current_location_city`, `current_location_country`, `occupation`, `bio`, `profile_photo_url`, `available_for_lectures`, `open_to_mentorship`, `welcomes_visits`, `preferred_contact`, `phone`, `email`, `email_verified`, `linkedin_url`, `website_url`, `twitter_url`, `data_source`, `last_verified_at`, `created_at`, `updated_at` | Main entity. `location_id` is the current US base for `us_based` people only. `us_connected_abroad` people use abroad display fields plus `person_us_connections`. No inline location columns; no scalar `flemish_connection`. Flemish ties normalized via `person_flemish_connections`. `data_source` preserves approved-profile provenance such as `manual`, `csv_import`, `ai_agent`, and legacy `discovery_agent`. |
| `organizations` | `id`, `name`, `type`, `description`, `logo_url`, `website_url`, `location_id` (FK→locations), `us_network_status`, `embedding`, `embedding_dirty_at`, `embedding_generated_at`, `created_at`, `updated_at` | `location_id` is optional primary US location only. Full map placement uses `organization_us_locations`. Organization embeddings support approved organization semantic search. Approved organization Flemish/Belgian facts use `organization_flemish_connections` for profile display, profile edits, Discovery approval/merge, collection previews, search, and embeddings. |
| `locations` | `id`, `city`, `state`, `latitude`, `longitude`, `geocode_source`, `geocoded_at` | UNIQUE(city, state). `latitude`/`longitude` nullable (pending geocode or ambiguous). |
| `sectors` | `id`, `name` (unique) | Seeded: AI, Biotech, Finance, Culture & Arts, Education, Research |
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
| `discovered_contacts` | `id`, `name`, `email`, `linkedin_url`, `website_url`, `candidate_key`, `source`, `source_urls`, `suggested_us_network_status`, `suggested_us_network_confidence`, `current_location_city`, `current_location_country`, `suggested_us_connections`, `suggested_org_pivots`, `status`, `review_outcome`, `reviewed_at`, `approved_person_id` |
| `discovered_organizations` | `id`, `name`, `website_url`, `description`, `candidate_key`, `source`, `first_seen_at`, `last_seen_at`, `last_evidence_at`, `evidence_count`, `suggested_us_network_status`, `us_locations`, `sectors`, `flemish_belgian_relevance`, `source_urls`, `confidence`, `status`, `review_outcome`, `approved_organization_id` |
| `discovered_organization_evidence` | `id`, `discovered_organization_id` (FK), nullable `discovery_page_id` (FK), unique `evidence_key`, `page_url`, `page_title`, `page_type`, `source_type`, `source_name`, `source_url`, `evidence_excerpt`, `raw_relevance_text`, `raw_location_text`, `raw_sector_text`, normalized location fields, `confidence`, `observed_at`, `created_at`, `updated_at` |
| `discovery_frontier` | `id`, `url`, `status`, `source_type`, `parent_url`, `domain`, `claimed_at`, `done_at` |
| `discovery_domains` | `id`, `domain`, `yield_score`, `weekly_budget`, `weekly_used`, `last_run_at` |
| `discovery_pages` | `id`, `url`, `domain`, `page_type`, `raw_text`, `fetched_at` |
| `discovery_evidence` | `id`, `page_id` (FK), `candidate_key`, `field_name`, `value`, `confidence` |
| `discovery_source_packs` | `id`, `name`, `urls` (JSONB), `coverage_target_keys` (JSONB), `priority` |
| `discovery_frontier_refills` | `id`, `trigger`, `query`, `urls_added`, `created_at` |
| `discovery_entity_pivots` | `id`, `entity_name`, `entity_type`, `confidence`, `evidence_count`, `domain` |
| `embedding_jobs` | `person_id` (PK/FK), `status`, `queued_at`, `claimed_at`, `attempts`, `last_error` |
| `organization_embedding_jobs` | `organization_id` (PK/FK), `status`, `queued_at`, `claimed_at`, `attempts`, `last_error` |
| `embedding_batch_runs` | `id`, `status`, `batch_id`, `manifest` (JSONB), `started_at`, `completed_at` |
| `agent_runs` | `id`, `agent_type`, `status`, `started_at`, `completed_at`, `results` (JSONB), `error_message`, `error_kind` |

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
| `coverage_gaps` | Underrepresented metros/states for gap-driven discovery |
| `people_search_documents` | Denormalized people lexical search substrate (internal sync triggers) |
| `organization_search_documents` | Denormalized organization lexical search substrate (internal sync triggers) |

## Search RPCs

| RPC | Contract |
|---|---|
| `search_people_lexical(search_query, search_route, match_count)` | Returns approved people lexical candidates with score components, `match_field`, and `match_text`; fused with vectors/chunks in `search-people`. |
| `search_organizations_lexical(search_query, search_route, match_count)` | Returns approved organization lexical candidates with score components, `match_field`, and `match_text`. |
| `match_people(query_embedding, match_count, similarity_threshold)` | Returns approved people vector candidates from `people.embedding`. |
| `match_person_text_chunks(query_embedding, match_count, similarity_threshold, exclude_person_id)` | Returns approved people text-chunk vector candidates. |
| `match_organizations(query_embedding, match_count, similarity_threshold)` | Returns approved organization vector candidates from `organizations.embedding`. |
| `match_organization_text_chunks(query_embedding, match_count, similarity_threshold, exclude_organization_id)` | Returns approved organization text-chunk vector candidates. |

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
| `20260331170000_phase2a_discovery_foundation.sql` | Discovery source packs |
| `20260401030000_phase2b_discovery_learning.sql` | Metro areas and coverage targets |
| Phase 6A Flemish fact normalization migration | Canonical Flemish/Belgian catalog fields, dynamic aliases, evidence-backed person and organization fact junctions, lookup helpers, RLS, triggers, broad filterable seeds, alias seeds, and idempotent person/organization fact backfills. Applied to linked project `ofzuhajxwxggybkuzefq` with `supabase db push --linked`; generated Supabase types were refreshed from the remote schema. |
| `scripts/seed_phase3_search_dataset.ts` (`npm run seed:phase3`) | Destructive synthetic Phase 3 reset/reseed. Requires `VITE_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `PHASE3_RESET_CONFIRM=ofzuhajxwxggybkuzefq`. Deletes approved people/organizations and dependent search, embedding, sector/Flemish/location-link, and collection membership rows; preserves staff users, source packs, discovery history, sectors, locations, and Flemish catalog rows; seeds 160 fake people and 75 fake organizations. |

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
| `plans`, `plan_actions`, `plan_suggested_people` | Planner feature removed. Tables remain but are unused. |
| `connections`, `connection_suggestions`, `discover_connections()` | Person-to-person connection layer removed from product and scheduler/UI surfaces. Drop in a follow-up migration after confirming no backend references remain. |
