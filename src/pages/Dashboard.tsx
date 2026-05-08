import { Suspense, lazy, useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { Map as MapIcon, List, X, Search as SearchIcon, MapPin } from 'lucide-react';
import {
  supabase,
  type Person,
  type Organization,
  type MapCluster,
  type MapFilters,
  type FilterPreset,
  type ActiveAiFilter,
  type FlemishConnection,
  type SearchMatchMode,
} from '../lib/supabase';
import DirectoryGrid from '../components/DirectoryGrid';
import FilterPanel from '../components/FilterPanel';
import UnifiedSearchBar from '../components/UnifiedSearchBar';
import {
  lookupCity,
  ensureLocationsLoaded,
  addToCache,
} from '../lib/locations';
import { geocodeBatch } from '../lib/geocoding';
import { isLocationOnlyQuery, parseFiltersFromQuery } from '../lib/filterParser';
import {
  scorePersonAgainstFilter,
  networkSearch,
  type HybridSearchResultItem,
} from '../lib/aiService';
import {
  type DashboardViewMode,
  type DashboardRouteState,
  buildDashboardSearchParams,
  parseDashboardRouteState,
} from '../lib/appRouting';
import {
  getCachedDashboardSearch,
  setCachedDashboardSearch,
  setLastDashboardLocation,
} from '../lib/dashboardSession';
import {
  applyOrganizationMatchCriteria,
  applyPeopleMatchCriteria,
  countActiveMatchCriteria,
  dashboardSearchCacheScope,
} from '../lib/matchCriteria';
import {
  buildLightClusters,
  buildNetworkClusters,
  organizationMatchesLocation,
  personMatchesLocation,
} from '../lib/networkScope';

const MapVisualization = lazy(() => import('../components/MapVisualization'));

const PEOPLE_SELECT = '*, locations(*), person_us_connections(*, locations(*)), person_flemish_connections(flemish_connection_id, flemish_connections(id, name, type)), person_sectors(sectors(name))';
const ORG_SELECT = '*, locations(*), organization_us_locations(*, locations(*)), organization_flemish_connections(flemish_connection_id, flemish_connections(id, name, type, entity_type, is_filterable))';
const INITIAL_PAGE = 12;
const MORE_PAGE = 24;

interface DashboardProps {
  onNavigate: (page: string, id?: string, preset?: FilterPreset) => void;
}

function toSearchParams(state: DashboardRouteState): URLSearchParams {
  return buildDashboardSearchParams(state);
}

export default function Dashboard({ onNavigate }: DashboardProps) {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const routeState = useMemo(
    () => parseDashboardRouteState(searchParams),
    [searchParams]
  );
  const {
    view: viewMode,
    query: activeQuery,
    matchMode,
    filters,
    focusedCity,
  } = routeState;

  const [people, setPeople] = useState<Person[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [clusters, setClusters] = useState<MapCluster[]>([]);
  const [flemishOptions, setFlemishOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMorePeople, setHasMorePeople] = useState(false);
  const [hasMoreOrgs, setHasMoreOrgs] = useState(false);
  const [fullDataReady, setFullDataReady] = useState(false);
  const [showFilters, setShowFilters] = useState(true);
  const [stats, setStats] = useState({
    people: 0,
    organizations: 0,
    cities: 0,
  });

  const [nameMatches, setNameMatches] = useState<Person[]>([]);
  const [aiResults, setAiResults] = useState<Person[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [snippets, setSnippets] = useState<Map<string, string>>(new Map());
  const [focusTrigger, setFocusTrigger] = useState(0);
  const [activeFilters, setActiveFilters] = useState<ActiveAiFilter[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);

  const loadIdRef = useRef(0);
  const fullDataReadyRef = useRef(false);
  const searchRequestIdRef = useRef(0);
  const activeMatchCriteriaCount = useMemo(
    () => countActiveMatchCriteria(filters),
    [filters]
  );
  const effectiveMatchMode = activeMatchCriteriaCount > 1 ? matchMode : 'all';

  const updateRouteState = useCallback(
    (
      updater: (current: DashboardRouteState) => DashboardRouteState,
      options?: { replace?: boolean }
    ) => {
      const nextState = updater(routeState);
      setSearchParams(toSearchParams(nextState), {
        replace: options?.replace,
      });
    },
    [routeState, setSearchParams]
  );

  const clearSearchResults = useCallback(() => {
    setNameMatches([]);
    setAiResults([]);
    setSnippets(new Map());
  }, []);

  const handleClearSearchQuery = useCallback(() => {
    clearSearchResults();
    setSearchError(null);
    updateRouteState((current) => ({
      ...current,
      query: '',
    }));
  }, [clearSearchResults, updateRouteState]);

  const runSearch = useCallback(
    async (
      query: string,
      currentFilters: MapFilters,
      currentMatchMode: SearchMatchMode
    ) => {
      const requestId = ++searchRequestIdRef.current;
      const cacheScope = dashboardSearchCacheScope(currentFilters, currentMatchMode);
      const cached = getCachedDashboardSearch(query, cacheScope);

      if (cached) {
        setNameMatches(cached.nameMatches);
        setAiResults(cached.aiResults);
        setPeople([...cached.nameMatches, ...cached.aiResults]);
        setOrganizations(cached.organizationResults || []);
        setSnippets(new Map(cached.snippets));
        const cachedClusters = buildNetworkClusters(
          [...cached.nameMatches, ...cached.aiResults],
          cached.organizationResults || [],
          currentFilters
        );
        setClusters(cachedClusters);
        setStats({
          people: cached.nameMatches.length + cached.aiResults.length,
          organizations: (cached.organizationResults || []).length,
          cities: new Set(cachedClusters.map((cluster) => cluster.city)).size,
        });
        setAiLoading(false);
        return;
      }

      clearSearchResults();
      setSearchError(null);

      const words = query.trim().split(/\s+/);
      const isDirectSearch = words.length <= 4;

      setAiLoading(true);

      try {
        const nameMatchPromise = isDirectSearch
          ? (async () => {
              const searchTerms = query
                .toLowerCase()
                .replace(/^dr\.?\s+/, '')
                .split(' ');
              const mainTerm = searchTerms[searchTerms.length - 1];
              const { data } = await supabase
                .from('people')
                .select(
                  '*, locations(*), person_us_connections(*, locations(*)), person_flemish_connections(flemish_connection_id, flemish_connections(id, name, type)), person_sectors(sectors(name))'
                )
                .or(
                  `name.ilike.%${query}%,first_name.ilike.%${query}%,last_name.ilike.%${query}%,name.ilike.%${mainTerm}%`
                )
                .limit(20);
              return applyPeopleMatchCriteria(
                (data as Person[]) || [],
                currentFilters,
                currentMatchMode
              );
            })()
          : Promise.resolve([]);

        const hybridPromise = networkSearch(
          query,
          30,
          currentMatchMode,
          currentFilters
        );
        const [nameResults, hybridResult] = await Promise.all([
          nameMatchPromise,
          hybridPromise,
        ]);

        if (requestId !== searchRequestIdRef.current) return;

        const nameResultIds = new Set(nameResults.map((person) => person.id));
        const fusedResults = hybridResult.results.filter(
          (result) =>
            result.entity_type !== 'person' || !nameResultIds.has(result.id)
        );
        const fusedPeopleResults = fusedResults.filter(
          (result): result is Extract<HybridSearchResultItem, { entity_type: 'person' }> =>
            result.entity_type === 'person'
        );
        const organizationResults = fusedResults.filter(
          (result): result is Extract<HybridSearchResultItem, { entity_type: 'organization' }> =>
            result.entity_type === 'organization'
        );
        const aiPeople = fusedPeopleResults.map(
          (result) => result as unknown as Person
        );
        const searchOrganizations = organizationResults.map(
          (result) => result as unknown as Organization
        );
        const nextSnippets = new Map<string, string>();

        for (const result of fusedResults) {
          if (result.snippet) nextSnippets.set(result.id, result.snippet);
        }

        setNameMatches(nameResults);
        setAiResults(aiPeople);
        setPeople([...nameResults, ...aiPeople]);
        setOrganizations(searchOrganizations);
        setSnippets(nextSnippets);
        const searchClusters = buildNetworkClusters(
          [...nameResults, ...aiPeople],
          searchOrganizations,
          currentFilters
        );
        setClusters(searchClusters);
        setStats({
          people: nameResults.length + aiPeople.length,
          organizations: searchOrganizations.length,
          cities: new Set(searchClusters.map((cluster) => cluster.city)).size,
        });

        setCachedDashboardSearch({
          query,
          scope: cacheScope,
          nameMatches: nameResults,
          aiResults: aiPeople,
          organizationResults: searchOrganizations,
          snippets: Array.from(nextSnippets.entries()),
        });
      } catch (error) {
        if (requestId !== searchRequestIdRef.current) return;
        clearSearchResults();
        setSearchError(
          error instanceof Error
            ? error.message
            : 'AI search is currently unavailable.'
        );
      } finally {
        if (requestId === searchRequestIdRef.current) {
          setAiLoading(false);
        }
      }
    },
    [clearSearchResults]
  );

  const handleSearch = useCallback(
    (query: string) => {
      if (!query) {
        handleClearSearchQuery();
        return;
      }

      if (query.startsWith('id:')) {
        const [, id, type] = query.split(':');
        onNavigate(type, id);
        return;
      }

      const trimmedQuery = query.trim();
      const parsed = parseFiltersFromQuery(trimmedQuery, filters);
      const nextQuery = isLocationOnlyQuery(trimmedQuery) ? '' : trimmedQuery;

      clearSearchResults();
      setSearchError(null);

      updateRouteState((current) => ({
        ...current,
        query: nextQuery,
        view: 'list',
        filters: parsed.filters,
        focusedCity: null,
      }));
    },
    [clearSearchResults, filters, handleClearSearchQuery, onNavigate, updateRouteState]
  );

  const handleLoadMorePeople = useCallback(async () => {
    setLoadingMore(true);
    const { data } = await supabase
      .from('people')
      .select(PEOPLE_SELECT)
      .range(people.length, people.length + MORE_PAGE - 1);
    const next = (data || []) as Person[];
    setPeople((prev) => [...prev, ...next]);
    setHasMorePeople(next.length === MORE_PAGE);
    setLoadingMore(false);
  }, [people.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleLoadMoreOrgs = useCallback(async () => {
    setLoadingMore(true);
    const { data } = await supabase
      .from('organizations')
      .select(ORG_SELECT)
      .range(organizations.length, organizations.length + MORE_PAGE - 1);
    const next = (data || []) as Organization[];
    setOrganizations((prev) => [...prev, ...next]);
    setHasMoreOrgs(next.length === MORE_PAGE);
    setLoadingMore(false);
  }, [organizations.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setLastDashboardLocation(`${location.pathname}${location.search}`);
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (activeMatchCriteriaCount > 1 || matchMode === 'all') return;

    updateRouteState(
      (current) => ({
        ...current,
        matchMode: 'all',
      }),
      { replace: true }
    );
  }, [activeMatchCriteriaCount, matchMode, updateRouteState]);

  useEffect(() => {
    supabase
      .from('flemish_connections')
      .select('name')
      .eq('is_filterable', true)
      .order('name')
      .then(({ data }) => {
        const names = ((data || []) as Pick<FlemishConnection, 'name'>[]).map(
          (connection) => connection.name
        );
        setFlemishOptions(names);
      });
  }, []);

  useEffect(() => {
    if (activeQuery) {
      setLoading(false);
      return;
    }

    const loadId = ++loadIdRef.current;
    fullDataReadyRef.current = false;
    setFullDataReady(false);
    setHasMorePeople(false);
    setHasMoreOrgs(false);

    // Tier 1: lightweight RPC so map circles appear immediately
    let tier1Cancelled = false;
    supabase.rpc('get_network_location_summary').then(({ data }) => {
      if (!tier1Cancelled && !fullDataReadyRef.current && loadIdRef.current === loadId && data) {
        setClusters(buildLightClusters(data as Parameters<typeof buildLightClusters>[0], filters));
      }
    });

    const hasActiveFilters =
      filters.availableForLectures ||
      countActiveMatchCriteria(filters) > 0 ||
      activeFilters.length > 0;

    // Tier 2a: paginated list — shows 12 people + 12 orgs immediately
    (async () => {
      setLoading(true);
      await ensureLocationsLoaded();

      let peopleData: Person[] = [];
      let orgsData: Organization[] = [];
      let morePeople = false;
      let moreOrgs = false;

      if (filters.showPeople) {
        if (!hasActiveFilters) {
          const { data } = await supabase.from('people').select(PEOPLE_SELECT).range(0, INITIAL_PAGE - 1);
          peopleData = (data || []) as Person[];
          morePeople = peopleData.length === INITIAL_PAGE;
        } else {
          let q = supabase.from('people').select(PEOPLE_SELECT);
          if (filters.availableForLectures) q = q.eq('available_for_lectures', true);
          const { data } = await q;
          let p = applyPeopleMatchCriteria((data || []) as Person[], filters, effectiveMatchMode);
          if (activeFilters.length > 0) {
            p = p.filter((person) =>
              activeFilters.every((f) =>
                scorePersonAgainstFilter(person as unknown as Record<string, unknown>, f.keywords, f.fields as readonly string[])
              )
            );
          }
          peopleData = p;
        }
      }

      if (filters.showOrganizations) {
        if (!hasActiveFilters) {
          const { data } = await supabase.from('organizations').select(ORG_SELECT).range(0, INITIAL_PAGE - 1);
          orgsData = (data || []) as Organization[];
          moreOrgs = orgsData.length === INITIAL_PAGE;
        } else {
          const { data } = await supabase.from('organizations').select(ORG_SELECT);
          let rawOrgs = (data || []) as Organization[];
          if (filters.availableForLectures) rawOrgs = [];
          orgsData = applyOrganizationMatchCriteria(rawOrgs, filters, effectiveMatchMode);
        }
      }

      if (loadIdRef.current !== loadId) return;
      setPeople(peopleData);
      setOrganizations(orgsData);
      setHasMorePeople(morePeople);
      setHasMoreOrgs(moreOrgs);
      setStats({ people: peopleData.length, organizations: orgsData.length, cities: 0 });
      setLoading(false);
    })();

    // Tier 2b: background full fetch for map cluster popovers
    (async () => {
      let allPeople: Person[] = [];
      let allOrgs: Organization[] = [];

      if (filters.showPeople) {
        let q = supabase.from('people').select(PEOPLE_SELECT);
        if (filters.availableForLectures) q = q.eq('available_for_lectures', true);
        const { data } = await q;
        allPeople = applyPeopleMatchCriteria((data || []) as Person[], filters, effectiveMatchMode);
        if (activeFilters.length > 0) {
          allPeople = allPeople.filter((person) =>
            activeFilters.every((f) =>
              scorePersonAgainstFilter(person as unknown as Record<string, unknown>, f.keywords, f.fields as readonly string[])
            )
          );
        }
      }

      if (filters.showOrganizations) {
        const { data } = await supabase.from('organizations').select(ORG_SELECT).limit(150);
        let rawOrgs = (data || []) as Organization[];
        if (filters.availableForLectures) rawOrgs = [];
        allOrgs = applyOrganizationMatchCriteria(rawOrgs, filters, effectiveMatchMode);
      }

      if (loadIdRef.current !== loadId) return;

      const builtClusters = buildNetworkClusters(allPeople, allOrgs, filters);
      setClusters(builtClusters);
      fullDataReadyRef.current = true;
      setFullDataReady(true);

      const uniqueCities = new Set(builtClusters.map((c) => c.city));
      setStats({ people: allPeople.length, organizations: allOrgs.length, cities: uniqueCities.size });

      const allEntities = [
        ...allPeople.map((person) => ({
          city: person.us_network_status === 'us_connected_abroad' ? person.person_us_connections?.[0]?.locations?.city : person.locations?.city,
          state: person.us_network_status === 'us_connected_abroad' ? person.person_us_connections?.[0]?.locations?.state : person.locations?.state,
        })),
        ...allOrgs.map((org) => ({
          city: org.organization_us_locations?.[0]?.locations?.city || org.locations?.city,
          state: org.organization_us_locations?.[0]?.locations?.state || org.locations?.state,
        })),
      ];

      const needsGeocoding = allEntities.filter((e) => e.city && e.state && !lookupCity(e.city, e.state));
      if (needsGeocoding.length === 0) return;

      const uniquePairs = new window.Map<string, { city: string; state: string }>();
      for (const e of needsGeocoding) {
        const key = `${e.city},${e.state}`;
        if (!uniquePairs.has(key)) uniquePairs.set(key, { city: e.city!, state: e.state! });
      }

      const geocoded = await geocodeBatch(Array.from(uniquePairs.values()));
      if (geocoded.size > 0 && loadIdRef.current === loadId) {
        for (const [key, coords] of geocoded) {
          const [city, state] = key.split(',');
          addToCache(city, state, coords.lat, coords.lng);
        }
        const updatedClusters = buildNetworkClusters(allPeople, allOrgs, filters);
        setClusters(updatedClusters);
        setStats((prev) => ({ ...prev, cities: new Set(updatedClusters.map((c) => c.city)).size }));
      }
    })();

    return () => { tier1Cancelled = true; };
  }, [activeFilters, activeQuery, effectiveMatchMode, filters]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!activeQuery) {
      clearSearchResults();
      setAiLoading(false);
      return;
    }

    runSearch(activeQuery, filters, effectiveMatchMode);
  }, [activeQuery, clearSearchResults, effectiveMatchMode, filters, runSearch]);

  useEffect(() => {
    const state = location.state as { focusSearch?: boolean } | null;
    if (state?.focusSearch) {
      setFocusTrigger((previous) => previous + 1);
    }
  }, [location.key, location.state]);

  const handleFiltersChange = useCallback(
    (next: MapFilters) => {
      updateRouteState((current) => ({
        ...current,
        filters: next,
      }));
    },
    [updateRouteState]
  );

  const handleMatchModeChange = useCallback(
    (nextMatchMode: SearchMatchMode) => {
      updateRouteState((current) => ({
        ...current,
        matchMode: nextMatchMode,
      }));
    },
    [updateRouteState]
  );

  const handleRemoveFilter = useCallback((filterId: string) => {
    setActiveFilters((previous) =>
      previous.filter((filter) => filter.id !== filterId)
    );
  }, []);

  const handleRemoveSearchQueryFilter = useCallback(() => {
    handleClearSearchQuery();
  }, [handleClearSearchQuery]);

  const handleViewModeChange = useCallback(
    (nextView: DashboardViewMode) => {
      updateRouteState((current) => ({
        ...current,
        view: nextView,
        focusedCity: nextView === 'map' ? null : current.focusedCity,
      }));
    },
    [updateRouteState]
  );

  const handleViewInDirectory = useCallback(
    (city: string, state: string) => {
      updateRouteState((current) => ({
        ...current,
        view: 'list',
        focusedCity: { city, state },
      }));
    },
    [updateRouteState]
  );

  const clearFocusedCity = useCallback(() => {
    updateRouteState((current) => ({
      ...current,
      focusedCity: null,
    }));
  }, [updateRouteState]);

  const isSearchActive = activeQuery.length > 0;

  const displayedPeople = focusedCity
    ? people.filter((person) => personMatchesLocation(person, focusedCity))
    : people;

  const displayedOrganizations = focusedCity
    ? organizations.filter((organization) =>
        organizationMatchesLocation(organization, focusedCity)
      )
    : organizations;

  return (
    <div className="flex h-[calc(100vh-64px)] overflow-hidden">
      <div className="flex-1 relative">
        <div className="absolute top-4 left-4 right-4 z-[2000] pointer-events-none flex items-start justify-between">
          <div className="bg-white/95 backdrop-blur-sm rounded-xl shadow-lg border border-gray-200 p-1 flex pointer-events-auto">
            <button
              onClick={() => handleViewModeChange('map')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                viewMode === 'map'
                  ? 'bg-yellow-400 text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
              }`}
            >
              <MapIcon className="w-4 h-4" />
              <span>Network Map</span>
            </button>
            <button
              onClick={() => handleViewModeChange('list')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                viewMode === 'list'
                  ? 'bg-yellow-400 text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
              }`}
            >
              <List className="w-4 h-4" />
              <span>Network List</span>
            </button>
          </div>

          <div className="flex-1 max-w-2xl mx-8 pointer-events-auto flex flex-col gap-2">
            <UnifiedSearchBar
              onSearch={handleSearch}
              isSearching={aiLoading}
              initialValue={activeQuery}
              focusTrigger={focusTrigger}
              className="flex-1 max-w-2xl"
            />

            {(isSearchActive ||
              filters.sector ||
              filters.occupation ||
              filters.personScope !== 'all' ||
              filters.city ||
              filters.state ||
              filters.flemishConnections.length > 0) && (
              <div className="flex flex-wrap gap-2 animate-in fade-in slide-in-from-top-1 duration-200">
                {activeMatchCriteriaCount > 1 && (
                  <div className="flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-600 shadow-sm">
                    <span className="px-1">Match criteria:</span>
                    {(['all', 'any'] as const).map((option) => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => handleMatchModeChange(option)}
                        className={`rounded-full px-2 py-0.5 transition-colors ${
                          effectiveMatchMode === option
                            ? 'bg-gray-900 text-white'
                            : 'text-gray-600 hover:bg-gray-100'
                        }`}
                      >
                        {option === 'all' ? 'All' : 'Any'}
                      </button>
                    ))}
                  </div>
                )}
                {activeQuery && (
                  <div className="flex items-center gap-1.5 px-2.5 py-1 bg-sky-50 text-sky-700 border border-sky-200 rounded-full text-xs font-medium shadow-sm">
                    <SearchIcon className="w-3 h-3" />
                    <span>Query: {activeQuery}</span>
                    <button
                      onClick={handleClearSearchQuery}
                      className="hover:text-sky-900 transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                )}
                {filters.sector && (
                  <div className="flex items-center gap-1.5 px-2.5 py-1 bg-yellow-50 text-yellow-700 border border-yellow-200 rounded-full text-xs font-medium shadow-sm">
                    <span>Sector: {filters.sector}</span>
                    <button
                      onClick={() =>
                        handleFiltersChange({ ...filters, sector: '' })
                      }
                      className="hover:text-yellow-900 transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                )}
                {filters.occupation && (
                  <div className="flex items-center gap-1.5 px-2.5 py-1 bg-purple-50 text-purple-700 border border-purple-200 rounded-full text-xs font-medium shadow-sm">
                    <span>Type: {filters.occupation}</span>
                    <button
                      onClick={() =>
                        handleFiltersChange({ ...filters, occupation: '' })
                      }
                      className="hover:text-purple-900 transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                )}
                {filters.personScope !== 'all' && (
                  <div className="flex items-center gap-1.5 px-2.5 py-1 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-full text-xs font-medium shadow-sm">
                    <span>
                      People:{' '}
                      {filters.personScope === 'us_based'
                        ? 'US-based'
                        : 'US-connected abroad'}
                    </span>
                    <button
                      onClick={() =>
                        handleFiltersChange({ ...filters, personScope: 'all' })
                      }
                      className="hover:text-indigo-900 transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                )}
                {(filters.city || filters.state) && (
                  <div className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full text-xs font-medium shadow-sm">
                    <MapPin className="w-3 h-3" />
                    <span>
                      Location:{' '}
                      {[filters.city, filters.state].filter(Boolean).join(', ')}
                    </span>
                    <button
                      onClick={() =>
                        handleFiltersChange({ ...filters, city: '', state: '' })
                      }
                      className="hover:text-emerald-900 transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                )}
                {filters.flemishConnections.map((connection) => (
                  <div
                    key={connection}
                    className="flex items-center gap-1.5 px-2.5 py-1 bg-orange-50 text-orange-700 border border-orange-200 rounded-full text-xs font-medium shadow-sm"
                  >
                    <span>Link: {connection}</span>
                    <button
                      onClick={() =>
                        handleFiltersChange({
                          ...filters,
                          flemishConnections: filters.flemishConnections.filter(
                            (item) => item !== connection
                          ),
                        })
                      }
                      className="hover:text-orange-900 transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="w-20" />
        </div>

        {viewMode === 'map' ? (
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center bg-gray-100">
                <div className="h-10 w-10 animate-spin rounded-full border-b-2 border-teal-600" />
              </div>
            }
          >
            <MapVisualization
              clusters={clusters}
              loading={loading}
              fullDataReady={fullDataReady}
              focusedCity={focusedCity}
              onViewInDirectory={handleViewInDirectory}
              onNavigate={onNavigate}
              totalPeople={people.length}
              totalOrganizations={organizations.length}
            />
          </Suspense>
        ) : (
          <div className="h-full overflow-y-auto bg-gray-50">
            <div className="max-w-6xl mx-auto px-6 pt-24 pb-8">
              {isSearchActive ? (
                <DirectoryGrid
                  nameMatches={nameMatches}
                  aiResults={aiResults}
                  organizations={displayedOrganizations}
                  loading={loading}
                  aiLoading={aiLoading}
                  onNavigate={onNavigate}
                  searchQuery={activeQuery}
                  focusedCity={focusedCity}
                  onClearFocus={clearFocusedCity}
                  onClearSearch={handleClearSearchQuery}
                  snippets={snippets}
                  searchError={searchError}
                />
              ) : (
                <DirectoryGrid
                  nameMatches={[]}
                  aiResults={[]}
                  organizations={displayedOrganizations}
                  loading={loading}
                  aiLoading={false}
                  onNavigate={onNavigate}
                  focusedCity={focusedCity}
                  onClearFocus={clearFocusedCity}
                  allPeople={displayedPeople}
                  searchError={searchError}
                  hasMorePeople={hasMorePeople && !focusedCity}
                  hasMoreOrgs={hasMoreOrgs && !focusedCity}
                  loadingMore={loadingMore}
                  onLoadMorePeople={handleLoadMorePeople}
                  onLoadMoreOrgs={handleLoadMoreOrgs}
                />
              )}
            </div>
          </div>
        )}
      </div>

      <FilterPanel
        filters={filters}
        onFiltersChange={handleFiltersChange}
        showPanel={showFilters}
        onTogglePanel={() => setShowFilters(!showFilters)}
        stats={stats}
        activeAiFilters={activeFilters}
        onRemoveAiFilter={handleRemoveFilter}
        activeSearchQuery={activeQuery}
        onRemoveSearchQuery={handleRemoveSearchQueryFilter}
        flemishOptions={flemishOptions}
      />
    </div>
  );
}
