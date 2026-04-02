import { useCallback, useEffect, useState } from 'react';
import {
  ArrowRight,
  Building2,
  Loader2,
  Map,
  RefreshCw,
  Sparkles,
  Target,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface CoverageSummary {
  frontier_size?: number | null;
  queued_urls?: number | null;
  due_for_revisit_urls?: number | null;
  high_yield_domains?: number | null;
  avg_evidence_count_per_candidate?: number | string | null;
  frontier_refill_events_30d?: number | null;
}

interface CoverageGap {
  geography_key: string;
  geography_type: 'state' | 'metro';
  label: string;
  sector_emphasis?: string[] | null;
  gap_score?: number | null;
  approved_people_count?: number | null;
  pending_discovered_count?: number | null;
  verified_people_count?: number | null;
  recent_activity_30d?: number | null;
  expected_coverage_score?: number | null;
}

interface EntityPivot {
  entity_key: string;
  entity_name: string;
  entity_type: string;
  approved_contact_count: number;
  strong_source_count: number;
  seeded_frontier_count: number;
  priority_score?: number | null;
}

interface RecommendedAction {
  id: string;
  action_type: 'entity_pivot' | 'gap_refresh' | 'domain_revisit';
  title: string;
  detail: string;
  query: string;
  priority_score: number;
}

interface PlannerPayload {
  generated_at: string;
  coverage_summary: CoverageSummary | null;
  top_undercovered_metros: CoverageGap[];
  priority_states: CoverageGap[];
  top_entity_pivots: EntityPivot[];
  recent_refills: Array<{
    created_at: string | null;
    refill_reason: string;
    seeded_count: number;
  }>;
  recommended_actions: RecommendedAction[];
}

interface DiscoveryPlanningPanelProps {
  onRunDiscovery: (query: string) => void;
  isRunning: boolean;
}

interface ScrollablePlanningCardProps {
  icon: typeof Target;
  iconClassName: string;
  title: string;
  children: React.ReactNode;
}

function formatNumber(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return '0';
  const asNumber = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(asNumber)) return '0';
  return asNumber.toLocaleString();
}

function formatScore(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return '0.00';
  const asNumber = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(asNumber)) return '0.00';
  return asNumber.toFixed(2);
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function ScrollablePlanningCard({
  icon: Icon,
  iconClassName,
  title,
  children,
}: ScrollablePlanningCardProps) {
  return (
    <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100 h-[25rem] flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 mb-4 flex-shrink-0">
        <Icon className={`w-4 h-4 ${iconClassName}`} />
        <h3 className="text-base font-semibold text-gray-900">{title}</h3>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto pr-1">{children}</div>
    </div>
  );
}

export default function DiscoveryPlanningPanel({
  onRunDiscovery,
  isRunning,
}: DiscoveryPlanningPanelProps) {
  const [payload, setPayload] = useState<PlannerPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadPlanning = useCallback(async () => {
    setLoading(true);
    setError(null);

    const { data, error: invokeError } = await supabase.functions.invoke(
      'agent-scheduler',
      {
        body: { action: 'planning' },
      }
    );

    if (invokeError) {
      setError(invokeError.message);
      setLoading(false);
      return;
    }

    setPayload((data?.planning || null) as PlannerPayload | null);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadPlanning();
  }, [loadPlanning]);

  if (loading) {
    return (
      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100 flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-teal-600" />
      </div>
    );
  }

  if (error || !payload) {
    return (
      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-gray-900">
              Discovery Planning
            </h3>
            <p className="text-xs text-red-500 mt-1">
              {error || 'Planning data is unavailable.'}
            </p>
          </div>
          <button
            onClick={loadPlanning}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        </div>
      </div>
    );
  }

  const summary = payload.coverage_summary;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h3 className="text-base font-semibold text-gray-900">
              Discovery Planning
            </h3>
            <p className="text-xs text-gray-500 mt-1">
              Coverage gaps, compounding pivots, and recommended next runs.
            </p>
          </div>
          <button
            onClick={loadPlanning}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="rounded-lg bg-teal-50 p-3">
            <p className="text-[11px] uppercase tracking-wide text-teal-600 font-medium">
              Frontier
            </p>
            <p className="text-xl font-semibold text-teal-900 mt-1">
              {formatNumber(summary?.frontier_size)}
            </p>
          </div>
          <div className="rounded-lg bg-blue-50 p-3">
            <p className="text-[11px] uppercase tracking-wide text-blue-600 font-medium">
              Queued
            </p>
            <p className="text-xl font-semibold text-blue-900 mt-1">
              {formatNumber(summary?.queued_urls)}
            </p>
          </div>
          <div className="rounded-lg bg-amber-50 p-3">
            <p className="text-[11px] uppercase tracking-wide text-amber-600 font-medium">
              Due Revisit
            </p>
            <p className="text-xl font-semibold text-amber-900 mt-1">
              {formatNumber(summary?.due_for_revisit_urls)}
            </p>
          </div>
          <div className="rounded-lg bg-violet-50 p-3">
            <p className="text-[11px] uppercase tracking-wide text-violet-600 font-medium">
              High Yield
            </p>
            <p className="text-xl font-semibold text-violet-900 mt-1">
              {formatNumber(summary?.high_yield_domains)}
            </p>
          </div>
          <div className="rounded-lg bg-emerald-50 p-3">
            <p className="text-[11px] uppercase tracking-wide text-emerald-600 font-medium">
              Avg Evidence
            </p>
            <p className="text-xl font-semibold text-emerald-900 mt-1">
              {formatScore(summary?.avg_evidence_count_per_candidate)}
            </p>
          </div>
          <div className="rounded-lg bg-slate-50 p-3">
            <p className="text-[11px] uppercase tracking-wide text-slate-600 font-medium">
              Refills 30d
            </p>
            <p className="text-xl font-semibold text-slate-900 mt-1">
              {formatNumber(summary?.frontier_refill_events_30d)}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <ScrollablePlanningCard
          icon={Target}
          iconClassName="text-amber-600"
          title="Top Undercovered Metros"
        >
          <div className="space-y-2.5">
            {payload.top_undercovered_metros.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">
                No undercovered metros yet.
              </p>
            ) : (
              payload.top_undercovered_metros.map((gap) => (
                <div
                  key={gap.geography_key}
                  className="rounded-lg border border-gray-100 px-3.5 py-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900">
                        {gap.label}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5 break-words">
                        {gap.sector_emphasis?.join(', ') || 'General coverage'}
                      </p>
                    </div>
                    <span className="text-xs font-medium px-2 py-1 rounded bg-amber-50 text-amber-700 flex-shrink-0">
                      Gap {formatScore(gap.gap_score)}
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-2 mt-3 text-[11px] text-gray-500">
                    <div>
                      <p className="text-gray-400">Approved</p>
                      <p className="text-gray-900 font-medium">
                        {formatNumber(gap.approved_people_count)}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-400">Pending</p>
                      <p className="text-gray-900 font-medium">
                        {formatNumber(gap.pending_discovered_count)}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-400">Verified</p>
                      <p className="text-gray-900 font-medium">
                        {formatNumber(gap.verified_people_count)}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-400">Activity 30d</p>
                      <p className="text-gray-900 font-medium">
                        {formatNumber(gap.recent_activity_30d)}
                      </p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </ScrollablePlanningCard>

        <ScrollablePlanningCard
          icon={Map}
          iconClassName="text-blue-600"
          title="Priority States"
        >
          <div className="space-y-2.5">
            {payload.priority_states.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">
                No priority states yet.
              </p>
            ) : (
              payload.priority_states.map((gap) => (
                <div
                  key={gap.geography_key}
                  className="rounded-lg border border-gray-100 px-3.5 py-3 flex items-start justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900">
                      {gap.label}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5 break-words">
                      Expected {formatScore(gap.expected_coverage_score)} / Recent{' '}
                      {formatNumber(gap.recent_activity_30d)}
                    </p>
                  </div>
                  <span className="text-xs font-medium px-2 py-1 rounded bg-blue-50 text-blue-700 flex-shrink-0">
                    Gap {formatScore(gap.gap_score)}
                  </span>
                </div>
              ))
            )}
          </div>
        </ScrollablePlanningCard>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <ScrollablePlanningCard
          icon={Sparkles}
          iconClassName="text-violet-600"
          title="Entity Pivots"
        >
          <div className="space-y-2.5">
            {payload.top_entity_pivots.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">
                No pivot entities have been accumulated yet.
              </p>
            ) : (
              payload.top_entity_pivots.map((pivot) => (
                <div
                  key={pivot.entity_key}
                  className="rounded-lg border border-gray-100 px-3.5 py-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900">
                        {pivot.entity_name}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5 capitalize">
                        {pivot.entity_type.replace('_', ' ')}
                      </p>
                    </div>
                    <span className="text-xs font-medium px-2 py-1 rounded bg-violet-50 text-violet-700 flex-shrink-0">
                      {formatScore(pivot.priority_score)}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 mt-3 text-[11px] text-gray-500">
                    <div>
                      <p className="text-gray-400">Approved</p>
                      <p className="text-gray-900 font-medium">
                        {formatNumber(pivot.approved_contact_count)}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-400">Strong Sources</p>
                      <p className="text-gray-900 font-medium">
                        {formatNumber(pivot.strong_source_count)}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-400">Seeds Used</p>
                      <p className="text-gray-900 font-medium">
                        {formatNumber(pivot.seeded_frontier_count)}
                      </p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </ScrollablePlanningCard>

        <ScrollablePlanningCard
          icon={Building2}
          iconClassName="text-teal-600"
          title="Recent Frontier Refills"
        >
          <div className="space-y-2.5">
            {payload.recent_refills.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">
                No refill history yet.
              </p>
            ) : (
              payload.recent_refills.map((refill, index) => (
                <div
                  key={`${refill.refill_reason}-${refill.created_at || index}`}
                  className="rounded-lg border border-gray-100 px-3.5 py-3 flex items-start justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 capitalize">
                      {refill.refill_reason.replace(/_/g, ' ')}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {formatDate(refill.created_at)}
                    </p>
                  </div>
                  <span className="text-xs font-medium px-2 py-1 rounded bg-teal-50 text-teal-700 flex-shrink-0">
                    {formatNumber(refill.seeded_count)} seeded
                  </span>
                </div>
              ))
            )}
          </div>
        </ScrollablePlanningCard>
      </div>

      <ScrollablePlanningCard
        icon={Target}
        iconClassName="text-gray-700"
        title="Recommended Next Actions"
      >
        <div className="space-y-2.5">
          {payload.recommended_actions.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">
              No recommended actions right now.
            </p>
          ) : (
            payload.recommended_actions.map((action) => (
              <div
                key={action.id}
                className="rounded-lg border border-gray-100 px-3.5 py-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-gray-900">
                        {action.title}
                      </p>
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 uppercase tracking-wide">
                        {action.action_type.replace('_', ' ')}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">{action.detail}</p>
                    <p className="text-[11px] text-gray-700 bg-gray-50 rounded-md px-2.5 py-2 mt-2.5 break-words">
                      {action.query}
                    </p>
                  </div>
                  <button
                    onClick={() => onRunDiscovery(action.query)}
                    disabled={isRunning}
                    className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 flex-shrink-0"
                  >
                    {isRunning ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <ArrowRight className="w-3.5 h-3.5" />
                    )}
                    Run
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </ScrollablePlanningCard>
    </div>
  );
}
