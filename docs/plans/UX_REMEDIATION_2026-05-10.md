---
created: 2026-05-10
source: docs/plans/UX_REVIEW_2026-05-10.md
status: proposed
handover: true
---

# UX Remediation Plan — 2026-05-10

Pick-up doc for a new agent. Fixes the issues catalogued in
`docs/plans/UX_REVIEW_2026-05-10.md` (the review) — root causes already
diagnosed there with file:line precision. This plan converts those diagnoses
into ordered, verifiable phases.

## Required pre-reads (in this order)

1. `CLAUDE.md` — durable operating rules. Note: edge-function deploys and
   migrations must be applied to the linked project (`ofzuhajxwxggybkuzefq`)
   in the same session, not left as instructions.
2. `docs/plans/UX_REVIEW_2026-05-10.md` — every fix below references it. The
   "Root-cause investigation" section has the proof for each diagnosis.
3. `docs/ROUTES.md`, `docs/AI-PIPELINE.md`, `docs/SCHEMA.md` — contracts each
   phase must continue to honor.
4. Per-agent raw notes in `/tmp/uxreview/{A..K}_*.md` — only if you need the
   evidence behind a specific finding.

## Working context

- Working dir: `/Users/arend/Developer/flemish-network`
- Branch: `main` (already dirty from prior phases; commit at phase boundaries)
- Linked Supabase project: `ofzuhajxwxggybkuzefq`
- Dev server: `npm run dev` on `http://127.0.0.1:5173/`
- Test admin: `collearend@gmail.com` / `FlemishNetwork!8`
- Service role key is in `.env` for read-only diagnostics. Do not mutate via it.
- Per-phase commands at the end of each section. Run them; don't skip.

## Phase ordering and parallelism

```
Phase 1 (Auth)               ─┐
                              ├─► Phase 2 (suggest-people)
                              ├─► Phase 3 (Autofill)
                              ├─► Phase 4 (PersonProfile)
                              ├─► Phase 5 (Verification UI + realtime)
                              ▼
                          Phase 6 (Housekeeping — needs in-code investigation)
                              ▼
                          Phase 7 (P2/P3 cleanup + live browser pass)
```

Phase 1 must land first — it stops the cross-tab logout that has been
killing every test session. After Phase 1 is verified, Phases 2–5 are
independent (different files, no shared state) and can be parallelized via
subagents. Phase 6 needs an in-code investigation step before its fix can be
written; do not dispatch a subagent to "just fix it." Phase 7 is the
verification pass and is sequential.

---

## Phase 1 — Auth signOut storm + legacy admin routes (MUST GO FIRST)

**Why first:** every other live test session has died mid-flight because of
this. The cross-tab logout is the dominant operational defect; both review
sessions and three follow-up agents lost their sessions to it.

**Root causes** (from `UX_REVIEW_2026-05-10.md`, "Why the workspace logs out"):

- `src/lib/auth.tsx:139` — `await supabase.auth.signOut()` in the catch
  branch of `hydrateSession`, default `scope:'global'`. Any transient
  `loadStaffUser` failure broadcasts SIGNED_OUT to every tab on the origin.
- `src/lib/auth.tsx:158` — second `signOut()` with the same default scope.
- `src/lib/auth.tsx:165–193` — `getSession()` and `onAuthStateChange`
  (`INITIAL_SESSION` + `TOKEN_REFRESHED` × N + focus events) both call
  `loadStaffUser` with no single-flight guard. The `activate_staff_user_session`
  RPC therefore fires 3–5× per page load. Any one of those failing triggers
  the global signOut above.
- `src/lib/auth.tsx:230` — `RequireAuth` logs "Maximum update depth
  exceeded" (`Navigate → RequireAuth → AuthProvider`). Likely the
  `AuthProvider` memo value churns or `<Navigate replace />` receives a
  fresh `to=` each render. Verify after the signOut fix lands; may already
  resolve.
- `src/App.tsx` — legacy admin slugs `/admin/{overview,discovered,agents}`
  and `/contacts/new` are NOT redirected before `<RequireAuth>` runs.
  docs/ROUTES.md L21 promises they normalize to `/admin/discovery`.

**Changes:**

1. `src/lib/auth.tsx:139` — remove the `signOut()` call. Keep the cached
   profile; transient `loadStaffUser` failure must not nuke the session.
   Log the failure with `console.warn` so it's observable but not silent.
2. `src/lib/auth.tsx:158` — change to `signOut({ scope: 'local' })`. An
   actual logout in this tab must not broadcast to siblings.
3. `src/lib/auth.tsx:165–193` — wrap `loadStaffUser` in a single-flight
   guard. A ref holding the in-flight promise, keyed by `user.id`, deduped
   across `INITIAL_SESSION`/`TOKEN_REFRESHED`/focus. Expected: the
   `activate_staff_user_session` RPC fires exactly once per session change,
   not 5×.
4. `src/lib/auth.tsx` `AuthProvider` value — stabilize. Wrap `signOut`,
   `refreshStaffUser` with `useCallback`; freeze the `value` object via
   `useMemo` with stable deps so children don't re-render on every parent
   tick.
5. `src/App.tsx` — add explicit `<Route path="/admin/overview"
   element={<Navigate to="/admin/discovery" replace />} />` (and the same
   for `/admin/discovered`, `/admin/agents`, `/contacts/new`). They must
   be registered BEFORE `<RequireAuth>` so legacy bookmarks short-circuit
   before the auth gate runs.

**Verify:**

- Open three tabs: `/`, `/admin/discovery`, `/admin/verification`. Reload
  each. In each tab's console, count `activate_staff_user_session` RPC
  fires. Expect 1 per page load, not 5.
- In the third tab, visit `/admin/overview`. Tab redirects to
  `/admin/discovery`. Other two tabs MUST stay logged in.
- Stop the dev server, restart, log in fresh. Click Run Discovery on
  `/admin/discovery` (the actual click — known-broken before this phase).
  Other tabs MUST stay logged in. The click itself may still be broken if
  `agent-scheduler` returns 401 (that's Phase 6 territory); what matters is
  that the *session does not drop*.
- Console must NOT show "Maximum update depth exceeded" after navigating
  through `/`, `/admin/discovery`, `/admin/verification`,
  `/people/<uuid>`, `/collections`.
- `npm run typecheck` clean.
- `npm test` — auth-related tests still pass (look in
  `src/lib/__tests__/`).

**Docs to update:**

- `docs/ROUTES.md` — section "Staff Auth Contract" should mention the
  single-flight guard and the legacy-route redirects. Remove or update the
  L21 line if needed.
- `docs/WEBAPP-MASTERPLAN.md` — mark this phase complete.
- No SCHEMA/AI-PIPELINE changes.

**Estimated effort:** 1–2 hours. Single agent, no subagents (this is the
load-bearing change; do it carefully and verify in one head).

---

## Phase 2 — `suggest-people` (Collections suggestion endpoint)

**Why now:** Collections suggestion is completely broken end-to-end. Two
distinct bugs feed each other; fix both in one deploy.

**Root causes** (review: "Why `suggest-people` 401s" and "Why the `'rest'`
banner appears"):

- `supabase/functions/suggest-people/index.ts:202–212` — `callUntypedRpc`
  helper detaches `rpc` from its bound `supabase` client. PostgREST's
  internal `this.rest` is then `undefined` and the helper crashes
  server-side before any response leaves the function. The client receives
  the cryptic `Cannot read properties of undefined (reading 'rest')`.
  `supabase/functions/search-people/index.ts:262–278` has the identical
  helper but already fixed — the fix never propagated.
- Stale per-worker JWKS cache: project uses ES256 asymmetric tokens
  (`supabase/config.toml:3–6`), `suggest-people` imports floating
  `npm:@supabase/supabase-js@2`, warm Deno workers cache the JWKS, the
  worker is stuck on the pre-rotation key set. `search-people` was
  redeployed recently (new `rerank.ts`) so its workers cold-started after
  rotation.

**Changes:**

1. `supabase/functions/suggest-people/index.ts:202–212` — call as
   `client.rpc(...)` (preserve `this`), exactly like
   `supabase/functions/search-people/index.ts:262–278` does. Lift the same
   comment block over so the next agent knows why.
2. Pin the supabase-js version in every edge function's import map:
   `npm:@supabase/supabase-js@2.57.4` (or whichever matches the client
   `package.json` — confirm before changing). Grep for `@supabase/supabase-js`
   under `supabase/functions/` and replace floating `@2` tags.
3. Redeploy every edge function in one pass:
   `supabase functions deploy --project-ref ofzuhajxwxggybkuzefq`
   — single deploy forces every worker to cold-start and fetch a fresh
   JWKS, eliminating drift between functions.
4. Optional follow-up (defer if time-boxed): in
   `supabase/functions/_shared/auth.ts:88`, wrap `supabase.auth.getUser(jwt)`
   with a kid-miss → JWKS-refetch retry, so a future signing-key rotation
   doesn't break the same way. If you defer this, file a tracking line in
   `docs/RUNBOOK.md` so future agents know the operational answer.

**Verify:**

- `curl -X POST https://ofzuhajxwxggybkuzefq.supabase.co/functions/v1/suggest-people`
  with the page's bearer (grab from `localStorage` `sb-ofzuhajxwxggybkuzefq-auth-token`)
  returns 200 with candidates, not 401.
- `/collections` → New Collection → fill name + description → "Next:
  Suggestions" returns actual candidates within ~3 s.
- `/collections/:id` → "Find Collection Suggestions" returns candidates.
- The banner "Cannot read properties of undefined (reading 'rest')" must
  no longer appear in console for any 401 path.
- `npm run test:deno` if there are deno tests for `_shared`.

**Docs to update:**

- `docs/AI-PIPELINE.md` — bump the supabase-js version note if one exists;
  add a one-line operational note about JWKS rotation + redeploy.
- `docs/RUNBOOK.md` (already in working tree, untracked) — add an
  `auth_failed` / kid-miss section if not present.
- No SCHEMA/ROUTES changes (contract unchanged).

**Estimated effort:** 30–60 minutes. **Parallelizable** with Phases 3, 4, 5
once Phase 1 has merged.

---

## Phase 3 — Autofill latency (the headline user complaint)

**Why now:** "the autofill is very very slow now" is the headline complaint
in the original message. Measured p50 1.01s per keystroke, 2.0s outliers.

**Root cause** (review: "Why autofill is slow"):

- `src/components/UnifiedSearchBar.tsx:49–104` (specifically `:62–64`) —
  `or=(name.ilike.%q%, first_name.ilike.%q%, last_name.ilike.%q%)` against
  the raw `people` table. Only btree indexes exist there, leading-`%`
  defeats them. Trigram GIN exists on
  `people_search_documents.name_normalized` (migration
  `20260331120000_phase1_search_upgrade.sql:131`) and
  `organization_search_documents.name_normalized` (`20260507000000_phase3_search_network.sql:62`).
- People + organization queries are awaited sequentially.
- `locations(*)` is included in the SELECT but never rendered.
- No `AbortController` — stale-response race.
- Fires at `q.length === 1` (worst-case selectivity).

**Changes:**

1. Replace the autofill query in `UnifiedSearchBar.tsx:49–104` with a
   single RPC `search_people_autofill(q text, lim int)` that does:
   - `SELECT person_id, name_normalized FROM people_search_documents WHERE name_normalized ILIKE '%' || q || '%' LIMIT lim;`
   - `SELECT organization_id, name_normalized FROM organization_search_documents WHERE name_normalized ILIKE '%' || q || '%' LIMIT lim;`
   - returns a union of both with `entity_type` tag.
   - Both columns have trigram GIN — query plan: bitmap-index-scan, single-digit ms.
   - Migration: new file `supabase/migrations/20260510<HHMM>00_autofill_rpc.sql`.
2. In `UnifiedSearchBar.tsx`:
   - Call the new RPC with `Promise`-no-need (single call now).
   - Raise minimum length to `q.length >= 2`.
   - Bump debounce to 250 ms.
   - Attach `AbortController` per effect run; pass to
     `supabase.rpc('search_people_autofill', …, { signal: controller.signal })`
     (supabase-js v2 supports `signal` on functions/rpc).
   - Drop the `locations(*)` join entirely.
   - Add a small client-side LRU memo for the last 10 queries.
3. Verify the same pattern is not duplicated elsewhere: `src/pages/Dashboard.tsx:185–218`
   `runSearch` does a separate heavy ILIKE+huge join. That is its own
   bug (review: "Dashboard `runSearch` duplicates the same un-indexed
   ILIKE pattern"). Defer to Phase 7 unless trivial — the
   `search-people` Stage 1 path already exists and should be used here
   too, but it's a bigger refactor.

**Verify:**

- Open `/`, type `E`. Network panel shows ONE `/rest/v1/rpc/search_people_autofill`
  call (not two). p50 should drop to ~150–250 ms.
- Type `Els De Smet` fast; only the final call returns; earlier inflight
  requests are aborted (200 → cancelled in network panel).
- Type, delete, type same query — second time hits the LRU memo (no
  network call).
- `EXPLAIN ANALYZE` on the new RPC against the linked project shows
  `Bitmap Index Scan on people_search_documents_name_normalized_trgm_idx`.
- `npm run typecheck` + `npm test`.
- `npm run smoke` if it exercises the search route.

**Docs to update:**

- `docs/SCHEMA.md` — add the new RPC `search_people_autofill(q, lim)`.
- `docs/ROUTES.md` — Search API Contract section should mention that
  autofill goes through the new RPC; the existing search-people contract
  is unchanged.
- `docs/AI-PIPELINE.md` — no change unless you also route autofill
  through `search-people` (you can; in which case document the limit=8 case).
- `docs/WEBAPP-MASTERPLAN.md` — mark phase complete.

**Estimated effort:** 1–2 hours including migration + deploy.
**Parallelizable** with Phases 2, 4, 5.

---

## Phase 4 — PersonProfile: silent auto-verify + URL validation

**Why now:** silent auto-verify forges human verification on every edit —
direct data-integrity bug, hits the verify-before-promote contract the
rest of the app relies on. URL validation lets a profile become a same-origin
nav trap.

**Root causes** (review: top-issues #8 and #9):

- `src/pages/PersonProfile.tsx:220` — `last_verified_at: new Date().toISOString()`
  written on every save. The "Verified" badge at `:691–715` is derived
  from this field. Any field edit retroactively forges human verification.
- `src/pages/PersonProfile.tsx:65` — `ensureProtocol` only prepends
  `https://` when the string contains a `.`. `not-a-url-no-protocol-no-dot`
  saves untouched and renders as a same-origin relative `<a>` to
  `/people/not-a-url-…`.
- Applies to `linkedin_url`, `twitter_url`, `website_url`.

**Changes:**

1. `src/pages/PersonProfile.tsx:220` — DELETE the `last_verified_at` write
   from the save payload. Verification is owned by the verify pipeline
   (`/admin/verification` Approve flow, `agent-verify` edge function),
   never by a profile edit. Audit the rest of the save handler for any
   other field that mirrors `last_verified_at` (e.g.
   `verification_state`); strip those too.
2. `src/pages/PersonProfile.tsx:65` — tighten `ensureProtocol`. Require
   one of:
   - already starts with `https://` or `http://` (allow);
   - matches a strict URL shape: `/^[a-z][a-z0-9+\-.]*:\/\//i` OR a
     domain shape `^([\w-]+\.)+[a-z]{2,}/?` (case-insensitive) — only
     then prepend `https://`.
   - otherwise: reject with a toast and a field-level error; do not save.
   For `linkedin_url` specifically, additionally validate it contains
   `linkedin.com/` after normalization (warn, don't block).
3. Add field-level error rendering for invalid URLs (existing form-error
   pattern in the file should be reused).
4. While in PersonProfile, also fix the "Bad UUID renders blank for 1.5–2.5 s"
   bug (review: MED in /tmp/uxreview/D_profiles.md): add a
   `useState<'loading'|'ready'|'notfound'>` and a skeleton card; only render
   the "Person not found" state when `!loading && !person`. Same pattern
   applies in `src/pages/OrganizationProfile.tsx` — fix both.

**Verify:**

- Edit any person, save with no changes — badge does NOT flip from
  Unverified to Verified. `last_verified_at` in the DB is unchanged.
- Edit a person, set LinkedIn to `not-a-url-no-protocol-no-dot` — toast
  error, save blocked, value unchanged.
- Set LinkedIn to `linkedin.com/in/someone` — auto-prepends `https://`,
  saves, renders as a proper external link.
- Visit `/people/notauuid` — skeleton card appears, then "Person not
  found" after the lookup resolves; no blank shell.
- Reload `/people/<real-uuid>` directly — skeleton card visible during
  fetch.
- `npm run typecheck` + `npm test`.

**Docs to update:**

- No SCHEMA/ROUTES changes (contract preserved).
- `docs/WEBAPP-MASTERPLAN.md` — mark phase complete.

**Estimated effort:** 60–90 minutes. **Parallelizable** with Phases 2, 3, 5.

---

## Phase 5 — Verification UI filter, null default, and realtime callback

**Why now:** the verify-before-promote gate is silently bypassable and the
queue is partly invisible. The user's complaint "verification doesn't finish"
becomes visible after this phase (rows that ARE stuck will show up in the UI;
the underlying dispatch fix is Phase 6).

**Root causes** (review: "Why the verification queue stays stuck" and "Why
realtime never connects"):

- `src/components/admin/DiscoveredContactsPanel.tsx:1142, 1147, 1175` —
  queue load uses `.eq('status','pending')`. Lifecycle is owned by
  `verification_status`; any row whose legacy `status` drifted (e.g.
  `'approved'`) is invisible. Confirmed: 1 of 2 queued contacts
  (Sofie Peeters) is hidden by this filter.
- `DiscoveredContactsPanel.tsx:1577` and `:2023` — `verification_status ??
  'verified'` silently bypasses the gate for NULL values.
- `DiscoveredContactsPanel.tsx:1331–1340` (`handleRejectAll`) and `:1399–…`
  (`handleRejectAllOrganizations`) — hard-DELETE every row in the section
  regardless of `verification_status`, no confirmation, no reason capture.
  `handleApproveAll` at `:1310–1316` does enforce the gate; rejects must
  match.
- `DiscoveredContactsPanel.tsx:1266` — `.subscribe()` has no status
  callback, so realtime failures are invisible. Publication is correct
  (migration `20260508000006_verify_before_promote.sql:108–118` adds both
  tables).

**Changes:**

1. `DiscoveredContactsPanel.tsx:1142–1175` — drop the
   `.eq('status','pending')` filter on queue load. Key on
   `verification_status IN ('queued','verifying','verified')`. The same
   change applies to the orgs query block. Audit nearby queries for the
   same pattern.
2. `DiscoveredContactsPanel.tsx:1577` and `:2023` — change
   `verification_status ?? 'verified'` to `?? 'queued'`. A NULL must
   never unlock Approve/Reject.
3. `DiscoveredContactsPanel.tsx:1331–1340` and `:1399–…` —
   `handleRejectAll` and `handleRejectAllOrganizations`:
   - Filter to `verification_status === 'verified'` only (match
     `handleApproveAll`).
   - Add a confirmation dialog (existing modal pattern in the file).
   - Add a "rejection reason" textarea, persisted to
     `reject_reason` + `reject_reason_note` on each row (SCHEMA already
     has those columns per the discovered_organizations sample in
     /tmp/uxreview/recent_runs).
4. Per-row `handleReject` at `:1273–1286` — same: require reason, soft-delete or
   set `verification_status='rejected'`+`reviewed_at=now()` instead of
   hard DELETE if the schema supports it; otherwise capture reason before
   delete.
5. `DiscoveredContactsPanel.tsx:1266` — add a status callback to
   `.subscribe()`:
   ```ts
   .subscribe((status, err) => {
     console.debug('[verification realtime]', status, err);
     if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
       // start a 15s polling fallback while a queued/verifying row is in view
     }
   });
   ```
6. The refresh-storm (review: "Duplicate fetches"): in the same file,
   collapse `loadData` useEffect and the realtime useEffect into a single
   effect that loads once and lets realtime push updates. Defer if not
   trivial.
7. Section chevrons at `:1502–1514` and `:1948–1960` — add
   `aria-expanded`/`aria-controls`; persist open state in `localStorage`
   keyed by section.
8. Cosmetic: greyed styling on `verification_status IN ('queued','verifying')`
   rows (review: P2 "queued badge not visually greyed"). Reduce row
   opacity to 0.6.

**Verify:**

- `/admin/verification` shows 2 pending people (was 1), 4 pending orgs
  (unchanged); Sofie Peeters is now visible.
- Approve/Reject buttons appear only on `verification_status === 'verified'`
  rows. A NULL row does NOT show them.
- `Reject All` requires reason + confirmation, only deletes verified rows.
- Console logs `[verification realtime] SUBSCRIBED` (or
  `CHANNEL_ERROR` — if so, file a follow-up to relax RLS on the realtime
  publication path; do not over-fix in this phase).
- Collapse the People section, reload — section stays collapsed.
- `npm run typecheck` + `npm test`.

**Docs to update:**

- `docs/ROUTES.md` — Verification section: clarify that
  `verification_status` is authoritative; `status` filter removed.
- `docs/SCHEMA.md` — no change unless rejection-reason capture requires a
  new column (verify with `recent_runs.json` first).
- `docs/WEBAPP-MASTERPLAN.md` — mark phase complete.

**Estimated effort:** 1–2 hours. **Parallelizable** with Phases 2, 3, 4.

---

## Phase 6 — Verification dispatch: housekeeping `forwardedAuth` (needs investigation first)

**Why deferred:** Phase 5 makes the orphans visible; Phase 6 makes the
queue actually drain. This phase has an unresolved sub-question that needs
an in-code read before you can write the fix.

**Root cause** (review: "Why the verification queue stays stuck"):

- `supabase/functions/agent-scheduler/index.ts:836–843` — the no-auth
  branch in `enqueueVerificationBatch` silently resets rows to `queued,
  verification_run_id=null` when `forwardedAuth` is missing. No log, no
  `agent_runs.error_message`. Run Housekeeping reports success in ~5 s and
  the rows stay stuck.
- `agent-scheduler/index.ts:859–873` — the dispatch-catch does the same
  silent reset.

**Open question to resolve first** (~15 min in-code read):

- Is `forwardedAuth` *supposed to be missing* on the housekeeping path
  (cron tick), or did a recent change break the auth-forwarding?
- Read `supabase/functions/agent-scheduler/index.ts` top-to-bottom. Trace
  every entrypoint: HTTP POST from staff, HTTP POST from
  `agent-scheduler-tick` cron, internal recursive calls. Identify what
  auth context each entrypoint provides.
- Confirm `agent-scheduler-tick` (the pg_cron job) — read the migration
  that creates it (grep `pg_cron` and `agent-scheduler-tick` under
  `supabase/migrations/`).
- Decision tree:
  - If housekeeping is *supposed to* run anonymous (cron has no user),
    then `enqueueVerificationBatch` should use the service-role client
    for the dispatch instead of forwarding user auth. Verification rows
    don't need user-context to run.
  - If housekeeping *was supposed to* forward a service token but a
    recent change dropped it, restore the token forwarding.

**Changes** (after the decision):

1. `agent-scheduler/index.ts:836–843` — when `forwardedAuth` is missing,
   either:
   - (a) fall back to the service-role client for `agent-verify` dispatch
     (preferred if cron is anonymous by design), OR
   - (b) mark the parent `agent_runs` row `failed` with
     `error_kind='auth_missing'` and a clear `error_message`, and DO NOT
     reset the row — leave it as `verifying` with a `verification_run_id`
     so the next housekeeping pass can pick it up via a stale-claim sweeper.
2. `agent-scheduler/index.ts:859–873` — dispatch-catch: persist the
   failure to `agent_runs.error_message` before any state change. Add a
   `verification_attempts` integer counter on `discovered_contacts` and
   `discovered_organizations` so a row that has failed N≥3 times is
   marked `verification_status='failed'` (new state) with the last error
   and surfaced separately in the UI (don't silently re-queue forever).
3. New migration `supabase/migrations/20260510<HHMM>00_verification_failure_state.sql`:
   - `ALTER TABLE discovered_contacts ADD COLUMN verification_attempts int NOT NULL DEFAULT 0`
   - same on `discovered_organizations`
   - If you add a `verification_status='failed'` value, update any CHECK
     constraint or enum.
4. UI follow-up in `DiscoveredContactsPanel.tsx`: surface
   `verification_status='failed'` rows in a small "Verification failed"
   sub-section under each main section, with a "Retry" button that calls
   `agent-scheduler` for that row.
5. Toast or banner in `/admin/system` housekeeping result: if the run
   surfaced any verification dispatch failures, say so. Today's silent
   "Housekeeping completed" lies.

**Verify:**

- Click Run Housekeeping on `/admin/system`. Within ~30 s, the 6 stuck
  rows transition `queued → verifying → verified` (or `failed` after
  three attempts). System card shows actual progress.
- Force a failure (temporarily break the `agent-verify` deploy or pass a
  bad payload): `agent_runs.error_message` is populated, the discovered
  row's `verification_attempts` increments, and the System card surfaces
  the failure.
- After 3 forced failures, the row lands in `verification_status='failed'`
  and is no longer reclaimed.
- `agent-verify` Retry button on a failed row resets `verification_attempts`
  and re-dispatches.
- `npm run typecheck`, `npm test`, `npm run test:deno`.
- `supabase db push --linked` for the migration.
- `supabase functions deploy agent-scheduler --project-ref ofzuhajxwxggybkuzefq`
  AND `supabase functions deploy agent-verify --project-ref ofzuhajxwxggybkuzefq`.

**Docs to update:**

- `docs/SCHEMA.md` — new column `verification_attempts`, possibly new
  state `verification_status='failed'`.
- `docs/AI-PIPELINE.md` — housekeeping behavior; retry contract; failure
  surfacing.
- `docs/ROUTES.md` — `/admin/system` housekeeping result wording;
  `/admin/verification` failed sub-section.
- `docs/WEBAPP-MASTERPLAN.md` — mark phase complete.
- `docs/EVALUATION.md` if verification quality gates change.
- `.env.example` — no change unless you add a `VERIFICATION_MAX_ATTEMPTS` var.

**Estimated effort:** 2–4 hours including investigation, migration, deploy,
verify. Single agent — do not parallelize this with anything; it touches
the dispatch path and needs careful read-before-write.

---

## Phase 7 — P2/P3 cleanup + live browser verification pass

**Why last:** these need a stable session (Phase 1) AND a working
`suggest-people` (Phase 2) AND fixed autofill (Phase 3) before they can be
meaningfully tested.

**Changes — group by file to minimize context-switching:**

1. `src/pages/Dashboard.tsx:185–218` (`runSearch`): replace the heavy
   client-side ILIKE+join with a `search-people` Stage 1 invocation
   (`limit=8`). Drop the duplicate code path. (Review B9.)
2. `src/pages/Dashboard.tsx:312–316`: do NOT force `view=list` on every
   query. Preserve the user's current view.
3. `src/components/UnifiedSearchBar.tsx` `handleSubmit`/`handleClear`/
   `handleSuggestionClick`: clear `debounceRef.current` to prevent
   Enter-mid-debounce reopening the dropdown. (Review B5.)
4. `src/components/UnifiedSearchBar.tsx` + `src/pages/Dashboard.tsx`:
   replace the sentinel-string `id:<id>:<type>:<name>` parsing with a
   proper object pass. Names containing `:` no longer corrupt the parse.
   (Review B4.)
5. `src/components/admin/AddContactPanel.tsx`: add `last_name` required
   check in the manual-entry validator. (Review B P2.)
6. `src/components/admin/AgentDashboard.tsx`:
   - (a) Wire `src/lib/formatDateTime.ts` for duration formatting; emit
     "1d 11h 46m" instead of "2146m 6s". (Review B P1.)
   - (b) Surface a toast on Run Discovery success ("Discovery run
     scheduled"). (Review B P1.)
   - (c) Render the failure callout consistently for all failed rows
     (don't gate on `error_kind` presence). (Review B P2.)
7. `src/lib/appRouting.ts`: when `?mode=` is unknown, `setSearchParams`
   to canonical `?mode=discovery` so URL state matches the rendered tab.
   (Review B P2.)
8. `src/components/admin/SystemHealthPanel.tsx`: zero the "Est. cost"
   line when Gemini + Tavily call counts are both zero. Or label the
   cost source so the discrepancy is explained. (Review F H1.)
9. `src/components/admin/AccessManagementPanel.tsx`: disable the Remove
   button on the current-user's own row; add `title="You cannot remove
   yourself"`. (Review F H2.)
10. `src/components/admin/InteractiveStatsOverview.tsx` and the
    `get_network_location_summary` RPC migration: fix the
    `org_count: 0` regression — orgs aren't being joined to locations
    in the RPC. (Review F H3.) Will require a new migration + deploy.
11. New migration: partial unique indexes on `collection_members`:
    - `CREATE UNIQUE INDEX collection_members_person_uq ON collection_members(collection_id, person_id) WHERE person_id IS NOT NULL;`
    - `CREATE UNIQUE INDEX collection_members_org_uq ON collection_members(collection_id, organization_id) WHERE organization_id IS NOT NULL;`
    Race-safe duplicate prevention; client guard alone is insufficient.
12. `src/pages/PersonProfile.tsx` Verification Preview modal: bind
    Escape to close. (Review D MED.)
13. `src/components/AddToCollectionDropdown.tsx`: show a checkmark or
    "Remove" affordance when the person/org is already a member. Today
    the toggle is invisible. (Review D LOW.)
14. React Router v7 future-flag warnings: opt in to `v7_startTransition`
    and `v7_relativeSplatPath` in the router config. (Review M3.)
15. Stale empty-state header on `/`: review carryover from 2026-05-08
    item #3 — confirm still present (the search Stage 1+rerank refactor
    in 2026-05-08 Phase 1A was supposed to subsume this).

**Live browser verification pass** (dispatch a subagent with Chrome
tools — Phase 1 must be merged so the session stays alive):

- Spin up a clean Chrome session, log in as
  `collearend@gmail.com`. Walk every route in `docs/ROUTES.md`. Confirm:
  - Cross-tab session stable (open 5 tabs, click every Run button, no
    logout).
  - Autofill p95 < 300 ms.
  - Collections suggestion works end-to-end (drafts, accept/reject,
    gap-handoff, in-place preview, dedup, two-tab realtime — predicted
    NOT to work because Collections.tsx has no realtime; file follow-up
    if confirmed).
  - `/organizations/:id` reviewed fully (D's deferred items): layout,
    edit, narrow viewport, add-to-collection writes
    `organization_id`+NULL `person_id`.
  - Admin permanent-delete cascades correctly (`collection_members`,
    `person_flemish_connections`, `person_us_connections`,
    `person_sectors`, search index).
  - Realtime: `[verification realtime] SUBSCRIBED` in console; cards
    flip without manual refresh.
  - Bad URLs (`/people/notauuid`, `/organizations/notauuid`) show
    skeleton + not-found, not blank shell.
- Write the verification report to `docs/plans/UX_VERIFICATION_2026-05-1<X>.md`
  and link from `docs/WEBAPP-MASTERPLAN.md`.

**Docs to update:**

- All affected source-of-truth docs per CLAUDE.md.

**Estimated effort:** 4–8 hours. The cleanup is independent items;
**subagents are appropriate** here — one subagent per 2–3 related items
(e.g. "Dashboard runSearch + UnifiedSearchBar polish", "AgentDashboard
duration + toast + callout", "SystemHealthPanel + AccessManagementPanel +
InteractiveStatsOverview", "PersonProfile modal + AddToCollectionDropdown
+ router v7 flags", "collection_members unique indexes + migration").

---

## Hand-back criteria (for whoever runs this plan)

- All 7 phases marked complete in `docs/WEBAPP-MASTERPLAN.md`.
- `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:deno`,
  `npm run build`, `npm run smoke` all pass.
- Every migration applied to the linked project (`supabase db push --linked`)
  in the same session as the code change.
- Every edge function in `supabase/functions/` redeployed via
  `supabase functions deploy --project-ref ofzuhajxwxggybkuzefq` in the
  same session as the code change.
- Live verification pass (Phase 7) confirms the seven top-issues from
  `UX_REVIEW_2026-05-10.md` are resolved.
- Source-of-truth docs (`SCHEMA.md`, `ROUTES.md`, `AI-PIPELINE.md`,
  `PRODUCT-SERVICES.md`, `EVALUATION.md`, `WEBAPP-MASTERPLAN.md`,
  `.env.example`) updated per phase.
- New `docs/plans/UX_VERIFICATION_2026-05-1<X>.md` written summarizing
  what was verified live and what (if anything) remains.

## What to NOT do

- Do not skip Phase 1; nothing else can be tested live until the session
  stops dropping.
- Do not parallelize Phase 6; it touches the verification dispatch path
  and needs careful in-context reading first.
- Do not "fix" the `RequireAuth` infinite render loop with band-aids; it
  is almost certainly resolved by Phase 1 stabilizing the AuthProvider
  memo. Verify before adding code.
- Do not add a separate "JWKS retry" helper if pinning supabase-js +
  redeploy (Phase 2) is sufficient; document the operational answer in
  `docs/RUNBOOK.md` and revisit only if another rotation breaks the same
  way.
- Do not generate synthetic seed data to "improve testing" unless the
  product owner asks for it — current seed is fine for UI mechanics; the
  bugs are not seed-quality artifacts.
- Do not amend prior commits or force-push; commit at phase boundaries
  with descriptive messages.
