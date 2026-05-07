import React, { useEffect, useState, useCallback } from 'react';
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Search,
  RefreshCw,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { notifyError } from '../../lib/toast';
import StructuredErrorBanner from './StructuredErrorBanner';

interface AgentRun {
  id: string;
  agent_type: string;
  status: string;
  params: Record<string, unknown> | null;
  started_at: string | null;
  completed_at: string | null;
  results: Record<string, unknown> | null;
  error_message: string | null;
  error_kind: string | null;
  llm_calls_made: number;
  web_searches_made: number;
  web_search_provider: string | null;
  cost_estimate_usd: number;
  created_at: string;
}

interface ApiQuota {
  provider: string;
  month: string;
  calls_used: number;
  calls_limit: number;
}

const AGENT_LABELS: Record<string, { label: string; icon: typeof Search }> = {
  discovery: { label: 'Discovery', icon: Search },
};

function serviceLabelForRun(agentType: string): string {
  return AGENT_LABELS[agentType]?.label || 'Service run';
}

const STATUS_STYLES: Record<string, { bg: string; text: string; icon: typeof Clock }> = {
  pending: { bg: 'bg-gray-100', text: 'text-gray-600', icon: Clock },
  running: { bg: 'bg-blue-100', text: 'text-blue-700', icon: Loader2 },
  completed: { bg: 'bg-green-100', text: 'text-green-700', icon: CheckCircle2 },
  failed: { bg: 'bg-red-100', text: 'text-red-700', icon: XCircle },
};

export default function AgentDashboard() {
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [quotas, setQuotas] = useState<ApiQuota[]>([]);
  const [pendingSuggestions, setPendingSuggestions] = useState(0);
  const [loading, setLoading] = useState(true);
  const [triggerLoading, setTriggerLoading] = useState<string | null>(null);
  const [discoveryQuery, setDiscoveryQuery] = useState('');
  const [showQueryInput, setShowQueryInput] = useState(false);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const loadData = useCallback(async () => {
    await supabase.functions
      .invoke('agent-scheduler', {
        body: { action: 'housekeeping' },
      })
      .catch((err) => {
        // Housekeeping is best-effort; still show current run data if it fails,
        // but surface a console warning so a permanently-down scheduler is visible.
        console.warn('[AgentDashboard] housekeeping kick failed (non-fatal)', err);
      });

    const [runsRes, quotasRes, suggestionsRes] = await Promise.all([
      supabase
        .from('agent_runs')
        .select('*')
        .eq('agent_type', 'discovery')
        .order('created_at', { ascending: false })
        .limit(20),
      supabase
        .from('api_quotas')
        .select('*')
        .eq('month', new Date().toISOString().slice(0, 7)),
      supabase
        .from('discovered_contacts')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending'),
    ]);

    setRuns((runsRes.data || []) as AgentRun[]);
    setQuotas((quotasRes.data || []) as ApiQuota[]);
    setPendingSuggestions(suggestionsRes.count || 0);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Poll every 5s while any run is still "running" or "pending", and tick `now` every 1s for live timer
  useEffect(() => {
    const hasActiveRuns = runs.some((r) => r.status === 'running' || r.status === 'pending');
    if (!hasActiveRuns) return;
    const pollInterval = setInterval(loadData, 5000);
    const tickInterval = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(pollInterval);
      clearInterval(tickInterval);
    };
  }, [runs, loadData]);

  const triggerAgent = useCallback(
    async (agentType: string, params?: Record<string, unknown>) => {
      setTriggerLoading(agentType);
      try {
        const { error } = await supabase.functions.invoke('agent-scheduler', {
          body: {
            action: 'trigger',
            agent_type: agentType,
            params: params || {},
          },
        });

        if (error) {
          throw error;
        }
      } catch (err) {
        notifyError(err, { hint: 'Could not start discovery.' });
      }
      setTriggerLoading(null);
      await loadData();
    },
    [loadData]
  );

  const handleDiscoveryTrigger = useCallback(() => {
    const trimmedQuery = discoveryQuery.trim();
    triggerAgent('discovery', trimmedQuery ? { query: trimmedQuery } : {});
    setDiscoveryQuery('');
    setShowQueryInput(false);
  }, [discoveryQuery, triggerAgent]);

  const cancelRun = useCallback(
    async (runId: string) => {
      try {
        const { error } = await supabase.functions.invoke('agent-scheduler', {
          body: {
            action: 'cancel',
            run_id: runId,
          },
        });
        if (error) throw error;
        await loadData();
      } catch (err) {
        notifyError(err, { hint: 'Could not cancel this discovery run.' });
      }
    },
    [loadData]
  );

  const getQuota = (provider: string): ApiQuota | undefined =>
    quotas.find((q) => q.provider === provider);

  const formatDate = (date: string | null) => {
    if (!date) return '—';
    const d = new Date(date);
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatDuration = (start: string | null, end: string | null, isRunning?: boolean) => {
    if (!start) return '—';
    const endMs = end ? new Date(end).getTime() : (isRunning ? now : Date.now());
    const ms = endMs - new Date(start).getTime();
    if (ms < 1000) return '<1s';
    if (ms < 60000) return `${Math.round(ms / 1000)}s`;
    return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
  };

  const summarizeResults = (run: AgentRun): string => {
    if (!run.results) return '—';
    const r = run.results;
    const parts: string[] = [];
    if (typeof r.frontier_claimed === 'number') parts.push(`${r.frontier_claimed} claimed`);
    if (typeof r.pages_fetched === 'number') parts.push(`${r.pages_fetched} pages`);
    if (typeof r.profiles_found === 'number') parts.push(`${r.profiles_found} found`);
    if (typeof r.suggestions_created === 'number') parts.push(`${r.suggestions_created} suggestions`);
    if (typeof r.suggestions_merged === 'number' && r.suggestions_merged > 0) parts.push(`${r.suggestions_merged} merged`);
    if (typeof r.profiles_checked === 'number') parts.push(`${r.profiles_checked} checked`);
    if (typeof r.profiles_verified === 'number') parts.push(`${r.profiles_verified} verified`);
    if (typeof r.child_links_queued === 'number' && r.child_links_queued > 0) parts.push(`${r.child_links_queued} queued`);
    if (typeof r.sitemap_urls_seeded === 'number' && r.sitemap_urls_seeded > 0) parts.push(`${r.sitemap_urls_seeded} sitemap`);
    if (typeof r.rss_urls_seeded === 'number' && r.rss_urls_seeded > 0) parts.push(`${r.rss_urls_seeded} rss`);
    if (Array.isArray(r.entity_pivots_used) && r.entity_pivots_used.length > 0) parts.push(`${r.entity_pivots_used.length} pivots`);
    if (typeof r.duplicates_skipped === 'number' && r.duplicates_skipped > 0) parts.push(`${r.duplicates_skipped} dupes`);
    return parts.length > 0 ? parts.join(', ') : '—';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="w-6 h-6 animate-spin text-teal-600" />
      </div>
    );
  }

  const tavilyQuota = getQuota('tavily');
  const braveQuota = getQuota('brave');
  const apifyQuota = getQuota('apify');

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-gray-900">Run Discovery</h3>
          <button
            onClick={loadData}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowQueryInput(!showQueryInput)}
              disabled={triggerLoading === 'discovery'}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {triggerLoading === 'discovery' ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Search className="w-4 h-4" />
              )}
              Discovery
            </button>
            {showQueryInput && (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={discoveryQuery}
                  onChange={(e) => setDiscoveryQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleDiscoveryTrigger()}
                  placeholder="Optional custom query..."
                  className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 w-64"
                  autoFocus
                />
                <button
                  onClick={handleDiscoveryTrigger}
                  className="px-3 py-2 text-sm font-medium text-blue-600 hover:bg-blue-50 rounded-lg"
                >
                  Run
                </button>
              </div>
            )}
          </div>

        </div>
        {showQueryInput && (
          <p className="mt-3 text-xs text-gray-500">
            Leave the query blank to run a seeded discovery sweep across source packs and proven
            entity pivots. Add a query to focus the run on a specific topic, group, or metro.
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
          <h3 className="text-base font-semibold text-gray-900 mb-4">API Quotas</h3>
          <div className="space-y-4">
            <QuotaBar
              label="Tavily"
              used={tavilyQuota?.calls_used ?? 0}
              limit={tavilyQuota?.calls_limit ?? 1000}
              color="bg-teal-500"
            />
            <QuotaBar
              label="Brave"
              used={braveQuota?.calls_used ?? 0}
              limit={braveQuota?.calls_limit ?? 2000}
              color="bg-orange-500"
            />
            <QuotaBar
              label="Apify"
              used={apifyQuota?.calls_used ?? 0}
              limit={apifyQuota?.calls_limit ?? 500}
              color="bg-violet-500"
              unit="credits"
            />
          </div>
        </div>

        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
          <h3 className="text-base font-semibold text-gray-900 mb-4">Summary</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="text-center p-4 bg-yellow-50 rounded-lg">
              <p className="text-2xl font-bold text-yellow-700">{pendingSuggestions}</p>
              <p className="text-xs text-yellow-600 mt-1">Pending People</p>
            </div>
            <div className="text-center p-4 bg-blue-50 rounded-lg">
              <p className="text-2xl font-bold text-blue-700">
                {runs.filter((r) => r.status === 'completed').length}
              </p>
              <p className="text-xs text-blue-600 mt-1">Completed Runs</p>
            </div>
            <div className="text-center p-4 bg-red-50 rounded-lg">
              <p className="text-2xl font-bold text-red-700">
                {runs.filter((r) => r.status === 'failed').length}
              </p>
              <p className="text-xs text-red-600 mt-1">Failed Runs</p>
            </div>
            <div className="text-center p-4 bg-green-50 rounded-lg">
              <p className="text-2xl font-bold text-green-700">
                ${runs.reduce((sum, r) => sum + (r.cost_estimate_usd || 0), 0).toFixed(2)}
              </p>
              <p className="text-xs text-green-600 mt-1">Total Cost</p>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-6 pb-3">
          <h3 className="text-base font-semibold text-gray-900">Discovery History</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-y border-gray-100">
              <tr>
                <th className="text-left py-2.5 px-4 font-medium text-gray-500">Service</th>
                <th className="text-left py-2.5 px-4 font-medium text-gray-500">Status</th>
                <th className="text-left py-2.5 px-4 font-medium text-gray-500">Started</th>
                <th className="text-left py-2.5 px-4 font-medium text-gray-500">Duration</th>
                <th className="text-left py-2.5 px-4 font-medium text-gray-500">Results</th>
                <th className="text-right py-2.5 px-4 font-medium text-gray-500">Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {runs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-gray-400">
                    No discovery runs yet. Use the button above to start one.
                  </td>
                </tr>
              ) : (
                runs.map((run) => {
                  const style = STATUS_STYLES[run.status] || STATUS_STYLES.pending;
                  const StatusIcon = style.icon;
                  const isExpanded = expandedRunId === run.id;
                  const hasSteps = run.results && Array.isArray(run.results.steps);

                  return (
                    <React.Fragment key={run.id}>
                    <tr
                      className={`hover:bg-gray-50/50 ${hasSteps ? 'cursor-pointer' : ''}`}
                      onClick={() => hasSteps && setExpandedRunId(isExpanded ? null : run.id)}
                    >
                      <td className="py-2.5 px-4">
                        <span className="font-medium text-gray-900 flex items-center gap-1.5">
                          {hasSteps && (
                            isExpanded
                              ? <ChevronUp className="w-3.5 h-3.5 text-gray-400" />
                              : <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
                          )}
                          {serviceLabelForRun(run.agent_type)}
                        </span>
                      </td>
                      <td className="py-2.5 px-4">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${style.bg} ${style.text}`}
                        >
                          <StatusIcon
                            className={`w-3 h-3 ${run.status === 'running' ? 'animate-spin' : ''}`}
                          />
                          {run.status}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-gray-500">
                        {formatDate(run.started_at)}
                      </td>
                      <td className="py-2.5 px-4 text-gray-500">
                        <span className="flex items-center gap-1.5">
                          {formatDuration(run.started_at, run.completed_at, run.status === 'running' || run.status === 'pending')}
                          {(run.status === 'running' || run.status === 'pending') && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                cancelRun(run.id);
                              }}
                              className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-600 hover:bg-red-200 font-medium"
                              title="Cancel this run"
                            >
                              Cancel
                            </button>
                          )}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-gray-600">
                        {run.error_message ? (
                          <span className="text-red-500 text-xs" title={run.error_message}>
                            {run.error_message.slice(0, 60)}
                            {run.error_message.length > 60 ? '...' : ''}
                          </span>
                        ) : (
                          summarizeResults(run)
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-right text-gray-500">
                        {run.cost_estimate_usd > 0 ? `$${run.cost_estimate_usd.toFixed(4)}` : '—'}
                      </td>
                    </tr>
                    {isExpanded && hasSteps && (
                      <tr>
                        <td colSpan={6} className="px-4 pb-4 bg-gray-50/80">
                          <RunStepsDetail
                            steps={run.results!.steps as StepLog[]}
                            params={run.params}
                            errors={run.results!.errors as string[] | undefined}
                          />
                        </td>
                      </tr>
                    )}
                    {run.status === 'failed' && run.error_message && (
                      <tr>
                        <td colSpan={6} className="px-4 pb-4 bg-gray-50/80">
                          <StructuredErrorBanner
                            title="Discovery run failed"
                            error={{
                              name: 'AgentRunError',
                              message: run.error_message,
                              code: run.error_kind || 'unknown',
                              hint: run.error_kind
                                ? `See docs/RUNBOOK.md entry [${run.error_kind}] when available.`
                                : undefined,
                            }}
                          />
                        </td>
                      </tr>
                    )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function QuotaBar({
  label,
  used,
  limit,
  color,
  unit = 'calls',
}: {
  label: string;
  used: number;
  limit: number;
  color: string;
  unit?: string;
}) {
  const pct = limit > 0 ? Math.min((used / limit) * 100, 100) : 0;
  const isHigh = pct > 80;

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm text-gray-700">{label}</span>
        <span className={`text-xs font-medium ${isHigh ? 'text-red-500' : 'text-gray-500'}`}>
          {used.toLocaleString()} / {limit.toLocaleString()} {unit}
        </span>
      </div>
      <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
        <div
          className={`${isHigh ? 'bg-red-500' : color} h-2 rounded-full transition-all duration-500`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

interface StepLog {
  step: string;
  timestamp: string;
  elapsed: string;
  status: 'ok' | 'error' | 'skipped';
  detail: Record<string, unknown>;
}

const STEP_LABELS: Record<string, string> = {
  web_search: 'Web Search',
  llm_extraction: 'LLM Extraction',
  linkedin_search: 'LinkedIn Search',
  cross_dedup: 'Cross-Channel Dedup',
  db_dedup: 'Database Dedup',
  insert: 'Insert Contacts',
  discovery_plan: 'Discovery Plan',
  frontier_claim: 'Claim Frontier',
};

const STEP_STATUS_STYLE: Record<string, string> = {
  ok: 'bg-green-100 text-green-700',
  error: 'bg-red-100 text-red-700',
  skipped: 'bg-gray-100 text-gray-500',
};

function RunStepsDetail({
  steps,
  params,
  errors,
}: {
  steps: StepLog[];
  params: Record<string, unknown> | null;
  errors?: string[];
}) {
  const [expandedStep, setExpandedStep] = useState<number | null>(null);

  return (
    <div className="pt-3 space-y-2">
      {/* Input params */}
      {params && (
        <div className="text-xs text-gray-500 mb-3">
          <span className="font-medium text-gray-700">Input: </span>
          {Object.entries(params).map(([k, v]) => (
            <span key={k} className="mr-3">
              <span className="text-gray-400">{k}=</span>
              <span className="text-gray-700">{JSON.stringify(v)}</span>
            </span>
          ))}
        </div>
      )}

      {/* Steps timeline */}
      <div className="space-y-1">
        {steps.map((step, i) => {
          const isOpen = expandedStep === i;
          return (
            <div key={i} className="bg-white rounded-lg border border-gray-100">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setExpandedStep(isOpen ? null : i);
                }}
                className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-gray-50 rounded-lg"
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400 font-mono w-10">
                    {step.elapsed}
                  </span>
                  <span className="text-xs font-medium text-gray-900">
                    {STEP_LABELS[step.step] || step.step}
                  </span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${STEP_STATUS_STYLE[step.status] || ''}`}
                  >
                    {step.status}
                  </span>
                  {/* Quick summary */}
                  <span className="text-[11px] text-gray-400">
                    {renderStepSummary(step)}
                  </span>
                </div>
                {isOpen ? (
                  <ChevronUp className="w-3.5 h-3.5 text-gray-400" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
                )}
              </button>
              {isOpen && (
                <div className="px-3 pb-3 border-t border-gray-50">
                  <pre className="text-[11px] text-gray-600 bg-gray-50 rounded-lg p-3 overflow-x-auto max-h-80 overflow-y-auto whitespace-pre-wrap">
                    {JSON.stringify(step.detail, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Errors */}
      {errors && errors.length > 0 && (
        <div className="bg-red-50 rounded-lg p-3 mt-2">
          <p className="text-xs font-medium text-red-700 mb-1">Errors</p>
          {errors.map((err, i) => (
            <p key={i} className="text-[11px] text-red-600">{err}</p>
          ))}
        </div>
      )}
    </div>
  );
}

function renderStepSummary(step: StepLog): string {
  const d = step.detail;
  if (step.step.startsWith('seed_search_')) {
    return `${d.provider || 'none'} · ${d.seeded_count || 0} seeded`;
  }
  if (step.step.startsWith('page_classification_')) {
    return `${d.page_type || 'unknown'} · ${d.method || 'heuristic'} · ${d.confidence || 0}`;
  }
  if (step.step.startsWith('page_extraction_')) {
    return `${d.extracted_candidates || 0} extracted · ${d.inserted_contacts || 0} inserted · ${d.child_links_queued || 0} queued`;
  }
  if (step.step.startsWith('domain_harvest_')) {
    return `${d.sitemap_seeded || 0} sitemap · ${d.rss_seeded || 0} rss`;
  }
  if (step.step.startsWith('linkedin_enrichment_')) {
    return d.matched ? 'match found' : 'no confident match';
  }

  switch (step.step) {
    case 'web_search':
      return `${d.provider} · ${d.results_count} results${d.cached ? ' (cached)' : ''}`;
    case 'llm_extraction':
      return `${d.extracted_count} extracted · ${d.us_filtered_count} US · ${(d.non_us_removed as unknown[])?.length || 0} filtered out`;
    case 'linkedin_search':
      if (step.status === 'ok')
        return `${d.raw_results} raw · ${d.us_filtered_count} US`;
      return typeof d.reason === 'string' ? d.reason : '';
    case 'cross_dedup':
      return `${d.before} → ${d.after} (${d.removed} merged)`;
    case 'db_dedup':
      return `${d.duplicates_found} dupes · ${d.new_contacts} new`;
    case 'insert':
      return `${d.inserted}/${d.attempted} inserted`;
    case 'discovery_plan':
      return `${d.queued_frontier_before || 0} queued · ${d.seed_queries ? (d.seed_queries as unknown[]).length : 0} searches`;
    case 'frontier_claim':
      return `${d.claimed_count || 0} claimed`;
    default:
      return '';
  }
}
