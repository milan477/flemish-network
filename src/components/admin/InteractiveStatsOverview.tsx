import { useCallback, useMemo, useState } from 'react';
import { Building2, MapPin, Users } from 'lucide-react';
import { type FilterPreset, type Person } from '../../lib/supabase';
import { personHasFlemishConnection } from '../../lib/flemishConnections';
import OccupationOverview from './OccupationOverview';
import { classifyPerson } from './occupationCategories';
import InteractiveBarChart, {
  type InteractiveBarChartItem,
} from './InteractiveBarChart';
import CrossFilterBar from './CrossFilterBar';
import FlemishConnectionChart from './FlemishConnectionChart';
import {
  buildNetworkPreset,
  EMPTY_CROSS_FILTERS,
  type CrossFilterState,
  type PersonSectorRow,
} from './interactiveStatsShared';

interface InteractiveStatsOverviewProps {
  people: Person[];
  orgCount: number;
  personSectors: PersonSectorRow[];
  onNavigate: (page: string, id?: string, preset?: FilterPreset) => void;
}

type ExcludedDimension =
  | 'sector'
  | 'occupationCategory'
  | 'flemishConnection'
  | 'location'
  | 'availability'
  | null;

const SECTOR_COLORS: Record<string, string> = {
  'Artificial Intelligence': 'bg-blue-500',
  Biotechnology: 'bg-green-500',
  Finance: 'bg-amber-500',
  Education: 'bg-yellow-500',
  'Culture & Arts': 'bg-pink-500',
  Research: 'bg-cyan-500',
};

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
  rankedCityItems: InteractiveBarChartItem[];
  activeCityKey: string | null;
  onRankedCityClick: (cityKey: string) => void;
  onViewCity: (cityKey: string) => void;
}

function LocationExplorer({
  rankedCityItems,
  activeCityKey,
  onRankedCityClick,
  onViewCity,
}: LocationExplorerProps) {
  const maxCity = Math.max(
    1,
    ...rankedCityItems.map((item) => Math.max(item.count, item.totalCount ?? item.count))
  );

  return (
    <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100 h-[34rem] flex flex-col">
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-gray-900">Locations</h2>
      </div>

      {rankedCityItems.length === 0 ? (
        <p className="flex-1 flex items-center justify-center text-sm text-gray-400 text-center py-6">
          No city data available.
        </p>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-2.5">
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
    </div>
  );
}

export default function InteractiveStatsOverview({
  people,
  orgCount,
  personSectors,
  onNavigate,
}: InteractiveStatsOverviewProps) {
  const [crossFilters, setCrossFilters] =
    useState<CrossFilterState>(EMPTY_CROSS_FILTERS);

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
          !personHasFlemishConnection(person, crossFilters.flemishConnection)
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
          excludeDimension !== 'availability' &&
          crossFilters.availability.length > 0
        ) {
          for (const key of crossFilters.availability) {
            if (key === 'lectures' && !person.available_for_lectures) return false;
            if (key === 'mentorship' && !person.open_to_mentorship) return false;
            if (key === 'visits' && !person.welcomes_visits) return false;
          }
        }

        return true;
      }),
    [crossFilters, personToSectorsMap]
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
  const hasActiveFilters = useMemo(
    () =>
      Boolean(
        crossFilters.sector ||
          crossFilters.occupationCategory ||
          crossFilters.flemishConnection ||
          crossFilters.state ||
          crossFilters.city ||
          crossFilters.availability.length > 0
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
  const filteredOrganizations = new Set(
    filteredPeople
      .map((person) => person.organization_id)
      .filter((value): value is string => Boolean(value))
  ).size;
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
          listClassName="max-h-[23rem] overflow-y-auto pr-1"
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
          rankedCityItems={rankedCityItems}
          activeCityKey={activeCityKey}
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

      </div>
    </>
  );
}
