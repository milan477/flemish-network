import { useState } from 'react';
import { Users, Building2, Filter, RotateCcw, X, Sparkles, Search } from 'lucide-react';
import type { MapFilters, ActiveAiFilter, SavedFlemishFilter } from '../lib/supabase';
import type { SmartSearchKeywords } from '../lib/aiService';
import { DEFAULT_MAP_FILTERS, OCCUPATION_OPTIONS, PREDEFINED_FILTERS } from '../lib/supabase';

interface FilterPanelProps {
  filters: MapFilters;
  onFiltersChange: (filters: MapFilters) => void;
  showPanel: boolean;
  onTogglePanel: () => void;
  stats: { people: number; organizations: number; cities: number };
  activeAiFilters: ActiveAiFilter[];
  onRemoveAiFilter: (id: string) => void;
  activeSearchQuery: string;
  activeSearchKeywords: SmartSearchKeywords | null;
  onRemoveSearchQuery: () => void;
  popularFilters: SavedFlemishFilter[];
  onActivatePopularFilter: (filter: SavedFlemishFilter) => Promise<void>;
  onActivatePredefined: (name: string) => void;
}

const SELECT_CLS =
  'w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:border-transparent transition-all';

function AiKeywordTooltip({ keywords }: { keywords: Record<string, string[]> }) {
  const entries = Object.entries(keywords).filter(([, v]) => v.length > 0);
  if (entries.length === 0) return null;

  return (
    <div className="absolute bottom-full left-0 mb-1.5 w-56 bg-gray-900 text-white text-xs rounded-lg p-3 shadow-xl z-50 pointer-events-none">
      <div className="text-[10px] font-semibold uppercase text-gray-400 mb-1.5">AI Keywords</div>
      {entries.map(([field, kws]) => (
        <div key={field} className="mb-1 last:mb-0">
          <span className="text-gray-400">{field}:</span>{' '}
          <span className="text-gray-200">{kws.join(', ')}</span>
        </div>
      ))}
      <div className="absolute bottom-0 left-4 translate-y-1/2 w-2 h-2 bg-gray-900 rotate-45" />
    </div>
  );
}

function SearchQueryTooltip({ keywords }: { keywords: SmartSearchKeywords }) {
  const entries = Object.entries(keywords).filter(([, v]) => v.length > 0);
  if (entries.length === 0) return null;

  return (
    <div className="absolute bottom-full left-0 mb-1.5 w-56 bg-gray-900 text-white text-xs rounded-lg p-3 shadow-xl z-50 pointer-events-none">
      <div className="text-[10px] font-semibold uppercase text-gray-400 mb-1.5">AI Analysis</div>
      {entries.map(([field, kws]) => (
        <div key={field} className="mb-1 last:mb-0">
          <span className="text-gray-400">{field}:</span>{' '}
          <span className="text-gray-200">{kws.join(', ')}</span>
        </div>
      ))}
      <div className="absolute bottom-0 left-4 translate-y-1/2 w-2 h-2 bg-gray-900 rotate-45" />
    </div>
  );
}

export default function FilterPanel({
  filters,
  onFiltersChange,
  showPanel,
  onTogglePanel,
  stats,
  activeAiFilters,
  onRemoveAiFilter,
  activeSearchQuery,
  activeSearchKeywords,
  onRemoveSearchQuery,
  popularFilters,
  onActivatePopularFilter,
  onActivatePredefined,
}: FilterPanelProps) {
  const [hoveredFilterId, setHoveredFilterId] = useState<string | null>(null);
  const [hoveredSearchQuery, setHoveredSearchQuery] = useState(false);

  const handleReset = () => {
    onFiltersChange({ ...DEFAULT_MAP_FILTERS });
    if (activeSearchQuery) onRemoveSearchQuery();
    for (const f of activeAiFilters) {
      onRemoveAiFilter(f.id);
    }
  };

  const activeFilterCount = [
    filters.sector,
    filters.occupation,
    filters.flemishConnections.length > 0 ? 'yes' : '',
    filters.availableForLectures ? 'yes' : '',
    !filters.showPeople ? 'hide' : '',
    !filters.showOrganizations ? 'hide' : '',
    activeSearchQuery ? 'yes' : '',
    ...activeAiFilters.map(() => 'yes'),
  ].filter(Boolean).length;

  const hasActiveFilters = activeFilterCount > 0;

  const shownPopularFilters = popularFilters.filter((f) => f.usage_count > 2).slice(0, 8);

  const activeAiIds = new Set(activeAiFilters.map((f) => f.id));
  const activePredefinedNames = new Set(
    activeAiFilters.filter((f) => f.id.startsWith('predefined-')).map((f) => f.query)
  );

  return (
    <div
      className={`${showPanel ? 'w-72' : 'w-12'} bg-white border-l border-gray-200 transition-all duration-300 flex flex-col`}
    >
      <button
        onClick={onTogglePanel}
        className="p-4 hover:bg-gray-50 transition-colors flex items-center justify-between"
      >
        <span className={`font-medium text-gray-900 ${showPanel ? '' : 'hidden'}`}>
          Filters
          {activeFilterCount > 0 && (
            <span className="ml-2 text-xs bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded-full font-semibold">
              {activeFilterCount}
            </span>
          )}
        </span>
        <div className="relative">
          <Filter className="w-5 h-5 text-gray-600" />
          {!showPanel && activeFilterCount > 0 && (
            <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-yellow-400 rounded-full border-2 border-white" />
          )}
        </div>
      </button>

      {showPanel && (
        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {(activeSearchQuery || activeAiFilters.length > 0) && (
            <div>
              <label className="text-sm font-medium text-gray-900 mb-2 block">
                Active Filters
              </label>
              <div className="space-y-1.5">
                {activeSearchQuery && (
                  <div
                    className="relative"
                    onMouseEnter={() => setHoveredSearchQuery(true)}
                    onMouseLeave={() => setHoveredSearchQuery(false)}
                  >
                    {hoveredSearchQuery && activeSearchKeywords && (
                      <SearchQueryTooltip keywords={activeSearchKeywords} />
                    )}
                    <div className="flex items-center justify-between px-2.5 py-2 bg-sky-50 border border-sky-200 rounded-lg group">
                      <div className="flex items-center gap-1.5 min-w-0 flex-1">
                        <Search className="w-3.5 h-3.5 text-sky-600 flex-shrink-0" />
                        <span className="text-xs font-medium text-sky-800 truncate">
                          {activeSearchQuery}
                        </span>
                      </div>
                      <button
                        onClick={onRemoveSearchQuery}
                        className="p-0.5 text-sky-400 hover:text-sky-600 transition-colors flex-shrink-0"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                )}

                {activeAiFilters.map((af) => (
                  <div
                    key={af.id}
                    className="relative"
                    onMouseEnter={() => setHoveredFilterId(af.id)}
                    onMouseLeave={() => setHoveredFilterId(null)}
                  >
                    {hoveredFilterId === af.id && (
                      <AiKeywordTooltip keywords={af.keywords} />
                    )}
                    <div className="flex items-center justify-between px-2.5 py-2 bg-yellow-50 border border-yellow-200 rounded-lg group">
                      <div className="flex items-center gap-1.5 min-w-0 flex-1">
                        <Sparkles className="w-3.5 h-3.5 text-yellow-600 flex-shrink-0" />
                        <span className="text-xs font-medium text-yellow-800 truncate">
                          {af.query}
                        </span>
                      </div>
                      <button
                        onClick={() => onRemoveAiFilter(af.id)}
                        className="p-0.5 text-yellow-400 hover:text-yellow-600 transition-colors flex-shrink-0"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="text-sm font-medium text-gray-900 mb-3 block">Show</label>
            <div className="space-y-2">
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={filters.showPeople}
                  onChange={(e) =>
                    onFiltersChange({ ...filters, showPeople: e.target.checked })
                  }
                  className="w-4 h-4 text-yellow-600 border-gray-300 rounded focus:ring-yellow-500"
                />
                <Users className="w-4 h-4 text-gray-600" />
                <span className="text-sm text-gray-700">People</span>
              </label>
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={filters.showOrganizations}
                  onChange={(e) =>
                    onFiltersChange({ ...filters, showOrganizations: e.target.checked })
                  }
                  className="w-4 h-4 text-yellow-600 border-gray-300 rounded focus:ring-yellow-500"
                />
                <Building2 className="w-4 h-4 text-gray-600" />
                <span className="text-sm text-gray-700">Organizations</span>
              </label>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-gray-900 mb-2 block">Sector</label>
            <select
              value={filters.sector}
              onChange={(e) =>
                onFiltersChange({ ...filters, sector: e.target.value })
              }
              className={SELECT_CLS}
            >
              <option value="">All Sectors</option>
              <option value="Artificial Intelligence">Artificial Intelligence</option>
              <option value="Biotechnology">Biotechnology</option>
              <option value="Finance">Finance</option>
              <option value="Culture & Arts">Culture & Arts</option>
              <option value="Education">Education</option>
              <option value="Research">Research</option>
            </select>
          </div>

          <div>
            <label className="text-sm font-medium text-gray-900 mb-2 block">Occupation</label>
            <select
              value={filters.occupation}
              onChange={(e) =>
                onFiltersChange({ ...filters, occupation: e.target.value })
              }
              className={SELECT_CLS}
            >
              <option value="">All Occupations</option>
              {OCCUPATION_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-sm font-medium text-gray-900 mb-2 block">
              Popular Filters
            </label>
            <div className="flex flex-wrap gap-1.5">
              {PREDEFINED_FILTERS.map((name) => {
                const isActive = activePredefinedNames.has(name);
                return (
                  <button
                    key={name}
                    onClick={() => {
                      if (isActive) {
                        onRemoveAiFilter(`predefined-${name}`);
                      } else {
                        onActivatePredefined(name);
                      }
                    }}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
                      isActive
                        ? 'bg-yellow-100 text-yellow-800 border border-yellow-300'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200 border border-transparent'
                    }`}
                  >
                    {name}
                  </button>
                );
              })}
            </div>
            {shownPopularFilters.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2 pt-2 border-t border-gray-100">
                {shownPopularFilters.map((pf) => {
                  const isActive = activeAiIds.has(pf.id);
                  return (
                    <button
                      key={pf.id}
                      onClick={() => {
                        if (isActive) {
                          onRemoveAiFilter(pf.id);
                        } else {
                          onActivatePopularFilter(pf);
                        }
                      }}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all flex items-center gap-1 ${
                        isActive
                          ? 'bg-yellow-100 text-yellow-800 border border-yellow-300'
                          : 'bg-gray-50 text-gray-600 hover:bg-gray-100 border border-gray-200'
                      }`}
                    >
                      <Sparkles className="w-3 h-3" />
                      {pf.original_query}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {hasActiveFilters && (
            <button
              onClick={handleReset}
              className="w-full flex items-center justify-center space-x-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors text-sm"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset All Filters</span>
            </button>
          )}
        </div>
      )}

      <div className={`border-t border-gray-200 p-4 ${showPanel ? '' : 'hidden'}`}>
        <div className="text-xs text-gray-600 space-y-1">
          <div className="flex justify-between">
            <span>People</span>
            <span className="font-medium text-gray-900">{stats.people}</span>
          </div>
          <div className="flex justify-between">
            <span>Organizations</span>
            <span className="font-medium text-gray-900">{stats.organizations}</span>
          </div>
          <div className="flex justify-between">
            <span>Cities</span>
            <span className="font-medium text-gray-900">{stats.cities}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
