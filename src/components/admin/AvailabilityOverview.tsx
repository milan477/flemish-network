import {
  GraduationCap,
  Handshake,
  MapPinned,
  type LucideIcon,
} from 'lucide-react';
import type { Person } from '../../lib/supabase';
import type { AvailabilityFilter } from './interactiveStatsShared';

interface AvailabilityOverviewProps {
  people: Person[];
  allPeople: Person[];
  activeFilters: AvailabilityFilter[];
  onToggle: (filter: AvailabilityFilter) => void;
}

interface AvailabilityItem {
  key: AvailabilityFilter;
  label: string;
  description: string;
  icon: LucideIcon;
  color: string;
  count: number;
  totalCount: number;
}

function countMatches(people: Person[], key: AvailabilityFilter): number {
  return people.filter((person) => {
    if (key === 'lectures') return Boolean(person.available_for_lectures);
    if (key === 'mentorship') return Boolean(person.open_to_mentorship);
    return Boolean(person.welcomes_visits);
  }).length;
}

export default function AvailabilityOverview({
  people,
  allPeople,
  activeFilters,
  onToggle,
}: AvailabilityOverviewProps) {
  const items: AvailabilityItem[] = [
    {
      key: 'lectures',
      label: 'Lectures',
      description: 'Available to speak',
      icon: GraduationCap,
      color: 'text-blue-700 bg-blue-50 border-blue-200',
      count: countMatches(people, 'lectures'),
      totalCount: countMatches(allPeople, 'lectures'),
    },
    {
      key: 'mentorship',
      label: 'Mentorship',
      description: 'Open to mentoring',
      icon: Handshake,
      color: 'text-emerald-700 bg-emerald-50 border-emerald-200',
      count: countMatches(people, 'mentorship'),
      totalCount: countMatches(allPeople, 'mentorship'),
    },
    {
      key: 'visits',
      label: 'Visits',
      description: 'Welcomes visits',
      icon: MapPinned,
      color: 'text-amber-700 bg-amber-50 border-amber-200',
      count: countMatches(people, 'visits'),
      totalCount: countMatches(allPeople, 'visits'),
    },
  ];

  return (
    <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-gray-900">Availability</h2>
        <p className="text-sm text-gray-500 mt-1">
          Selected pills stack with AND logic across the current subset.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3">
        {items.map((item) => {
          const Icon = item.icon;
          const isActive = activeFilters.includes(item.key);
          const countLabel =
            item.count === item.totalCount
              ? `${item.count}`
              : `${item.count} of ${item.totalCount}`;

          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onToggle(item.key)}
              className={`rounded-xl border p-4 text-left transition-all ${
                isActive
                  ? 'border-teal-300 ring-2 ring-teal-100 bg-teal-50/60'
                  : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div
                    className={`w-10 h-10 rounded-lg border flex items-center justify-center ${item.color}`}
                  >
                    <Icon className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {item.label}
                    </p>
                    <p className="text-xs text-gray-500">{item.description}</p>
                  </div>
                </div>
                <span className="text-sm font-semibold text-gray-900">
                  {countLabel}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
