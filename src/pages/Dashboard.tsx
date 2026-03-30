import { useEffect, useState, useCallback, useRef } from 'react';
import { Map as MapIcon, List, X, Search as SearchIcon } from 'lucide-react';
import {
  supabase,
  fuzzyMatch,
  type Person,
  type Organization,
  type MapCluster,
  type MapFilters,
  type FilterPreset,
  type SearchCommand,
  type ActiveAiFilter,
  DEFAULT_MAP_FILTERS,
  OCCUPATION_CATEGORY_KEYWORDS,
} from '../lib/supabase';
import MapVisualization from '../components/MapVisualization';
import DirectoryGrid from '../components/DirectoryGrid';
import FilterPanel from '../components/FilterPanel';
import UnifiedSearchBar from '../components/UnifiedSearchBar';
import { lookupCity, ensureLocationsLoaded, addToCache } from '../lib/locations';
import { geocodeBatch } from '../lib/geocoding';
import { parseFiltersFromQuery } from '../lib/filterParser';
import {
  scorePersonAgainstFilter,
  hybridSearch,
  type HybridSearchResultItem,
} from '../lib/aiService';

interface DashboardProps {
  onNavigate: (page: string, id?: string, preset?: FilterPreset) => void;
  filterPreset: FilterPreset | null;
  onConsumePreset: () => void;
  searchCommand: SearchCommand | null;
  onConsumeSearchCommand: () => void;
  onSearchingChange: (searching: boolean) => void;
  onClearSearchInput: () => void;
}

type ViewMode = 'map' | 'list';

// Snippets are now generated server-side by the search-people edge function.
// This helper converts HybridSearchResultItem[] to Person-like objects for display.

function buildClusters(
  people: Person[],
  organizations: Organization[],
  filters: MapFilters
): MapCluster[] {
  const clusterMap = new window.Map<string, MapCluster>();

  if (filters.showPeople) {
    for (const person of people) {
      if (!person.locations?.city || !person.locations?.state) continue;
      
      // Try the global geocoding cache first - this is our "source of truth" for city positions
      const coords = lookupCity(person.locations?.city, person.locations?.state);
      
      let lat = coords?.lat;
      let lng = coords?.lng;
      
      // Only fall back to person's record if we have no cached city coordinates
      if (lat == null || lng == null) {
        lat = person.locations?.latitude;
        lng = person.locations?.longitude;
      }

      if (lat == null || lng == null) continue;

      const key = `${person.locations?.city}|${person.locations?.state}`;
      if (!clusterMap.has(key)) {
        clusterMap.set(key, {
          city: person.locations?.city,
          state: person.locations?.state,
          lat: Number(lat),
          lng: Number(lng),
          people: [],
          organizations: [],
        });
      }
      clusterMap.get(key)!.people.push(person);
    }
  }

  if (filters.showOrganizations) {
    for (const org of organizations) {
      if (!org.locations?.city || !org.locations?.state) continue;
      
      const coords = lookupCity(org.locations?.city, org.locations?.state);
      
      let lat = coords?.lat;
      let lng = coords?.lng;
      
      if (lat == null || lng == null) {
        lat = org.locations?.latitude;
        lng = org.locations?.longitude;
      }

      if (lat == null || lng == null) continue;

      const key = `${org.locations?.city}|${org.locations?.state}`;
      if (!clusterMap.has(key)) {
        clusterMap.set(key, {
          city: org.locations?.city,
          state: org.locations?.state,
          lat: Number(lat),
          lng: Number(lng),
          people: [],
          organizations: [],
        });
      }
      clusterMap.get(key)!.organizations.push(org);
    }
  }

  return Array.from(clusterMap.values());
}

export default function Dashboard({
  onNavigate,
  filterPreset,
  onConsumePreset,
  searchCommand,
  onConsumeSearchCommand,
  onSearchingChange,
  onClearSearchInput,
}: DashboardProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('map');
  const [filters, setFilters] = useState<MapFilters>({ ...DEFAULT_MAP_FILTERS });
  const [people, setPeople] = useState<Person[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [clusters, setClusters] = useState<MapCluster[]>([]);
  const [loading, setLoading] = useState(true);
  const [showFilters, setShowFilters] = useState(true);
  const [stats, setStats] = useState({ people: 0, organizations: 0, cities: 0 });
  const [focusedCity, setFocusedCity] = useState<{ city: string; state: string } | null>(null);

  const [nameMatches, setNameMatches] = useState<Person[]>([]);
  const [aiResults, setAiResults] = useState<Person[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [activeQuery, setActiveQuery] = useState('');

  const [snippets, setSnippets] = useState<Map<string, string>>(new Map());
  const [focusTrigger, setFocusTrigger] = useState(0);

  const [activeFilters, setActiveFilters] = useState<ActiveAiFilter[]>([]);

  const loadIdRef = useRef(0);
  const lastSearchTimestamp = useRef(0);

  const handleClearSearchQuery = useCallback(() => {
    setActiveQuery('');
    setNameMatches([]);
    setAiResults([]);
    setSnippets(new Map());
    onClearSearchInput();
  }, [onClearSearchInput]);

  const handleSearch = useCallback(async (query: string) => {
    if (!query) {
      handleClearSearchQuery();
      return;
    }

    // Direct navigation if from autocomplete
    if (query.startsWith('id:')) {
      const [, id, type] = query.split(':');
      onNavigate(type, id);
      return;
    }

    setActiveQuery(query);
    setViewMode('list');
    setNameMatches([]);
    setAiResults([]);
    setSnippets(new Map());

    const words = query.trim().split(/\s+/);
    const isDirectSearch = words.length <= 4;

    setAiLoading(true);
    onSearchingChange(true);

    try {
      // Run name matching and hybrid search in parallel
      const nameMatchPromise = isDirectSearch
        ? (async () => {
            const searchTerms = query.toLowerCase().replace(/^dr\.?\s+/, '').split(' ');
            const mainTerm = searchTerms[searchTerms.length - 1];
            const { data } = await supabase
              .from('people').select('*, locations(*)')
              .or(`name.ilike.%${query}%,first_name.ilike.%${query}%,last_name.ilike.%${query}%,name.ilike.%${mainTerm}%`)
              .limit(20);
            return (data as Person[]) || [];
          })()
        : Promise.resolve([]);

      const hybridPromise = hybridSearch(query);

      const [nameResults, hybridResult] = await Promise.all([nameMatchPromise, hybridPromise]);

      setNameMatches(nameResults);

      // Apply deterministic filters from query
      const parsed = parseFiltersFromQuery(query, filters);
      setFilters(parsed.filters);

      // Convert hybrid results to Person-like objects for display
      const aiPeople = hybridResult.results.map((r: HybridSearchResultItem) => ({
        ...r,
        // Ensure the shape matches what PersonCard expects
      } as unknown as Person));

      setAiResults(aiPeople);

      // Set snippets from server-side results
      const newSnippets = new Map<string, string>();
      for (const r of hybridResult.results) {
        if (r.snippet) newSnippets.set(r.id, r.snippet);
      }
      setSnippets(newSnippets);
    } catch {
      // search failed
    } finally {
      setAiLoading(false);
      onSearchingChange(false);
    }
  }, [filters, onSearchingChange, handleClearSearchQuery]);

  const loadData = useCallback(
    async (currentFilters: MapFilters, activeAiFilters: ActiveAiFilter[]) => {
      const thisId = ++loadIdRef.current;
      setLoading(true);
      setFocusedCity(null);
      await ensureLocationsLoaded();

      let peopleData: Person[] = [];
      let orgsData: Organization[] = [];

      if (currentFilters.showPeople) {
        let q = supabase.from('people').select('*, locations(*)');

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
            const ids = personIds?.map((r) => r.person_id) || [];
            if (ids.length > 0) {
              q = q.in('id', ids);
            } else {
              q = q.eq('id', '00000000-0000-0000-0000-000000000000');
            }
          } else {
            q = q.eq('id', '00000000-0000-0000-0000-000000000000');
          }
        }

        if (currentFilters.occupation) {
          const catKeywords = OCCUPATION_CATEGORY_KEYWORDS[currentFilters.occupation];
          if (catKeywords && catKeywords.length > 0) {
            q = q.or(catKeywords.map((kw) => `occupation.ilike.%${kw}%`).join(','));
          }
        }

        if (currentFilters.flemishConnections.length > 0) {
          const orFilter = currentFilters.flemishConnections
            .map((fc) => `flemish_connection.ilike.%${fc}%`)
            .join(',');
          q = q.or(orFilter);
        }

        if (currentFilters.availableForLectures) {
          q = q.eq('available_for_lectures', true);
        }

        const { data } = await q;
        peopleData = data || [];

        if (currentFilters.flemishConnections.length > 0 && peopleData.length === 0) {
          const { data: allPeople } = await supabase.from('people').select('*, locations(*)');
          if (allPeople) {
            peopleData = (allPeople as Person[]).filter((p) =>
              currentFilters.flemishConnections.some((fc) =>
                fuzzyMatch(fc, p.flemish_connection || '')
              )
            );
          }
        }
      }

      if (currentFilters.showOrganizations) {
        const { data } = await supabase.from('organizations').select('*, locations(*)');
        let rawOrgs = (data || []) as Organization[];

        // Apply text search if query exists
        if (activeQuery) {
          const q = activeQuery.toLowerCase();
          rawOrgs = rawOrgs.filter(o => 
            o.name.toLowerCase().includes(q) || 
            (o.description && o.description.toLowerCase().includes(q)) ||
            (o.type && o.type.toLowerCase().includes(q))
          );
        }

        if (currentFilters.sector) {
          rawOrgs = rawOrgs.filter(
            (o) =>
              fuzzyMatch(currentFilters.sector, o.type || '') ||
              fuzzyMatch(currentFilters.sector, o.description || '')
          );
        }

        if (currentFilters.occupation) {
          rawOrgs = rawOrgs.filter(
            (o) =>
              fuzzyMatch(currentFilters.occupation, o.type || '') ||
              fuzzyMatch(currentFilters.occupation, o.description || '')
          );
        }

        if (currentFilters.flemishConnections.length > 0) {
          rawOrgs = rawOrgs.filter((o) =>
            currentFilters.flemishConnections.some(
              (fc) =>
                fuzzyMatch(fc, o.flemish_link || '') ||
                fuzzyMatch(fc, o.name || '') ||
                fuzzyMatch(fc, o.description || '')
            )
          );
        }

        if (currentFilters.availableForLectures) {
          rawOrgs = [];
        }

        orgsData = rawOrgs;
      }

      if (thisId !== loadIdRef.current) return;

      if (activeAiFilters.length > 0) {
        peopleData = peopleData.filter((p) =>
          activeAiFilters.every((af) =>
            scorePersonAgainstFilter(
              p as unknown as Record<string, unknown>,
              af.keywords,
              af.fields as readonly string[]
            )
          )
        );
      }

      setPeople(peopleData);
      setOrganizations(orgsData);

      const builtClusters = buildClusters(peopleData, orgsData, currentFilters);
      setClusters(builtClusters);

      const uniqueCities = new Set(builtClusters.map((c) => c.city));
      setStats({
        people: peopleData.length,
        organizations: orgsData.length,
        cities: uniqueCities.size,
      });

      setLoading(false);

      const allEntities = [
        ...peopleData.map((p) => ({
          id: p.id,
          table: 'people' as const,
          city: p.locations?.city,
          state: p.locations?.state,
          lat: p.locations?.latitude,
          lng: p.locations?.longitude,
        })),
        ...orgsData.map((o) => ({
          id: o.id,
          table: 'organizations' as const,
          city: o.locations?.city,
          state: o.locations?.state,
          lat: o.locations?.latitude,
          lng: o.locations?.longitude,
        })),
      ];

      const needsGeocoding = allEntities.filter((e) => {
        if (!e.city || !e.state) return false;
        // If we have a cached location for this city, we're good.
        // If not, we NEED to geocode it, even if the entity has coordinates (they might be stale).
        return !lookupCity(e.city, e.state);
      });

      if (needsGeocoding.length > 0) {
        const uniquePairs = new window.Map<string, { city: string; state: string }>();
        for (const e of needsGeocoding) {
          const key = `${e.city},${e.state}`;
          if (!uniquePairs.has(key)) uniquePairs.set(key, { city: e.city!, state: e.state! });
        }

        const geocoded = await geocodeBatch(Array.from(uniquePairs.values()));

        if (geocoded.size > 0 && thisId === loadIdRef.current) {
          for (const [key, coords] of geocoded) {
            const [c, s] = key.split(',');
            addToCache(c, s, coords.lat, coords.lng);
            
            // Proactively save to DB so other users benefit
            supabase.from('locations').upsert({
              city: c,
              state: s,
              latitude: coords.lat,
              longitude: coords.lng
            }).then();
          }

          // Force rebuild with new coordinates
          const updatedClusters = buildClusters(peopleData, orgsData, currentFilters);
          setClusters(updatedClusters);
          setStats((prev) => ({
            ...prev,
            cities: new Set(updatedClusters.map((c) => c.city)).size,
          }));
        }
      }
    },
    []
  );

  useEffect(() => {
    loadData(filters, activeFilters);
  }, [filters, activeFilters, loadData]);

  useEffect(() => {
    if (!filterPreset) return;
    const newFilters = { ...DEFAULT_MAP_FILTERS };
    if (filterPreset.sector) newFilters.sector = filterPreset.sector;
    if (filterPreset.occupation) newFilters.occupation = filterPreset.occupation;
    if (filterPreset.flemishConnections) newFilters.flemishConnections = filterPreset.flemishConnections;

    setActiveQuery('');
    setNameMatches([]);
    setAiResults([]);

    setSnippets(new Map());
    setActiveFilters([]);

    setFilters(newFilters);

    if (filterPreset.focusCity) {
      setTimeout(() => {
        setFocusedCity(filterPreset.focusCity!);
        setViewMode('map');
      }, 100);
    }

    onConsumePreset();
  }, [filterPreset, onConsumePreset]);

  useEffect(() => {
    if (!searchCommand || searchCommand.timestamp <= lastSearchTimestamp.current) return;
    lastSearchTimestamp.current = searchCommand.timestamp;
    onConsumeSearchCommand();
    handleSearch(searchCommand.query);
    setFocusTrigger((prev) => prev + 1);
  }, [searchCommand, onConsumeSearchCommand, handleSearch]);

  const handleFiltersChange = useCallback((next: MapFilters) => {
    setFilters(next);
  }, []);

  const handleRemoveFilter = useCallback((filterId: string) => {
    setActiveFilters((prev) => prev.filter((f) => f.id !== filterId));
  }, []);

  const handleRemoveSearchQueryFilter = useCallback(() => {
    handleClearSearchQuery();
  }, [handleClearSearchQuery]);

  const handleViewInDirectory = (city: string, state: string) => {
    setFocusedCity({ city, state });
    setViewMode('list');
  };

  const isSearchActive = activeQuery.length > 0;

  const displayedPeople = focusedCity
    ? people.filter(
        (p) =>
          p.locations?.city === focusedCity.city &&
          p.locations?.state === focusedCity.state
      )
    : people;

  const displayedOrgs = focusedCity
    ? organizations.filter(
        (o) =>
          o.locations?.city === focusedCity.city &&
          o.locations?.state === focusedCity.state
      )
    : organizations;

  return (
    <div className="flex h-[calc(100vh-64px)] overflow-hidden">
      <div className="flex-1 relative">
        <div className="absolute top-4 left-4 right-4 z-[2000] pointer-events-none flex items-start justify-between">
          <div className="bg-white/95 backdrop-blur-sm rounded-xl shadow-lg border border-gray-200 p-1 flex pointer-events-auto">
            <button
              onClick={() => {
                setViewMode('map');
                setFocusedCity(null);
              }}
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
              onClick={() => setViewMode('list')}
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

            
            {/* Search Context Chips */}
            {(isSearchActive || filters.sector || filters.occupation || filters.flemishConnections.length > 0) && (
              <div className="flex flex-wrap gap-2 animate-in fade-in slide-in-from-top-1 duration-200">
                {activeQuery && (
                  <div className="flex items-center gap-1.5 px-2.5 py-1 bg-sky-50 text-sky-700 border border-sky-200 rounded-full text-xs font-medium shadow-sm">
                    <SearchIcon className="w-3 h-3" />
                    <span>Query: {activeQuery}</span>
                    <button onClick={handleClearSearchQuery} className="hover:text-sky-900 transition-colors">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                )}
                {filters.sector && (
                  <div className="flex items-center gap-1.5 px-2.5 py-1 bg-yellow-50 text-yellow-700 border border-yellow-200 rounded-full text-xs font-medium shadow-sm">
                    <span>Sector: {filters.sector}</span>
                    <button 
                      onClick={() => setFilters({ ...filters, sector: '' })} 
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
                      onClick={() => setFilters({ ...filters, occupation: '' })} 
                      className="hover:text-purple-900 transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                )}
                {filters.flemishConnections.map(fc => (
                  <div key={fc} className="flex items-center gap-1.5 px-2.5 py-1 bg-orange-50 text-orange-700 border border-orange-200 rounded-full text-xs font-medium shadow-sm">
                    <span>Link: {fc}</span>
                    <button 
                      onClick={() => setFilters({ 
                        ...filters, 
                        flemishConnections: filters.flemishConnections.filter(c => c !== fc) 
                      })} 
                      className="hover:text-orange-900 transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="w-20" /> {/* Spacer to balance Map/List toggle */}
        </div>

        {viewMode === 'map' ? (
          <MapVisualization
            clusters={clusters}
            loading={loading}
            focusedCity={focusedCity}
            onViewInDirectory={handleViewInDirectory}
            onNavigate={onNavigate}
          />
        ) : (
          <div className="h-full overflow-y-auto bg-gray-50">
            <div className="max-w-6xl mx-auto px-6 pt-24 pb-8">
              {isSearchActive ? (
                <DirectoryGrid
                  nameMatches={nameMatches}
                  aiResults={aiResults}
                  organizations={displayedOrgs}
                  loading={loading}
                  aiLoading={aiLoading}
                  onNavigate={onNavigate}
                  searchQuery={activeQuery}
                  focusedCity={focusedCity}
                  onClearFocus={() => setFocusedCity(null)}
                  onClearSearch={handleClearSearchQuery}
                  snippets={snippets}
                />
              ) : (
                <DirectoryGrid
                  nameMatches={[]}
                  aiResults={[]}
                  organizations={displayedOrgs}
                  loading={loading}
                  aiLoading={false}
                  onNavigate={onNavigate}
                  focusedCity={focusedCity}
                  onClearFocus={() => setFocusedCity(null)}
                  allPeople={displayedPeople}
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
      />
    </div>
  );
}
