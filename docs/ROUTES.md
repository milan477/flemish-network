# Frontend Routes

| Path | Description |
|---|---|
| `/` | Search the network. URL state: `view`, `q`, `sector`, `occupation`, `fc×N`, `city`, `state`, `people`, `organizations`, `lectures`, `focusCity`, `focusState` |
| `/people/:id` | Person profile. Editor staff can edit and verify profiles; admin staff can permanently delete approved contacts from this page. |
| `/organizations/:id` | Organization profile |
| `/collections` | Collection list |
| `/collections/:id` | Collection detail |
| `/admin` | Staff workspace default redirect to `/admin/discovery` |
| `/admin/discovery` | Discovery intake, people/organization import, prompted discovery, Discovery history, and pending people plus pending organization review. URL state: optional `prompt` pre-fills the Discovery intake prompt box without starting a run. |
| `/admin/verification` | Stale records, record suggestions, and derived-label review |
| `/admin/growth` | Coverage, source yield, entity pivots, geography gaps, and recommended next discovery actions |
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
- Filters sent from the route state: `show_people`, `show_organizations`, `sector`, `person_scope`, `occupation`, `city`, `state`, and `flemish_connections`.
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
