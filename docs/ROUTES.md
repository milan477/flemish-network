# Frontend Routes

| Path | Description |
|---|---|
| `/` | Search the network. URL state: `view`, `q`, `sector`, `occupation`, `fc×N`, `city`, `state`, `people`, `organizations`, `lectures`, `focusCity`, `focusState` |
| `/people/:id` | Person profile |
| `/organizations/:id` | Organization profile |
| `/collections` | Collection list |
| `/collections/:id` | Collection detail |
| `/admin` | Staff workspace default, equivalent to `/admin/discovery` |
| `/admin/discovery` | Discovery intake, import, prompted discovery, and pending people review |
| `/admin/verification` | Stale records, profile suggestions, and derived-label review |
| `/admin/growth` | Coverage, source yield, entity pivots, geography gaps, and recommended next discovery actions |
| `/admin/system` | System health, queues, service runs, usage, housekeeping, and cancellation |
| `/admin/access` | Admin-only staff access management |
| `/contacts/new` | Legacy redirect to `/admin/discovery?mode=manual` |
| `/admin/agents` | Legacy redirect to `/admin/discovery` |
| `/admin/discovered` | Legacy redirect to `/admin/discovery` |
| `/admin/overview` | Legacy redirect to `/admin/growth` |
| `/login` | Staff magic-link sign-in |
| `/auth/callback` | Auth redirect landing |
| `/account` | Staff profile |
