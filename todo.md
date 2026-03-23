# Flemish Network Platform — TODO

Tasks are scoped for parallel development on feature branches. Each section is one branch.
Dependencies between branches are noted where they exist.

---

## P0 — Core UX & Must-Haves

### 1. Unified Search Bar — `feature/unified-search`
**Files touched:** `Navigation.tsx`, `Dashboard.tsx`, `FilterPanel.tsx`, `App.tsx`, `aiService.ts`, `supabase.ts`
**Does NOT touch:** Map, Admin, Planner, profiles, edge functions, database

Consolidate three search experiences (nav search bar, Smart Search chat, filter panel search) into one.

- [ ] Remove the large search bar from `Navigation.tsx` top ribbon
- [ ] Remove the "Smart Search" chat section from `FilterPanel.tsx`
- [ ] Add a new search bar to the right of Map/List toggle buttons in `Dashboard.tsx`
  - Placeholder: "Search by name or describe what you're looking for..."
  - Should take up most remaining width in that row
- [ ] **Name/org search mode:** If input looks like a short proper noun, do fuzzy text match against `people.name` and `organizations.name` and show results as a dropdown autocomplete below the search bar
- [ ] **Natural language search mode:** If input is a longer descriptive query:
  - Call AI (`aiService.ts`) to extract structured filter parameters (location, sector, occupation, flemish_connection)
  - Auto-set the corresponding filters in `FilterPanel.tsx` so the user sees what was interpreted
  - Perform keyword/semantic search over `people.bio` to rank results by relevance within the filtered set
  - Sort results by relevance in list/map view
- [ ] Show active search context as removable chips/tags below the search bar after NL query is processed (e.g., "Location: Boston", "Sector: AI", "Query: AI safety research")
  - Removing a chip updates filters and re-runs search
- [ ] Keep search bar accessible from all pages via `Navigation.tsx` (triggers navigation to dashboard with search)

### 2. Auto-Apply Filters & Simplified Filter Panel — `feature/filter-simplify`
**Files touched:** `FilterPanel.tsx`, `Dashboard.tsx`, `supabase.ts` (types)
**Does NOT touch:** Navigation, Map, Admin, Planner, profiles, edge functions, database

- [ ] Remove the "Apply Filters" button from `FilterPanel.tsx`
- [ ] Make all filters auto-apply: on any change (toggle, select, deselect), immediately re-filter and update map/list
- [ ] Show a brief loading spinner during re-filter if needed
- [ ] Simplify Occupation dropdown to four career-stage categories only:
  - Student, Academic/Researcher, Professional, Executive/Leadership
- [ ] Change Flemish Connection from single text input to multi-select dropdown/tag input
  - List all available Flemish connections from the database as options
  - Allow selecting MULTIPLE connections (OR logic — show people matching ANY selected)
- [ ] Keep "Available for lectures" checkbox, also auto-applying
- [ ] Update live stats at bottom of filter sidebar (People, Organizations, Cities count) on every filter change

### 3. Collections (Replace Missions/Planner) — `feature/collections`
**Files touched:** New `pages/Collections.tsx`, new `components/CollectionDetail.tsx`, new `components/CollectionModal.tsx`, `App.tsx`, `Navigation.tsx`, `DirectoryGrid.tsx`, `PersonProfile.tsx`, `supabase.ts` (types)
**Database:** New migration for `collections` and `collection_members` tables
**Removes:** `pages/Planner.tsx`, `components/PlanForm.tsx`, `components/PlanDetail.tsx`, `components/PlannerChatbot.tsx`, `lib/plannerUtils.ts`
**Does NOT touch:** Map, Admin, FilterPanel, edge functions

- [ ] Create new migration:
  ```sql
  collections (id, name, description, created_at, updated_at)
  collection_members (id, collection_id FK, person_id FK, notes, added_at)
  ```
  With RLS policies for public read/write (same pattern as existing tables).
- [ ] Remove "Missions" tab from `Navigation.tsx`, replace with "Collections"
- [ ] Remove all Planner-related components and `plannerUtils.ts`
- [ ] Build `Collections.tsx` page:
  - Header: "Collections" with subtitle "Save and organize groups of contacts"
  - "+ New Collection" button (opens simple modal: name + optional description)
  - Grid of collection cards showing: name, description, member count, date, avatar previews
  - Click card → opens `CollectionDetail.tsx` showing member list with per-person notes, remove button
- [ ] Add bookmark/folder icon on person cards in `DirectoryGrid.tsx` and `PersonProfile.tsx`
  - Click opens dropdown: list of collections with checkboxes to add/remove person
  - "Create new collection" option at bottom
- [ ] "Search similar" button on each collection: takes bios of collection members, runs semantic search to find similar people in the network
- [ ] Update `App.tsx` routing: add `'collections'` to `Page` union, render `Collections.tsx`
- [ ] Clean up: remove `plan_suggested_people`, `plan_actions`, `plans` references from any remaining code (but do NOT drop DB tables in migration — just stop using them)

### 4. Export & Briefing Documents — `feature/export`
**Files touched:** New `lib/exportService.ts`, `DirectoryGrid.tsx`, `CollectionDetail.tsx` (if collections branch merged), `PersonProfile.tsx`
**Does NOT touch:** Map, Admin, Navigation, filters, edge functions, database

- [ ] Create `lib/exportService.ts` with export utilities
- [ ] **Export filtered results as CSV/Excel:**
  - Add "Export" button to `DirectoryGrid.tsx` header
  - Export all currently visible/filtered people with columns: Name, Position, Organization, Location, Sector(s), Flemish Connection, Email, Phone, LinkedIn
- [ ] **Export collection as PDF briefing document:**
  - Add "Export Briefing" button to collection detail view
  - Generate a formatted document with:
    - Collection name and description as header
    - For each person: photo placeholder, name, title, position, location, bio summary, contact info, Flemish connection
  - Use browser print/PDF (`window.print()` with print-specific CSS) or a client-side PDF library (jsPDF)
- [ ] **Print-friendly profile pages:**
  - Add print stylesheet to `PersonProfile.tsx` (hide nav, sidebar, action buttons)
  - Add "Print" button to profile page

### 5. Data Quality & Privacy Fields — `feature/data-quality`
**Files touched:** New migration, `PersonProfile.tsx`, `Admin.tsx`, `supabase.ts` (types), `DirectoryGrid.tsx`
**Does NOT touch:** Map, Navigation, filters, edge functions, search

- [ ] Create migration adding fields to `people`:
  ```sql
  data_source TEXT DEFAULT 'manual'        -- 'manual', 'csv_import', 'ai_agent', 'self_reported'
  last_verified_at TIMESTAMPTZ
  consent_status TEXT DEFAULT 'not_contacted' -- 'not_contacted', 'consented', 'opted_out'
  profile_completeness INTEGER DEFAULT 0   -- calculated 0-100
  ```
- [ ] Add `data_source` and `last_verified_at` tracking:
  - Set `data_source` on creation (manual form → 'manual', CSV import → 'csv_import', AI agent → 'ai_agent')
  - Set `last_verified_at` when a human reviews/edits a profile or approves a suggestion
- [ ] Add profile completeness calculation (in `supabase.ts` or as a DB function):
  - Score based on: has name (10), has position (10), has location (10), has bio (20), has email (10), has phone (5), has linkedin (5), has flemish_connection (10), has sector(s) (10), has photo (10)
- [ ] Show completeness indicator on profile pages (progress bar or percentage)
- [ ] Show verification badge on profiles: "Verified [date]" or "Unverified" based on `last_verified_at`
- [ ] Show data source on profile pages (small label: "Added via CSV import", "AI-discovered", etc.)
- [ ] Add consent status management in Admin panel:
  - List people by consent status
  - Bulk-set consent status
  - Filter to hide opted-out people from search/directory
- [ ] Add "Stale profiles" section to Admin: profiles where `last_verified_at` is NULL or > 6 months ago

---

## P1 — Agent System & Enrichment

### 6. Agent Orchestration Infrastructure — `feature/agent-infra`
**Files touched:** New `supabase/functions/agent-scheduler/`, new migration for `agent_runs` table, `Admin.tsx`, new `components/admin/AgentDashboard.tsx`
**Does NOT touch:** Frontend search, filters, map, profiles, collections

- [ ] Create `agent_runs` table:
  ```sql
  agent_runs (
    id uuid PK,
    agent_type TEXT,           -- 'discovery', 'verification', 'enrichment', 'connection'
    status TEXT,               -- 'running', 'completed', 'failed'
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    results JSONB,             -- { profiles_found: 3, suggestions_created: 5, errors: [] }
    error_message TEXT,
    api_calls_made INTEGER,
    cost_estimate_usd NUMERIC
  )
  ```
- [ ] Create `supabase/functions/agent-scheduler/` edge function:
  - Can be triggered via cron (Supabase pg_cron or external) or manually from admin UI
  - Accepts `{ agent_type, params }` and dispatches to the appropriate agent function
  - Logs run to `agent_runs` table
  - Tracks API call count for cost awareness
- [ ] Build `AgentDashboard.tsx` admin component:
  - Show recent agent runs with status, duration, results
  - "Run Now" buttons for each agent type
  - Summary stats: total runs this week, profiles discovered, suggestions pending
  - Show estimated API costs
- [ ] Add agent dashboard tab to `Admin.tsx`

### 7. Discovery Agent — `feature/agent-discovery`
**Depends on:** `feature/agent-infra` (for `agent_runs` table and scheduler)
**Files touched:** New `supabase/functions/agent-discovery/`, `supabase/functions/ai-agent/` (new task type)
**Does NOT touch:** Frontend (results appear as profile_suggestions)

- [ ] Create `supabase/functions/agent-discovery/`:
  - Input: search criteria (e.g., "Flemish researchers at US universities", specific institution alumni)
  - Uses Tavily API to search for people matching criteria
  - Uses Gemini to extract structured person data from search results
  - Dedup check against existing `people` table (by name + location, email, LinkedIn URL)
  - Creates new entries in `profile_suggestions` (or a new `discovered_profiles` staging table) for human review
  - Does NOT auto-add to `people` — always human-in-the-loop
- [ ] Add discovery-specific AI task to `ai-agent` edge function:
  - Task: `extract_person_from_search` — given search result text, extract: name, position, organization, location, bio, Flemish connection, contact info, confidence score
- [ ] Predefined discovery searches (configurable):
  - BAEF alumni in the US
  - KU Leuven / UGent / VUB / UAntwerp alumni in US academia
  - Flemish entrepreneurs in US tech
  - Recent news mentions of "Flemish" + "United States"
- [ ] Log all runs to `agent_runs` with results summary

### 8. Verification Agent — `feature/agent-verification`
**Depends on:** `feature/agent-infra`, `feature/data-quality` (for `last_verified_at`)
**Files touched:** New `supabase/functions/agent-verify/`, extends `profile_suggestions` table
**Does NOT touch:** Frontend (results appear as profile_suggestions for admin review)

- [ ] Create `supabase/functions/agent-verify/`:
  - Queries `people` table for profiles where `last_verified_at` is NULL or > N months ago
  - For each stale profile, searches the web (Tavily) for current info about the person
  - Uses Gemini to compare current web info vs stored profile
  - If discrepancies found: creates `profile_suggestions` entries (same human-review workflow)
  - If info confirmed current: updates `last_verified_at` without creating suggestions
  - If person appears to have left the US or changed fields significantly: flags for manual review
- [ ] Batch processing: process up to N profiles per run (configurable, default 10) to manage API costs
- [ ] Priority ordering: verify profiles with highest `profile_completeness` first (most valuable to keep current), or profiles that were most recently viewed/used

### 9. Connection Discovery Agent — `feature/agent-connections`
**Depends on:** `feature/agent-infra`
**Files touched:** New `supabase/functions/agent-connections/`, `connections` table
**Does NOT touch:** Frontend (connections surfaced later in network visualization work)

- [ ] Create `supabase/functions/agent-connections/`:
  - For each person, analyze their profile data to find implicit connections:
    - Same organization → connection with type "colleague"
    - Same Flemish connection → connection with type "alumni"
    - Same city + same sector → connection with type "local_peer"
    - Co-mentioned in search results → connection with type "associated"
  - Check if connection already exists in `connections` table before creating
  - Set `strength` based on connection type (colleague=8, alumni=6, local_peer=4, associated=3)
- [ ] Can also use Gemini to analyze pairs of bios and estimate if people likely know each other
- [ ] Log results to `agent_runs`

---

## P1 — User Experience Improvements

### 10. Interactive Stats Dashboard — `feature/interactive-stats`
**Files touched:** `Admin.tsx`, `components/admin/StatsOverview.tsx` (or equivalent admin components)
**Does NOT touch:** Navigation, Map, profiles, filters, edge functions, database

- [ ] Make every data bar/label/count in the admin stats dashboard clickable
- [ ] Cross-filtering behavior:
  - Click "Finance" in Profiles by Sector → Occupation and Location charts update to show only Finance people
  - Click "Boston, MA" in Top Locations → Sector and Occupation update for Boston only
  - Click "Researchers" in Occupations → other charts filter accordingly
- [ ] Show active cross-filter as a chip/tag at top of dashboard with X to clear
- [ ] Toggle behavior: clicking an already-active filter deselects it
- [ ] Add hover effects (cursor pointer, subtle highlight) on all clickable data elements
- [ ] Optional: "View in Network" link on each filter that navigates to Dashboard with filter pre-applied

### 11. Profile Page Clickable Tags — `feature/profile-clickable-tags`
**Files touched:** `PersonProfile.tsx`, `OrganizationProfile.tsx`
**Does NOT touch:** Dashboard, Map, Admin, filters, edge functions, database

- [ ] Make sector/expertise tags clickable → navigate to Dashboard with sector filter pre-applied
- [ ] Make Flemish Connection entries clickable → navigate to Dashboard with that connection selected
- [ ] Make location clickable → navigate to Dashboard with map centered on that city
- [ ] Style with subtle underline or hover effect, keep current tag/badge visual style
- [ ] Use existing `onNavigate` with `FilterPreset` to pass pre-set filters

### 12. Search Result Relevance Snippets — `feature/search-snippets`
**Files touched:** `DirectoryGrid.tsx`, `aiService.ts`, `supabase.ts` (types)
**Does NOT touch:** Map, Admin, Navigation, profiles, edge functions, database

- [ ] After natural language search, show a snippet below each person card explaining WHY they matched
  - 1 sentence max, extracted/summarized from their bio that's most relevant to query
  - Example: Query "AI safety researcher" → Snippet "Works on machine learning and AI at Lawrence Berkeley National Laboratory"
- [ ] If match was filter-only (no bio match): show matching filter values instead (e.g., "Matched: Sector = AI, Location = Boston")
- [ ] Style: smaller font, gray color, italic — informative but not distracting
- [ ] Only show snippets for NL search results, not for name searches or filter-only browsing

### 13. Map Improvements — `feature/map-clustering`
**Files touched:** `MapVisualization.tsx`, `ClusterPopover.tsx`
**Does NOT touch:** Dashboard logic, filters, Admin, profiles, edge functions, database
**Consider:** Switching from custom SVG map to Leaflet or Mapbox for proper clustering

- [ ] Zoom-based cluster behavior:
  - Zoom in → clusters break apart into smaller clusters or individual markers
  - Zoom out → nearby markers merge back into clusters with counts
- [ ] Cluster circles scale proportionally (cluster of 10 larger than cluster of 2)
- [ ] Click cluster → zoom into that area to see sub-clusters/individual markers
- [ ] Click individual marker → popup with person's name, occupation, organization, link to profile
- [ ] Evaluate using Leaflet + Leaflet.markercluster or Mapbox GL JS for this (built-in clustering) vs extending the custom SVG implementation

---

## P1 — Operational Readiness

### 14. Interaction Tracking / Notes — `feature/interaction-log`
**Files touched:** New migration, `PersonProfile.tsx`, new `components/InteractionLog.tsx`, `supabase.ts` (types)
**Does NOT touch:** Map, Admin, Navigation, filters, edge functions

- [ ] Create migration:
  ```sql
  interactions (
    id uuid PK,
    person_id uuid FK → people,
    interaction_type TEXT,    -- 'email', 'call', 'meeting', 'note', 'event'
    summary TEXT,
    interaction_date DATE,
    created_at TIMESTAMPTZ DEFAULT now()
  )
  ```
- [ ] Build `InteractionLog.tsx` component for profile pages:
  - Chronological list of interactions
  - "+ Add Note" button with simple form (type dropdown, date, summary text)
  - Show "Last contacted: [date]" at top of profile
- [ ] Show "Last contacted" date in `DirectoryGrid.tsx` person cards (if available)

### 15. Onboarding Documentation — `feature/docs`
**Files touched:** New `docs/` directory
**Does NOT touch:** Any source code

- [ ] `docs/SETUP.md` — How to deploy from scratch:
  - Create Supabase project, run migrations, set env vars
  - Deploy edge functions (`supabase functions deploy`)
  - Set up API keys (Gemini, Tavily)
  - Initial data import from Excel/CSV
- [ ] `docs/USER_GUIDE.md` — How to use the platform:
  - Searching and filtering contacts
  - Managing collections
  - Reviewing AI suggestions
  - Exporting data
  - Understanding the admin dashboard
- [ ] `docs/AGENTS.md` — How the AI agent system works:
  - What each agent does
  - How to trigger agents manually
  - How to set up scheduled runs
  - How to monitor costs
  - How to adjust agent parameters
- [ ] `docs/DATA_IMPORT.md` — How to import existing data:
  - Expected CSV format with column descriptions
  - How to handle duplicates
  - Post-import verification steps
  - How to assign sectors and Flemish connections in bulk

### 16. Authentication & Multi-User — `feature/auth`
**Files touched:** New migration, `App.tsx`, `Navigation.tsx`, new `pages/Login.tsx`, `supabase.ts`, all RLS policies
**Impacts:** Every page and component that writes data (broad scope — do last)

- [ ] Enable Supabase Auth (email/password for staff, magic link for professionals)
- [ ] Create `user_profiles` table linking auth users to roles:
  ```sql
  user_profiles (
    id uuid PK references auth.users,
    role TEXT DEFAULT 'viewer',  -- 'admin', 'staff', 'viewer', 'network_member'
    display_name TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
  )
  ```
- [ ] Add login/logout to `Navigation.tsx`
- [ ] Update all RLS policies:
  - Read: all authenticated users (or even anon for network members viewing their own profile)
  - Write (profiles, suggestions): staff + admin only
  - Admin operations (approve suggestions, manage agents): admin only
  - Network members: can edit only their own claimed profile
- [ ] Add `created_by` and `updated_by` columns to key tables for audit trail
- [ ] Profile claiming: allow a network member to link their auth account to a `people` record

---

## P2 — Future Enhancements

### 17. Network Analysis & Visualization — `feature/network-graph`
**Depends on:** `feature/agent-connections` (to have connection data)
**Files touched:** New `components/NetworkGraph.tsx`, `PersonProfile.tsx`, `Dashboard.tsx`

- [ ] Build interactive network graph component (D3 force-directed or vis.js)
- [ ] Show on profile pages: person's immediate connections
- [ ] Full network view option on Dashboard (toggle alongside Map/List)
- [ ] Filter graph by sector, location, Flemish connection
- [ ] Identify bridge nodes (people connecting different clusters)
- [ ] Sector overlap analysis: "who bridges AI and Policy?"

### 18. Geographic Coverage Analysis — `feature/coverage-gaps`
**Files touched:** `Admin.tsx`, new `components/admin/CoverageMap.tsx`

- [ ] Heatmap or choropleth of US showing contact density by state/city
- [ ] Highlight coverage gaps: "15 contacts in Boston, 0 in Houston"
- [ ] Suggest discovery agent searches for underrepresented areas
- [ ] Compare sector distribution across regions

### 19. Notification System — `feature/notifications`
**Depends on:** `feature/auth`, `feature/agent-infra`
**Files touched:** New migration, new edge function, `Navigation.tsx`, `Admin.tsx`

- [ ] In-app notification bell in `Navigation.tsx`
- [ ] Notification types:
  - New profile suggestions awaiting review
  - Agent run completed with summary
  - Stale profiles needing attention
  - Collection member profile updates
- [ ] Optional email digest (weekly summary of agent activity + pending actions)

### 20. Multi-Language Support — `feature/i18n`
**Files touched:** All components with user-facing text

- [ ] Extract all UI strings to translation files (Dutch + English)
- [ ] Language toggle in Navigation
- [ ] Consider: is the data itself bilingual? (Probably English-only since it's about the US network)

---

## Task Dependency Graph

```
(no deps)          feature/unified-search
(no deps)          feature/filter-simplify
(no deps)          feature/collections
(no deps)          feature/export
(no deps)          feature/data-quality
(no deps)          feature/interactive-stats
(no deps)          feature/profile-clickable-tags
(no deps)          feature/search-snippets
(no deps)          feature/map-clustering
(no deps)          feature/interaction-log
(no deps)          feature/docs

feature/agent-infra ─────────────┐
  ├── feature/agent-discovery    │
  ├── feature/agent-verification │ (also needs feature/data-quality)
  └── feature/agent-connections  │
                                 │
feature/auth ────────────────────┘ (do last, touches everything)
  └── feature/notifications

feature/agent-connections
  └── feature/network-graph
```

**Can run in parallel (no dependencies between them):**
- `unified-search` + `filter-simplify` + `collections` + `export` + `data-quality` + `interactive-stats` + `profile-clickable-tags` + `search-snippets` + `map-clustering` + `interaction-log` + `docs`

**Sequential chains:**
- `agent-infra` → then in parallel: `agent-discovery`, `agent-verification`, `agent-connections`
- `agent-connections` → `network-graph`
- `auth` → `notifications`
