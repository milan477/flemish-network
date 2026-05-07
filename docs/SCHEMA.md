# Database Schema Reference

## Core Tables

| Table | Key Columns | Notes |
|---|---|---|
| `people` | `id`, `name`, `title`, `first_name`, `last_name`, `current_position`, `organization_id` (FK), `location_id` (FK→locations), `us_network_status`, `current_location_city`, `current_location_country`, `occupation`, `bio`, `profile_photo_url`, `available_for_lectures`, `open_to_mentorship`, `welcomes_visits`, `preferred_contact`, `phone`, `email`, `email_verified`, `linkedin_url`, `website_url`, `twitter_url`, `data_source`, `last_verified_at`, `created_at`, `updated_at` | Main entity. `location_id` is the current US base for `us_based` people only. `us_connected_abroad` people use abroad display fields plus `person_us_connections`. No inline location columns; no scalar `flemish_connection`. Flemish ties normalized via `person_flemish_connections`. |
| `organizations` | `id`, `name`, `type`, `description`, `logo_url`, `website_url`, `location_id` (FK→locations), `us_network_status`, `flemish_link`, `created_at`, `updated_at` | `location_id` is optional primary US location only. Full map placement uses `organization_us_locations`. |
| `locations` | `id`, `city`, `state`, `latitude`, `longitude`, `geocode_source`, `geocoded_at` | UNIQUE(city, state). `latitude`/`longitude` nullable (pending geocode or ambiguous). |
| `sectors` | `id`, `name` (unique) | Seeded: AI, Biotech, Finance, Culture & Arts, Education, Research |
| `flemish_connections` | `id`, `name`, `type` (university/government/company/other), `created_at` | Canonical Flemish/Belgian fact catalog. Target expansion adds aliases, parent/group support, `is_filterable`, roles, confidence, source URL, and evidence excerpts. Known aliases are canonicalized on insert (e.g. `University of Ghent` → `UGent`). |
| `staff_users` | `id`, `user_id` (FK→auth.users), `email`, `full_name`, `avatar_url`, `role`, `status`, `last_sign_in_at`, `created_at`, `updated_at` | App-user auth/authz. Intentionally separate from `people`. Roles: `viewer`, `editor`, `admin`. Statuses: `invited`, `active`, `disabled`. |

## Junction Tables

| Table | Keys |
|---|---|
| `person_sectors` | `(person_id, sector_id)` PK |
| `organization_sectors` | `(organization_id, sector_id)` PK |
| `person_flemish_connections` | `(person_id, flemish_connection_id)` PK |
| `organization_flemish_connections` | Target table for `(organization_id, flemish_connection_id)` plus role, confidence, source URL, and evidence excerpt |
| `person_us_connections` | `id`, `person_id` (FK), `location_id` (FK), `connection_label`, `source_url`, `evidence_excerpt`, `confidence` |
| `organization_us_locations` | `id`, `organization_id` (FK), `location_id` (FK), `location_role`, `label`, `description`, `source_url`, `evidence_excerpt`, `confidence`, `is_primary` |

## Collections

| Table | Key Columns |
|---|---|
| `collections` | `id`, `name`, `description`, `created_at`, `updated_at` |
| `collection_members` | `id`, `collection_id` (FK), `person_id` (FK), target `organization_id` (FK), `notes`, `added_at`. Current live uniqueness is `UNIQUE(collection_id, person_id)`; target uniqueness also covers organization members. |

## AI & Suggestions

| Table | Key Columns |
|---|---|
| `profile_suggestions` | `id`, `person_id` (FK), `field_name`, `current_value`, `suggested_value`, `source`, `status`, `evidence_url`, `evidence_excerpt`, `confidence`, `method`, `agent_run_id`, `dedupe_key`, `reviewed_at`. Target replacement is a record-level suggestion queue that supports people and organizations. |
| `derived_label_suggestions` | `id`, `person_id` or `discovered_contact_id`, `label_type`, `label_value`, `normalized_value`, `confidence`, `source`, `method`, `evidence_url`, `evidence_excerpt`, `agent_run_id`, `dedupe_key`, `status` |
| `person_text_chunks` | `id`, `person_id` (FK), `chunk_type`, `chunk_index`, `chunk_text`, `embedding`, `created_at`, `updated_at` |
| `saved_flemish_filters` | `id`, `original_query`, `keywords` (JSONB), `target_fields`, `filter_type`, `usage_count` |
| `search_clicks` | `id`, `query`, `person_id` (FK), `clicked_at` |
| `people_search_documents` | `person_id` (PK/FK), denormalized name, role, occupation, Flemish connection names, sector names, location text, `search_text`, `search_tsv`, `updated_at` |
| `organization_search_documents` | `organization_id` (PK/FK), denormalized name, type, description, `flemish_link`, sector names, primary/all US location text, `us_network_status`, `search_text`, `search_tsv`, `updated_at` |

## Discovery Pipeline

| Table | Key Columns |
|---|---|
| `discovered_contacts` | `id`, `name`, `email`, `linkedin_url`, `website_url`, `candidate_key`, `suggested_us_network_status`, `suggested_us_network_confidence`, `current_location_city`, `current_location_country`, `suggested_us_connections`, `suggested_org_pivots`, `status`, `review_outcome`, `reviewed_at`, `approved_person_id` |
| `discovered_organizations` | `id`, `name`, `website_url`, `description`, `suggested_us_network_status`, `us_locations`, `sectors`, `flemish_belgian_relevance`, `source_urls`, `confidence`, `status`, `review_outcome`, `approved_organization_id` |
| `discovery_frontier` | `id`, `url`, `status`, `source_type`, `parent_url`, `domain`, `claimed_at`, `done_at` |
| `discovery_domains` | `id`, `domain`, `yield_score`, `weekly_budget`, `weekly_used`, `last_run_at` |
| `discovery_pages` | `id`, `url`, `domain`, `page_type`, `raw_text`, `fetched_at` |
| `discovery_evidence` | `id`, `page_id` (FK), `candidate_key`, `field_name`, `value`, `confidence` |
| `discovery_source_packs` | `id`, `name`, `urls` (JSONB), `coverage_target_keys` (JSONB), `priority` |
| `discovery_frontier_refills` | `id`, `trigger`, `query`, `urls_added`, `created_at` |
| `discovery_entity_pivots` | `id`, `entity_name`, `entity_type`, `confidence`, `evidence_count`, `domain` |
| `embedding_jobs` | `person_id` (PK/FK), `status`, `queued_at`, `claimed_at`, `attempts`, `last_error` |
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
| `search_organizations_lexical(search_query, search_route, match_count)` | Returns approved organization lexical candidates with score components, `match_field`, and `match_text`; Phase 3 organization search is lexical-only. |

`organization_search_documents` refreshes from `organizations`, `organization_sectors`, `sectors`, `organization_us_locations`, and `locations`. Organization Flemish/Belgian relevance remains the existing `organizations.flemish_link` text field in Phase 3; canonical `organization_flemish_connections` remains Phase 6 work.

## Seed Data
Seed data is carried by migrations so a clean Supabase project can be reconstructed with `supabase db push --linked`.

| Migration | Seed Contract |
|---|---|
| `20260324000001_populate_sample_data.sql` | Initial sectors |
| `20260331000000_phase0_benchmarks_and_metrics.sql` | Fixed search benchmark queries and discovery source benchmarks |
| `20260331170000_phase2a_discovery_foundation.sql` | Discovery source packs |
| `20260401030000_phase2b_discovery_learning.sql` | Metro areas and coverage targets |
| `scripts/seed_phase3_search_dataset.ts` (`npm run seed:phase3`) | Destructive synthetic Phase 3 reset/reseed. Requires `VITE_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `PHASE3_RESET_CONFIRM=ofzuhajxwxggybkuzefq`. Deletes approved people/organizations and dependent search, embedding, sector/Flemish/location-link, and collection membership rows; preserves staff users, source packs, discovery history, sectors, locations, and Flemish catalog rows; seeds 160 fake people and 75 fake organizations. |

Future seed edits should land in new migrations and use idempotent SQL (`ON CONFLICT`, `IF NOT EXISTS`, or equivalent) so repeated pushes on a fresh project remain safe.

## RLS Summary
- Core reads require an authenticated active staff session via `is_active_staff()`.
- Writes are role-gated via `has_staff_role('editor')` or `has_staff_role('admin')`.
- `staff_users` supports self read/update for the signed-in row; admins manage all rows.
- `person_text_chunks`, `people_search_documents`, `organization_search_documents`, and ops/benchmark views are backend-owned. `embedding_jobs` and `embedding_batch_runs` are read-only for editor staff solely for Admin -> System queue/batch health; writes still go through queue RPCs and `generate-embeddings`.
- `profile-photos` storage bucket: staff-read, editor-write (`public = false`).
- `person_sectors` and `person_flemish_connections` have insert/delete policies but no update — use conflict-ignore inserts.

## Legacy (in DB, unused in frontend)
| Table | Status |
|---|---|
| `plans`, `plan_actions`, `plan_suggested_people` | Planner feature removed. Tables remain but are unused. |
| `connections`, `connection_suggestions`, `discover_connections()` | Person-to-person connection layer removed from product and scheduler/UI surfaces. Drop in a follow-up migration after confirming no backend references remain. |
