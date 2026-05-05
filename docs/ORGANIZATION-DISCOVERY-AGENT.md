# Organization Discovery Agent

## Goal

Discover strategically relevant organizations for Flanders-US business, research, investment, and institutional access. The agent should create reviewable records in `discovered_organizations`; it must not directly create approved `organizations`.

## Inclusion Rules

Include organizations with clear evidence for at least one of these patterns:

- Belgian or Flemish companies with US offices, factories, labs, accelerators, partner sites, event sites, or active US expansion targets.
- US organizations connected to Flanders through partnerships, investment, research collaboration, trade access, or institutional programs.
- Chambers of commerce, trade offices, consulates, economic development agencies, accelerators, universities, labs, funds, and institutional connectors that help the Flanders-US network.
- US-based organizations whose description, programs, portfolio, or leadership show concrete Flemish or Belgian relevance.

## Exclusion Rules

Exclude ordinary employers that merely employ one Flemish-connected person, generic directories with weak evidence, one-off mentions without strategic relevance, low-evidence companies, and organizations whose only tie is an unverified search-result snippet.

## Output Contract

Write one row per candidate to `discovered_organizations`:

- `name`: official organization name.
- `website_url`: canonical website when available.
- `description`: concise description including why the organization belongs in the Flanders-US network.
- `suggested_us_network_status`: one of `us_based_organization`, `belgian_organization_with_us_presence`, `us_organization_connected_to_flanders`, `institutional_connector`.
- `us_locations`: JSON array following the `organization_us_locations` shape.
- `sectors`: known sector names.
- `flemish_belgian_relevance`: short evidence-backed relevance statement.
- `source_urls`: source pages used.
- `confidence`: 0 to 1.
- `status`: `pending` by default.
- `agent_run_id`: current run ID.

## US Locations

Each `us_locations` item should contain:

- `location_city` and `location_state`.
- `location_role`: `hq`, `office`, `branch`, `factory`, `lab`, `accelerator`, `partner_site`, `expansion_target`, `event_site`, or `other`.
- `label`: user-facing label such as `US office`, `factory`, `HQ`, `partner location`, or `expansion target`.
- `description`: what the location represents.
- `source_url` and `evidence_excerpt`.
- `confidence`.
- `is_primary`: true for the main US location only.

Every location role requires direct evidence from an organization page, press release, trusted institutional page, or high-quality partner page. Expansion targets require explicit evidence of US expansion intent, not generic market language.

## Approval Flow

Reviewers approve a `discovered_organizations` row into `organizations`, setting `organizations.us_network_status` and a strategic description. Each accepted `us_locations` item becomes an `organization_us_locations` row, resolving `location_id` through `locations`. The legacy `organizations.location_id` can be set to the primary US location for compatibility, but the map uses `organization_us_locations`.

## Relationship To People Discovery

People discovery may suggest organization pivots, but those pivots are leads only. Approved organization records require organization-specific evidence and must go through `discovered_organizations`; person discovery must not auto-create organizations.
