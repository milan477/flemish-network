import type { Person } from '../../lib/supabase';
import {
  COMPLETENESS_FIELD_LABELS,
  type CompletenessField,
} from './interactiveStatsShared';

interface DataQualityChartProps {
  people: Person[];
  activeFilter: { field: CompletenessField; has: boolean } | null;
  onFilterChange: (
    next: { field: CompletenessField; has: boolean } | null
  ) => void;
  hasField: (person: Person, field: CompletenessField) => boolean;
}

const FIELDS = Object.keys(COMPLETENESS_FIELD_LABELS) as CompletenessField[];

export default function DataQualityChart({
  people,
  activeFilter,
  onFilterChange,
  hasField,
}: DataQualityChartProps) {
  const total = people.length;

  return (
    <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100 h-[34rem] flex flex-col">
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-gray-900">Data Quality</h2>
      </div>

      {total === 0 ? (
        <p className="flex-1 flex items-center justify-center text-sm text-gray-400 text-center py-6">
          No people match the current filters.
        </p>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-4">
          {FIELDS.map((field) => {
            const label = COMPLETENESS_FIELD_LABELS[field];
            const completeCount = people.filter((person) => hasField(person, field)).length;
            const missingCount = total - completeCount;
            const percent = Math.round((completeCount / total) * 100);
            const hasActive = activeFilter?.field === field && activeFilter.has;
            const missingActive = activeFilter?.field === field && !activeFilter.has;

            return (
              <div key={field}>
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="text-sm font-medium text-gray-800">{label}</p>
                    <p className="text-xs text-gray-500">
                      {completeCount} of {total} complete
                    </p>
                  </div>
                  <span className="text-sm font-semibold text-gray-900">
                    {percent}%
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      onFilterChange(hasActive ? null : { field, has: true })
                    }
                    className={`flex-1 rounded-xl border px-3 py-3 text-left transition-all ${
                      hasActive
                        ? 'border-teal-300 ring-2 ring-teal-100 bg-teal-50/60'
                        : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs text-gray-500 mb-2">
                      <span>Has field</span>
                      <span>{completeCount}</span>
                    </div>
                    <div className="relative h-2.5 rounded-full bg-gray-100 overflow-hidden">
                      <div
                        className="absolute inset-y-0 left-0 rounded-full bg-emerald-500 transition-all duration-700"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      onFilterChange(
                        missingActive ? null : { field, has: false }
                      )
                    }
                    className={`rounded-xl border px-3 py-3 text-sm font-medium transition-all ${
                      missingActive
                        ? 'border-amber-300 ring-2 ring-amber-100 bg-amber-50 text-amber-900'
                        : 'border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    Missing {missingCount}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
