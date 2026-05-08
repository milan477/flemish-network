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
| Build A Collection | `/collections`, `/collections/:id` | Collection list/detail, draft workflow, candidate approval | `suggest-people` collection suggestions over approved people and organizations |
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
- Staff authentication uses Supabase Auth email/password. Access invites go through Supabase Auth invitation email and require first-password setup; magic-link login is not an active flow.

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
- `[done]` Legacy Discovery compatibility functions and retired `ai-agent` Discovery tasks were removed after Phase 5 replacement flows went live.
- `[done]` Organization search has server-side ranked lexical result parity for Phase 3.
- `[done]` Collections support mixed people and organization members in schema, suggestions, detail UI, and add-to-collection controls.
- `[done]` Collection detail suggestions restore from a per-collection browser cache and open profile previews in place instead of navigating away.
- `[done]` Admin embedding health and metrics copy uses record/entity vocabulary while preserving current person-keyed backend contracts.

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
- `[later]` Move organization search/filter behavior from raw Flemish/Belgian text to Phase 6 canonical facts in Phase 6B.
- `[done]` Add organization add-to-collection controls after Phase 4 adds organization collection membership.

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
- Organization filters cover sector, location, and existing Flemish/Belgian text facts; canonical organization fact search/filter behavior moves in Phase 6B.

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

- `[done]` Extend `collection_members` to support `organization_id` with correct uniqueness and constraints.
- `[done]` Update Supabase types after schema migration.
- `[done]` Keep deployed `suggest-people` behind a collection suggestion service contract that returns people and organizations.
- `[done]` Add draft state for suggested candidates, approval/rejection, and reasons.
- `[done]` Update collection creation and detail UI to use draft approval/rejection before saving suggestions.
- `[done]` Cache collection detail suggestion drafts client-side and make suggestion clicks open a profile preview modal.
- `[done]` Update collection detail UI to render people and organization members.
- `[done]` Add explicit "send gap to Discovery" action without auto-running discovery.
- `[done]` Update add-to-collection controls for organizations on search result cards and organization profiles.

Out of scope:

- Autonomous discovery.
- Gap analytics beyond a simple handoff.
- Canonical organization Flemish/Belgian facts.
- Persistent draft tables.

Exit criteria:

- A collection can contain people and organizations.
- Suggested candidates are not saved until accepted.
- Rejected candidates do not reappear in the same draft without a clear reset.
- Collection generation never writes to discovery or approved entity tables.

Verification:

```sh
npm run typecheck
npm test
npm run test:deno
npm run build
graphify update .
```

Focused tests to add:

- `collection_members` accepts either `person_id` or `organization_id`, not neither.
- Duplicate people and duplicate organizations are prevented per collection.
- Collection suggestion response can include organization candidates.
- Approve/reject state persists correctly.
- Discovery handoff pre-fills `/admin/discovery?prompt=...` without starting a run.

Manual checks:

- Build a collection for `senior biotech leaders in Boston and New York with Belgian ties`.
- Accept one person and one organization.
- Reject a candidate and confirm it is not saved.
- Add an organization to a collection from search results and from an organization profile.

## Phase 5 - Discovery

Goal: make `agent-discovery` the only durable discovery workflow for new people and organizations.

Scope:

- Prompted discovery calls `agent-scheduler` with `agent_type = "discovery"`.
- Discovery intake defaults to the prompted Discovery form, with adjacent manual add and CSV/XLSX import options for people and organizations.
- `agent-discovery` persists pending people to `discovered_contacts`.
- `agent-discovery` persists pending organizations to `discovered_organizations`.
- Discovery review UI handles pending people and pending organizations.
- Approval remains evidence-first and reviewer-controlled.
- Legacy compatibility functions are removed after replacement flows are live.

Todos:

- `[done]` Add Phase 5A organization staging schema, evidence table, dedupe indexes, editor-only RLS, types, tests, and schema/AI docs.
- `[done]` Find and remove active UI calls to `discover-contacts`, `search-contacts`, `parse_contacts`, and `flemish_search`.
- `[done]` Replace prompted discovery calls with `agent-scheduler` -> `agent-discovery`; `/admin/discovery?prompt=...` remains prefill-only until staff clicks Run.
- `[done]` Move the prompted Discovery runner into the Discovery intake card and leave Discovery history as a compact run log.
- `[done]` Extend `agent-discovery` extraction and persistence for pending organizations.
- `[done]` Add organization dedupe against approved organizations and pending discovered organizations.
- `[done]` Extend manual discovery intake so staff can add pending people and pending organizations through forms.
- `[done]` Extend import so staff can upload people and organizations through CSV/XLSX, with clear validation and no direct writes to approved `people` or `organizations`.
- `[done]` Add pending organization review UI alongside pending people, including approve, reject, merge, source URL, and evidence excerpt handling.
- `[done]` Store organization source URLs, evidence excerpts, sectors, locations, and Flemish/Belgian relevance without asking staff to enter confidence scores.
- `[done]` Add fresh Phase 5 people and organization import fixture files for valid pending-candidate imports.
- `[done]` Update Discovery dashboard pending summaries and run result summaries for people plus organizations.
- `[done]` Add source guards that keep active UI free of legacy Discovery callers.
- `[done]` Update smoke scheduler checks to use the supported `metrics` action and remove the retired `agent-connections` smoke target.
- `[done]` Expand Phase 5 import fixtures to cover approved-record conflicts, pending-record conflicts, duplicate rows, malformed URLs/emails, multi-value locations, and weak or missing evidence.
- `[done]` Remove legacy Discovery compatibility functions and retired `ai-agent` Discovery tasks after no live references remain.
- `[done]` Update docs, edge contracts, config, and smoke checks to remove Discovery compatibility language.

Out of scope:

- Auto-approval into `people` or `organizations`.
- Person-to-person connection inference.

Exit criteria:

- Prompted Discovery creates an `agent_runs` discovery run through scheduler.
- Manual Discovery can create pending people and pending organizations from a form.
- Manual Discovery can import pending people and pending organizations from CSV/XLSX files.
- New organization candidates land in `discovered_organizations` with evidence.
- Reviewers can approve, reject, or merge pending organizations; approval writes approved organization records, sectors, US locations, Flemish/Belgian relevance, review metadata, and embedding queue work.
- Legacy Discovery compatibility functions and retired `ai-agent` Discovery tasks are removed from live edge contracts.

Verification:

```sh
npm run typecheck
npm test
npm run test:deno
npm run build
rg "discover-contacts|search-contacts|parse_contacts|flemish_search" src scripts supabase/functions --glob '!supabase/functions/_shared/__tests__/**'
```

Focused tests to add:

- Scheduler creates discovery runs and rejects unsupported agent types.
- Discovery org persistence writes all required evidence fields.
- Organization dedupe handles approved and pending records.
- Manual people intake still writes pending candidates and does not regress during the Discovery refactor.
- Manual organization intake writes pending candidates with validation, evidence, source URLs, sectors, locations, and Flemish/Belgian relevance.
- People and organization CSV/XLSX imports validate edge-case fixture files and report row-level errors without partially approving records.
- Review approval never promotes an organization without reviewer action.

Manual checks:

- Run prompted discovery for `Flemish-connected organizations in Houston energy`.
- Add one pending person and one pending organization manually from `/admin/discovery`.
- Import people and organizations from the new edge-case CSV/XLSX fixtures.
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

- `[done]` Phase 6A schema contract defines canonical catalog fields: stable name, normalized key, entity type, parent/group support, filterability, and timestamps.
- `[done]` Phase 6A schema contract adds dynamic `flemish_connection_aliases` for seed, staff, model, and migration aliases with review/status metadata and evidence.
- `[done]` Phase 6A schema contract expands `person_flemish_connections` with role, confidence, source URL, evidence excerpt, and timestamps.
- `[done]` Phase 6A schema contract adds `organization_flemish_connections` with role, confidence, source URL, evidence excerpt, and timestamps.
- `[done]` Phase 6A schema contract includes lookup helpers, RLS, triggers, broad filterable seeds, alias seeds, and idempotent backfill/migration requirements.
- `[done]` Phase 6A migration was pushed to linked Supabase project `ofzuhajxwxggybkuzefq`, generated types were regenerated, and the remote schema/data contract was verified.
- `[done]` Phase 6B moves shared TypeScript canonicalization, search documents, Dashboard filter chips, collection suggestions, match criteria, and embedding text onto canonical facts plus approved aliases and relationship evidence.
- `[done]` Phase 6B migration was pushed to linked Supabase project `ofzuhajxwxggybkuzefq`; `search-people`, `suggest-people`, and `generate-embeddings` were deployed and verified active.
- `[done]` Phase 6C moves person profiles, organization profiles, Discovery approval/merge, and collection profile previews onto evidence-backed `person_flemish_connections` / `organization_flemish_connections` instead of approved-record raw relevance writes.
- `[done]` Profile edits can create canonical non-filterable facts and staff-approved aliases without promoting every raw phrase into a default filter chip.
- `[done]` Phase 6D updates derived label suggestion approval to canonicalize through approved names/aliases before inserting evidence-backed person fact rows.
- `[done]` Phase 6D updates Discovery extraction to emit canonical fact candidates, candidate aliases, role, source URL, evidence excerpt, confidence, and raw evidence without auto-promoting model aliases to filter chips.
- `[done]` Phase 6D removes the deprecated approved-organization raw relevance column from active schema, generated types, edge functions, frontend source, and source-of-truth docs.
- `[done]` Phase 6D keeps durable organization verification suggestions deferred to Phase 7 while allowing normalized organization facts from approved Discovery/manual/import/profile workflows.
- `[done]` Search filters and chips query `is_filterable = true`; non-filterable facts stay searchable through evidence/snippets but are not default chips.
- `[done]` Search documents and embeddings are refreshed from approved canonical fact changes and alias changes.

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
- `[done]` Better the layout of the /admin/verification. Stale Records is now full-width on top and Profile Suggestions full-width below.
- `[done]` Define one verification request/response contract with `mode: "preview" | "durable"` and `record_type: "person" | "organization"` on `agent-verify`. `update-profile` is a thin preview-mode wrapper for `ProfileUpdateModal`.
- `[done]` Share evidence gathering, field comparison, risk routing, and suggestion formatting (already shared in `_shared/verification.ts`; `insertVerificationSuggestions` now takes a `{ recordType, recordId }` target).
- `[done]` Add organization verification inputs and outputs (`runVerificationForOrganization` performs web-search + Gemini `check_organization` for fields name/description/website_url/type; durable org branch in `agent-verify` writes to `profile_suggestions` with `record_type='organization'`).
- `[done]` Add record-level suggestion schema or compatibility view (`profile_suggestions` extended with `record_type`, nullable `person_id`/`organization_id`, CHECK constraint; rename to `record_suggestions` deferred).
- `[done]` Update `/admin/verification` to show people and organization queues (`OrganizationSuggestedChanges` panel renders pending `record_type='organization'` suggestions).
- `[done]` Update inline profile verification to call preview mode only (`update-profile` already preview-only; `agent-verify mode=preview` is the unified path going forward).
- `[done]` Ensure durable mode writes suggestions with source URL, evidence excerpt, confidence, method, and run ID (existing person path already does this).
- `[next]` Add focused Deno tests: preview no-write, durable writes, dedupe, high-risk pending.
- `[later]` Retire separate `update-profile` endpoint after callers move to the unified contract.

See `docs/PHASE-7-VERIFICATION.md` for the granular per-task checklist.

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
- `[done]` Delete legacy Discovery compatibility functions after Phase 5.
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
