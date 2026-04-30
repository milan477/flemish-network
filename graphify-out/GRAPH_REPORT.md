# Graph Report - flemish-network  (2026-04-28)

## Corpus Check
- 114 files · ~152,675 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 707 nodes · 1043 edges · 80 communities detected
- Extraction: 89% EXTRACTED · 11% INFERRED · 0% AMBIGUOUS · INFERRED: 115 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 64|Community 64]]
- [[_COMMUNITY_Community 65|Community 65]]
- [[_COMMUNITY_Community 66|Community 66]]
- [[_COMMUNITY_Community 67|Community 67]]
- [[_COMMUNITY_Community 69|Community 69]]
- [[_COMMUNITY_Community 73|Community 73]]
- [[_COMMUNITY_Community 74|Community 74]]
- [[_COMMUNITY_Community 75|Community 75]]
- [[_COMMUNITY_Community 76|Community 76]]
- [[_COMMUNITY_Community 77|Community 77]]
- [[_COMMUNITY_Community 78|Community 78]]
- [[_COMMUNITY_Community 79|Community 79]]
- [[_COMMUNITY_Community 82|Community 82]]
- [[_COMMUNITY_Community 83|Community 83]]
- [[_COMMUNITY_Community 84|Community 84]]
- [[_COMMUNITY_Community 85|Community 85]]
- [[_COMMUNITY_Community 87|Community 87]]
- [[_COMMUNITY_Community 88|Community 88]]
- [[_COMMUNITY_Community 89|Community 89]]
- [[_COMMUNITY_Community 90|Community 90]]
- [[_COMMUNITY_Community 91|Community 91]]
- [[_COMMUNITY_Community 92|Community 92]]
- [[_COMMUNITY_Community 93|Community 93]]
- [[_COMMUNITY_Community 94|Community 94]]
- [[_COMMUNITY_Community 95|Community 95]]
- [[_COMMUNITY_Community 96|Community 96]]
- [[_COMMUNITY_Community 97|Community 97]]
- [[_COMMUNITY_Community 98|Community 98]]
- [[_COMMUNITY_Community 99|Community 99]]
- [[_COMMUNITY_Community 100|Community 100]]
- [[_COMMUNITY_Community 101|Community 101]]
- [[_COMMUNITY_Community 102|Community 102]]
- [[_COMMUNITY_Community 103|Community 103]]
- [[_COMMUNITY_Community 104|Community 104]]
- [[_COMMUNITY_Community 105|Community 105]]
- [[_COMMUNITY_Community 106|Community 106]]
- [[_COMMUNITY_Community 107|Community 107]]
- [[_COMMUNITY_Community 108|Community 108]]
- [[_COMMUNITY_Community 109|Community 109]]
- [[_COMMUNITY_Community 110|Community 110]]
- [[_COMMUNITY_Community 111|Community 111]]
- [[_COMMUNITY_Community 112|Community 112]]

## God Nodes (most connected - your core abstractions)
1. `normalizeWhitespace()` - 25 edges
2. `processFrontierRow()` - 21 edges
3. `safeString()` - 19 edges
4. `notifyError()` - 13 edges
5. `maybeHarvestProvenDomain()` - 11 edges
6. `buildLocationSeed()` - 10 edges
7. `buildDiscoveryDerivedLabels()` - 10 edges
8. `fetchPage()` - 10 edges
9. `people Table` - 10 edges
10. `normalizeEmail()` - 9 edges

## Surprising Connections (you probably didn't know these)
- `_shared/verification.ts (Shared Verification Core)` --conceptually_related_to--> `Concept: Verification Field Risk Routing`  [INFERRED]
  supabase/functions/_shared/verification.ts → docs/AI-STRATEGY.md
- `Structured Errors Contract` --semantically_similar_to--> `AI Pipeline Error Contract`  [INFERRED] [semantically similar]
  CLAUDE.md → docs/AI-PIPELINE.md
- `_shared/searchRouting.ts` --conceptually_related_to--> `Concept: Search Query Routing`  [EXTRACTED]
  supabase/functions/_shared/searchRouting.ts → docs/AI-STRATEGY.md
- `_shared/gemini.ts (Model Routing)` --rationale_for--> `Rationale: Stable Gemini 2.5 as Production Defaults`  [EXTRACTED]
  supabase/functions/_shared/gemini.ts → docs/AI-STRATEGY.md
- `printCollectionBriefing()` --calls--> `write()`  [INFERRED]
  src/lib/exportService.ts → supabase/functions/_shared/log.ts

## Hyperedges (group relationships)
- **Core Platform Stack** — CLAUDE_react_vite_frontend, CLAUDE_supabase_backend, CLAUDE_leaflet_map, CLAUDE_google_gemini_ai, CLAUDE_tavily_brave_search, CLAUDE_nominatim_geocoding [EXTRACTED 1.00]
- **Discovery Pipeline Tables** — SCHEMA_discovered_contacts_table, SCHEMA_discovery_frontier_table, SCHEMA_discovery_pages_table, SCHEMA_discovery_evidence_table, SCHEMA_discovery_entity_pivots_table, SCHEMA_agent_runs_table [EXTRACTED 1.00]
- **Phase 6 Handoff Workstreams** — phase6_installability, phase6_testing, phase6_resilience, phase6_observability, phase6_autonomous_agents, phase6_performance_pass [EXTRACTED 1.00]

## Communities

### Community 0 - "Community 0"
Cohesion: 0.05
Nodes (91): getApifyUsage(), upsertDerivedLabelSuggestions(), searchWeb(), canonicalizeUrl(), clamp(), classifyPageHeuristically(), countPatternMatches(), decodeXmlEntities() (+83 more)

### Community 1 - "Community 1"
Cohesion: 0.05
Nodes (33): defaultCodeForStatus(), getUserDisplayName(), HttpError, normalizeEmail(), requireStaffRole(), checkDuplicates(), normalizeContact(), safeStr() (+25 more)

### Community 2 - "Community 2"
Cohesion: 0.06
Nodes (57): agent-connections Edge Function, agent-discovery Edge Function, agent-scheduler Edge Function, agent-verify Edge Function, ai-agent Edge Function, AI Pipeline Behavioral Contracts, discover-contacts Edge Function, AI Pipeline Error Contract (+49 more)

### Community 3 - "Community 3"
Cohesion: 0.06
Nodes (34): appendLabeledLine(), buildBioChunks(), buildPersonTextChunks(), buildStructuredEmbeddingText(), createAsyncEmbeddingBatch(), embedBatch(), embedSingle(), embedTexts() (+26 more)

### Community 4 - "Community 4"
Cohesion: 0.06
Nodes (25): checkDuplicate(), ensureProtocol(), handleSubmit(), insertContact(), handleCreateCollection(), toggleCollection(), addBot(), addContactToDb() (+17 more)

### Community 5 - "Community 5"
Cohesion: 0.17
Nodes (25): buildDedupeKey(), buildDiscoveryDerivedLabels(), buildLocationSeed(), buildSubjectKey(), buildVerificationDerivedLabels(), clampConfidence(), deriveProfileConfidence(), deriveSourceQuality() (+17 more)

### Community 6 - "Community 6"
Cohesion: 0.09
Nodes (17): addToCache(), ensureLocationsLoaded(), fetchLocations(), normalizeStateCode(), resolveLocationId(), applySelected(), getRiskClasses(), runSearch() (+9 more)

### Community 7 - "Community 7"
Cohesion: 0.1
Nodes (14): buildSectorLookup(), checkDuplicates(), getErrorMessage(), handleConfirm(), handleImport(), normalizeSectorName(), resolveSectorIds(), splitSectorCell() (+6 more)

### Community 8 - "Community 8"
Cohesion: 0.12
Nodes (18): buildFallbackKeywords(), buildFallbackTerms(), callAI(), getIndexedString(), getNestedString(), hybridSearch(), scorePersonAgainstFilter(), scorePersonAgainstKeywords() (+10 more)

### Community 9 - "Community 9"
Cohesion: 0.17
Nodes (7): ensureProtocol(), handleFileUpload(), handleRemovePhoto(), reconcileConnections(), saveEdits(), setField(), startEditing()

### Community 10 - "Community 10"
Cohesion: 0.24
Nodes (8): buildDashboardLocation(), buildDashboardSearchParams(), buildDashboardStateFromPreset(), defaultDashboardRouteState(), parseBooleanParam(), parseDashboardRouteState(), sanitizeValues(), roundtrip()

### Community 11 - "Community 11"
Cohesion: 0.22
Nodes (4): formatAge(), formatDuration(), isRecord(), providerUsage()

### Community 12 - "Community 12"
Cohesion: 0.36
Nodes (7): buildBio(), generateName(), occupationFor(), pick(), rowFor(), slugify(), titleFor()

### Community 13 - "Community 13"
Cohesion: 0.39
Nodes (7): cacheResults(), callBrave(), callTavily(), coerceCachedResults(), getOrCreateQuota(), incrementQuota(), searchWeb()

### Community 15 - "Community 15"
Cohesion: 0.28
Nodes (5): handleExport(), downloadFile(), escapeHtml(), exportPeopleToCsv(), printCollectionBriefing()

### Community 16 - "Community 16"
Cohesion: 0.28
Nodes (4): ensureProtocol(), handleAddCustomFlemish(), saveEdits(), toggleEditFlemish()

### Community 17 - "Community 17"
Cohesion: 0.48
Nodes (5): ApifyError, fetchWithRetry(), runApifyActor(), runAsync(), runSync()

### Community 18 - "Community 18"
Cohesion: 0.52
Nodes (5): cleanupSmokeSession(), main(), provisionSmokeSession(), runOne(), serviceFetch()

### Community 20 - "Community 20"
Cohesion: 0.33
Nodes (2): getDerivedLabelMetadata(), getDerivedLocationSummary()

### Community 22 - "Community 22"
Cohesion: 0.4
Nodes (1): ErrorBoundary

### Community 26 - "Community 26"
Cohesion: 0.4
Nodes (5): Full Validation Loop Rationale, Phase 6 Handoff Hardening, Handoff Readiness Rationale, Phase 6.6 Performance Pass, Phase 6 Recommended Sequencing Rationale

### Community 28 - "Community 28"
Cohesion: 0.83
Nodes (3): ConnectionsSummary(), countCollectionCoverage(), summarizeConnections()

### Community 29 - "Community 29"
Cohesion: 0.67
Nodes (2): buildNetworkPreset(), mapCategoryToNetworkOccupation()

### Community 30 - "Community 30"
Cohesion: 0.5
Nodes (2): AddContact(), useSmartBack()

### Community 31 - "Community 31"
Cohesion: 0.5
Nodes (4): Concept: Discovery Frontier Crawler, Concept: Domain Yield Learning, Concept: Evidence-Driven System Design, Rationale: Store Evidence Not Just Final Fields

### Community 32 - "Community 32"
Cohesion: 0.67
Nodes (4): Edge Functions Self-Authenticate, Supabase Auth Gates the App, RLS Summary, staff_users Table

### Community 35 - "Community 35"
Cohesion: 1.0
Nodes (2): buildCounts(), FlemishConnectionChart()

### Community 37 - "Community 37"
Cohesion: 1.0
Nodes (2): AvailabilityOverview(), countMatches()

### Community 38 - "Community 38"
Cohesion: 1.0
Nodes (2): buildCategoryCounts(), OccupationOverview()

### Community 40 - "Community 40"
Cohesion: 0.67
Nodes (3): Concept: Search Query Routing, Concept: Reciprocal-Rank Fusion Search, _shared/searchRouting.ts

### Community 41 - "Community 41"
Cohesion: 1.0
Nodes (3): Geographic Visualization Asset, Leaflet Map Component, USA Blank State Map (SVG-style)

### Community 43 - "Community 43"
Cohesion: 1.0
Nodes (2): Concept: Verification Field Risk Routing, _shared/verification.ts (Shared Verification Core)

### Community 50 - "Community 50"
Cohesion: 1.0
Nodes (2): Rationale: Stable Gemini 2.5 as Production Defaults, _shared/gemini.ts (Model Routing)

### Community 56 - "Community 56"
Cohesion: 1.0
Nodes (1): Edge Function: discover-contacts

### Community 57 - "Community 57"
Cohesion: 1.0
Nodes (1): Edge Function: search-contacts (legacy alias)

### Community 58 - "Community 58"
Cohesion: 1.0
Nodes (1): _shared/aiContracts.ts (Shared Prompts/Schemas)

### Community 59 - "Community 59"
Cohesion: 1.0
Nodes (1): _shared/database.types.ts (Deno Schema Shim)

### Community 63 - "Community 63"
Cohesion: 1.0
Nodes (1): FlemishConnectionSelector Component

### Community 64 - "Community 64"
Cohesion: 1.0
Nodes (1): src/components/Navigation.tsx

### Community 65 - "Community 65"
Cohesion: 1.0
Nodes (1): src/components/admin/AccessManagementPanel.tsx

### Community 66 - "Community 66"
Cohesion: 1.0
Nodes (1): src/components/admin/DerivedLabelsPanel.tsx

### Community 67 - "Community 67"
Cohesion: 1.0
Nodes (1): src/components/admin/ContactCard.tsx

### Community 69 - "Community 69"
Cohesion: 1.0
Nodes (1): src/components/admin/OpsMetricsPanel.tsx

### Community 73 - "Community 73"
Cohesion: 1.0
Nodes (1): src/components/admin/DiscoveryPlanningPanel.tsx

### Community 74 - "Community 74"
Cohesion: 1.0
Nodes (1): src/lib/auth.tsx (AuthProvider)

### Community 75 - "Community 75"
Cohesion: 1.0
Nodes (1): flemishConnections Lib

### Community 76 - "Community 76"
Cohesion: 1.0
Nodes (1): src/lib/dashboardSession.ts

### Community 77 - "Community 77"
Cohesion: 1.0
Nodes (1): src/lib/filterParser.ts

### Community 78 - "Community 78"
Cohesion: 1.0
Nodes (1): Supabase Client & Types

### Community 79 - "Community 79"
Cohesion: 1.0
Nodes (1): flemishConnectionSync Lib

### Community 82 - "Community 82"
Cohesion: 1.0
Nodes (1): src/pages/Login.tsx

### Community 83 - "Community 83"
Cohesion: 1.0
Nodes (1): src/pages/Dashboard.tsx

### Community 84 - "Community 84"
Cohesion: 1.0
Nodes (1): src/pages/Account.tsx

### Community 85 - "Community 85"
Cohesion: 1.0
Nodes (1): src/pages/AuthCallback.tsx

### Community 87 - "Community 87"
Cohesion: 1.0
Nodes (1): src/lib/appRouting.ts

### Community 88 - "Community 88"
Cohesion: 1.0
Nodes (1): index.html (App Entry Point)

### Community 89 - "Community 89"
Cohesion: 1.0
Nodes (1): AGENTS.md (Graphify Rules)

### Community 90 - "Community 90"
Cohesion: 1.0
Nodes (1): AI Strategy Document

### Community 91 - "Community 91"
Cohesion: 1.0
Nodes (1): Concept: Entity-Pivot Discovery

### Community 92 - "Community 92"
Cohesion: 1.0
Nodes (1): Concept: Geographic Gap-Seeking Coverage

### Community 93 - "Community 93"
Cohesion: 1.0
Nodes (1): Concept: Bio-Chunk Vectors

### Community 94 - "Community 94"
Cohesion: 1.0
Nodes (1): Rationale: Conservative Connection Graph Edges

### Community 95 - "Community 95"
Cohesion: 1.0
Nodes (1): Dashboard Route /

### Community 96 - "Community 96"
Cohesion: 1.0
Nodes (1): Person Profile Route /people/:id

### Community 97 - "Community 97"
Cohesion: 1.0
Nodes (1): Organization Profile Route /organizations/:id

### Community 98 - "Community 98"
Cohesion: 1.0
Nodes (1): Collections Route /collections

### Community 99 - "Community 99"
Cohesion: 1.0
Nodes (1): Admin Route /admin

### Community 100 - "Community 100"
Cohesion: 1.0
Nodes (1): Add Contact Route /contacts/new

### Community 101 - "Community 101"
Cohesion: 1.0
Nodes (1): Login Route /login

### Community 102 - "Community 102"
Cohesion: 1.0
Nodes (1): Auth Callback Route /auth/callback

### Community 103 - "Community 103"
Cohesion: 1.0
Nodes (1): Account Route /account

### Community 104 - "Community 104"
Cohesion: 1.0
Nodes (1): GEMINI_API_KEY Secret

### Community 105 - "Community 105"
Cohesion: 1.0
Nodes (1): TAVILY_API_KEY Secret

### Community 106 - "Community 106"
Cohesion: 1.0
Nodes (1): BRAVE_API_KEY Secret

### Community 107 - "Community 107"
Cohesion: 1.0
Nodes (1): APIFY_TOKEN Secret

### Community 108 - "Community 108"
Cohesion: 1.0
Nodes (1): SUPABASE_SERVICE_ROLE_KEY Secret

### Community 109 - "Community 109"
Cohesion: 1.0
Nodes (1): Gemini Model Override Env Vars

### Community 110 - "Community 110"
Cohesion: 1.0
Nodes (1): VITE_SUPABASE_URL Frontend Env

### Community 111 - "Community 111"
Cohesion: 1.0
Nodes (1): VITE_SUPABASE_ANON_KEY Frontend Env

### Community 112 - "Community 112"
Cohesion: 1.0
Nodes (1): Phase 0 Benchmarks README

## Ambiguous Edges - Review These
- `Supabase Auth Gates the App` → `staff_users Table`  [AMBIGUOUS]
  CLAUDE.md · relation: references

## Knowledge Gaps
- **73 isolated node(s):** `Edge Function: discover-contacts`, `Edge Function: search-contacts (legacy alias)`, `_shared/aiContracts.ts (Shared Prompts/Schemas)`, `_shared/searchRouting.ts`, `_shared/gemini.ts (Model Routing)` (+68 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 20`** (7 nodes): `formatDerivedLabelConfidence()`, `getDerivedLabelBadgeClasses()`, `getDerivedLabelMetadata()`, `getDerivedLocationSummary()`, `isCanonicalDerivedLabel()`, `normalizeDerivedLabelSuggestions()`, `derivedLabels.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 22`** (6 nodes): `ErrorBoundary`, `.buildReport()`, `.componentDidCatch()`, `.getDerivedStateFromError()`, `.render()`, `ErrorBoundary.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 29`** (4 nodes): `buildNetworkPreset()`, `getFreshnessTier()`, `mapCategoryToNetworkOccupation()`, `interactiveStatsShared.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 30`** (4 nodes): `AddContact()`, `useSmartBack.ts`, `AddContact.tsx`, `useSmartBack()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 35`** (3 nodes): `buildCounts()`, `FlemishConnectionChart()`, `FlemishConnectionChart.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 37`** (3 nodes): `AvailabilityOverview()`, `countMatches()`, `AvailabilityOverview.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 38`** (3 nodes): `buildCategoryCounts()`, `OccupationOverview()`, `OccupationOverview.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 43`** (2 nodes): `Concept: Verification Field Risk Routing`, `_shared/verification.ts (Shared Verification Core)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 50`** (2 nodes): `Rationale: Stable Gemini 2.5 as Production Defaults`, `_shared/gemini.ts (Model Routing)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 56`** (1 nodes): `Edge Function: discover-contacts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 57`** (1 nodes): `Edge Function: search-contacts (legacy alias)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 58`** (1 nodes): `_shared/aiContracts.ts (Shared Prompts/Schemas)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 59`** (1 nodes): `_shared/database.types.ts (Deno Schema Shim)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 63`** (1 nodes): `FlemishConnectionSelector Component`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 64`** (1 nodes): `src/components/Navigation.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 65`** (1 nodes): `src/components/admin/AccessManagementPanel.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 66`** (1 nodes): `src/components/admin/DerivedLabelsPanel.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 67`** (1 nodes): `src/components/admin/ContactCard.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 69`** (1 nodes): `src/components/admin/OpsMetricsPanel.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 73`** (1 nodes): `src/components/admin/DiscoveryPlanningPanel.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 74`** (1 nodes): `src/lib/auth.tsx (AuthProvider)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 75`** (1 nodes): `flemishConnections Lib`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 76`** (1 nodes): `src/lib/dashboardSession.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 77`** (1 nodes): `src/lib/filterParser.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 78`** (1 nodes): `Supabase Client & Types`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 79`** (1 nodes): `flemishConnectionSync Lib`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 82`** (1 nodes): `src/pages/Login.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 83`** (1 nodes): `src/pages/Dashboard.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 84`** (1 nodes): `src/pages/Account.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 85`** (1 nodes): `src/pages/AuthCallback.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 87`** (1 nodes): `src/lib/appRouting.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 88`** (1 nodes): `index.html (App Entry Point)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 89`** (1 nodes): `AGENTS.md (Graphify Rules)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 90`** (1 nodes): `AI Strategy Document`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 91`** (1 nodes): `Concept: Entity-Pivot Discovery`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 92`** (1 nodes): `Concept: Geographic Gap-Seeking Coverage`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 93`** (1 nodes): `Concept: Bio-Chunk Vectors`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 94`** (1 nodes): `Rationale: Conservative Connection Graph Edges`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 95`** (1 nodes): `Dashboard Route /`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 96`** (1 nodes): `Person Profile Route /people/:id`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 97`** (1 nodes): `Organization Profile Route /organizations/:id`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 98`** (1 nodes): `Collections Route /collections`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 99`** (1 nodes): `Admin Route /admin`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 100`** (1 nodes): `Add Contact Route /contacts/new`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 101`** (1 nodes): `Login Route /login`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 102`** (1 nodes): `Auth Callback Route /auth/callback`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 103`** (1 nodes): `Account Route /account`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 104`** (1 nodes): `GEMINI_API_KEY Secret`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 105`** (1 nodes): `TAVILY_API_KEY Secret`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 106`** (1 nodes): `BRAVE_API_KEY Secret`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 107`** (1 nodes): `APIFY_TOKEN Secret`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 108`** (1 nodes): `SUPABASE_SERVICE_ROLE_KEY Secret`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 109`** (1 nodes): `Gemini Model Override Env Vars`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 110`** (1 nodes): `VITE_SUPABASE_URL Frontend Env`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 111`** (1 nodes): `VITE_SUPABASE_ANON_KEY Frontend Env`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 112`** (1 nodes): `Phase 0 Benchmarks README`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Supabase Auth Gates the App` and `staff_users Table`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
- **Why does `kickEmbeddingWorker()` connect `Community 4` to `Community 9`?**
  _High betweenness centrality (0.011) - this node is a cross-community bridge._
- **Why does `notifyError()` connect `Community 4` to `Community 8`?**
  _High betweenness centrality (0.010) - this node is a cross-community bridge._
- **Why does `write()` connect `Community 1` to `Community 15`?**
  _High betweenness centrality (0.009) - this node is a cross-community bridge._
- **Are the 17 inferred relationships involving `normalizeWhitespace()` (e.g. with `normalizeName()` and `normalizeEmail()`) actually correct?**
  _`normalizeWhitespace()` has 17 INFERRED edges - model-reasoned connections that need verification._
- **Are the 3 inferred relationships involving `processFrontierRow()` (e.g. with `fetchPage()` and `classifyPageHeuristically()`) actually correct?**
  _`processFrontierRow()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **Are the 15 inferred relationships involving `safeString()` (e.g. with `normalizeName()` and `normalizeEmail()`) actually correct?**
  _`safeString()` has 15 INFERRED edges - model-reasoned connections that need verification._