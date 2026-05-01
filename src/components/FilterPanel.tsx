import { Users, Building2, Filter, RotateCcw } from 'lucide-react';
import type { MapFilters, ActiveAiFilter } from '../lib/supabase';
import { DEFAULT_MAP_FILTERS, OCCUPATION_OPTIONS, FLEMISH_OPTIONS } from '../lib/supabase';

interface FilterPanelProps {
  filters: MapFilters;
  onFiltersChange: (filters: MapFilters) => void;
  showPanel: boolean;
  onTogglePanel: () => void;
  stats: { people: number; organizations: number; cities: number };
  activeAiFilters: ActiveAiFilter[];
  onRemoveAiFilter: (id: string) => void;
  activeSearchQuery: string;
  onRemoveSearchQuery: () => void;
  flemishOptions?: string[];
}

const SELECT_CLS =
  'w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:border-transparent transition-all';

export default function FilterPanel({
  filters,
  onFiltersChange,
  showPanel,
  onTogglePanel,
  stats,
  activeAiFilters,
  onRemoveAiFilter,
  activeSearchQuery,
  onRemoveSearchQuery,
  flemishOptions,
}: FilterPanelProps) {
  const connectionOptions = flemishOptions && flemishOptions.length > 0
    ? flemishOptions
    : FLEMISH_OPTIONS;

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
    filters.city || filters.state,
    filters.flemishConnections.length > 0 ? 'yes' : '',
    filters.availableForLectures ? 'yes' : '',
    !filters.showPeople ? 'hide' : '',
    !filters.showOrganizations ? 'hide' : '',
    activeSearchQuery ? 'yes' : '',
    ...activeAiFilters.map(() => 'yes'),
  ].filter(Boolean).length;

  const hasActiveFilters = activeFilterCount > 0;

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
              Flemish Connection
            </label>
            <div className="flex flex-wrap gap-1.5">
              {connectionOptions.map((opt) => {
                const isActive = filters.flemishConnections.includes(opt);
                return (
                  <button
                    key={opt}
                    onClick={() => {
                      const next = isActive
                        ? filters.flemishConnections.filter((c) => c !== opt)
                        : [...filters.flemishConnections, opt];
                      onFiltersChange({ ...filters, flemishConnections: next });
                    }}
                    className={`px-2 py-1 rounded-md text-xs font-medium transition-all ${
                      isActive
                        ? 'bg-yellow-100 text-yellow-800 border border-yellow-300'
                        : 'bg-gray-50 text-gray-600 hover:bg-gray-100 border border-gray-200'
                    }`}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>
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
