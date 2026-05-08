# Frontend Routes

| Path | Description |
|---|---|
| `/` | Search the network. URL state: `view`, `q`, `sector`, `occupation`, `fc×N`, `city`, `state`, `people`, `organizations`, `lectures`, `focusCity`, `focusState` |
| `/people/:id` | Person profile. Editor staff can edit and verify profiles; admin staff can permanently delete approved contacts from this page. |
| `/organizations/:id` | Organization profile |
| `/collections` | Collection list |
| `/collections/:id` | Collection detail |
| `/admin` | Staff workspace default redirect to `/admin/discovery` |
| `/admin/discovery` | Discovery intake, people/organization import, prompted discovery, Discovery history, and the held-out Discovery Eval panel. Pending people and pending organization review have moved to `/admin/verification` (verify-before-promote). URL state: optional `prompt` pre-fills the Discovery intake prompt box without starting a run. |
| `/admin/verification` | Two top-level collapsible sections — **Pending Discovered People** and **Pending Discovered Organizations** (each with count badge, chevron toggle, both open by default) — followed by Records Freshness, Profile Update Suggestions, and Organization Update Suggestions. Discovered rows display greyed-out while `verification_status IN ('queued', 'verifying')` and gain Approve/Reject only when `verified`; verification contradictions are hard-deleted by `agent-verify` and disappear from the list. UI subscribes to `discovered_contacts` and `discovered_organizations` via Supabase realtime so cards flip from greyed → normal without manual refresh. No user-facing scope picker — Approve uses the scope inferred by `agent-verify`. |
| `/admin/coverage` | Descriptive coverage overview: people/org/city stat cards, occupation breakdown, data quality, sector distribution, Flemish connection chart, and location explorer. URL state: `?tab=coverage` |
| `/admin/growth` | Source yield, entity pivots, geography gaps, discovery planning, reflection loop status, and recommended next discovery actions |
| `/admin/system` | System health, record-index queues, service runs, usage, housekeeping, and cancellation |
| `/admin/access` | Admin-only staff access management |
| `/login` | Staff email/password sign-in and password reset request |
| `/auth/callback` | Supabase invite/recovery redirect landing; routes password setup to `/account?setPassword=1` |
| `/account` | Staff profile and password update |

Unknown `/admin/:tab` values are normalized back to `/admin/discovery`. The old `/contacts/new`, `/admin/agents`, `/admin/discovered`, and `/admin/overview` migration routes are not part of the active route contract.

Discovery intake defaults to the prompted Discovery option and starts runs only through `agent-scheduler`. Manual intake and file import create pending candidates only. People are written to `discovered_contacts`; organizations are written to `discovered_organizations` plus evidence rows when evidence is supplied. Reviewer approval in the pending queues is the route path that creates or merges approved `people` or `organizations`; intake and import do not create or update approved records.

## Staff Auth Contract

- Staff sign-in uses Supabase Auth email/password (`signInWithPassword`), not magic links.
- `/admin/access` invites staff through the `invite-staff-user` edge function. The function requires admin staff auth, writes/updates the approved `staff_users` row, and calls Supabase `auth.admin.inviteUserByEmail`.
- Invite and recovery emails redirect through `/auth/callback` and then to `/account?setPassword=1`.
- New invited staff rows set `password_reset_required = true`; authenticated staff with that flag are redirected to `/account` until Supabase Auth password update succeeds and the flag is cleared.
- Client password setup requires at least 12 characters with uppercase, lowercase, number, and symbol characters. Supabase Auth password policy should match or exceed that rule in project settings.
- Password reset requests use Supabase Auth `resetPasswordForEmail` after checking `can_request_staff_login`.

## Search API Contract

`/` uses the `search-people` edge function as the Search The Network backend.

- Request: `{ query, max_results, match_mode?, filters? }`
- Filters sent from the route state: `show_people`, `show_organizations`, `sector`, `person_scope`, `occupation`, `city`, `state`, and alias-aware canonical `flemish_connections`.
- Response: `results` is a ranked mixed list with `entity_type = "person" | "organization"`, `score`, `snippet`, and `rationale`; `people` and `organizations` mirror the visible typed subsets.
- Active organization searches use server results. The dashboard no longer fetches the full organization table to filter active queries in the browser; browse mode uses capped organization loads.

## Collection Suggestion API Contract

`/collections` and `/collections/:id` use the deployed `suggest-people` edge function as the Build A Collection suggestion backend.

- Request: `{ query, collection_id?, exclude_ids?, exclude_organization_ids?, max_results? }`
- `collection_id` excludes existing collection members server-side.
- `exclude_ids` and `exclude_organization_ids` carry draft people and organization IDs that should stay suppressed during the current draft, including rejected candidates.
- `/collections/:id` also includes current visible member IDs in the draft exclusion payload and guards accepted inserts client-side so duplicate people or organizations are not added.
- `/collections/:id` caches the current suggestion draft in browser storage per collection. Revisiting the route restores pending/approved/rejected draft state until staff refresh, reset, or save approved members.
- Clicking a suggestion in `/collections/:id` opens an in-place person or organization preview; staff can still open the full profile from that preview.
- Search result cards and organization profiles use the shared add-to-collection control; it inserts exactly one member entity per row with either `person_id` or `organization_id`.
- Response: `{ message, searches, candidates, gap }`
- Each candidate has `entity_type = "person" | "organization"`, `id`, `name`, `reason`, `score`, optional `snippet`, and `source_search`.
- `gap.should_offer` may include a `reason` and `suggested_prompt` for navigating to `/admin/discovery?prompt=<encoded prompt>`. The collection suggestion endpoint and route handoff must not start Discovery; staff must explicitly run the prefilled prompt.
- Legacy people-only callers may still read `suggestions`, which mirrors person candidates as `{ id, name, reason, similarity }`.

## Reflection API Contract

The Reflection section in `DiscoveryPlanningPanel` (shown within `/admin/growth`) uses two data sources:

1. Direct Supabase query on `discovery_reflection_suggestions` for active suggestions (`expires_at > now()`, ordered `generated_at DESC`).
2. `supabase.functions.invoke('agent-discovery-reflect', { body: {} })` for the "Run Reflection Now" button.

The `agent-discovery-reflect` endpoint:
- Auth: staff editor bearer token.
- Request: `{}` (no parameters).
- Response: `{ status: "ok", suggestions_written, population_summary, suggestions }` or `{ status: "ok", suggestions_written: 0, message }` when Gemini returned nothing.
- Side effect: inserts rows into `discovery_reflection_suggestions`; `agent-scheduler` housekeeping calls it daily when no suggestions were generated in the last 24 hours.

## Discovery Eval Endpoint

`/admin/discovery` calls the `eval-holdout-check` edge function from the Discovery Eval panel.

- Request: `{ lookback_days?: number }` (default 30, max 180).
- Auth: staff editor bearer token, or service-role key (cron path).
- Response: `{ status: "ok", holdout_count, matched_count, unchanged_count, lookback_days }`.
- Side effect: updates `last_seen_as_candidate_at`, `last_seen_candidate_id`, `last_seen_run_id` on matched `discovery_eval_holdout` rows.
