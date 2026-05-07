# Graph Report - .  (2026-05-07)

## Corpus Check
- 142 files · ~164,523 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1240 nodes · 1897 edges · 50 communities detected
- Extraction: 89% EXTRACTED · 11% INFERRED · 0% AMBIGUOUS · INFERRED: 204 edges (avg confidence: 0.79)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Discovery Page Parsing|Discovery Page Parsing]]
- [[_COMMUNITY_Auth Collection Helpers|Auth Collection Helpers]]
- [[_COMMUNITY_Manual Contact Intake|Manual Contact Intake]]
- [[_COMMUNITY_Apify Actor Client|Apify Actor Client]]
- [[_COMMUNITY_Discovery Agent Pipeline|Discovery Agent Pipeline]]
- [[_COMMUNITY_AI Prompt Contracts|AI Prompt Contracts]]
- [[_COMMUNITY_Product AI Docs|Product AI Docs]]
- [[_COMMUNITY_Frontend AI Search|Frontend AI Search]]
- [[_COMMUNITY_Location Network Scope|Location Network Scope]]
- [[_COMMUNITY_AI Search Clients|AI Search Clients]]
- [[_COMMUNITY_Admin Page Workflows|Admin Page Workflows]]
- [[_COMMUNITY_Embedding Text Pipeline|Embedding Text Pipeline]]
- [[_COMMUNITY_Import Route Contracts|Import Route Contracts]]
- [[_COMMUNITY_Staff Discovery UI|Staff Discovery UI]]
- [[_COMMUNITY_Embedding Edge Functions|Embedding Edge Functions]]
- [[_COMMUNITY_Derived Label Logic|Derived Label Logic]]
- [[_COMMUNITY_CSV Import Workflow|CSV Import Workflow]]
- [[_COMMUNITY_Collection Suggestions|Collection Suggestions]]
- [[_COMMUNITY_Export Services|Export Services]]
- [[_COMMUNITY_Route Shell|Route Shell]]
- [[_COMMUNITY_App Routing|App Routing]]
- [[_COMMUNITY_Verification Agent|Verification Agent]]
- [[_COMMUNITY_System Health Utilities|System Health Utilities]]
- [[_COMMUNITY_Phase Search Seed|Phase Search Seed]]
- [[_COMMUNITY_Import Fixture Generator|Import Fixture Generator]]
- [[_COMMUNITY_Profile Editing|Profile Editing]]
- [[_COMMUNITY_Dashboard Session Cache|Dashboard Session Cache]]
- [[_COMMUNITY_Geocode Endpoint|Geocode Endpoint]]
- [[_COMMUNITY_Smoke Tests|Smoke Tests]]
- [[_COMMUNITY_Product Architecture Docs|Product Architecture Docs]]
- [[_COMMUNITY_Error Boundary|Error Boundary]]
- [[_COMMUNITY_Verification Labels|Verification Labels]]
- [[_COMMUNITY_Filter Parsing Tests|Filter Parsing Tests]]
- [[_COMMUNITY_Staff Authentication|Staff Authentication]]
- [[_COMMUNITY_AI Agent Endpoint|AI Agent Endpoint]]
- [[_COMMUNITY_Flemish Picker|Flemish Picker]]
- [[_COMMUNITY_Map Asset|Map Asset]]
- [[_COMMUNITY_Connections Summary|Connections Summary]]
- [[_COMMUNITY_Network Presets|Network Presets]]
- [[_COMMUNITY_Filter Parser|Filter Parser]]
- [[_COMMUNITY_Flemish Chart|Flemish Chart]]
- [[_COMMUNITY_Availability Overview|Availability Overview]]
- [[_COMMUNITY_Occupation Overview|Occupation Overview]]
- [[_COMMUNITY_App Bootstrap|App Bootstrap]]
- [[_COMMUNITY_Auth Provider|Auth Provider]]
- [[_COMMUNITY_Suggestion Drafts|Suggestion Drafts]]
- [[_COMMUNITY_Edge Error Toasts|Edge Error Toasts]]
- [[_COMMUNITY_Export Tests|Export Tests]]
- [[_COMMUNITY_Agent Instructions|Agent Instructions]]
- [[_COMMUNITY_Model Routing Strategy|Model Routing Strategy]]

## God Nodes (most connected - your core abstractions)
1. `processFrontierRow()` - 21 edges
2. `normalizeWhitespace()` - 20 edges
3. `safeString()` - 19 edges
4. `safeStr()` - 18 edges
5. `maybeHarvestProvenDomain()` - 11 edges
6. `notifyError()` - 11 edges
7. `buildLocationSeed()` - 10 edges
8. `buildDiscoveryDerivedLabels()` - 10 edges
9. `fetchPage()` - 10 edges
10. `normalizeEmail()` - 9 edges

## Surprising Connections (you probably didn't know these)
- `Large Import Sector CSV Fixtures` --shares_data_with--> `Core Normalized Entities`  [INFERRED]
  scripts/generate_large_import_fixtures.mjs → docs/SCHEMA.md
- `Locations SQL Migration Generator` --implements--> `Core Normalized Entities`  [EXTRACTED]
  generate_migration.js → docs/SCHEMA.md
- `Vite Vendor Chunk Strategy` --implements--> `Current Cleanup Baseline`  [INFERRED]
  vite.config.ts → docs/WEBAPP-MASTERPLAN.md
- `Edge Function Smoke Harness` --references--> `Legacy AI Paths`  [EXTRACTED]
  scripts/smoke_edge_functions.ts → docs/AI-PIPELINE.md
- `Large Import Sector CSV Fixtures` --implements--> `Flemish Belgian Connection Normalization`  [INFERRED]
  scripts/generate_large_import_fixtures.mjs → docs/PRODUCT-SERVICES.md

## Hyperedges (group relationships)
- **Five Service Architecture Alignment** — PRODUCT-SERVICES_five_service_product_model, AI-PIPELINE_service_map, ROUTES_frontend_route_contract, SCHEMA_core_normalized_entities, WEBAPP-MASTERPLAN_cleanup_phase_plan, EVALUATION_discovery_quality_gates [EXTRACTED 1.00]
- **Phase 4 Mixed Collections Workflow** — TEMP-PHASE4_phase4_collections_packets, AI-PIPELINE_suggest_people_collection_service, ROUTES_collection_suggestion_api_contract, SCHEMA_mixed_collection_members, EVALUATION_collection_suggestion_gates, WEBAPP-MASTERPLAN_phase4_done_status [EXTRACTED 1.00]
- **Discovery Frontier Growth Loop** — AI-STRATEGY_bounded_frontier_crawler, AI-STRATEGY_three_discovery_lanes, AI-PIPELINE_agent_discovery_service, SCHEMA_discovery_pipeline_tables, PRODUCT-SERVICES_understand_and_grow_network, EVALUATION_growth_recommendation_rubric [EXTRACTED 1.00]
- **Collection Suggestion Review Loop** — collectiondetail_reviewed_collection_suggestions, collectionmodal_approved_suggestion_persistence, data_collection_members [EXTRACTED 1.00]
- **Network Scope Experience** — addcontactpanel_us_network_scope_validation, filterpanel_people_scope_filter, clusterpopover_city_cluster_breakdown [INFERRED 0.82]
- **Staff Discovery Operations Loop** — navigation_role_based_staff_navigation, addcontactpanel_discovery_intake, agentdashboard_scheduler_lifecycle_controls [INFERRED 0.78]
- **Admin Cross-Filter Analytics Surface** — interactivestatsoverview_admin_cross_filter_dashboard, crossfilterbar_active_filter_chips, interactiveStatsShared_cross_filter_state_model, interactivebarchart_filterable_bar_chart, interactivestatsoverview_network_preset_navigation [EXTRACTED 1.00]
- **Admin Review Queues for Discovery and Verification** — discoveredcontactspanel_pending_discovery_review, suggestedchanges_profile_suggestion_review, derivedlabelspanel_derived_label_review_queue, stalecontactsbar_contact_freshness_workflow [EXTRACTED 1.00]
- **Normalized Profile Enrichment Paths** — csvimport_guided_import_workflow, discoveredcontactspanel_us_network_approval, derivedlabelspanel_canonical_label_promotion, suggestedchanges_profile_suggestion_review, csvimport_normalized_location_resolution [INFERRED 0.86]
- **US Location Resolution and Placement** — csvParser_connected_abroad_validation, locations_normalized_location_resolver, networkScope_us_connected_abroad_placement, networkScope_network_cluster_builder, matchCriteria_dashboard_match_criteria [INFERRED 0.82]
- **Staff Suggestion Review Surface** — derivedLabels_suggestion_normalization, verification_suggestion_normalization, verification_evidence_guidance, edgeError_structured_edge_function_error, toast_notification_adapter [INFERRED 0.78]
- **Dashboard Query State Contract** — filterParser_natural_language_filter_parser, supabase_dashboard_filter_model, matchCriteria_search_cache_scope, dashboardSession_dashboard_search_cache, appRouting_dashboard_route_state_contract [INFERRED 0.80]
- **Authenticated Staff Access Flow** — Login_staff_magic_link_flow, AuthCallback_staff_session_redirect, Account_staff_profile_update, auth_shared_staff_role_authentication, auth_staff_user_activation [INFERRED 0.80]
- **Mixed Collection Membership Flow** — phase4Collections_mixed_collection_members, phase4Collections_collection_suggestion_draft_workflow, phase4Collections_add_to_collection_mixed_entity_control, collectionSuggestions_mixed_entity_suggestions, databaseTypes_collection_member_row [EXTRACTED 0.90]
- **Network Scope Search Map Flow** — Dashboard_route_state_search_and_filters, Dashboard_hybrid_search_fusion, Dashboard_network_map_geocoding, networkScope_buildNetworkClusters, networkScope_person_us_connections, networkScope_organization_us_locations [INFERRED 0.85]
- **Discovery Growth Loop** — agentDiscovery_FrontierSeedingPlan, agentDiscovery_PageProcessingPipeline, agentDiscovery_DiscoveredContactPersistence, agentDiscovery_EntityPivotExpansion, agentDiscovery_ProvenDomainHarvest [EXTRACTED 1.00]
- **Verification Suggestion Pipeline** — verification_VerificationPriorityQueue, verification_LinkedInFirstVerification, verification_WebSearchLlmProfileCheck, verification_ProfileSuggestionRiskPolicy, verification_ProfileSuggestionDedupe [EXTRACTED 1.00]
- **Search Relevance Contract** — searchCriteria_ManualFilterKeywordMerge, searchCriteria_StructuredCriteriaCoverage, searchRouting_SearchRouteClassification, searchRouting_SnippetSelection, embeddings_StructuredPersonEmbeddings [INFERRED 0.75]
- **Verification Run Lifecycle** — agentVerify_VerificationCandidateBatch, agentVerify_VerificationExecution, agentVerify_VerificationSuggestionsPersistence, agentVerify_DerivedLabelUpsert, agentVerify_RunLifecyclePersistence, agentVerify_RunMetricsAndCost [EXTRACTED 1.00]
- **Embedding Refresh Lifecycle** — generateEmbeddings_TargetedAndBackfillEnqueue, generateEmbeddings_JobClaimToken, generateEmbeddings_StructuredPersonEmbeddingDocument, generateEmbeddings_PersonTextChunkEmbeddings, generateEmbeddings_JobReleaseOnFailureOrStaleness, generateEmbeddings_BatchPollingAndIngestion [EXTRACTED 1.00]
- **Hybrid Search And Suggestion Stack** — searchPeople_GeminiKeywordExtraction, searchPeople_QueryEmbedding, searchPeople_ReciprocalRankFusion, searchPeople_StructuredCriteriaCoverage, suggestPeople_GoalParsingPlan, suggestPeople_HybridCandidateRetrieval, suggestPeople_GeminiReranking [INFERRED 0.88]
- **US Geographic Base Map** — image_united_states_map_asset, image_state_boundary_lines, image_alaska_hawaii_insets, image_monochrome_cartographic_style [EXTRACTED 1.00]
- **Highlighted Mid Atlantic Location** — image_united_states_map_asset, image_state_boundary_lines, image_mid_atlantic_location_marker [INFERRED 0.85]

## Communities

### Community 0 - "Discovery Page Parsing"
Cohesion: 0.05
Nodes (92): canonicalizeUrl(), clamp(), classifyPageHeuristically(), countPatternMatches(), decodeXmlEntities(), extractCanonicalHref(), extractDomain(), extractFeedItemUrls() (+84 more)

### Community 1 - "Auth Collection Helpers"
Cohesion: 0.03
Nodes (59): defaultCodeForStatus(), getUserDisplayName(), HttpError, normalizeEmail(), requireStaffRole(), applyRerankAndBackfill(), asRecord(), cleanText() (+51 more)

### Community 2 - "Manual Contact Intake"
Cohesion: 0.04
Nodes (50): async(), checkDuplicate(), createEmptyForm(), emptyUsConnection(), ensureProtocol(), handleSubmit(), insertContact(), getDerivedLabelMetadata() (+42 more)

### Community 3 - "Apify Actor Client"
Cohesion: 0.07
Nodes (53): ApifyError, fetchWithRetry(), getApifyUsage(), runApifyActor(), runAsync(), runSync(), buildDedupeKey(), buildLinkedInCurrentPosition() (+45 more)

### Community 4 - "Discovery Agent Pipeline"
Cohesion: 0.06
Nodes (53): Discovery Candidate Consolidation, Discovered Contact Persistence, Discovery Agent Run Lifecycle, Discovery Entity Pivot Expansion, Discovery Frontier Claim And Heartbeat, Discovery Frontier Seeding Plan, Discovery LinkedIn Enrichment, Discovery Page Processing Pipeline (+45 more)

### Community 5 - "AI Prompt Contracts"
Cohesion: 0.06
Nodes (31): buildCheckProfilePrompt(), buildMergeTextPrompt(), buildParseContactsPrompt(), buildSearchPrompt(), getAiAgentTaskDefinition(), normalizeFlemishSearchResult(), normalizeMergeTextResult(), normalizeParsedContacts() (+23 more)

### Community 6 - "Product AI Docs"
Cohesion: 0.05
Nodes (50): Normalized Data Rules, Agent Scheduler Lifecycle Rule, Agent Discovery Service, Agent Scheduler Contract, Agent Verify Service, Generate Embeddings Service, Legacy AI Paths, Search People Endpoint (+42 more)

### Community 7 - "Frontend AI Search"
Cohesion: 0.06
Nodes (48): AI Agent Gateway Helper, Client-Side People Scoring, Deterministic Keyword Fallback, Discovery Contact Search Client, Embedding-Based People Suggestions, Hybrid Network Search Client, Admin Tab Access Normalization, Dashboard URL Serialization (+40 more)

### Community 8 - "Location Network Scope"
Cohesion: 0.07
Nodes (30): addToCache(), ensureLocationsLoaded(), fetchLocations(), loadBundledLocations(), lookupCity(), normalizeStateCode(), resolveLocationId(), buildNetworkClusters() (+22 more)

### Community 9 - "AI Search Clients"
Cohesion: 0.07
Nodes (26): handleCreateCollection(), toggleCollection(), buildFallbackKeywords(), buildFallbackTerms(), callAI(), discoverContacts(), getIndexedString(), getNestedString() (+18 more)

### Community 10 - "Admin Page Workflows"
Cohesion: 0.05
Nodes (43): Discovery Scheduler Trigger, Embedding Backfill Loop, Staff Workspace Tabs, Verification Batching, Collections List And Detail Router, Hybrid Search Fusion, Network Map Geocoding, Organization Key Contacts (+35 more)

### Community 11 - "Embedding Text Pipeline"
Cohesion: 0.09
Nodes (33): appendLabeledLine(), buildBioChunks(), buildPersonTextChunks(), buildStructuredEmbeddingText(), createAsyncEmbeddingBatch(), embedBatch(), embedSingle(), embedTexts() (+25 more)

### Community 12 - "Import Route Contracts"
Cohesion: 0.06
Nodes (40): Admin Discovery Scheduler Handoff Contract, Admin Tab Canonicalization Contract, Dashboard Route State Contract, US-Connected Abroad Import Validation, CSV and Excel Import Parser, Fuzzy Header Mapping, Profile Import Field Vocabulary, Profile Import Template (+32 more)

### Community 13 - "Staff Discovery UI"
Cohesion: 0.06
Nodes (38): Staff Access Control, Discovery Intake, Manual Intake Persistence, US Network Scope Validation, Collection Membership Editor, Single Entity Selection Rule, Discovery Operations Console, Run Step Timeline (+30 more)

### Community 14 - "Embedding Edge Functions"
Cohesion: 0.07
Nodes (38): Discover Contacts Canonical Endpoint, Async Gemini Embedding Batch, Batch Polling And Ingestion, Batch Run Persistence, Dirty At Concurrency Guard, Embedding Batch Cancellation, Embedding Generation Endpoint, Embedding Job Queue (+30 more)

### Community 15 - "Derived Label Logic"
Cohesion: 0.15
Nodes (26): buildDedupeKey(), buildDiscoveryDerivedLabels(), buildLocationSeed(), buildSubjectKey(), buildVerificationDerivedLabels(), clampConfidence(), deriveProfileConfidence(), deriveSourceQuality() (+18 more)

### Community 16 - "CSV Import Workflow"
Cohesion: 0.09
Nodes (16): buildSectorLookup(), checkDuplicates(), getErrorMessage(), handleConfirm(), handleImport(), inferPeopleScope(), normalizePeopleScope(), normalizeSectorName() (+8 more)

### Community 17 - "Collection Suggestions"
Cohesion: 0.16
Nodes (14): handleNext(), handleResetDraft(), loadSuggestions(), addUniqueId(), collectionSuggestionCandidateKey(), collectionSuggestionDraftReducer(), getAcceptedDraftCandidates(), getCollectionSuggestionExclusionPayload() (+6 more)

### Community 18 - "Export Services"
Cohesion: 0.2
Nodes (13): buildPeopleCsv(), buildPeopleWorksheetData(), downloadFile(), enrichPeopleForExport(), escapeHtml(), exportPeopleToCsv(), exportPeopleToExcel(), filenameWithExtension() (+5 more)

### Community 19 - "Route Shell"
Cohesion: 0.14
Nodes (6): ProtectedLayout(), loadApprovedStaffUser(), normalizeAuthError(), RequireAuth(), useAuth(), AuthCallback()

### Community 20 - "App Routing"
Cohesion: 0.17
Nodes (9): buildDashboardLocation(), buildDashboardSearchParams(), buildDashboardStateFromPreset(), defaultDashboardRouteState(), parseBooleanParam(), parseDashboardRouteState(), sanitizeValues(), roundtrip() (+1 more)

### Community 21 - "Verification Agent"
Cohesion: 0.14
Nodes (17): Agent Verify Endpoint, Derived Label Upsert, Profile Verified Marking, Quota Exhaustion Stop, Run Heartbeat, Run Lifecycle Persistence, Run Metrics And Cost Estimate, Staff Editor Authorization (+9 more)

### Community 22 - "System Health Utilities"
Cohesion: 0.2
Nodes (4): formatAge(), formatDuration(), isRecord(), providerUsage()

### Community 23 - "Phase Search Seed"
Cohesion: 0.36
Nodes (10): buildOrganizations(), deleteFrom(), deleteWhereNotNull(), ensureCatalogs(), main(), pick(), resetPhase3Data(), seedOrganizations() (+2 more)

### Community 24 - "Import Fixture Generator"
Cohesion: 0.36
Nodes (7): buildBio(), generateName(), occupationFor(), pick(), rowFor(), slugify(), titleFor()

### Community 25 - "Profile Editing"
Cohesion: 0.24
Nodes (4): ensureProtocol(), handleAddCustomFlemish(), saveEdits(), toggleEditFlemish()

### Community 27 - "Dashboard Session Cache"
Cohesion: 0.47
Nodes (8): canUseSessionStorage(), getCachedDashboardSearch(), getLastDashboardLocation(), normalizeQuery(), readSearchCache(), setCachedDashboardSearch(), setLastDashboardLocation(), writeSearchCache()

### Community 28 - "Geocode Endpoint"
Cohesion: 0.29
Nodes (8): Batch Input Cap, Existing Location Reuse, Geocode Endpoint, Location Candidate Parsing, Location Upsert Contract, Nominatim Lookup, Rate Limit Delay, Review Required Policy

### Community 29 - "Smoke Tests"
Cohesion: 0.52
Nodes (5): cleanupSmokeSession(), main(), provisionSmokeSession(), runOne(), serviceFetch()

### Community 30 - "Product Architecture Docs"
Cohesion: 0.29
Nodes (7): Graphify Maintenance Rule, AI Pipeline Service Map, Flemish App CRM Positioning, Five Service Product Model, Cleanup Phase Plan, TypeScript React Linting, Vitest JSDOM Unit Tests

### Community 31 - "Error Boundary"
Cohesion: 0.4
Nodes (1): ErrorBoundary

### Community 33 - "Verification Labels"
Cohesion: 0.4
Nodes (6): Canonical Derived Label Policy, Derived Location Summary Metadata, Derived Label Suggestion Normalization, Verification Evidence Guidance, Verification Suggestion Normalization, Verification Suggestion Risk Policy

### Community 34 - "Filter Parsing Tests"
Cohesion: 0.33
Nodes (6): Dashboard Route State Search And Filters, isLocationOnlyQuery, Natural Language Filter Parsing, parseFiltersFromQuery, applyPeopleMatchCriteria, Scope Match Criteria Mode

### Community 35 - "Staff Authentication"
Cohesion: 0.47
Nodes (6): Staff Profile Update, Staff Session Redirect, Staff Magic Link Flow, HTTP Error Contract, Shared Staff Role Authentication, Staff User Activation

### Community 36 - "AI Agent Endpoint"
Cohesion: 0.33
Nodes (6): AI Agent Task Router, AI Task Contract Registry, Gemini Structured Execution, Invalid Task Guard, Staff Viewer Authorization, Task Meta Response

### Community 39 - "Flemish Picker"
Cohesion: 0.7
Nodes (4): addExisting(), handleCreate(), normalizeName(), removeSelected()

### Community 43 - "Map Asset"
Cohesion: 0.4
Nodes (5): Alaska And Hawaii Insets, Mid Atlantic Location Marker, Monochrome Cartographic Style, State Boundary Lines, United States Map Asset

### Community 45 - "Connections Summary"
Cohesion: 0.83
Nodes (3): ConnectionsSummary(), countCollectionCoverage(), summarizeConnections()

### Community 46 - "Network Presets"
Cohesion: 0.67
Nodes (2): buildNetworkPreset(), mapCategoryToNetworkOccupation()

### Community 47 - "Filter Parser"
Cohesion: 0.67
Nodes (2): isLocationOnlyQuery(), normalizeQueryTerm()

### Community 49 - "Flemish Chart"
Cohesion: 1.0
Nodes (2): buildCounts(), FlemishConnectionChart()

### Community 51 - "Availability Overview"
Cohesion: 1.0
Nodes (2): AvailabilityOverview(), countMatches()

### Community 52 - "Occupation Overview"
Cohesion: 1.0
Nodes (2): buildCategoryCounts(), OccupationOverview()

### Community 55 - "App Bootstrap"
Cohesion: 0.67
Nodes (3): Copyable Failure Report, Authenticated App Shell, Vite Client Type Environment

### Community 56 - "Auth Provider"
Cohesion: 1.0
Nodes (3): Role-Based Route Guard, Staff Authentication Provider, Approved Staff Session Activation

### Community 57 - "Suggestion Drafts"
Cohesion: 1.0
Nodes (3): Rejected Candidate Suppression, Collection Suggestion Draft Lifecycle, Collection Suggestion Exclusion Payload

### Community 58 - "Edge Error Toasts"
Cohesion: 1.0
Nodes (3): Error Description Adapter, Structured Edge Function Error, Notification Adapter

### Community 59 - "Export Tests"
Cohesion: 0.67
Nodes (3): buildPeopleCsv, buildPeopleWorksheetData, People Export Formatting

### Community 72 - "Agent Instructions"
Cohesion: 1.0
Nodes (2): Active Source Of Truth Docs, Project Operating Rules

### Community 73 - "Model Routing Strategy"
Cohesion: 1.0
Nodes (2): Gemini Model Routing, Archived Model Strategy

## Knowledge Gaps
- **109 isolated node(s):** `Project Operating Rules`, `Active Source Of Truth Docs`, `Agent Scheduler Lifecycle Rule`, `Normalized Data Rules`, `Graphify Maintenance Rule` (+104 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Error Boundary`** (6 nodes): `ErrorBoundary`, `.buildReport()`, `.componentDidCatch()`, `.getDerivedStateFromError()`, `.render()`, `ErrorBoundary.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Network Presets`** (4 nodes): `buildNetworkPreset()`, `getFreshnessTier()`, `mapCategoryToNetworkOccupation()`, `interactiveStatsShared.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Filter Parser`** (4 nodes): `isLocationOnlyQuery()`, `normalizeQueryTerm()`, `parseFiltersFromQuery()`, `filterParser.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Flemish Chart`** (3 nodes): `buildCounts()`, `FlemishConnectionChart()`, `FlemishConnectionChart.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Availability Overview`** (3 nodes): `AvailabilityOverview()`, `countMatches()`, `AvailabilityOverview.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Occupation Overview`** (3 nodes): `buildCategoryCounts()`, `OccupationOverview()`, `OccupationOverview.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Agent Instructions`** (2 nodes): `Active Source Of Truth Docs`, `Project Operating Rules`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Model Routing Strategy`** (2 nodes): `Gemini Model Routing`, `Archived Model Strategy`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `normalizeWhitespace()` connect `Discovery Page Parsing` to `Manual Contact Intake`, `Embedding Text Pipeline`?**
  _High betweenness centrality (0.094) - this node is a cross-community bridge._
- **Why does `getPersonFlemishConnectionText()` connect `Manual Contact Intake` to `AI Search Clients`, `Export Services`?**
  _High betweenness centrality (0.044) - this node is a cross-community bridge._
- **Are the 3 inferred relationships involving `processFrontierRow()` (e.g. with `fetchPage()` and `classifyPageHeuristically()`) actually correct?**
  _`processFrontierRow()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **Are the 17 inferred relationships involving `normalizeWhitespace()` (e.g. with `normalizeName()` and `normalizeEmail()`) actually correct?**
  _`normalizeWhitespace()` has 17 INFERRED edges - model-reasoned connections that need verification._
- **Are the 15 inferred relationships involving `safeString()` (e.g. with `normalizeName()` and `normalizeEmail()`) actually correct?**
  _`safeString()` has 15 INFERRED edges - model-reasoned connections that need verification._
- **Are the 2 inferred relationships involving `maybeHarvestProvenDomain()` (e.g. with `harvestSitemapUrls()` and `harvestFeedUrls()`) actually correct?**
  _`maybeHarvestProvenDomain()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Project Operating Rules`, `Active Source Of Truth Docs`, `Agent Scheduler Lifecycle Rule` to the rest of the system?**
  _109 weakly-connected nodes found - possible documentation gaps or missing edges._