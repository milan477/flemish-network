---
created: 2026-05-08
source: docs/plans/UX_REVIEW_2026-05-08.md
status: proposed
---

# UX Remediation Plan — 2026-05-08

This plan groups the issues from `UX_REVIEW_2026-05-08.md` by shared root cause, not by surface. Many bugs that look unrelated trace back to a small number of architectural seams. Phases are ordered by user-visible severity and by dependency (earlier phases unblock later ones).

Each item lists the **file:line** root cause from investigation, so the plan can be picked up by any future agent.

**Docs are updated per phase, not deferred.** Per `CLAUDE.md`, a phase is not complete until every affected source-of-truth doc (`SCHEMA.md`, `ROUTES.md`, `AI-PIPELINE.md`, `PRODUCT-SERVICES.md`, `EVALUATION.md`, `WEBAPP-MASTERPLAN.md`, `.env.example`) has been updated in the same session as the code change. Each phase below ends with a **Docs to update** block listing the files that phase touches. If a phase requires no doc changes, that block says so explicitly.

---

## Phase 1 — Make the headline flows correct

The two flows that staff use most — **AI Search** and **Run Discovery / Explore** — both fail silently in ways that look like the data is broken when actually the parser/scheduler are. Fix these first.

### 1A. Replace the query parser with hybrid retrieval + LLM rerank

**Decision**: delete the natural-language filter parser entirely. The query box becomes a pure semantic-intent channel. Filter chips remain as a manual control only — set by user clicks, never auto-extracted from the query. This kills the entire bug class (Boston-IN, healthcare→biotech, SF/NYC/LA, filter persistence, stale empty-state, loose-rerank-with-no-coverage) at the root rather than patching six surfaces.

**Why this is fine at 1000 people**: pgvector with an `hnsw` index does cosine over 1000 vectors in single-digit ms; tsvector full-text the same. The only slow step is the Haiku rerank on top-50 (~1s), which streams in over an instant Stage-1 result. Failure mode shifts from "silently filtered to Indiana" to "loose match" — fixable by the user with explicit chips.

**The architecture**

Two stages, no parser:

- **Stage 1 — hybrid retrieval, <100ms, top 50.** Apply user-set filter chips as SQL `WHERE` first to shrink the candidate pool. Then run pgvector cosine over per-entity profile blobs *and* tsvector BM25 over the same blobs in parallel. Merge with **Reciprocal Rank Fusion** (`score = 1/(k+rank_embed) + 1/(k+rank_bm25)`, `k≈60`). Return top 50 tagged as "loose match". Embeddings handle "biotech founders" → "biotechnology entrepreneur"; BM25 handles exact tokens like "KU Leuven" that embeddings can wash out.
- **Stage 2 — Haiku rerank, streaming, ~500–1500ms, top 10–20.** Send the original query plus 50 candidate blobs to Haiku 4.5; ask for ranked IDs with a one-line "why this matches." Stream into the UI. This is where "in Boston" gets respected without a parser — Haiku reads the query and the blobs and just understands.

A "profile blob" is one concatenated text string per entity covering everything semantically relevant: name, current title, current org, full city + state (spelled out, not codes), sector names (not IDs), Flemish-tie names, bio, role history. The richer the blob, the more retrieval "just works." One vector per person; embedded on write.

**Step-by-step migration**

1. **Build the profile-blob view + embed job.** Add a SQL view `person_search_blob` (and `organization_search_blob`) that concatenates the fields above. Add an `embedding vector(N)` column on a backing table with an `hnsw` index. Build an event-driven embed job: re-embed on insert/update of person, location, sectors, flemish_connections, role; one-time backfill for existing rows. Document the blob shape in `docs/AI-PIPELINE.md`.
2. **Ship `search-people` v2.** New code path: explicit-filter `WHERE` → pgvector cosine + tsvector BM25 in parallel → RRF merge → return top 50 with a `match_kind: "loose"` tag and per-row `score`. Cache query embeddings (LRU keyed on the query string). Keep v1 reachable behind a flag for one release for fallback.
3. **Add Haiku rerank as a streaming second response.** UI renders Stage 1 immediately as "loose match" cards. Stage 2 calls Haiku with original query + 50 blobs, streams ranked IDs back, UI re-orders + drops the "loose match" tag from the top N. If Haiku fails, Stage 1 results stay — graceful degradation by default.
4. **Delete the parser.** Remove `src/lib/filterParser.ts`, `parseFiltersFromQuery`, the chip auto-extraction in `Dashboard.tsx:303–316`, and the merge logic in `appRouting.ts:140–175`. Keep the chip *components* — they are now driven only by user clicks. Remove the empty-state header at `DirectoryGrid.tsx:311–315` (now subsumed by Stage 1's "loose match" path returning 0 rows). Drop the dead branches in `search-people/index.ts:737–762` (coverage-check fallthrough) — Haiku is the ranker now.

**What this resolves from the review**

- #1 Boston-IN, second-pass SF/NYC/LA/Indianapolis, #5 healthcare→Biotech, MIT-CS-prof loose rerank — all collapse with the parser.
- #2 filter chip persistence — chips are only set by clicks, so a new query can't drag old chips along.
- #3 stale empty-state header — replaced by a single ranked list.
- AI Search §"Sector synonym slop" and §"Healthcare query mapped to Biotechnology" — handled by Haiku reading the query, not by alias tables.

**Acceptance**

- Every repro snippet from the review (`Flemish people working in biotech in Boston`, `KU Leuven alumni in healthcare`, `founders in Indianapolis`, `Belgian founders in SF`, `Boston, MA biotech`, `AI researchers in Atlanta`) returns sensible top-3 results with no incorrect chip filtering.
- p95 time-to-first-result <200ms; p95 time-to-reranked-result <2s at 1000 people.
- `filterParser.ts` and `parseFiltersFromQuery` are deleted; no remaining call-sites.
- Filter chips appear only when the user clicks a filter control.

**Risks / open questions**

- Embedding cost on backfill: 1000 people × small blobs is trivial (cents). Ongoing event-driven embeds are negligible.
- Query embedding latency adds to Stage 1; mitigate with the LRU cache (common queries become free) and by running it in parallel with the BM25 query.
- Haiku rerank cost: ~50 short blobs per query, fractions of a cent per search at Haiku 4.5 prices. Acceptable for staff-only tool.
- Embedding model choice + dimension is a separate decision — match what `search-people` already uses if possible to avoid a second backfill.

**Docs to update**

- `docs/AI-PIPELINE.md` — replace the existing search section: document the profile-blob shape, the embed job (event-driven + backfill), Stage 1 hybrid retrieval (pgvector + tsvector + RRF), Stage 2 Haiku rerank streaming contract, graceful-degradation behavior, and the removal of `filterParser.ts` / `parseFiltersFromQuery`.
- `docs/SCHEMA.md` — document the `person_search_blob` / `organization_search_blob` views, the embedding column + `hnsw` index, and the trigger/event wiring for re-embed on write.
- `docs/EVALUATION.md` — add a "search regression" suite covering every repro snippet from `UX_REVIEW_2026-05-08.md` (Boston-IN, KU Leuven healthcare, Indianapolis, SF, `Boston, MA biotech`, `AI researchers in Atlanta`); set the latency targets (p95 first-result <200ms, p95 reranked <2s at 1000 people) as gates.
- `docs/ROUTES.md` — note that the AI Search query box no longer auto-extracts filter chips; chips are click-only.
- `docs/PRODUCT-SERVICES.md` — update the AI Search service description to reflect "semantic intent in, ranked list out, filters are explicit."
- `.env.example` — add any new embedding-model / Haiku rerank env vars introduced.

### 1B. Discovery + Growth silent-failure pattern

All four bugs (#4, Explore, run button enabled, no toast) collapse into one architectural gap: **the edge function returns HTTP non-2xx Responses that the Supabase JS client surfaces as `error: null`, so the UI never sees them.** Fix at both ends.

| Layer | Location | Change |
| --- | --- | --- |
| Edge function | `supabase/functions/agent-scheduler/index.ts:178–191` | Run zombie cleanup (`markZombieRuns`) **before** `enforceManualMinInterval()` so a stale row's timestamp never blocks the new run. |
| Edge function | `agent-scheduler/index.ts:357–381` | When the interval guard genuinely fires, return a structured payload with `status: "rejected", reason: "quota_exhausted"` rather than relying on HTTP 429 — most call-sites only check client error. |
| UI | `Admin.tsx:341–396` (`triggerDiscovery`, `startDiscoveryRun`, `exploreSuggestion`) | Inspect `data?.status` and `data?.reason`; toast success on `running`, toast informative error on `rejected`/`quota_exhausted`. |
| UI | `Admin.tsx:579` | Replace `isRunning={false}` hardcode with a real value sourced from a single `useActiveAgentRun('discovery')` hook (subscribes to `agent_runs` for `pending`/`running`). |
| UI | `DiscoveryPlanningPanel.tsx` prompt textarea | Persist last-submitted prompt to local state (and optionally `localStorage`); only clear on explicit reset. |
| UI | run-history failure banner | Hide failure card from prior run when a newer run has succeeded (mirror SystemHealthPanel logic — see Phase 2). |

**Acceptance**: clicking Run Discovery on a zombie row produces exactly one new run with a "Discovery run started" toast; Explore on every reflection card either starts a run or shows a toast explaining why; button disables for the duration.

**Docs to update**

- `docs/AI-PIPELINE.md` — document the new `agent-scheduler` response envelope (`{ status, reason, run_id, ... }`) and the rule "edge functions signal in the body, not in HTTP status"; document that zombie cleanup runs before the interval guard.
- `docs/RUNBOOK.md` — create the file (referenced in failure UI). One section per `error_kind`: `db_timeout`, `network`, `auth_failed`, `quota_exhausted`, `agent_failure`. Phase 4D otherwise duplicates this — fold it into 1B if 1B ships first.
- `docs/EVALUATION.md` — add a Discovery-flow regression: "zombie row → click Run Discovery → exactly one new run + toast"; "Explore on a recently-run suggestion → toast explains why no run started."
- `docs/PRODUCT-SERVICES.md` — note the in-flight disable + toast contract for staff-facing run buttons.

---

## Phase 2 — Trust the surfaces (rendering + counters + labels)

Phase 1 makes the flows work; Phase 2 makes their output not look broken.

### 2A. Duplicate Flemish Connection render (Person + Org)

Same bug, two surfaces — pull into one component.

- `src/pages/PersonProfile.tsx:1184–1237` renders both chips (1184–1194) and boxed evidence rows (1195–1237) for the same connection list.
- `src/pages/OrganizationProfile.tsx:832–894` is a near-copy.

Fix: extract a single `<FlemishConnectionList>` that renders one row per connection (chip + evidence inline, not duplicated), use on both profiles.

### 2B. Discovery row expansion is dev-facing

`AgentDashboard.tsx:324–333` `STEP_LABELS` map only covers a fixed set; parameterized step IDs (`page_extraction_<uuid>`, `linkedin_enrichment_2`, `frontier_process_<uuid>`) fall through to raw labels at line 385.

- Replace the literal-key map with a `formatStepLabel(stepId)` function that strips trailing `_<uuid>` / `_<n>` suffixes and looks up the prefix.
- `AgentDashboard.tsx:361` — replace `JSON.stringify(v)` with a renderer that unescapes string values for display (still JSON-stringifies non-strings).
- `AgentDashboard.tsx:132` — use `formatCount(r.pages_fetched, 'page', 'pages')` like line 134 already does.

### 2C. Stale failure cards across Discovery and System

- `SystemHealthPanel.tsx:779–790` — render failure banner only when `lastFailure.completed_at > lastSuccess.completed_at` (see review #58).
- Discovery history list — same comparison; the May 8 05:00 PM `db_timeout` card should not float above newer rows.

### 2D. Counters from one source of truth

Cities count is computed three different ways — `Dashboard.tsx:170, 261, 486` and `InteractiveStatsOverview.tsx:315–321`. Pick one (city+state pair, since city alone collapses Cambridge MA + Cambridge UK), expose via a single hook, consume everywhere.

### 2E. Chip taxonomy

`InteractiveStatsOverview.tsx:427–474` builds keys like `sector:biotechnology` while the visible label is the raw TitleCase value. Either show the prefix consistently (`sector: Biotechnology`) or strip it consistently. Pick one.

### 2F. Synthetic seed leakage

`scripts/seed_phase3_search_dataset.ts:320` produces `${firstName} ${lastName} ${index 3-digit}`. These are user-visible (`Charlotte De Smet 051`, `Flanders Company 31`). Either:
- (Preferred) Mark seeded rows with `is_synthetic=true` and hide from non-staff views; OR
- Generate names without a numeric suffix and rely on UUID for uniqueness.

Owner decision needed before implementation.

### 2G. Date formats

Pick one canonical format (`MMM d, h:mm a` is already used widely) and apply via a single `formatDateTime` helper. Replace `5/7/2026`-style renderers in Collections list.

**Docs to update**

- `docs/PRODUCT-SERVICES.md` — record the staff-facing vocabulary decisions that come out of 2B (Discovery step labels) and 2E (chip taxonomy); replace internal jargon (`claimed`, `sitemap`, `rss`, `merged`) with the chosen plain-language terms.
- `docs/AI-PIPELINE.md` — note the new `formatStepLabel` presentation layer between agent telemetry and the panel UI (so future agent steps render cleanly).
- `docs/SCHEMA.md` — only if 2F option 1 is chosen (add `is_synthetic` column to people / organizations).
- `docs/EVALUATION.md` — add a "no synthetic seed names visible to non-staff" check if 2F lands.
- No `ROUTES.md` changes expected.

---

## Phase 3 — Collections correctness

### 3A. `Cannot read properties of undefined (reading 'rest')` crash

The error is leaking from a runtime exception in `suggest-people` → `aiService.ts:369` shape-check. The contract between the edge function's response and `parseCollectionSuggestionPlan` is loose.

- Add an explicit response schema (zod or hand-rolled) in `src/lib/aiService.ts` for `CollectionSuggestionGap`, with safe defaults on every branch.
- Wrap the call site so any thrown JS message is converted into a friendly "Suggestions unavailable — please retry" banner instead of dumping the exception text.
- Add a server-side log of the raw model output when parse fails, so we can diagnose without the user seeing implementation details.

### 3B. Collection scope: enforced or advisory?

The `collections` table (`migrations/20260324000003_create_collections_tables.sql`) has no scope columns; `suggest-people/index.ts:413–722` does not filter candidates by city/state/sector. The "People in Biotech in California and New York" collection contains a Chicago org and a Durham person because **scope is purely advisory text**.

But keep this as is. The collection is made to be used by the user and we wouldn't want to forc the user adding or not adding certain users just they described their scope in a certain way.

**Docs to update**

- `docs/AI-PIPELINE.md` — document the new `suggest-people` response envelope and the rule "edge functions must return validated shapes; UI converts thrown errors into friendly banners, never raw JS messages."
- `docs/PRODUCT-SERVICES.md` — explicitly state that collection scope text is advisory (per the 3B decision); the user is the authority on collection contents.
- No `SCHEMA.md` change (3B option 1 chosen).
- `docs/EVALUATION.md` — add a "no raw JS exception strings reach the UI" check on the suggestions flow.

---

## Phase 4 — Routing, URL state, and docs alignment

### 4A. Sub-tab + map URL state

- `AddContactPanel.tsx:188–196` — local `tab` state never syncs to URL. Wire to `useSearchParams` so `?mode=manual|import|discovery` is the source of truth and deep-links work.
- `Admin.tsx:495` already reads `mode`; pipe it correctly through to `AddContactPanel`.
- `appRouting.ts:140–175` — `buildDashboardSearchParams` writes `people=0`/`organizations=0` but never `=1`, so toggling on→off→on doesn't round-trip. Either always write both states or always omit when default; be symmetric.

### 4B. Header `+` icon

- Add an `aria-label` and visible tooltip ("Add person or organization").
- Confirm the destination after the URL fix in 4A.

### 4C. ROUTES.md vs reality

- Remove the `held-out Discovery Eval panel` claim from `docs/ROUTES.md:11` — the panel was intentionally removed (see git status: `D src/components/admin/DiscoveryEvalPanel.tsx`).
- For `/admin/growth` — decide per panel whether to **build** (source yield, entity pivots, geography gaps, recommended actions) or **drop from docs**. Recommended: drop the unbuilt ones from `ROUTES.md` now and re-add when actually shipped.
- Update `docs/AI-PIPELINE.md` if any growth-panel data flows are removed.

### 4D. RUNBOOK.md

`SystemHealthPanel.tsx:787`, `AgentDashboard.tsx:297`, `StructuredErrorBanner.tsx:27` reference `docs/RUNBOOK.md` which doesn't exist.

- Recommended: create `docs/RUNBOOK.md` with one section per `error_kind` (`db_timeout`, `network`, `auth_failed`, `quota_exhausted`, `agent_failure`). Cheap; staff actually need it.
- Drop the "when available" hedge from the templated string.

### 4E. Page title

`index.html:7` — replace `Flemish Network Navigator Prototype` with `Flemish Network`. Optionally add per-route titles via `useEffect(() => { document.title = ... })` in top-level pages.

**Docs to update**

- `docs/ROUTES.md` — this phase *is* the doc-alignment phase. Strip the stale `DiscoveryEvalPanel` claim, prune the unbuilt `/admin/growth` panels (or move them to a "planned" section), document the `?mode=manual|import|discovery` URL contract for `/admin/discovery`, and document the symmetric map URL state.
- `docs/RUNBOOK.md` — create the file if Phase 1B didn't already (4D). Make sure the failure UI strings match section anchors.
- `docs/AI-PIPELINE.md` — remove references to any growth-panel data flows that are dropped from `ROUTES.md`.
- `docs/PRODUCT-SERVICES.md` — update the page title / product name canonical reference.

---

## Phase 5 — Admin panel polish

### 5A. Access (`/admin/access`)

- `AccessManagementPanel.tsx:313` — Save button: track per-row dirty state by comparing `drafts[user.id]` against the original `staffUsers` row; disable until changed.
- Confirm dialog on Remove already exists (line 148) — verify and remove from the bug list.
- Split the "active" badge from rows that are still `Invited`; render Invited in its own subsection.

### 5B. System (`/admin/system`)

- `SystemHealthPanel.tsx:826–851` — relabel the search-index queue: "N search-index records pending" + tooltip on "Drain now" explaining it flushes the embedding queue.
- `SystemHealthPanel.tsx:508–524` — add `title`/`aria-label` to Run Housekeeping and Test Supabase buttons describing what they do.
- `SystemHealthPanel.tsx:587–593` — hide Apify metrics when `apifyCalls===0 && apifyCredits===0` for >7 days; gate behind `VITE_SHOW_APIFY` for diagnostics.
- Align cadence labels: render Discovery as "Twice daily (09:00 + 21:00 UTC)" and Verification as "Up to 15 contacts/day"; both prefixed with "Schedule:" so the unit shape matches.
- Preset tooltips already exist (`title={PRESET_DESCRIPTIONS[...]}` at line 736) — verify and remove from bug list.

### 5C. Verification (`/admin/verification`)

- `SuggestedChanges.tsx:86–142` — add a destination locale guard: if a Profile Update Suggestion replaces a US person's city with a non-US city, require explicit confirmation (modal, not native `confirm`). The Flemish-network domain assumption is "person of interest is US-based"; suggestions that flip that assumption are high-risk regardless of confidence score.
- `SuggestedChanges.tsx:317–333` — clarify Risk vs Confidence: Risk is field sensitivity, Confidence is evidence strength. Render as `Confidence 90% · Low-risk field` with a single info-tooltip explaining precedence.
- `SuggestedChanges.tsx:336–347` — bio diff: stack vertically (strikethrough above, new value below) instead of side-by-side; full-width is fine for prose.
- `OrganizationSuggestedChanges.tsx:152` — replace `(durable mode)` with plain language or remove the parenthetical.

**Docs to update**

- `docs/PRODUCT-SERVICES.md` — record the staff-facing vocabulary updates (drain semantics, Run Housekeeping / Test Supabase descriptions, schedule-cadence label shape, "(durable mode)" replacement).
- `docs/AI-PIPELINE.md` — note the verification destination-locale guard rule and the Risk-vs-Confidence presentation contract; remove Apify references if 5B drops the metric entirely.
- `docs/ROUTES.md` — refresh `/admin/system` and `/admin/verification` landmark lists if any controls renamed.
- `docs/EVALUATION.md` — add a "non-US city change requires confirmation" check for the verification flow.
- `.env.example` — add `VITE_SHOW_APIFY` if introduced.

---

## Phase 6 — Final consistency pass

Each preceding phase ships its own doc updates (per the rule near the top of this plan). Phase 6 is a short wrap-up, not a deferred docs dump:

- `docs/WEBAPP-MASTERPLAN.md` — log this plan as a completed phase set with dates and outcomes.
- Cross-doc consistency check: `ROUTES.md` claims match the running app; `AI-PIPELINE.md` matches the deployed edge functions; `SCHEMA.md` matches `supabase db diff`; `PRODUCT-SERVICES.md` vocabulary matches what the UI actually says; `RUNBOOK.md` anchors match the failure UI strings; `.env.example` matches the actually-required env vars.
- Verify `MEMORY.md` entries about this work are accurate or pruned.

If a step in Phase 6 finds a doc still drifted, fix it in this phase rather than opening a new one — that's the point of the pass.

---

## Cross-cutting principles surfaced by the review

A few patterns recur across many bugs and are worth treating as durable rules, not one-off fixes:

1. **Edge functions must signal in the body, not in HTTP status.** The Supabase JS client doesn't surface non-2xx as `error`. Always return `{ status, reason, ... }` and let the UI route on the body.
2. **Every action button needs three signals**: started toast, in-flight disable, completed toast or error. Run Discovery, Explore, Drain, Test Supabase, Run Housekeeping, Approve all — none currently have all three.
3. **Counters must come from one place.** Three different "Cities" numbers is a structural problem, not three small bugs.
4. **Doc claims about UI must be CI-checked or pruned.** ROUTES.md drift is a recurring source of "missing" findings; consider a smoke test that asserts each documented route renders the documented landmarks.
5. **Staff are not engineers.** UUIDs in step labels, escaped JSON in inputs, "(durable mode)", "claimed/sitemap/rss" jargon — all leak the implementation. A presentation layer between agent telemetry and the panel UI is the right shape.

---

## Suggested execution order

- Land **Phase 1A + 1B** as one PR series (they're the highest-impact and unblock honest evaluation of the rest).
- Phase 2 in parallel-friendly slices (each subsection 2A–2G is independent).
- Phase 3 after a scope decision (3B).
- Phases 4–6 can interleave; Phase 4D (RUNBOOK) is a quick win.

A phase is complete only when `npm run typecheck`, `npm test`, `npm run build`, and the matching repro snippets pass.
