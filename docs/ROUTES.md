# Frontend Routes

| Path | Description |
|---|---|
| `/` | **Network** with Map, List, and Stats views. URL state: `view=map\|list\|stats`, `q`, `sector`, `occupation`, `fc×N`, `city`, `state`, `people`, `organizations`, `lectures`, `focusCity`, `focusState`. The `people` and `organizations` toggles are written symmetrically as `=1` or `=0`. |
| `/people/:id` | Person profile. Editor staff can edit and verify profiles; admin staff can permanently delete approved contacts from this page. |
| `/organizations/:id` | Organization profile |
| `/collections` | Collection list |
| `/collections/:id` | Collection detail |
| `/expand` | Editor/admin redirect to `/expand/discovery`. |
| `/expand/import` | Manual people/organization intake and file import. URL state: `mode=manual\|import`. The header `+` button deep-links to `?mode=manual`. |
| `/expand/discovery` | Discovery propositions and reflection suggestions followed by prompted discovery. Optional `prompt` pre-fills the prompt without starting a run. |
| `/expand/runs` | Discovery and Verification run history, active-run status, outcomes, operational details, and maintenance run controls. The tab badge shows the current active-run count. Legacy `/expand/running` redirects here. |
| `/expand/verification` | Review queues for pending discovered people and organizations. |
| `/expand/maintenance` | Records Freshness, automatic Discovery/Verification schedules, search-index queue, housekeeping, and stuck-run recovery, followed by profile and organization update suggestions. |
| `/settings` | Redirect to System for editors/admins; unauthorized System access normalizes to My Account. |
| `/settings/system` | API usage totals and 14-day usage chart, visible definitions for the Light/Normal/Aggressive maintenance variables, connected services, secure links for adding backend API keys or frontend environment variables, and Supabase connectivity testing. |
| `/settings/access` | Admin-only staff access management. |
| `/settings/account` | Staff profile and password update. Clicking the user name in the top navigation opens this route. |
| `/login` | Staff email/password sign-in and password reset request |
| `/auth/callback` | Supabase invite/recovery redirect landing. Sends password setup straight to `/settings/account?setPassword=1`, and a used or expired email link to `/login` with an explanation. |
| `/account` | Compatibility redirect to `/settings/account`, preserving query parameters. |

Unknown `/expand/:tab` values normalize to `/expand/discovery`; unknown or unauthorized `/settings/:tab` values normalize to the first permitted settings tab. Legacy `/admin/*` paths redirect to their new destination (`growth` merges into Discovery, `coverage` becomes Network Stats, `system` becomes Maintenance, and `access` becomes Settings > Access). `/contacts/new` redirects to `/expand/import?mode=manual`.

Discovery intake defaults to the prompted Discovery option and starts runs only through `agent-scheduler`. Manual intake and file import create pending candidates only. People are written to `discovered_contacts`; organizations are written to `discovered_organizations` plus evidence rows when evidence is supplied. Reviewer approval in the pending queues is the route path that creates or merges approved `people` or `organizations`; intake and import do not create or update approved records.

An empty collection shows **Browse Network** followed by **Launch Discovery**. Launch Discovery asks the collection suggestion planner for collection-specific search directions, navigates to `/expand/discovery`, and pre-fills the generated prompt. It does not start a run until staff select **Run Discovery**.

## Staff Auth Contract

- Staff sign-in uses Supabase Auth email/password (`signInWithPassword`), not magic links.
- `AuthProvider` (`src/lib/auth.tsx`) collapses concurrent `loadStaffUser` calls behind a single-flight ref keyed by `user.id` so the `activate_staff_user_session` RPC fires at most once per session change (was 3–5× per page load before 2026-05-10). Transient revalidation failures keep the cached profile and log a `console.warn`; only a confirmed invalid-JWT / disabled / unapproved error clears the session.
- Every sign-out, including the explicit user-initiated one, uses `signOut({ scope: 'local' })`: it ends only this browser's session, and supabase-js still broadcasts `SIGNED_OUT` to same-origin tabs. Global scope is not used because it revokes the user's sessions on every other browser and device.
- A revoked session keeps a valid-looking JWT until it expires, and PostgREST accepts it; edge functions reject it (`auth.getUser` returns `session_not_found`, surfaced as `401 auth_failed`). `AuthProvider` therefore confirms the session with Supabase Auth (`supabase.auth.getUser()`) when the signed-in user changes, when the tab regains focus (at most once per minute), and after any `401` from `/functions/v1/*` (detected by the fetch wrapper in `src/lib/sessionEvents.ts`). On `session_not_found` supabase-js clears the session and staff land on `/login` with "Your session has ended. Please sign in again."
- `notifyError` (`src/lib/toast.ts`) unwraps raw supabase-js `FunctionsHttpError` bodies, so toasts show the edge function's `{ error: { code, message } }` instead of the generic non-2xx message; `auth_failed` shows the session-ended message.
- `/settings/access` invites and removes staff through the existing staff-management edge functions and remains admin-only.
- Invite and recovery emails redirect through `/auth/callback`, which routes password setup to `/settings/account?setPassword=1&redirect=...` (`buildPasswordSetupPath` in `src/lib/appRouting.ts`). The legacy `/account?setPassword=1` destination still forwards there.
- New invited staff rows set `password_reset_required = true`; authenticated staff with that flag are redirected to `/settings/account?setPassword=1` until the password update succeeds. `RequireAuth` exempts exactly `/settings/account` and the legacy `/account` forward (`isAccountSettingsPath`); guarding any other path causes a redirect loop.
- Invite and recovery links are single-use. When Supabase redirects back with an error (`error_code=otp_expired` for a used or expired link), supabase-js clears the local session and `/auth/callback` shows the reason on `/login` instead of a bare sign-in form.
- The built-in Supabase mailer allows only a few auth emails per hour for the whole project; `/login` explains `over_email_send_rate_limit` instead of showing the raw error.
- Client password setup requires at least 12 characters with uppercase, lowercase, number, and symbol characters. Supabase Auth password policy should match or exceed that rule in project settings.
- Password reset requests use Supabase Auth `resetPasswordForEmail` after checking `can_request_staff_login`.

## Search API Contract

`/` uses the `search-people` edge function as the Search The Network backend. The header autofill dropdown (`UnifiedSearchBar`) uses the `search_people_autofill(q, lim)` RPC over the trigram-GIN-indexed `*_search_documents.name_normalized` columns — not raw `people`/`organizations` ILIKE chains. Triggers at `q.length >= 2` after a 250 ms debounce, with an `AbortController` cancelling stale requests and a small in-memory LRU caching the last 20 queries.

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
- `gap.should_offer` may include a `reason` and `suggested_prompt` for navigating to `/expand/discovery?prompt=<encoded prompt>`. The collection suggestion endpoint and route handoff must not start Discovery; staff must explicitly run the prefilled prompt.
- Legacy people-only callers may still read `suggestions`, which mirrors person candidates as `{ id, name, reason, similarity }`.

## Reflection API Contract

The Reflection section in `DiscoveryPlanningPanel` (shown first within `/expand/discovery`) uses two data sources:

1. Direct Supabase query on `discovery_reflection_suggestions` for active suggestions (`expires_at > now()`, ordered `generated_at DESC`).
2. `supabase.functions.invoke('agent-discovery-reflect', { body: {} })` for the "Run Reflection Now" button.

The `agent-discovery-reflect` endpoint:
- Auth: staff editor bearer token.
- Request: `{}` (no parameters).
- Response: `{ status: "ok", suggestions_written, population_summary, suggestions }` or `{ status: "ok", suggestions_written: 0, message }` when Gemini returned nothing.
- Side effect: inserts rows into `discovery_reflection_suggestions`; `agent-scheduler` housekeeping calls it daily when no suggestions were generated in the last 24 hours.
