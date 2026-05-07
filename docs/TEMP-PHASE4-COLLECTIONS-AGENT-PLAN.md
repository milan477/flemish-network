# Temporary Phase 4 Collections Agent Plan

Status: temporary coordination document.

Purpose: split the Phase 4 Collections Draft Workflow into independent work packets that later agents can execute with minimal overlap. This is not a durable source-of-truth doc; update the active docs listed in `AGENTS.md` as each packet lands.

## Phase 4 Intent

Implement mixed people/organization collection suggestions using existing approved records only. Keep the deployed edge function name `suggest-people` for compatibility, but expose it in the frontend and docs as a collection suggestion service.

Suggestions must be draft-only until staff approve them. Rejected draft candidates stay suppressed until the draft is reset. If the prompt implies missing database coverage, offer a Discovery handoff prompt that navigates to `/admin/discovery?prompt=<encoded prompt>` without starting Discovery automatically.

## Coordination Rules

- Treat the current worktree as the baseline; do not revert unrelated dirty changes.
- Keep UI vocabulary aligned with `docs/PRODUCT-SERVICES.md`; do not expose `suggest-people` or `agent-*` as staff-facing product labels.
- Route Discovery lifecycle changes through `agent-scheduler`; Phase 4 must only prefill Discovery and must not start a run automatically.
- Update active source-of-truth docs in the same session as each implementation packet.
- After modifying code files, run `graphify update .`.

## Packet A: Collection Member Schema And Types

Owner scope:

- `supabase/migrations/**`
- `src/lib/supabase.ts`
- `supabase/functions/_shared/database.types.ts`
- Schema-focused tests
- `docs/SCHEMA.md`

Tasks:

1. Add migration `supabase/migrations/20260507003000_phase4_collection_organizations.sql`.
2. Add nullable `organization_id` to `collection_members`.
3. Make `person_id` nullable.
4. Add an exactly-one check requiring either `person_id` or `organization_id`, but not both.
5. Replace person-only uniqueness with partial unique indexes for `(collection_id, person_id)` and `(collection_id, organization_id)`.
6. Add an organization lookup index.
7. Adjust insert/update RLS checks if needed so mixed members remain valid.
8. Update local TypeScript database/member types:
   - `CollectionMember.person_id: string | null`
   - `CollectionMember.organization_id: string | null`
   - optional `person?`
   - optional `organization?`
9. Add or update migration tests covering organization members, exactly-one enforcement, and duplicate prevention.
10. Update `docs/SCHEMA.md`.

Starting snippet from the previous context, to verify or recreate if absent:

```sql
ALTER TABLE collection_members
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE collection_members
  ALTER COLUMN person_id DROP NOT NULL;

ALTER TABLE collection_members
  ADD CONSTRAINT collection_members_exactly_one_entity
  CHECK (
    (person_id IS NOT NULL AND organization_id IS NULL)
    OR (person_id IS NULL AND organization_id IS NOT NULL)
  );
```

Done criteria:

- Existing person collection members still work.
- Organization collection members can be inserted and queried.
- Duplicate people and duplicate organizations are independently prevented per collection.

Recommended verification:

- `npm run typecheck`
- Schema/migration test command used by the repo
- `graphify update .`

## Packet B: Collection Suggestion Edge Contract

Owner scope:

- `supabase/functions/suggest-people/**`
- `supabase/functions/_shared/**` only where needed for shared model/database helpers
- Edge-function tests
- `docs/AI-PIPELINE.md`
- Relevant endpoint section in `docs/ROUTES.md`

Tasks:

1. Keep the edge function deployed as `suggest-people`.
2. Extend request input to:

```ts
{
  query: string;
  collection_id?: string;
  exclude_ids?: string[];
  exclude_organization_ids?: string[];
  max_results?: number;
}
```

3. Return:

```ts
{
  message: string;
  searches: unknown[];
  candidates: Array<{
    entity_type: "person" | "organization";
    id: string;
    name: string;
    reason: string;
    score: number;
    snippet?: string;
    source_search: string;
  }>;
  gap: {
    should_offer: boolean;
    reason?: string;
    suggested_prompt?: string;
  };
}
```

4. Parse the collection goal with Gemini route `query_parsing`, defaulting to `gemini-2.5-flash-lite`.
5. Parser should produce at most 4 focused searches, entity targets, and an optional Discovery handoff prompt.
6. Fallback parser returns one search equal to the original prompt, enables people and organizations, and sets no gap.
7. Retrieve people with `gemini-embedding-001` via existing embedding helpers plus `match_people` / `match_person_text_chunks`; include lexical people fallback for degraded coverage.
8. Retrieve organizations with Phase 3 `search_organizations_lexical`; do not add organization embeddings in Phase 4.
9. Exclude existing collection members and rejected draft IDs passed by the client.
10. Rerank with Gemini route `offline_evaluation`, defaulting to `gemini-2.5-pro`.
11. Validate reranked IDs against retrieved candidates.
12. Backfill by deterministic score order if reranking fails or under-returns.
13. Add contract tests for mixed candidates and Discovery handoff shape.
14. Update `docs/AI-PIPELINE.md` and `docs/ROUTES.md`.

Done criteria:

- Legacy callers are not broken unexpectedly.
- New callers can request and receive mixed people/organization candidates.
- The response never returns unknown IDs from reranking.
- Gap handoff is descriptive but does not start Discovery.

Recommended verification:

- `npm run test:deno`
- `npm run typecheck`
- `graphify update .`

## Packet C: Draft Candidate State Helper

Owner scope:

- New or existing frontend helper/module for collection suggestion draft state
- Focused unit tests

Tasks:

1. Add a reusable draft reducer/helper for collection suggestion candidates.
2. Support draft states:
   - pending
   - accepted
   - rejected
3. Support actions:
   - load candidates
   - approve
   - reject
   - undo
   - reset
4. Keep rejected candidates suppressed in the same draft until reset.
5. Track people and organization IDs separately for exclusion payloads:
   - `exclude_ids`
   - `exclude_organization_ids`
6. Add reducer tests for approve, reject, undo, reset, duplicate suppression, and mixed entity handling.

Done criteria:

- State logic is independent of a specific collection screen.
- Both collection creation and collection detail can use the same helper.
- Accepted candidates are clearly derivable for save operations.

Recommended verification:

- `npm test`
- `npm run typecheck`
- `graphify update .`

## Packet D: Collection Creation UI

Owner scope:

- Collection creation components/routes
- Collection suggestion client wrapper if colocated with creation UI
- Relevant UI tests
- `docs/PRODUCT-SERVICES.md` if vocabulary changes

Tasks:

1. Replace immediate-save suggestion behavior with draft approval/rejection.
2. Render mixed candidate cards with name, entity type, reason, score/snippet if available, and source search if useful for staff.
3. Add `Approve`, `Reject`, and `Undo` controls.
4. Save only accepted candidates when creating or updating the collection.
5. Save people with `person_id`; save organizations with `organization_id`.
6. Include rejected draft IDs in subsequent suggestion requests.
7. Add a reset draft control or equivalent flow.
8. Show optional Discovery handoff when `gap.should_offer` is true.
9. Handoff navigates to `/admin/discovery?prompt=<encoded prompt>`.

Done criteria:

- Suggested candidates do not persist until accepted.
- Rejected suggestions stay hidden until reset.
- Mixed accepted candidates are saved correctly.

Recommended verification:

- `npm test`
- `npm run typecheck`
- `graphify update .`

## Packet E: Collection Detail Mixed Members UI

Owner scope:

- Collection detail components/routes
- Member query/update/delete logic
- Notes handling
- Relevant UI tests
- `docs/PRODUCT-SERVICES.md` and `docs/ROUTES.md` if behavior or URL state changes

Tasks:

1. Query collection members with both `person` and `organization` relationships.
2. Render mixed member rows/cards in `CollectionDetail`.
3. Preserve notes behavior for both entity types.
4. Ensure remove/update member actions work for either entity type.
5. Add collection detail suggestion panel support for the shared draft workflow.
6. Save accepted draft people and organizations into `collection_members`.
7. Prevent duplicate members from being suggested or inserted.

Done criteria:

- Existing person-only collections still render.
- Organization members render with useful labels and links.
- Notes remain editable for both people and organizations.

Recommended verification:

- `npm test`
- `npm run typecheck`
- `npm run build`
- `graphify update .`

## Packet F: Add-To-Collection For Organizations

Owner scope:

- `AddToCollectionDropdown` or equivalent shared add control
- Organization search cards
- Organization profile page/components
- Relevant UI tests
- `docs/PRODUCT-SERVICES.md` if user-facing wording changes

Tasks:

1. Generalize `AddToCollectionDropdown` so it can add either a person or an organization.
2. Keep the existing person add flow working.
3. Add organization add controls to organization search result cards.
4. Add organization add controls to organization profiles.
5. Insert organization collection members with `organization_id`.
6. Prevent invalid mixed inserts with both IDs or neither ID.

Done criteria:

- Staff can add an organization to a collection from search and profile surfaces.
- Staff can still add people from existing surfaces.
- The control uses product-facing collection language, not implementation names.

Recommended verification:

- `npm test`
- `npm run typecheck`
- `npm run build`
- `graphify update .`

## Packet G: Discovery Prefill Route

Owner scope:

- Admin Discovery route/page
- Routing tests
- `docs/ROUTES.md`
- `docs/AI-PIPELINE.md` if scheduler/handoff behavior is documented there

Tasks:

1. Read `prompt` from `/admin/discovery?prompt=...`.
2. Prefill the Discovery query box with the decoded prompt.
3. Do not call `agent-scheduler` until the user explicitly starts Discovery.
4. Add a routing/admin test for prompt prefill.

Done criteria:

- Navigating to `/admin/discovery?prompt=abc` fills the input with `abc`.
- No Discovery run is created on navigation alone.

Recommended verification:

- `npm test`
- `npm run typecheck`
- `graphify update .`

## Packet H: Final Documentation And Full Verification

Owner scope:

- `docs/SCHEMA.md`
- `docs/AI-PIPELINE.md`
- `docs/PRODUCT-SERVICES.md`
- `docs/ROUTES.md`
- `docs/WEBAPP-MASTERPLAN.md`
- `docs/EVALUATION.md`
- `.env.example` only if a new env var or secret was actually added

Tasks:

1. Reconcile all source-of-truth docs after implementation packets land.
2. Confirm docs consistently describe the service as collection suggestions, even though the deployed edge function remains `suggest-people`.
3. Document that Phase 4 does not add:
   - autonomous Discovery
   - organization embeddings
   - canonical organization Flemish facts
   - persistent gap analytics
   - persistent draft tables
4. Update `docs/WEBAPP-MASTERPLAN.md` Phase 4 cleanup status.
5. Update `docs/EVALUATION.md` with final quality gates and acceptance criteria.
6. Leave `.env.example` unchanged unless implementation introduced a new environment variable.
7. Run full verification.

Recommended verification:

- `npm run typecheck`
- `npm test`
- `npm run test:deno`
- `npm run build`
- `graphify update .`

## Suggested Agent Order

1. Packet A first, because schema/types unblock mixed member writes.
2. Packets B and C can run in parallel after A starts if they avoid overlapping shared files.
3. Packets D, E, and F can run in parallel after A and C are available, but coordinate shared collection components.
4. Packet G can run independently unless Discovery route files overlap with other admin work.
5. Packet H should run last after implementation and tests have settled.

## Cross-Packet Risks

- `collection_members` queries may need explicit relationship aliases if Supabase cannot infer both optional member relationships cleanly.
- Shared collection components can become merge-conflict hot spots; assign file ownership before parallel edits.
- The edge function is named `suggest-people` for deployment compatibility, but frontend copy should say collection suggestions.
- Reranking must never trust model-returned IDs without validation against retrieved candidates.
- Discovery handoff is a navigation/prefill only; scheduler calls remain user-initiated.
