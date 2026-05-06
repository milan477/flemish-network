# AI Strategy

## Discovery Strategy

### 1. Turn discovery into a bounded frontier crawler

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

### 2. Use three discovery lanes, not one

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

### 3. Search should seed the frontier, not be the frontier

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

### 4. Extract per page, not from a merged search blob

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

### 5. Classify pages cheaply before running expensive extraction

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

### 6. Expand links selectively, not blindly

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

### 7. Use domain yield learning so the crawler gets smarter over time

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

### 8. Add sitemap and RSS harvesting for proven domains

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

### 9. Store evidence, not just final fields

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

### 10. Add entity-pivot discovery

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

### 11. Use LinkedIn as enrichment, not as the main discovery engine

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

### 12. Coverage tracking must become first-class

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

### 13. Add geographic coverage intelligence and gap-seeking

This is a good addition, but it needs to be framed correctly.

A choropleth or heatmap is not the strategy.

The strategy is:

- measure geographic coverage
- identify plausible gaps
- use those gaps to bias discovery planning

The visualization is just the operator interface for that logic.

What the system should support:

- US choropleth by state for macro coverage
- metro-level coverage view for actual actionability
- gap reports such as `15 contacts in Boston, 0 in Houston`
- recommended discovery runs for underrepresented regions

Important caveat:

- states are useful for overview
- metros are better for action

This network is likely to cluster around cities, universities, research hubs, and employer ecosystems. A state-level map is useful for a broad picture, but discovery planning should usually be driven at the metro or city-cluster level.

For example:

- `Massachusetts` is too coarse
- `Boston-Cambridge` is actionable
- `Texas` is too coarse
- `Houston`, `Austin`, and `Dallas` are different discovery targets

If this is implemented only as a state heatmap, it will look informative while still being too blunt for real discovery planning.

### 14. Gap detection should be based on expected presence, not just low counts

The dangerous version of this idea is:

- "0 contacts in place X, therefore place X is a discovery failure"

That is too naive.

Some places may genuinely have low expected relevance. A useful gap score should combine:

- current approved contact count
- pending discovery count
- known organization presence
- known university and research presence
- sector relevance
- office priority weighting
- recent discovery activity

In other words, the system should ask:

- "is this place undercovered relative to how likely it is to contain relevant people?"

Not:

- "is the count low?"

Examples:

- `Houston` may deserve attention because of energy, medical, and research ecosystems
- `Boston-Cambridge` may deserve high expected coverage because of universities, biotech, and research density
- a low-count rural area may not be a meaningful gap at all

This matters because otherwise the discovery planner will waste time chasing empty geography.

### 15. Geographic gaps should steer the frontier and the search planner

Once you have a gap score, use it to drive actual discovery behavior.

It should affect:

- which domains are revisited
- which seed queries are generated
- which entity pivots are expanded first
- which source packs are refreshed sooner
- which approved contacts generate follow-up exploration

Examples of useful behavior:

- if `Houston` is undercovered, prioritize institutions, labs, hospitals, startups, and Belgian/Flemish associations tied to Houston
- if `Chicago` is undercovered in finance, bias discovery toward finance employers, alumni pages, event rosters, and speaker pages in that metro
- if `Seattle` is undercovered but has many known `imec` or Belgian-tech adjacencies, prioritize team pages and conference pages in that ecosystem

This should not become:

- `search for "Belgian people in Houston"` over and over

It should become:

- targeted domain and entity expansion inside undercovered ecosystems

That is the important difference.

### 16. Add a discovery-planning surface for operators

This is where the heatmap becomes genuinely useful.

I would add a planning panel that shows:

- state choropleth for macro coverage
- top undercovered metros
- gap score per metro
- approved contacts, pending contacts, and recent discovery activity by geography
- recommended next discovery actions

Recommended actions could look like:

- `Run frontier expansion for Boston biotech domains`
- `Refresh Houston medical and energy source packs`
- `Expand Chicago finance event and alumni pages`
- `Revisit Seattle domains with high prior yield but low current coverage`

This turns geographic analytics into an operator tool, not just a reporting widget.

### 17. Suggested data model for geographic coverage

I would keep this simple at first.

You do not need a fully separate geography subsystem to get value.

Minimum useful pieces:

- `people` joined to `locations`
- a derived metro mapping layer
- a `coverage_targets` table or config
- a derived `coverage_gaps` materialized view

`coverage_targets` could include:

- geography key
- geography type (`state`, `metro`)
- priority weight
- sector emphasis
- optional notes from the office

`coverage_gaps` could compute:

- approved people count
- pending discovered count
- verified people count
- sector distribution
- recent activity
- expected coverage score
- gap score

This is enough to rank geographies without making the model guess blindly.

### 18. Suggested discovery metrics for geographic coverage

This should not only produce a map. It should produce measurable outcomes.

Useful metrics:

- approved contacts per priority metro
- gap-closure rate for top 10 undercovered metros
- percentage of approved discoveries coming from gap-driven discovery runs
- median time to first accepted contact in a newly targeted metro
- sector coverage by metro for priority sectors

If the heatmap does not change discovery behavior or improve these metrics, then it is only a dashboard feature.

## Model Strategy

### Production Defaults

- Query parsing / lightweight routing: `gemini-2.5-flash-lite`
- Search keyword extraction: `gemini-2.5-flash`
- Structured extraction from source pages: `gemini-2.5-flash`
- Hard reconciliation / ambiguous merges / offline evaluation: `gemini-2.5-pro`
- Embeddings now: `gemini-embedding-001`
- Embeddings later, if needed: `gemini-embedding-2-preview` behind a full re-index plan

### Why This Stack

- `2.5-flash-lite` is the cheapest place to put high-volume low-risk reasoning.
- `2.5-flash` is the right production workhorse for most structured extraction and reranking tasks.
- `2.5-pro` should be reserved for expensive, ambiguous, high-value decisions.
- preview Gemini 3.x models should be opt-in, not the default production dependency.

### Why Not Make Gemini 3.x Preview The Core

- preview models are more operationally volatile
- rate limits are tighter on preview models
- they are better suited to evaluation lanes than to the core CRUD and search loop

### Caching And Batch Strategy

- Use context caching when repeatedly sending large common prefixes or large reusable evidence sets.
- Use Gemini Batch API for large embedding refreshes and other offline jobs where latency is not user-facing.

## External Notes

As of March 30, 2026, Google's official docs indicate:

- Tier 1 includes stable Gemini 2.5 Flash, 2.5 Flash-Lite, and 2.5 Pro, in addition to preview Gemini 3.x models.
- preview models have tighter rate limits.
- `gemini-embedding-2-preview` is the latest embedding model, but it is incompatible with `gemini-embedding-001`, so a migration requires a full re-embed.
