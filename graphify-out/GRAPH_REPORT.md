# Graph Report - flemish-network  (2026-05-06)

## Corpus Check
- 121 files · ~153,175 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 582 nodes · 681 edges · 77 communities detected
- Extraction: 88% EXTRACTED · 12% INFERRED · 0% AMBIGUOUS · INFERRED: 81 edges (avg confidence: 0.75)
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
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 64|Community 64]]
- [[_COMMUNITY_Community 65|Community 65]]
- [[_COMMUNITY_Community 66|Community 66]]
- [[_COMMUNITY_Community 67|Community 67]]
- [[_COMMUNITY_Community 68|Community 68]]
- [[_COMMUNITY_Community 69|Community 69]]
- [[_COMMUNITY_Community 70|Community 70]]
- [[_COMMUNITY_Community 71|Community 71]]
- [[_COMMUNITY_Community 72|Community 72]]
- [[_COMMUNITY_Community 73|Community 73]]
- [[_COMMUNITY_Community 74|Community 74]]
- [[_COMMUNITY_Community 75|Community 75]]
- [[_COMMUNITY_Community 76|Community 76]]
- [[_COMMUNITY_Community 77|Community 77]]
- [[_COMMUNITY_Community 78|Community 78]]
- [[_COMMUNITY_Community 79|Community 79]]
- [[_COMMUNITY_Community 80|Community 80]]
- [[_COMMUNITY_Community 81|Community 81]]
- [[_COMMUNITY_Community 82|Community 82]]
- [[_COMMUNITY_Community 83|Community 83]]
- [[_COMMUNITY_Community 84|Community 84]]

## God Nodes (most connected - your core abstractions)
1. `People Records` - 15 edges
2. `Supabase Public Schema Types` - 10 edges
3. `people Table` - 10 edges
4. `Search People Hybrid Search Handler` - 9 edges
5. `Network Scope Types` - 9 edges
6. `Five Product Services` - 9 edges
7. `Expand The Database` - 9 edges
8. `Smoke Edge Function Checks` - 8 edges
9. `Person Flemish Connection Accessors` - 8 edges
10. `agent-discovery Edge Function` - 8 edges

## Surprising Connections (you probably didn't know these)
- `AI Legacy Removal` --conceptually_related_to--> `Smoke Edge Function Checks`  [AMBIGUOUS]
  docs/AI-PIPELINE.md → scripts/smoke_edge_functions.ts
- `RLS Summary` --references--> `Add To Collection Dropdown`  [INFERRED]
  docs/SCHEMA.md → src/components/AddToCollectionDropdown.tsx
- `Phase 4 Collections Draft Workflow` --references--> `Add To Collection Dropdown`  [INFERRED]
  docs/WEBAPP-MASTERPLAN.md → src/components/AddToCollectionDropdown.tsx
- `Flemish Network Intelligence Platform` --implements--> `Tailwind Source Content Configuration`  [INFERRED]
  AGENTS.md → tailwind.config.js
- `US Cities Locations Migration Generator` --implements--> `locations Table`  [EXTRACTED]
  generate_migration.js → docs/SCHEMA.md

## Hyperedges (group relationships)
- **Product Services Route And Edge Owners** — PRODUCT_SearchTheNetwork, PRODUCT_BuildCollection, PRODUCT_ExpandDatabase, PRODUCT_VerifyEnrich, PRODUCT_NetworkGrowth, ROUTES_FrontendRouteContract, AI_ServiceMap [EXTRACTED 1.00]
- **Normalized Network Facts** — SCHEMA_PeopleTable, SCHEMA_OrganizationsTable, SCHEMA_LocationsTable, SCHEMA_FlemishConnectionsTables, PRODUCT_FlemishNormalization, AGENTS_NormalizedDataRules [EXTRACTED 1.00]
- **Discovery Growth Evaluation Loop** — PRODUCT_ExpandDatabase, PRODUCT_NetworkGrowth, AI_AgentDiscoveryFunction, AI_AgentSchedulerFunction, EVAL_DiscoveryEvaluation, EVAL_PlanningEvaluation, SCHEMA_DiscoveryPipelineTables [EXTRACTED 1.00]
- **Collection AI Assistance** — collectiondetail_component, collectionmodal_component, collectiondetail_embedding_suggestions, collectionmodal_creation_suggestions [EXTRACTED 1.00]
- **Admin Interactive Quality Filters** — availabilityoverview_component, connectionssummary_component, dataqualitychart_component, crossfilterbar_component [INFERRED 0.82]
- **Normalized Profile Data Promotion** — csvimport_component, derivedlabelspanel_component, profileupdatemodal_component, shared_normalized_profile_links [INFERRED 0.86]
- **Admin Interactive Stats Surfaces** — interactivestatsoverview_component, interactivestatsoverview_cross_filtering, occupationoverview_component, flemishconnectionchart_component, interactivebarchart_component, stalecontactsbar_component, suggestedchanges_component, interactivestatsshared_cross_filter_state [EXTRACTED 1.00]
- **Structured Edge Error Flow** — aiservice_ai_agent_call, edgeerror_extract_edge_error, edgeerror_error_model, edgeerror_describe_error, structurederrorbanner_component [EXTRACTED 1.00]
- **Flemish Connection Normalization Flow** — flemishconnectionsync_refresh_rpc, flemishconnections_known_connections, flemishconnections_canonicalization, flemishconnections_text_extraction, flemishconnections_person_accessors, flemishconnectionchart_component, exportservice_people_export, aiservice_keyword_scoring [INFERRED 0.82]
- **Normalized Location Flow** — locations_resolveLocationId, locations_locationsTable, geocoding_geocodeBatch, locations_addToCache, networkScope_buildNetworkClusters, Dashboard_geocodingClusterRefresh [EXTRACTED 1.00]
- **Dashboard Search Flow** — Dashboard_routeState, Dashboard_searchLifecycle, matchCriteria_dashboardSearchCacheScope, matchCriteria_applyCriteria, dashboardSessionTest_searchCacheContract, Dashboard_dataLoading [INFERRED 0.85]
- **US Network Scope Model** — supabase_networkScopeTypes, networkScope_usConnectedAbroad, networkScope_buildNetworkClusters, matchCriteria_personCriteria, csvParserTest_connectedAbroadImportContract, usNetworkMigrationTest_schemaContract, networkScopeTest_usPlacementContract [EXTRACTED 1.00]
- **Staff Login Authorization Flow** — login_staff_magic_link, auth_staff_role_guard, auth_admin_client_factory, database_types_public_schema [INFERRED 0.74]
- **Verification Fallback Pipeline** — verification_person_runner, apifyclient_apify_actor_client, websearch_cached_provider_cascade, aicontracts_profile_check_contract, gemini_structured_call_client, verification_profile_suggestion_writer [EXTRACTED 1.00]
- **Discovery Normalization Pipeline** — discovery_page_fetcher, discovery_page_classifier, derivedlabels_derived_label_builder, locationpipeline_us_location_parser, derivedlabels_label_suggestion_upsert, database_types_discovery_contract [INFERRED 0.76]
- **Discovery Ingestion Lifecycle** — agentDiscovery_handler, agentDiscovery_source_packs, agentDiscovery_coverage_gaps, agentDiscovery_entity_pivots, agentDiscovery_frontier_queue, agentDiscovery_discovery_pages, agentDiscovery_discovered_contacts, agentDiscovery_discovery_evidence, agentDiscovery_agent_run_tracking [EXTRACTED 1.00]
- **Verification Lifecycle** — agentVerify_handler, updateProfile_handler, agentVerify_candidate_fetch, agentVerify_person_verification, agentVerify_verification_suggestions, agentVerify_mark_verified, agentVerify_derived_labels, agentVerify_agent_run_tracking [EXTRACTED 1.00]
- **Embedding Search Lifecycle** — generateEmbeddings_handler, generateEmbeddings_embedding_jobs, generateEmbeddings_person_embedding_text, generateEmbeddings_people_embeddings, generateEmbeddings_person_text_chunks, searchPeople_hybrid_search_handler, suggestPeople_handler [EXTRACTED 1.00]
- **US Map Visual Layers** — image_united_states_map, image_state_boundaries, image_light_gray_land_fill, image_black_background, image_region_marker [EXTRACTED 1.00]
- **Non Contiguous State Context** — image_united_states_map, image_alaska_hawaii_insets, image_state_boundaries [EXTRACTED 1.00]

## Communities

### Community 0 - "Community 0"
Cohesion: 0.04
Nodes (74): Normalized Data Rules, Flemish Network Intelligence Platform, Required Agent Workflow, Scheduler Owns Run Lifecycle Rule, Active Source Of Truth Docs, agent-discovery Edge Function, agent-scheduler Edge Function, agent-verify Edge Function (+66 more)

### Community 1 - "Community 1"
Cohesion: 0.06
Nodes (50): Staff Profile Form, Staff Auth Callback Redirect, Collection Detail Routing, Collections List, Dashboard AI Filters, Dashboard Data Loading, Dashboard Filter Chips, Dashboard Flemish Options (+42 more)

### Community 2 - "Community 2"
Cohesion: 0.05
Nodes (48): AccessManagementPanel Component, Staff Access Management, Availability Filters, AvailabilityOverview Component, ClusterPopover Component, Location Contact Grouping, CollectionDetail Component, Collection Embedding Suggestions (+40 more)

### Community 3 - "Community 3"
Cohesion: 0.06
Nodes (47): AI Agent Task Contracts, Profile Check Contract, Search Keyword Contracts, AI Contracts Tests, Apify Actor Client, LinkedIn Actor Registry, Supabase Admin Client Factory, Staff Role Guard (+39 more)

### Community 4 - "Community 4"
Cohesion: 0.07
Nodes (38): Deterministic Search Keyword Fallback, Hybrid People Search, Client Keyword Scoring, Smart Search, Embedding People Suggestions, Client People Suggestion Fallback, Apply Import Mappings, Import Template Download (+30 more)

### Community 5 - "Community 5"
Cohesion: 0.08
Nodes (33): agent-connections Edge Function, ai-agent Edge Function, Frontend AI Functions, Gemini Model Routing, generate-embeddings Edge Function, geocode Edge Function, search-people Edge Function, suggest-people Edge Function (+25 more)

### Community 6 - "Community 6"
Cohesion: 0.09
Nodes (28): Apply Embedding Outputs, Async Embedding Batch Lifecycle, Embedding Batch Runs Table, Embedding Jobs Queue, Generate Embeddings Handler, People Embedding Columns, Structured Person Embedding Text, Person Text Chunks (+20 more)

### Community 7 - "Community 7"
Cohesion: 0.14
Nodes (24): agent-discovery Edge Function, agent-scheduler Edge Function, agent-verify Edge Function, AI Pipeline Behavioral Contracts, discover-contacts Edge Function, AI Pipeline Error Contract, Legacy AI Aliases, update-profile Edge Function (+16 more)

### Community 8 - "Community 8"
Cohesion: 0.12
Nodes (19): Discovery Agent Run Tracking, Discovery Candidate Deduplication, Discovery Child Link Expansion, Discovery Contact Extraction, Coverage Gaps, Discovery Derived Labels, Discovered Contacts Store, Discovery Evidence Store (+11 more)

### Community 9 - "Community 9"
Cohesion: 0.17
Nodes (7): buildGapDiscoveryQuery(), loadDiscoveryPlanning(), markZombieRuns(), pickPrimarySector(), purgeExpiredCache(), runHousekeeping(), uniqueByQuery()

### Community 10 - "Community 10"
Cohesion: 0.2
Nodes (6): checkDuplicate(), createEmptyForm(), emptyUsConnection(), ensureProtocol(), handleSubmit(), insertContact()

### Community 11 - "Community 11"
Cohesion: 0.22
Nodes (8): buildDashboardLocation(), buildDashboardSearchParams(), buildDashboardStateFromPreset(), defaultDashboardRouteState(), parseBooleanParam(), parseDashboardRouteState(), sanitizeValues(), roundtrip()

### Community 12 - "Community 12"
Cohesion: 0.21
Nodes (7): approveContact(), getVal(), mergeIntoExisting(), mergeTextViaAI(), Edge Error Description, Notify Error, Sonner Toast Wrapper

### Community 13 - "Community 13"
Cohesion: 0.2
Nodes (4): formatAge(), formatDuration(), isRecord(), providerUsage()

### Community 14 - "Community 14"
Cohesion: 0.23
Nodes (7): ensureProtocol(), handleFileUpload(), handleRemovePhoto(), reconcileConnections(), saveEdits(), setField(), startEditing()

### Community 15 - "Community 15"
Cohesion: 0.25
Nodes (9): Verification Agent Run Tracking, Verification Candidate Fetch, Verification Derived Labels, Agent Verify Handler, Mark Person Verified, Person Verification Runner, Verification Suggestions, Update Profile Handler (+1 more)

### Community 16 - "Community 16"
Cohesion: 0.28
Nodes (9): AI Agent Call Wrapper, Discover Contacts Edge Request, Flemish Search AI Task, Parse Contacts AI Task, Describe Client Error, Structured Edge Function Error Model, Extract Edge Function Error, Ops Metrics Panel (+1 more)

### Community 17 - "Community 17"
Cohesion: 0.32
Nodes (8): Alaska And Hawaii Insets, Map Image Asset, Black Background, Cartographic Basemap Design, Light Gray Land Fill, White Circular Region Marker, State Boundary Lines, United States Map

### Community 20 - "Community 20"
Cohesion: 0.33
Nodes (6): ContactCard Component, Discovered Contact Review, Discovered Contact Edit Form, DiscoveryPlanningPanel Component, Discovery Planning Payload, Agent Scheduler Planning Endpoint

### Community 21 - "Community 21"
Cohesion: 0.4
Nodes (5): Full Validation Loop Rationale, Phase 6 Handoff Hardening, Handoff Readiness Rationale, Phase 6.6 Performance Pass, Phase 6 Recommended Sequencing Rationale

### Community 23 - "Community 23"
Cohesion: 0.5
Nodes (4): Concept: Discovery Frontier Crawler, Concept: Domain Yield Learning, Concept: Evidence-Driven System Design, Rationale: Store Evidence Not Just Final Fields

### Community 24 - "Community 24"
Cohesion: 0.67
Nodes (4): Edge Functions Self-Authenticate, Supabase Auth Gates the App, RLS Summary, staff_users Table

### Community 25 - "Community 25"
Cohesion: 0.67
Nodes (3): AI Agent Gemini Structured Call, AI Agent Structured Task Handler, AI Agent Task Registry

### Community 27 - "Community 27"
Cohesion: 0.67
Nodes (3): Auth Provider, Authentication Route Guards, Approved Staff User Activation

### Community 28 - "Community 28"
Cohesion: 0.67
Nodes (3): Derived Location Summary, Derived Label Normalization, Derived Label Suggestion Model

### Community 29 - "Community 29"
Cohesion: 1.0
Nodes (3): Normalize Verification Suggestions, Verification Risk Guidance, Verification Suggestion Model

### Community 30 - "Community 30"
Cohesion: 0.67
Nodes (3): Concept: Search Query Routing, Concept: Reciprocal-Rank Fusion Search, _shared/searchRouting.ts

### Community 31 - "Community 31"
Cohesion: 1.0
Nodes (3): Geographic Visualization Asset, Leaflet Map Component, USA Blank State Map (SVG-style)

### Community 33 - "Community 33"
Cohesion: 1.0
Nodes (2): Discover Contacts Canonical Handler, Search Contacts Compatibility Handler

### Community 35 - "Community 35"
Cohesion: 1.0
Nodes (2): Concept: Verification Field Risk Routing, _shared/verification.ts (Shared Verification Core)

### Community 36 - "Community 36"
Cohesion: 1.0
Nodes (2): Rationale: Stable Gemini 2.5 as Production Defaults, _shared/gemini.ts (Model Routing)

### Community 37 - "Community 37"
Cohesion: 1.0
Nodes (2): Gemini Model Routing, Archived Gemini Model Strategy

### Community 39 - "Community 39"
Cohesion: 1.0
Nodes (1): Dashboard Search Session Cache

### Community 40 - "Community 40"
Cohesion: 1.0
Nodes (1): Last Dashboard Location Session State

### Community 42 - "Community 42"
Cohesion: 1.0
Nodes (1): Edge Function: discover-contacts

### Community 43 - "Community 43"
Cohesion: 1.0
Nodes (1): src/components/Navigation.tsx

### Community 44 - "Community 44"
Cohesion: 1.0
Nodes (1): src/components/admin/AccessManagementPanel.tsx

### Community 45 - "Community 45"
Cohesion: 1.0
Nodes (1): src/components/admin/DerivedLabelsPanel.tsx

### Community 46 - "Community 46"
Cohesion: 1.0
Nodes (1): src/components/admin/ContactCard.tsx

### Community 47 - "Community 47"
Cohesion: 1.0
Nodes (1): src/components/admin/OpsMetricsPanel.tsx

### Community 48 - "Community 48"
Cohesion: 1.0
Nodes (1): src/components/admin/DiscoveryPlanningPanel.tsx

### Community 49 - "Community 49"
Cohesion: 1.0
Nodes (1): src/lib/auth.tsx (AuthProvider)

### Community 50 - "Community 50"
Cohesion: 1.0
Nodes (1): src/lib/dashboardSession.ts

### Community 51 - "Community 51"
Cohesion: 1.0
Nodes (1): src/pages/Login.tsx

### Community 52 - "Community 52"
Cohesion: 1.0
Nodes (1): src/pages/Account.tsx

### Community 53 - "Community 53"
Cohesion: 1.0
Nodes (1): src/pages/AuthCallback.tsx

### Community 54 - "Community 54"
Cohesion: 1.0
Nodes (1): Edge Function: search-contacts (legacy alias)

### Community 55 - "Community 55"
Cohesion: 1.0
Nodes (1): _shared/aiContracts.ts (Shared Prompts/Schemas)

### Community 56 - "Community 56"
Cohesion: 1.0
Nodes (1): _shared/database.types.ts (Deno Schema Shim)

### Community 57 - "Community 57"
Cohesion: 1.0
Nodes (1): src/lib/appRouting.ts

### Community 58 - "Community 58"
Cohesion: 1.0
Nodes (1): src/lib/filterParser.ts

### Community 59 - "Community 59"
Cohesion: 1.0
Nodes (1): src/pages/Dashboard.tsx

### Community 60 - "Community 60"
Cohesion: 1.0
Nodes (1): index.html (App Entry Point)

### Community 61 - "Community 61"
Cohesion: 1.0
Nodes (1): AGENTS.md (Graphify Rules)

### Community 62 - "Community 62"
Cohesion: 1.0
Nodes (1): AI Strategy Document

### Community 63 - "Community 63"
Cohesion: 1.0
Nodes (1): Concept: Entity-Pivot Discovery

### Community 64 - "Community 64"
Cohesion: 1.0
Nodes (1): Concept: Geographic Gap-Seeking Coverage

### Community 65 - "Community 65"
Cohesion: 1.0
Nodes (1): Concept: Bio-Chunk Vectors

### Community 66 - "Community 66"
Cohesion: 1.0
Nodes (1): Rationale: Conservative Connection Graph Edges

### Community 67 - "Community 67"
Cohesion: 1.0
Nodes (1): Dashboard Route /

### Community 68 - "Community 68"
Cohesion: 1.0
Nodes (1): Person Profile Route /people/:id

### Community 69 - "Community 69"
Cohesion: 1.0
Nodes (1): Organization Profile Route /organizations/:id

### Community 70 - "Community 70"
Cohesion: 1.0
Nodes (1): Collections Route /collections

### Community 71 - "Community 71"
Cohesion: 1.0
Nodes (1): Admin Route /admin

### Community 72 - "Community 72"
Cohesion: 1.0
Nodes (1): Add Contact Route /contacts/new

### Community 73 - "Community 73"
Cohesion: 1.0
Nodes (1): Login Route /login

### Community 74 - "Community 74"
Cohesion: 1.0
Nodes (1): Auth Callback Route /auth/callback

### Community 75 - "Community 75"
Cohesion: 1.0
Nodes (1): Account Route /account

### Community 76 - "Community 76"
Cohesion: 1.0
Nodes (1): GEMINI_API_KEY Secret

### Community 77 - "Community 77"
Cohesion: 1.0
Nodes (1): TAVILY_API_KEY Secret

### Community 78 - "Community 78"
Cohesion: 1.0
Nodes (1): BRAVE_API_KEY Secret

### Community 79 - "Community 79"
Cohesion: 1.0
Nodes (1): APIFY_TOKEN Secret

### Community 80 - "Community 80"
Cohesion: 1.0
Nodes (1): SUPABASE_SERVICE_ROLE_KEY Secret

### Community 81 - "Community 81"
Cohesion: 1.0
Nodes (1): Gemini Model Override Env Vars

### Community 82 - "Community 82"
Cohesion: 1.0
Nodes (1): VITE_SUPABASE_URL Frontend Env

### Community 83 - "Community 83"
Cohesion: 1.0
Nodes (1): VITE_SUPABASE_ANON_KEY Frontend Env

### Community 84 - "Community 84"
Cohesion: 1.0
Nodes (1): Phase 0 Benchmarks README

## Ambiguous Edges - Review These
- `Smoke Edge Function Checks` → `AI Legacy Removal`  [AMBIGUOUS]
  scripts/smoke_edge_functions.ts · relation: conceptually_related_to
- `Supabase Auth Gates the App` → `staff_users Table`  [AMBIGUOUS]
  CLAUDE.md · relation: references

## Knowledge Gaps
- **182 isolated node(s):** `US Cities Locations Migration Generator`, `ESLint TypeScript React Configuration`, `Vitest jsdom Test Configuration`, `PostCSS Tailwind Autoprefixer Configuration`, `Load Verification Person` (+177 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 33`** (2 nodes): `Discover Contacts Canonical Handler`, `Search Contacts Compatibility Handler`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 35`** (2 nodes): `Concept: Verification Field Risk Routing`, `_shared/verification.ts (Shared Verification Core)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 36`** (2 nodes): `Rationale: Stable Gemini 2.5 as Production Defaults`, `_shared/gemini.ts (Model Routing)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 37`** (2 nodes): `Gemini Model Routing`, `Archived Gemini Model Strategy`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 39`** (1 nodes): `Dashboard Search Session Cache`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 40`** (1 nodes): `Last Dashboard Location Session State`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 42`** (1 nodes): `Edge Function: discover-contacts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 43`** (1 nodes): `src/components/Navigation.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 44`** (1 nodes): `src/components/admin/AccessManagementPanel.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 45`** (1 nodes): `src/components/admin/DerivedLabelsPanel.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 46`** (1 nodes): `src/components/admin/ContactCard.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 47`** (1 nodes): `src/components/admin/OpsMetricsPanel.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 48`** (1 nodes): `src/components/admin/DiscoveryPlanningPanel.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 49`** (1 nodes): `src/lib/auth.tsx (AuthProvider)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 50`** (1 nodes): `src/lib/dashboardSession.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 51`** (1 nodes): `src/pages/Login.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 52`** (1 nodes): `src/pages/Account.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 53`** (1 nodes): `src/pages/AuthCallback.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 54`** (1 nodes): `Edge Function: search-contacts (legacy alias)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 55`** (1 nodes): `_shared/aiContracts.ts (Shared Prompts/Schemas)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 56`** (1 nodes): `_shared/database.types.ts (Deno Schema Shim)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 57`** (1 nodes): `src/lib/appRouting.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 58`** (1 nodes): `src/lib/filterParser.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 59`** (1 nodes): `src/pages/Dashboard.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 60`** (1 nodes): `index.html (App Entry Point)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 61`** (1 nodes): `AGENTS.md (Graphify Rules)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 62`** (1 nodes): `AI Strategy Document`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 63`** (1 nodes): `Concept: Entity-Pivot Discovery`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 64`** (1 nodes): `Concept: Geographic Gap-Seeking Coverage`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 65`** (1 nodes): `Concept: Bio-Chunk Vectors`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 66`** (1 nodes): `Rationale: Conservative Connection Graph Edges`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 67`** (1 nodes): `Dashboard Route /`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 68`** (1 nodes): `Person Profile Route /people/:id`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 69`** (1 nodes): `Organization Profile Route /organizations/:id`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 70`** (1 nodes): `Collections Route /collections`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 71`** (1 nodes): `Admin Route /admin`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 72`** (1 nodes): `Add Contact Route /contacts/new`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 73`** (1 nodes): `Login Route /login`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 74`** (1 nodes): `Auth Callback Route /auth/callback`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 75`** (1 nodes): `Account Route /account`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 76`** (1 nodes): `GEMINI_API_KEY Secret`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 77`** (1 nodes): `TAVILY_API_KEY Secret`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 78`** (1 nodes): `BRAVE_API_KEY Secret`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 79`** (1 nodes): `APIFY_TOKEN Secret`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 80`** (1 nodes): `SUPABASE_SERVICE_ROLE_KEY Secret`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 81`** (1 nodes): `Gemini Model Override Env Vars`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 82`** (1 nodes): `VITE_SUPABASE_URL Frontend Env`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 83`** (1 nodes): `VITE_SUPABASE_ANON_KEY Frontend Env`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 84`** (1 nodes): `Phase 0 Benchmarks README`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Smoke Edge Function Checks` and `AI Legacy Removal`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Supabase Auth Gates the App` and `staff_users Table`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
- **Are the 2 inferred relationships involving `People Records` (e.g. with `Copyable Error Report` and `Staff Access Management`) actually correct?**
  _`People Records` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `US Cities Locations Migration Generator`, `ESLint TypeScript React Configuration`, `Vitest jsdom Test Configuration` to the rest of the system?**
  _182 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.04 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.06 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._