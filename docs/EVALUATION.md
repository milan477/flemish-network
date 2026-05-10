# AI Evaluation

This project should judge AI quality by evidence and reviewer value, not by how many model calls run or how many candidates are generated.

## Default Discovery Standards

### Valid Flemish / Belgian Tie

Strong evidence:

- Flemish universities: KU Leuven, UGent, VUB, UAntwerp, UHasselt, Vlerick, or other Belgian university.
- Flemish/Belgian research and innovation institutions: imec, VITO, Flanders Make, VIB
- Fellowships and programs: BAEF, Fayat, Belgian American Educational Foundation, Fulbright Belgium
- Flemish government, Flanders Investment & Trade, diplomatic/public-sector roles tied to Flanders or Belgium
- Person-level evidence that someone was born, educated, employed, funded, or institutionally affiliated in Flanders

Weak evidence:

- Vague use of "Belgian" or "Flemish" without tying it to the person
- A page that mentions Belgium/Flanders elsewhere but not as evidence for the candidate
- Event attendance or a one-off mention with no durable network relevance

### Valid US Relevance

Strong evidence:

- Current US job, board role, advisory role, lab, university, company, or organization
- Current US city/state, office, or address
- US-based founder/executive/researcher/faculty/student profile
- Recent or repeated US collaboration
- Past US role that is still useful for network context
- US event/speaker role with substantive professional relevance

Weak evidence:

- One old US event with no current tie
- US mention only in a generic page template or search snippet
- US connection cannot be traced to the person

### Valid Organization Discovery

Include organizations with direct evidence for at least one of these patterns:

- Belgian or Flemish companies with US offices, factories, labs, accelerators, partner sites, event sites, or active US expansion targets.
- US organizations connected to Flanders through partnerships, investment, research collaboration, trade access, or institutional programs.
- Chambers of commerce, trade offices, consulates, economic development agencies, accelerators, universities, labs, funds, and institutional connectors that help the Flanders-US network.
- US-based organizations whose description, programs, portfolio, or leadership show concrete Flemish or Belgian relevance.

Reject organizations when the only evidence is ordinary employment of one Flemish-connected person, generic directory text, a one-off mention, weak search-result snippets, or unverifiable strategic relevance.

## Discovery Evaluation

Question: does discovery find real, relevant people with reviewable evidence?

Human scoring rubric:

- **Accept:** named person, plausible US relevance, explicit Flemish/Belgian evidence, useful source URL.
- **Merge:** real relevant person already in `people`, new evidence improves the record.
- **Reject:** no Flemish/Belgian tie, no US relevance, stale/unsupported evidence, organization-only result, or obvious duplicate.
- **Needs tuning:** repeated low-value domains, generic queries, missing evidence excerpts, many candidates with only weak snippets.

Quality gates before autonomy:

- Most approved candidates have evidence that explains both the Flemish/Belgian tie and US relevance.
- Duplicate rate is low enough that reviewers are not spending most time merging.
- Frontier/planning actions produce new useful pages, not repeated versions of the same query.
- Discovery never auto-promotes to `people` or `organizations`; it creates pending review work.
- Manual intake and imports never auto-promote to `people` or `organizations`; row-level validation blocks malformed contact fields, malformed URLs, organization rows without evidence, and partial US location evidence before pending candidates are created.
- Import preview shows the mapped row columns in a horizontally scrollable table, truncating long bios, and successful imports refresh the pending review queues immediately.
- Organization candidates are promoted only through explicit reviewer approval or merge, with source URLs and evidence excerpts visible in review.
- Active UI source must not call retired Discovery endpoints or retired `ai-agent` Discovery tasks; prompted Discovery runs only through `agent-scheduler`.

### Reject-reason taxonomy

Every rejected `discovered_contacts` and `discovered_organizations` row should carry a structured `reject_reason`:

- `discovered_contacts`: `not_flemish`, `walloon_or_francophone`, `not_us_based`, `duplicate`, `insufficient_evidence`, `low_signal`, `other`.
- `discovered_organizations`: `not_flemish_relevant`, `not_us_present`, `duplicate`, `insufficient_evidence`, `low_signal`, `other`.

Optional `reject_reason_note` captures freeform context. Reject reasons drive the per-query `rejected_reason_breakdown` in `discovery_query_attempts` and are used by later phases to score arms in the bandit allocator. Quality gate: `reject_reason = 'not_flemish'` rate must trend below 15% of pending candidates.

### Per-query yield logging

`agent-discovery` writes one `discovery_query_attempts` row per `searchWeb` call, capturing `query_text`, `source_type`, `pivot_entity_key`, `provider`, `surface`, `lens`, `composition_keys`, and `urls_returned`. After the run completes, `resolve_discovery_query_attempts(run_id)` joins frontier → pages → evidence → contacts to populate `pages_fetched`, `candidates_extracted`, `new_pending_contacts`, `contacts_later_approved`, `contacts_later_rejected`, and `rejected_reason_breakdown`.

### Reflection loop quality gates (Phase 4)

The reflection loop (`agent-discovery-reflect`) must satisfy these invariants:

- **Daily cadence:** `agent-scheduler` housekeeping must trigger `agent-discovery-reflect` at most once per 24 hours. The check is: no `discovery_reflection_suggestions` row with `generated_at >= now() - 24h` exists.
- **Minimum suggestions:** each successful reflection run must write ≥ 3 rows to `discovery_reflection_suggestions`. Runs that write 0 are acceptable when Gemini fails, but zero-write runs should appear in logs and not prevent the next day's run.
- **Bandit integration:** exploration slots must consume reflection suggestions before falling back to untried arms. After a slot uses a suggestion, `consumed_attempt_count` on that row must be incremented within the same allocation call.
- **Source tagging:** query attempts generated from reflection-driven exploration slots must carry `source_type = 'reflection'` in `discovery_query_attempts`. At least 1 in 5 discovery runs should surface a candidate whose first-touching query had `source_type = 'reflection'` (whole-system acceptance criterion).
- **TTL enforcement:** expired suggestions (`expires_at <= now()`) must never appear in bandit exploration slots.
- **Coverage broadening signal:** the reflection function should propose surfaces/lenses that differ from the current arm with the highest `contacts_approved`. If all suggestions are `faculty_page × alumni_network`, the prompt or population data is too shallow — this is a tuning issue.
- **Admin visibility:** staff can see the latest population summary (sector/state/career-stage counts) and all active suggestions in the Reflection section of `/admin/growth → Discovery Planning`.

### Pivot quality gates (Phase 5)

Phase 5 adds validation, saturation, multi-hop, and composition to entity pivots. The following invariants must hold:

- **Validation filter:** no pivot with `validation_score < 0.5` may appear in the active rotation loaded by `loadEntityPivots`. After `upsertEntityPivots` runs on a new pivot, the row must have `validation_score IS NOT NULL` and `validation_at IS NOT NULL`. A pivot rejected by validation stays in the table (for audit) but never generates query plans.
- **Validation fallback:** if Gemini fails during `validatePivot`, the fallback score of `0.5` is used and `validation_rationale = 'validation_failed'`. This keeps the run progressing without silently discarding pivots.
- **Saturation cooldown:** pivots used in discovery runs where zero new people are approved (rolling window older than 7 days) must acquire `saturation_cooldown_until = now() + 30 days`. `loadEntityPivots` must skip any pivot where `saturation_cooldown_until > now()`. Cooldown clears when the pivot yields new approvals.
- **Multi-hop tagging:** query attempts generated from multi-hop employer expansion must carry `source_type = 'multi_hop'` in `discovery_query_attempts`. At least 1 in 5 discovery runs (over time as the approved-people population grows) should surface a candidate whose first-touching query had `source_type = 'multi_hop'`.
- **Composition pivot creation:** after 4+ approved people share a (sector, state) combination, `buildCompositionPivots` (called weekly from `agent-scheduler` housekeeping) must create or update a `discovery_composition_pivots` row with `pivot_type = 'sector_geo_cluster'`. Discovery runs after that must include at least one `source_type = 'composition'` query attempt.
- **Composition freshness:** `buildCompositionPivots` is gated on a 7-day freshness check (skipped if any `discovery_composition_pivots` row has `updated_at >= now() - 7 days`). First run after 7 days must upsert.

### Bandit allocator quality gates (Phase 3)

The Thompson-sampling bandit allocator (`supabase/functions/_shared/banditAllocator.ts`) is subject to the following invariants. Violations are regressions:

- **Exploration reserve:** at least `Math.ceil(budget * 0.25)` slots in every non-custom-query run must have `is_exploration = true` in the `bandit_allocation` step logged to `agent_runs.results.steps`.
- **Budget diversification:** no single `(surface, lens)` arm may consume > 25% of total query budget over any rolling 7-day window. Monitor via `discovery_arm_stats.attempts` relative to the sum across all arms.
- **Saturation enforcement:** any arm with `cooldown_until > now()` must not appear in the allocated slots for that run.
- **Saturation trigger:** arms with `last_yielding_attempt_at` older than 7 days (or null) and `attempts >= 3` must acquire `cooldown_until = now() + 7 days` in `discovery_arm_stats` within one housekeeping cycle.
- **Nightly refresh:** `agent-scheduler` housekeeping must call `refreshArmStats` and return a non-null `arm_stats_refreshed` count. Zero arms refreshed after ≥ 1 discovery run is a defect.

## Verification Evaluation

Question: are suggestions correct, evidence-backed, and conservative?

Human scoring rubric:

- **Correct:** suggested value is true and supported by the displayed evidence.
- **Wrong:** suggested value is false or belongs to another person.
- **Unsupported:** suggestion might be true, but evidence does not prove it.
- **Too risky:** suggestion should stay in review even if likely true.
- **Missed:** source clearly shows an update, but no suggestion was produced.


Severe mistakes:

- Suggestion belongs to a different person.
- Suggestion says someone left the US or is no longer relevant without strong evidence.
- Suggestion overwrites a good current role with stale data.
- Suggestion invents or overstates a Flemish/Belgian tie.
- Durable suggestion has no source URL, evidence, method, or clear provenance.

Flemish/Belgian fact quality gate: accepted Discovery or verification facts must resolve to a canonical entity or reviewed alias. Uncertain raw phrases should stay as evidence or pending aliases instead of becoming default filter chips.

## Collection Suggestion Evaluation

Question: does Build A Collection produce useful draft candidates from existing approved records without changing the database until staff approve them?

Human scoring rubric:

- **Accept:** existing person or organization clearly fits the collection goal, with a useful reason and enough snippet/source context for staff review.
- **Reject:** candidate is off-topic, weakly related, duplicate, already in the collection, or based on a missing-database assumption rather than an approved record.
- **Needs Discovery:** the prompt points to a plausible coverage gap that should be expanded through Discovery, not hidden collection generation.
- **Needs tuning:** parser searches are too broad, reranking favors generic matches, rejected candidates reappear before reset, or organization candidates crowd out stronger people matches without rationale.

Quality gates:

- Suggestions are draft-only until staff approve them.
- Mixed people and organization suggestions use `entity_type` and save through exactly one `person_id` or `organization_id`.
- Rejected candidates stay suppressed in the current draft until reset or undo.
- Collection detail drafts survive route revisits in browser storage and can be refreshed or reset explicitly.
- Suggestion clicks on collection detail open an in-place profile preview before any full-profile navigation.
- Existing collection members and draft exclusions are not re-suggested.
- Reranking never introduces IDs outside the retrieved candidate set.
- Discovery handoff only pre-fills `/admin/discovery?prompt=...`; it does not start `agent-scheduler`.

Phase 4 acceptance criteria:

- `suggest-people` is described to users and docs as collection suggestions, while the deployed function name remains unchanged.
- Organization candidates come from approved organization lexical, vector, and text-chunk retrieval when embeddings are available.
- Collection prompts may produce a Discovery handoff, but Phase 4 does not add autonomous Discovery, persistent gap analytics, or persistent draft tables.
- Collection organization retrieval uses canonical organization Flemish/Belgian facts when available; durable organization verification remains a later record-level verification phase.
- Collection scope text is advisory: candidates outside the user-described scope (city, state, sector) are not auto-filtered; the user is the authority on collection contents.

Phase 3A / 5C UX acceptance:

- **No raw JS exception strings reach the UI.** When `suggest-people` returns a malformed payload or any call site throws, both `CollectionModal` and `CollectionDetail` show the fixed banner "Suggestions unavailable — please retry." The string `Cannot read properties of undefined` must not be visible to staff under any failure mode.
- **Server-side raw model logging.** When the `suggest-people` plan or rerank parser throws, the function logs the raw model output (truncated) so failures are diagnosable from edge logs without leaking detail to staff.
- **Non-US city change requires confirmation.** In `/admin/verification`, approving a `location_city` or `location_state` Profile Update Suggestion whose destination state is not a US state must open an in-app confirmation modal (never `window.confirm`). Cancelling leaves the suggestion pending.
- **Risk vs Confidence are presented together.** Each suggestion chip in the Verification panel renders as `Confidence X% · <Risk> field` with a tooltip explaining that Confidence is evidence strength and Risk is field sensitivity. The two values are never shown as unlabeled separate chips.
- **Bio diff is vertical.** Bio Profile Update Suggestions render the current value (struck through) above the new value, full width — never side-by-side.

## Planning / Next Searches Evaluation

Question: are recommended next searches specific, evidence-based, and likely to improve coverage?

Score each recommended action:

- **Specificity:** points at a metro, domain, source family, sector, or entity pivot.
- **Novelty:** avoids domains and queries already exhausted.
- **Evidence basis:** comes from a coverage gap, proven domain, or evidence-backed entity pivot.
- **Actionability:** an operator understands why it is being recommended.
- **Yield:** after running, it creates useful frontier pages or candidates.
- **Diversity:** not all recommendations repeat one source family or city.

Good recommendation examples:

- Expand Boston biotech domains from approved KU Leuven profiles.
- Run BAEF/Fayat seed domains for New York using the `alumni_network` lens.
- Follow an imec-linked startup entity pivot into California team and advisory-board pages.
- Revisit a proven university/lab domain with remaining weekly budget and recent yield.

Bad recommendation examples:

- "Belgian people in Boston"
- "Flemish professionals USA"
- Repeated searches for an already exhausted domain
- Broad open-web searches that do not name a source family, geography, sector, domain, or entity pivot

## Search The Network (search-people) regression suite

UX_REMEDIATION Phase 1A replaced the natural-language filter parser with a
two-stage pipeline (hybrid retrieval + Gemini rerank). Every reproduction
snippet from `docs/plans/UX_REVIEW_2026-05-08.md` must produce sensible top-3
results without surprise filtering.

Required passing snippets (run via `/?q=<query>` against the deployed
`search-people` function):

- `Flemish people working in biotech in Boston` — top hits are Boston / Cambridge MA people; no Indiana misfire; no auto-populated chips.
- `KU Leuven alumni in healthcare` — KU Leuven matches; no stale chips dragged in from a prior search.
- `founders in Indianapolis` — Indianapolis-located people if any exist, otherwise a clean "loose match" list with the Stage-1 fallback rationale.
- `Belgian founders in SF` — San Francisco / Bay Area people.
- `Boston, MA biotech` — Boston biotech people; the spelled-out "Massachusetts" must not be required to match `MA` rows (covered by `expand_us_state` in migration `20260509000000`).
- `AI researchers in Atlanta` — Atlanta AI people surfaced first.

Latency gates:

- p95 time-to-Stage-1 result < 1 s at the current dataset size (~1000 people, ~1000 organizations).
- p95 time-to-reranked result < 12 s; on timeout the response carries `rerank_status = "timeout"` and the UI keeps Stage 1 ordering rather than failing.

Behavior gates:

- The query box never auto-extracts filter chips. `src/lib/filterParser.ts` is deleted; any reintroduction must be reviewed against this section.
- A search response always includes `rerank`, `rerank_status`, `rerank_model`, and `rerank_duration_ms` so the UI can label loose-match results when Stage 2 did not run.
- Structured-criteria coverage is a soft boost only; it must never zero out a candidate. The Stage 2 model decides relevance.
