# Discovery Redesign — Surface × Lens, Bandit Allocator, Reflection Loop

This document is the implementation plan for redesigning the discovery agent so it (a) finds *new* people, not just more of the same, and (b) actively explores beyond its current basin of attraction.

The webapp is in full development mode. There is **no backwards-compatibility requirement**. Each phase is allowed to break callers, and the final phase removes everything that the new system replaces. Treat this as a clean redesign, not a layered migration.

## Why This Exists

The current discovery agent has a feedback loop that biases toward easy academic targets:

- 5 hand-curated source packs (`baef_fellows`, `flemish_universities`, `imec_and_flemish_orgs`, `labs_and_research_groups`, `events_and_associations`) with hardcoded query templates.
- Pivots are extracted via regex from already-fetched pages, then queried with the same template shapes (`"<entity>" alumni United States`).
- Coverage gaps are computed from the existing network, so they only describe holes within the basin.
- Yield is tracked at domain level, not at query-strategy level.
- There is no held-out evaluation set — there is no way to know whether the agent is actually finding people we don't already have.

Result: PhDs and postdocs from KU Leuven and BAEF are exhaustively mapped. US-based business professionals (Belgian-American Chamber, Belgian-founded US companies, Vlerick MBAs in finance, etc.) are barely sampled.

## Target Architecture

Five concepts replace the source-pack-and-template system:

1. **Surfaces** — page types: `linkedin_profile`, `faculty_page`, `lab_roster`, `company_team`, `board_of_directors`, `news_article`, `press_release`, `podcast_transcript`, `conference_speakers`, `alumni_magazine`, `op_ed`, `crunchbase_profile`, `university_news`, `fellowship_announcement`, `embassy_event`, `substack_post`, `wikipedia`, `chamber_directory`, `trade_mission_roster`.
2. **Lenses** — signal angles: `named_entity`, `surface_phrase`, `nationality_role`, `sector_geo`, `alumni_network`, `company_affiliation`, `event_participation`.
3. **Universal Gemini-Flash query generator** — every query (custom, pivot, exploration) is generated from a `(surface, lens, context)` tuple. No hand-written templates anywhere.
4. **Bandit allocator** — each `(surface, lens)` cell is an arm with a yield estimate. Budget is allocated by UCB/Thompson sampling. 20-30% reserved for exploration.
5. **Reflection loop** — periodic Gemini call that inspects the approved-people population and proposes missing surfaces/lenses, feeding new exploration arms.

Around these:

- **`discovery_query_attempts`** logs every query with downstream yield.
- **`discovery_eval_holdout`** holds a set of known Flemish people who are *excluded* from the network so we can measure recall.
- **Reject-reason taxonomy** on `discovered_contacts` makes human review feedback structured.
- **Pivot validation, saturation, multi-hop expansion, composition** make pivots actually useful.
- **Domain reputation feedback** closes the loop from yield back into query generation.

## Goals

- Held-out recall ≥ 50% within 6 weeks of deploy. (Of a held-out set of known Flemish-Americans, the agent surfaces at least half as candidates within 30 days.)
- New-approved-people-per-run trend stays flat or grows over time, instead of decaying as the basin saturates.
- No `(surface, lens)` arm consumes more than 25% of total query budget over any 7-day window — diversification enforced by allocator.
- Reject-reason `not_flemish` rate falls below 15% of pending candidates.

## Non-Goals

- Person-to-person graph features (out of product scope, see `WEBAPP-MASTERPLAN.md`).
- Replacing the extraction or classification LLM steps. This redesign is about *what to fetch*, not how to read it.
- Multi-tenant or per-staff-user discovery. The agent operates on the global network.

## How To Use This Plan

Each phase below is self-contained and can be handed to an agent. The brief includes goal, scope, schema changes, code changes, subagent suggestions, verification, doc updates, and a definition of done.

Agents implementing a phase **must**:

- Read this file plus `CLAUDE.md`, `docs/AI-PIPELINE.md`, `docs/SCHEMA.md`, and `docs/EVALUATION.md` first.
- Apply migrations to the linked Supabase project (`ofzuhajxwxggybkuzefq`) with `supabase db push --linked` and deploy edge functions with `supabase functions deploy <name> --project-ref ofzuhajxwxggybkuzefq` in the same session.
- Update every doc the phase touches before handing off (`docs/SCHEMA.md`, `docs/AI-PIPELINE.md`, `docs/EVALUATION.md`, `docs/ROUTES.md` as relevant).
- Run `npm run typecheck`, `npm test`, `npm run test:deno`, `npm run lint`, `npm run build` per the change scope.
- Mark the phase checklist below with `[x]` when done.
- **Not** preserve any deprecated tables, columns, functions, or code paths. The cleanup phase will assert their absence; do the deletes inline when a phase replaces something.

Subagents are encouraged for parallel work (schema + edge function + UI) and for adversarial review.

---

## Phase Status

- [x] **Phase 0** — Foundations: reject reasons, held-out eval set, query-attempts table.
- [x] **Phase 1** — Universal Gemini-Flash query generator.
- [ ] **Phase 2** — Surfaces × Lenses taxonomy and seed-domain refactor.
- [x] **Phase 3** — Bandit allocator with exploration reserve.
- [ ] **Phase 4** — Reflection loop and missing-bucket detection.
- [ ] **Phase 5** — Pivot upgrades: validation, saturation, multi-hop, composition.
- [ ] **Phase 6** — Domain reputation feedback into query generation.
- [ ] **Phase 7** — Cleanup and deprecation sweep.

---

## Phase 0 — Foundations

**Goal.** Build the measurement substrate. Without these, every later phase is a vibes-based guess.

**Scope (in).**

- Reject-reason taxonomy on `discovered_contacts` and the human review UI.
- Held-out evaluation set: a `discovery_eval_holdout` table plus a nightly check that measures recall.
- `discovery_query_attempts` table that logs every query the agent issues and joins downstream yield.

**Scope (out).** Anything that *uses* the new tables. Phase 0 only writes them and starts populating.

**Schema (new migration).**

```sql
-- Reject reasons
ALTER TABLE discovered_contacts
  ADD COLUMN reject_reason text
    CHECK (reject_reason IN (
      'not_flemish', 'walloon_or_francophone', 'not_us_based',
      'duplicate', 'insufficient_evidence', 'low_signal', 'other'
    )),
  ADD COLUMN reject_reason_note text;

ALTER TABLE discovered_organizations
  ADD COLUMN reject_reason text
    CHECK (reject_reason IN (
      'not_flemish_relevant', 'not_us_present', 'duplicate',
      'insufficient_evidence', 'low_signal', 'other'
    )),
  ADD COLUMN reject_reason_note text;

-- Held-out evaluation set
CREATE TABLE discovery_eval_holdout (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  known_aliases text[] DEFAULT '{}',
  known_employer text,
  known_city text,
  known_state text,
  flemish_signal text NOT NULL,
  source_note text,
  added_at timestamptz NOT NULL DEFAULT now(),
  added_by uuid REFERENCES auth.users(id),
  last_seen_as_candidate_at timestamptz,
  last_seen_candidate_id uuid REFERENCES discovered_contacts(id) ON DELETE SET NULL,
  last_seen_run_id uuid REFERENCES agent_runs(id) ON DELETE SET NULL
);

-- Query attempt log
CREATE TABLE discovery_query_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  surface text,                          -- nullable until Phase 2
  lens text,                             -- nullable until Phase 2
  composition_keys text[] DEFAULT '{}',  -- e.g. ['sector:biotech', 'geo:MA']
  query_text text NOT NULL,
  source_type text NOT NULL,             -- custom_query | source_pack | entity_pivot | exploration | reflection
  source_pack_key text,
  pivot_entity_key text,
  provider text,
  urls_returned int DEFAULT 0,
  pages_fetched int DEFAULT 0,
  candidates_extracted int DEFAULT 0,
  new_pending_contacts int DEFAULT 0,
  contacts_later_approved int DEFAULT 0,
  contacts_later_rejected int DEFAULT 0,
  rejected_reason_breakdown jsonb DEFAULT '{}',
  cost_estimate_usd numeric(10,4) DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX idx_query_attempts_surface_lens ON discovery_query_attempts (surface, lens);
CREATE INDEX idx_query_attempts_run ON discovery_query_attempts (run_id);
```

RLS: staff-only read on all three tables.

**Code changes.**

- `agent-discovery/index.ts`: insert one `discovery_query_attempts` row per `searchWeb` call. Surface and lens columns stay null until Phase 2 wires them in. Update the row's downstream counters in the same run when persistence completes (`new_pending_contacts`, `candidates_extracted`).
- A nightly job (new edge function `eval-holdout-check` or a cron in `agent-scheduler`) that for each `discovery_eval_holdout` row queries `discovered_contacts` for fuzzy name matches in the last 30 days and updates `last_seen_*`.
- New admin UI panel `src/components/admin/DiscoveryEvalPanel.tsx` showing held-out recall percentage, list of holdout rows with current status, and an "add holdout person" form.
- Reject-reason dropdown added to the discovered-contact and discovered-organization review actions in `src/components/admin/`. Existing `Reject` button becomes `Reject with reason …` with a structured menu.
- Backfill: pick 30-50 known Flemish-Americans from Delegation contacts and seed `discovery_eval_holdout`. List them in the Phase 0 PR description; do not commit private contact info to the migration itself — load via a one-off seed script that reads from a local file.

**Subagent suggestions.**

- One subagent on the migration + RLS + Deno tests for the new tables.
- One subagent on the admin UI changes (reject reasons + eval panel).
- One subagent on the nightly eval job and its smoke test.

**Verification.**

- `npm run typecheck`, `npm test`, `npm run test:deno`, `npm run build`, `npm run lint` all pass.
- Migration applied on linked Supabase. `select count(*) from discovery_query_attempts` returns rows after triggering one discovery run.
- Reject a candidate in the admin UI with each reason; confirm column populated.
- Trigger the nightly eval job manually; confirm `last_seen_candidate_id` populated for any holdout person currently in `discovered_contacts`.

**Docs to update.**

- `docs/SCHEMA.md` — add the three new tables and the two new columns.
- `docs/EVALUATION.md` — document the held-out recall metric, the reject-reason taxonomy, and the success thresholds.
- `docs/AI-PIPELINE.md` — note that all queries now log to `discovery_query_attempts`.
- `docs/ROUTES.md` — add the new admin eval panel.

**Definition of done.**

- All five tables/columns exist on the linked Supabase project.
- The next discovery run produces ≥ 1 row in `discovery_query_attempts` per query issued.
- Admin reviewers can reject with a reason and the reason is queryable.
- A held-out set of ≥ 30 people exists and the nightly job runs without error.
- All five docs updated.

---

## Phase 1 — Universal Gemini-Flash Query Generator

**Goal.** Replace every hand-written query template (Mode A 3-variant, source-pack `query_templates`, `buildPivotSeedQueries`) with a single Gemini-Flash-backed generator parameterized by `(surface?, lens?, context)`.

**Scope (in).**

- New helper `generateSearchQueries({ intent, surfaces?, lenses?, context, runId })` in `supabase/functions/_shared/queryGeneration.ts`.
- Wire it into Mode A (`buildSeedPlans` custom-query branch around `agent-discovery/index.ts:2051`).
- Wire it into pivot seeding (`buildPivotSeedQueries` callers around line 986). Delete `buildPivotSeedQueries`.
- Wire it into source-pack expansion (`buildSeedPlans` source-pack branch). Source-pack `query_templates` column becomes unused; remove it in this phase's migration.

**Scope (out).** Surfaces and lenses are not yet a typed enum (Phase 2). For now the helper accepts free-form strings and the callers pass null.

**Helper contract.**

```ts
type QueryGenerationInput = {
  intent: string;                      // user query, pivot description, or pack lane
  surfaces?: string[];                 // optional hints
  lenses?: string[];                   // optional hints
  context?: {
    knownEntities?: string[];          // KU Leuven, imec, BAEF, ...
    coverageGapLabel?: string;
    coverageGapSector?: string;
    avoidQueryShapes?: string[];       // hard negatives
    rotationSeed?: string;             // runId
  };
  maxQueries?: number;                 // default 6
};

type GeneratedQuery = {
  query: string;
  surface: string | null;
  lens: string | null;
  rationale: string;
};

function generateSearchQueries(input: QueryGenerationInput): Promise<GeneratedQuery[]>;
```

**Prompt requirements (system prompt).**

- Generate 4-6 semantically distinct queries; each probes a different angle.
- Use proper boolean operators with parentheses: `(Belgian OR Flemish OR "from Ghent" OR "from Antwerp" OR "from Leuven")`.
- Quote multi-word entities and place names.
- Use `site:` operators for likely high-yield domains when a surface is hinted.
- Include surface-form variants ("from Ghent", "born in Antwerp", "PhD KU Leuven", "Belgian-born") alongside abstract labels.
- Reference canonical Flemish entities only when relevant to the intent.
- Avoid query shapes listed in `context.avoidQueryShapes`.
- Use `context.rotationSeed` to vary across runs of the same intent.

**Schema (migration).**

```sql
ALTER TABLE discovery_source_packs DROP COLUMN query_templates;
ALTER TABLE discovery_entity_pivots DROP COLUMN seed_queries;
```

The seed-query strings are no longer stored; they're generated per run.

**Code changes.**

- New `_shared/queryGeneration.ts`. Use the existing Gemini client and `getGeminiModelChain`. Add a `query_generation` route defaulting to `gemini-2.5-flash-lite`.
- Use structured output: `{ queries: [{ query, surface, lens, rationale }] }`.
- Fallback: on Gemini timeout/error, log to run telemetry and produce a single query: `"<intent> (Belgian OR Flemish) United States"` with `surface=null, lens=null`. Do **not** restore the old 3-variant logic.
- Delete `buildPivotSeedQueries` (around line 986) and the 3-variant string concat in `buildSeedPlans` (around line 2051).
- Each generated query writes a `discovery_query_attempts` row immediately on issue.

**Subagent suggestions.**

- One subagent drafts the system prompt and JSON schema and writes Deno tests with mocked Gemini responses covering: well-formed output, malformed output (fallback), timeout (fallback), avoid-shape compliance.
- One subagent does the call-site refactor and removes dead code.

**Verification.**

- Trigger a discovery run with a custom query; inspect `discovery_query_attempts` to confirm 4-6 well-formed queries with proper boolean syntax and quoted entities.
- Trigger a second run with the same query; confirm queries differ (rotation works).
- Confirm `buildPivotSeedQueries` is gone (`grep -r buildPivotSeedQueries supabase/functions/` returns empty).
- Confirm `query_templates` and `seed_queries` columns are gone.

**Docs to update.**

- `docs/AI-PIPELINE.md` — document the `query_generation` route, the helper contract, fallback behavior, and removal of hand-written templates.
- `docs/SCHEMA.md` — drop the two columns.

**Definition of done.**

- All search queries flow through `generateSearchQueries`.
- No hand-written template strings remain in `agent-discovery/index.ts` or migrations.
- Telemetry shows generated queries are diverse, quoted, and properly grouped.

---

## Phase 2 — Surfaces × Lenses Taxonomy [x] Done 2026-05-08

Migration `20260508000012_phase2_surfaces_lenses_taxonomy.sql` applied to project `ofzuhajxwxggybkuzefq`. `agent-discovery` and `agent-scheduler` redeployed. Seeded 24 surfaces (the original 19 plus `sec_filing`, `awards_page`, `patent_filing`, `nonprofit_filing`, `obituary_wedding`), 7 lenses, and 30 seed domains spanning Flemish academic, US-side institutional, Belgian-founded US-active companies (UCB, Materialise, argenx, Galapagos, AB InBev, Bekaert, Atlas Copco, Ontex), and US public-records/business-journalism (sec.gov, ProPublica Nonprofit Explorer, bizjournals.com, biospace.com, fiercebiotech.com).


**Goal.** Make surface and lens first-class typed concepts with their own tables, and refactor source packs into a slim domain-whitelist + surface/lens-tag model.

**Scope (in).**

- New tables `discovery_surfaces`, `discovery_lenses`, `discovery_seed_domains`.
- Source-pack data migrated into the new shape.
- `discovery_source_packs` table dropped at the end of this phase.
- `(surface, lens)` columns on `discovery_query_attempts` become non-null going forward (typed against the new tables via FK or check constraint).
- Query generator now takes typed `surface`/`lens` enums and returns a typed `surface`/`lens` per query.
- Composition: the generator can take 2-3 axes (surface + lens + sector + geo) and produce intersection queries.

**Scope (out).** The bandit allocator (Phase 3). For now, surface/lens selection inside `buildSeedPlans` can be round-robin or weighted by hand.

**Schema (migration).**

```sql
CREATE TABLE discovery_surfaces (
  key text PRIMARY KEY,                 -- linkedin_profile, faculty_page, ...
  name text NOT NULL,
  description text,
  example_url_patterns text[] DEFAULT '{}',
  preferred_site_operators text[] DEFAULT '{}',  -- e.g. ['site:linkedin.com/in']
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE discovery_lenses (
  key text PRIMARY KEY,                 -- named_entity, surface_phrase, ...
  name text NOT NULL,
  description text,
  prompt_guidance text,                 -- what the generator should emphasize
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE discovery_seed_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain text NOT NULL UNIQUE,
  surfaces text[] NOT NULL DEFAULT '{}',  -- which surfaces this domain hosts
  lenses text[] NOT NULL DEFAULT '{}',    -- signal lenses this domain supports
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE discovery_query_attempts
  ADD CONSTRAINT discovery_query_attempts_surface_fk
    FOREIGN KEY (surface) REFERENCES discovery_surfaces(key) ON UPDATE CASCADE,
  ADD CONSTRAINT discovery_query_attempts_lens_fk
    FOREIGN KEY (lens) REFERENCES discovery_lenses(key) ON UPDATE CASCADE;

DROP TABLE discovery_source_packs CASCADE;
```

**Seed data (in the same migration).** Seed `discovery_surfaces` with the full list from the Target Architecture section. Seed `discovery_lenses` with the seven lens types. Seed `discovery_seed_domains` with: `kuleuven.be`, `ugent.be`, `vub.be`, `uantwerpen.be`, `imec-int.com`, `imec.be`, `baef.be`, `linkedin.com`, `crunchbase.com`, plus US-side high-value domains like `belcham.org` (Belgian American Chamber of Commerce), `flandersinvestmentandtrade.com`, `vlerick.com`, `solvay.edu`. Tag each with the appropriate surfaces and lenses. **Add the missing professional domains the user flagged**: UCB US, Materialise US, Argenx US, Galapagos US, Anheuser-Busch InBev, Bekaert US, Atlas Copco US, Ontex US.

**Code changes.**

- `agent-discovery/index.ts`: load surfaces, lenses, seed domains at run start. Replace the `loadSourcePacks` flow.
- `buildSeedPlans` becomes `buildQueryPlans(surfaces, lenses, domains, gaps, pivots, runId)`. It picks `(surface, lens)` pairs (round-robin or simple weighting; the bandit comes in Phase 3) and calls `generateSearchQueries` for each pair with the relevant `domain` hint as `preferred_site_operators`.
- Composition: when a coverage gap or pivot supplies sector/geo context, pass it as a third axis and ask the generator for intersection queries.
- Remove the `loadSourcePacks` function and all references to `discovery_source_packs`.
- UI: `src/components/admin/DiscoveryPlanningPanel.tsx` shows surface/lens coverage instead of source packs. Operators can toggle surfaces/lenses active.

**Subagent suggestions.**

- One subagent on the migration + seed data + a `staffOnly` admin UI to inspect surfaces/lenses/domains.
- One subagent on the `buildQueryPlans` refactor and removal of source-pack code paths.
- One subagent acting as devil's advocate: review the seed-domain list for bias, missing surfaces, and US-business-professional coverage gaps.

**Verification.**

- `select count(*) from discovery_source_packs` errors with "table does not exist".
- A discovery run produces query attempts with non-null `surface` and `lens` matching seeded enum values.
- The DiscoveryPlanningPanel renders the new taxonomy.
- The seed-domain list visibly includes ≥ 5 non-academic professional domains (chambers, Belgian-founded US companies, business schools).

**Docs to update.**

- `docs/SCHEMA.md` — replace `discovery_source_packs` section with `discovery_surfaces`, `discovery_lenses`, `discovery_seed_domains`. Add the FKs on query attempts.
- `docs/AI-PIPELINE.md` — replace the source-pack section with the surface/lens model. Document composition behavior.
- `docs/ROUTES.md` — note the DiscoveryPlanningPanel changes.
- `docs/PRODUCT-SERVICES.md` — only if user-facing vocabulary in `/admin/growth` changes.

**Definition of done.**

- `discovery_source_packs` is gone.
- All query attempts since deploy have non-null typed surface and lens.
- Seed-domain list includes professional surfaces (chambers, companies, business schools), not only academic.

---

## Phase 3 — Bandit Allocator [x] Done 2026-05-08

Migration `20260508000013_phase3_bandit_allocator.sql` applied to project `ofzuhajxwxggybkuzefq`. `agent-discovery` and `agent-scheduler` redeployed. `discovery_arm_stats` table and `discovery_arm_stats_recent` view live. `banditAllocator.ts` implements Thompson sampling with 25% exploration reserve, cooldown/saturation, and nightly `refreshArmStats` via housekeeping. Admin heatmap added to `DiscoveryPlanningPanel`.

**Goal.** Replace static priority ranking with a multi-armed bandit that allocates the run's query budget across `(surface, lens)` arms, with a hard exploration reserve.

**Scope (in).**

- New table `discovery_arm_stats` aggregating yield per `(surface, lens)` and per arm sub-context (e.g., per sector, per geo).
- A scheduled job that recomputes arm stats from `discovery_query_attempts` (every hour or after every run).
- Allocator function in `_shared/banditAllocator.ts` implementing Thompson sampling over Beta priors on `contacts_later_approved / candidates_extracted`. Penalize by `rejected_reason='not_flemish'` rate. Reward novelty (`new_pending_contacts` after dedup against approved network).
- 25% exploration reserve: every run reserves at least 1 of 6 query slots for an arm with no recent attempts, OR for an LLM-generated wild-card query that bypasses the bandit entirely.
- Saturation detection: if an arm's rolling window shows `new_pending_contacts == 0` for 3 consecutive runs, suppress it for 7 days (cooldown).

**Scope (out).** Reflection loop (Phase 4) generates the wild-card prompts; for Phase 3 the wild-card slot uses a simple "pick a surface×lens with no data" strategy.

**Schema.**

```sql
CREATE TABLE discovery_arm_stats (
  surface text NOT NULL REFERENCES discovery_surfaces(key) ON UPDATE CASCADE,
  lens text NOT NULL REFERENCES discovery_lenses(key) ON UPDATE CASCADE,
  context_key text NOT NULL DEFAULT '',  -- '' for the global arm, else 'sector:biotech'
  attempts int NOT NULL DEFAULT 0,
  candidates_extracted int NOT NULL DEFAULT 0,
  new_pending_contacts int NOT NULL DEFAULT 0,
  contacts_approved int NOT NULL DEFAULT 0,
  contacts_rejected int NOT NULL DEFAULT 0,
  not_flemish_rejections int NOT NULL DEFAULT 0,
  total_cost_usd numeric(10,4) NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  last_yielding_attempt_at timestamptz,
  cooldown_until timestamptz,
  PRIMARY KEY (surface, lens, context_key)
);
```

A view or function `discovery_arm_stats_recent` returns rolling 30-day windows.

**Code changes.**

- `_shared/banditAllocator.ts` exposes `allocateBudget(budget, runId)` returning a list of `(surface, lens, context, exploration)` tuples.
- `agent-discovery/index.ts` calls the allocator at run start. Each tuple feeds `generateSearchQueries`.
- A nightly cron (or trigger in `agent-scheduler`) recomputes `discovery_arm_stats` from `discovery_query_attempts`. Also possible: keep stats live via row triggers, but a cron is simpler and good enough.
- Admin UI: `src/components/admin/DiscoveryPlanningPanel.tsx` adds a heatmap of `(surface, lens)` arms with attempt count, approval rate, and cooldown status.

**Subagent suggestions.**

- One subagent on Thompson-sampling math + Deno tests with synthetic yield data.
- One subagent on the stats refresh job + admin heatmap UI.
- One subagent reviewing the allocator's exploration guarantees: verify by simulation that no arm exceeds 25% of total budget over a 7-day window.

**Verification.**

- Run 50 simulated discovery cycles in a Deno test with seeded yield distributions; assert exploration reserve and budget cap hold.
- Trigger 5 real discovery runs; confirm `discovery_arm_stats` updates and the heatmap renders.
- Confirm a saturated arm (artificially set `last_yielding_attempt_at` 10 days ago, `new_pending_contacts=0`) drops out of the next allocation.

**Docs to update.**

- `docs/SCHEMA.md` — add `discovery_arm_stats`.
- `docs/AI-PIPELINE.md` — replace the static priority section with the bandit description, exploration reserve, saturation rules.
- `docs/EVALUATION.md` — add the budget-cap and saturation invariants as quality gates.

**Definition of done.**

- Allocator picks all `(surface, lens)` tuples for a run; no static priority code remains.
- Arm stats refresh nightly.
- Heatmap shows live distribution; no arm dominates.

---

## Phase 4 — Reflection Loop

**Goal.** Periodically inspect the approved network, identify systematically missing buckets, and inject new exploration arms / wild-card queries.

**Scope (in).**

- New edge function `agent-discovery-reflect` (or a sub-step in `agent-scheduler`).
- Runs daily (cron).
- Builds a structured summary of approved people: counts by sector, US state, employer, school, decade-of-arrival, career stage. Plus a sample of recent rejections with reasons.
- Calls Gemini with a "what's missing" prompt that returns a list of `(surface, lens, sector?, geo?, rationale)` exploration suggestions.
- Suggestions are written to a new `discovery_reflection_suggestions` table with TTL. The bandit's exploration slot reads from this table first (preferring suggestions ≤ 7 days old).

**Schema.**

```sql
CREATE TABLE discovery_reflection_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  surface text REFERENCES discovery_surfaces(key) ON UPDATE CASCADE,
  lens text REFERENCES discovery_lenses(key) ON UPDATE CASCADE,
  context_key text NOT NULL DEFAULT '',
  rationale text NOT NULL,
  population_summary jsonb NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  consumed_attempt_count int NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '14 days')
);

CREATE INDEX idx_reflection_active ON discovery_reflection_suggestions (expires_at) WHERE expires_at > now();
```

**Code changes.**

- `agent-discovery-reflect/index.ts`: build the population summary via SQL aggregations on `people`, `discovered_contacts` (status='rejected'), `organizations`. Call Gemini with structured output. Insert suggestions.
- Bandit allocator's exploration slot prefers an unconsumed reflection suggestion when present. Otherwise falls back to "untried arm".
- Admin UI tab `Network Growth → Reflection` shows the latest population summary and the active suggestions.

**Subagent suggestions.**

- One subagent on the SQL aggregation + Gemini call + structured output schema.
- One subagent on integrating reflection suggestions into the bandit allocator.
- One subagent reviewing prompt quality with adversarial examples (e.g., what if the network is empty? what if it's saturated in one sector?).

**Verification.**

- Trigger reflection manually; inspect `discovery_reflection_suggestions` for ≥ 3 plausible suggestions with non-empty rationale.
- Run discovery; confirm exploration slot picks a reflection suggestion and the corresponding query attempt logs `source_type='reflection'`.
- Confirm expired suggestions are not picked.

**Docs to update.**

- `docs/SCHEMA.md` — add the new table.
- `docs/AI-PIPELINE.md` — add the reflection function and its prompt contract.
- `docs/ROUTES.md` — add the reflection admin tab.
- `docs/EVALUATION.md` — note the reflection-driven exploration as a coverage-broadening mechanism.

**Definition of done.**

- Daily cron produces fresh suggestions.
- Bandit consumes suggestions; query attempts visibly tagged `reflection`.
- Admin can read the latest population summary.

---

## Phase 5 — Pivot Upgrades

**Goal.** Make pivots actually find new people. Add validation, saturation, multi-hop expansion, and composition.

**Scope (in).**

- **Validation before promotion.** When a pivot candidate first reaches the 2-people-shared threshold, call Gemini with the entity name, type, and source excerpts: "Is this entity Flemish/Belgian-relevant in a way that makes it useful for finding more Flemish-Americans? Score 0-1 with rationale." Store the score. Reject pivots scoring < 0.5.
- **Saturation.** Track per-pivot `new_approved_people_per_run` rolling window. Suppress for 30 days when the window hits zero.
- **Multi-hop expansion from approved people.** When a person is approved in `people`, automatically queue queries about their *current employer*, *previous employers*, *advisors* (if known), *boards*. New `source_type='multi_hop'` in `discovery_query_attempts`.
- **Composition pivots.** Beyond named-entity pivots, add `sector_cluster_pivot` and `geo_cluster_pivot` types. These emerge from clustering approved people: if 4+ approved people share `(sector=biotech, state=MA)`, that becomes a composition pivot whose queries are generated against `(surface=*, lens=sector_geo, context={sector:biotech, geo:MA})`.

**Schema.**

```sql
ALTER TABLE discovery_entity_pivots
  ADD COLUMN validation_score numeric(3,2),
  ADD COLUMN validation_rationale text,
  ADD COLUMN validation_at timestamptz,
  ADD COLUMN saturation_cooldown_until timestamptz,
  ADD COLUMN rolling_new_approved int NOT NULL DEFAULT 0,
  ADD COLUMN rolling_window_started_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE discovery_composition_pivots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pivot_type text NOT NULL CHECK (pivot_type IN ('sector_cluster', 'geo_cluster', 'sector_geo_cluster')),
  context jsonb NOT NULL,                -- { sector, state, city, ... }
  approved_people_count int NOT NULL,
  last_approved_match_at timestamptz NOT NULL,
  saturation_cooldown_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pivot_type, context)
);
```

**Code changes.**

- `agent-discovery/index.ts`: validate new pivots before they enter the active rotation. Skip seeding for pivots in cooldown or below threshold.
- A new background job (in `agent-scheduler`) recomputes composition pivots from `people` weekly.
- Multi-hop expansion: a trigger on `people` insert/update enqueues query plans for the person's employers and advisors. These flow through the bandit allocator like any other plan.
- Delete the old static `entity_pivots_used` reporting once compositions are tracked.

**Subagent suggestions.**

- One subagent on validation + saturation logic + tests.
- One subagent on composition-pivot clustering job.
- One subagent on multi-hop trigger + integration into the allocator.
- One adversarial subagent: try to find pivots that pass validation but yield only duplicates; iterate the prompt.

**Verification.**

- Seed a pivot with bogus entity name ("United States"); confirm validation rejects it.
- Force-saturate a pivot (set `rolling_new_approved=0` over multiple test runs); confirm it enters cooldown.
- Approve 4 people in `(biotech, MA)`; confirm a composition pivot is created and its queries appear in the next run.
- Approve a person with `current_employer=UCB`; confirm a multi-hop query plan appears.

**Docs to update.**

- `docs/SCHEMA.md` — new pivot columns and composition table.
- `docs/AI-PIPELINE.md` — validation, saturation, multi-hop, composition.
- `docs/EVALUATION.md` — pivot quality gates.

**Definition of done.**

- No pivot active without validation.
- Saturated pivots provably skipped.
- Composition pivots and multi-hop expansion produce query attempts.

---

## Phase 6 — Domain Reputation Feedback

**Goal.** Close the loop from yield back into query generation. Domains that yield approved people get promoted as `site:` operators in future queries, even on unrelated arms. Domains that yield only noise get a soft block.

**Scope (in).**

- Compute `domain_reputation_score` per domain from `discovered_contacts.status='approved'` rate over the last 90 days.
- Pass top-N reputable domains to the query generator as `preferred_site_operators` context. Pass low-reputation domains as `avoidQueryShapes`.
- Surface this in the admin UI as a domain leaderboard.

**Scope (out).** Manually editing reputation; this is fully data-driven.

**Schema.**

```sql
ALTER TABLE discovery_domains
  ADD COLUMN reputation_score numeric(4,3) NOT NULL DEFAULT 0,
  ADD COLUMN reputation_window_started_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN reputation_recompute_at timestamptz;
```

**Code changes.**

- New job in `agent-scheduler` that recomputes reputation nightly: `score = (approved_count + 1) / (extracted_count + 5)` (Bayesian smoothing).
- Pass the top 20 reputable domains and bottom 20 unreputable into `generateSearchQueries.context`.
- Admin UI: leaderboard sortable by reputation, with manual "exclude" toggle (sets `discovery_domain_policy.status='blocked'`).

**Verification.**

- After a few runs of real data, confirm `reputation_score` populates and ranges 0-1.
- Inspect a few generated queries; confirm reputable domains appear as `site:` operators when relevant.

**Docs to update.**

- `docs/SCHEMA.md` — new columns.
- `docs/AI-PIPELINE.md` — reputation feedback loop.

**Definition of done.**

- Reputation score live, leaderboard rendered, generator consumes the top/bottom domains.

---

## Phase 7 — Cleanup and Deprecation

**Goal.** Hard delete every artifact the redesign replaced. The codebase and database should look like the old system never existed.

**Required deletions.**

- Tables (already dropped in earlier phases — verify):
  - `discovery_source_packs`
  - Any `*_legacy` shadow tables created during phased work.
- Columns:
  - `discovery_entity_pivots.seed_queries`
  - `discovery_source_packs.query_templates` (table dropped)
  - Any unused `priority_boost` / `gap_score` columns no longer read by the allocator.
- Code:
  - `buildPivotSeedQueries` (Phase 1).
  - The 3-variant string concat in `buildSeedPlans` (Phase 1).
  - `loadSourcePacks` and all source-pack types (Phase 2).
  - `pickGapForSourcePack`, `decorateQueryWithGap`, `pickGapSector` if unused after the bandit takes over.
  - Static `priority_boost + gap_score` ranking in `buildSeedPlans` (Phase 3).
  - The old `entity_pivots_used`, `source_packs_used`, `gap_targets_used` arrays in the run result if superseded by `discovery_query_attempts`.
  - Any TODO/`// legacy` comments referencing the old system.
- Docs:
  - Remove all source-pack references from `docs/AI-PIPELINE.md`, `docs/SCHEMA.md`, `docs/EVALUATION.md`.
  - Move `docs/DISCOVERY-REDESIGN.md` to `docs/archive/` once Phase 7 closes.
  - Remove obsolete `TEMP-PHASE*.md` files if they refer to legacy discovery flows that no longer exist.

**Audit script.** Before declaring done, run a grep audit:

```bash
# These should all return zero matches:
grep -rn "discovery_source_packs\|source_pack_id\|query_templates\|buildPivotSeedQueries\|loadSourcePacks" \
  src supabase docs

grep -rn "priority_boost\|gap_score" src supabase \
  | grep -v discovery_seed_domains
```

Any matches must be either removed or explicitly justified in the Phase 7 PR description.

**Schema audit.** Run on the linked Supabase project:

```sql
SELECT table_name FROM information_schema.tables
  WHERE table_schema='public'
    AND table_name LIKE '%source_pack%';
-- expected: 0 rows
```

**Verification.**

- All audit greps return zero unjustified matches.
- All schema audit queries return zero rows.
- `npm run typecheck`, `npm test`, `npm run test:deno`, `npm run lint`, `npm run build` pass.
- One full discovery run produces query attempts with all new fields populated and zero references to the old system in run telemetry.

**Docs to update.**

- `docs/AI-PIPELINE.md` — final pass to ensure no source-pack vocabulary remains.
- `docs/SCHEMA.md` — final pass to ensure no source-pack tables/columns referenced.
- `docs/WEBAPP-MASTERPLAN.md` — mark discovery redesign complete, link to this archived plan.

**Definition of done.**

- Zero references to `discovery_source_packs`, `query_templates`, `buildPivotSeedQueries`, `seed_queries` across code, schema, and docs.
- This file moved to `docs/archive/`.
- `WEBAPP-MASTERPLAN.md` updated.

---

## Acceptance Criteria (Whole Feature)

The redesign is "done" when:

1. **Held-out recall ≥ 50%** on the `discovery_eval_holdout` set within 6 weeks of Phase 6 deploy.
2. **Reject rate `not_flemish` < 15%** of all reviewed candidates over a rolling 30-day window.
3. **Budget diversification**: no `(surface, lens)` arm consumes > 25% of total query budget over any 7-day window.
4. **Novelty trend**: 7-day moving average of `new_approved_people_per_run` is flat or rising over the 6-week window. (Decay would mean the agent is exhausting its surfaces.)
5. **Reflection-driven discovery**: at least 1 in 5 discovery runs surfaces a candidate whose first-touching query had `source_type='reflection'` or `source_type='multi_hop'`.
6. **Clean codebase**: Phase 7 audits pass.

These thresholds get added to `docs/EVALUATION.md` in Phase 0 and become the rollback gate for any future change.
