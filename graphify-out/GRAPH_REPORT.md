# Graph Report - .  (2026-04-27)

## Corpus Check
- 105 files · ~145,113 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 889 nodes · 2041 edges · 52 communities detected
- Extraction: 93% EXTRACTED · 7% INFERRED · 0% AMBIGUOUS · INFERRED: 149 edges (avg confidence: 0.8)
- Token cost: 512 input · 220 output

## Community Hubs (Navigation)
- [[_COMMUNITY_AI Platform Docs & Schema|AI Platform Docs & Schema]]
- [[_COMMUNITY_Edge Function Shared Helpers|Edge Function Shared Helpers]]
- [[_COMMUNITY_Agent Discovery Crawler|Agent Discovery Crawler]]
- [[_COMMUNITY_Verification & Apify Client|Verification & Apify Client]]
- [[_COMMUNITY_Contact Management UI|Contact Management UI]]
- [[_COMMUNITY_Embedding Generation Pipeline|Embedding Generation Pipeline]]
- [[_COMMUNITY_Search & AI Contracts|Search & AI Contracts]]
- [[_COMMUNITY_Geocoding & Derived Labels|Geocoding & Derived Labels]]
- [[_COMMUNITY_Dashboard Routing & Locations|Dashboard Routing & Locations]]
- [[_COMMUNITY_AI Service & Collections UI|AI Service & Collections UI]]
- [[_COMMUNITY_Flemish Connections & Person Profile|Flemish Connections & Person Profile]]
- [[_COMMUNITY_CSV Import Pipeline|CSV Import Pipeline]]
- [[_COMMUNITY_Web Page Harvester|Web Page Harvester]]
- [[_COMMUNITY_Profile Suggestion Review|Profile Suggestion Review]]
- [[_COMMUNITY_React App & Auth|React App & Auth]]
- [[_COMMUNITY_Derived Labels Admin UI|Derived Labels Admin UI]]
- [[_COMMUNITY_Export Service|Export Service]]
- [[_COMMUNITY_Test Fixtures Generator|Test Fixtures Generator]]
- [[_COMMUNITY_Interactive Stats Overview|Interactive Stats Overview]]
- [[_COMMUNITY_Dashboard Session Cache|Dashboard Session Cache]]
- [[_COMMUNITY_Organization Profile|Organization Profile]]
- [[_COMMUNITY_Connection Graph Modal|Connection Graph Modal]]
- [[_COMMUNITY_Unified Search Bar|Unified Search Bar]]
- [[_COMMUNITY_Map Visualization|Map Visualization]]
- [[_COMMUNITY_Flemish Connection Selector|Flemish Connection Selector]]
- [[_COMMUNITY_Ops Metrics Panel|Ops Metrics Panel]]
- [[_COMMUNITY_Agent Run Dashboard|Agent Run Dashboard]]
- [[_COMMUNITY_Discovery Planning Panel|Discovery Planning Panel]]
- [[_COMMUNITY_Add Contact Page|Add Contact Page]]
- [[_COMMUNITY_Access Management Panel|Access Management Panel]]
- [[_COMMUNITY_Add to Collection Dropdown|Add to Collection Dropdown]]
- [[_COMMUNITY_Stale Contacts Bar|Stale Contacts Bar]]
- [[_COMMUNITY_Connections Summary|Connections Summary]]
- [[_COMMUNITY_Stats Shared Utils|Stats Shared Utils]]
- [[_COMMUNITY_Occupation Overview|Occupation Overview]]
- [[_COMMUNITY_City Search Component|City Search Component]]
- [[_COMMUNITY_Flemish Connection Chart|Flemish Connection Chart]]
- [[_COMMUNITY_Duplicate Compare|Duplicate Compare]]
- [[_COMMUNITY_Availability Overview|Availability Overview]]
- [[_COMMUNITY_Collections Page|Collections Page]]
- [[_COMMUNITY_Migration Generator Script|Migration Generator Script]]
- [[_COMMUNITY_Search Benchmark Script|Search Benchmark Script]]
- [[_COMMUNITY_Filter Panel|Filter Panel]]
- [[_COMMUNITY_Navigation Component|Navigation Component]]
- [[_COMMUNITY_Contact Card|Contact Card]]
- [[_COMMUNITY_Filter Parser|Filter Parser]]
- [[_COMMUNITY_Account Page|Account Page]]
- [[_COMMUNITY_USA Map Asset|USA Map Asset]]
- [[_COMMUNITY_Navigation Source Node|Navigation Source Node]]
- [[_COMMUNITY_Supabase Client|Supabase Client]]
- [[_COMMUNITY_Search Clicks Table|Search Clicks Table]]
- [[_COMMUNITY_No State Library Rationale|No State Library Rationale]]

## God Nodes (most connected - your core abstractions)
1. `Platform AI Strategy TODO Backlog` - 36 edges
2. `Database Schema Reference` - 24 edges
3. `processFrontierRow()` - 22 edges
4. `set()` - 21 edges
5. `normalizeWhitespace()` - 21 edges
6. `AI Pipeline Reference` - 21 edges
7. `safeString()` - 20 edges
8. `safeStr()` - 19 edges
9. `Edge Function: agent-discovery` - 16 edges
10. `CLAUDE.md (Project Instructions)` - 15 edges

## Surprising Connections (you probably didn't know these)
- `Platform AI Strategy TODO Backlog` --references--> `src/pages/Dashboard.tsx`  [EXTRACTED]
  todo.md → src/pages/Dashboard.tsx
- `Platform AI Strategy TODO Backlog` --references--> `src/pages/Admin.tsx`  [EXTRACTED]
  todo.md → src/pages/Admin.tsx
- `Platform AI Strategy TODO Backlog` --references--> `src/lib/dashboardSession.ts`  [EXTRACTED]
  todo.md → src/lib/dashboardSession.ts
- `Platform AI Strategy TODO Backlog` --references--> `src/lib/appRouting.ts`  [EXTRACTED]
  todo.md → src/lib/appRouting.ts
- `Platform AI Strategy TODO Backlog` --references--> `src/lib/auth.tsx (AuthProvider)`  [EXTRACTED]
  todo.md → src/lib/auth.tsx

## Hyperedges (group relationships)
- **Core Discovery Pipeline: agent-discovery + frontier + evidence + source packs** — fn_agent_discovery, table_discovery_frontier, table_discovery_evidence, table_discovery_source_packs, table_discovery_domains, table_discovered_contacts [EXTRACTED 0.95]
- **Hybrid Search Pipeline: search-people + lexical + vector + chunk RPCs** — fn_search_people, rpc_search_people_lexical, rpc_match_people, rpc_match_person_text_chunks, table_people_search_documents [EXTRACTED 0.95]
- **Verification Unification: shared core used by update-profile and agent-verify** — shared_verification, fn_update_profile, fn_agent_verify, table_profile_suggestions [EXTRACTED 0.92]

## Communities

### Community 0 - "AI Platform Docs & Schema"
Cohesion: 0.04
Nodes (108): AGENTS.md (Graphify Rules), AI Pipeline Reference, AI Strategy Document, Phase 0 Benchmarks README, CLAUDE.md (Project Instructions), Concept: Bio-Chunk Vectors, Concept: Discovery Frontier Crawler, Concept: Domain Yield Learning (+100 more)

### Community 1 - "Edge Function Shared Helpers"
Cohesion: 0.06
Nodes (60): createAdminClient(), getUserDisplayName(), HttpError, normalizeEmail(), requireStaffRole(), callGemini(), checkDuplicates(), handleDiscoverContactsRequest() (+52 more)

### Community 2 - "Agent Discovery Crawler"
Cohesion: 0.09
Nodes (75): safeString(), normalizeWhitespace(), buildCandidateKey(), buildCoverageTargetKeys(), buildHarvestFrontierRows(), buildPivotSeedQueries(), buildSeedPlans(), bumpDomainStats() (+67 more)

### Community 3 - "Verification & Apify Client"
Cohesion: 0.12
Nodes (47): ApifyError, fetchWithRetry(), getApifyUsage(), runApifyActor(), runAsync(), runSync(), buildDedupeKey(), buildLinkedInCurrentPosition() (+39 more)

### Community 4 - "Contact Management UI"
Cohesion: 0.08
Nodes (34): async(), checkDuplicate(), ensureProtocol(), handleSubmit(), insertContact(), normalizeConnectionName(), reconcileConnections(), toggleSector() (+26 more)

### Community 5 - "Embedding Generation Pipeline"
Cohesion: 0.13
Nodes (39): appendLabeledLine(), buildBioChunks(), buildPersonTextChunks(), buildStructuredEmbeddingText(), cancelAsyncEmbeddingBatch(), createAsyncEmbeddingBatch(), embedBatch(), embedSingle() (+31 more)

### Community 6 - "Search & AI Contracts"
Cohesion: 0.12
Nodes (35): buildCheckProfilePrompt(), buildMergeTextPrompt(), buildParseContactsPrompt(), buildSearchPrompt(), getAiAgentTaskDefinition(), getAiAgentTasks(), getEmptyFlemishSearchKeywords(), getEmptySmartSearchKeywords() (+27 more)

### Community 7 - "Geocoding & Derived Labels"
Cohesion: 0.19
Nodes (28): buildDedupeKey(), buildDiscoveryDerivedLabels(), buildLocationSeed(), buildSubjectKey(), buildVerificationDerivedLabels(), clampConfidence(), deriveProfileConfidence(), deriveSourceQuality() (+20 more)

### Community 8 - "Dashboard Routing & Locations"
Cohesion: 0.12
Nodes (21): set(), buildDashboardLocation(), buildDashboardSearchParams(), buildDashboardStateFromPreset(), defaultDashboardRouteState(), getCurrentPageFromPathname(), normalizePage(), parseBooleanParam() (+13 more)

### Community 9 - "AI Service & Collections UI"
Cohesion: 0.14
Nodes (23): buildFallbackKeywords(), buildFallbackTerms(), callAI(), discoverContacts(), flemishSearch(), hybridSearch(), logSearchClick(), parseContacts() (+15 more)

### Community 10 - "Flemish Connections & Person Profile"
Cohesion: 0.16
Nodes (25): canonicalizeFlemishConnection(), countWords(), extractFlemishConnectionsFromText(), flattenPersonFlemishConnections(), getPersonFlemishConnectionNames(), getPersonFlemishConnections(), getPersonFlemishConnectionText(), inferFlemishConnectionType() (+17 more)

### Community 11 - "CSV Import Pipeline"
Cohesion: 0.16
Nodes (23): buildSectorLookup(), checkDuplicates(), confidenceLabel(), handleBulkSectorAssign(), handleCancelImport(), handleConfirm(), handleFile(), handleImport() (+15 more)

### Community 12 - "Web Page Harvester"
Cohesion: 0.24
Nodes (23): canonicalizeUrl(), clamp(), classifyPageHeuristically(), countPatternMatches(), decodeXmlEntities(), extractCanonicalHref(), extractDomain(), extractFeedItemUrls() (+15 more)

### Community 13 - "Profile Suggestion Review"
Cohesion: 0.15
Nodes (19): applySelected(), getRiskClasses(), runSearch(), toggleField(), approveAll(), approveSelected(), approveSuggestion(), getRiskClasses() (+11 more)

### Community 14 - "React App & Auth"
Cohesion: 0.16
Nodes (13): App(), CollectionDetailRoute(), CollectionsIndexRoute(), OrganizationProfileRoute(), ProtectedLayout(), AuthProvider(), FullScreenSpinner(), loadApprovedStaffUser() (+5 more)

### Community 15 - "Derived Labels Admin UI"
Cohesion: 0.29
Nodes (8): formatDerivedLabelConfidence(), getDerivedLabelBadgeClasses(), getDerivedLabelMetadata(), getDerivedLocationSummary(), isCanonicalDerivedLabel(), normalizeDerivedLabelSuggestions(), approveLabel(), rejectLabel()

### Community 16 - "Export Service"
Cohesion: 0.31
Nodes (7): handleExport(), downloadFile(), escapeCsvField(), escapeHtml(), exportPeopleToCsv(), personToCsvRow(), printCollectionBriefing()

### Community 17 - "Test Fixtures Generator"
Cohesion: 0.45
Nodes (9): buildBio(), csvEscape(), generateName(), occupationFor(), pick(), rowFor(), slugify(), titleFor() (+1 more)

### Community 18 - "Interactive Stats Overview"
Cohesion: 0.36
Nodes (8): buildCityKey(), buildCounts(), countUniqueBy(), formatBatchDate(), formatBatchNumber(), hasText(), parseCityKey(), StatCard()

### Community 19 - "Dashboard Session Cache"
Cohesion: 0.56
Nodes (8): canUseSessionStorage(), getCachedDashboardSearch(), getLastDashboardLocation(), normalizeQuery(), readSearchCache(), setCachedDashboardSearch(), setLastDashboardLocation(), writeSearchCache()

### Community 20 - "Organization Profile"
Cohesion: 0.4
Nodes (8): cancelEditing(), ensureProtocol(), handleAddCustomFlemish(), saveEdits(), setField(), startEditing(), toggleEditFlemish(), toggleEditSector()

### Community 21 - "Connection Graph Modal"
Cohesion: 0.48
Nodes (5): describeEdgePath(), formatRelationshipType(), getNodePosition(), getRelationshipClasses(), getTooltipPlacement()

### Community 22 - "Unified Search Bar"
Cohesion: 0.53
Nodes (4): handleClear(), handler(), handleSubmit(), handleSuggestionClick()

### Community 23 - "Map Visualization"
Cohesion: 0.53
Nodes (4): MapController(), resetView(), zoomIn(), zoomOut()

### Community 24 - "Flemish Connection Selector"
Cohesion: 0.73
Nodes (4): addExisting(), handleCreate(), normalizeName(), removeSelected()

### Community 25 - "Ops Metrics Panel"
Cohesion: 0.53
Nodes (4): formatMetricValue(), formatModelChain(), isPreviewModel(), OpsMetricsPanel()

### Community 26 - "Agent Run Dashboard"
Cohesion: 0.53
Nodes (4): formatDate(), formatDuration(), getQuota(), summarizeResults()

### Community 27 - "Discovery Planning Panel"
Cohesion: 0.53
Nodes (4): formatDate(), formatNumber(), formatScore(), ScrollablePlanningCard()

### Community 28 - "Add Contact Page"
Cohesion: 0.33
Nodes (2): AddContact(), useSmartBack()

### Community 29 - "Access Management Panel"
Cohesion: 0.53
Nodes (4): formatDate(), handleInvite(), handleSaveRow(), updateDraft()

### Community 30 - "Add to Collection Dropdown"
Cohesion: 0.6
Nodes (3): handleClickOutside(), handleCreateCollection(), toggleCollection()

### Community 31 - "Stale Contacts Bar"
Cohesion: 0.6
Nodes (3): daysSince(), handleCheckAll(), handleConfirmCurrent()

### Community 32 - "Connections Summary"
Cohesion: 0.8
Nodes (3): ConnectionsSummary(), countCollectionCoverage(), summarizeConnections()

### Community 33 - "Stats Shared Utils"
Cohesion: 0.7
Nodes (3): buildNetworkPreset(), getFreshnessTier(), mapCategoryToNetworkOccupation()

### Community 34 - "Occupation Overview"
Cohesion: 0.7
Nodes (3): buildCategoryCounts(), classifyPerson(), OccupationOverview()

### Community 35 - "City Search Component"
Cohesion: 0.67
Nodes (2): handleClickOutside(), handleSelect()

### Community 36 - "Flemish Connection Chart"
Cohesion: 0.83
Nodes (2): buildCounts(), FlemishConnectionChart()

### Community 37 - "Duplicate Compare"
Cohesion: 0.67
Nodes (2): DuplicateCompare(), getVal()

### Community 38 - "Availability Overview"
Cohesion: 0.83
Nodes (2): AvailabilityOverview(), countMatches()

### Community 39 - "Collections Page"
Cohesion: 0.67
Nodes (2): handleCreateNew(), handleSaveCollection()

### Community 40 - "Migration Generator Script"
Cohesion: 0.67
Nodes (1): processLineByLine()

### Community 41 - "Search Benchmark Script"
Cohesion: 0.67
Nodes (1): parseArgs()

### Community 42 - "Filter Panel"
Cohesion: 0.67
Nodes (1): handleReset()

### Community 43 - "Navigation Component"
Cohesion: 0.67
Nodes (1): handleClickOutside()

### Community 44 - "Contact Card"
Cohesion: 0.67
Nodes (1): ContactCardEdit()

### Community 45 - "Filter Parser"
Cohesion: 0.67
Nodes (1): parseFiltersFromQuery()

### Community 46 - "Account Page"
Cohesion: 0.67
Nodes (1): handleSave()

### Community 47 - "USA Map Asset"
Cohesion: 1.0
Nodes (3): Geographic Visualization Asset, Leaflet Map Component, USA Blank State Map (SVG-style)

### Community 68 - "Navigation Source Node"
Cohesion: 1.0
Nodes (1): src/components/Navigation.tsx

### Community 69 - "Supabase Client"
Cohesion: 1.0
Nodes (1): src/lib/supabase.ts (DB Types)

### Community 70 - "Search Clicks Table"
Cohesion: 1.0
Nodes (1): DB Table: search_clicks

### Community 71 - "No State Library Rationale"
Cohesion: 1.0
Nodes (1): Rationale: No State Management Library

## Knowledge Gaps
- **34 isolated node(s):** `index.html (App Entry Point)`, `AGENTS.md (Graphify Rules)`, `src/pages/Dashboard.tsx`, `src/pages/Admin.tsx`, `src/pages/Login.tsx` (+29 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Add Contact Page`** (6 nodes): `AddContact()`, `useSmartBack.ts`, `AddContact.tsx`, `useSmartBack.ts`, `AddContact.tsx`, `useSmartBack()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `City Search Component`** (4 nodes): `handleClickOutside()`, `handleSelect()`, `CitySearch.tsx`, `CitySearch.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Flemish Connection Chart`** (4 nodes): `buildCounts()`, `FlemishConnectionChart()`, `FlemishConnectionChart.tsx`, `FlemishConnectionChart.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Duplicate Compare`** (4 nodes): `DuplicateCompare()`, `getVal()`, `DuplicateCompare.tsx`, `DuplicateCompare.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Availability Overview`** (4 nodes): `AvailabilityOverview()`, `countMatches()`, `AvailabilityOverview.tsx`, `AvailabilityOverview.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Collections Page`** (4 nodes): `handleCreateNew()`, `handleSaveCollection()`, `Collections.tsx`, `Collections.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Migration Generator Script`** (3 nodes): `generate_migration.js`, `processLineByLine()`, `generate_migration.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Search Benchmark Script`** (3 nodes): `parseArgs()`, `benchmark_search.ts`, `benchmark_search.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Filter Panel`** (3 nodes): `handleReset()`, `FilterPanel.tsx`, `FilterPanel.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Navigation Component`** (3 nodes): `handleClickOutside()`, `Navigation.tsx`, `Navigation.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Contact Card`** (3 nodes): `ContactCardEdit()`, `ContactCard.tsx`, `ContactCard.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Filter Parser`** (3 nodes): `parseFiltersFromQuery()`, `filterParser.ts`, `filterParser.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Account Page`** (3 nodes): `handleSave()`, `Account.tsx`, `Account.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Navigation Source Node`** (1 nodes): `src/components/Navigation.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Supabase Client`** (1 nodes): `src/lib/supabase.ts (DB Types)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Search Clicks Table`** (1 nodes): `DB Table: search_clicks`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `No State Library Rationale`** (1 nodes): `Rationale: No State Management Library`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `set()` connect `Dashboard Routing & Locations` to `Edge Function Shared Helpers`, `Agent Discovery Crawler`, `Verification & Apify Client`, `Contact Management UI`, `Embedding Generation Pipeline`, `Geocoding & Derived Labels`, `Flemish Connections & Person Profile`, `CSV Import Pipeline`, `Export Service`?**
  _High betweenness centrality (0.362) - this node is a cross-community bridge._
- **Why does `getCurrentPageFromPathname()` connect `Dashboard Routing & Locations` to `React App & Auth`?**
  _High betweenness centrality (0.187) - this node is a cross-community bridge._
- **Are the 3 inferred relationships involving `processFrontierRow()` (e.g. with `fetchPage()` and `classifyPageHeuristically()`) actually correct?**
  _`processFrontierRow()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **Are the 19 inferred relationships involving `set()` (e.g. with `saveFrontierSeeds()` and `maybeGenerateConnectionSuggestions()`) actually correct?**
  _`set()` has 19 INFERRED edges - model-reasoned connections that need verification._
- **Are the 17 inferred relationships involving `normalizeWhitespace()` (e.g. with `normalizeName()` and `normalizeEmail()`) actually correct?**
  _`normalizeWhitespace()` has 17 INFERRED edges - model-reasoned connections that need verification._
- **What connects `index.html (App Entry Point)`, `AGENTS.md (Graphify Rules)`, `src/pages/Dashboard.tsx` to the rest of the system?**
  _34 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `AI Platform Docs & Schema` be split into smaller, more focused modules?**
  _Cohesion score 0.04 - nodes in this community are weakly interconnected._