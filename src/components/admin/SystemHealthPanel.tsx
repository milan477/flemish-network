import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Database,
  ExternalLink,
  Loader2,
  Play,
  RefreshCw,
  Square,
  Zap,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { notifyError, notifySuccess } from '../../lib/toast';
import StructuredErrorBanner from './StructuredErrorBanner';

type AgentKind = 'discovery' | 'verification';
type HealthAgentKind = AgentKind | 'embeddings';

type JobKind = 'discovery' | 'verify_stale' | 'embeddings_drain';
type CadencePreset = 'off' | 'low' | 'normal' | 'high';

interface AgentSchedule {
  job_kind: JobKind;
  cadence_preset: CadencePreset;
  last_run_at: string | null;
  last_run_id: string | null;
  next_run_at: string;
  last_status: 'ok' | 'failed' | 'skipped' | null;
  last_error: string | null;
  last_manual_at: string | null;
  last_manual_by: string | null;
}

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

const AGENTS: Array<{ kind: HealthAgentKind; label: string; jobKind: JobKind | null }> = [
  { kind: 'discovery', label: 'Discovery', jobKind: 'discovery' },
  { kind: 'verification', label: 'Verification', jobKind: 'verify_stale' },
  { kind: 'embeddings', label: 'Search Index', jobKind: null },
];

const PRESET_LABELS: Record<CadencePreset, string> = {
  off: 'Off',
  low: 'Light',
  normal: 'Normal',
  high: 'Aggressive',
};

type ConfigurableCadencePreset = Exclude<CadencePreset, 'off'>;
const CONFIGURABLE_CADENCE_PRESETS: ConfigurableCadencePreset[] = ['low', 'normal', 'high'];

interface MaintenancePresetDefinition {
  discoveryRunsPerDay: number;
  discoverySchedule: string;
  verificationContactsPerDay: number;
}

const MAINTENANCE_PRESET_DEFINITIONS: Record<
  ConfigurableCadencePreset,
  MaintenancePresetDefinition
> = {
  low: {
    discoveryRunsPerDay: 1,
    discoverySchedule: '09:00 UTC',
    verificationContactsPerDay: 5,
  },
  normal: {
    discoveryRunsPerDay: 2,
    discoverySchedule: '09:00 and 21:00 UTC',
    verificationContactsPerDay: 15,
  },
  high: {
    discoveryRunsPerDay: 4,
    discoverySchedule: 'Every 6 hours',
    verificationContactsPerDay: 40,
  },
};

const PRESET_DESCRIPTIONS: Record<JobKind, Record<CadencePreset, string>> = {
  discovery: {
    off: 'No automatic runs',
    low: `${MAINTENANCE_PRESET_DEFINITIONS.low.discoveryRunsPerDay} run/day (${MAINTENANCE_PRESET_DEFINITIONS.low.discoverySchedule})`,
    normal: `${MAINTENANCE_PRESET_DEFINITIONS.normal.discoveryRunsPerDay} runs/day (${MAINTENANCE_PRESET_DEFINITIONS.normal.discoverySchedule})`,
    high: `${MAINTENANCE_PRESET_DEFINITIONS.high.discoveryRunsPerDay} runs/day (${MAINTENANCE_PRESET_DEFINITIONS.high.discoverySchedule})`,
  },
  verify_stale: {
    off: 'No automatic refreshes',
    low: `Up to ${MAINTENANCE_PRESET_DEFINITIONS.low.verificationContactsPerDay} contacts/day`,
    normal: `Up to ${MAINTENANCE_PRESET_DEFINITIONS.normal.verificationContactsPerDay} contacts/day`,
    high: `Up to ${MAINTENANCE_PRESET_DEFINITIONS.high.verificationContactsPerDay} contacts/day`,
  },
  embeddings_drain: {
    off: 'Manual only',
    low: '',
    normal: 'Drains every 5 min when pending',
    high: '',
  },
};

const STUCK_AFTER_MS = 2 * 60 * 1000;

// Apify is a legacy enrichment provider that almost always reports zero usage
// in the current pipeline. Hide its metrics by default to reduce admin noise;
// staff diagnosing an issue can flip VITE_SHOW_APIFY=1 to see them.
const SHOW_APIFY_METRICS = import.meta.env.VITE_SHOW_APIFY === '1' || import.meta.env.VITE_SHOW_APIFY === 'true';

function serviceLabelForKind(kind: string): string {
  return AGENTS.find((agent) => agent.kind === kind)?.label || 'Service run';
}

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

export default function SystemHealthPanel({
  mode = 'all',
}: {
  mode?: 'maintenance' | 'settings' | 'all';
}) {
  const { isAdmin } = useAuth();
  const isSettings = mode === 'settings';
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
  const [schedules, setSchedules] = useState<AgentSchedule[]>([]);
  const [staleCount, setStaleCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [connectivity, setConnectivity] = useState<'idle' | 'ok' | 'failed'>('idle');
  const hasLoadedRef = useRef(false);

  const loadData = useCallback(async () => {
    if (!hasLoadedRef.current) setLoading(true);
    try {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const [
        runsRes,
        todayRunsRes,
        pendingQueueRes,
        runningQueueRes,
        oldestQueueRes,
        batchesRes,
        schedulesRes,
        staleRes,
      ] = await Promise.all([
        supabase
          .from('agent_runs')
          .select('*')
          .gte('created_at', thirtyDaysAgo)
          .order('created_at', { ascending: false })
          .limit(1000),
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
        supabase.functions.invoke('agent-scheduler', {
          body: { action: 'list_schedules' },
        }),
        supabase
          .from('people')
          .select('id', { count: 'exact', head: true })
          .lt('updated_at', thirtyDaysAgo),
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
      if (schedulesRes.error) {
        console.warn('[SystemHealthPanel] schedules unavailable', schedulesRes.error);
        setSchedules([]);
      } else {
        const payload = schedulesRes.data as { schedules?: AgentSchedule[] } | null;
        setSchedules(payload?.schedules ?? []);
      }
      if (staleRes.error) {
        console.warn('[SystemHealthPanel] stale count unavailable', staleRes.error);
        setStaleCount(0);
      } else {
        setStaleCount(staleRes.count || 0);
      }
    } catch (err) {
      notifyError(err, { hint: 'Could not load system health data.' });
    } finally {
      setLoading(false);
      hasLoadedRef.current = true;
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const hasActiveWork = useMemo(
    () =>
      runs.some((run) => run.status === 'running' || run.status === 'pending') ||
      queueHealth.running > 0,
    [runs, queueHealth.running]
  );

  useEffect(() => {
    if (!hasActiveWork) return;
    const interval = window.setInterval(loadData, 15000);
    return () => window.clearInterval(interval);
  }, [hasActiveWork, loadData]);

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

  const usageByDay = useMemo(() => {
    return Array.from({ length: 14 }, (_, index) => {
      const date = new Date();
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() - (13 - index));
      const dayKey = date.toISOString().slice(0, 10);
      const dayRuns = runs.filter((run) => run.created_at.slice(0, 10) === dayKey);
      return {
        dayKey,
        label: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        ...totalUsage(dayRuns),
      };
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

  const setPreset = useCallback(
    async (jobKind: JobKind, preset: CadencePreset) => {
      setActionLoading(`preset:${jobKind}`);
      try {
        const { error } = await supabase.functions.invoke('agent-scheduler', {
          body: { action: 'set_schedule', job_kind: jobKind, cadence_preset: preset },
        });
        if (error) throw error;
        notifySuccess(`${PRESET_LABELS[preset]} schedule applied.`);
        await loadData();
      } catch (err) {
        notifyError(err, { hint: 'Could not update schedule. Admin role required.' });
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
        <Loader2
          className={`w-6 h-6 animate-spin ${
            isSettings ? 'text-teal-600' : 'text-yellow-600'
          }`}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">
            {mode === 'maintenance' ? 'Maintenance Runs' : mode === 'settings' ? 'System' : 'System Health'}
          </h2>
          <p className="text-sm text-gray-600">
            {mode === 'maintenance'
              ? 'Automatic discovery and verification runs, queues, and recovery actions.'
              : mode === 'settings'
                ? 'Connected services, API usage, credentials, and connectivity checks.'
                : 'Service status, queue health, usage, and operator actions.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {mode !== 'maintenance' && (
          <button
            type="button"
            onClick={testConnectivity}
            disabled={actionLoading === 'connectivity'}
            title="Run a lightweight Supabase query to confirm the URL, anon key, and RLS policies still work."
            aria-label="Test Supabase connectivity"
            className="inline-flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {actionLoading === 'connectivity' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
            Test Supabase
          </button>
          )}
          {mode !== 'settings' && (
          <button
            type="button"
            onClick={runHousekeeping}
            disabled={actionLoading === 'housekeeping'}
            title="Mark stuck (zombie) agent runs as failed and free their slots so new runs can start."
            aria-label="Run housekeeping to clear stuck agent runs"
            className="inline-flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {actionLoading === 'housekeeping' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Run Housekeeping
          </button>
          )}
          <button
            type="button"
            onClick={loadData}
            className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              isSettings
                ? 'bg-teal-600 text-white hover:bg-teal-700'
                : 'bg-yellow-400 text-gray-900 hover:bg-yellow-500'
            }`}
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
        </div>
      </div>

      {mode !== 'maintenance' && connectivity === 'ok' && (
        <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          <CheckCircle2 className="h-4 w-4" />
          Supabase connectivity is healthy.
        </div>
      )}
      {mode !== 'maintenance' && connectivity === 'failed' && (
        <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <AlertTriangle className="h-4 w-4" />
          Supabase connectivity failed. See the toast details and RUNBOOK [auth_failed] or [network].
        </div>
      )}

      {mode !== 'settings' && <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {summaries
          .filter((s) => s.kind !== 'embeddings')
          .map((summary) => {
            const agent = AGENTS.find((a) => a.kind === summary.kind);
            const schedule = agent?.jobKind
              ? schedules.find((s) => s.job_kind === agent.jobKind) ?? null
              : null;
            return (
              <AgentScheduleCard
                key={summary.kind}
                summary={summary}
                schedule={schedule}
                staleCount={summary.kind === 'verification' ? staleCount : null}
                isAdmin={isAdmin}
                actionLoading={actionLoading}
                onRunNow={runNow}
                onCancel={cancelRun}
                onPresetChange={setPreset}
              />
            );
          })}
      </div>}

      {mode !== 'settings' && <SearchIndexFooter
        queueHealth={queueHealth}
        embeddingBatches={embeddingBatches}
        schedule={schedules.find((s) => s.job_kind === 'embeddings_drain') ?? null}
        actionLoading={actionLoading}
        onRunNow={() => runNow('embeddings')}
      />}

      {mode !== 'maintenance' && <div className="rounded-md border border-gray-200 bg-white p-5">
        <div className="mb-4 flex items-center gap-2">
          <Zap className="h-5 w-5 text-amber-600" />
          <h3 className="font-semibold text-gray-900">API Usage</h3>
        </div>
        {(() => {
          const showApify =
            SHOW_APIFY_METRICS || todayUsage.apifyCalls > 0 || todayUsage.apifyCredits > 0;
          return (
            <div
              className={`grid grid-cols-2 gap-3 text-sm ${showApify ? 'md:grid-cols-5' : 'md:grid-cols-3'}`}
            >
              <Metric label="Gemini calls" value={todayUsage.geminiCalls.toLocaleString()} />
              <Metric label="Tavily calls" value={todayUsage.tavilyCalls.toLocaleString()} />
              {showApify && (
                <>
                  <Metric label="Apify calls" value={todayUsage.apifyCalls.toLocaleString()} />
                  <Metric label="Apify credits" value={todayUsage.apifyCredits.toLocaleString()} />
                </>
              )}
              <Metric
                label="Est. cost"
                value={
                  todayUsage.geminiCalls === 0 && todayUsage.tavilyCalls === 0
                    ? '—'
                    : `$${todayUsage.estimatedCostUsd.toFixed(4)}`
                }
              />
            </div>
          );
        })()}
        <UsageChart days={usageByDay} settings={isSettings} />
      </div>
      }

      {mode === 'settings' && <MaintenancePresetDefinitions />}

      {mode !== 'maintenance' && (
        <div className="rounded-md border border-gray-200 bg-white p-5">
          <div className="mb-4">
            <h3 className="font-semibold text-gray-900">Connected Services</h3>
            <p className="mt-1 text-sm text-gray-500">
              Manage ongoing integrations and add credentials in their secure dashboards.
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <ServiceCard name="Supabase" detail="Database, authentication, and server functions" active />
            <ServiceCard name="Gemini" detail="Discovery and verification reasoning" active={todayUsage.geminiCalls > 0} />
            <ServiceCard name="Tavily" detail="Web discovery and evidence search" active={todayUsage.tavilyCalls > 0} />
            <ServiceCard name="Vercel" detail="Production hosting and frontend variables" active />
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <a
              href="https://supabase.com/dashboard/project/ofzuhajxwxggybkuzefq/settings/functions"
              target="_blank"
              rel="noreferrer"
              className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                isSettings
                  ? 'bg-teal-600 text-white hover:bg-teal-700'
                  : 'bg-yellow-400 text-gray-900 hover:bg-yellow-500'
              }`}
            >
              Add backend API key
              <ExternalLink className="h-4 w-4" />
            </a>
            <a
              href="https://vercel.com/milan477s-projects/flemish-network/settings/environment-variables"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Manage frontend variables
              <ExternalLink className="h-4 w-4" />
            </a>
          </div>
          <p className="mt-3 text-xs text-gray-500">
            Secret values are stored by Supabase or Vercel and are never displayed in this app.
          </p>
        </div>
      )}

      {mode !== 'settings' && <div className="rounded-md border border-gray-200 bg-white">
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
                  <div className="font-medium text-gray-900">{serviceLabelForKind(run.agent_type)}</div>
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
      </div>}
    </div>
  );
}

function MaintenancePresetDefinitions() {
  return (
    <section className="rounded-md border border-gray-200 bg-white p-5">
      <div className="mb-4">
        <h3 className="font-semibold text-gray-900">Run Intensity Variables</h3>
        <p className="mt-1 text-sm text-gray-500">
          These values define Light, Normal, and Aggressive wherever a maintenance schedule is selected.
        </p>
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        {CONFIGURABLE_CADENCE_PRESETS.map((preset) => {
          const definition = MAINTENANCE_PRESET_DEFINITIONS[preset];
          return (
            <div
              key={preset}
              className={`rounded-lg border p-4 ${
                preset === 'normal'
                  ? 'border-teal-200 bg-teal-50/50'
                  : 'border-gray-200 bg-gray-50/50'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-sm font-semibold text-gray-900">{PRESET_LABELS[preset]}</h4>
                {preset === 'normal' && (
                  <span className="rounded-full bg-teal-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-teal-700">
                    Default
                  </span>
                )}
              </div>
              <dl className="mt-4 space-y-3">
                <div>
                  <dt className="text-xs text-gray-500">Discovery runs/day</dt>
                  <dd className="mt-0.5 text-lg font-semibold text-gray-900">
                    {definition.discoveryRunsPerDay}
                  </dd>
                  <dd className="text-xs text-gray-500">{definition.discoverySchedule}</dd>
                </div>
                <div className="border-t border-gray-200 pt-3">
                  <dt className="text-xs text-gray-500">Contacts verified/day</dt>
                  <dd className="mt-0.5 text-lg font-semibold text-gray-900">
                    {definition.verificationContactsPerDay}
                  </dd>
                </div>
              </dl>
            </div>
          );
        })}
      </div>
      <p className="mt-4 text-xs text-gray-500">
        Schedule times use UTC. Change the active preset from Grow → Runs or Grow → Maintenance.
      </p>
    </section>
  );
}

function UsageChart({
  days,
  settings,
}: {
  days: Array<UsageTotals & { dayKey: string; label: string }>;
  settings: boolean;
}) {
  const maxCalls = Math.max(1, ...days.map((day) => day.geminiCalls + day.tavilyCalls));

  return (
    <div className="mt-6 border-t border-gray-100 pt-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h4 className="text-sm font-medium text-gray-700">Last 14 days</h4>
        <div className="flex gap-3 text-xs text-gray-500">
          <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-indigo-500" />Gemini</span>
          <span>
            <span
              className={`mr-1 inline-block h-2 w-2 rounded-full ${
                settings ? 'bg-teal-500' : 'bg-yellow-500'
              }`}
            />
            Tavily
          </span>
        </div>
      </div>
      <div className="flex h-32 items-end gap-1.5" aria-label="API calls over the last 14 days">
        {days.map((day) => {
          const geminiHeight = (day.geminiCalls / maxCalls) * 100;
          const tavilyHeight = (day.tavilyCalls / maxCalls) * 100;
          return (
            <div key={day.dayKey} className="group relative flex h-full flex-1 items-end justify-center gap-px" title={`${day.label}: ${day.geminiCalls} Gemini, ${day.tavilyCalls} Tavily`}>
              <div className="w-1/2 rounded-t bg-indigo-500" style={{ height: `${Math.max(geminiHeight, day.geminiCalls ? 3 : 0)}%` }} />
              <div
                className={`w-1/2 rounded-t ${settings ? 'bg-teal-500' : 'bg-yellow-500'}`}
                style={{ height: `${Math.max(tavilyHeight, day.tavilyCalls ? 3 : 0)}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between text-[10px] text-gray-400">
        <span>{days[0]?.label}</span>
        <span>{days[days.length - 1]?.label}</span>
      </div>
    </div>
  );
}

function ServiceCard({ name, detail, active }: { name: string; detail: string; active: boolean }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-gray-900">{name}</span>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${active ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'}`}>
          {active ? 'Connected' : 'No recent usage'}
        </span>
      </div>
      <p className="mt-2 text-xs leading-5 text-gray-500">{detail}</p>
    </div>
  );
}

function AgentScheduleCard({
  summary,
  schedule,
  staleCount,
  isAdmin,
  actionLoading,
  onRunNow,
  onCancel,
  onPresetChange,
}: {
  summary: AgentSummary;
  schedule: AgentSchedule | null;
  staleCount: number | null;
  isAdmin: boolean;
  actionLoading: string | null;
  onRunNow: (kind: HealthAgentKind) => void;
  onCancel: (runId: string) => void;
  onPresetChange: (jobKind: JobKind, preset: CadencePreset) => void;
}) {
  const runningRun = summary.running && 'agent_type' in summary.running ? summary.running : null;
  const lastFailureAt = runCompletedAt(summary.lastFailure) || runStartedAt(summary.lastFailure);
  const lastSuccessAt = runCompletedAt(summary.lastSuccess) || runStartedAt(summary.lastSuccess);
  // Only surface the failure banner when the most recent failure is newer
  // than the most recent success — otherwise the banner is stale and lies
  // about current health (see UX_REMEDIATION_2026-05-08 phase 2C).
  const failureIsCurrent = Boolean(
    lastFailureAt && (!lastSuccessAt || new Date(lastFailureAt).getTime() > new Date(lastSuccessAt).getTime())
  );
  const failureMessage = failureIsCurrent
    ? summary.lastFailure && 'error_message' in summary.lastFailure
      ? summary.lastFailure.error_message
      : summary.lastFailure && 'last_error' in summary.lastFailure
        ? summary.lastFailure.last_error
        : null
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
          className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-yellow-400 text-gray-900 hover:bg-yellow-500 disabled:opacity-50"
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

      {schedule && schedule.job_kind !== 'embeddings_drain' && (
        <div className="mt-4 border-t border-gray-100 pt-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium uppercase tracking-wide text-gray-500">Schedule</span>
            <span className="text-xs text-gray-500">
              {schedule.cadence_preset === 'off'
                ? 'Paused'
                : `Next: ${formatRelative(schedule.next_run_at)}`}
            </span>
          </div>
          <div className="grid grid-cols-4 gap-1">
            {(['off', 'low', 'normal', 'high'] as CadencePreset[]).map((preset) => {
              const active = schedule.cadence_preset === preset;
              return (
                <button
                  key={preset}
                  type="button"
                  disabled={!isAdmin || actionLoading === `preset:${schedule.job_kind}`}
                  onClick={() => onPresetChange(schedule.job_kind, preset)}
                  className={`rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
                    active
                      ? 'bg-yellow-400 text-gray-900'
                      : 'bg-gray-50 text-gray-700 hover:bg-gray-100 disabled:hover:bg-gray-50'
                  } disabled:opacity-60 disabled:cursor-not-allowed`}
                  title={PRESET_DESCRIPTIONS[schedule.job_kind][preset]}
                >
                  {PRESET_LABELS[preset]}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-gray-500">
            Schedule: {PRESET_DESCRIPTIONS[schedule.job_kind][schedule.cadence_preset]}
          </p>
          {schedule.job_kind === 'verify_stale' && staleCount !== null && staleCount > 0 && (
            <p className="mt-1 text-xs text-gray-500">
              <span className="font-medium text-gray-700">{staleCount.toLocaleString()}</span>{' '}
              contact{staleCount === 1 ? '' : 's'} need refresh
              {schedule.cadence_preset !== 'off' && (
                <>
                  {' '}— full cycle in ~
                  <span className="font-medium text-gray-700">
                    {Math.ceil(staleCount / verifyPerDay(schedule.cadence_preset))}
                  </span>{' '}
                  days at this pace
                </>
              )}
            </p>
          )}
          {!isAdmin && (
            <p className="mt-1 text-xs text-gray-400">Admin role required to change schedule.</p>
          )}
        </div>
      )}

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

function verifyPerDay(preset: CadencePreset): number {
  if (preset !== 'off') {
    return MAINTENANCE_PRESET_DEFINITIONS[preset].verificationContactsPerDay;
  }
  return 1;
}

function formatRelative(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'momentarily';
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `in ${hours}h`;
  const days = Math.round(hours / 24);
  return `in ${days}d`;
}

function SearchIndexFooter({
  queueHealth,
  embeddingBatches,
  schedule,
  actionLoading,
  onRunNow,
}: {
  queueHealth: QueueHealth;
  embeddingBatches: EmbeddingBatchRun[];
  schedule: AgentSchedule | null;
  actionLoading: string | null;
  onRunNow: () => void;
}) {
  const pending = queueHealth.pending;
  const lastSuccess = embeddingBatches.find((b) => b.status === 'succeeded') || null;
  const lastDrainAt = lastSuccess?.completed_at || lastSuccess?.created_at || null;
  const stuck =
    pending > 0 &&
    (!lastDrainAt || Date.now() - new Date(lastDrainAt).getTime() > 30 * 60 * 1000);

  let statusLine = 'Search index up to date';
  let icon = <CheckCircle2 className="h-4 w-4 text-green-600" />;
  if (pending > 0 && !stuck) {
    statusLine = `${pending.toLocaleString()} search-index record${pending === 1 ? '' : 's'} pending — draining`;
    icon = <Loader2 className="h-4 w-4 animate-spin text-yellow-600" />;
  } else if (stuck) {
    statusLine = `${pending.toLocaleString()} search-index record${pending === 1 ? '' : 's'} pending — last drain ${
      lastDrainAt ? formatAge(lastDrainAt) + ' ago' : 'never'
    }`;
    icon = <AlertTriangle className="h-4 w-4 text-amber-600" />;
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-gray-200 bg-gray-50 px-4 py-3">
      <div className="flex items-center gap-2 text-sm text-gray-700">
        {icon}
        <span>{statusLine}</span>
        {schedule?.last_run_at && pending === 0 && (
          <span className="text-xs text-gray-500">· last drain {formatAge(schedule.last_run_at)} ago</span>
        )}
      </div>
      {(pending > 0 || stuck) && (
        <button
          type="button"
          onClick={onRunNow}
          disabled={actionLoading === 'run:embeddings'}
          title="Flush the embedding queue: process pending search-index records now instead of waiting for the next scheduled drain."
          aria-label="Drain the embedding queue now"
          className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
        >
          {actionLoading === 'run:embeddings' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Drain now
        </button>
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
