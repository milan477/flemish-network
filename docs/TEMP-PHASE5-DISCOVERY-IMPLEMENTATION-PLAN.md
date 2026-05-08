# Phase 5 Discovery Implementation Plan

## Summary

- Make Discovery evidence-first for both people and organizations: prompted runs, manual intake, imports, and review all create pending candidates first.
- Keep `agent-scheduler -> agent-discovery` as the only durable prompted workflow. No UI writes `agent_runs` or calls `discover-contacts`, `search-contacts`, `parse_contacts`, or `flemish_search`.
- Implement in ordered subphases. Each subphase gets one coordinator worker plus scoped subagents with disjoint write ownership.
- Use a separate `discovered_organization_evidence` table. Final Phase 5 removes legacy discovery compatibility functions/tasks and updates Phase 9 so that cleanup is no longer duplicated there.

## Subphase Execution

Use this spawn pattern for each subphase: "Implement Phase 5X only from the Phase 5 plan. Use scoped subagents as listed, do not edit outside owned files unless required, deploy/apply Supabase changes when required, update active docs, run listed checks, and hand off the next subphase status."

### 5A: Schema And Contracts

- DB worker owns migrations/types. Test/docs worker owns schema tests and doc updates.
- Add organization staging fields: `candidate_key`, `source`, `first_seen_at`, `last_seen_at`, `last_evidence_at`, `evidence_count`, dedupe indexes, and update triggers.
- Add `discovered_organization_evidence` with `discovered_organization_id`, optional `discovery_page_id`, unique `evidence_key`, page/source fields, excerpts, raw relevance/location/sector text, normalized location fields, confidence, and timestamps.
- Replace broad public policies on `discovered_organizations`; use editor-staff read/write policies for it and the new evidence table.
- Regenerate/update Supabase types, update `docs/SCHEMA.md`, `docs/AI-PIPELINE.md`, and migration tests.
- Apply with `supabase db push --linked` and verify remote schema on project `ofzuhajxwxggybkuzefq`.

### 5B: Agent Discovery Organizations

- Edge worker owns `agent-discovery`; Deno-test worker owns shared extraction/dedupe tests.
- Extend extraction to return `contacts` and `organizations`; keep people behavior compatible.
- Persist pending organizations with source URLs, evidence excerpts, confidence, sectors, US locations, Flemish/Belgian relevance, `agent_run_id`, and candidate key.
- Dedupe organizations against approved `organizations` and pending `discovered_organizations` by normalized website, candidate key, and strong name match.
- Merge repeat pending org evidence instead of creating duplicates. Never auto-promote.
- Update run metrics/results for organization inserted/merged/duplicate counts.
- Deploy `agent-discovery` and run `npm run test:deno`.

Status: done.

### 5C: Pending Manual Intake And Imports

- Import-core worker owns parser/mapping modules and fixtures. Frontend worker owns Discovery intake UI. Test worker owns CSV/XLSX tests.
- Refactor manual people intake to insert `discovered_contacts`, not `people`.
- Add manual organization intake that inserts `discovered_organizations`.
- Refactor CSV/XLSX import into people/organization modes with row-level validation, duplicate-in-file detection, approved-record conflicts, pending-record conflicts, malformed URL/email checks, multi-value sectors/locations, and weak/missing evidence handling.
- Imports create pending rows only; no update/create action writes approved `people` or `organizations`.
- Add fresh fixtures in a new Phase 5 fixture path; do not restore deleted `test-csvs` unless intentionally replacing them.

Status: done.

### 5D: Pending Review Queues

- Review worker owns review helpers/actions. UI worker owns pending people/org panels.
- Split Discovery review into pending people and pending organizations, with counts and tabs/sections.
- Preserve people approve/reject/merge behavior, adjusted for pending-only manual/import sources.
- Add organization approve/reject/merge: approval writes `organizations`, `organization_sectors`, normalized `organization_us_locations`, Flemish/Belgian relevance, review metadata, and queues organization embeddings after reviewer action.
- Show organization source URLs and evidence excerpts in review cards.
- Add tests proving organizations are not promoted before explicit reviewer approval.

Status: done.

### 5E: Dashboard, Smoke, And Quality Gates

- Ops/UI worker owns Discovery dashboard counts/history; smoke worker owns `scripts/smoke_edge_functions.ts`.
- Update `AgentDashboard` pending summary and run result summaries for people plus organizations.
- Keep `/admin/discovery?prompt=...` prefill-only until staff clicks Run.
- Add source guards that active UI has no legacy discovery callers.
- Update smoke checks to remove `agent-connections`, `discover-contacts`, and `search-contacts` once 5F is ready; scheduler smoke should use a valid action such as `metrics` or a deliberate structured validation check.

Status: done.

### 5F: Legacy Retirement And Docs Reconciliation

- Cleanup worker owns legacy functions/config/contracts. Docs worker owns active docs/masterplan.
- Remove `discover-contacts`, `search-contacts`, and frozen `ai-agent` tasks `parse_contacts` / `flemish_search` after `rg` confirms no live callers.
- Update `supabase/config.toml`, edge contracts/tests, smoke harness, and docs.
- Mark Phase 5 Discovery todos done. Mark Phase 9's "Delete legacy discovery compatibility functions after Phase 5" done or remove it as completed. Leave unrelated connection DB cleanup and planner table cleanup for later phases.

Status: done.

## Interfaces And Behavior

- Scheduler request stays: `{ action: "trigger", agent_type: "discovery", params: { query? } }`.
- `agent-discovery` request stays: `{ run_id, query?, batch_size? }`; response gains organization result metrics.
- Discovery intake/import writes only pending candidates.
- Organization review approval is the only path from `discovered_organizations` to approved `organizations`.
- Phase 6 canonical organization Flemish facts stay out of scope; Phase 5 uses pending `flemish_belgian_relevance` and approved organization relevance text.

## Test Plan

- Run focused tests per subphase, then before broad handoff run: `npm run typecheck`, `npm test`, `npm run test:deno`, `npm run build`, and `graphify update .`.
- Add/cover: schema migration contract, org evidence persistence, org approved/pending dedupe, people pending intake regression, people/org CSV/XLSX fixtures, review approval/reject/merge, prompt prefill without auto-run, and legacy-call guards.
- For every migration, run `supabase db push --linked` and remote schema verification. For every changed edge function, deploy to `ofzuhajxwxggybkuzefq` and verify the function is active.

## Assumptions

- Existing dirty worktree changes are user-owned; do not revert them.
- Manual Discovery intake becoming pending-only is intended by Phase 5.
- Separate organization evidence table is the chosen evidence model.
- Final Phase 5 owns legacy discovery function/task removal; Phase 9 should not repeat that cleanup afterward.
