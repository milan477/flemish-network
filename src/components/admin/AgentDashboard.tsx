import { useEffect, useState, useCallback } from 'react';
import {
  Earth,
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

const AGENT_LABELS: Record<string, { label: string; icon: typeof Search }> = {
  discovery: { label: 'Discovery', icon: Search },
  verification: { label: 'Verification', icon: Search },
};

function serviceLabelForRun(agentType: string): string {
  return AGENT_LABELS[agentType]?.label || 'Service run';
}

function promptForRun(run: AgentRun): string | null {
  const prompt = run.params?.query;
  return typeof prompt === 'string' && prompt.trim() ? prompt.trim() : null;
}

const STATUS_STYLES: Record<string, { className: string; icon: typeof Clock }> = {
  pending: { className: 'bg-gray-50 text-gray-600 ring-gray-200', icon: Clock },
  running: { className: 'bg-yellow-50 text-yellow-800 ring-yellow-200', icon: Earth },
  completed: { className: 'bg-yellow-50 text-yellow-800 ring-yellow-200', icon: CheckCircle2 },
  failed: { className: 'bg-rose-50 text-rose-700 ring-rose-200', icon: XCircle },
};

const formatCount = (count: number, singular: string, plural = `${singular}s`) =>
  `${count} ${count === 1 ? singular : plural}`;

function numericResult(results: Record<string, unknown>, key: string): number | null {
  return typeof results[key] === 'number' ? results[key] : null;
}

interface RunOutcome {
  headline: string;
  records: string | null;
  activity: string | null;
}

function summarizeOutcome(run: AgentRun): RunOutcome {
  if (run.status === 'failed') {
    return {
      headline: 'Run failed',
      records: run.error_message || 'The run stopped before producing results.',
      activity: null,
    };
  }

  if (!run.results) {
    return {
      headline: run.status === 'running' ? 'Discovery in progress' : 'Waiting to start',
      records: null,
      activity: null,
    };
  }

  const results = run.results;
  const peopleCreated = numericResult(results, 'suggestions_created');
  const organizationsCreated =
    numericResult(results, 'organizations_inserted') ??
    numericResult(results, 'organization_suggestions_created');
  const createdTotal = (peopleCreated || 0) + (organizationsCreated || 0);
  const peopleMerged = numericResult(results, 'suggestions_merged') || 0;
  const organizationsMerged =
    numericResult(results, 'organizations_merged') ??
    numericResult(results, 'organization_suggestions_merged') ??
    0;
  const duplicatesSkipped =
    (numericResult(results, 'duplicates_skipped') || 0) +
    (numericResult(results, 'organization_duplicates_skipped') || 0);

  const recordParts: string[] = [];
  if (peopleCreated !== null) recordParts.push(formatCount(peopleCreated, 'person', 'people'));
  if (organizationsCreated !== null) {
    recordParts.push(formatCount(organizationsCreated, 'organization'));
  }

  const activityParts: string[] = [];
  const mergedTotal = peopleMerged + organizationsMerged;
  if (mergedTotal > 0) activityParts.push(`${formatCount(mergedTotal, 'record')} merged`);
  if (duplicatesSkipped > 0) {
    activityParts.push(`${formatCount(duplicatesSkipped, 'duplicate')} skipped`);
  }
  const pagesFetched = numericResult(results, 'pages_fetched');
  if (pagesFetched !== null) activityParts.push(`${formatCount(pagesFetched, 'page')} reviewed`);
  const frontierClaimed = numericResult(results, 'frontier_claimed');
  if (frontierClaimed !== null) {
    activityParts.push(`${formatCount(frontierClaimed, 'source')} selected`);
  }
  const profilesFound = numericResult(results, 'profiles_found');
  if (profilesFound !== null) {
    activityParts.push(`${formatCount(profilesFound, 'candidate')} found`);
  }

  return {
    headline: createdTotal > 0
      ? `${formatCount(createdTotal, 'new record')}`
      : 'No new records',
    records: recordParts.length > 0 ? recordParts.join(' · ') : null,
    activity: activityParts.length > 0 ? activityParts.join(' · ') : null,
  };
}

interface AgentDashboardProps {
  refreshKey?: number;
  activeOnly?: boolean;
  historyScope?: 'discovery' | 'all';
}

export default function AgentDashboard({
  refreshKey = 0,
  activeOnly = false,
  historyScope = 'discovery',
}: AgentDashboardProps) {
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const loadData = useCallback(async () => {
    const query = supabase
      .from('agent_runs')
      .select('*');
    const runsRes = activeOnly
      ? await query
          .in('status', ['pending', 'running'])
          .order('created_at', { ascending: false })
          .limit(50)
      : historyScope === 'all'
        ? await query
            .order('created_at', { ascending: false })
            .limit(50)
        : await query
            .eq('agent_type', 'discovery')
            .order('created_at', { ascending: false })
            .limit(20);

    setRuns((runsRes.data || []) as AgentRun[]);
    setLoading(false);
  }, [activeOnly, historyScope]);

  useEffect(() => {
    loadData();
  }, [loadData, refreshKey]);

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
        notifyError(err, { hint: 'Could not cancel this run.' });
      }
    },
    [loadData]
  );

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
    const totalSec = Math.floor(ms / 1000);
    const days = Math.floor(totalSec / 86400);
    const hours = Math.floor((totalSec % 86400) / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);
    const seconds = totalSec % 60;
    if (days > 0) return `${days}d ${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m ${seconds}s`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Earth className="w-6 h-6 animate-spin text-yellow-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className="flex items-start justify-between gap-4 px-5 py-5 sm:px-6">
          <div>
            <h3 className="text-base font-semibold text-gray-900">
              {activeOnly
                ? 'Ongoing runs'
                : historyScope === 'all'
                  ? 'Run History'
                  : 'Discovery History'}
            </h3>
            <p className="mt-1 text-sm text-gray-500">
              {activeOnly
                ? 'Discovery and verification work that is currently queued or running.'
                : historyScope === 'all'
                  ? 'Discovery and verification runs, including their outcomes and operational details.'
                  : 'See what each discovery run added and how much work it performed.'}
            </p>
          </div>
          <button
            onClick={loadData}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-gray-600 transition-colors hover:border-gray-300 hover:bg-gray-50 hover:text-gray-900"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        </div>
        <div className="hidden border-y border-gray-100 bg-gray-50/70 px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400 lg:grid lg:grid-cols-[minmax(220px,1.2fr)_minmax(150px,0.8fr)_minmax(280px,1.8fr)_80px_112px] lg:gap-5 sm:px-6">
          <span>Run</span>
          <span>Started</span>
          <span>Outcome</span>
          <span className="text-right">Cost</span>
          <span className="sr-only">Actions</span>
        </div>
        {runs.length === 0 ? (
          <div className="border-t border-gray-100 px-6 py-12 text-center text-sm text-gray-400 lg:border-t-0">
            {activeOnly
              ? 'Nothing is running right now.'
              : historyScope === 'all'
                ? 'No runs yet.'
                : 'No discovery runs yet. Use the button above to start one.'}
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {runs.map((run) => {
              const style = STATUS_STYLES[run.status] || STATUS_STYLES.pending;
              const StatusIcon = style.icon;
              const isExpanded = expandedRunId === run.id;
              const hasSteps = Boolean(run.results && Array.isArray(run.results.steps));
              const outcome = summarizeOutcome(run);
              const prompt = promptForRun(run);
              const runRef = run.completed_at || run.started_at;
              const supersededBySuccess = run.status === 'failed' && !!runRef && runs.some(
                (other) =>
                  other.id !== run.id &&
                  other.agent_type === run.agent_type &&
                  other.status === 'completed' &&
                  !!(other.completed_at || other.started_at) &&
                  new Date(other.completed_at || other.started_at!).getTime() >
                    new Date(runRef).getTime()
              );

              return (
                <article key={run.id} className="px-5 py-4 transition-colors hover:bg-gray-50/40 sm:px-6">
                  <div className="grid gap-4 lg:grid-cols-[minmax(220px,1.2fr)_minmax(150px,0.8fr)_minmax(280px,1.8fr)_80px_112px] lg:items-center lg:gap-5">
                    <div className="min-w-0">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium capitalize ring-1 ring-inset ${style.className}`}
                      >
                        <StatusIcon
                          className={`h-3.5 w-3.5 ${run.status === 'running' ? 'animate-spin' : ''}`}
                        />
                        {run.status}
                      </span>
                      <p className="mt-1.5 truncate text-xs text-gray-500">
                        {serviceLabelForRun(run.agent_type)}
                      </p>
                      {prompt && (
                        <p className="mt-1 line-clamp-2 text-xs leading-4 text-gray-700" title={prompt}>
                          <span className="font-medium text-gray-500">Prompt: </span>
                          {prompt}
                        </p>
                      )}
                    </div>

                    <div className="text-sm text-gray-700">
                      <span className="mr-1 text-xs font-medium text-gray-400 lg:hidden">Started</span>
                      <p className="inline font-medium lg:block">{formatDate(run.started_at)}</p>
                      <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
                        <span>
                          {formatDuration(
                            run.started_at,
                            run.completed_at,
                            run.status === 'running' || run.status === 'pending'
                          )}
                        </span>
                        {(run.status === 'running' || run.status === 'pending') && (
                          <button
                            onClick={() => void cancelRun(run.id)}
                            className="rounded-md border border-rose-200 px-2 py-0.5 font-medium text-rose-700 transition-colors hover:bg-rose-50"
                            title="Cancel this run"
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900">
                        {outcome.headline}
                      </p>
                      {outcome.records && (
                        <p
                          className="mt-0.5 truncate text-xs text-gray-600"
                          title={outcome.records}
                        >
                          {outcome.records}
                        </p>
                      )}
                      {outcome.activity && (
                        <p className="mt-1 text-xs text-gray-400">{outcome.activity}</p>
                      )}
                    </div>

                    <div className="text-sm text-gray-500 lg:text-right">
                      <span className="mr-1 text-xs font-medium text-gray-400 lg:hidden">Cost</span>
                      {run.cost_estimate_usd > 0 ? `$${run.cost_estimate_usd.toFixed(4)}` : '—'}
                    </div>

                    <div className="flex lg:justify-end">
                      {hasSteps ? (
                        <button
                          type="button"
                          aria-expanded={isExpanded}
                          aria-controls={`run-details-${run.id}`}
                          onClick={() => setExpandedRunId(isExpanded ? null : run.id)}
                          className="inline-flex w-28 items-center justify-center rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-600 transition-colors hover:border-gray-300 hover:bg-gray-50 hover:text-gray-900"
                        >
                          {isExpanded ? 'Hide details' : 'View details'}
                        </button>
                      ) : (
                        <span className="hidden w-28 lg:block" aria-hidden="true" />
                      )}
                    </div>
                  </div>

                  {isExpanded && hasSteps && (
                    <div id={`run-details-${run.id}`} className="mt-4 border-t border-gray-100 pt-1">
                      <RunStepsDetail
                        steps={run.results!.steps as unknown[]}
                        params={run.params}
                        errors={run.results!.errors as string[] | undefined}
                      />
                    </div>
                  )}

                  {run.status === 'failed' && run.error_message && !supersededBySuccess && (
                    <div className="mt-4 border-t border-gray-100 pt-4">
                      <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
                        <p className="font-medium text-gray-900">Failure details</p>
                        <p className="mt-1">{run.error_message}</p>
                        {run.error_kind && (
                          <p className="mt-1 text-xs text-gray-500">
                            Code: {run.error_kind}. See docs/RUNBOOK.md for fix steps.
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

interface StepLog {
  step: string;
  timestamp: string;
  elapsed: string;
  status: string;
  detail: Record<string, unknown>;
}

function normalizeStepLog(value: unknown): StepLog {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const detail = record.detail && typeof record.detail === 'object' && !Array.isArray(record.detail)
    ? record.detail as Record<string, unknown>
    : {};
  const step = [record.step, record.name, record.label, record.type]
    .find((candidate) => typeof candidate === 'string' && candidate.trim()) as string | undefined;

  return {
    step: step?.trim() || '',
    timestamp: typeof record.timestamp === 'string' ? record.timestamp : '',
    elapsed: typeof record.elapsed === 'string' ? record.elapsed : '—',
    status: typeof record.status === 'string' ? record.status : 'unknown',
    detail,
  };
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
  official_fayat_directory: 'Official Fayat Directory',
  // Prefix matches for parameterized step IDs (`<prefix>_<uuid>` / `<prefix>_<n>`).
  seed_search: 'Seed Search',
  page_classification: 'Page Classification',
  page_extraction: 'Page Extraction',
  domain_harvest: 'Domain Harvest',
  linkedin_enrichment: 'LinkedIn Enrichment',
  frontier_process: 'Process Frontier',
};

const UUID_SUFFIX_RE = /_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMERIC_SUFFIX_RE = /_\d+$/;

/**
 * Strip a trailing `_<uuid>` or `_<n>` suffix from a step id and look the
 * resulting prefix up in `STEP_LABELS`. Falls back to the (cleaned) raw step
 * id so future agent steps still render readably without a code change.
 */
function formatStepLabel(stepId: string): string {
  if (!stepId) return 'Run step';
  let prefix = stepId.replace(UUID_SUFFIX_RE, '');
  if (prefix === stepId) {
    prefix = stepId.replace(NUMERIC_SUFFIX_RE, '');
  }
  if (STEP_LABELS[prefix]) return STEP_LABELS[prefix];
  if (STEP_LABELS[stepId]) return STEP_LABELS[stepId];
  return prefix;
}

/**
 * Render a discovery-step `params` value for display. Strings are shown
 * without surrounding JSON quotes / escapes; everything else is JSON-stringified.
 */
function renderParamValue(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

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
  steps: unknown[];
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
              <span className="text-gray-700">{renderParamValue(v)}</span>
            </span>
          ))}
        </div>
      )}

      {/* Steps timeline */}
      <div className="space-y-1">
        {steps.map((rawStep, i) => {
          const step = normalizeStepLog(rawStep);
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
                    {formatStepLabel(step.step)}
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
