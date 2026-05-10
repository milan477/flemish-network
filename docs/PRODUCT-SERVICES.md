# Product Services Overview

This document describes the target user-facing service structure for the webapp. It is intentionally product-level: endpoints, agents, and tables are implementation details underneath these services.

**Canonical product name.** The product is called **Flemish Network**. That string is the canonical browser tab title (`index.html` `<title>`) and the canonical staff-facing label everywhere the product is named. Do not reintroduce older variants such as "Flemish Network Navigator" or "Prototype" in user-visible surfaces.

## High-Level Structure

```text
Flemish Network App
├── 1. Search The Network
├── 2. Build A Collection
├── 3. Expand The Database
├── 4. Verify And Enrich Records
└── 5. Understand And Grow The Network
```

The product should feel like five clear services, not a collection of overlapping agents.

Staff access is an administrative support workflow, not a sixth product service. Viewers can search/read the network, editors can maintain pending and approved records, and admins can manage staff access plus destructive approved-record deletion. Admins invite approved staff from Access; invited staff set their own
Supabase Auth password before using the workspace.

## 1. Search The Network

Purpose: find existing people and organizations already in the database.

User examples:

- "KU Leuven alumni in Boston"
- "Belgian AI researchers in California"
- "Flemish-connected biotech organizations in New York"
- "US-connected people abroad with imec ties"

Scope:

- People search
- Organization search
- US-based vs US-connected-abroad filtering
- Flemish/Belgian connection filters
- Sector, occupation, role, location, and organization filters

Output:

- Ranked people and organization results
- Clear match rationale/snippets
- Facets/filters
- Ability to add selected people and organizations to a collection

Contract: semantic intent in, ranked list out, filters are explicit.

- The query box is a single semantic-intent channel — type a question, get
  a ranked list. The system does not auto-extract filter chips from your
  query (UX_REMEDIATION Phase 1A removed the natural-language filter parser).
- Filter chips are click-only: they apply when you click them in the filter
  panel and never silently appear from typing in the query box. A new query
  cannot drag old chips along with it.
- Under the hood the function runs a hybrid retrieval stage (lexical + vector)
  followed by a Gemini rerank that respects the constraints in your query
  (city, state, sector, organization). When the rerank is unavailable or
  slow, the Stage 1 ranking is shown as a "loose match" so you still get
  results.

Important distinction:

- Flemish/Belgian connections are profile facts and search fields.
- They are not person-to-person edges.
- Organization search uses approved organization records and canonical organization Flemish/Belgian facts. The old raw organization relevance text is compatibility-only during the Phase 6 migration.

## 2. Build A Collection

Purpose: turn a natural-language collection goal into a useful working list.

The input can be a long, detailed prompt. The system should parse it into one or more focused searches when that improves result quality.

Example:

```text
Build a collection of senior biotech leaders in New York and Boston who have strong Flemish or Belgian ties and could be relevant for a life sciences delegation visit.
```

This should likely become separate internal searches such as:

- senior biotech leaders in New York with Flemish/Belgian ties
- senior biotech leaders in Boston with Flemish/Belgian ties

Scope:

- Understand the collection goal
- Split complex prompts into focused search tasks
- Search existing people and organizations
- Rank candidates against the goal
- Explain why each candidate belongs
- Let the user approve/reject
- Preserve the current detail-page draft across route revisits until refresh, reset, or save
- Save accepted candidates to the collection

Output:

- Collection draft
- Collection suggestions for people and, where relevant, organizations
- Rationale per candidate
- Approval/rejection workflow
- In-place profile previews for detail-page suggestions
- Optional handoff to Discovery when the existing database appears thin
- Collection detail views show mixed people and organization members; people-only exports and briefings remain available for member people only.

Out of scope:

- Automatic database expansion
- Starting Discovery automatically
- Hidden database expansion inside collection building
- Canonical organization Flemish/Belgian facts
- Persistent gap analytics
- Persistent draft tables

If the user wants to expand the database from a collection prompt, that should be an explicit handoff to **Expand The Database**, not hidden inside collection building.

## 3. Expand The Database

Purpose: find new people and organizations that are not already in the database.

This is the home for both prompted and autonomous discovery.

Modes:

- **Prompted discovery:** user gives a prompt.
- **Manual intake:** staff enter one pending person or organization with evidence.
- **File import:** staff upload people or organizations from CSV/XLSX into pending review queues.
- **Autonomous discovery:** system chooses work from source packs, coverage gaps, high-yield domains, and evidence-backed pivots.

The AI assistant should not be a separate contact-discovery workflow. It should simply link the user to the Discovery intake prompt box and pass the prompt into this service.

User examples:

- "Find KU Leuven alumni in Boston biotech"
- "Look for Flemish-connected organizations in Houston energy"
- "Expand from this organization's team and advisory-board pages"
- "Find Belgian/Flemish speakers from US climate-tech events"

Scope:

- Plan searches and frontier URLs
- Retrieve web evidence
- Classify pages
- Extract people and organizations
- Detect US-based vs US-connected-abroad status
- Normalize Flemish/Belgian ties, sectors, roles, organizations, and locations
- Dedupe against existing people, organizations, and pending candidates
- Store evidence
- Put candidates in review queues
- Generate follow-up searches

Discovery intake defaults to prompted discovery, with manual add and file import as adjacent intake options. Manual intake and imports create pending candidates only. They do not create or update approved `people` or `organizations`; approval, merge, and rejection happen in Discovery review. Discovery review has separate people and organization queues, and organization cards show source URLs and evidence excerpts before a reviewer promotes or merges the candidate.

**Staff-facing run-button contract.** Every staff-triggered run button (Discovery intake "Run Discovery", Growth "Start discovery run", per-suggestion "Explore", recommended-action runs) must give three signals: a started toast on success, a disabled state for the duration of the in-flight run, and either a completed toast or an informative error toast. When the scheduler rejects a fresh trigger because a previous run finished within the 10-minute cooldown, the UI surfaces an info-level toast explaining how long to wait — not a generic error. The Discovery intake textarea preserves its prompt across submissions so staff can re-run or refine without retyping; it only clears on explicit reset.

Output:

- Pending people
- Pending organizations
- Evidence and source URLs
- Duplicate/merge suggestions
- Normalized labels
- Follow-up searches and entity/domain pivots

The follow-up searches generated here should feed **Understand And Grow The Network**.

## 4. Verify And Enrich Records

Purpose: keep existing people and organizations accurate.

User examples:

- "Check this profile"
- "Verify stale contacts"
- "Find updated role/location/LinkedIn/photo"
- "Check whether this person is still US-based or US-connected-abroad"
- "Verify this organization's US presence"

Scope:

- Select records to verify
- Gather evidence from LinkedIn, organization pages, trusted web sources, and search results
- Compare evidence to existing fields
- Classify field risk
- Create reviewable suggestions
- Apply approved updates
- Refresh record search documents, labels, and embeddings after approved changes

Output:

- Record suggestions for people and organizations
- Evidence
- Confidence/risk
- Reviewer approval queue

Target simplification:

- `update-profile` and `agent-verify` should be two modes of one verification service:
  - preview mode: inline suggestions, no durable writes
  - durable mode: writes reviewable suggestions

Staff-facing copy in the Verification panel uses plain language. The organization queue empty-state reads "Run organization verification to queue reviewable suggestions." (the "(durable mode)" parenthetical was removed in Phase 5C — staff don't need the implementation mode name).

Approval guards staff can expect in the Verification panel:

- A confirmation modal appears when approving a city/state suggestion that would move a person of interest to a non-US locale (the platform assumes persons of interest are US-based).
- Each suggestion chip shows `Confidence X% · <Risk> field` with a tooltip explaining that Confidence describes evidence strength while Risk describes field sensitivity.
- Bio suggestions display as a vertical diff (old value struck through above, new value below).

## 5. Understand And Grow The Network

Purpose: help users understand coverage, Flemish/Belgian relevance, and where to grow next.

This service is not a person-to-person social graph. It should focus on profile facts, organization facts, coverage, and discovery planning.

Scope:

- Explain a person's Flemish/Belgian connections
- Explain an organization's Flemish/Belgian relevance
- Show US-based vs US-connected-abroad distribution
- Show sector/location/source-family coverage
- Surface follow-up searches from discovery
- Rank next discovery opportunities
- Show source packs, high-yield domains, entity pivots, and coverage gaps
- Prefer actionable metro/sector gaps over raw low-count geography lists

Output:

- Coverage overview
- Recommended next searches
- Discovery planning queue
- Flemish/Belgian connection summaries
- Organization relevance summaries

Important distinction:

- A person's connection to Flanders/Belgium is a profile fact.
- An organization's connection to Flanders/Belgium is an organization fact.
- These are not automatically relationships between people.

## Person-To-Person Connection Layer Decision

Discard the person-to-person connection layer as a product concept.

Remove from the target product:

- Graph view/modal
- Profile "Network" section
- Direct Connections
- Network Reach
- Affinity suggestions
- `connections`
- `connection_suggestions`
- `agent-connections`
- Scheduler/admin surfaces for person-to-person connection generation
- SQL/RPC logic that derives people-to-people edges from shared university, program, location, sector, or evidence

Keep:

- Source facts those systems used
- Flemish/Belgian profile facts
- Organization facts
- Sectors
- Locations
- Evidence
- Search/filter/indexing value

Do not turn shared attributes into implied relationships between people.

## Flemish / Belgian Connection Normalization

Flemish and Belgian connections should remain first-class facts throughout the product.

Keep them as:

- Profile facts
- Organization facts
- Chips
- Filters
- Search fields
- Import fields
- Discovery fields
- Verification fields
- Normalized tables

Current required normalized tables:

- `flemish_connections`
- `person_flemish_connections`
- `flemish_connection_aliases`
- `organization_flemish_connections`

Target concept:

```text
Raw evidence text
  -> normalize entity
  -> classify connection type
  -> attach to person or organization
  -> store evidence/confidence
  -> expose as chip/filter/search field
```

Suggested normalized connection dimensions:

| Dimension | Examples |
|---|---|
| Entity | KU Leuven, UGent, VUB, UAntwerp, imec, VITO, BAEF, Fayat, Flanders Investment & Trade |
| Entity type | university, research_institute, fellowship, government, company, city_region, association, other |
| Connection role | alumnus, researcher, employee, founder, fellow, grantee, partner, board_member, origin, collaborator |
| Evidence strength | strong, medium, weak |
| Geography relevance | Flanders, Belgium, Brussels, ambiguous |
| Subject type | person, organization |

Examples:

```text
"PhD, KU Leuven"
  -> entity: KU Leuven
  -> type: university
  -> role: alumnus/researcher
  -> evidence: strong
  -> subject: person

"BAEF fellow at Harvard"
  -> entity: BAEF
  -> type: fellowship
  -> role: fellow
  -> evidence: strong
  -> subject: person

"US office of a Flemish biotech company"
  -> entity: Flemish company
  -> type: company
  -> role: US presence
  -> evidence: strong
  -> subject: organization
```

Default search/filter chips should come only from broad `is_filterable` canonical facts. Specific phrases, raw relevance, and model/import-discovered variants should be preserved as aliases, roles, or evidence without automatically becoming default chips.

Approved profile editing and Discovery review should attach normalized facts to people and organizations with role, confidence, source URL, and evidence excerpt when available. Manual intake and file import remain pending-only; their raw relevance text is preserved for review and only becomes approved fact relationships after explicit reviewer approval or merge.

Discovery extraction and verification proposals preserve raw evidence while attaching normalized facts only through reviewer-controlled approval, merge, or derived-label promotion. Unreviewed model aliases stay pending and are not default filter chips.

## Service Interaction Schema

```text
Search The Network
  uses normalized people/org facts
  uses Flemish/Belgian connection facts
  uses search indexes

Build A Collection
  uses Search The Network
  splits long prompts into focused searches
  saves approved results

Expand The Database
  uses discovery planning + web evidence
  writes pending people/orgs
  writes evidence
  emits follow-up searches

Verify And Enrich Records
  uses web/profile evidence
  writes reviewable suggestions
  refreshes labels/indexes after approval

Understand And Grow The Network
  uses facts, evidence, coverage, and follow-up searches
  does not create person-to-person graph edges
```

## Product-Level Names

Use these names in UI and planning:

- Search
- Collections
- Discovery
- Verification
- Network Growth

Avoid exposing implementation names as product concepts:

- `ai-agent`
- `agent-discovery`
- `agent-verify`
- `update-profile`
- `agent-connections`

### Discovery step-label vocabulary

Discovery run telemetry uses internal step IDs (often suffixed with a UUID or numeric counter, e.g. `page_extraction_<uuid>`, `linkedin_enrichment_2`). The Discovery History panel renders these via a presentation layer (`formatStepLabel`), not the raw IDs. Staff-facing labels for each step prefix:

| Internal step prefix | Staff-facing label |
| --- | --- |
| `web_search` | Web Search |
| `llm_extraction` | LLM Extraction |
| `linkedin_search` | LinkedIn Search |
| `linkedin_enrichment` | LinkedIn Enrichment |
| `cross_dedup` | Cross-Channel Dedup |
| `db_dedup` | Database Dedup |
| `insert` | Insert Contacts |
| `discovery_plan` | Discovery Plan |
| `frontier_claim` | Claim Frontier |
| `frontier_process` | Process Frontier |
| `seed_search` | Seed Search |
| `page_classification` | Page Classification |
| `page_extraction` | Page Extraction |
| `domain_harvest` | Domain Harvest |

Run-summary counters in the same panel use plain-language synonyms in place of internal jargon. The `claimed` / `sitemap` / `rss` / `merged` shorthand stays in row summaries because each token appears next to a count in a list of metrics; do not introduce them as standalone navigation labels or filter chips. Where they appear with a count, the singular/plural form is normalised through `formatCount` (e.g. `1 page` vs `7 pages`).

### System Health operator vocabulary

The `/admin/system` panel is staff-facing operations tooling. Its controls and labels follow a fixed shape so admins can scan them at a glance:

- **Drain now** flushes the embedding queue: it processes any pending `search-index records` immediately instead of waiting for the next scheduled drain. The pending counter in the search-index footer is always rendered as `N search-index records pending` (singular `1 search-index record pending`).
- **Run Housekeeping** marks stuck (zombie) agent runs as failed and frees their slots so new runs can start. Its `title`/`aria-label` describe that effect verbatim.
- **Test Supabase** runs a lightweight Supabase query to confirm the URL, anon key, and RLS policies still work. Its `title`/`aria-label` describe that effect verbatim.
- **Schedule cadence labels** under each agent card use the form `Schedule: <human cadence>`. Discovery uses cadences like `Once daily (09:00 UTC)` / `Twice daily (09:00 + 21:00 UTC)` / `Every 6 hours`; Verification uses cadences like `Up to 5 contacts/day` / `Up to 15 contacts/day` / `Up to 40 contacts/day`. Both kinds share the `Schedule:` prefix and a count-based shape so the unit is consistent across cards.
- **Stale failure cards** are only rendered when the most recent failure is newer than the most recent success; once a successful run lands, the failure banner clears.
- **Apify metrics** in the Today's API Usage row are hidden by default. Set `VITE_SHOW_APIFY=1` to surface them for diagnostics; otherwise they appear only when actual usage is non-zero.
