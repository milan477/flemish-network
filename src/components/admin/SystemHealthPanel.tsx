import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Database,
  Loader2,
  Play,
  RefreshCw,
  Square,
  Zap,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { notifyError, notifySuccess } from '../../lib/toast';
import StructuredErrorBanner from './StructuredErrorBanner';

type AgentKind = 'discovery' | 'verification';
type HealthAgentKind = AgentKind | 'embeddings';

interface AgentRun {
  id: string;
  agent_type: string;
  status: string;
  params: Record<string, unknown> | null;
  started_at: string | null;
  completed_at: string | null;
  heartbeat_at: string | null;
  results: Record<string, unknown> | null;
  error_message: string | null;
  error_kind: string | null;
  llm_calls_made: number | null;
  web_searches_made: number | null;
  web_search_provider: string | null;
  cost_estimate_usd: number | string | null;
  created_at: string;
}

interface EmbeddingBatchRun {
  id: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  last_error: string | null;
  request_count: number | null;
  people_count: number | null;
  created_at: string | null;
}

interface EmbeddingBatchesResponse {
  batches?: EmbeddingBatchRun[];
  remaining?: number;
}

interface AgentSummary {
  kind: HealthAgentKind;
  label: string;
  lastSuccess: AgentRun | EmbeddingBatchRun | null;
  lastFailure: AgentRun | EmbeddingBatchRun | null;
  running: AgentRun | EmbeddingBatchRun | null;
}

interface QueueHealth {
  pending: number;
  running: number;
  oldestQueuedAt: string | null;
}

interface UsageTotals {
  geminiCalls: number;
  tavilyCalls: number;
  apifyCalls: number;
  apifyCredits: number;
  estimatedCostUsd: number;
}

const AGENTS: Array<{ kind: HealthAgentKind; label: string }> = [
  { kind: 'discovery', label: 'Discovery' },
  { kind: 'verification', label: 'Verification' },
  { kind: 'embeddings', label: 'Embeddings' },
];

const STUCK_AFTER_MS = 2 * 60 * 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numberFrom(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return 'Never';
  return new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDuration(start: string | null | undefined, end: string | null | undefined): string {
  if (!start) return '-';
  const startMs = new Date(start).getTime();
  const endMs = end ? new Date(end).getTime() : Date.now();
  const ms = Math.max(0, endMs - startMs);
  if (ms < 1000) return '<1s';
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function formatAge(value: string | null): string {
  if (!value) return '-';
  return formatDuration(value, null);
}

function runStartedAt(run: AgentRun | EmbeddingBatchRun | null): string | null {
  return run?.started_at || run?.created_at || null;
}

function runCompletedAt(run: AgentRun | EmbeddingBatchRun | null): string | null {
  return run?.completed_at || null;
}

function providerUsage(results: Record<string, unknown> | null, provider: string): Record<string, unknown> | null {
  const usage = isRecord(results?.usage) ? results.usage : null;
  if (!usage) return null;
  const direct = usage[provider];
  return isRecord(direct) ? direct : null;
}

function totalUsage(runs: AgentRun[]): UsageTotals {
  return runs.reduce<UsageTotals>(
    (totals, run) => {
      const gemini = providerUsage(run.results, 'gemini');
      const tavily = providerUsage(run.results, 'tavily');
      const apify = providerUsage(run.results, 'apify');

      totals.geminiCalls += numberFrom(gemini?.calls) || numberFrom(run.llm_calls_made);
      totals.tavilyCalls +=
        numberFrom(tavily?.calls) ||
        (run.web_search_provider === 'tavily' || run.web_search_provider === 'mixed'
          ? numberFrom(run.web_searches_made)
          : 0);
      totals.apifyCalls += numberFrom(apify?.calls);
      totals.apifyCredits += numberFrom(apify?.credits) || numberFrom(apify?.usage);
      totals.estimatedCostUsd += numberFrom(run.cost_estimate_usd);
      return totals;
    },
    {
      geminiCalls: 0,
      tavilyCalls: 0,
      apifyCalls: 0,
      apifyCredits: 0,
      estimatedCostUsd: 0,
    }
  );
}

function statusClass(status: string): string {
  if (status === 'completed' || status === 'succeeded') return 'bg-green-100 text-green-700';
  if (status === 'failed') return 'bg-red-100 text-red-700';
  if (status === 'running' || status === 'pending') return 'bg-blue-100 text-blue-700';
  return 'bg-gray-100 text-gray-600';
}

export default function SystemHealthPanel() {
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [embeddingBatches, setEmbeddingBatches] = useState<EmbeddingBatchRun[]>([]);
  const [queueHealth, setQueueHealth] = useState<QueueHealth>({
    pending: 0,
    running: 0,
    oldestQueuedAt: null,
  });
  const [todayUsage, setTodayUsage] = useState<UsageTotals>({
    geminiCalls: 0,
    tavilyCalls: 0,
    apifyCalls: 0,
    apifyCredits: 0,
    estimatedCostUsd: 0,
  });
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [connectivity, setConnectivity] = useState<'idle' | 'ok' | 'failed'>('idle');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const [
        runsRes,
        todayRunsRes,
        pendingQueueRes,
        runningQueueRes,
        oldestQueueRes,
        batchesRes,
      ] = await Promise.all([
        supabase
          .from('agent_runs')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(80),
        supabase
          .from('agent_runs')
          .select('*')
          .gte('created_at', todayStart.toISOString()),
        supabase
          .from('embedding_jobs')
          .select('person_id', { count: 'exact', head: true })
          .eq('status', 'pending'),
        supabase
          .from('embedding_jobs')
          .select('person_id', { count: 'exact', head: true })
          .eq('status', 'running'),
        supabase
          .from('embedding_jobs')
          .select('queued_at')
          .eq('status', 'pending')
          .order('queued_at', { ascending: true })
          .limit(1)
          .maybeSingle(),
        supabase.functions.invoke('generate-embeddings', {
          body: { action: 'list_batches' },
        }),
      ]);

      if (runsRes.error) throw runsRes.error;
      if (todayRunsRes.error) throw todayRunsRes.error;
      if (pendingQueueRes.error) throw pendingQueueRes.error;
      if (runningQueueRes.error) throw runningQueueRes.error;
      if (oldestQueueRes.error) throw oldestQueueRes.error;

      setRuns((runsRes.data || []) as AgentRun[]);
      if (batchesRes.error) {
        console.warn('[SystemHealthPanel] embedding batch telemetry unavailable', batchesRes.error);
        setEmbeddingBatches([]);
      } else {
        setEmbeddingBatches(((batchesRes.data as EmbeddingBatchesResponse | null)?.batches || []) as EmbeddingBatchRun[]);
      }
      setQueueHealth({
        pending: pendingQueueRes.count || 0,
        running: runningQueueRes.count || 0,
        oldestQueuedAt: oldestQueueRes.data?.queued_at || null,
      });
      setTodayUsage(totalUsage((todayRunsRes.data || []) as AgentRun[]));
    } catch (err) {
      notifyError(err, { hint: 'Could not load system health data.' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    const hasActive = runs.some((run) => run.status === 'running' || run.status === 'pending');
    if (!hasActive && queueHealth.running === 0) return;
    const interval = window.setInterval(loadData, 8000);
    return () => window.clearInterval(interval);
  }, [loadData, queueHealth.running, runs]);

  const summaries = useMemo<AgentSummary[]>(() => {
    return AGENTS.map(({ kind, label }) => {
      if (kind === 'embeddings') {
        return {
          kind,
          label,
          lastSuccess: embeddingBatches.find((batch) => batch.status === 'succeeded') || null,
          lastFailure: embeddingBatches.find((batch) => batch.status === 'failed') || null,
          running: embeddingBatches.find((batch) => batch.status === 'running') || null,
        };
      }

      const matching = runs.filter((run) => run.agent_type === kind);
      return {
        kind,
        label,
        lastSuccess: matching.find((run) => run.status === 'completed') || null,
        lastFailure: matching.find((run) => run.status === 'failed') || null,
        running: matching.find((run) => run.status === 'running' || run.status === 'pending') || null,
      };
    });
  }, [embeddingBatches, runs]);

  const stuckRuns = useMemo(() => {
    const cutoff = Date.now() - STUCK_AFTER_MS;
    return runs.filter((run) => {
      if (run.status !== 'running') return false;
      const heartbeat = run.heartbeat_at || run.started_at;
      return heartbeat ? new Date(heartbeat).getTime() < cutoff : false;
    });
  }, [runs]);

  const runNow = useCallback(
    async (kind: HealthAgentKind) => {
      setActionLoading(`run:${kind}`);
      try {
        if (kind === 'embeddings') {
          const { error } = await supabase.functions.invoke('generate-embeddings', {
            body: { kick: true, batch_size: 20 },
          });
          if (error) throw error;
        } else {
          const params = kind === 'verification' ? { batch_size: 5 } : {};
          const { error } = await supabase.functions.invoke('agent-scheduler', {
            body: { action: 'trigger', agent_type: kind, params },
          });
          if (error) throw error;
        }
        notifySuccess(`${AGENTS.find((agent) => agent.kind === kind)?.label || kind} started.`);
        await loadData();
      } catch (err) {
        notifyError(err, { hint: 'The run request failed before it could be queued.' });
      } finally {
        setActionLoading(null);
      }
    },
    [loadData]
  );

  const cancelRun = useCallback(
    async (runId: string) => {
      setActionLoading(`cancel:${runId}`);
      try {
        const { error } = await supabase.functions.invoke('agent-scheduler', {
          body: { action: 'cancel', run_id: runId },
        });
        if (error) throw error;
        notifySuccess('Run cancelled.');
        await loadData();
      } catch (err) {
        notifyError(err, { hint: 'Could not cancel this run.' });
      } finally {
        setActionLoading(null);
      }
    },
    [loadData]
  );

  const runHousekeeping = useCallback(async () => {
    setActionLoading('housekeeping');
    try {
      const { data, error } = await supabase.functions.invoke('agent-scheduler', {
        body: { action: 'housekeeping' },
      });
      if (error) throw error;
      const zombies = numberFrom((data as Record<string, unknown> | null)?.housekeeping && isRecord((data as Record<string, unknown>).housekeeping)
        ? ((data as Record<string, unknown>).housekeeping as Record<string, unknown>).zombies_marked_failed
        : 0);
      notifySuccess('Housekeeping completed.', {
        hint: `${zombies} stuck run${zombies === 1 ? '' : 's'} marked failed.`,
      });
      await loadData();
    } catch (err) {
      notifyError(err, { hint: 'Housekeeping could not complete.' });
    } finally {
      setActionLoading(null);
    }
  }, [loadData]);

  const testConnectivity = useCallback(async () => {
    setActionLoading('connectivity');
    setConnectivity('idle');
    try {
      const { error } = await supabase
        .from('agent_runs')
        .select('id', { count: 'exact', head: true });
      if (error) throw error;
      setConnectivity('ok');
      notifySuccess('Supabase connectivity test passed.');
    } catch (err) {
      setConnectivity('failed');
      notifyError(err, { hint: 'Check Supabase URL, anon key, auth session, and RLS policies.' });
    } finally {
      setActionLoading(null);
    }
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="w-6 h-6 animate-spin text-teal-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">System Health</h2>
          <p className="text-sm text-gray-600">Service status, queue health, usage, and operator actions.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={testConnectivity}
            disabled={actionLoading === 'connectivity'}
            className="inline-flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {actionLoading === 'connectivity' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
            Test Supabase
          </button>
          <button
            type="button"
            onClick={runHousekeeping}
            disabled={actionLoading === 'housekeeping'}
            className="inline-flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {actionLoading === 'housekeeping' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Run Housekeeping
          </button>
          <button
            type="button"
            onClick={loadData}
            className="inline-flex items-center gap-2 rounded-md bg-teal-600 px-3 py-2 text-sm font-medium text-white hover:bg-teal-700"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
        </div>
      </div>

      {connectivity === 'ok' && (
        <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          <CheckCircle2 className="h-4 w-4" />
          Supabase connectivity is healthy.
        </div>
      )}
      {connectivity === 'failed' && (
        <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <AlertTriangle className="h-4 w-4" />
          Supabase connectivity failed. See the toast details and RUNBOOK [auth_failed] or [network].
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
        {summaries.map((summary) => (
          <AgentHealthCard
            key={summary.kind}
            summary={summary}
            actionLoading={actionLoading}
            onRunNow={runNow}
            onCancel={cancelRun}
          />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-md border border-gray-200 bg-white p-5">
          <div className="mb-4 flex items-center gap-2">
            <Activity className="h-5 w-5 text-teal-600" />
            <h3 className="font-semibold text-gray-900">Embedding Queue</h3>
          </div>
          <dl className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <dt className="text-gray-500">Pending</dt>
              <dd className="mt-1 text-2xl font-semibold text-gray-900">{queueHealth.pending.toLocaleString()}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Running</dt>
              <dd className="mt-1 text-2xl font-semibold text-gray-900">{queueHealth.running.toLocaleString()}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Oldest</dt>
              <dd className="mt-1 text-2xl font-semibold text-gray-900">{formatAge(queueHealth.oldestQueuedAt)}</dd>
            </div>
          </dl>
        </div>

        <div className="rounded-md border border-gray-200 bg-white p-5 lg:col-span-2">
          <div className="mb-4 flex items-center gap-2">
            <Zap className="h-5 w-5 text-amber-600" />
            <h3 className="font-semibold text-gray-900">Today&apos;s API Usage</h3>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-5">
            <Metric label="Gemini calls" value={todayUsage.geminiCalls.toLocaleString()} />
            <Metric label="Tavily calls" value={todayUsage.tavilyCalls.toLocaleString()} />
            <Metric label="Apify calls" value={todayUsage.apifyCalls.toLocaleString()} />
            <Metric label="Apify credits" value={todayUsage.apifyCredits.toLocaleString()} />
            <Metric label="Est. cost" value={`$${todayUsage.estimatedCostUsd.toFixed(4)}`} />
          </div>
        </div>
      </div>

      <div className="rounded-md border border-gray-200 bg-white">
        <div className="border-b border-gray-100 px-5 py-4">
          <h3 className="font-semibold text-gray-900">Stuck Runs</h3>
        </div>
        {stuckRuns.length === 0 ? (
          <div className="px-5 py-6 text-sm text-gray-500">No running service has exceeded the housekeeping timeout.</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {stuckRuns.map((run) => (
              <div key={run.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div>
                  <div className="font-medium text-gray-900">{run.agent_type}</div>
                  <div className="text-sm text-gray-500">
                    Started {formatDate(run.started_at)} · heartbeat {formatDate(run.heartbeat_at)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => cancelRun(run.id)}
                  disabled={actionLoading === `cancel:${run.id}`}
                  className="inline-flex items-center gap-2 rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {actionLoading === `cancel:${run.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
                  Cancel
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AgentHealthCard({
  summary,
  actionLoading,
  onRunNow,
  onCancel,
}: {
  summary: AgentSummary;
  actionLoading: string | null;
  onRunNow: (kind: HealthAgentKind) => void;
  onCancel: (runId: string) => void;
}) {
  const runningRun = summary.running && 'agent_type' in summary.running ? summary.running : null;
  const failureMessage =
    summary.lastFailure && 'error_message' in summary.lastFailure
      ? summary.lastFailure.error_message
      : summary.lastFailure && 'last_error' in summary.lastFailure
        ? summary.lastFailure.last_error
        : null;
  const failureCode =
    summary.lastFailure && 'error_kind' in summary.lastFailure
      ? summary.lastFailure.error_kind || 'unknown'
      : 'agent_failure';

  return (
    <div className="rounded-md border border-gray-200 bg-white p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-gray-900">{summary.label}</h3>
          {summary.running ? (
            <span className={`mt-2 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${statusClass(summary.running.status)}`}>
              <Loader2 className="h-3 w-3 animate-spin" />
              {summary.running.status}
            </span>
          ) : (
            <span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
              <Clock className="h-3 w-3" />
              idle
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => onRunNow(summary.kind)}
          disabled={actionLoading === `run:${summary.kind}`}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50"
          title={`Run ${summary.label}`}
          aria-label={`Run ${summary.label}`}
        >
          {actionLoading === `run:${summary.kind}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
        </button>
      </div>

      <dl className="space-y-3 text-sm">
        <div>
          <dt className="text-gray-500">Last success</dt>
          <dd className="mt-1 text-gray-900">
            {summary.lastSuccess ? (
              <>
                {formatDate(runCompletedAt(summary.lastSuccess) || runStartedAt(summary.lastSuccess))}
                <span className="block text-xs text-gray-500">
                  {formatDuration(runStartedAt(summary.lastSuccess), runCompletedAt(summary.lastSuccess))}
                </span>
              </>
            ) : (
              'Never'
            )}
          </dd>
        </div>
        <div>
          <dt className="text-gray-500">Last failure</dt>
          <dd className="mt-1 text-gray-900">{summary.lastFailure ? formatDate(runCompletedAt(summary.lastFailure) || runStartedAt(summary.lastFailure)) : 'Never'}</dd>
        </div>
      </dl>

      {runningRun && (
        <button
          type="button"
          onClick={() => onCancel(runningRun.id)}
          disabled={actionLoading === `cancel:${runningRun.id}`}
          className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md border border-red-200 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
        >
          {actionLoading === `cancel:${runningRun.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
          Cancel Running
        </button>
      )}

      {failureMessage && (
        <StructuredErrorBanner
          className="mt-4"
          title="Last failure"
          error={{
            name: 'AgentRunError',
            message: failureMessage,
            code: failureCode,
            hint: `See docs/RUNBOOK.md [${failureCode}] for fix steps.`,
          }}
        />
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-gray-50 p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-1 text-lg font-semibold text-gray-900">{value}</div>
    </div>
  );
}
