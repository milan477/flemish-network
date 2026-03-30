import { useCallback, useMemo, useState } from 'react';
import { Building2, Clock, MapPin, Users } from 'lucide-react';
import type { Person } from '../../lib/supabase';
import type { FilterPreset } from '../../lib/supabase';
import OccupationOverview, {
  classifyPerson,
} from './OccupationOverview';
import StaleContactsBar from './StaleContactsBar';
import SuggestedChanges, { type ProfileSuggestion } from './SuggestedChanges';
import InteractiveBarChart, {
  type InteractiveBarChartItem,
} from './InteractiveBarChart';
import CrossFilterBar from './CrossFilterBar';
import DataQualityChart from './DataQualityChart';
import FlemishConnectionChart from './FlemishConnectionChart';
import AvailabilityOverview from './AvailabilityOverview';
import ConnectionsSummary from './ConnectionsSummary';
import {
  buildNetworkPreset,
  COMPLETENESS_FIELD_LABELS,
  EMPTY_CROSS_FILTERS,
  FRESHNESS_TIER_LABELS,
  getFreshnessTier,
  type AvailabilityFilter,
  type CompletenessField,
  type ConnectionStatsRow,
  type CrossFilterState,
  type FreshnessTier,
  type PersonSectorRow,
} from './interactiveStatsShared';

interface InteractiveStatsOverviewProps {
  people: Person[];
  orgCount: number;
  suggestions: ProfileSuggestion[];
  personSectors: PersonSectorRow[];
  connections: ConnectionStatsRow[];
  collectionMemberPersonIds: string[];
  onNavigate: (page: string, id?: string, preset?: FilterPreset) => void;
  onReloadData: () => Promise<void>;
  onAskAI: (personIds: string[]) => Promise<void>;
  onMarkCurrent: (personId: string) => Promise<void>;
  aiLoading: boolean;
  aiLoadingIds: Set<string>;
  noUpdateIds: Set<string>;
  onSuggestionsRefresh: () => Promise<void>;
  onBackfillEmbeddings: () => Promise<void>;
  embeddingProgress: { processed: number; total: number } | null;
  embeddingRunning: boolean;
}

type ExcludedDimension =
  | 'sector'
  | 'occupationCategory'
  | 'flemishConnection'
  | 'location'
  | 'freshnessTier'
  | 'availability'
  | 'completenessField'
  | null;

const SECTOR_COLORS: Record<string, string> = {
  'Artificial Intelligence': 'bg-blue-500',
  Biotechnology: 'bg-green-500',
  Finance: 'bg-amber-500',
  Education: 'bg-yellow-500',
  'Culture & Arts': 'bg-pink-500',
  Research: 'bg-cyan-500',
};

function hasText(value?: string | null): boolean {
  return Boolean(value && value.trim().length > 0);
}

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function buildCityKey(city: string, state: string) {
  return `${city}|${state}`;
}

function parseCityKey(key: string) {
  const [city, state] = key.split('|');
  return { city, state };
}

function buildCounts(values: string[]): Map<string, number> {
  const counts = new Map<string, number>();

  values.forEach((value) => {
    counts.set(value, (counts.get(value) || 0) + 1);
  });

  return counts;
}

function countUniqueBy<T>(items: T[], getKey: (item: T) => string | null | undefined) {
  return new Set(
    items
      .map((item) => getKey(item))
      .filter((value): value is string => Boolean(value))
  ).size;
}

function humanizeAvailability(key: AvailabilityFilter) {
  switch (key) {
    case 'lectures':
      return 'Lectures';
    case 'mentorship':
      return 'Mentorship';
    case 'visits':
      return 'Visits';
  }
}

function StatCard({
  icon: Icon,
  iconBg,
  iconColor,
  value,
  total,
  label,
  subtext,
}: {
  icon: typeof Users;
  iconBg: string;
  iconColor: string;
  value: number;
  total: number;
  label: string;
  subtext?: string;
}) {
  const isFiltered = value !== total;

  return (
    <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
      <div className="flex items-center space-x-3">
        <div
          className={`w-10 h-10 ${iconBg} rounded-lg flex items-center justify-center flex-shrink-0`}
        >
          <Icon className={`w-5 h-5 ${iconColor}`} />
        </div>
        <div>
          <p className="text-xl font-semibold text-gray-900">
            {isFiltered ? `${value} of ${total}` : total}
          </p>
          <p className="text-xs text-gray-500">
            {label}
            {subtext && <span className="text-gray-400"> · {subtext}</span>}
          </p>
        </div>
      </div>
    </div>
  );
}

interface LocationExplorerProps {
  stateItems: InteractiveBarChartItem[];
  stateCityItems: InteractiveBarChartItem[];
  rankedCityItems: InteractiveBarChartItem[];
  activeState: string | null;
  activeCityKey: string | null;
  viewMode: 'states' | 'cities';
  onViewModeChange: (mode: 'states' | 'cities') => void;
  onStateClick: (state: string) => void;
  onStateCityClick: (cityKey: string) => void;
  onRankedCityClick: (cityKey: string) => void;
  onViewCity: (cityKey: string) => void;
}

function LocationExplorer({
  stateItems,
  stateCityItems,
  rankedCityItems,
  activeState,
  activeCityKey,
  viewMode,
  onViewModeChange,
  onStateClick,
  onStateCityClick,
  onRankedCityClick,
  onViewCity,
}: LocationExplorerProps) {
  const maxState = Math.max(
    1,
    ...stateItems.map((item) => Math.max(item.count, item.totalCount ?? item.count))
  );
  const maxCity = Math.max(
    1,
    ...stateCityItems.map((item) => Math.max(item.count, item.totalCount ?? item.count)),
    ...rankedCityItems.map((item) => Math.max(item.count, item.totalCount ?? item.count))
  );

  return (
    <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Locations</h2>
          <p className="text-sm text-gray-500 mt-1">
            Switch between state-level filtering and a ranked city list.
          </p>
        </div>
        <select
          value={viewMode}
          onChange={(event) =>
            onViewModeChange(event.target.value as 'states' | 'cities')
          }
          className="h-8 rounded-md border border-gray-200 bg-white px-2 text-xs font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-teal-100"
          aria-label="Location mode"
        >
          <option value="states">States</option>
          <option value="cities">Cities</option>
        </select>
      </div>

      {viewMode === 'states' && stateItems.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-6">
          No location data available.
        </p>
      ) : viewMode === 'cities' && rankedCityItems.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-6">
          No city data available.
        </p>
      ) : (
        <>
          {viewMode === 'states' ? (
            <>
              <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                {stateItems.map((item) => {
                  const totalCount = item.totalCount ?? item.count;
                  const isActive = activeState === item.key;

                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => onStateClick(item.key)}
                      className={`w-full rounded-xl border px-3 py-3 text-left transition-all ${
                        isActive
                          ? 'border-teal-300 ring-2 ring-teal-100 bg-teal-50/60'
                          : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-gray-800">
                          {item.label}
                        </span>
                        <span className="text-sm font-semibold text-gray-900">
                          {item.count === totalCount
                            ? item.count
                            : `${item.count} / ${totalCount}`}
                        </span>
                      </div>
                      <div className="relative h-2.5 rounded-full bg-gray-100 overflow-hidden">
                        <div
                          className="absolute inset-y-0 left-0 rounded-full bg-gray-200"
                          style={{ width: `${(totalCount / maxState) * 100}%` }}
                        />
                        <div
                          className="absolute inset-y-0 left-0 rounded-full bg-cyan-500 transition-all duration-700"
                          style={{ width: `${(item.count / maxState) * 100}%` }}
                        />
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="mt-5 pt-5 border-t border-gray-100">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium text-gray-900">
                    {activeState ? `${activeState} Cities` : 'City Drill-Down'}
                  </h3>
                  {activeState && (
                    <span className="text-xs text-gray-500">
                      {pluralize(stateCityItems.length, 'city', 'cities')}
                    </span>
                  )}
                </div>

                {!activeState ? (
                  <p className="text-sm text-gray-400 py-4">
                    Select a state above to reveal city-level counts.
                  </p>
                ) : stateCityItems.length === 0 ? (
                  <p className="text-sm text-gray-400 py-4">
                    No city data available for {activeState}.
                  </p>
                ) : (
                  <div className="space-y-2.5 max-h-64 overflow-y-auto pr-1">
                    {stateCityItems.map((item) => {
                      const totalCount = item.totalCount ?? item.count;
                      const isActive = activeCityKey === item.key;

                      return (
                        <div key={item.key} className="group flex items-stretch gap-2">
                          <button
                            type="button"
                            onClick={() => onStateCityClick(item.key)}
                            className={`flex-1 rounded-xl border px-3 py-3 text-left transition-all ${
                              isActive
                                ? 'border-teal-300 ring-2 ring-teal-100 bg-teal-50/60'
                                : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                            }`}
                          >
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-sm font-medium text-gray-800">
                                {item.label}
                              </span>
                              <span className="text-sm font-semibold text-gray-900">
                                {item.count === totalCount
                                  ? item.count
                                  : `${item.count} / ${totalCount}`}
                              </span>
                            </div>
                            <div className="relative h-2.5 rounded-full bg-gray-100 overflow-hidden">
                              <div
                                className="absolute inset-y-0 left-0 rounded-full bg-gray-200"
                                style={{ width: `${(totalCount / maxCity) * 100}%` }}
                              />
                              <div
                                className="absolute inset-y-0 left-0 rounded-full bg-sky-500 transition-all duration-700"
                                style={{ width: `${(item.count / maxCity) * 100}%` }}
                              />
                            </div>
                          </button>

                          <button
                            type="button"
                            onClick={() => onViewCity(item.key)}
                            className="w-10 rounded-xl border border-gray-200 text-gray-500 hover:text-teal-700 hover:border-teal-200 hover:bg-teal-50 transition-all opacity-0 group-hover:opacity-100 focus:opacity-100"
                            title={`View ${item.label} in network`}
                            aria-label={`View ${item.label} in network`}
                          >
                            <MapPin className="w-4 h-4 mx-auto" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="space-y-2.5 max-h-[29rem] overflow-y-auto pr-1">
              {rankedCityItems.map((item) => {
                const totalCount = item.totalCount ?? item.count;
                const isActive = activeCityKey === item.key;

                return (
                  <div key={item.key} className="group flex items-stretch gap-2">
                    <button
                      type="button"
                      onClick={() => onRankedCityClick(item.key)}
                      className={`flex-1 rounded-xl border px-3 py-3 text-left transition-all ${
                        isActive
                          ? 'border-teal-300 ring-2 ring-teal-100 bg-teal-50/60'
                          : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2 gap-3">
                        <span className="block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-sm font-medium text-gray-800">
                          {item.label}
                        </span>
                        <span className="text-sm font-semibold text-gray-900 flex-shrink-0">
                          {item.count === totalCount
                            ? item.count
                            : `${item.count} / ${totalCount}`}
                        </span>
                      </div>
                      <div className="relative h-2.5 rounded-full bg-gray-100 overflow-hidden">
                        <div
                          className="absolute inset-y-0 left-0 rounded-full bg-gray-200"
                          style={{ width: `${(totalCount / maxCity) * 100}%` }}
                        />
                        <div
                          className="absolute inset-y-0 left-0 rounded-full bg-sky-500 transition-all duration-700"
                          style={{ width: `${(item.count / maxCity) * 100}%` }}
                        />
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => onViewCity(item.key)}
                      className="w-10 rounded-xl border border-gray-200 text-gray-500 hover:text-teal-700 hover:border-teal-200 hover:bg-teal-50 transition-all opacity-0 group-hover:opacity-100 focus:opacity-100"
                      title={`View ${item.label} in network`}
                      aria-label={`View ${item.label} in network`}
                    >
                      <MapPin className="w-4 h-4 mx-auto" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function InteractiveStatsOverview({
  people,
  orgCount,
  suggestions,
  personSectors,
  connections,
  collectionMemberPersonIds,
  onNavigate,
  onReloadData,
  onAskAI,
  onMarkCurrent,
  aiLoading,
  aiLoadingIds,
  noUpdateIds,
  onSuggestionsRefresh,
  onBackfillEmbeddings,
  embeddingProgress,
  embeddingRunning,
}: InteractiveStatsOverviewProps) {
  const [crossFilters, setCrossFilters] =
    useState<CrossFilterState>(EMPTY_CROSS_FILTERS);
  const [locationViewMode, setLocationViewMode] = useState<'states' | 'cities'>(
    'states'
  );

  const personToSectorsMap = useMemo(() => {
    const next = new Map<string, Set<string>>();

    personSectors.forEach((row) => {
      const sectorName = row.sectors?.name;
      if (!sectorName) return;
      const existing = next.get(row.person_id) || new Set<string>();
      existing.add(sectorName);
      next.set(row.person_id, existing);
    });

    return next;
  }, [personSectors]);

  const sectorToPeopleMap = useMemo(() => {
    const next = new Map<string, Set<string>>();

    personSectors.forEach((row) => {
      const sectorName = row.sectors?.name;
      if (!sectorName) return;
      const existing = next.get(sectorName) || new Set<string>();
      existing.add(row.person_id);
      next.set(sectorName, existing);
    });

    return next;
  }, [personSectors]);

  const inCollectionSet = useMemo(
    () => new Set(collectionMemberPersonIds),
    [collectionMemberPersonIds]
  );

  const hasCompletenessField = useCallback(
    (person: Person, field: CompletenessField) => {
      switch (field) {
        case 'email':
          return hasText(person.email);
        case 'linkedin_url':
          return hasText(person.linkedin_url);
        case 'profile_photo_url':
          return hasText(person.profile_photo_url);
        case 'bio':
          return hasText(person.bio);
        case 'sector':
          return (personToSectorsMap.get(person.id)?.size || 0) > 0;
        case 'flemish_connection':
          return hasText(person.flemish_connection);
      }
    },
    [personToSectorsMap]
  );

  const applyFilters = useCallback(
    (input: Person[], excludeDimension: ExcludedDimension = null) =>
      input.filter((person) => {
        if (
          excludeDimension !== 'sector' &&
          crossFilters.sector &&
          !personToSectorsMap.get(person.id)?.has(crossFilters.sector)
        ) {
          return false;
        }

        if (
          excludeDimension !== 'occupationCategory' &&
          crossFilters.occupationCategory &&
          classifyPerson(person) !== crossFilters.occupationCategory
        ) {
          return false;
        }

        if (
          excludeDimension !== 'flemishConnection' &&
          crossFilters.flemishConnection &&
          person.flemish_connection !== crossFilters.flemishConnection
        ) {
          return false;
        }

        if (excludeDimension !== 'location') {
          if (crossFilters.state && person.locations?.state !== crossFilters.state) {
            return false;
          }
          if (crossFilters.city && person.locations?.city !== crossFilters.city) {
            return false;
          }
        }

        if (
          excludeDimension !== 'freshnessTier' &&
          crossFilters.freshnessTier &&
          getFreshnessTier(person) !== crossFilters.freshnessTier
        ) {
          return false;
        }

        if (
          excludeDimension !== 'availability' &&
          crossFilters.availability.length > 0
        ) {
          for (const key of crossFilters.availability) {
            if (key === 'lectures' && !person.available_for_lectures) return false;
            if (key === 'mentorship' && !person.open_to_mentorship) return false;
            if (key === 'visits' && !person.welcomes_visits) return false;
          }
        }

        if (
          excludeDimension !== 'completenessField' &&
          crossFilters.completenessField
        ) {
          const hasField = hasCompletenessField(
            person,
            crossFilters.completenessField.field
          );
          if (hasField !== crossFilters.completenessField.has) return false;
        }

        return true;
      }),
    [crossFilters, hasCompletenessField, personToSectorsMap]
  );

  const filteredPeople = useMemo(() => applyFilters(people), [applyFilters, people]);
  const sectorPeople = useMemo(
    () => applyFilters(people, 'sector'),
    [applyFilters, people]
  );
  const occupationPeople = useMemo(
    () => applyFilters(people, 'occupationCategory'),
    [applyFilters, people]
  );
  const flemishPeople = useMemo(
    () => applyFilters(people, 'flemishConnection'),
    [applyFilters, people]
  );
  const locationPeople = useMemo(
    () => applyFilters(people, 'location'),
    [applyFilters, people]
  );
  const freshnessPeople = useMemo(
    () => applyFilters(people, 'freshnessTier'),
    [applyFilters, people]
  );
  const availabilityPeople = useMemo(
    () => applyFilters(people, 'availability'),
    [applyFilters, people]
  );
  const dataQualityPeople = useMemo(
    () => applyFilters(people, 'completenessField'),
    [applyFilters, people]
  );

  const filteredPeopleIds = useMemo(
    () => new Set(filteredPeople.map((person) => person.id)),
    [filteredPeople]
  );

  const hasActiveFilters = useMemo(
    () =>
      Boolean(
        crossFilters.sector ||
          crossFilters.occupationCategory ||
          crossFilters.flemishConnection ||
          crossFilters.state ||
          crossFilters.city ||
          crossFilters.freshnessTier ||
          crossFilters.availability.length > 0 ||
          crossFilters.completenessField
      ),
    [crossFilters]
  );

  const totalCities = countUniqueBy(
    people,
    (person) =>
      person.locations?.city && person.locations?.state
        ? `${person.locations.city}|${person.locations.state}`
        : null
  );
  const filteredCities = countUniqueBy(
    filteredPeople,
    (person) =>
      person.locations?.city && person.locations?.state
        ? `${person.locations.city}|${person.locations.state}`
        : null
  );
  const totalStates = countUniqueBy(people, (person) => person.locations?.state);
  const filteredStates = countUniqueBy(
    filteredPeople,
    (person) => person.locations?.state
  );
  const filteredOrganizations = new Set(
    filteredPeople
      .map((person) => person.organization_id)
      .filter((value): value is string => Boolean(value))
  ).size;
  const pendingSuggestionCount = suggestions.filter(
    (suggestion) => suggestion.status === 'pending'
  ).length;
  const filteredPendingSuggestionCount = suggestions.filter(
    (suggestion) =>
      suggestion.status === 'pending' && filteredPeopleIds.has(suggestion.person_id)
  ).length;

  const activePreset = useMemo(
    () => buildNetworkPreset(crossFilters),
    [crossFilters]
  );

  const handleViewCurrentInNetwork = useCallback(() => {
    if (!activePreset) return;
    onNavigate('dashboard', undefined, activePreset);
  }, [activePreset, onNavigate]);

  const handleViewSingleInNetwork = useCallback(
    (partial: Partial<CrossFilterState>) => {
      const preset = buildNetworkPreset({ ...EMPTY_CROSS_FILTERS, ...partial });
      if (!preset) return;
      onNavigate('dashboard', undefined, preset);
    },
    [onNavigate]
  );

  const sectorFilteredCounts = useMemo(() => {
    const counts = new Map<string, number>();

    sectorPeople.forEach((person) => {
      personToSectorsMap.get(person.id)?.forEach((sector) => {
        counts.set(sector, (counts.get(sector) || 0) + 1);
      });
    });

    return counts;
  }, [personToSectorsMap, sectorPeople]);

  const sectorItems = useMemo(() => {
    const keys = Array.from(sectorToPeopleMap.keys()).sort(
      (a, b) =>
        (sectorToPeopleMap.get(b)?.size || 0) - (sectorToPeopleMap.get(a)?.size || 0)
    );

    return keys.map<InteractiveBarChartItem>((key) => ({
      key,
      label: key,
      count: sectorFilteredCounts.get(key) || 0,
      totalCount: sectorToPeopleMap.get(key)?.size || 0,
      color: SECTOR_COLORS[key] || 'bg-gray-400',
    }));
  }, [sectorFilteredCounts, sectorToPeopleMap]);

  const stateItems = useMemo(() => {
    const filteredCounts = buildCounts(
      locationPeople
        .map((person) => person.locations?.state || '')
        .filter(Boolean)
    );
    const totalCounts = buildCounts(
      people.map((person) => person.locations?.state || '').filter(Boolean)
    );

    return Array.from(totalCounts.keys())
      .sort((a, b) => {
        const filteredDelta = (filteredCounts.get(b) || 0) - (filteredCounts.get(a) || 0);
        if (filteredDelta !== 0) return filteredDelta;
        return (totalCounts.get(b) || 0) - (totalCounts.get(a) || 0);
      })
      .map<InteractiveBarChartItem>((state) => ({
        key: state,
        label: state,
        count: filteredCounts.get(state) || 0,
        totalCount: totalCounts.get(state) || 0,
        color: 'bg-cyan-500',
      }));
  }, [locationPeople, people]);

  const stateCityItems = useMemo(() => {
    if (!crossFilters.state) return [];

    const filteredCounts = buildCounts(
      locationPeople
        .filter((person) => person.locations?.state === crossFilters.state)
        .map((person) =>
          person.locations?.city && person.locations?.state
            ? buildCityKey(person.locations.city, person.locations.state)
            : ''
        )
        .filter(Boolean)
    );
    const totalCounts = buildCounts(
      people
        .filter((person) => person.locations?.state === crossFilters.state)
        .map((person) =>
          person.locations?.city && person.locations?.state
            ? buildCityKey(person.locations.city, person.locations.state)
            : ''
        )
        .filter(Boolean)
    );

    return Array.from(totalCounts.keys())
      .sort((a, b) => {
        const filteredDelta = (filteredCounts.get(b) || 0) - (filteredCounts.get(a) || 0);
        if (filteredDelta !== 0) return filteredDelta;
        return (totalCounts.get(b) || 0) - (totalCounts.get(a) || 0);
      })
      .map<InteractiveBarChartItem>((cityKey) => ({
        key: cityKey,
        label: parseCityKey(cityKey).city,
        count: filteredCounts.get(cityKey) || 0,
        totalCount: totalCounts.get(cityKey) || 0,
        color: 'bg-sky-500',
      }));
  }, [crossFilters.state, locationPeople, people]);

  const rankedCityItems = useMemo(() => {
    const filteredCounts = buildCounts(
      locationPeople
        .map((person) =>
          person.locations?.city && person.locations?.state
            ? buildCityKey(person.locations.city, person.locations.state)
            : ''
        )
        .filter(Boolean)
    );
    const totalCounts = buildCounts(
      people
        .map((person) =>
          person.locations?.city && person.locations?.state
            ? buildCityKey(person.locations.city, person.locations.state)
            : ''
        )
        .filter(Boolean)
    );

    return Array.from(totalCounts.keys())
      .sort((a, b) => {
        const filteredDelta = (filteredCounts.get(b) || 0) - (filteredCounts.get(a) || 0);
        if (filteredDelta !== 0) return filteredDelta;
        return (totalCounts.get(b) || 0) - (totalCounts.get(a) || 0);
      })
      .map<InteractiveBarChartItem>((cityKey) => {
        const { city, state } = parseCityKey(cityKey);
        return {
          key: cityKey,
          label: `${city}, ${state}`,
          count: filteredCounts.get(cityKey) || 0,
          totalCount: totalCounts.get(cityKey) || 0,
          color: 'bg-sky-500',
        };
      });
  }, [locationPeople, people]);

  const activeCityKey =
    crossFilters.city && crossFilters.state
      ? buildCityKey(crossFilters.city, crossFilters.state)
      : null;

  const chips = useMemo(
    () => [
      crossFilters.sector
        ? {
            key: `sector:${crossFilters.sector}`,
            label: crossFilters.sector,
            onRemove: () =>
              setCrossFilters((prev) => ({ ...prev, sector: null })),
          }
        : null,
      crossFilters.occupationCategory
        ? {
            key: `occupation:${crossFilters.occupationCategory}`,
            label: crossFilters.occupationCategory,
            onRemove: () =>
              setCrossFilters((prev) => ({
                ...prev,
                occupationCategory: null,
              })),
          }
        : null,
      crossFilters.flemishConnection
        ? {
            key: `flemish:${crossFilters.flemishConnection}`,
            label: crossFilters.flemishConnection,
            onRemove: () =>
              setCrossFilters((prev) => ({
                ...prev,
                flemishConnection: null,
              })),
          }
        : null,
      crossFilters.state
        ? {
            key: `state:${crossFilters.state}`,
            label: `State: ${crossFilters.state}`,
            onRemove: () =>
              setCrossFilters((prev) => ({
                ...prev,
                state: null,
                city: null,
              })),
          }
        : null,
      crossFilters.city
        ? {
            key: `city:${crossFilters.city}`,
            label: `City: ${crossFilters.city}`,
            onRemove: () =>
              setCrossFilters((prev) => ({ ...prev, city: null })),
          }
        : null,
      crossFilters.freshnessTier
        ? {
            key: `freshness:${crossFilters.freshnessTier}`,
            label: FRESHNESS_TIER_LABELS[crossFilters.freshnessTier],
            onRemove: () =>
              setCrossFilters((prev) => ({ ...prev, freshnessTier: null })),
          }
        : null,
      ...crossFilters.availability.map((key) => ({
        key: `availability:${key}`,
        label: humanizeAvailability(key),
        onRemove: () =>
          setCrossFilters((prev) => ({
            ...prev,
            availability: prev.availability.filter((item) => item !== key),
          })),
      })),
      crossFilters.completenessField
        ? {
            key: `quality:${crossFilters.completenessField.field}:${crossFilters.completenessField.has ? 'has' : 'missing'}`,
            label: `${
              crossFilters.completenessField.has ? 'Has' : 'Missing'
            } ${COMPLETENESS_FIELD_LABELS[crossFilters.completenessField.field]}`,
            onRemove: () =>
              setCrossFilters((prev) => ({ ...prev, completenessField: null })),
          }
        : null,
    ].filter(
      (
        chip
      ): chip is {
        key: string;
        label: string;
        onRemove: () => void;
      } => Boolean(chip)
    ),
    [crossFilters]
  );

  const toggleAvailability = useCallback((filter: AvailabilityFilter) => {
    setCrossFilters((prev) => ({
      ...prev,
      availability: prev.availability.includes(filter)
        ? prev.availability.filter((item) => item !== filter)
        : [...prev.availability, filter],
    }));
  }, []);

  const toggleFreshnessTier = useCallback((tier: FreshnessTier) => {
    setCrossFilters((prev) => ({
      ...prev,
      freshnessTier: prev.freshnessTier === tier ? null : tier,
    }));
  }, []);

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          icon={Users}
          iconBg="bg-blue-100"
          iconColor="text-blue-600"
          value={filteredPeople.length}
          total={people.length}
          label="People"
        />
        <StatCard
          icon={Building2}
          iconBg="bg-green-100"
          iconColor="text-green-600"
          value={filteredOrganizations}
          total={orgCount}
          label="Organizations"
        />
        <StatCard
          icon={MapPin}
          iconBg="bg-cyan-100"
          iconColor="text-cyan-600"
          value={filteredCities}
          total={totalCities}
          label="Cities"
          subtext={
            filteredStates === totalStates
              ? `${totalStates} states`
              : `${filteredStates} of ${totalStates} states`
          }
        />
        <StatCard
          icon={Clock}
          iconBg="bg-yellow-100"
          iconColor="text-yellow-600"
          value={filteredPendingSuggestionCount}
          total={pendingSuggestionCount}
          label="Pending Updates"
        />
      </div>

      {hasActiveFilters && (
        <CrossFilterBar
          chips={chips}
          filteredCount={filteredPeople.length}
          totalCount={people.length}
          canViewInNetwork={Boolean(activePreset)}
          onViewInNetwork={handleViewCurrentInNetwork}
          onClearAll={() => setCrossFilters(EMPTY_CROSS_FILTERS)}
        />
      )}

      {filteredPeople.length === 0 && (
        <div className="mb-8 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-900">
            No people match the current cross-filters.
          </p>
          <p className="text-sm text-amber-800 mt-1">
            Remove a chip or clear all filters to broaden the subset again.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 mb-8">
        <OccupationOverview
          people={occupationPeople}
          totalPeople={people}
          activeCategory={crossFilters.occupationCategory}
          onBarClick={(category) =>
            setCrossFilters((prev) => ({
              ...prev,
              occupationCategory:
                prev.occupationCategory === category ? null : category,
            }))
          }
          onViewInNetwork={(category) =>
            handleViewSingleInNetwork({ occupationCategory: category })
          }
        />

        <InteractiveBarChart
          title="Profiles by Sector"
          subtitle="Sector counts update as other dimensions narrow the people subset."
          items={sectorItems}
          activeKey={crossFilters.sector}
          onBarClick={(sector) =>
            setCrossFilters((prev) => ({
              ...prev,
              sector: prev.sector === sector ? null : sector,
            }))
          }
          onViewInNetwork={(sector) =>
            handleViewSingleInNetwork({ sector })
          }
          emptyMessage="No sector data available."
        />

        <FlemishConnectionChart
          people={flemishPeople}
          allPeople={people}
          activeConnection={crossFilters.flemishConnection}
          onBarClick={(key) =>
            setCrossFilters((prev) => ({
              ...prev,
              flemishConnection: prev.flemishConnection === key ? null : key,
            }))
          }
          onViewInNetwork={(key) =>
            handleViewSingleInNetwork({ flemishConnection: key })
          }
        />

        <LocationExplorer
          stateItems={stateItems}
          stateCityItems={stateCityItems}
          rankedCityItems={rankedCityItems}
          activeState={crossFilters.state}
          activeCityKey={activeCityKey}
          viewMode={locationViewMode}
          onViewModeChange={setLocationViewMode}
          onStateClick={(state) =>
            setCrossFilters((prev) => ({
              ...prev,
              state: prev.state === state ? null : state,
              city: null,
            }))
          }
          onStateCityClick={(cityKey) =>
            setCrossFilters((prev) => {
              const { city, state } = parseCityKey(cityKey);
              return {
                ...prev,
                city: prev.city === city && prev.state === state ? null : city,
                state,
              };
            })
          }
          onRankedCityClick={(cityKey) =>
            setCrossFilters((prev) => {
              const { city, state } = parseCityKey(cityKey);
              const isActive = prev.city === city && prev.state === state;
              return {
                ...prev,
                state: isActive ? null : state,
                city: isActive ? null : city,
              };
            })
          }
          onViewCity={(cityKey) => {
            const { city, state } = parseCityKey(cityKey);
            handleViewSingleInNetwork({ state, city });
          }}
        />

        <DataQualityChart
          people={dataQualityPeople}
          activeFilter={crossFilters.completenessField}
          onFilterChange={(next) =>
            setCrossFilters((prev) => ({ ...prev, completenessField: next }))
          }
          hasField={hasCompletenessField}
        />

        <div className="space-y-6">
          <AvailabilityOverview
            people={availabilityPeople}
            allPeople={people}
            activeFilters={crossFilters.availability}
            onToggle={toggleAvailability}
          />
          <ConnectionsSummary
            connections={connections}
            people={filteredPeople}
            allPeople={people}
            inCollectionSet={inCollectionSet}
          />
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">
            Pending Updates
          </h2>
          <p className="text-sm text-gray-500 mb-5">
            Freshness, suggested changes, and embedding coverage.
          </p>

          <div className="mb-6">
            <h3 className="text-sm font-medium text-gray-700 mb-3">
              Contact Freshness
            </h3>
            <StaleContactsBar
              people={freshnessPeople}
              onRefresh={onReloadData}
              onAskAI={onAskAI}
              onMarkCurrent={onMarkCurrent}
              aiLoading={aiLoading}
              aiLoadingIds={aiLoadingIds}
              noUpdateIds={noUpdateIds}
              onTierClick={toggleFreshnessTier}
              activeTier={crossFilters.freshnessTier}
            />
          </div>

          <div>
            <h3 className="text-sm font-medium text-gray-700 mb-3">
              Suggested Profile Changes
            </h3>
            <SuggestedChanges
              suggestions={suggestions.filter((suggestion) =>
                filteredPeopleIds.has(suggestion.person_id)
              )}
              onRefresh={onSuggestionsRefresh}
            />
          </div>

          <div className="mt-6 pt-6 border-t border-gray-100">
            <h3 className="text-sm font-medium text-gray-700 mb-3">
              Embedding Search Index
            </h3>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
              <button
                type="button"
                onClick={onBackfillEmbeddings}
                disabled={embeddingRunning}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors disabled:opacity-50"
              >
                {embeddingRunning ? 'Generating...' : 'Generate Embeddings'}
              </button>
              {embeddingProgress && (
                <div className="flex-1 max-w-xs">
                  <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                    <span>Progress</span>
                    <span>
                      {embeddingProgress.processed} / {embeddingProgress.total}
                    </span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                    <div
                      className="bg-teal-500 h-2 rounded-full transition-all duration-500"
                      style={{
                        width: `${
                          embeddingProgress.total > 0
                            ? (embeddingProgress.processed /
                                embeddingProgress.total) *
                              100
                            : 0
                        }%`,
                      }}
                    />
                  </div>
                </div>
              )}
              {embeddingProgress &&
                !embeddingRunning &&
                embeddingProgress.processed > 0 && (
                  <span className="text-xs text-green-600 font-medium">
                    {embeddingProgress.processed} profiles indexed
                  </span>
                )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
