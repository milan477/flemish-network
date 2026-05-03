# User Feedback Backlog

## 2026-04-30 - Network Search Refinement

Source comment, Dutch:
> Mogelijkheid om zoekopdracht binnen het netwerk te verfijnen? (i.e.: alle elementen moeten overlappen, slechts 1 element moet overlappen etc..)

Interpretation:
- Users want explicit control over how strict a network search should be when a query contains multiple criteria.
- Example modes: require all detected criteria to overlap, require at least one criterion to overlap, or rank broader semantic matches.

Current behavior:
- Dashboard search calls `hybridSearch()` in `src/lib/aiService.ts`, which invokes the `search-people` Edge Function.
- `search-people` parses the query into structured keywords, classifies the route as `direct_lookup`, `faceted`, or `exploratory`, and fuses lexical, person-vector, and chunk-vector candidates.
- Dashboard filters derived from `parseFiltersFromQuery()` are applied separately in `src/pages/Dashboard.tsx`.
- Existing behavior is mostly implicit: faceted filters are AND-like in some UI filter paths, but hybrid search ranking can return partial-overlap matches because it is optimized for recall.

Actionable suggestion:
- Add an explicit "match criteria" control to the network UI.
- Suggested options:
  - `All`: only return people matching every active criterion.
  - `Any`: return people matching at least one active criterion, with stronger matches ranked higher.
- Default to `All`.
- Treat text-search-derived criteria and manual filters consistently. If the active criteria are `KU Leuven + Biotech + Boston`, `All` means all three must match and `Any` means at least one must match, regardless of whether those criteria came from the search box or filter controls.
- Keep the mode shared across map and list views because both views are presentations of the same result set.
- Show the control only when it can change the result set:
  - Hide it for 0 active criteria.
  - Hide or disable it for 1 active criterion because `All` and `Any` are equivalent.
  - Show it for 2+ active criteria.
- Suggested UI label: `Match criteria: All | Any`.
- Place it near the result/search summary, not as a map-only or list-only option.
- In list view, show it above the results near the result count.
- In map view, show it in the map/sidebar search summary area rather than floating over the map.
- Pass the selected mode through the relevant dashboard filtering/search path and through `hybridSearch(query, maxResults, matchMode)` to `search-people` when a text search is active.
- In `search-people`, compute per-person structured criterion coverage from extracted keywords and `people_search_documents`, then filter or boost according to the selected mode.

Implementation notes:
- Start with structured facets only: sector, occupation, location city/state, Flemish connection, and current position. Leave full-text bio/vector semantics in ranking, not hard filtering.
- Add tests for multi-facet queries such as `KU Leuven biotech people in Boston`, covering `All` and `Any` modes.

## 2026-05-01 - Excel-Friendly Result Export

**FIXED**

Source comment, Dutch:
> Als ik resultaten van een zoekopdracht wil exporteren in een CSV krijg ik een vrij structuurloze Excel terug flemish-network-export (1).csv

Interpretation:
- This is a regional Excel delimiter issue, not necessarily a malformed CSV export.
- On Belgian/Dutch regional settings, Excel commonly expects semicolon-separated CSV files because commas are used as decimal separators.
- The current comma-separated CSV can therefore open with all values crammed into one column when the user double-clicks the file.

Current behavior:
- Result exports are exposed as `Export CSV`.
- The exported file is a comma-separated `.csv`, which is useful for technical users and should remain unchanged.
- Non-technical users may reasonably expect the downloaded file to open cleanly in Excel without using Excel's manual import flow.

Actionable suggestion:
- Replace the single `Export CSV` button with an export dropdown.
- Suggested options:
  - `Excel (.xlsx)`: default / first option for delegation users.
  - `CSV (.csv)`: keep the current comma-separated format for technical users and integrations.
- Preserve the current CSV delimiter and structure so existing technical workflows do not change.
- Add a native `.xlsx` export path that opens directly in Excel with proper columns across regional settings.
- Use the same dropdown pattern anywhere result/member exports appear, including search results and collection exports.

Implementation notes:
- The project already uses the `xlsx` package for import/template flows, so reuse that dependency for result exports if practical.
- Keep filenames aligned with the current CSV names, changing only the extension for Excel exports.
- Test with representative fields containing commas, semicolons, quotes, line breaks, URLs, and accented characters.

## 2026-05-01 - US-Based vs US-Connected People

Source comment, Dutch:
> Wat als je een Vlaming/Belg approved die niet in de USA woont (behalve als het de bedoeling is dat we zulke personen ook opnemen in de database). Eg: Jan Wouters, gewoon hoogleraar en leerstoelhouder aan de KUL; kwam terug in een search gezien hij aan Yale heeft gestudeerd. Wat gebeurt er als ik hem approve? Waar/wanneer komt hij dan terug als zoekresultaat (i.e. waar op de map verschijnt hij dan à Yale?) Moet dat telkens handmatig gecontroleerd worden alvorens nieuwe zoekresultaten toegevoegd worden of wordt dat gecrosscheckt door AI-agents? Halen zij hem er dan al dan niet zelf uit?

Interpretation:
- The app is focused on the United States, but not every relevant person necessarily lives or works in the United States.
- Restricting the network to current US residents would exclude valuable Belgian/Flemish people with meaningful US ties.
- Including US-connected people abroad creates a UX risk: the app must not imply that someone is based at a US location simply because they studied, worked, invested, collaborated, or held another connection there.

Recommended product direction:
- Keep the directory scope broad enough to include both US-based people and people abroad with meaningful US connections.
- Do not add extra map modes for this distinction.
- Instead, model map locations as containing different relationship types:
  - `Based people`: people currently living or working at that location.
  - `Based companies`: companies or organizations located there.
  - `Connected people`: people not based there, but meaningfully connected to that location.
- In map popups, separate these groups clearly so a connected person is not visually presented as living or working there.
- Example: Yale/New Haven may show Jan Wouters under `Connected people`, with context such as `Yale alumnus · Based in Leuven, Belgium`.

List view suggestion:
- Keep the person-card label simple.
- For people currently in the United States, show the concrete current location:
  - `Based in New York, NY`
  - `Based in Boston, MA`
- For people abroad who are relevant because of one or more US ties, show a broader status:
  - `Connected to US`
- Do not force the card-level label to name only one US connection, because some people will have multiple meaningful US connections.
- The detailed profile can still list multiple US connections separately.

Actionable suggestion:
- Add or expose a person-level scope/status concept that can distinguish:
  - `US-based`
  - `US-connected abroad`
  - `Location unclear / needs review`
- During approval, ambiguous people should not be approved into the network without classifying whether they are US-based or US-connected abroad.
- Approval UI should make this explicit with actions such as:
  - `Approve as US-based`
  - `Approve as US-connected abroad`
  - `Needs review`
  - `Reject / out of scope`
- Search results should be allowed to include both US-based and US-connected-abroad people, but the card and map presentation must make the distinction visible.

Open product question:
- Define what counts as a "meaningful US connection" for inclusion. Examples may include US education, current or former US employment, board roles, research collaborations, investments, government/diplomatic roles, institutional partnerships, or recurring professional activity in the US.
