# Frontend Routes

| Path | Description |
|---|---|
| `/` | Search the network. URL state: `view`, `q`, `sector`, `occupation`, `fc×N`, `city`, `state`, `people`, `organizations`, `lectures`, `focusCity`, `focusState` |
| `/people/:id` | Person profile |
| `/organizations/:id` | Organization profile |
| `/collections` | Collection list |
| `/collections/:id` | Collection detail |
| `/admin` | Staff workspace default redirect to `/admin/discovery` |
| `/admin/discovery` | Discovery intake, import, prompted discovery, and pending people review |
| `/admin/verification` | Stale records, profile suggestions, and derived-label review |
| `/admin/growth` | Coverage, source yield, entity pivots, geography gaps, and recommended next discovery actions |
| `/admin/system` | System health, queues, service runs, usage, housekeeping, and cancellation |
| `/admin/access` | Admin-only staff access management |
| `/login` | Staff magic-link sign-in |
| `/auth/callback` | Auth redirect landing |
| `/account` | Staff profile |

Unknown `/admin/:tab` values are normalized back to `/admin/discovery`. The old `/contacts/new`, `/admin/agents`, `/admin/discovered`, and `/admin/overview` migration routes are not part of the active route contract.

## Search API Contract

`/` uses the `search-people` edge function as the Search The Network backend.

- Request: `{ query, max_results, match_mode?, filters? }`
- Filters sent from the route state: `show_people`, `show_organizations`, `sector`, `person_scope`, `occupation`, `city`, `state`, and `flemish_connections`.
- Response: `results` is a ranked mixed list with `entity_type = "person" | "organization"`, `score`, `snippet`, and `rationale`; `people` and `organizations` mirror the visible typed subsets.
- Active organization searches use server results. The dashboard no longer fetches the full organization table to filter active queries in the browser; browse mode uses capped organization loads.
