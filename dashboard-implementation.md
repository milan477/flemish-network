# Task 12: Interactive Stats Dashboard

## Context

The Admin Overview tab currently displays static stats: 4 stat cards, occupation bars, sector bars, top-5 locations, a freshness bar, suggested changes, and an embedding progress section. None of these are interactive -- you can't click on "Finance" to see who's in Finance, you can't cross-filter occupations by sector, and there's no way to jump from the admin dashboard to the main network view with a filter pre-applied.

The goal is to make the admin dashboard a powerful, interactive analytics tool where clicking any dimension (sector, occupation, flemish connection, location, etc.) cross-filters all other charts, and a "View in Network" button lets you jump to the Dashboard with those filters applied.

---

## Brainstorm: What to Build

### Core Charts (enhance existing)

| Chart | Current State | Interactive Enhancement |
|-------|--------------|------------------------|
| **Stat cards** (People, Orgs, Cities, Pending) | Static numbers | Show "X of Y" when cross-filters are active |
| **Occupation bars** (OccupationOverview.tsx) | 9 categories, static bars | Click to cross-filter, "View in Network" per bar |
| **Sector bars** (inline in Admin.tsx) | 6 sectors, static bars | Click to cross-filter, "View in Network" per bar |
| **Top Locations** (top 5 list) | Simple list, no interaction | Expand to all states with city drill-down, click to filter |
| **Freshness bar** (StaleContactsBar.tsx) | Stacked bar, expandable | Click tier to cross-filter |

### New Charts

| Chart | What it shows | Why it matters |
|-------|--------------|----------------|
| **Flemish Connection distribution** | Bar chart of people per connection (KU Leuven, UGent, etc.) | This is the most important dimension for this platform and is currently **not shown at all** in admin stats |
| **Data Quality / Profile Completeness** | Bars showing % of profiles with email, LinkedIn, photo, bio, sector, flemish connection | Reveals actionable data gaps -- "60% of profiles lack LinkedIn URLs" |
| **Availability overview** | 3 pill-stats for lectures, mentorship, visits | Surfaces aggregate availability data that currently exists but is never shown |
| **Connection types** | Counts of colleague, alumni, local_peer connections | Shows network density and how well the connection agent has performed |
| **Collection coverage** | % of people in at least one collection | Indicates how well curated the network is |

### Cross-Filter System

- Click any bar/segment to filter all other charts to that subset
- Multiple filters stack with AND logic (e.g., "Finance" sector + "KU Leuven" connection)
- Active filters shown as removable chips in a bar between stat cards and charts
- "Clear All" button resets all cross-filters
- Each chip has an X to remove just that filter
- "View in Network" button navigates to Dashboard with active cross-filters as a `FilterPreset`
- Per-bar "View in Network" icon appears on hover, navigates with just that single filter

### Cross-Filter Self-Exclusion

When the sector chart has "Finance" selected, the sector chart itself should still show all sectors (computed from people filtered by everything EXCEPT sector). This prevents the chart from collapsing to a single bar. Other charts (occupation, location, etc.) show only people in "Finance." This is the standard Crossfilter.js pattern.

---

## Architecture

### Cross-Filter State

```typescript
interface CrossFilterState {
  sector: string | null;                 // "Finance"
  occupationCategory: string | null;     // "Professors" (9-category system)
  flemishConnection: string | null;      // "KU Leuven"
  state: string | null;                  // "CA"
  city: string | null;                   // "San Francisco"
  freshnessTier: 'fresh' | 'aging' | 'stale' | 'outdated' | null;
  availability: ('lectures' | 'mentorship' | 'visits')[];
  completenessField: { field: string; has: boolean } | null;
}
```

### Filtering Logic

A `useMemo` for each chart dimension computes filtered people excluding its own filter. A single `applyFilters(people, crossFilters, excludeDimension?)` function handles all logic. All client-side -- the dataset is hundreds of rows, not millions.

### Charting Approach

**Keep custom Tailwind bars. Do NOT add Recharts or Chart.js.**

Reasons:
- Bundle is already 1,190 KB (2.4x over the 500KB Vite warning). Adding Recharts adds ~150-200 KB.
- Every visualization is a horizontal bar chart -- no axes, gridlines, or complex charts needed.
- Custom bars already exist and work well. Interactive enhancements (click, hover, highlight) are straightforward to add.
- Cross-filter click handlers are custom logic regardless of library.

### Component Structure

```
Admin.tsx (receives onNavigate from App.tsx)
  Overview tab content extracted to:
  InteractiveStatsOverview.tsx (manages crossFilters state)
    CrossFilterBar.tsx (chips, count, "View in Network", "Clear All")
    StatCard (existing, enhanced with filtered/total counts)
    InteractiveBarChart.tsx (generic reusable for sectors, occupations, etc.)
    DataQualityChart.tsx (profile completeness bars)
    AvailabilityOverview.tsx (3 clickable pills)
    ConnectionsSummary.tsx (connection type counts)
    StaleContactsBar.tsx (existing, enhanced with clickable tiers)
```

### `InteractiveBarChart` -- Reusable Component

```typescript
interface InteractiveBarChartProps {
  title: string;
  items: { key: string; label: string; count: number; color: string;
           totalCount?: number; icon?: LucideIcon }[];
  activeKey: string | null;
  onBarClick: (key: string) => void;
  onViewInNetwork?: (key: string) => void;
  subtitle?: string;
}
```

- Each bar is a `<button>` with hover and active states
- When a bar is active (selected as cross-filter), it gets a ring/border highlight
- When cross-filters from OTHER dimensions are active, bars show a ghost bar (total) behind the colored bar (filtered count)
- "View in Network" icon button appears on hover at right of each bar

---

## Layout

```
[Stat Cards: People | Orgs | Cities | Pending]         // row of 4
[Cross-Filter Bar: chips + count + View in Network]     // appears when filters active
[3-column chart grid]
  Row 1: [Occupations]  [Sectors]  [Flemish Connections]
  Row 2: [Locations (states + city drill)]  [Data Quality]  [Availability + Connections]
[Pending Updates section: Freshness + Suggestions + Embeddings]  // existing, enhanced
```

Responsive: 3 cols on lg, 2 on md, 1 on sm. Chip bar wraps with `flex-wrap`.

---

## Data Flow Changes

### App.tsx
- Pass `handleNavigate` to `<Admin>`: `<Admin onNavigate={handleNavigate} />`

### Admin.tsx
- Accept `onNavigate` prop
- Add two new queries to `loadData`:
  - `connections` table: `SELECT from_person_id, to_person_id, relationship_type FROM connections`
  - `collection_members` table: `SELECT person_id FROM collection_members`
- Also fetch `person_sectors` with `person_id` included (currently only fetches `sector_id, sectors(name)` -- need `person_id` to build the sector-to-people map)
- Extract overview tab content into `InteractiveStatsOverview`

### Pre-computed Lookup Maps (built once after load)
- `personSectorMap: Map<string, Set<string>>` -- sector name -> set of person IDs
- `personToSectorsMap: Map<string, Set<string>>` -- person ID -> set of sector names
- `inCollectionSet: Set<string>` -- person IDs in at least one collection

---

## Navigation: "View in Network"

The existing `FilterPreset` type supports `sector`, `occupation`, `flemishConnections`, and `focusCity`. The "View in Network" button builds a preset from active cross-filters:

```typescript
onNavigate('dashboard', undefined, {
  sector: crossFilters.sector || undefined,
  occupation: mapCategoryToOccupation(crossFilters.occupationCategory),
  flemishConnections: crossFilters.flemishConnection ? [crossFilters.flemishConnection] : undefined,
  focusCity: crossFilters.city && crossFilters.state
    ? { city: crossFilters.city, state: crossFilters.state } : undefined,
});
```

Mapping the 9-category occupation system to the 4-value `OCCUPATION_OPTIONS`:
- Professors, Researchers -> "Academic/Researcher"
- Engineers -> "Professional"
- Executives, Finance, Entrepreneurs, Government -> "Executive/Leadership"
- Creatives, Healthcare -> "Professional"
- Other -> omit

---

## Files to Modify

| File | Change |
|------|--------|
| `src/App.tsx` | Pass `onNavigate={handleNavigate}` to `<Admin>` |
| `src/pages/Admin.tsx` | Accept `onNavigate` prop, add queries for connections + collection_members + person_sectors with person_id, extract overview into InteractiveStatsOverview |
| `src/components/admin/OccupationOverview.tsx` | Export `classifyPerson` and `CATEGORIES`. Add `onBarClick`, `activeCategory` props. Make bars clickable buttons. Show "View in Network" on hover. |
| `src/components/admin/StaleContactsBar.tsx` | Add `onTierClick`, `activeTier` props. Make stacked bar segments clickable buttons. |

## Files to Create

| File | Purpose |
|------|---------|
| `src/components/admin/InteractiveStatsOverview.tsx` | Main container: crossFilters state, filtered people computation, chart layout, CrossFilterBar |
| `src/components/admin/CrossFilterBar.tsx` | Filter chips with remove, clear-all, count, View in Network |
| `src/components/admin/InteractiveBarChart.tsx` | Generic reusable interactive horizontal bar chart |
| `src/components/admin/DataQualityChart.tsx` | Profile completeness bars |
| `src/components/admin/FlemishConnectionChart.tsx` | Flemish connection distribution (uses InteractiveBarChart) |
| `src/components/admin/AvailabilityOverview.tsx` | Lecture/mentorship/visits pills |
| `src/components/admin/ConnectionsSummary.tsx` | Connection type counts |

---

## Implementation Phases

### Phase 1: Wiring & Infrastructure
1. Add `onNavigate` to Admin props, update App.tsx
2. Add person_sectors with person_id query, connections query, collection_members query
3. Create `CrossFilterState` type and `applyFilters()` helper
4. Create `InteractiveStatsOverview.tsx` shell, move overview content into it
5. Build pre-computed lookup maps

### Phase 2: Core Components
1. Create `CrossFilterBar.tsx`
2. Create `InteractiveBarChart.tsx` (generic)
3. Enhance `StatCard` to show filtered vs total

### Phase 3: Convert Existing Charts
1. Convert sector bars to `InteractiveBarChart` with cross-filter
2. Refactor `OccupationOverview` with click handlers
3. Enhance location chart with state-level bars + city drill-down
4. Make `StaleContactsBar` segments clickable

### Phase 4: New Charts
1. `FlemishConnectionChart` (uses InteractiveBarChart)
2. `DataQualityChart` (profile completeness)
3. `AvailabilityOverview` (3 pills)
4. `ConnectionsSummary` (connection type counts)

### Phase 5: Polish
1. "View in Network" buttons (per-bar + chip bar level)
2. Hover tooltips on bars
3. Smooth bar width transitions (already have `transition-all duration-700`) 
4. Empty state when cross-filters return 0 results
5. Responsive layout testing

---

## Verification

1. Run `npm run typecheck` -- no new errors
2. Run `npm run build` -- no build errors
3. Manual test in browser:
   - Go to Admin -> Overview tab
   - Verify all charts render with correct data
   - Click "Finance" sector bar -> all other charts filter to Finance people, Finance chip appears
   - Click "KU Leuven" in flemish connections -> adds second filter, both chips show
   - Stat cards show "X of Y" (e.g., "12 of 157 People")
   - Click X on a chip -> that filter removed, charts update
   - Click "Clear All" -> all filters reset
   - Click "View in Network" -> navigates to Dashboard with Finance + KU Leuven filters applied
   - Hover over a bar -> "View in Network" icon appears at right
   - Click per-bar "View in Network" -> Dashboard opens with just that filter
   - Verify location chart shows all states, click a state -> cities expand, click a city -> cross-filter applied
   - Verify data quality chart shows completeness bars
   - Verify flemish connection chart shows all 7 connections with counts
   - Test responsive: resize to mobile, verify single-column layout
