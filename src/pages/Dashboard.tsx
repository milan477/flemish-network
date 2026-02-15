import { useEffect, useState, useCallback, useRef } from 'react';
import { Map as MapIcon, List } from 'lucide-react';
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
  type SavedFlemishFilter,
  DEFAULT_MAP_FILTERS,
  OCCUPATION_CATEGORY_KEYWORDS,
  PREDEFINED_FILTER_FIELDS,
} from '../lib/supabase';
import MapVisualization from '../components/MapVisualization';
import DirectoryGrid from '../components/DirectoryGrid';
import FilterPanel from '../components/FilterPanel';
import { lookupCity, ensureLocationsLoaded, addToCache } from '../lib/locations';
import { geocodeBatch } from '../lib/geocoding';
import {
  smartSearch,
  scorePersonAgainstKeywords,
  scorePersonAgainstFilter,
  AI_SCORE_THRESHOLD,
  type SmartSearchKeywords,
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

function generateSnippet(
  person: Person,
  keywords: SmartSearchKeywords
): string {
  if (person.bio && keywords.bio.length > 0) {
    const sentences = person.bio.split(/[.!?]+/).filter((s) => s.trim());
    for (const sentence of sentences) {
      const lower = sentence.toLowerCase();
      if (keywords.bio.some((kw) => lower.includes(kw))) {
        return sentence.trim();
      }
    }
  }

  if (person.current_position && keywords.current_position.length > 0) {
    const lower = person.current_position.toLowerCase();
    if (keywords.current_position.some((kw) => lower.includes(kw))) {
      return person.current_position;
    }
  }

  if (person.bio) {
    const sentences = person.bio.split(/[.!?]+/).filter((s) => s.trim());
    const allKw = [
      ...keywords.name,
      ...keywords.occupation,
      ...keywords.current_position,
      ...keywords.flemish_connection,
      ...keywords.bio,
    ];
    for (const sentence of sentences) {
      const lower = sentence.toLowerCase();
      if (allKw.some((kw) => lower.includes(kw))) {
        return sentence.trim();
      }
    }
    if (sentences[0]) return sentences[0].trim();
  }

  return '';
}

function resolveCoords(
  city: string,
  state: string,
  lat?: number | null,
  lng?: number | null
): { lat: number; lng: number } | null {
  if (lat != null && lng != null) return { lat: Number(lat), lng: Number(lng) };
  return lookupCity(city, state);
}

function buildClusters(
  people: Person[],
  organizations: Organization[],
  filters: MapFilters
): MapCluster[] {
  const clusterMap = new window.Map<string, MapCluster>();

  if (filters.showPeople) {
    for (const person of people) {
      if (!person.location_city || !person.location_state) continue;
      const coords = resolveCoords(person.location_city, person.location_state, person.latitude, person.longitude);
      if (!coords) continue;
      const key = `${person.location_city}|${person.location_state}`;
      if (!clusterMap.has(key)) {
        clusterMap.set(key, {
          city: person.location_city,
          state: person.location_state,
          lat: coords.lat,
          lng: coords.lng,
          people: [],
          organizations: [],
        });
      }
      clusterMap.get(key)!.people.push(person);
    }
  }

  if (filters.showOrganizations) {
    for (const org of organizations) {
      if (!org.location_city || !org.location_state) continue;
      const coords = resolveCoords(org.location_city, org.location_state, org.latitude, org.longitude);
      if (!coords) continue;
      const key = `${org.location_city}|${org.location_state}`;
      if (!clusterMap.has(key)) {
        clusterMap.set(key, {
          city: org.location_city,
          state: org.location_state,
          lat: coords.lat,
          lng: coords.lng,
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
  const [aiKeywords, setAiKeywords] = useState<SmartSearchKeywords | null>(null);
  const [snippets, setSnippets] = useState<Map<string, string>>(new Map());

  const [activeFilters, setActiveFilters] = useState<ActiveAiFilter[]>([]);
  const [popularFilters, setPopularFilters] = useState<SavedFlemishFilter[]>([]);

  const loadIdRef = useRef(0);
  const lastSearchTimestamp = useRef(0);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('saved_flemish_filters')
        .select('*')
        .gte('usage_count', 1)
        .order('usage_count', { ascending: false })
        .limit(20);
      if (data) setPopularFilters(data as SavedFlemishFilter[]);
    })();
  }, []);

  const loadData = useCallback(
    async (currentFilters: MapFilters, activeAiFilters: ActiveAiFilter[]) => {
      const thisId = ++loadIdRef.current;
      setLoading(true);
      setFocusedCity(null);
      await ensureLocationsLoaded();

      let peopleData: Person[] = [];
      let orgsData: Organization[] = [];

      if (currentFilters.showPeople) {
        let q = supabase.from('people').select('*');

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
          q = q.or(
            currentFilters.flemishConnections
              .map((fc) => `flemish_connection.ilike.%${fc}%`)
              .join(',')
          );
        }

        if (currentFilters.availableForLectures) {
          q = q.eq('available_for_lectures', true);
        }

        const { data } = await q;
        peopleData = data || [];

        if (currentFilters.flemishConnections.length > 0 && peopleData.length === 0) {
          const { data: allPeople } = await supabase.from('people').select('*');
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
        const { data } = await supabase.from('organizations').select('*');
        let rawOrgs = (data || []) as Organization[];

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
          city: p.location_city,
          state: p.location_state,
          lat: p.latitude,
          lng: p.longitude,
        })),
        ...orgsData.map((o) => ({
          id: o.id,
          table: 'organizations' as const,
          city: o.location_city,
          state: o.location_state,
          lat: o.latitude,
          lng: o.longitude,
        })),
      ];

      const needsGeocoding = allEntities.filter((e) => {
        if (!e.city || !e.state) return false;
        if (e.lat != null && e.lng != null) return false;
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
          }

          for (const entity of needsGeocoding) {
            const key = `${entity.city},${entity.state}`;
            const coords = geocoded.get(key);
            if (!coords) continue;
            if (entity.table === 'people') {
              const p = peopleData.find((pp) => pp.id === entity.id);
              if (p) { p.latitude = coords.lat; p.longitude = coords.lng; }
            } else {
              const o = orgsData.find((oo) => oo.id === entity.id);
              if (o) { o.latitude = coords.lat; o.longitude = coords.lng; }
            }
          }

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
    setAiKeywords(null);
    setSnippets(new Map());
    setActiveFilters([]);

    setFilters(newFilters);

    if (filterPreset.focusCity) {
      setTimeout(() => {
        setFocusedCity(filterPreset.focusCity!);
        setViewMode('list');
      }, 100);
    }

    onConsumePreset();
  }, [filterPreset, onConsumePreset]);

  useEffect(() => {
    if (!searchCommand || searchCommand.timestamp <= lastSearchTimestamp.current) return;
    lastSearchTimestamp.current = searchCommand.timestamp;
    onConsumeSearchCommand();

    const query = searchCommand.query;
    setActiveQuery(query);
    setViewMode('list');
    setNameMatches([]);
    setAiResults([]);
    setAiKeywords(null);
    setSnippets(new Map());

    const namePromise = supabase
      .from('people')
      .select('*')
      .or(`name.ilike.%${query}%,first_name.ilike.%${query}%,last_name.ilike.%${query}%`)
      .then(({ data }) => {
        const results = data || [];
        setNameMatches(results as Person[]);
        return results as Person[];
      });

    setAiLoading(true);
    onSearchingChange(true);

    const aiPromise = smartSearch(query).then((result) => {
      return { keywords: result.keywords };
    }).catch(() => null);

    Promise.all([namePromise, aiPromise]).then(async ([, aiResult]) => {
      if (aiResult) {
        setAiKeywords(aiResult.keywords);

        const { data: allPeople } = await supabase.from('people').select('*');
        if (allPeople) {
          const nameMatchIds = new Set((await namePromise).map((p) => p.id));
          const scored = (allPeople as Person[])
            .filter((p) => !nameMatchIds.has(p.id))
            .map((p) => ({
              person: p,
              score: scorePersonAgainstKeywords(
                p as unknown as Record<string, unknown>,
                aiResult.keywords
              ),
            }))
            .filter((s) => s.score >= AI_SCORE_THRESHOLD)
            .sort((a, b) => b.score - a.score);

          const aiPeople = scored.map((s) => s.person);
          setAiResults(aiPeople);

          const newSnippets = new Map<string, string>();
          for (const person of aiPeople) {
            const snippet = generateSnippet(person, aiResult.keywords);
            if (snippet) newSnippets.set(person.id, snippet);
          }
          setSnippets(newSnippets);
        }
      }
      setAiLoading(false);
      onSearchingChange(false);
    });
  }, [searchCommand, onConsumeSearchCommand, onSearchingChange]);

  const handleFiltersChange = useCallback((next: MapFilters) => {
    setFilters(next);
  }, []);

  const handleRemoveFilter = useCallback((filterId: string) => {
    setActiveFilters((prev) => prev.filter((f) => f.id !== filterId));
  }, []);

  const handleActivatePopularFilter = useCallback(async (saved: SavedFlemishFilter) => {
    const af: ActiveAiFilter = {
      id: saved.id,
      query: saved.original_query,
      keywords: saved.keywords,
      fields: saved.target_fields.length > 0 ? saved.target_fields : [...PREDEFINED_FILTER_FIELDS],
    };
    setActiveFilters((prev) => {
      if (prev.some((f) => f.id === af.id)) return prev;
      return [...prev, af];
    });

    await supabase
      .from('saved_flemish_filters')
      .update({ usage_count: saved.usage_count + 1 })
      .eq('id', saved.id);

    setPopularFilters((prev) =>
      prev.map((f) => f.id === saved.id ? { ...f, usage_count: f.usage_count + 1 } : f)
    );
  }, []);

  const handleActivatePredefined = useCallback((name: string) => {
    const lower = name.toLowerCase();
    const keywords: Record<string, string[]> = {};
    for (const field of PREDEFINED_FILTER_FIELDS) {
      keywords[field] = [lower];
    }
    const af: ActiveAiFilter = {
      id: `predefined-${name}`,
      query: name,
      keywords,
      fields: [...PREDEFINED_FILTER_FIELDS],
    };
    setActiveFilters((prev) => {
      if (prev.some((f) => f.id === af.id)) return prev;
      return [...prev, af];
    });
  }, []);

  const handleClearSearchQuery = useCallback(() => {
    setActiveQuery('');
    setNameMatches([]);
    setAiResults([]);
    setAiKeywords(null);
    setSnippets(new Map());
    onClearSearchInput();
  }, [onClearSearchInput]);

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
          p.location_city === focusedCity.city &&
          p.location_state === focusedCity.state
      )
    : people;

  const displayedOrgs = focusedCity
    ? organizations.filter(
        (o) =>
          o.location_city === focusedCity.city &&
          o.location_state === focusedCity.state
      )
    : organizations;

  return (
    <div className="flex h-[calc(100vh-64px)]">
      <div className="flex-1 relative overflow-hidden">
        <div className="absolute top-4 left-4 z-40">
          <div className="bg-white/95 backdrop-blur-sm rounded-xl shadow-lg border border-gray-200 p-1 flex">
            <button
              onClick={() => {
                setViewMode('map');
                setFocusedCity(null);
              }}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                viewMode === 'map'
                  ? 'bg-gray-900 text-white shadow-sm'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
              }`}
            >
              <MapIcon className="w-4 h-4" />
              <span>Map</span>
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                viewMode === 'list'
                  ? 'bg-gray-900 text-white shadow-sm'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
              }`}
            >
              <List className="w-4 h-4" />
              <span>List</span>
            </button>
          </div>
        </div>

        {viewMode === 'map' ? (
          <MapVisualization
            clusters={clusters}
            loading={loading}
            onViewInDirectory={handleViewInDirectory}
            onNavigate={onNavigate}
          />
        ) : (
          <div className="h-full overflow-y-auto bg-gray-50">
            <div className="max-w-6xl mx-auto px-6 pt-20 pb-8">
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
        activeSearchKeywords={aiKeywords}
        onRemoveSearchQuery={handleRemoveSearchQueryFilter}
        popularFilters={popularFilters}
        onActivatePopularFilter={handleActivatePopularFilter}
        onActivatePredefined={handleActivatePredefined}
      />
    </div>
  );
}
