import { ArrowUpRight, type LucideIcon } from 'lucide-react';

export interface InteractiveBarChartItem {
  key: string;
  label: string;
  count: number;
  color: string;
  totalCount?: number;
  icon?: LucideIcon;
  iconClassName?: string;
}

interface InteractiveBarChartProps {
  title: string;
  items: InteractiveBarChartItem[];
  activeKey: string | null;
  onBarClick: (key: string) => void;
  onViewInNetwork?: (key: string) => void;
  emptyMessage?: string;
  listClassName?: string;
}

export default function InteractiveBarChart({
  title,
  items,
  activeKey,
  onBarClick,
  onViewInNetwork,
  emptyMessage = 'No data available.',
  listClassName,
}: InteractiveBarChartProps) {
  const maxValue = Math.max(
    1,
    ...items.map((item) => Math.max(item.count, item.totalCount ?? item.count))
  );

  return (
    <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-6">{emptyMessage}</p>
      ) : (
        <div className={`space-y-3 ${listClassName || ''}`}>
          {items.map((item) => {
            const Icon = item.icon;
            const isActive = activeKey === item.key;
            const totalCount = item.totalCount ?? item.count;
            const countLabel =
              totalCount !== item.count ? `${item.count} / ${totalCount}` : `${item.count}`;

            return (
              <div key={item.key} className="group flex items-stretch gap-2">
                <button
                  type="button"
                  onClick={() => onBarClick(item.key)}
                  className={`min-w-0 flex-1 overflow-hidden rounded-xl border px-3 py-3 text-left transition-all ${
                    isActive
                      ? 'border-teal-300 ring-2 ring-teal-100 bg-teal-50/60'
                      : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                  }`}
                  title={`${item.label}: ${item.count}`}
                >
                  <div className="mb-2 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 overflow-hidden">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      {Icon && (
                        <div
                          className={`w-7 h-7 rounded-md bg-gray-100 flex items-center justify-center flex-shrink-0 ${
                            item.iconClassName || 'text-gray-600'
                          }`}
                        >
                          <Icon className="w-4 h-4" />
                        </div>
                      )}
                      <span className="block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-sm font-medium text-gray-800">
                        {item.label}
                      </span>
                    </div>
                    <span className="text-sm font-semibold text-gray-900 flex-shrink-0">
                      {countLabel}
                    </span>
                  </div>

                  <div className="relative h-2.5 rounded-full bg-gray-100 overflow-hidden">
                    <div
                      className="absolute inset-y-0 left-0 rounded-full bg-gray-200"
                      style={{ width: `${(totalCount / maxValue) * 100}%` }}
                    />
                    <div
                      className={`absolute inset-y-0 left-0 rounded-full ${item.color} transition-all duration-700`}
                      style={{ width: `${(item.count / maxValue) * 100}%` }}
                    />
                  </div>
                </button>

                {onViewInNetwork && (
                  <button
                    type="button"
                    onClick={() => onViewInNetwork(item.key)}
                    className="w-10 rounded-xl border border-gray-200 text-gray-500 hover:text-teal-700 hover:border-teal-200 hover:bg-teal-50 transition-all opacity-0 group-hover:opacity-100 focus:opacity-100"
                    title={`View ${item.label} in network`}
                    aria-label={`View ${item.label} in network`}
                  >
                    <ArrowUpRight className="w-4 h-4 mx-auto" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
