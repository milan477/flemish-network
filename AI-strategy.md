# AI Strategy

## Goal

The goal is not "more AI calls". The goal is an evidence-driven system that:

1. Finds more relevant Flemish/Belgian-connected people in the US.
2. Updates and verifies existing profiles continuously.
3. Suggests high-signal connections.
4. Improves search quality and speed as the database grows.
5. Keeps humans in the loop for authoritative writes.

Right now the codebase has useful primitives, but the overall architecture is still closer to "prompt some APIs on demand" than "run a durable autonomous intelligence pipeline".

## Executive Summary

The current AI stack is directionally good, but uneven:

- Search has the best foundation: server-side hybrid retrieval, pgvector, and normalized Flemish connections.
- Verification has a useful LinkedIn-first path, but there is duplicate logic and a broken UI contract.
- Discovery is the weakest area. It is too shallow, too repetitive, too dependent on generic query templates, and too lossy in how it hands evidence to the model.
- Connections are a good deterministic baseline, but they are not yet an autonomous intelligence layer.
- Embeddings exist, but they are still being used as a single-profile vector rather than a real retrieval substrate.
- Several AI ingestion/review flows still target the old `people.flemish_connection` text column even though that column was dropped. That is not a "quality" problem. That is a broken-contract problem.

My recommendation:

- Keep the current search/verification/embedding foundations.
- Redo discovery around source coverage, per-page evidence, and durable review queues.
- Consolidate prompt logic and verification paths.
- Stop using free-text `flemish_connection` as a write target anywhere in the live system.
- Use stable Gemini 2.5 models as production defaults, and treat Gemini 3.x preview models as optional evaluation paths, not the operational core.

## What Is Good Today

These parts are worth keeping:

- `search-people` already moved ranking server-side and combines keyword extraction with embeddings.
- `generate-embeddings` plus `match_people()` gives you a real vector-search base.
- Flemish connections were normalized into `flemish_connections` and `person_flemish_connections`.
- `agent-verify` has a sensible deterministic-first LinkedIn path before falling back to LLM reasoning.
- `discover_connections()` is deterministic, idempotent, and cheap.
- `webSearch.ts` already has caching, provider fallback, and quota tracking.
- The admin review pattern exists: `profile_suggestions` and `discovered_contacts`.

That means this is not a greenfield redesign. The right move is to tighten contracts, then build a stronger retrieval and evidence pipeline on top of what already exists.

## Critical Findings

### 1. Data-contract drift is breaking AI flows

The biggest issue is that the normalized Flemish-connection model exists, but multiple AI-related frontend flows still try to write `flemish_connection` directly onto `people`.

Observed examples:

- `src/components/admin/AdminChatbot.tsx`
- `src/components/admin/DiscoveredContactsPanel.tsx`
- `src/components/admin/DiscoveredContactsPanel.tsx` merge path
- `src/components/ProfileUpdateModal.tsx` still treats `flemish_connection` as a writable scalar field

But `supabase/migrations/20260330000002_drop_people_flemish_connection.sql` explicitly drops `people.flemish_connection`.

Implication:

- Some AI-assisted ingestion/review paths are now partially broken or logically wrong.
- Discovery and AI-assisted contact-add flows are not aligned with the current schema.
- Any strategy work built on top of this drift will compound the problem.

Verdict: fix immediately.

### 2. Discovery is still a shallow search wrapper, not a real discovery pipeline

`agent-discovery` is called an agent, but operationally it is:

- 3 web searches
- 2 LinkedIn searches
- one-shot extraction over concatenated result blobs
- a dedup pass
- insert into `discovered_contacts`

The plan logic is very simple:

- custom query -> 3 trivial variants
- blank query -> rotate through a small predefined set

That does not create durable coverage. It just rephrases the same search intent repeatedly.

Why recall is capped:

- It searches too few query families per run.
- It does not track source coverage over time.
- It hands one merged blob of search results to the model instead of extracting page by page.
- It loses field-level evidence.
- LinkedIn search is being used as a discovery channel when it is better suited as an enrichment channel.

Implication:

- You will keep missing people who are mentioned in niche faculty pages, team pages, award lists, lab rosters, speaker pages, alumni databases, and press releases.
- You will keep rediscovering the same obvious profiles.

Verdict: redo.

### 3. Search quality is better than discovery, but the retrieval design still leaves recall on the table

`search-people` has the right idea, but the candidate generation is narrow:

- vector candidates from `match_people()`
- keyword candidates only from `name`, `current_position`, `bio`, and Flemish-connection join matches

That means:

- sector, occupation, and location mostly influence reranking, not retrieval
- if the embedding misses and the keyword is only in sector or city/state, the person may never enter the candidate set
- query routing is missing; short direct-name lookups and exploratory semantic searches use the same retrieval pipeline

The weighting is also static:

- `0.4 * keyword + 0.6 * embedding`
- fixed threshold
- no exact-match or trigram boost
- no use of click data beyond logging

Implication:

- search can feel smart on good cases and still miss obvious records on structured queries
- performance will degrade as candidate quality declines, not just as row count grows

Verdict: keep the hybrid concept, redesign retrieval and ranking.

### 4. Verification and updates are duplicated and partly disconnected

You effectively have two verification/update engines:

- `update-profile`
- `agent-verify`

They overlap, but are not unified.

`agent-verify` is the better engine:

- deterministic LinkedIn diff first
- web-search fallback second
- dedup of pending suggestions
- better telemetry

`update-profile` is much thinner and still used by UI paths.

There is also a UI/API mismatch:

- `ProfileUpdateModal` expects inline suggestions back from `update-profile`
- `update-profile` actually writes to `profile_suggestions` and returns `{ results, totalSuggestions }`

Implication:

- ad hoc profile update UX is inconsistent
- review logic is split
- prompt/schema logic is duplicated across files

Verdict: consolidate into one verification engine and one contract.

### 5. Several "agent" pieces are not really operating as an agent system

There is an `agent-scheduler`, but the admin UI does not use it. `AgentDashboard` writes `agent_runs` directly and invokes agent functions itself.

So the codebase currently has two orchestration paths:

- direct invocation from the UI
- the unused scheduler path

Implication:

- zombie handling and cache cleanup live in a function that is mostly bypassed
- the agent lifecycle is not actually centralized

Verdict: either use the scheduler everywhere or remove it.

### 6. The centralized `ai-agent` function is not actually central

The repo has a generic `ai-agent` function, but key prompts and schemas are duplicated elsewhere:

- `smart_search` logic is duplicated inside `search-people`
- `check_profile` logic is duplicated inside `agent-verify`

Also:

- `parse_contacts` appears to have no live call sites
- `flemish_search` appears to have no live call sites

Implication:

- prompt drift is guaranteed
- model changes must be applied in multiple places
- dead tasks add surface area without product value

Verdict: centralize shared prompt/schema helpers or reduce the generic agent to only tasks that are genuinely reused.

### 7. Embeddings are present, but still under-modeled

Current embedding design:

- one vector per person
- one aggregated text string per person
- no chunking
- no field-specific vectors
- no evidence vectors

That is acceptable as a first pass, but not enough if you want:

- vector search for long bios
- high-recall semantic discovery
- better snippets
- affinity/related-person search

Implication:

- one noisy aggregate vector has to serve too many jobs

Verdict: keep the current vector infrastructure, but extend it.

### 8. The current model strategy leans too hard on preview models

The code defaults heavily to `gemini-3-flash-preview`.

That is workable for experimentation, but not a strong production default because:

- preview models are rate-limited more aggressively
- preview model availability shifts faster
- preview defaults create migration churn

Official Google docs indicate:

- Tier 1 supports much more than the current default, including Gemini 2.5 Flash, 2.5 Flash-Lite, 2.5 Pro, and preview 3.x models.
- preview models have tighter rate limits than stable models.
- `gemini-embedding-2-preview` is the latest embedding model, but it is incompatible with `gemini-embedding-001`, so upgrading requires a full re-embed.

Verdict: move production defaults to stable 2.5 models; use preview models selectively.

## Capability Scorecard

| Capability | Current State | Recommendation |
| --- | --- | --- |
| Search | Good foundation, incomplete retrieval/ranking | Keep and redesign |
| Discovery | Shallow and repetitive | Redo |
| Verification | Promising but duplicated | Consolidate and strengthen |
| Updates UX | Partly broken contract | Fix immediately |
| Connections | Good deterministic baseline | Keep and extend carefully |
| Embeddings | Useful first pass | Keep and deepen |
| Agent orchestration | Split path, weak lifecycle | Simplify |

## Target Operating Model

The target system should work like this:

1. Source-led discovery runs continuously.
2. Search results are processed page by page, not blob by blob.
3. Every extracted fact has evidence.
4. New people land in a review queue.
5. Existing people generate field-level suggestions with evidence and confidence.
6. Derived labels and vector indexes refresh automatically.
7. Connection suggestions are computed from normalized data and evidence.
8. Humans approve authoritative writes to `people`.

The important shift is this:

- current design: query -> search -> prompt -> write
- target design: source -> retrieve -> extract -> normalize -> dedupe -> evidence -> review -> write

That is what enables autonomy without turning the database into a hallucination sink.

## Immediate Fixes Before Any Bigger Redesign

### P0.1 Fix all broken `flemish_connection` writes

Scope:

- `src/components/admin/AdminChatbot.tsx`
- `src/components/admin/DiscoveredContactsPanel.tsx`
- any compare/merge/update path that still writes `people.flemish_connection`

Change:

- stop writing `flemish_connection` onto `people`
- write person row first
- normalize and sync via `syncPersonFlemishConnections()`
- regenerate embeddings after sync

Why first:

- discovery approval and AI-assisted add flows should not be built on a dead column

Effort: small

### P0.2 Unify the profile-update contract

Choose one of these:

- Option A: `update-profile` returns preview suggestions directly for the modal, and only writes to `profile_suggestions` when explicitly requested
- Option B: `ProfileUpdateModal` stops expecting inline suggestions and instead reads the pending suggestions rows created by the endpoint

My recommendation: Option A for ad hoc single-person review, `agent-verify` for batch mode.

Effort: small

### P0.3 Use one orchestration path

Either:

- make `AgentDashboard` call `agent-scheduler`

or:

- delete `agent-scheduler`

I recommend using the scheduler, because once discovery becomes multi-step and scheduled, central lifecycle control matters.

Effort: small

### P0.4 Remove prompt duplication

Create one shared module for:

- query parsing / keyword extraction schema
- check-profile schema
- model selection rules

Then use it from:

- `ai-agent`
- `search-people`
- `agent-verify`

Effort: small to medium

## Search Strategy

### What To Keep

- server-side search
- pgvector
- keyword extraction
- hybrid ranking
- search click logging

### What To Change

#### 1. Add a lexical retrieval layer

Create a denormalized `people_search_documents` table or materialized view with:

- `person_id`
- `name`
- `current_position`
- `bio`
- `occupation`
- normalized Flemish connection names
- sector names
- location text
- `tsvector`
- optional trigram-friendly text fields

Use lexical retrieval for:

- exact and near-exact name lookup
- sector/location queries
- organization/title lookups

#### 2. Switch from candidate gating to rank fusion

Instead of:

- vector candidates plus a few ad hoc keyword queries

Use:

- lexical top K
- vector top K
- deterministic exact-match boosts
- reciprocal-rank fusion or normalized weighted fusion

This will improve recall without depending too much on any one signal.

#### 3. Add query routing

Classify search queries into:

- direct entity lookup
- faceted structured query
- exploratory semantic query

Routing rules:

- direct lookup: exact/trigram first, then vector fallback
- faceted query: lexical/filters first, vector second
- exploratory query: vector and lexical both, then rerank

#### 4. Improve snippets

Generate snippets from:

- best lexical field match
- best matching bio chunk
- best evidence sentence

Do not just return the first bio sentence that happens to contain a token.

### What To Scrap

- the idea that vector search alone will solve recall
- the 200-row client-side fallback as a meaningful backup

Keep a degraded fallback if you want resilience, but do not treat it as equivalent functionality.

### Devil's Advocate

If the dataset remains small, full lexical-plus-vector fusion may feel heavier than necessary. But the problem you described is already a retrieval problem, not a scale problem. The redesign is justified even before the database gets large.

### Scope

Phase 1 deliverables:

- `people_search_documents` materialized view or table
- lexical retrieval SQL
- query router
- fusion ranking
- snippet rewrite
- evaluation set of representative queries

## Discovery Strategy

This may be the most important AI function in the entire product.

Why:

- search quality depends on what exists in the database
- verification can only improve records that have already been found
- embeddings only add value once there is enough high-quality text to index
- connections only become interesting once discovery has surfaced enough real people

If discovery stays shallow, the rest of the AI system will look smarter than it really is while the database grows too slowly and too predictably.

### What To Keep

- `discovered_contacts` review queue
- agent run telemetry
- web-search provider abstraction
- human-in-the-loop approval before authoritative writes

### The Core Problem

Current discovery is still query execution, not frontier management.

In practice, the current system does this:

1. generate a few search queries
2. fetch a few search results
3. give a merged blob to Gemini
4. insert extracted people into `discovered_contacts`

That is useful as a bootstrap, but it does not compound.

It does not answer:

- which URLs were promising
- which domains keep producing good contacts
- which sibling pages should be crawled next
- which sites have already been exhausted
- which pages should be revisited later

That is why the system keeps finding the head of the distribution and misses the long tail.

### What To Redo

#### 1. Turn discovery into a bounded frontier crawler

The key architectural shift is this:

- current model: `query -> search -> prompt -> insert`
- target model: `seed -> frontier -> fetch -> classify -> extract -> expand -> review -> revisit`

The most important new concept is a discovery frontier.

A frontier is a queue of URLs and domains the system believes are worth inspecting next. Each run should not ask:

- "what are the next 3 searches?"

It should ask:

- "what are the next 15 highest-value pages to inspect?"

This should be a bounded best-first crawler, not a general crawler.

It should have:

- max crawl depth
- per-domain page budgets
- per-run fetch budgets
- revisit intervals
- content-hash dedup
- priority scoring
- yield tracking

Suggested schema:

- `discovery_frontier`
- `url`
- `canonical_url`
- `domain`
- `status` (`queued`, `fetching`, `done`, `failed`, `ignored`)
- `priority_score`
- `depth`
- `discovered_from_url`
- `discovery_reason`
- `source_type` (`search_seed`, `source_pack`, `sitemap`, `rss`, `child_link`, `entity_pivot`)
- `last_fetched_at`
- `next_fetch_at`
- `fetch_error_count`
- `content_hash`
- `page_type`
- `last_extraction_outcome`

Optional but useful supporting tables:

- `discovery_domains`
- `discovery_pages`
- `discovery_evidence`

This is the layer that lets discovery compound over time instead of resetting every run.

#### 2. Use three discovery lanes, not one

Discovery should have three distinct lanes:

- `Head coverage`
- `Adaptive frontier expansion`
- `Entity-pivot expansion`

`Head coverage` is where source packs belong.

Introduce explicit source packs such as:

- BAEF fellows and alumni pages
- Flemish university alumni and faculty pages
- lab and research group rosters
- startup/team/company leadership pages
- conference speaker pages
- award announcements
- Belgian/Flemish association pages in the US
- press releases and interviews

Each source pack should define:

- domains or source families
- query templates
- refresh frequency
- extraction strategy
- expected evidence quality

This is still valuable, but only for the obvious head of the graph.

`Adaptive frontier expansion` is the real long-tail engine.

This is where the system gradually fans out from:

- search-result URLs
- approved discoveries
- known organization domains
- known person websites
- pages that mentioned one promising person
- pages that mentioned one strong Flemish entity

`Entity-pivot expansion` is how you stop being dependent on hand-maintained source lists.

Examples:

- a newly approved person at a US biotech startup creates a follow-up discovery task around that startup's leadership, team, board, and news pages
- a newly approved professor with a KU Leuven background creates a follow-up task around the lab page, faculty roster, group members, and affiliated center pages
- a conference speaker page creates a follow-up crawl of the event roster, organizers, and related speaker pages

This lane is especially important for finding people who are not already obvious to the office.

#### 3. Search should seed the frontier, not be the frontier

Search still matters, but it should be used differently.

Search is good at:

- finding entry-point pages
- finding new domains
- surfacing pages the crawler has not seen before

Search is not good as the final evidence substrate for extraction.

The role of Tavily/Brave should become:

- generate seed URLs
- generate seed domains
- occasionally refill the frontier when it goes stale

Not:

- act as the primary content source for person extraction

This matters because search snippets and partial raw content are too lossy for high-recall discovery.

#### 4. Extract per page, not from a merged search blob

Current discovery gives the model a stitched blob of search snippets. That is the wrong granularity for high recall.

Better flow:

1. search to find candidate URLs
2. fetch/read each page individually
3. extract people from each page
4. aggregate mentions across pages
5. decide which child pages deserve follow-up
6. schedule revisit or expansion

Benefits:

- better recall
- better source attribution
- easier debugging
- better dedup and confidence scoring
- real page-level expansion

#### 5. Classify pages cheaply before running expensive extraction

Most fetched pages should never reach the full extraction step.

You want a cheap triage layer first.

Suggested page types:

- `person_profile`
- `team_or_roster`
- `lab_or_group_page`
- `article_or_press_release`
- `event_or_speaker_page`
- `directory_or_index_page`
- `low_value_boilerplate`
- `irrelevant`

Suggested inputs to page classification:

- URL path patterns
- anchor text from the parent page
- page title
- heading text
- presence of many names
- presence of organization words
- presence of Flemish cues
- presence of US-location cues

Suggested approach:

- deterministic heuristics first
- `gemini-2.5-flash-lite` only when rules are ambiguous
- full structured extraction only for promising page types

This is one of the most important cost controls in the whole design.

#### 6. Expand links selectively, not blindly

The crawler should not follow every link.

It should score outgoing links and enqueue only the best children.

Positive expansion signals:

- URLs containing `/people`, `/person`, `/team`, `/faculty`, `/lab`, `/members`, `/fellows`, `/alumni`, `/leadership`, `/board`, `/speakers`
- anchor text such as `team`, `faculty`, `members`, `researchers`, `fellows`, `leadership`, `speaker`, `alumni`
- sibling links on a page that already yielded a valid person
- domains that have produced approved contacts before
- pages containing Flemish entities like `KU Leuven`, `UGent`, `VUB`, `UAntwerp`, `imec`, `BAEF`
- pages containing strong US cues

Negative expansion signals:

- `login`, `signup`, `privacy`, `terms`, `careers`, `donate`, `calendar`, `tag`, `archive`, `search`
- social-share links
- generic site navigation
- repeated duplicate paths
- deep pagination

Hard rules I would use:

- max depth `2` or `3`
- max `10-30` pages per domain per week
- max `10-20` fetched pages per run
- only expand child links aggressively when the parent yielded a candidate or strong person-like signals
- stop revisiting domains that show consistently poor yield

This keeps the crawler useful and operationally sane.

#### 7. Use domain yield learning so the crawler gets smarter over time

The crawler should learn which domains are worth budget.

Track per domain:

- pages fetched
- pages classified as promising
- candidates extracted
- candidates approved
- candidates rejected
- duplicate rate
- last approved contact date
- average evidence quality

Then use those metrics to drive revisit policy:

- high-yield domains: revisit often, inspect more siblings, fetch sitemap/RSS
- medium-yield domains: revisit occasionally
- low-yield domains: strongly decay or stop crawling

This is how the system gradually expands into lesser-known pages without becoming a random walk.

#### 8. Add sitemap and RSS harvesting for proven domains

This is an important middle ground between source packs and open-ended crawling.

For domains that have already shown yield, the system should try:

- `sitemap.xml`
- RSS/Atom feeds
- obvious directory pages
- recent-news indexes

Why this works:

- it is cheaper than deep crawling
- it reaches pages search APIs may not surface well
- it is especially good for labs, universities, associations, and conference sites

Crucially, this should be conditional on prior domain yield. Do not do this for every random domain.

#### 9. Store evidence, not just final fields

Extend discovery staging so each candidate carries:

- source URL
- source title
- source type
- evidence excerpt
- extraction confidence
- extracted location raw text
- extracted Flemish-connection raw text
- normalized labels
- page type
- discovered-via reason
- parent URL or source page

I would strongly consider a separate evidence table rather than overloading `discovered_contacts`.

Suggested `discovery_evidence` shape:

- `discovered_contact_id`
- `page_url`
- `page_title`
- `page_type`
- `evidence_excerpt`
- `raw_location_text`
- `raw_flemish_text`
- `raw_role_text`
- `extraction_confidence`
- `discovered_via`
- `parent_url`
- `fetched_at`

If you do not keep evidence, reviewers cannot trust or correct the pipeline efficiently.

Evidence also enables a stronger merge strategy:

- one person mentioned on three different pages should look stronger than one person extracted from one ambiguous page
- a person can accumulate evidence over time before a reviewer ever sees them

That is a much better pattern than inserting one thin contact record and asking the reviewer to infer everything.

#### 10. Add entity-pivot discovery

This is the most important path for getting beyond the obvious names.

Whenever discovery or approval surfaces a useful entity, generate follow-up frontier seeds from it.

Good pivots:

- organization
- lab or research center
- fellowship or program
- advisory board
- conference or event
- city-specific Belgian/Flemish association
- co-mentioned institution

Examples:

- approved person works at a Boston robotics lab -> crawl the lab team page, faculty page, affiliated research-center page, and recent news page
- approved person is a BAEF fellow now at a US hospital -> inspect fellowship alumni pages, department pages, and speaker/event pages
- approved person is on a startup team -> inspect team, leadership, advisory board, and funding-news pages

This is how you find the second- and third-order people who do not appear in obvious seed lists.

Important rule:

- pivot from evidence-bearing entities only

Do not let the model invent broad pivot campaigns from vague summaries.

#### 11. Use LinkedIn as enrichment, not as the main discovery engine

LinkedIn search is useful, but:

- it is credit-limited
- it often lacks explicit Flemish evidence
- it is weaker than high-trust source pages for structured extraction

Recommended role for LinkedIn:

- enrich already-found names
- verify current position/location
- add photo/profile URL

Not:

- primary top-of-funnel discovery

LinkedIn should usually happen after a person or page is already interesting, not before.

#### 12. Coverage tracking must become first-class

Track:

- last executed source pack
- frontier size
- queued URLs
- fetched URLs
- ignored URLs
- high-yield domains
- exhausted domains
- last seen URL
- last seen domain
- pages fetched
- pages classified by type
- candidates extracted
- candidates approved
- candidates rejected
- duplicates
- average evidence count per candidate
- frontier refill events
- revisit latency

Without coverage tracking, autonomous discovery becomes random repetition.

### What To Scrap

- the current "3 web + 2 LinkedIn" mental model as the discovery architecture
- merged-blob extraction as the main discovery method
- the idea that a slightly smarter prompt will solve recall
- the idea that source packs alone are enough
- the idea that an unbounded crawler is appropriate for this product

What should be scrapped specifically is not "crawl more".

What should be scrapped is:

- broad open-web crawling without budgets
- page fetches without yield tracking
- expanding links without page-type classification
- treating every found name as equally trustworthy

### Devil's Advocate

This design is more complex than the current one.

The risks are real:

- more tables
- more scheduling logic
- more fetch failures
- more heuristics to tune
- more operational telemetry to watch

But the alternative is worse:

- source packs alone stay too obvious and too head-heavy
- search-only discovery keeps repeating the same intent
- reviewer queues stay thin on evidence and weak on recall
- the database never compounds into a real network graph

The right answer is not "source packs or crawler".

The right answer is:

- source packs for head coverage
- adaptive frontier crawling for the long tail
- entity pivots for compounding expansion

### Implementation Shape

This should be built as small scheduled batches, not as a long-running crawler process.

Why that fits this project:

- Supabase Edge Functions have strict execution limits
- the app already has `agent_runs`
- the app already has a scheduler concept
- batching pages per run is enough if the frontier persists in the database

One realistic run looks like:

1. claim the next `10-20` frontier URLs
2. fetch and canonicalize pages
3. classify pages cheaply
4. run extraction only on promising pages
5. store evidence
6. merge candidates
7. enqueue top child links
8. update domain yield scores
9. release the batch

That is absolutely doable in this project.

### Scope

Phase 2 should be split more clearly.

Phase 2A deliverables:

- `discovery_frontier` table
- `discovery_domains` and/or `discovery_pages`
- search results turned into frontier seeds
- per-page fetch and extraction pipeline
- evidence table or evidence-bearing discovery staging
- LinkedIn moved to enrichment

Phase 2B deliverables:

- link extraction and child-link scoring
- page classification layer
- per-domain budgets
- revisit policy
- domain yield scoring

Phase 2C deliverables:

- entity-pivot generation from approved contacts and strong evidence
- sitemap/RSS harvesting for proven domains
- better multi-page candidate merging
- domain-level discovery analytics

## Verification And Updates Strategy

### What To Keep

- LinkedIn-first verification from `agent-verify`
- deterministic diffs for structured fields
- human approval via `profile_suggestions`

### What To Change

#### 1. Collapse `update-profile` into the verification system

Use one verification engine with two modes:

- ad hoc single-person review
- scheduled batch verification

The ad hoc modal should call the same core verification code as the batch agent.

#### 2. Add evidence columns to `profile_suggestions`

At minimum:

- `evidence_url`
- `evidence_excerpt`
- `confidence`
- `method` (`linkedin_scrape`, `web_search_llm`, `deterministic`)
- `agent_run_id`
- `dedupe_key`

Right now `source` is not enough.

#### 3. Route by field risk

Low-risk fields:

- `linkedin_url`
- `website_url`
- `profile_photo_url`
- `location_city`
- `location_state`

Medium-risk:

- `current_position`
- `occupation`

High-risk:

- `bio`
- any change that implies leaving the US

Use deterministic extraction wherever possible, and reserve LLM judgment for ambiguous fields.

#### 4. Add smarter scheduling

Prioritize verification by:

- stale age
- presence of LinkedIn URL
- source importance
- user activity/search volume
- recent discovery evidence touching an existing person

### What To Scrap

- the split between "ask AI" and "verification agent" as separate logic stacks

### Devil's Advocate

It is tempting to auto-apply low-risk updates. I would not do that yet. First build evidence quality, reviewer trust, and suggestion metrics. Then consider auto-applying only narrow deterministic updates.

### Scope

Phase 3 deliverables:

- shared verification core
- modal/API contract fix
- evidence-bearing suggestions
- scheduling/prioritization

## Connections Strategy

### What To Keep

- `discover_connections()` as a deterministic baseline

This is the right starting point because it is:

- cheap
- explainable
- idempotent

### What To Change

Add new connection classes carefully, but keep them evidence-based:

- same normalized organization
- same fellowship/program
- same lab/team/advisory board from discovery evidence
- same event speaker roster
- semantic peer affinity based on bio/current-position similarity

Important distinction:

- `connections`: hard or semi-hard graph edges
- `connection_suggestions`: softer inferred candidates awaiting review

Do not mix them.

### What To Scrap

- any idea of letting an LLM create graph edges directly from vague text

### Devil's Advocate

Aggressive inferred edges will make the graph feel richer, but also much noisier. If the graph becomes noisy, users stop trusting it. Keep hard edges conservative and put exploratory affinity in a separate UI.

### Scope

Phase 4 deliverables:

- organization normalization improvements
- optional `connection_suggestions`
- evidence-backed new connection types

## Embeddings Strategy

### What To Keep

- pgvector
- HNSW
- background generation

### What To Change

#### 1. Build a better embedding document

Current embedding text is a flat concatenation. Improve it by formatting fields explicitly, for example:

- `Name: ...`
- `Role: ...`
- `Organization: ...`
- `Bio: ...`
- `Sectors: ...`
- `Flemish connections: ...`
- `Location: ...`

This usually embeds more cleanly than an undifferentiated pipe-joined string.

#### 2. Add bio-chunk vectors

If you specifically want vector search over bios, add a `person_text_chunks` table:

- `person_id`
- `chunk_type` (`bio`, `position`, `combined`)
- `chunk_index`
- `chunk_text`
- `embedding`

Then:

- retrieve top chunks
- aggregate back to people
- use matched chunk text as snippet/evidence

#### 3. Fix backfill accounting and batching

Current backfill progress only counts null embeddings in the reported remaining total, not all stale embeddings. The generation loop is also fully serial.

Improve:

- correct remaining counts
- embed multiple texts per request where practical
- use Gemini Batch API for large nightly refreshes

#### 4. Delay the embedding-model migration until the pipeline is stable

Short term:

- stay on `gemini-embedding-001`
- improve document construction and chunking

Medium term:

- evaluate `gemini-embedding-2-preview`
- only migrate after you are ready to re-embed everything

### What To Scrap

- the idea that changing embedding model is the first lever to pull

The bigger gains are retrieval design, chunking, normalization, and evidence structure.

### Devil's Advocate

Multi-vector chunk search adds complexity. If you want a smaller first step, do a better denormalized search document plus lexical/vector fusion before creating a chunk table.

### Scope

Phase 4 or 5 deliverables:

- improved embedding text
- optional chunk table
- better batch generation
- embedding-model evaluation

## Automatic Labeling And Location Extraction

This is worth doing, but it should be evidence-first.

### Recommended derived labels

- sector
- occupation / career stage
- Flemish connection entities
- US location
- source quality
- profile confidence

### Recommended implementation pattern

- store derived labels separately first
- attach confidence and evidence
- let reviewers approve or override
- only then promote labels into canonical tables or filterable fields

This matters because the current sectors are broad and easy to over-assign. False precision will hurt trust.

### Location extraction

Location should be a pipeline, not a single model field:

1. raw location text from source
2. deterministic parser for city/state/country
3. geocode if US candidate
4. confidence score
5. reviewer confirmation when ambiguous

Do not rely only on the LLM to emit `location_city` and `location_state`.

## Model Strategy

## Production Defaults

- Query parsing / lightweight routing: `gemini-2.5-flash-lite`
- Search keyword extraction: `gemini-2.5-flash`
- Structured extraction from source pages: `gemini-2.5-flash`
- Hard reconciliation / ambiguous merges / offline evaluation: `gemini-2.5-pro`
- Embeddings now: `gemini-embedding-001`
- Embeddings later, if needed: `gemini-embedding-2-preview` behind a full re-index plan

## Why This Stack

- `2.5-flash-lite` is the cheapest place to put high-volume low-risk reasoning.
- `2.5-flash` is the right production workhorse for most structured extraction and reranking tasks.
- `2.5-pro` should be reserved for expensive, ambiguous, high-value decisions.
- preview Gemini 3.x models should be opt-in, not the default production dependency.

## Why Not Make Gemini 3.x Preview The Core

- preview models are more operationally volatile
- rate limits are tighter on preview models
- they are better suited to evaluation lanes than to the core CRUD and search loop

## Caching And Batch Strategy

- Use context caching when repeatedly sending large common prefixes or large reusable evidence sets.
- Use Gemini Batch API for large embedding refreshes and other offline jobs where latency is not user-facing.

## External Notes

As of March 30, 2026, Google's official docs indicate:

- Tier 1 includes stable Gemini 2.5 Flash, 2.5 Flash-Lite, and 2.5 Pro, in addition to preview Gemini 3.x models.
- preview models have tighter rate limits.
- `gemini-embedding-2-preview` is the latest embedding model, but it is incompatible with `gemini-embedding-001`, so a migration requires a full re-embed.

## What To Remove Or Rename

I would explicitly clean this up:

- Rename `search-contacts` to `discover-contacts` or fold it into the discovery system. It is not directory search; it is web prospect discovery.
- Remove or freeze unused `ai-agent` tasks until there is a real product call site.
- Remove free-text Flemish-connection writes from all person create/update flows.
- Remove one of the two orchestration paths.

## Roadmap

### Phase 0: Contract Cleanup

- Fix all stale `people.flemish_connection` writes.
- Fix `ProfileUpdateModal` contract.
- Route agent triggering through one path.
- Deduplicate prompt/schema logic.

Expected outcome:

- AI features stop fighting the schema.

### Phase 1: Search Upgrade

- Add denormalized search documents.
- Add lexical retrieval.
- Add query routing and rank fusion.
- Improve snippets.

Expected outcome:

- materially better recall and better direct-query accuracy

### Phase 2: Discovery Redesign

- source packs for head coverage
- `discovery_frontier` and bounded crawl orchestration
- per-page fetch, classification, and extraction
- evidence-bearing discovered contacts
- selective child-link expansion
- domain yield scoring and revisit policy
- entity-pivot expansion
- LinkedIn moved to enrichment

Expected outcome:

- materially higher long-tail recall
- better reviewer trust because every candidate carries evidence
- compounding database growth instead of repeated shallow rediscovery

### Phase 3: Verification Unification

- single verification engine
- ad hoc and batch modes
- evidence-bearing suggestions
- better prioritization

Expected outcome:

- cleaner update loop and less duplicated logic

### Phase 4: Labeling, Embeddings, Connections

- derived labels with confidence
- bio-chunk vectors
- richer but evidence-based connection suggestions

Expected outcome:

- better filters, better semantic retrieval, better network intelligence

## Success Metrics

Track these before and after each phase:

- search success rate on a fixed benchmark query set
- top-5 recall for discovery benchmark sources
- approved contacts per 100 fetched pages
- approved contacts per unique domain
- percentage of approved contacts coming from non-source-pack discovery
- percentage of approved contacts with 2 or more evidence pages
- median time from frontier seed to reviewed candidate
- reviewer approval rate for discovered contacts
- reviewer approval rate for profile suggestions
- duplicate rate in discovered contacts
- percentage of profiles with usable embeddings
- percentage of profiles with verified US location
- connection suggestions accepted vs rejected

Without benchmark queries and benchmark sources, "AI quality" will remain subjective.

## Final Recommendation

The right strategy is not to make the current system more agentic. The right strategy is to make it more evidence-driven.

If you fix the schema drift, strengthen retrieval, redesign discovery around a bounded adaptive frontier, and consolidate verification, then autonomous behavior becomes realistic.

If you skip those steps and keep layering new model calls on top of the current flow, you will mostly get:

- more cost
- more reviewer workload
- more duplicate or low-confidence suggestions
- only marginal recall gains

The best next move is a disciplined Phase 0 plus a serious Phase 1/2 rebuild, with discovery treated as the compounding engine of the whole system, not just another agent.
