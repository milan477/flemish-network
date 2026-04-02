import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Loader2,
  Check,
} from 'lucide-react';
import { displayName, type Person } from '../../lib/supabase';
import {
  FRESHNESS_TIER_LABELS,
  getFreshnessTier,
  type FreshnessTier,
} from './interactiveStatsShared';

interface StaleContactsBarProps {
  people: Person[];
  onRefresh: () => void;
  onAskAI: (personIds: string[]) => Promise<void>;
  onMarkCurrent: (personId: string) => Promise<void>;
  aiLoading: boolean;
  aiLoadingIds: Set<string>;
  noUpdateIds: Set<string>;
  onTierClick?: (tier: FreshnessTier) => void;
  activeTier?: FreshnessTier | null;
}

function daysSince(dateStr: string): number {
  return Math.floor(
    (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24)
  );
}

interface FreshnessGroup {
  key: FreshnessTier;
  label: string;
  barColor: string;
  icon: typeof CheckCircle2;
  items: Person[];
}

export default function StaleContactsBar({
  people,
  onAskAI,
  onMarkCurrent,
  aiLoading,
  aiLoadingIds,
  noUpdateIds,
  onTierClick,
  activeTier = null,
}: StaleContactsBarProps) {
  const [expanded, setExpanded] = useState(false);
  const [markingId, setMarkingId] = useState<string | null>(null);

  const fresh: Person[] = [];
  const aging: Person[] = [];
  const stale: Person[] = [];
  const outdated: Person[] = [];

  people.forEach((p) => {
    const tier = getFreshnessTier(p);
    if (tier === 'fresh') fresh.push(p);
    else if (tier === 'aging') aging.push(p);
    else if (tier === 'stale') stale.push(p);
    else outdated.push(p);
  });

  const total = people.length || 1;
  const needsAttention = aging.length + stale.length + outdated.length;

  const groups: FreshnessGroup[] = [
    { key: 'fresh', label: FRESHNESS_TIER_LABELS.fresh, barColor: 'bg-green-500', icon: CheckCircle2, items: fresh },
    { key: 'aging', label: FRESHNESS_TIER_LABELS.aging, barColor: 'bg-yellow-400', icon: Clock, items: aging },
    { key: 'stale', label: FRESHNESS_TIER_LABELS.stale, barColor: 'bg-orange-400', icon: AlertTriangle, items: stale },
    { key: 'outdated', label: FRESHNESS_TIER_LABELS.outdated, barColor: 'bg-red-500', icon: AlertTriangle, items: outdated },
  ];

  const staleList = [...aging, ...stale, ...outdated].sort(
    (a, b) =>
      new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime()
  );

  const handleCheckAll = () => {
    const ids = staleList.map((p) => p.id);
    onAskAI(ids);
  };

  const handleConfirmCurrent = async (personId: string) => {
    setMarkingId(personId);
    await onMarkCurrent(personId);
    setMarkingId(null);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-gray-500">
          {needsAttention > 0
            ? `${needsAttention} contact${needsAttention > 1 ? 's' : ''} may need updating`
            : 'All contacts are up to date'}
        </p>
        <div className="flex items-center space-x-2">
          {needsAttention > 0 && (
            <>
              <button
                onClick={handleCheckAll}
                disabled={aiLoading}
                className="flex items-center space-x-1.5 text-xs font-medium text-teal-700 bg-teal-50 hover:bg-teal-100 px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50"
              >
                {aiLoading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5" />
                )}
                <span>Queue Verification</span>
              </button>
              <button
                onClick={() => setExpanded(!expanded)}
                className="flex items-center space-x-1.5 text-xs font-medium text-yellow-700 bg-yellow-50 hover:bg-yellow-100 px-2.5 py-1.5 rounded-lg transition-colors"
              >
                <span>Review</span>
                {expanded ? (
                  <ChevronUp className="w-3.5 h-3.5" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" />
                )}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="flex h-3 rounded-full overflow-hidden bg-gray-100 mb-2.5">
        {groups.map(
          (g) =>
            g.items.length > 0 && (
              <button
                key={g.label}
                type="button"
                onClick={() => onTierClick?.(g.key)}
                className={`${g.barColor} transition-all duration-500 ${
                  activeTier === g.key ? 'ring-2 ring-inset ring-white/80' : ''
                }`}
                style={{ width: `${(g.items.length / total) * 100}%` }}
                title={`${g.label}: ${g.items.length}`}
              />
            )
        )}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {groups.map((g) => (
          <button
            key={g.label}
            type="button"
            onClick={() => onTierClick?.(g.key)}
            className={`flex items-center space-x-1.5 rounded-full px-2 py-1 transition-colors ${
              activeTier === g.key ? 'bg-gray-100' : 'hover:bg-gray-50'
            }`}
          >
            <div className={`w-2 h-2 rounded-full ${g.barColor}`} />
            <span className="text-xs text-gray-600">
              {g.label}:{' '}
              <span className="font-semibold">{g.items.length}</span>
            </span>
          </button>
        ))}
      </div>

      {expanded && staleList.length > 0 && (
        <div className="mt-4 border border-gray-100 rounded-lg max-h-56 overflow-y-auto">
          <div className="divide-y divide-gray-50">
            {staleList.map((person) => {
              const days = daysSince(person.updated_at);
              const isChecking = aiLoadingIds.has(person.id);
              const hasNoUpdates = noUpdateIds.has(person.id);
              const isMarking = markingId === person.id;
              return (
                <div
                  key={person.id}
                  className={`flex items-center justify-between px-4 py-2.5 transition-colors ${
                    hasNoUpdates
                      ? 'bg-green-50/50'
                      : 'hover:bg-gray-50'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {displayName(person)}
                    </p>
                    <p className="text-xs text-gray-500 truncate">
                      {person.current_position || 'No position'}
                      {person.locations?.city &&
                        ` · ${person.locations?.city}, ${person.locations?.state}`}
                    </p>
                    {hasNoUpdates && (
                      <p className="text-xs text-green-600 mt-0.5 font-medium">
                        AI found no updates needed
                      </p>
                    )}
                  </div>
                  <div className="flex items-center space-x-2 flex-shrink-0 ml-4">
                    <span
                      className={`text-xs font-medium ${
                        days > 365
                          ? 'text-red-600'
                          : days > 90
                            ? 'text-orange-600'
                            : 'text-yellow-600'
                      }`}
                    >
                      {days}d ago
                    </span>
                    {hasNoUpdates ? (
                      <button
                        onClick={() => handleConfirmCurrent(person.id)}
                        disabled={isMarking}
                        className="flex items-center space-x-1 text-xs font-medium text-green-700 bg-green-100 hover:bg-green-200 px-2.5 py-1.5 rounded-md transition-colors disabled:opacity-50"
                      >
                        {isMarking ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Check className="w-3 h-3" />
                        )}
                        <span>Confirm Current</span>
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={() => onAskAI([person.id])}
                          disabled={aiLoading}
                          className="flex items-center space-x-1 text-xs font-medium text-teal-700 bg-teal-50 hover:bg-teal-100 px-2 py-1 rounded-md transition-colors disabled:opacity-50"
                        >
                          {isChecking ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Sparkles className="w-3 h-3" />
                          )}
                          <span>Verify</span>
                        </button>
                        <button
                          onClick={() => handleConfirmCurrent(person.id)}
                          disabled={isMarking}
                          className="flex items-center space-x-1 text-xs font-medium text-green-700 bg-green-50 hover:bg-green-100 px-2 py-1 rounded-md transition-colors disabled:opacity-50"
                        >
                          {isMarking ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Check className="w-3 h-3" />
                          )}
                          <span>Mark Current</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
