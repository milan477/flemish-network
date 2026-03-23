# Flemish Network Navigator: Builder Prompts

Below are prompts for an AI website builder, organized by feature. Each prompt is self-contained and can be submitted independently. Apply them in the order listed, as some build on earlier changes.

---

## 1. Unified Search Bar (Core Change)

**What it does:** Removes the top search bar and the Smart Search chat from the sidebar. Replaces them with a single search bar positioned to the right of the Map/List toggle buttons. This bar accepts both exact name lookups and natural language queries.

### Prompt

```
Restructure the search experience across the app:

1. REMOVE the large search bar from the top navigation ribbon entirely.
2. REMOVE the "Smart Search" section (the chat-like interface) from the right-hand filter sidebar.
3. ADD a new search bar to the right of the "Map" and "List" toggle buttons, in the same horizontal row. It should be prominent and take up most of the remaining width on that row. Use placeholder text: 'Search by name or describe what you're looking for...'

This search bar should handle two types of input:
- If the user types something that looks like a person's name or organization name (short, proper-noun-like), do an exact/fuzzy text match against the names in the database and show results as a dropdown autocomplete list below the search bar.
- If the user types a longer, descriptive natural language query (e.g. "AI researchers in Boston connected to KU Leuven"), treat it as a semantic search query. When the user submits a natural language query:
  a. Use an LLM/AI call to extract structured filter parameters from the query (location, sector, occupation, flemish connection).
  b. Automatically set the corresponding filters in the right-hand filter panel to reflect what was extracted (e.g., if the query mentions "Boston", set the location filter; if it mentions "AI", select "Artificial Intelligence" in the sector filter). The filters should visibly update so the user can see what was interpreted.
  c. ALSO perform a semantic/keyword search over the "About" text descriptions of the people in the filtered results, to rank them by relevance to the full query. This is important because the filters are broad categories, but the query may be specific (e.g. "AI safety" or "commercializing research"). The search should look at the description field of each person's profile and rank matches by how well the description relates to the query.
  d. Display results in the existing list/map view, but sorted by relevance. Under each person's card in the list view, show a short snippet explaining why they matched (e.g. "Works on AI and machine learning at Lawrence Berkeley National Laboratory").

The search bar should also show the active search context as small removable chips/tags below the search bar after a natural language query is processed (e.g. "Location: Boston", "Sector: AI", "Query: AI safety research"). Removing a chip should update the filters and re-run the search. This replaces the need for a chat-based back-and-forth: users refine by adding/removing chips or by typing a new query.

Keep the search bar visible on both the Network page (map/list) and accessible from other pages.
```

---

## 2. Simplify Filter Sidebar

**What it does:** Cleans up the filter panel. Removes Smart Search from it, simplifies Occupation categories, makes Flemish Connection multi-select, and makes filters auto-apply.

### Prompt

```
Update the right-hand filter sidebar on the Network page:

1. REMOVE the "Smart Search" section entirely from the sidebar (it has moved to the main search bar).
2. Keep the "Show" toggles (People / Organizations) as they are.
3. Keep the "Sector" dropdown as is.
4. CHANGE the "Occupation" dropdown. Replace the current long list of occupations with a simplified set of career-stage categories:
   - Student
   - Academic / Researcher
   - Professional
   - Executive / Leadership
   This avoids overlap with the Sector filter. Occupation = career stage, Sector = field of work.
5. CHANGE "Flemish Connection" from a single text search input to a multi-select dropdown or tag-based input. Users should be able to select MULTIPLE connections simultaneously (e.g., "Ghent University" AND "University of Antwerp" at the same time). The dropdown should list all available Flemish Connections from the database as options. Results should show people matching ANY of the selected connections (OR logic).
6. REMOVE the "Apply Filters" button. Instead, make all filters auto-apply: whenever any filter value is changed (toggled, selected, deselected), immediately re-filter the results and update the map/list view. Show a brief loading indicator if needed.
7. Keep the "Available for lectures" checkbox, also auto-applying.
8. At the bottom of the filter sidebar, keep the stats summary (People count, Organizations count, Cities count) and update them live as filters change.
```

---

## 3. Remove Missions / Replace with Collections

**What it does:** Replaces the "Missions" tab and planner with a lightweight "Collections" feature for saving groups of contacts.

### Prompt

```
Replace the "Missions" feature with a simpler "Collections" feature:

1. RENAME the "Missions" tab in the top navigation to "Collections".
2. REMOVE the entire Mission Planner page (the one with "Create a New Plan" form, event types, topic matching, progress tracking, etc.).
3. REPLACE it with a simple Collections page:
   - Header: "Collections" with subtitle "Save and organize groups of contacts"
   - A "+ New Collection" button in the top right
   - Display existing collections as cards in a grid layout. Each card shows:
     - Collection name (user-defined, e.g. "AI Panel Speakers", "Contacts for LA Mission")
     - Optional short description/notes
     - Number of people in the collection
     - Date created
     - A small preview of the first few profile avatars/initials
   - Clicking a collection card opens it and shows the list of people in it, with options to remove individuals or add notes per person.

4. Creating a new collection: clicking "+ New Collection" shows a simple modal/form with:
   - Name (required)
   - Description (optional)
   - That's it. No event type, no topic, no dates, no location, no progress tracking.

5. Adding people to collections: On person profile cards (in search results list view and on individual profile pages), add a small icon button (e.g. a bookmark or folder icon). Clicking it opens a dropdown showing existing collections with checkboxes so the user can add/remove that person from any collection. Also include a "Create new collection" option at the bottom of that dropdown.

6. On the Collections page, each collection should have an option to "Search similar" which takes the descriptions of the people in the collection and uses them to find other similar people in the network (using the same semantic search as the main search bar).
```

---

## 4. Map Cluster Scaling

**What it does:** Fixes the map so that cluster circles scale properly when zooming and break apart into individual markers at higher zoom levels.

### Prompt

```
Fix the map clustering behavior on the Network page:

1. When the user zooms INTO the map, cluster circles (the yellow circles with numbers like "4" for Seattle or "3" for Berkeley) should break apart into smaller clusters or individual markers as the zoom level increases. At a high enough zoom level, each person/organization should appear as its own individual marker pin.
2. When the user zooms OUT, nearby individual markers should merge back into cluster circles with counts.
3. The cluster circles should scale in size proportionally: a cluster of 10 should be noticeably larger than a cluster of 2.
4. Clicking on a cluster circle should zoom into that area enough to see the individual markers or sub-clusters within it.
5. Clicking on an individual marker should show a popup/tooltip with the person's name, occupation, and organization, with a link to their full profile.

If you're using a mapping library like Leaflet or Mapbox, use its built-in marker clustering plugin (e.g., Leaflet.markercluster or Mapbox's cluster source) rather than a custom implementation. These handle the zoom-based clustering behavior automatically.
```

---

## 5. Interactive Stats Dashboard

**What it does:** Makes the Stats/Admin Dashboard interactive so clicking on any data point cross-filters the other visualizations.

### Prompt

```
Make the Stats / Admin Dashboard interactive with cross-filtering:

1. Every data bar, label, or count in the dashboard should be clickable.
2. When a user clicks on a data point (e.g., "Finance" under "Profiles by Sector"), the OTHER charts and lists on the dashboard should update to show data filtered by that selection. For example:
   - Click "Finance" in Profiles by Sector: "Occupations Overview" updates to show only the occupations of people in Finance, "Top Locations" updates to show where finance people are located, and the summary counts at the top (Total People, Organizations, Cities) update to reflect only the finance-filtered subset.
   - Click "Boston, MA" in Top Locations: Sector and Occupation charts update to show the distribution of people in Boston only.
   - Click "Researchers" in Occupations: Sector and Location charts update accordingly.
3. Show the active filter as a visible chip/tag at the top of the dashboard (e.g., "Filtered by: Sector = Finance"). Clicking the X on the chip clears the filter and returns to the full view.
4. Clicking a data point that is already the active filter should deselect it (toggle behavior).
5. Optionally: allow clicking a data point to navigate to the Network tab with the corresponding filter pre-applied. For example, clicking "Finance" in the stats view could show a small "View in Network" link that takes the user to the Network page with Sector set to Finance.
6. Add hover effects on all clickable data elements (cursor pointer, subtle highlight) so users know they can interact.
```

---

## 6. Profile Page: Clickable Tags

**What it does:** Makes sector tags and Flemish Connection entries on profile pages clickable, linking back to filtered network views.

### Prompt

```
On individual profile pages (like the person detail view), make the following elements clickable:

1. Sector & Expertise tags (e.g., "Artificial Intelligence", "Research"): clicking a tag should navigate to the Network page with the corresponding sector filter pre-selected, showing all people in that sector.
2. Flemish Connection entries (e.g., "Fayat Scholarship Laureate", "University of Antwerp"): clicking an entry should navigate to the Network page with that Flemish Connection selected in the filter, showing all people with the same connection.
3. Location (e.g., "Berkeley, CA"): clicking the location should navigate to the Network page with the map centered on that city and filtered to show people in that location.
4. Style these clickable elements with a subtle underline or hover effect so users know they are interactive, but keep the current tag/badge visual style.
```

---

## 7. Search Result Relevance Snippets

**What it does:** Adds explanatory snippets to search results when a natural language query is used.

### Prompt

```
When search results are shown after a natural language query in the unified search bar, enhance each person's card in the list view:

1. Below the person's name, occupation, and location, add a small italic text line showing WHY they matched the query. This should be a short snippet (1 sentence max) extracted or summarized from their "About" description that is most relevant to the search query. For example:
   - Query: "AI safety researcher for a panel"
   - Snippet under a result: "Works on machine learning and AI at Lawrence Berkeley National Laboratory"
2. If the match was only based on structured filters (sector, location, etc.) and not the description, show the matching filter values instead (e.g., "Matched: Sector = AI, Location = Boston").
3. The snippet should be visually distinct from the rest of the card (smaller font, gray color, italic) so it's informative but not distracting.
4. Only show these snippets when a natural language search was performed. For regular name searches or filter-only browsing, don't show snippets.
```

---

## Notes for the builder

These prompts assume the app is a prototype with a relatively simple backend. For the semantic search functionality (natural language queries searching over profile descriptions), a simple implementation approach would be:
- Use an LLM API call (e.g. OpenAI or Anthropic) to extract structured filters from the natural language query.
- Use basic keyword/text matching or a simple embedding similarity search over the "About" fields to rank results. For a prototype with <100 profiles, even a simple keyword overlap approach works.
- As the database scales to 1000+ profiles, consider storing vector embeddings of the "About" texts and using cosine similarity for ranking.
