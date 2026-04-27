# Database Schema Reference

## Core Tables

| Table | Key Columns | Notes |
|---|---|---|
| `people` | `id`, `name`, `title`, `first_name`, `last_name`, `current_position`, `organization_id` (FK), `location_id` (FK→locations), `occupation`, `bio`, `profile_photo_url`, `available_for_lectures`, `open_to_mentorship`, `welcomes_visits`, `preferred_contact`, `phone`, `email`, `email_verified`, `linkedin_url`, `website_url`, `twitter_url`, `data_source`, `last_verified_at`, `created_at`, `updated_at` | Main entity. No inline location columns; no scalar `flemish_connection`. Flemish ties normalized via `person_flemish_connections`. |
| `organizations` | `id`, `name`, `type`, `description`, `logo_url`, `website_url`, `location_id` (FK→locations), `flemish_link`, `created_at`, `updated_at` | No inline location columns. |
| `locations` | `id`, `city`, `state`, `latitude`, `longitude`, `geocode_source`, `geocoded_at` | UNIQUE(city, state). `latitude`/`longitude` nullable (pending geocode or ambiguous). |
| `sectors` | `id`, `name` (unique) | Seeded: AI, Biotech, Finance, Culture & Arts, Education, Research |
| `flemish_connections` | `id`, `name`, `type` (university/government/company/other), `created_at` | Known aliases canonicalized on insert (e.g. `University of Ghent` → `UGent`). |
| `connections` | `id`, `from_person_id`, `to_person_id`, `from_organization_id`, `to_organization_id`, `relationship_type`, `strength`, `evidence_url`, `evidence_excerpt`, `evidence_source`, `evidence_key` | Hard graph edges. Unique per unordered person-person pair + `relationship_type`. Live types: `colleague`, `alumni`, `program_peer`, `local_peer`, `lab_peer`, `event_peer`. |
| `staff_users` | `id`, `user_id` (FK→auth.users), `email`, `full_name`, `avatar_url`, `role`, `status`, `last_sign_in_at`, `created_at`, `updated_at` | App-user auth/authz. Intentionally separate from `people`. Roles: `viewer`, `editor`, `admin`. Statuses: `invited`, `active`, `disabled`. |

## Junction Tables

| Table | Keys |
|---|---|
| `person_sectors` | `(person_id, sector_id)` PK |
| `organization_sectors` | `(organization_id, sector_id)` PK |
| `person_flemish_connections` | `(person_id, flemish_connection_id)` PK |

## Collections

| Table | Key Columns |
|---|---|
| `collections` | `id`, `name`, `description`, `created_at`, `updated_at` |
| `collection_members` | `id`, `collection_id` (FK), `person_id` (FK), `notes`, `added_at`. UNIQUE(collection_id, person_id) |

## AI & Suggestions

| Table | Key Columns |
|---|---|
| `profile_suggestions` | `id`, `person_id` (FK), `field_name`, `current_value`, `suggested_value`, `source`, `status`, `evidence_url`, `evidence_excerpt`, `confidence`, `method`, `agent_run_id`, `dedupe_key`, `reviewed_at` |
| `derived_label_suggestions` | `id`, `person_id` or `discovered_contact_id`, `label_type`, `label_value`, `normalized_value`, `confidence`, `source`, `method`, `evidence_url`, `evidence_excerpt`, `agent_run_id`, `dedupe_key`, `status` |
| `person_text_chunks` | `id`, `person_id` (FK), `chunk_type`, `chunk_index`, `chunk_text`, `embedding`, `created_at`, `updated_at` |
| `connection_suggestions` | `id`, `from_person_id`, `to_person_id`, `suggestion_type`, `confidence`, `strength`, `source`, `evidence_url`, `evidence_excerpt`, `agent_run_id`, `dedupe_key`, `status` |
| `saved_flemish_filters` | `id`, `original_query`, `keywords` (JSONB), `target_fields`, `filter_type`, `usage_count` |
| `search_clicks` | `id`, `query`, `person_id` (FK), `clicked_at` |

## Discovery Pipeline

| Table | Key Columns |
|---|---|
| `discovered_contacts` | `id`, `name`, `email`, `linkedin_url`, `website_url`, `candidate_key`, `status`, `review_outcome`, `reviewed_at`, `approved_person_id` |
| `discovery_frontier` | `id`, `url`, `status`, `source_type`, `parent_url`, `domain`, `claimed_at`, `done_at` |
| `discovery_domains` | `id`, `domain`, `yield_score`, `weekly_budget`, `weekly_used`, `last_run_at` |
| `discovery_pages` | `id`, `url`, `domain`, `page_type`, `raw_text`, `fetched_at` |
| `discovery_evidence` | `id`, `page_id` (FK), `candidate_key`, `field_name`, `value`, `confidence` |
| `discovery_source_packs` | `id`, `name`, `urls` (JSONB), `coverage_target_keys` (JSONB), `priority` |
| `discovery_frontier_refills` | `id`, `trigger`, `query`, `urls_added`, `created_at` |
| `discovery_entity_pivots` | `id`, `entity_name`, `entity_type`, `confidence`, `evidence_count`, `domain` |
| `embedding_jobs` | `id`, `person_id` (FK), `status`, `claimed_at`, `embedding_dirty_at` |
| `embedding_batch_runs` | `id`, `status`, `batch_id`, `manifest` (JSONB), `started_at`, `completed_at` |
| `agent_runs` | `id`, `agent`, `status`, `started_at`, `completed_at`, `results` (JSONB) |

## Benchmark / Ops (internal, staff-only)

| View/Table | Purpose |
|---|---|
| `benchmark_search_queries` | Fixed representative search query set for regression testing |
| `benchmark_discovery_sources` | Initial discovery source benchmark set |
| `ops_search_benchmark_clicks` | Search benchmark click-through metrics |
| `ops_discovery_review_metrics` | Discovery candidate review rates and latency |
| `ops_phase_success_metrics` | Cross-phase success metrics (search benchmark pass rate, discovery yield, multi-evidence rate, embedding coverage, etc.) |
| `ops_connection_suggestion_metrics` | Connection suggestion acceptance stats |
| `ops_discovery_domain_yield` | Per-domain yield scores |
| `ops_discovery_coverage_summary` | Geography coverage summary |
| `coverage_gaps` | Underrepresented metros/states for gap-driven discovery |
| `people_search_documents` | Denormalized lexical search substrate (internal, `SECURITY DEFINER` sync triggers) |

## RLS Summary
- Core reads require an authenticated active staff session via `is_active_staff()`.
- Writes are role-gated via `has_staff_role('editor')` or `has_staff_role('admin')`.
- `staff_users` supports self read/update for the signed-in row; admins manage all rows.
- `person_text_chunks`, `people_search_documents`, embedding queues, and ops/benchmark views are backend-only — never expose to public client.
- `profile-photos` storage bucket: staff-read, editor-write (`public = false`).
- `person_sectors` and `person_flemish_connections` have insert/delete policies but no update — use conflict-ignore inserts.

## Legacy (in DB, unused in frontend)
| Table | Status |
|---|---|
| `plans`, `plan_actions`, `plan_suggested_people` | Planner feature removed. Tables remain but are unused. |
