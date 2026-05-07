# Phase 6 Flemish / Belgian Fact Normalization Implementation Plan

## Summary

- Make Flemish/Belgian facts canonical, evidence-backed, and filterable for people and organizations.
- Replace raw organization `flemish_link` usage instead of keeping it as a long-term compatibility field. This is still development, so remove the deprecated field once migration paths are updated.
- Use a dynamic alias table so aliases can be seeded, reviewer-approved, or model-discovered without schema changes.
- Add role, confidence, source URL, and evidence excerpt to both person and organization Flemish/Belgian fact relationships.
- Keep broad canonical entities as default filter chips. Store overly specific phrases as aliases, relationship evidence, or non-filterable catalog entries.
- Do not introduce person-to-person relationships. Shared Flemish/Belgian facts are profile/organization facts only.
- Defer durable organization verification suggestions to Phase 7's record-level verification queue. Phase 6 should support normalized organization facts from approved Discovery/manual/import/profile workflows.

## Chosen Decisions

- Aliases live in a separate `flemish_connection_aliases` table, not only JSONB. It should support dynamic aliases from staff review and model-discovered aliases.
- Person and organization fact junctions both carry `role`, `confidence`, `source_url`, and `evidence_excerpt`.
- `organizations.flemish_link` is deprecated in Phase 6 and should be removed after all active read/write paths move to canonical organization facts.
- Organization verification remains bounded: Phase 6 may shape normalized organization fact suggestions, but durable organization verification belongs to Phase 7.

## Subphase Execution

Use this spawn pattern for each subphase:

> Implement Phase 6X only from `docs/TEMP-PHASE6-FLEMISH-FACT-NORMALIZATION-PLAN.md`. Use scoped subagents as listed. Do not edit outside owned files unless required by the contracts. Apply Supabase migrations with `supabase db push --linked`, deploy changed edge functions to project `ofzuhajxwxggybkuzefq`, update active docs affected by the subphase, run listed checks, and hand off the next subphase status.

Each subphase should use subagents for parallel work. Keep write ownership disjoint.

## 6A: Schema, Canonical Catalog, Aliases, And Data Migration

Goal: create the canonical data model and migrate existing facts without losing evidence.

Suggested subagents:

- Schema worker owns migrations, RLS, triggers, remote push, and type regeneration.
- Data-contract test worker owns migration/source tests and remote schema checks.
- Docs worker owns `docs/SCHEMA.md` and any AI/schema contract notes touched in this subphase.

Scope:

- Add/expand `flemish_connections` fields:
  - stable canonical `name`
  - normalized name if not already sufficient
  - `entity_type` or an expanded replacement for current `type`
  - parent/group support
  - `is_filterable`
  - timestamps
- Add `flemish_connection_aliases`:
  - `id`
  - `flemish_connection_id`
  - `alias`
  - `normalized_alias`
  - `source` such as `seed`, `staff`, `model`, `migration`
  - optional `confidence`
  - optional `source_url`
  - optional `evidence_excerpt`
  - review/status fields if needed to keep model-discovered aliases from becoming canonical without review
  - uniqueness on normalized alias where appropriate
- Expand `person_flemish_connections` with:
  - `role`
  - `confidence`
  - `source_url`
  - `evidence_excerpt`
  - timestamps
- Add `organization_flemish_connections` with the same evidence shape:
  - `organization_id`
  - `flemish_connection_id`
  - `role`
  - `confidence`
  - `source_url`
  - `evidence_excerpt`
  - timestamps
- Add SQL helpers for canonical lookup by name or alias.
- Seed broad filterable entities: KU Leuven, UGent, imec, BAEF, Flemish Government, FIT, VUB, Vlerick, VITO, Flanders Make, VIB.
- Seed useful aliases, including `University of Ghent -> UGent` and FIT expansions.
- Migrate existing person facts to canonical catalog rows and preserve links idempotently.
- Backfill organization fact rows from existing `organizations.flemish_link` where aliases or exact canonical names match.
- Preserve any unmatched raw organization relevance as relationship evidence, non-filterable catalog entries, or a temporary migration audit table until reviewed. Do not keep `organizations.flemish_link` as the product field.
- Update RLS for catalog, alias, person junction, and organization junction tables using staff-role policies consistent with current schema.
- Add triggers so person/org fact and alias changes refresh search documents and queue embeddings.
- Regenerate Supabase types.
- Run `supabase db push --linked` and verify remote schema on project `ofzuhajxwxggybkuzefq`.

Exit criteria:

- Remote schema has dynamic aliases and evidence-backed person/org fact junctions.
- `University of Ghent` canonicalizes to `UGent`.
- Organization facts no longer depend on `organizations.flemish_link`.
- Existing person and organization facts are migrated idempotently.

Checks:

```sh
npm run typecheck
npm test
```

## 6B: Shared Canonicalization, Search Documents, Filters, And Embeddings

Goal: make approved search and collection suggestion behavior use canonical facts.

Suggested subagents:

- Backend search worker owns search migrations/RPCs, `search-people`, and `suggest-people`.
- Frontend filter worker owns Dashboard filter loading, filter parsing, and chip options.
- Embedding worker owns `generate-embeddings` and embedding/search refresh tests.

Scope:

- Update shared TypeScript canonicalization in `src/lib/flemishConnections.ts` to understand aliases, filterability, parent/group metadata, and relationship evidence.
- Keep SQL and TypeScript canonicalization aligned. Add tests that lock representative aliases.
- Update `people_search_documents` to use canonical person facts plus evidence text.
- Update `organization_search_documents` to use `organization_flemish_connections` plus alias/canonical names, not `organizations.flemish_link`.
- Update organization lexical scoring/rationale so canonical facts rank strongly.
- Update `search-people` request/response handling so `filters.flemish_connections` maps to canonical filterable facts for people and organizations.
- Update `suggest-people` retrieval and snippets to use canonical organization facts.
- Update `generate-embeddings` person and organization document text to include canonical facts, role, and useful evidence excerpts.
- Update Dashboard filter option loading to query only `is_filterable = true`.
- Update `src/lib/filterParser.ts` and tests to use the seeded broad filter set.
- Remove active reads of `organizations.flemish_link` in search, suggestion, filter, match, and embedding paths.

Exit criteria:

- Search filters show broad canonical chips only.
- Filtering by KU Leuven, UGent, imec, and BAEF works for people and organizations.
- Non-filterable/raw facts can affect evidence/snippets where appropriate but do not appear as default filter chips.
- Organization search and collection suggestions no longer use `organizations.flemish_link`.

Checks:

```sh
npm run typecheck
npm test
npm run test:deno
npm run build
```

## 6C: Profiles, Editing, Discovery Approval, Manual Intake, And Imports

Goal: move all approved-record write/display paths to canonical evidence-backed facts.

Suggested subagents:

- Profile UI worker owns person and organization profile loading, chips, evidence display, and edit behavior.
- Discovery review worker owns pending approval/merge/reject write paths.
- Intake/import worker owns manual Discovery intake, CSV/XLSX mapping, fixtures, and validation tests.

Scope:

- Update `PersonProfile.tsx` to load person fact relationship evidence and render chips/details without assuming a simple junction.
- Update person edit/save flows to write canonical facts with role/evidence fields when available.
- Update `OrganizationProfile.tsx` to load `organization_flemish_connections` and render canonical chips plus evidence, role, URL, and confidence.
- Remove organization profile editing of raw `flemish_link`.
- Update Discovery organization approval and merge in `DiscoveredContactsPanel.tsx` to write `organization_flemish_connections` rows.
- Update pending people approval/merge paths to write evidence-backed `person_flemish_connections` rows.
- Update manual people/organization intake and CSV/XLSX imports to capture raw relevance/evidence and resolve canonical facts where possible.
- Allow model- or import-discovered aliases to be stored dynamically in `flemish_connection_aliases` with a safe source/status contract.
- Preserve reviewer control: pending Discovery rows still do not become approved people or organizations until explicit approval.
- Remove remaining active writes to `organizations.flemish_link`.

Exit criteria:

- Person and organization profiles show canonical facts with evidence.
- Discovery approval creates evidence-backed person and organization fact relationships.
- Manual intake/imports can preserve new aliases and evidence without creating default filter chips for every raw phrase.
- Approved organization writes no longer touch `organizations.flemish_link`.

Checks:

```sh
npm run typecheck
npm test
npm run build
```

## 6D: Derived Labels, Discovery Extraction, Verification Boundary, Cleanup, And Docs

Goal: finish AI/review contracts, remove deprecated raw fields, and update source-of-truth docs.

Suggested subagents:

- AI pipeline worker owns `agent-discovery`, shared derived-label helpers, and bounded verification prompt/schema changes.
- Cleanup worker owns removal of `organizations.flemish_link` from schema/types/source after active paths are migrated.
- Docs worker owns active docs and masterplan status.
- Verification worker runs broad checks and reports failures.

Scope:

- Update derived-label approval so `flemish_entity` canonicalizes through alias-aware logic before inserting person facts.
- Update derived-label write paths to include role/evidence when known.
- Keep organization durable verification suggestions deferred to Phase 7, but ensure Phase 6 does not block normalized organization facts from Discovery approval/manual/import/profile workflows.
- Update `agent-discovery` extraction to emit canonical entity candidates, candidate aliases, role, source URL, evidence excerpt, confidence, and raw evidence.
- Add safe dynamic alias handling for model-discovered aliases. Model-discovered aliases should not silently create broad filter chips.
- Remove `organizations.flemish_link` column and all remaining active code/type references once migration and write paths no longer need it.
- Refresh search documents and embeddings after approved fact changes.
- Deploy changed edge functions:
  - `agent-discovery` if changed
  - `search-people` if not already deployed in 6B
  - `suggest-people` if not already deployed in 6B
  - `generate-embeddings` if changed
- Update active source-of-truth docs:
  - `docs/SCHEMA.md`
  - `docs/ROUTES.md` only if route/API state changes
  - `docs/AI-PIPELINE.md`
  - `docs/PRODUCT-SERVICES.md`
  - `docs/WEBAPP-MASTERPLAN.md`
  - `docs/EVALUATION.md` if quality gates or acceptance criteria change
  - `.env.example` only if new secrets/env vars are introduced

Exit criteria:

- Derived-label approval writes canonical, idempotent, evidence-backed relationships.
- Discovery produces canonical facts plus raw evidence and aliases.
- `organizations.flemish_link` is gone from active schema, generated types, edge functions, frontend code, and docs except historical/archive references.
- Phase 6 is marked complete in `docs/WEBAPP-MASTERPLAN.md`.

Checks:

```sh
npm run typecheck
npm run lint
npm test
npm run test:deno
npm run build
rg "flemish_link" src supabase docs --glob '!docs/archive/**' --glob '!docs/TEMP-PHASE6-FLEMISH-FACT-NORMALIZATION-PLAN.md'
```

## Suggested First Prompt

Use this to start 6A:

```text
Implement Phase 6A from docs/TEMP-PHASE6-FLEMISH-FACT-NORMALIZATION-PLAN.md. Focus only on schema, canonical catalog, dynamic aliases, evidence-backed person/org Flemish fact junctions, migration/backfill, RLS, triggers, generated types, docs touched by schema, and tests. Use subagents for migration/RLS, tests, and docs with disjoint write ownership. Apply the migration to the linked Supabase project with supabase db push --linked and verify the remote schema. Do not start 6B work except where needed for migration tests.
```

## Global Test Plan

- Per subphase, run focused tests before broad checks.
- Before final Phase 6 handoff, run:

```sh
npm run typecheck
npm run lint
npm test
npm run test:deno
npm run build
```

- For every Supabase migration, run `supabase db push --linked` in the same session and verify the remote schema/data contract.
- For every changed edge function, deploy with `supabase functions deploy <function-name> --project-ref ofzuhajxwxggybkuzefq` and verify the function is active.

## Known Risks

- Canonicalization drift between SQL, edge functions, and frontend helpers.
- Duplicate alias migration if existing catalog rows already contain alias-like names.
- Search/embedding refresh gaps when relationship evidence changes but the base person/organization row does not.
- RLS gaps on the new alias and organization junction tables.
- Removing `organizations.flemish_link` too early before search, profile, Discovery approval, import, and embedding paths have moved.
- Phase boundary creep into Phase 7 verification. Keep durable organization verification suggestions out of Phase 6 unless the masterplan is explicitly changed.

