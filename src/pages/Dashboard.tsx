import { Suspense, lazy, useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { Map as MapIcon, List, X, Search as SearchIcon, MapPin } from 'lucide-react';
import {
  supabase,
  fuzzyMatch,
  type Person,
  type Organization,
  type MapCluster,
  type MapFilters,
  type FilterPreset,
  type ActiveAiFilter,
  type FlemishConnection,
  OCCUPATION_CATEGORY_KEYWORDS,
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
  hybridSearch,
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
  buildNetworkClusters,
  organizationMatchesLocation,
  personMatchesLocation,
} from '../lib/networkScope';

const MapVisualization = lazy(() => import('../components/MapVisualization'));

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
  const { view: viewMode, query: activeQuery, filters, focusedCity } = routeState;

  const [people, setPeople] = useState<Person[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [clusters, setClusters] = useState<MapCluster[]>([]);
  const [flemishOptions, setFlemishOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
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
  const searchRequestIdRef = useRef(0);

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
    async (query: string) => {
      const requestId = ++searchRequestIdRef.current;
      const cached = getCachedDashboardSearch(query);

      if (cached) {
        setNameMatches(cached.nameMatches);
        setAiResults(cached.aiResults);
        setSnippets(new Map(cached.snippets));
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
                  '*, locations(*), person_us_connections(*, locations(*)), person_flemish_connections(flemish_connection_id, flemish_connections(id, name, type))'
                )
                .or(
                  `name.ilike.%${query}%,first_name.ilike.%${query}%,last_name.ilike.%${query}%,name.ilike.%${mainTerm}%`
                )
                .limit(20);
              return (data as Person[]) || [];
            })()
          : Promise.resolve([]);

        const hybridPromise = hybridSearch(query);
        const [nameResults, hybridResult] = await Promise.all([
          nameMatchPromise,
          hybridPromise,
        ]);

        if (requestId !== searchRequestIdRef.current) return;

        const nameResultIds = new Set(nameResults.map((person) => person.id));
        const fusedResults = hybridResult.results.filter(
          (result) => !nameResultIds.has(result.id)
        );
        const aiPeople = fusedResults.map(
          (result: HybridSearchResultItem) => result as unknown as Person
        );
        const nextSnippets = new Map<string, string>();

        for (const result of fusedResults) {
          if (result.snippet) nextSnippets.set(result.id, result.snippet);
        }

        setNameMatches(nameResults);
        setAiResults(aiPeople);
        setSnippets(nextSnippets);

        setCachedDashboardSearch({
          query,
          nameMatches: nameResults,
          aiResults: aiPeople,
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

  const loadData = useCallback(
    async (currentFilters: MapFilters, currentQuery: string, aiFilters: ActiveAiFilter[]) => {
      const thisId = ++loadIdRef.current;
      setLoading(true);
      await ensureLocationsLoaded();

      let peopleData: Person[] = [];
      let orgsData: Organization[] = [];

      if (currentFilters.showPeople) {
        let query = supabase
          .from('people')
          .select(
            '*, locations(*), person_us_connections(*, locations(*)), person_flemish_connections(flemish_connection_id, flemish_connections(id, name, type))'
          );

        if (currentFilters.personScope !== 'all') {
          query = query.eq('us_network_status', currentFilters.personScope);
        }

        if (currentFilters.sector) {
          const { data: sectorRows } = await supabase
            .from('sectors')
            .select('id')
            .eq('name', currentFilters.sector)
            .maybeSingle();

          if (sectorRows) {
            const { data: personIds } = await supabase
              .from('person_sectors')
              .select('person_id')
              .eq('sector_id', sectorRows.id);
            const ids = personIds?.map((row) => row.person_id) || [];
            query =
              ids.length > 0
                ? query.in('id', ids)
                : query.eq('id', '00000000-0000-0000-0000-000000000000');
          } else {
            query = query.eq('id', '00000000-0000-0000-0000-000000000000');
          }
        }

        if (currentFilters.occupation) {
          const categoryKeywords =
            OCCUPATION_CATEGORY_KEYWORDS[currentFilters.occupation];
          if (categoryKeywords && categoryKeywords.length > 0) {
            query = query.or(
              categoryKeywords
                .map((keyword) => `occupation.ilike.%${keyword}%`)
                .join(',')
            );
          }
        }

        if (currentFilters.flemishConnections.length > 0) {
          const { data: matchingConnections } = await supabase
            .from('flemish_connections')
            .select('id, name')
            .in('name', currentFilters.flemishConnections);

          const connectionIds = (matchingConnections || []).map(
            (connection: { id: string }) => connection.id
          );

          if (connectionIds.length > 0) {
            const { data: matchedPeople } = await supabase
              .from('person_flemish_connections')
              .select('person_id')
              .in('flemish_connection_id', connectionIds);

            const personIds = Array.from(
              new Set(
                (matchedPeople || []).map(
                  (row: { person_id: string }) => row.person_id
                )
              )
            );

            query =
              personIds.length > 0
                ? query.in('id', personIds)
                : query.eq('id', '00000000-0000-0000-0000-000000000000');
          } else {
            query = query.eq('id', '00000000-0000-0000-0000-000000000000');
          }
        }

        if (currentFilters.availableForLectures) {
          query = query.eq('available_for_lectures', true);
        }

        const { data } = await query;
        peopleData = (data || []).filter((person) =>
          personMatchesLocation(person, currentFilters)
        );
      }

      if (currentFilters.showOrganizations) {
        const { data } = await supabase
          .from('organizations')
          .select('*, locations(*), organization_us_locations(*, locations(*))');
        let rawOrganizations = (data || []) as Organization[];

        if (currentQuery) {
          const normalizedQuery = currentQuery.toLowerCase();
          rawOrganizations = rawOrganizations.filter(
            (organization) =>
              organization.name.toLowerCase().includes(normalizedQuery) ||
              (organization.description &&
                organization.description.toLowerCase().includes(normalizedQuery)) ||
              (organization.type &&
                organization.type.toLowerCase().includes(normalizedQuery))
          );
        }

        if (currentFilters.sector) {
          rawOrganizations = rawOrganizations.filter(
            (organization) =>
              fuzzyMatch(currentFilters.sector, organization.type || '') ||
              fuzzyMatch(currentFilters.sector, organization.description || '')
          );
        }

        if (currentFilters.occupation) {
          rawOrganizations = rawOrganizations.filter(
            (organization) =>
              fuzzyMatch(currentFilters.occupation, organization.type || '') ||
              fuzzyMatch(currentFilters.occupation, organization.description || '')
          );
        }

        if (currentFilters.flemishConnections.length > 0) {
          rawOrganizations = rawOrganizations.filter((organization) =>
            currentFilters.flemishConnections.some(
              (connection) =>
                fuzzyMatch(connection, organization.flemish_link || '') ||
                fuzzyMatch(connection, organization.name || '') ||
                fuzzyMatch(connection, organization.description || '')
            )
          );
        }

        if (currentFilters.availableForLectures) {
          rawOrganizations = [];
        }

        orgsData = rawOrganizations.filter((organization) =>
          organizationMatchesLocation(organization, currentFilters)
        );
      }

      if (thisId !== loadIdRef.current) return;

      if (aiFilters.length > 0) {
        peopleData = peopleData.filter((person) =>
          aiFilters.every((filter) =>
            scorePersonAgainstFilter(
              person as unknown as Record<string, unknown>,
              filter.keywords,
              filter.fields as readonly string[]
            )
          )
        );
      }

      setPeople(peopleData);
      setOrganizations(orgsData);

      const builtClusters = buildNetworkClusters(peopleData, orgsData, currentFilters);
      setClusters(builtClusters);

      const uniqueCities = new Set(builtClusters.map((cluster) => cluster.city));
      setStats({
        people: peopleData.length,
        organizations: orgsData.length,
        cities: uniqueCities.size,
      });

      setLoading(false);

      const allEntities = [
        ...peopleData.map((person) => ({
          city:
            person.us_network_status === 'us_connected_abroad'
              ? person.person_us_connections?.[0]?.locations?.city
              : person.locations?.city,
          state:
            person.us_network_status === 'us_connected_abroad'
              ? person.person_us_connections?.[0]?.locations?.state
              : person.locations?.state,
        })),
        ...orgsData.map((organization) => ({
          city:
            organization.organization_us_locations?.[0]?.locations?.city ||
            organization.locations?.city,
          state:
            organization.organization_us_locations?.[0]?.locations?.state ||
            organization.locations?.state,
        })),
      ];

      const needsGeocoding = allEntities.filter((entity) => {
        if (!entity.city || !entity.state) return false;
        return !lookupCity(entity.city, entity.state);
      });

      if (needsGeocoding.length === 0) return;

      const uniquePairs = new window.Map<string, { city: string; state: string }>();
      for (const entity of needsGeocoding) {
        const key = `${entity.city},${entity.state}`;
        if (!uniquePairs.has(key)) {
          uniquePairs.set(key, {
            city: entity.city!,
            state: entity.state!,
          });
        }
      }

      const geocoded = await geocodeBatch(Array.from(uniquePairs.values()));

      if (geocoded.size > 0 && thisId === loadIdRef.current) {
        for (const [key, coords] of geocoded) {
          const [city, state] = key.split(',');
          addToCache(city, state, coords.lat, coords.lng);
        }

        const updatedClusters = buildNetworkClusters(peopleData, orgsData, currentFilters);
        setClusters(updatedClusters);
        setStats((previous) => ({
          ...previous,
          cities: new Set(updatedClusters.map((cluster) => cluster.city)).size,
        }));
      }
    },
    []
  );

  useEffect(() => {
    setLastDashboardLocation(`${location.pathname}${location.search}`);
  }, [location.pathname, location.search]);

  useEffect(() => {
    supabase
      .from('flemish_connections')
      .select('name')
      .order('name')
      .then(({ data }) => {
        const names = ((data || []) as Pick<FlemishConnection, 'name'>[]).map(
          (connection) => connection.name
        );
        setFlemishOptions(names);
      });
  }, []);

  useEffect(() => {
    loadData(filters, activeQuery, activeFilters);
  }, [activeFilters, activeQuery, filters, loadData]);

  useEffect(() => {
    if (!activeQuery) {
      clearSearchResults();
      setAiLoading(false);
      return;
    }

    runSearch(activeQuery);
  }, [activeQuery, clearSearchResults, runSearch]);

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
