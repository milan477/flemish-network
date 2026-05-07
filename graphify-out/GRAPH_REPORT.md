# Graph Report - flemish-network  (2026-05-07)

## Corpus Check
- 136 files · ~175,880 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 929 nodes · 1636 edges · 36 communities detected
- Extraction: 90% EXTRACTED · 10% INFERRED · 0% AMBIGUOUS · INFERRED: 163 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 45|Community 45]]

## God Nodes (most connected - your core abstractions)
1. `safeString()` - 27 edges
2. `normalizeWhitespace()` - 27 edges
3. `processFrontierRow()` - 23 edges
4. `safeStr()` - 18 edges
5. `maybeHarvestProvenDomain()` - 11 edges
6. `prepareEmbeddingJobs()` - 11 edges
7. `notifyError()` - 11 edges
8. `normalizeEmail()` - 10 edges
9. `uniqueStrings()` - 10 edges
10. `buildLocationSeed()` - 10 edges

## Surprising Connections (you probably didn't know these)
- `buildCoverageTargetKeys()` --calls--> `normalizeWhitespace()`  [INFERRED]
  supabase/functions/agent-discovery/index.ts → src/lib/flemishConnections.ts
- `normalizeSentenceBoundaries()` --calls--> `normalizeWhitespace()`  [INFERRED]
  supabase/functions/_shared/embeddings.ts → src/lib/flemishConnections.ts
- `appendLabeledLine()` --calls--> `normalizeWhitespace()`  [INFERRED]
  supabase/functions/_shared/embeddings.ts → src/lib/flemishConnections.ts
- `pushChunk()` --calls--> `normalizeWhitespace()`  [INFERRED]
  supabase/functions/_shared/embeddings.ts → src/lib/flemishConnections.ts
- `printCollectionBriefing()` --calls--> `write()`  [INFERRED]
  src/lib/exportService.ts → supabase/functions/_shared/log.ts

## Communities

### Community 0 - "Community 0"
Cohesion: 0.05
Nodes (92): safeString(), clampConfidence(), likelySameOrganization(), mergeOrganizationCandidates(), normalizeOrganizationLocation(), normalizeOrganizationName(), normalizeOrganizationWebsite(), organizationCandidateKey() (+84 more)

### Community 1 - "Community 1"
Cohesion: 0.06
Nodes (44): applyRerankAndBackfill(), asRecord(), cleanText(), collectionSuggestionKey(), fallbackCollectionSuggestionPlan(), parseCollectionSuggestionPlan(), parseRerankedCollectionCandidates(), buildCacheSystemInstruction() (+36 more)

### Community 2 - "Community 2"
Cohesion: 0.07
Nodes (48): appendLabeledLine(), buildBioChunks(), buildOrganizationStructuredEmbeddingText(), buildOrganizationTextChunks(), buildPersonTextChunks(), buildSentenceChunks(), buildStructuredEmbeddingText(), createAsyncEmbeddingBatch() (+40 more)

### Community 3 - "Community 3"
Cohesion: 0.07
Nodes (34): checkDuplicate(), createEmptyForm(), createEmptyOrganizationForm(), emptyUsConnection(), ensureProtocol(), handleSubmit(), insertContact(), insertOrganization() (+26 more)

### Community 4 - "Community 4"
Cohesion: 0.09
Nodes (46): buildDedupeKey(), buildLinkedInCurrentPosition(), buildPriorityContext(), buildSearchQuery(), buildSuggestion(), callCheckProfile(), canonicalizeLinkedInUrl(), clampConfidence() (+38 more)

### Community 5 - "Community 5"
Cohesion: 0.06
Nodes (26): defaultCodeForStatus(), getUserDisplayName(), HttpError, normalizeEmail(), requireStaffRole(), agentRunErrorKindFor(), errorKindFor(), errorToResponse() (+18 more)

### Community 6 - "Community 6"
Cohesion: 0.06
Nodes (28): handleCreateCollection(), toggleCollection(), buildFallbackKeywords(), buildFallbackTerms(), callAI(), getIndexedString(), getNestedString(), hybridSearch() (+20 more)

### Community 7 - "Community 7"
Cohesion: 0.09
Nodes (27): buildCheckProfilePrompt(), buildMergeTextPrompt(), buildSearchPrompt(), getAiAgentTaskDefinition(), normalizeMergeTextResult(), normalizeSmartSearchResult(), safeString(), toLowercaseStringArray() (+19 more)

### Community 8 - "Community 8"
Cohesion: 0.09
Nodes (22): async(), getDerivedLabelMetadata(), getDerivedLocationSummary(), isCanonicalDerivedLabel(), approveLabel(), canonicalizeFlemishConnection(), countWords(), extractFlemishConnectionsFromText() (+14 more)

### Community 9 - "Community 9"
Cohesion: 0.15
Nodes (26): buildDedupeKey(), buildDiscoveryDerivedLabels(), buildLocationSeed(), buildSubjectKey(), buildVerificationDerivedLabels(), clampConfidence(), deriveProfileConfidence(), deriveSourceQuality() (+18 more)

### Community 10 - "Community 10"
Cohesion: 0.09
Nodes (19): approveContact(), approveOrganization(), checkOrganizationDuplicates(), getVal(), mergeIntoExisting(), mergeOrganizationIntoExisting(), mergeTextViaAI(), normalizeName() (+11 more)

### Community 11 - "Community 11"
Cohesion: 0.09
Nodes (19): addToCache(), ensureLocationsLoaded(), fetchLocations(), loadBundledLocations(), lookupCity(), normalizeStateCode(), resolveLocationId(), applySelected() (+11 more)

### Community 12 - "Community 12"
Cohesion: 0.17
Nodes (23): canonicalizeUrl(), clamp(), classifyPageHeuristically(), countPatternMatches(), decodeXmlEntities(), extractCanonicalHref(), extractDomain(), extractFeedItemUrls() (+15 more)

### Community 13 - "Community 13"
Cohesion: 0.16
Nodes (14): handleNext(), handleResetDraft(), loadSuggestions(), addUniqueId(), collectionSuggestionCandidateKey(), collectionSuggestionDraftReducer(), getAcceptedDraftCandidates(), getCollectionSuggestionExclusionPayload() (+6 more)

### Community 14 - "Community 14"
Cohesion: 0.14
Nodes (6): ProtectedLayout(), loadApprovedStaffUser(), normalizeAuthError(), RequireAuth(), useAuth(), AuthCallback()

### Community 15 - "Community 15"
Cohesion: 0.17
Nodes (9): buildDashboardLocation(), buildDashboardSearchParams(), buildDashboardStateFromPreset(), defaultDashboardRouteState(), parseBooleanParam(), parseDashboardRouteState(), sanitizeValues(), roundtrip() (+1 more)

### Community 16 - "Community 16"
Cohesion: 0.2
Nodes (13): buildPeopleCsv(), buildPeopleWorksheetData(), downloadFile(), enrichPeopleForExport(), escapeHtml(), exportPeopleToCsv(), exportPeopleToExcel(), filenameWithExtension() (+5 more)

### Community 17 - "Community 17"
Cohesion: 0.23
Nodes (11): applyCriteria(), applyOrganizationMatchCriteria(), applyPeopleMatchCriteria(), buildOrganizationCriteria(), buildPersonCriteria(), countActiveMatchCriteria(), organizationMatchesText(), personMatchesFlemishConnection() (+3 more)

### Community 18 - "Community 18"
Cohesion: 0.25
Nodes (11): buildNetworkClusters(), clusterLocation(), currentAbroadBaseLabel(), isUsConnectedAbroad(), locationMatches(), organizationMatchesLocation(), organizationPlacementLocations(), personCardLocationLabel() (+3 more)

### Community 19 - "Community 19"
Cohesion: 0.2
Nodes (4): formatAge(), formatDuration(), isRecord(), providerUsage()

### Community 20 - "Community 20"
Cohesion: 0.36
Nodes (10): buildOrganizations(), deleteFrom(), deleteWhereNotNull(), ensureCatalogs(), main(), pick(), resetPhase3Data(), seedOrganizations() (+2 more)

### Community 21 - "Community 21"
Cohesion: 0.36
Nodes (7): buildBio(), generateName(), occupationFor(), pick(), rowFor(), slugify(), titleFor()

### Community 22 - "Community 22"
Cohesion: 0.24
Nodes (4): ensureProtocol(), handleAddCustomFlemish(), saveEdits(), toggleEditFlemish()

### Community 23 - "Community 23"
Cohesion: 0.33
Nodes (7): ApifyError, fetchWithRetry(), getApifyUsage(), runApifyActor(), runAsync(), runSync(), getVerificationApifyAvailability()

### Community 25 - "Community 25"
Cohesion: 0.47
Nodes (8): canUseSessionStorage(), getCachedDashboardSearch(), getLastDashboardLocation(), normalizeQuery(), readSearchCache(), setCachedDashboardSearch(), setLastDashboardLocation(), writeSearchCache()

### Community 26 - "Community 26"
Cohesion: 0.52
Nodes (5): cleanupSmokeSession(), main(), provisionSmokeSession(), runOne(), serviceFetch()

### Community 27 - "Community 27"
Cohesion: 0.33
Nodes (2): formatCount(), summarizeResults()

### Community 28 - "Community 28"
Cohesion: 0.4
Nodes (1): ErrorBoundary

### Community 32 - "Community 32"
Cohesion: 0.7
Nodes (4): addExisting(), handleCreate(), normalizeName(), removeSelected()

### Community 36 - "Community 36"
Cohesion: 0.83
Nodes (3): ConnectionsSummary(), countCollectionCoverage(), summarizeConnections()

### Community 37 - "Community 37"
Cohesion: 0.67
Nodes (2): buildNetworkPreset(), mapCategoryToNetworkOccupation()

### Community 38 - "Community 38"
Cohesion: 0.67
Nodes (2): isLocationOnlyQuery(), normalizeQueryTerm()

### Community 40 - "Community 40"
Cohesion: 1.0
Nodes (2): buildCounts(), FlemishConnectionChart()

### Community 42 - "Community 42"
Cohesion: 1.0
Nodes (2): AvailabilityOverview(), countMatches()

### Community 43 - "Community 43"
Cohesion: 1.0
Nodes (2): buildCategoryCounts(), OccupationOverview()

### Community 45 - "Community 45"
Cohesion: 1.0
Nodes (2): collectSourceFiles(), extensionFor()

## Knowledge Gaps
- **Thin community `Community 27`** (7 nodes): `formatCount()`, `formatDate()`, `formatDuration()`, `getQuota()`, `serviceLabelForRun()`, `summarizeResults()`, `AgentDashboard.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 28`** (6 nodes): `ErrorBoundary`, `.buildReport()`, `.componentDidCatch()`, `.getDerivedStateFromError()`, `.render()`, `ErrorBoundary.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 37`** (4 nodes): `buildNetworkPreset()`, `getFreshnessTier()`, `mapCategoryToNetworkOccupation()`, `interactiveStatsShared.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 38`** (4 nodes): `isLocationOnlyQuery()`, `normalizeQueryTerm()`, `parseFiltersFromQuery()`, `filterParser.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 40`** (3 nodes): `buildCounts()`, `FlemishConnectionChart()`, `FlemishConnectionChart.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 42`** (3 nodes): `AvailabilityOverview()`, `countMatches()`, `AvailabilityOverview.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 43`** (3 nodes): `buildCategoryCounts()`, `OccupationOverview()`, `OccupationOverview.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 45`** (3 nodes): `collectSourceFiles()`, `extensionFor()`, `phase5DiscoveryQualityGates.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `normalizeWhitespace()` connect `Community 0` to `Community 8`, `Community 2`?**
  _High betweenness centrality (0.231) - this node is a cross-community bridge._
- **Why does `getPersonFlemishConnectionText()` connect `Community 6` to `Community 8`, `Community 17`, `Community 16`?**
  _High betweenness centrality (0.089) - this node is a cross-community bridge._
- **Are the 23 inferred relationships involving `safeString()` (e.g. with `normalizeName()` and `normalizeEmail()`) actually correct?**
  _`safeString()` has 23 INFERRED edges - model-reasoned connections that need verification._
- **Are the 24 inferred relationships involving `normalizeWhitespace()` (e.g. with `normalizeName()` and `normalizeEmail()`) actually correct?**
  _`normalizeWhitespace()` has 24 INFERRED edges - model-reasoned connections that need verification._
- **Are the 3 inferred relationships involving `processFrontierRow()` (e.g. with `fetchPage()` and `classifyPageHeuristically()`) actually correct?**
  _`processFrontierRow()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **Are the 2 inferred relationships involving `maybeHarvestProvenDomain()` (e.g. with `harvestSitemapUrls()` and `harvestFeedUrls()`) actually correct?**
  _`maybeHarvestProvenDomain()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._