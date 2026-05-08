# Phase 7 — Verification Consolidation

Implementation handoff for Phase 7 of `docs/WEBAPP-MASTERPLAN.md`. This file tracks granular progress so the work can span sessions.

## Architectural decisions

- **Suggestion storage**: extend `profile_suggestions` in place rather than create a new `record_suggestions` table. Add `record_type ('person'|'organization')` and nullable `organization_id`. Make `person_id` nullable. Add a CHECK constraint that exactly one of (`person_id`, `organization_id`) is set and matches `record_type`. Rename to `record_suggestions` is deferred; the table name is now mildly misleading but the migration is small and RLS is preserved.
- **Unified contract**: extend `agent-verify` (durable mode owner) to accept `mode: "preview"|"durable"` and `record_type: "person"|"organization"`. `update-profile` becomes a thin shim that forwards to preview mode (kept for caller-stability; retired in a later phase once the only caller, `ProfileUpdateModal`, is moved over).
- **Risk policy**: existing `getFieldRisk()` in `_shared/verification.ts` already classifies fields. Reused for orgs by adding org-specific field names. High-risk fields stay review-first; auto-apply remains out of scope.
- **Org verification path**: web-search + Gemini structured (no LinkedIn for orgs in this phase). Reuse `searchWeb` and a new `check_organization` AI contract task definition.

## Status

### Layout & UX
- [x] /admin/verification stack: Stale Records full-width on top, Profile Suggestions below, Derived Labels at bottom (`src/pages/Admin.tsx`).
- [x] Frontend: organization suggestions section in /admin/verification (`OrganizationSuggestedChanges`).

### Schema
- [x] Migration `20260507140000_phase7_record_suggestions.sql`: extend `profile_suggestions` with `record_type`, `organization_id`, nullable `person_id`, CHECK constraint, partial dedupe index for orgs. Applied to remote.
- [x] `database.types.ts` updated for new columns and FK.
- [x] `docs/SCHEMA.md` row for `profile_suggestions` reflects record-level shape.

### Edge functions
- [x] `_shared/verification.ts`:
  - [x] `insertVerificationSuggestions(supabase, target, suggestions, options)` takes `{ recordType, recordId }` and writes `record_type` + the matching FK column.
  - [x] `loadVerificationOrganization()` exported.
  - [x] `runVerificationForOrganization()` scaffolded (returns `no_results` until full implementation lands).
  - [x] Web-search + Gemini implementation for `runVerificationForOrganization()`.
  - [x] `fetchOrganizationVerificationCandidates()`.
  - [x] Organization-specific `getFieldRisk()` cases (description=high; name/website=medium; type=low).
- [x] `aiContracts.ts`: add `check_organization` task definition (system prompt, schema, parser).
- [x] `agent-verify/index.ts`:
  - [x] Accepts `mode: "preview"|"durable"` (default `"durable"`).
  - [x] Accepts `record_type: "person"|"organization"` (default `"person"`).
  - [x] Preview branch: skips writes, returns suggestions for one record (person or organization).
  - [x] Durable person branch: unchanged behavior, writes via the new target signature.
  - [x] Durable organization branch: fetches org candidates, runs verification, inserts `record_type='organization'` suggestions, marks orgs verified via `markOrganizationVerified`.
- [x] `update-profile/index.ts`: already preview-only, kept as-is; documented in `docs/AI-PIPELINE.md` as a thin wrapper for the unified contract.

### Frontend
- [x] `ProfileUpdateModal.tsx` keeps calling `update-profile`; no behavior change. Optional later: switch to `agent-verify` with `mode: "preview"`.
- [x] Add organization queue UI in /admin/verification.
- [ ] Optional: add "Verify" button on organization detail to call preview mode.

### Tests (Deno + node)
- [ ] Preview mode performs no DB writes (Deno integration).
- [ ] Durable mode writes person suggestions with evidence (Deno integration).
- [ ] Durable mode writes organization suggestions with evidence.
- [ ] High-risk suggestions remain pending review.
- [ ] Suggestion dedupe prevents repeated identical suggestions for the same record.

### Docs
- [x] `docs/SCHEMA.md` — record-level suggestions, org_id, record_type, CHECK.
- [x] `docs/AI-PIPELINE.md` — unified contract, preview/durable, organization verification.
- [x] `docs/ROUTES.md` — note org queue under /admin/verification.
- [x] `docs/WEBAPP-MASTERPLAN.md` — flip Phase 7 todos to `[done]` as completed.

### Deploy & verify
- [x] `npm run typecheck`
- [x] `npm test`
- [x] `npm run test:deno`
- [x] `npm run build`
- [x] `supabase db push --linked`
- [x] `supabase functions deploy agent-verify --project-ref ofzuhajxwxggybkuzefq`
- [ ] `supabase functions deploy update-profile --project-ref ofzuhajxwxggybkuzefq` (no code change this session; redeploy not required)
- [ ] Manual: inline verify on a profile produces suggestions with no `profile_suggestions` row.
- [ ] Manual: durable batch verify writes suggestions visible in /admin/verification.

## Out of scope (Phase 7)

- Auto-applying high-risk suggestions.
- Verification of pending discovery candidates before reviewer approval.
- LinkedIn scraping for organizations.
- Renaming `profile_suggestions` to `record_suggestions` (cosmetic; do later).
- Retiring `update-profile` endpoint entirely (`[later]` — keep as wrapper this phase).
