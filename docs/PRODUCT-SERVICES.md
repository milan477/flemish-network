# Product Services Overview

This document describes the target user-facing service structure for the webapp. It is intentionally product-level: endpoints, agents, and tables are implementation details underneath these services.

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
