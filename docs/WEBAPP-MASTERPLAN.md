# Webapp Focus And Cleanup Masterplan

This is the implementation handoff for the webapp cleanup. It translates the product direction in `docs/PRODUCT-SERVICES.md` into phases, concrete todos, and verification steps.

Use these docs as the active source set:

- `docs/PRODUCT-SERVICES.md`: product truth and service boundaries.
- `docs/ROUTES.md`: route contract and migration redirects.
- `docs/SCHEMA.md`: table contract, current legacy tables, and target schema changes.
- `docs/AI-PIPELINE.md`: edge function ownership and AI behavior contracts.
- `docs/EVALUATION.md`: quality gates for discovery, verification, and growth recommendations.

Archived context lives under `docs/archive/` and is not source of truth. Do not reintroduce standalone AI strategy, Dynamics integration, or organization-discovery-agent docs.

## Status Legend

- `[done]`: implemented in the current cleanup pass.
- `[next]`: first follow-up work that should be picked up next.
- `[later]`: still in target scope, but depends on prior phases.
- `[blocked]`: requires a product/schema decision before implementation.

## Target Product Shape

The app should feel like five services, not a pile of agents.

| Product service | Route | Primary UI | Backend owner |
|---|---|---|---|
| Search The Network | `/` | Search map/list, filters, ranked people and organizations | `search-people` |
| Build A Collection | `/collections`, `/collections/:id` | Collection list/detail, draft workflow, candidate approval | `suggest-people`; target adds organizations |
| Expand The Database | `/admin/discovery` | Manual intake, import, prompted discovery, pending candidate review | `agent-scheduler` -> `agent-discovery` |
| Verify And Enrich Records | `/admin/verification` | Stale records, suggestions, derived labels, inline verification | `agent-verify`; `update-profile` remains preview mode until consolidated |
| Understand And Grow The Network | `/admin/growth` | Coverage, source yield, pivots, gaps, recommended discovery actions | `agent-scheduler` planning and metrics |

`/admin/system` is the operator health surface. `/admin/access` is admin-only staff access management.

## Product Decisions

- Search and Collections stay primary in the navigation.
- `/admin` is a staff workspace with Discovery, Verification, Network Growth, System, and Access tabs.
- Person-to-person connections are removed from the product. Flemish/Belgian ties remain profile and organization facts, not social edges.
- Discovery is evidence-first. New people and organizations stay pending until reviewed.
- Collections search existing records only. Database expansion requires an explicit handoff to Discovery.
- Verification has preview and durable modes. Durable changes write reviewable suggestions.
- Organization Flemish/Belgian relevance is in scope as filterable canonical facts plus source-backed raw evidence.
- Staff-facing UI should use product vocabulary: Discovery, Verification, Network Growth, System, Access. Do not show `AI Agent`, `agent-*`, or "Connections agent" as user-facing labels.

## Non-Goals

- Do not rebuild person-to-person graph features.
- Do not make Collections secretly expand the database.
- Do not auto-promote discovered people or organizations.
- Do not add another discovery edge function when `agent-discovery` can own the durable workflow.
- Do not restore archived docs as active planning material.

## Current Baseline

Completed in the current cleanup pass:

- `[done]` Admin route vocabulary now uses Discovery, Verification, Network Growth, System, and Access.
- `[done]` Manual add/import entry points use `/admin/discovery`; obsolete legacy routes are not part of the active route contract.
- `[done]` Standalone discovery chatbot UI was removed from the active staff flow.
- `[done]` Profile person-to-person Network section and graph modal were removed.
- `[done]` `agent-scheduler` rejects `connection` runs.
- `[done]` `agent-connections` was removed from Supabase function config and product surface.
- `[done]` Admin, profile, collections, map, and heavy vendor code were split enough that `npm run build` no longer emits the Vite large chunk warning.
- `[done]` `docs/AI-STRATEGY.md` and `docs/DYNAMICS-INTEGRATION.md` were archived.
- `[done]` `docs/ORGANIZATION-DISCOVERY-AGENT.md` was folded into `docs/AI-PIPELINE.md` and `docs/EVALUATION.md`, then deleted.

Known legacy still present:

- `[later]` Old DB migrations still create `connections`, `connection_suggestions`, and `discover_connections()`.
- `[later]` Generated Supabase types still include connection artifacts until the DB cleanup migration and type regeneration happen.
- `[later]` Legacy compatibility functions `discover-contacts`, `search-contacts`, and `ai-agent` tasks `parse_contacts` / `flemish_search` still exist until replacement flows are complete.
- `[later]` Collections are still people-first in live UI and schema.
- `[done]` Organization search has server-side ranked lexical result parity for Phase 3.

## Phase 0 - Documentation And Service Map

Goal: make the active docs small, current, and hard to misread.

Scope:

- Keep one product truth doc, one masterplan, and focused route/schema/pipeline/evaluation references.
- Archive historical strategy/background docs.
- Fold narrow standalone agent docs into the pipeline/evaluation docs.
- Define service-to-route-to-function ownership.

Todos:

- `[done]` Create this masterplan with explicit phases and test criteria.
- `[done]` Keep `docs/PRODUCT-SERVICES.md` as product truth.
- `[done]` Archive `docs/AI-STRATEGY.md` and extract only minimal current ideas.
- `[done]` Archive `docs/DYNAMICS-INTEGRATION.md`.
- `[done]` Fold organization discovery inclusion rules and output contract into `docs/AI-PIPELINE.md` and `docs/EVALUATION.md`.
- `[done]` Delete active `docs/ORGANIZATION-DISCOVERY-AGENT.md`.
- `[next]` Update this masterplan after each implementation phase so future agents know what is done.

Exit criteria:

- Active docs are limited to `PRODUCT-SERVICES.md`, `WEBAPP-MASTERPLAN.md`, `ROUTES.md`, `SCHEMA.md`, `AI-PIPELINE.md`, and `EVALUATION.md`.
- No active doc points future work at archived strategy docs as source of truth.
- Historical docs exist only under `docs/archive/` or are deleted.

Verification:

```sh
rg --files docs | sort
test -f docs/archive/AI-STRATEGY.md
test -f docs/archive/DYNAMICS-INTEGRATION.md
test ! -e docs/AI-STRATEGY.md
test ! -e docs/DYNAMICS-INTEGRATION.md
test ! -e docs/ORGANIZATION-DISCOVERY-AGENT.md
```

## Phase 1 - Staff Workspace And UX Vocabulary

Goal: make staff workflows match the five-service IA and remove implementation names from visible UI.

Scope:

- `/admin` becomes a staff workspace.
- Staff tabs are Discovery, Verification, Network Growth, System, and Access.
- Manual add/import lives inside Discovery.
- Obsolete migration routes are not part of the active route contract.
- The standalone discovery chatbot path is removed.

Todos:

- `[done]` Normalize admin tabs to `discovery`, `verification`, `growth`, `system`, and `access`.
- `[done]` Redirect `/admin` to Discovery by default.
- `[done]` Remove obsolete `/contacts/new`, `/admin/agents`, `/admin/discovered`, and `/admin/overview` route support from the active route contract.
- `[done]` Move manual add/import into Discovery.
- `[done]` Remove `AdminChatbot` from the active UI.
- `[done]` Search visible text for `AI Agent`, `agent-*`, "Connections agent", and legacy tab names, then rename remaining staff-facing labels.
- `[done]` Add route normalization tests for canonical staff tabs and unknown admin tabs.

Out of scope:

- Schema cleanup.
- Organization discovery review.
- Verification service consolidation.

Exit criteria:

- Staff users can reach the five tabs from `/admin`.
- Obsolete legacy URLs are not advertised or linked from the active app.
- No visible staff navigation item is named after an edge function or internal agent.

Verification:

```sh
npm run typecheck
npm test
npm run build
rg "AI Agent|Connections agent" src
```

Manual checks:

- Open `/admin`, `/admin/discovery`, `/admin/verification`, `/admin/growth`, `/admin/system`, `/admin/access`.
- Confirm navigation and tab labels use product vocabulary instead of internal edge-function names.

## Phase 2 - Remove Person-To-Person Connection Product Layer

Goal: fully remove person-to-person connections as a product concept while preserving useful source facts.

Scope:

- Remove graph UI, profile Network section, connection scheduler controls, connection metrics, and connection service references.
- Keep Flemish/Belgian profile facts, organization facts, sectors, locations, and evidence.
- Keep DB artifacts temporarily only where migrations/types still require them.

Todos:

- `[done]` Remove profile graph section.
- `[done]` Remove graph modal usage.
- `[done]` Remove connection scheduler controls from staff UI.
- `[done]` Remove `agent-connections` function surface.
- `[done]` Reject connection runs in `agent-scheduler`.
- `[done]` Add scheduler test that `agent_type = "connection"` returns `invalid_input`.
- `[later]` Add a DB migration that drops unused connection RPCs, views, tables, policies, and metrics after confirming no live backend references remain.
- `[later]` Regenerate Supabase types after the DB cleanup migration.
- `[later]` Remove stale connection tests that only protect deleted behavior.

Out of scope:

- Removing Flemish/Belgian connection facts.
- Removing organization placement or US relevance facts.

Exit criteria:

- Product UI no longer describes direct connections, network reach, social graph, or affinity suggestions.
- `agent-scheduler` cannot run a connection job.
- DB cleanup migration has no remaining references to dropped connection objects.

Verification:

```sh
npm run typecheck
npm test
npm run test:deno
rg "agent-connections|connection_suggestions|discover_connections|ConnectionGraphModal|Direct Connections|Network Reach|Affinity" src supabase docs --glob '!docs/archive/**'
```

## Phase 3 - Search The Network

Goal: keep Search focused on existing records and give organizations the same server-side quality as people.

Scope:

- Search only `people` and `organizations` that already exist in approved tables.
- Move organization search server-side instead of fetching/filtering all organizations client-side.
- Return ranked organization results with rationale/snippets.
- Keep filters based on normalized people/organization facts.
- Keep add-to-collection controls people-only in Phase 3; organization collection membership is Phase 4.

Todos:
- `[done]` Add `scripts/seed_phase3_search_dataset.ts` / `npm run seed:phase3` to reset approved people/organizations and seed 160 synthetic people plus 75 synthetic organizations.
- `[done]` Identify and replace the active-query organization path that fetched and filtered the full organization table in the dashboard.
- `[done]` Extend `search-people` so it returns mixed people and organization results together.
- `[done]` Add `organization_search_documents`, sync triggers/indexes, and `search_organizations_lexical`.
- `[done]` Add organization ranking, snippets, rationale fields, and structured criteria coverage.
- `[done]` Update Search UI/cache to consume server-side organization results.
- `[done]` Add capped organization browse loads so Search does not fetch whole organization tables.
- `[later]` Include canonical organization Flemish/Belgian facts once Phase 6 lands.
- `[later]` Add organization add-to-collection controls after Phase 4 adds organization collection membership.

Out of scope:

- Discovering new organizations from Search.
- Collection draft workflow.
- Organization-to-Collection membership and add controls.

Exit criteria:

- Organization results are ranked server-side.
- Search UI no longer loads all organizations to filter in the browser.
- Organization results show why they matched.
- Existing people search behavior does not regress.

Verification:

```sh
npm run typecheck
npm test
npm run test:deno
npm run build
rg "from\\('organizations'\\)|from\\(\"organizations\"\\)" src
graphify update .
```

Focused tests to add:

- Query returns mixed people and organization results for a Flemish/Belgian entity.
- Organization results include snippet/rationale.
- Empty or broad queries respect result limits.
- Organization filters cover sector, location, and existing Flemish/Belgian text facts; canonical organization facts remain Phase 6.

Manual checks:

- Search for `KU Leuven Boston`, `imec California`, and `Belgian biotech New York`.
- Confirm result counts, snippets, and filters are useful.

## Phase 4 - Collections Draft Workflow

Goal: make Collections a reviewable existing-record workflow for people and organizations.

Scope:

- Parse a collection goal into focused searches.
- Search existing people and organizations.
- Rank candidates against the goal.
- Let users approve/reject candidates before saving.
- Save accepted people and organizations to a collection.
- Provide explicit handoff to Discovery when the collection prompt reveals a database gap.

Todos:

- `[next]` Extend `collection_members` to support `organization_id` with correct uniqueness and constraints.
- `[next]` Update Supabase types after schema migration.
- `[next]` Extend `suggest-people` or rename behind a collection suggestion service contract that returns people and organizations.
- `[next]` Add draft state for suggested candidates, approval/rejection, and reasons.
- `[next]` Update collection detail UI to render people and organization members.
- `[next]` Update add-to-collection controls for organizations. This is explicitly deferred from Phase 3 because live collection membership is still people-only.
- `[next]` Add explicit "send gap to Discovery" action without auto-running discovery.

Out of scope:

- Autonomous discovery.
- Gap analytics beyond a simple handoff.

Exit criteria:

- A collection can contain people and organizations.
- Suggested candidates are not saved until accepted.
- Rejected candidates do not reappear in the same draft without a clear reset.
- Collection generation never writes to discovery or approved entity tables.

Verification:

```sh
npm run typecheck
npm test
npm run build
```

Focused tests to add:

- `collection_members` accepts either `person_id` or `organization_id`, not neither.
- Duplicate people and duplicate organizations are prevented per collection.
- Collection suggestion response can include organization candidates.
- Approve/reject state persists correctly.

Manual checks:

- Build a collection for `senior biotech leaders in Boston and New York with Belgian ties`.
- Accept one person and one organization.
- Reject a candidate and confirm it is not saved.

## Phase 5 - Discovery

Goal: make `agent-discovery` the only durable discovery workflow for new people and organizations.

Scope:

- Prompted discovery calls `agent-scheduler` with `agent_type = "discovery"`.
- `agent-discovery` persists pending people to `discovered_contacts`.
- `agent-discovery` persists pending organizations to `discovered_organizations`.
- Discovery review UI handles pending people and pending organizations.
- Approval remains evidence-first and reviewer-controlled.
- Legacy compatibility functions are removed after replacement flows are live.

Todos:

- `[next]` Find all UI calls to `discover-contacts`, `search-contacts`, `parse_contacts`, and `flemish_search`.
- `[next]` Replace prompted discovery calls with `agent-scheduler` -> `agent-discovery`.
- `[next]` Extend `agent-discovery` extraction and persistence for pending organizations.
- `[next]` Add organization dedupe against approved organizations and pending discovered organizations.
- `[next]` Add pending organization review UI alongside pending people.
- `[next]` Store organization source URLs, evidence excerpts, confidence, sectors, locations, and Flemish/Belgian relevance.
- `[later]` Remove `discover-contacts`, `search-contacts`, and legacy `ai-agent` tasks after no live references remain.
- `[later]` Update docs and tests to remove compatibility language once deletion is complete.

Out of scope:

- Auto-approval into `people` or `organizations`.
- Person-to-person connection inference.

Exit criteria:

- Prompted Discovery creates an `agent_runs` discovery run through scheduler.
- New organization candidates land in `discovered_organizations` with evidence.
- Reviewers can approve, reject, or merge pending organizations.
- Legacy discovery functions have no UI callers.

Verification:

```sh
npm run typecheck
npm test
npm run test:deno
npm run build
rg "discover-contacts|search-contacts|parse_contacts|flemish_search" src supabase docs --glob '!docs/archive/**'
```

Focused tests to add:

- Scheduler creates discovery runs and rejects unsupported agent types.
- Discovery org persistence writes all required evidence fields.
- Organization dedupe handles approved and pending records.
- Review approval never promotes an organization without reviewer action.

Manual checks:

- Run prompted discovery for `Flemish-connected organizations in Houston energy`.
- Confirm pending organizations show source URLs and evidence excerpts.
- Reject a weak candidate and approve a strong one.

## Phase 6 - Flemish / Belgian Fact Normalization

Goal: make Flemish/Belgian relevance canonical and filterable without losing raw evidence.

Scope:

- Expand `flemish_connections` into a canonical catalog.
- Store aliases, parent/group support, entity type, and `is_filterable`.
- Store overly specific facts as roles, aliases, or evidence, not default filter chips.
- Add organization-side Flemish/Belgian fact relationships.
- Update search, filters, profile chips, organization chips, discovery extraction, verification, embeddings, and derived-label approval.

Todos:

- `[next]` Design migration for canonical catalog fields: aliases, parent, group, entity type, filterability.
- `[next]` Seed broad useful filters such as KU Leuven, UGent, imec, BAEF, Flemish Government, FIT, VUB, Vlerick, VITO, Flanders Make, and VIB.
- `[next]` Add `organization_flemish_connections` with role, confidence, source URL, and evidence excerpt.
- `[next]` Migrate existing person facts into canonical entities.
- `[next]` Update derived label suggestion approval to canonicalize before insert.
- `[next]` Update discovery extraction to produce canonical entity plus raw evidence.
- `[next]` Update verification to propose normalized people and organization facts.
- `[next]` Update search filters and chips to use `is_filterable`.
- `[next]` Refresh search documents and embeddings after approved fact changes.

Out of scope:

- Treating shared Flemish/Belgian facts as social relationships.
- Creating filter chips for every raw phrase found on the web.

Exit criteria:

- Users can filter by broad canonical Flemish/Belgian entities.
- Profiles and organizations show evidence-backed facts.
- Raw facts remain reviewable and auditable.
- Specific evidence does not pollute the main filter list.

Verification:

```sh
npm run typecheck
npm test
npm run test:deno
npm run build
```

Focused tests to add:

- Alias canonicalization maps `University of Ghent` to `UGent`.
- Non-filterable raw facts do not appear as default filter chips.
- Organization Flemish facts store role, confidence, URL, and excerpt.
- Derived-label approval writes canonical relationships idempotently.

Manual checks:

- Filter Search by KU Leuven, UGent, imec, and BAEF.
- Open a person and organization profile and inspect chips plus evidence.

## Phase 7 - Verification

Goal: consolidate profile and organization verification into one service contract with preview and durable modes.

Scope:

- `update-profile` becomes preview mode behavior.
- `agent-verify` owns durable reviewable suggestions.
- Add organization verification.
- Replace person-only `profile_suggestions` with a record-level suggestion queue or compatibility layer that supports people and organizations.
- Keep high-risk suggestions review-first.
- Move stale records, suggestion queues, derived labels, and inline profile verification into `/admin/verification`.

Todos:

- `[next]` Define one verification request/response contract with `mode: "preview" | "durable"`.
- `[next]` Share evidence gathering, field comparison, risk routing, and suggestion formatting.
- `[next]` Add organization verification inputs and outputs.
- `[next]` Add record-level suggestion schema or compatibility view.
- `[next]` Update `/admin/verification` to show people and organization queues.
- `[next]` Update inline profile verification to call preview mode only.
- `[next]` Ensure durable mode writes suggestions with source URL, evidence excerpt, confidence, method, and run ID.
- `[later]` Retire separate `update-profile` endpoint after callers move to the unified contract.

Out of scope:

- Auto-applying high-risk suggestions.
- Verification of pending discovery candidates before reviewer approval.

Exit criteria:

- Preview mode returns inline suggestions without durable writes.
- Durable mode creates reviewable suggestions.
- Organization verification is supported.
- Suggestions are conservative and evidence-backed.

Verification:

```sh
npm run typecheck
npm test
npm run test:deno
npm run build
```

Focused tests to add:

- Preview mode performs no durable writes.
- Durable mode writes person suggestions with evidence.
- Durable mode writes organization suggestions with evidence.
- High-risk changes remain pending review.
- Suggestion dedupe prevents repeated identical suggestions.

Manual checks:

- Run inline verification on a profile and confirm no persistent suggestion is created.
- Run staff durable verification and confirm suggestions appear in `/admin/verification`.

## Phase 8 - Network Growth

Goal: reframe growth around coverage, source yield, entity pivots, geography gaps, and next discovery actions.

Scope:

- Use `docs/EVALUATION.md` as the acceptance rubric.
- Show actionable coverage and source signals.
- Recommend next searches from evidence-backed pivots, proven domains, source packs, and coverage gaps.
- Remove social graph language.

Todos:

- `[done]` Route `/admin/growth` exists as the staff Network Growth tab.
- `[next]` Audit Growth UI for social graph wording.
- `[next]` Show source yield and proven domains.
- `[next]` Show evidence-backed entity pivots.
- `[next]` Show metro/sector gaps that are specific enough to act on.
- `[next]` Add recommended next discovery actions with rationale.
- `[next]` Allow a recommended action to start or prefill Discovery through `agent-scheduler`.
- `[later]` Remove old planner tables after confirming no live references remain.

Out of scope:

- Person-to-person network reach.
- Affinity scoring between people.

Exit criteria:

- Growth recommendations explain why they are useful.
- Recommendations name a source family, domain, entity pivot, metro, sector, or coverage gap.
- Operators can send a recommendation to Discovery without manually copying context.

Verification:

```sh
npm run typecheck
npm test
npm run build
```

Focused tests to add:

- Recommended actions satisfy the evaluation rubric fields.
- Exhausted domains are not repeatedly recommended.
- Recommended action handoff preserves source/gap/pivot context.

Manual checks:

- Open `/admin/growth`.
- Confirm recommendations are specific, evidence-based, and not social graph language.

## Phase 9 - Legacy Removal And Performance

Goal: remove dead backend artifacts and keep the webapp fast enough that build warnings stay gone.

Scope:

- Drop legacy connection DB artifacts once no live references remain.
- Drop planner tables if no live references remain.
- Remove legacy compatibility edge functions after callers are gone.
- Keep Admin, map, export, and heavy staff panels code-split.
- Replace full-table frontend loads with server-side pagination/search.
- Keep initial JS under 500 KB minified and no Vite chunk warning.

Todos:

- `[done]` Initial code splitting removed the current Vite chunk warning.
- `[next]` Audit frontend full-table loads for `people`, `organizations`, collections, suggestions, and staff metrics.
- `[next]` Add pagination or server-side querying for large staff panels.
- `[later]` Delete legacy discovery compatibility functions after Phase 5.
- `[later]` Drop connection tables/RPCs/views after Phase 2 cleanup is proven.
- `[later]` Drop old planner tables after Phase 8 cleanup is proven.
- `[later]` Regenerate Supabase database types after schema removal.
- `[later]` Confirm build chunks stay below target after each feature phase.

Out of scope:

- Cosmetic frontend redesign.
- Optimizing archived or deleted routes.

Exit criteria:

- `npm run build` has no Vite chunk warning.
- No initial application JS chunk exceeds 500 KB minified.
- Large lists use server-side queries, pagination, or lazy loading.
- Legacy functions/tables have no live references before deletion.

Verification:

```sh
npm run typecheck
npm test
npm run test:deno
npm run build
rg "from\\('people'\\)|from\\(\"people\"\\)|from\\('organizations'\\)|from\\(\"organizations\"\\)" src
rg "discover-contacts|search-contacts|agent-connections|connection_suggestions|discover_connections|plans|plan_actions|plan_suggested_people" src supabase docs --glob '!docs/archive/**'
```

## Cross-Phase Test Policy

Run the smallest relevant suite during development, then run the full suite before handoff for any code or schema change.

Full verification:

```sh
npm run typecheck
npm test
npm run test:deno
npm run build
graphify update .
```

Docs-only verification:

```sh
rg --files docs | sort
test -f docs/archive/AI-STRATEGY.md
test -f docs/archive/DYNAMICS-INTEGRATION.md
test ! -e docs/AI-STRATEGY.md
test ! -e docs/DYNAMICS-INTEGRATION.md
test ! -e docs/ORGANIZATION-DISCOVERY-AGENT.md
```

Schema-change verification:

```sh
npm run typecheck
npm test
npm run test:deno
npm run build
```

Add focused tests in the phase where behavior changes. Do not rely only on snapshots or broad build success.

## Handoff Rules For Future Agents

- Start with this file, then read the specific active doc for the phase being implemented.
- Keep `docs/PRODUCT-SERVICES.md` product-level; put implementation behavior in `docs/AI-PIPELINE.md`, schema facts in `docs/SCHEMA.md`, and tests/quality gates in `docs/EVALUATION.md`.
- Update this masterplan at the end of each phase by moving completed todos from `[next]` or `[later]` to `[done]`.
- Do not restore archived docs or recreate single-agent docs.
- If code files change, run `graphify update .` before handoff.
