import { ArrowUpRight, RotateCcw, X } from 'lucide-react';

interface FilterChip {
  key: string;
  label: string;
  onRemove: () => void;
}

interface CrossFilterBarProps {
  chips: FilterChip[];
  filteredCount: number;
  totalCount: number;
  canViewInNetwork: boolean;
  onViewInNetwork: () => void;
  onClearAll: () => void;
}

export default function CrossFilterBar({
  chips,
  filteredCount,
  totalCount,
  canViewInNetwork,
  onViewInNetwork,
  onClearAll,
}: CrossFilterBarProps) {
  if (chips.length === 0) return null;

  return (
    <div className="mb-8 rounded-xl border border-teal-100 bg-teal-50/70 p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-sm font-medium text-teal-900">
            {chips.length} active filter{chips.length === 1 ? '' : 's'} · {filteredCount} of{' '}
            {totalCount} people match
          </p>
          <div className="flex flex-wrap gap-2 mt-3">
            {chips.map((chip) => (
              <span
                key={chip.key}
                className="inline-flex items-center gap-1 rounded-full border border-teal-200 bg-white px-3 py-1 text-sm text-teal-900"
              >
                {chip.label}
                <button
                  type="button"
                  onClick={chip.onRemove}
                  className="rounded-full p-0.5 text-teal-600 hover:bg-teal-100"
                  aria-label={`Remove ${chip.label} filter`}
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClearAll}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
            Clear All
          </button>
          <button
            type="button"
            onClick={onViewInNetwork}
            disabled={!canViewInNetwork}
            className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-3 py-2 text-sm font-medium text-white hover:bg-teal-700 transition-colors disabled:bg-teal-300 disabled:cursor-not-allowed"
            title={
              canViewInNetwork
                ? 'Open the main network view with supported filters applied'
                : 'Only sector, occupation, flemish connection, and city filters can be sent to the network view'
            }
          >
            <ArrowUpRight className="w-4 h-4" />
            View in Network
          </button>
        </div>
      </div>
    </div>
  );
}
