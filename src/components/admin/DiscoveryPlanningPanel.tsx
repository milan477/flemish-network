import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  ExternalLink,
  Loader2,
  Map,
  RefreshCw,
  Sparkles,
  Target,
  BarChart3,
  Brain,
  Play,
  Globe,
  ShieldOff,
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

export interface RecommendedAction {
  id: string;
  action_type: 'entity_pivot' | 'gap_refresh' | 'domain_revisit';
  title: string;
  detail: string;
  query: string;
  priority_score: number;
  // Rubric fields (optional for backward compatibility with old server payloads)
  rationale?: string;
  basis?: {
    kind: 'coverage_gap' | 'entity_pivot' | 'proven_domain';
    key: string;
  };
  target?: {
    metro?: string;
    state?: string;
    sector?: string;
    domain?: string;
    entity?: string;
  };
  expected_yield?: 'high' | 'medium' | 'low';
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

interface ArmStatRow {
  surface: string;
  lens: string;
  surface_name: string | null;
  lens_name: string | null;
  attempts: number;
  candidates_extracted: number;
  new_pending_contacts: number;
  contacts_approved: number;
  approval_rate: number | null;
  not_flemish_rate: number | null;
  last_attempt_at: string | null;
  cooldown_until: string | null;
  arm_status: 'untried' | 'active' | 'no_yield' | 'cooling_down';
}

interface ReflectionSuggestion {
  id: string;
  surface: string | null;
  lens: string | null;
  context_key: string;
  rationale: string;
  population_summary: PopulationSummary | null;
  generated_at: string;
  consumed_attempt_count: number;
  expires_at: string;
}

interface PopulationSummary {
  total_approved: number;
  by_sector: Array<{ sector: string; count: number }>;
  by_state: Array<{ state: string; count: number }>;
  by_employer: Array<{ employer: string; count: number }>;
  career_stage_distribution: Array<{ stage: string; count: number }>;
  recent_rejections_by_reason: Array<{ reason: string; count: number }>;
  generated_at: string;
}

interface SeedDomainRow {
  id: string;
  domain: string;
  reputation_score: number;
  total_candidates_extracted: number;
  total_approved_contacts: number;
  manually_blocked: boolean;
  active: boolean;
  reputation_recompute_at: string | null;
}

interface DiscoveryPlanningPanelProps {
  onRunDiscovery: (action: RecommendedAction) => void;
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

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function ArmStatusBadge({ status }: { status: ArmStatRow['arm_status'] }) {
  if (status === 'cooling_down') {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-orange-50 text-orange-700 border border-orange-100">
        cooling
      </span>
    );
  }
  if (status === 'untried') {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-50 text-gray-500 border border-gray-200">
        untried
      </span>
    );
  }
  if (status === 'no_yield') {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-50 text-red-600 border border-red-100">
        no yield
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-50 text-green-700 border border-green-100">
      active
    </span>
  );
}

export default function DiscoveryPlanningPanel({
  onRunDiscovery,
  isRunning,
}: DiscoveryPlanningPanelProps) {
  const navigate = useNavigate();
  const [payload, setPayload] = useState<PlannerPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [usedActionIds, setUsedActionIds] = useState<Set<string>>(new Set());
  const [armStats, setArmStats] = useState<ArmStatRow[]>([]);
  const [armStatsLoading, setArmStatsLoading] = useState(false);

  // Domain reputation state
  const [seedDomains, setSeedDomains] = useState<SeedDomainRow[]>([]);
  const [seedDomainsLoading, setSeedDomainsLoading] = useState(false);
  const [seedDomainsSortBy, setSeedDomainsSortBy] = useState<'reputation_score' | 'total_approved_contacts' | 'domain'>('reputation_score');
  const [domainBlockInProgress, setDomainBlockInProgress] = useState<Set<string>>(new Set());

  // Reflection state
  const [reflectionSuggestions, setReflectionSuggestions] = useState<ReflectionSuggestion[]>([]);
  const [reflectionLoading, setReflectionLoading] = useState(false);
  const [reflectionRunning, setReflectionRunning] = useState(false);
  const [reflectionError, setReflectionError] = useState<string | null>(null);
  const [latestPopulationSummary, setLatestPopulationSummary] = useState<PopulationSummary | null>(null);

  const loadReflection = useCallback(async () => {
    setReflectionLoading(true);
    setReflectionError(null);
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('discovery_reflection_suggestions')
      .select('id,surface,lens,context_key,rationale,population_summary,generated_at,consumed_attempt_count,expires_at')
      .gt('expires_at', now)
      .order('generated_at', { ascending: false })
      .limit(20);
    if (error) {
      setReflectionError(error.message);
    } else {
      const rows = (data || []) as ReflectionSuggestion[];
      setReflectionSuggestions(rows);
      // Use population_summary from the most recent row as the latest summary.
      const latest = rows[0]?.population_summary ?? null;
      setLatestPopulationSummary(latest);
    }
    setReflectionLoading(false);
  }, []);

  const runReflectionNow = useCallback(async () => {
    setReflectionRunning(true);
    setReflectionError(null);
    const { data, error } = await supabase.functions.invoke('agent-discovery-reflect', {
      body: {},
    });
    if (error) {
      setReflectionError(error.message);
    } else if (data?.status === 'ok') {
      // Reload suggestions after a successful run.
      await loadReflection();
    } else {
      setReflectionError(data?.message || 'Reflection run returned an unexpected response');
    }
    setReflectionRunning(false);
  }, [loadReflection]);

  const loadArmStats = useCallback(async () => {
    setArmStatsLoading(true);
    const { data } = await supabase
      .from('discovery_arm_stats_recent')
      .select('surface,lens,surface_name,lens_name,attempts,candidates_extracted,new_pending_contacts,contacts_approved,approval_rate,not_flemish_rate,last_attempt_at,cooldown_until,arm_status')
      .order('attempts', { ascending: false })
      .limit(100);
    setArmStats((data || []) as ArmStatRow[]);
    setArmStatsLoading(false);
  }, []);

  const loadSeedDomains = useCallback(async () => {
    setSeedDomainsLoading(true);
    const { data } = await supabase
      .from('discovery_seed_domains')
      .select('id,domain,reputation_score,total_candidates_extracted,total_approved_contacts,manually_blocked,active,reputation_recompute_at')
      .order('reputation_score', { ascending: false })
      .limit(200);
    setSeedDomains((data || []) as SeedDomainRow[]);
    setSeedDomainsLoading(false);
  }, []);

  const toggleDomainBlock = useCallback(async (id: string, currentlyBlocked: boolean) => {
    setDomainBlockInProgress((prev) => new Set(prev).add(id));
    const { error } = await supabase
      .from('discovery_seed_domains')
      .update({ manually_blocked: !currentlyBlocked })
      .eq('id', id);
    if (!error) {
      setSeedDomains((prev) =>
        prev.map((d) => (d.id === id ? { ...d, manually_blocked: !currentlyBlocked } : d)),
      );
    }
    setDomainBlockInProgress((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

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
    loadArmStats();
    loadReflection();
    loadSeedDomains();
  }, [loadPlanning, loadArmStats, loadReflection, loadSeedDomains]);

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

  return (
    <div className="space-y-6">
      {/* Section 1: Recommended next searches */}
      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h3 className="text-base font-semibold text-gray-900">
              Recommended next searches
            </h3>
            <p className="text-xs text-gray-500 mt-1">
              Highest-priority queries to run next based on coverage gaps and discovery signals.
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

        <div className="space-y-2.5">
          {payload.recommended_actions.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">
              No recommended searches right now.
            </p>
          ) : (
            payload.recommended_actions.map((action) => (
              <div
                key={action.id}
                className="rounded-lg border border-gray-100 px-3.5 py-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-gray-900">
                        {action.title}
                      </p>
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 uppercase tracking-wide">
                        {action.action_type.replace('_', ' ')}
                      </span>
                      {action.expected_yield === 'high' && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-green-100 text-green-700 uppercase tracking-wide">
                          high yield
                        </span>
                      )}
                      {action.expected_yield === 'medium' && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-700 uppercase tracking-wide">
                          medium yield
                        </span>
                      )}
                      {action.expected_yield === 'low' && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 uppercase tracking-wide">
                          low yield
                        </span>
                      )}
                    </div>
                    {action.rationale && (
                      <p className="text-xs text-gray-500 mt-1 italic">{action.rationale}</p>
                    )}
                    <p className="text-xs text-gray-500 mt-1">{action.detail}</p>
                    {(action.basis || (action.target && Object.values(action.target).some(Boolean))) && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {action.basis && (
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-700 border border-violet-100">
                            {action.basis.kind.replace('_', ' ')}
                          </span>
                        )}
                        {action.target?.metro && (
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-100">
                            {action.target.metro}
                          </span>
                        )}
                        {action.target?.state && (
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-100">
                            {action.target.state}
                          </span>
                        )}
                        {action.target?.sector && (
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-teal-50 text-teal-700 border border-teal-100">
                            {action.target.sector}
                          </span>
                        )}
                        {action.target?.domain && (
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-100">
                            {action.target.domain}
                          </span>
                        )}
                        {action.target?.entity && (
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-gray-50 text-gray-700 border border-gray-200">
                            {action.target.entity}
                          </span>
                        )}
                      </div>
                    )}
                    <p className="text-[11px] text-gray-700 bg-gray-50 rounded-md px-2.5 py-2 mt-2.5 break-words">
                      {action.query}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => navigate(`/admin/discovery?prompt=${encodeURIComponent(action.query)}`)}
                      title="Open in Discovery"
                      className="flex items-center gap-1.5 px-2.5 py-2 text-xs font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => {
                        setUsedActionIds((prev) => {
                          const next = new Set(prev);
                          next.add(action.id);
                          return next;
                        });
                        onRunDiscovery(action);
                      }}
                      disabled={isRunning || usedActionIds.has(action.id)}
                      className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
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
              </div>
            ))
          )}
        </div>
      </div>

      {/* Section 2: Where coverage is thin */}
      <div>
        <h3 className="text-base font-semibold text-gray-900 mb-3">
          Where coverage is thin
        </h3>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <ScrollablePlanningCard
            icon={Target}
            iconClassName="text-amber-600"
            title="Top undercovered metros"
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
            title="Priority states"
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
      </div>

      {/* Section 3: Promising pivots */}
      <div>
        <h3 className="text-base font-semibold text-gray-900 mb-3">
          Promising pivots
        </h3>
        <ScrollablePlanningCard
          icon={Sparkles}
          iconClassName="text-violet-600"
          title="Top entity pivots"
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
                      <p className="text-gray-400">Strong sources</p>
                      <p className="text-gray-900 font-medium">
                        {formatNumber(pivot.strong_source_count)}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-400">Seeds used</p>
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
      </div>

      {/* Section 4: Reflection loop */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold text-gray-900">Reflection</h3>
          <div className="flex items-center gap-2">
            <button
              onClick={loadReflection}
              className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${reflectionLoading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button
              onClick={runReflectionNow}
              disabled={reflectionRunning}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors disabled:opacity-50"
            >
              {reflectionRunning ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Play className="w-3.5 h-3.5" />
              )}
              Run Reflection Now
            </button>
          </div>
        </div>

        {reflectionError && (
          <p className="text-xs text-red-500 mb-3">{reflectionError}</p>
        )}

        {/* Population summary */}
        {latestPopulationSummary && (
          <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100 mb-4">
            <div className="flex items-center gap-2 mb-4">
              <Brain className="w-4 h-4 text-violet-600" />
              <p className="text-sm font-medium text-gray-800">
                Population snapshot
                <span className="ml-2 text-xs text-gray-400 font-normal">
                  {formatDate(latestPopulationSummary.generated_at)} · {latestPopulationSummary.total_approved} approved people
                </span>
              </p>
            </div>
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
              <div>
                <p className="text-xs font-medium text-gray-500 mb-2">Top sectors</p>
                <div className="space-y-1">
                  {latestPopulationSummary.by_sector.slice(0, 5).map(({ sector, count }) => (
                    <div key={sector} className="flex items-center justify-between text-xs">
                      <span className="text-gray-700 truncate">{sector}</span>
                      <span className="text-gray-400 ml-2 tabular-nums">{count}</span>
                    </div>
                  ))}
                  {latestPopulationSummary.by_sector.length === 0 && (
                    <p className="text-xs text-gray-400">No sector data</p>
                  )}
                </div>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500 mb-2">Top states</p>
                <div className="space-y-1">
                  {latestPopulationSummary.by_state.slice(0, 5).map(({ state, count }) => (
                    <div key={state} className="flex items-center justify-between text-xs">
                      <span className="text-gray-700 truncate">{state}</span>
                      <span className="text-gray-400 ml-2 tabular-nums">{count}</span>
                    </div>
                  ))}
                  {latestPopulationSummary.by_state.length === 0 && (
                    <p className="text-xs text-gray-400">No state data</p>
                  )}
                </div>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500 mb-2">Career stages</p>
                <div className="space-y-1">
                  {latestPopulationSummary.career_stage_distribution.slice(0, 5).map(({ stage, count }) => (
                    <div key={stage} className="flex items-center justify-between text-xs">
                      <span className="text-gray-700 capitalize">{stage}</span>
                      <span className="text-gray-400 ml-2 tabular-nums">{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Active reflection suggestions */}
        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <div className="flex items-center gap-2 mb-4">
            <Sparkles className="w-4 h-4 text-violet-600" />
            <p className="text-sm font-medium text-gray-800">Active exploration suggestions</p>
            <span className="text-xs text-gray-400 ml-auto">
              {reflectionSuggestions.length > 0
                ? `${reflectionSuggestions.length} active`
                : 'None yet'}
            </span>
          </div>
          {reflectionLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="w-5 h-5 animate-spin text-violet-600" />
            </div>
          ) : reflectionSuggestions.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">
              No active suggestions — click "Run Reflection Now" to generate.
            </p>
          ) : (
            <div className="space-y-2.5">
              {reflectionSuggestions.map((s) => (
                <div key={s.id} className="rounded-lg border border-gray-100 px-3.5 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap gap-1.5 mb-1.5">
                        {s.surface && (
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-teal-50 text-teal-700 border border-teal-100">
                            {s.surface}
                          </span>
                        )}
                        {s.lens && (
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-100">
                            {s.lens}
                          </span>
                        )}
                        {s.context_key && (
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-gray-50 text-gray-600 border border-gray-200">
                            {s.context_key}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-700">{s.rationale}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-[10px] text-gray-400">{formatDate(s.generated_at)}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">
                        used {s.consumed_attempt_count}×
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Section 5: Domain Reputation Leaderboard */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold text-gray-900">Domain Reputation</h3>
          <div className="flex items-center gap-2">
            <select
              value={seedDomainsSortBy}
              onChange={(e) => setSeedDomainsSortBy(e.target.value as typeof seedDomainsSortBy)}
              className="text-xs border border-gray-200 rounded-md px-2 py-1 text-gray-600 bg-white focus:outline-none focus:ring-1 focus:ring-teal-500"
            >
              <option value="reputation_score">Sort: Reputation</option>
              <option value="total_approved_contacts">Sort: Approved</option>
              <option value="domain">Sort: Domain</option>
            </select>
            <button
              onClick={loadSeedDomains}
              className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${seedDomainsLoading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>
        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <div className="flex items-center gap-2 mb-4">
            <Globe className="w-4 h-4 text-teal-600" />
            <p className="text-sm font-medium text-gray-800">Seed domain yield scores</p>
            <span className="text-xs text-gray-400 ml-auto">
              {seedDomains.length > 0
                ? `${seedDomains.filter((d) => !d.manually_blocked).length} active, ${seedDomains.filter((d) => d.manually_blocked).length} blocked`
                : 'Loading…'}
            </span>
          </div>
          {seedDomainsLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="w-5 h-5 animate-spin text-teal-600" />
            </div>
          ) : seedDomains.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">
              No seed domains found — apply the Phase 6 migration.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-2 pr-3 font-medium text-gray-500 whitespace-nowrap">Domain</th>
                    <th className="text-right py-2 pr-3 font-medium text-gray-500 whitespace-nowrap">Score</th>
                    <th className="text-right py-2 pr-3 font-medium text-gray-500 whitespace-nowrap">Candidates</th>
                    <th className="text-right py-2 pr-3 font-medium text-gray-500 whitespace-nowrap">Approved</th>
                    <th className="text-left py-2 pr-3 font-medium text-gray-500 whitespace-nowrap">Status</th>
                    <th className="text-left py-2 font-medium text-gray-500 whitespace-nowrap">Block</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {[...seedDomains]
                    .sort((a, b) => {
                      if (seedDomainsSortBy === 'reputation_score') {
                        return (b.reputation_score ?? 0) - (a.reputation_score ?? 0);
                      }
                      if (seedDomainsSortBy === 'total_approved_contacts') {
                        return (b.total_approved_contacts ?? 0) - (a.total_approved_contacts ?? 0);
                      }
                      return a.domain.localeCompare(b.domain);
                    })
                    .map((domain) => {
                      const score = domain.reputation_score ?? 0;
                      const scoreColor =
                        domain.manually_blocked
                          ? 'text-gray-400'
                          : score >= 0.5
                          ? 'text-green-700 font-semibold'
                          : score >= 0.1
                          ? 'text-yellow-700'
                          : 'text-red-600';
                      const isBlocking = domainBlockInProgress.has(domain.id);
                      return (
                        <tr
                          key={domain.id}
                          className={`hover:bg-gray-50 transition-colors ${domain.manually_blocked ? 'opacity-50' : ''}`}
                        >
                          <td className="py-2 pr-3 text-gray-700 font-mono text-[11px] whitespace-nowrap">
                            {domain.domain}
                          </td>
                          <td className={`py-2 pr-3 text-right tabular-nums ${scoreColor}`}>
                            {score.toFixed(3)}
                          </td>
                          <td className="py-2 pr-3 text-right text-gray-600 tabular-nums">
                            {domain.total_candidates_extracted ?? 0}
                          </td>
                          <td className="py-2 pr-3 text-right text-gray-600 tabular-nums">
                            {domain.total_approved_contacts ?? 0}
                          </td>
                          <td className="py-2 pr-3">
                            {domain.manually_blocked ? (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-50 text-red-700 border border-red-100">
                                blocked
                              </span>
                            ) : score >= 0.5 ? (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-50 text-green-700 border border-green-100">
                                high yield
                              </span>
                            ) : score >= 0.1 ? (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-yellow-50 text-yellow-700 border border-yellow-100">
                                moderate
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-50 text-gray-500 border border-gray-200">
                                low yield
                              </span>
                            )}
                          </td>
                          <td className="py-2">
                            <button
                              onClick={() => toggleDomainBlock(domain.id, domain.manually_blocked)}
                              disabled={isBlocking}
                              title={domain.manually_blocked ? 'Unblock domain' : 'Block domain'}
                              className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-colors disabled:opacity-50 ${
                                domain.manually_blocked
                                  ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                  : 'bg-red-50 text-red-600 hover:bg-red-100 border border-red-100'
                              }`}
                            >
                              {isBlocking ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <ShieldOff className="w-3 h-3" />
                              )}
                              {domain.manually_blocked ? 'Unblock' : 'Block'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Section 6: Bandit arm heatmap */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold text-gray-900">
            Bandit arm distribution
          </h3>
          <button
            onClick={loadArmStats}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${armStatsLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 className="w-4 h-4 text-teal-600" />
            <p className="text-sm font-medium text-gray-800">Surface × Lens arms</p>
            <span className="text-xs text-gray-400 ml-auto">
              {armStats.length > 0
                ? `${armStats.filter((r) => r.attempts > 0).length} active of ${armStats.length}`
                : 'No data yet'}
            </span>
          </div>
          {armStatsLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="w-5 h-5 animate-spin text-teal-600" />
            </div>
          ) : armStats.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">
              No arm data yet — run a discovery pass to populate.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-2 pr-3 font-medium text-gray-500 whitespace-nowrap">Surface</th>
                    <th className="text-left py-2 pr-3 font-medium text-gray-500 whitespace-nowrap">Lens</th>
                    <th className="text-right py-2 pr-3 font-medium text-gray-500 whitespace-nowrap">Tries</th>
                    <th className="text-right py-2 pr-3 font-medium text-gray-500 whitespace-nowrap">Approved</th>
                    <th className="text-right py-2 pr-3 font-medium text-gray-500 whitespace-nowrap">Approval %</th>
                    <th className="text-left py-2 pr-3 font-medium text-gray-500 whitespace-nowrap">Last try</th>
                    <th className="text-left py-2 font-medium text-gray-500 whitespace-nowrap">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {armStats.map((arm) => {
                    const approvalPct =
                      arm.approval_rate != null
                        ? `${(arm.approval_rate * 100).toFixed(0)}%`
                        : '—';
                    const rowClass =
                      arm.arm_status === 'cooling_down'
                        ? 'opacity-50'
                        : arm.arm_status === 'active'
                        ? ''
                        : '';
                    return (
                      <tr
                        key={`${arm.surface}|${arm.lens}`}
                        className={`${rowClass} hover:bg-gray-50 transition-colors`}
                      >
                        <td className="py-2 pr-3 text-gray-700 whitespace-nowrap">
                          {arm.surface_name ?? arm.surface}
                        </td>
                        <td className="py-2 pr-3 text-gray-500 whitespace-nowrap">
                          {arm.lens_name ?? arm.lens}
                        </td>
                        <td className="py-2 pr-3 text-right text-gray-700 tabular-nums">
                          {arm.attempts}
                        </td>
                        <td className="py-2 pr-3 text-right text-gray-700 tabular-nums">
                          {arm.contacts_approved}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          <span
                            className={
                              arm.contacts_approved > 0
                                ? 'text-green-700 font-medium'
                                : 'text-gray-400'
                            }
                          >
                            {approvalPct}
                          </span>
                        </td>
                        <td className="py-2 pr-3 text-gray-400 whitespace-nowrap">
                          {formatDate(arm.last_attempt_at)}
                        </td>
                        <td className="py-2">
                          <ArmStatusBadge status={arm.arm_status} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
