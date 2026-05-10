# Frontend Routes

| Path | Description |
|---|---|
| `/` | Search the network. URL state: `view`, `q`, `sector`, `occupation`, `fc×N`, `city`, `state`, `people`, `organizations`, `lectures`, `focusCity`, `focusState`. The `people` and `organizations` toggles are written symmetrically as `=1` or `=0` (never omitted) so that on→off→on round-trips through merged URL state (UX_REMEDIATION Phase 4A). |
| `/people/:id` | Person profile. Editor staff can edit and verify profiles; admin staff can permanently delete approved contacts from this page. |
| `/organizations/:id` | Organization profile |
| `/collections` | Collection list |
| `/collections/:id` | Collection detail |
| `/admin` | Staff workspace default redirect to `/admin/discovery` |
| `/admin/discovery` | Discovery intake, people/organization import, prompted discovery, and Discovery history. Pending people and pending organization review have moved to `/admin/verification` (verify-before-promote). URL state: `mode=discovery\|manual\|import` selects the intake sub-tab (default `discovery`; missing/unknown values normalize to `discovery`); optional `prompt` pre-fills the Discovery intake prompt box without starting a run. The header `+` button (aria-label "Add person or organization") deep-links to `/admin/discovery?mode=manual`. The Run Discovery button is disabled while any `discovery` agent_run is `pending` or `running`. |
| `/admin/verification` | Two top-level collapsible sections — **Pending Discovered People** and **Pending Discovered Organizations** (each with count badge, chevron toggle, both open by default) — followed by Records Freshness, Profile Update Suggestions, and Organization Update Suggestions. Discovered rows display greyed-out while `verification_status IN ('queued', 'verifying')` and gain Approve/Reject only when `verified`; verification contradictions are hard-deleted by `agent-verify` and disappear from the list. UI subscribes to `discovered_contacts` and `discovered_organizations` via Supabase realtime so cards flip from greyed → normal without manual refresh. No user-facing scope picker — Approve uses the scope inferred by `agent-verify`. |
| `/admin/coverage` | Descriptive coverage overview: people/org/city stat cards, occupation breakdown, data quality, sector distribution, Flemish connection chart, and location explorer. URL state: `?tab=coverage` |
| `/admin/growth` | Discovery planning and reflection loop status. The "Where to look next" panel's Explore button and the header "Start discovery run" button both trigger `agent-scheduler` with `params.suggestion_id` so the run consumes a specific reflection suggestion (rather than the bandit picking arms independently). _Planned (not yet built): source yield panel, entity pivots panel, geography gaps panel, recommended-next-actions panel. These are tracked in `docs/WEBAPP-MASTERPLAN.md` and will be re-added here when shipped._ |
| `/admin/system` | Service schedule cards (Discovery, Verification) with cadence presets, per-card Run-now, and a `Schedule: <cadence>` line; search-index footer reads `N search-index records pending` with a `Drain now` button (tooltip describes that it flushes the embedding queue); top toolbar exposes `Test Supabase` and `Run Housekeeping` (both with `title`/`aria-label` describing their effect); today's API usage tile (Apify metrics gated behind `VITE_SHOW_APIFY` or non-zero usage); and stuck-run cancellation. Stale failure banners are suppressed once a newer success lands. Schedules driven by `agent-scheduler-tick` pg_cron job (every 5 min) and persisted in `agent_schedules`; preset changes require admin role. |
| `/admin/access` | Admin-only staff access management |
| `/login` | Staff email/password sign-in and password reset request |
| `/auth/callback` | Supabase invite/recovery redirect landing; routes password setup to `/account?setPassword=1` |
| `/account` | Staff profile and password update |

Unknown `/admin/:tab` values are normalized back to `/admin/discovery`. The old `/contacts/new`, `/admin/agents`, `/admin/discovered`, and `/admin/overview` migration routes are not part of the active route contract.

Discovery intake defaults to the prompted Discovery option and starts runs only through `agent-scheduler`. Manual intake and file import create pending candidates only. People are written to `discovered_contacts`; organizations are written to `discovered_organizations` plus evidence rows when evidence is supplied. Reviewer approval in the pending queues is the route path that creates or merges approved `people` or `organizations`; intake and import do not create or update approved records.

## Staff Auth Contract

- Staff sign-in uses Supabase Auth email/password (`signInWithPassword`), not magic links.
- `/admin/access` invites staff through the `invite-staff-user` edge function. The function requires admin staff auth, writes/updates the approved `staff_users` row, and calls Supabase `auth.admin.inviteUserByEmail`.
- `/admin/access` removes staff through the `remove-staff-user` edge function. The function requires admin staff auth, refuses self-removal, deletes the `staff_users` row, and deletes the linked `auth.users` record so the user disappears from the access list (re-inviting is required to grant access again).
- Invite and recovery emails redirect through `/auth/callback` and then to `/account?setPassword=1`.
- New invited staff rows set `password_reset_required = true`; authenticated staff with that flag are redirected to `/account` until Supabase Auth password update succeeds and the flag is cleared.
- Client password setup requires at least 12 characters with uppercase, lowercase, number, and symbol characters. Supabase Auth password policy should match or exceed that rule in project settings.
- Password reset requests use Supabase Auth `resetPasswordForEmail` after checking `can_request_staff_login`.

## Search API Contract

`/` uses the `search-people` edge function as the Search The Network backend.

- The query box on `/` is a pure semantic-intent channel (UX_REMEDIATION Phase
  1A). The natural-language filter parser was removed; filter chips are set
  only by clicks on the filter panel and never auto-extracted from `?q=`.
- Request: `{ query, max_results, match_mode?, filters? }`
- Filters sent from the route state: `show_people`, `show_organizations`,
  `sector`, `person_scope`, `occupation`, `city`, `state`, and alias-aware
  canonical `flemish_connections`. Filters now act as soft signals — Stage 2
  Gemini rerank is the authority on which Stage 1 candidates make the top of
  the list.
- Response:
  `{ results, people, organizations, keywords, match_mode, route, degraded, rerank, rerank_status, rerank_model, rerank_duration_ms, diagnostics, message, total_with_embeddings }`.
  `results` is a ranked mixed list with
  `entity_type = "person" | "organization"`, `score`, `snippet`, and
  `rationale`; `people` and `organizations` mirror the visible typed subsets.
  When `rerank_status !== "ok"` the order is the Stage 1 hybrid ranking and
  the per-row rationale falls back to the lexical-derived text.
- Active organization searches use server results. The dashboard no longer
  fetches the full organization table to filter active queries in the
  browser; browse mode uses capped organization loads.

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

