import { useEffect, useState, useCallback } from 'react';
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Search,
  ShieldCheck,
  Link2,
  RefreshCw,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface AgentRun {
  id: string;
  agent_type: string;
  status: string;
  params: Record<string, unknown> | null;
  started_at: string | null;
  completed_at: string | null;
  results: Record<string, unknown> | null;
  error_message: string | null;
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
  verification: { label: 'Verification', icon: ShieldCheck },
  connection: { label: 'Connections', icon: Link2 },
};

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

  const loadData = useCallback(async () => {
    const [runsRes, quotasRes, suggestionsRes] = await Promise.all([
      supabase
        .from('agent_runs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20),
      supabase
        .from('api_quotas')
        .select('*')
        .eq('month', new Date().toISOString().slice(0, 7)),
      supabase
        .from('profile_suggestions')
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

  const triggerAgent = useCallback(
    async (agentType: string, params?: Record<string, unknown>) => {
      setTriggerLoading(agentType);
      try {
        const resp = await supabase.functions.invoke('agent-scheduler', {
          body: { agent_type: agentType, params: params || {} },
        });

        if (resp.error) throw resp.error;
      } catch {
        // trigger failed
      }
      setTriggerLoading(null);
      await loadData();
    },
    [loadData]
  );

  const handleDiscoveryTrigger = useCallback(() => {
    if (!discoveryQuery.trim()) return;
    triggerAgent('discovery', { query: discoveryQuery.trim() });
    setDiscoveryQuery('');
    setShowQueryInput(false);
  }, [discoveryQuery, triggerAgent]);

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

  const formatDuration = (start: string | null, end: string | null) => {
    if (!start || !end) return '—';
    const ms = new Date(end).getTime() - new Date(start).getTime();
    if (ms < 1000) return '<1s';
    if (ms < 60000) return `${Math.round(ms / 1000)}s`;
    return `${Math.round(ms / 60000)}m`;
  };

  const summarizeResults = (run: AgentRun): string => {
    if (!run.results) return '—';
    const r = run.results;
    const parts: string[] = [];
    if (typeof r.profiles_found === 'number') parts.push(`${r.profiles_found} found`);
    if (typeof r.suggestions_created === 'number') parts.push(`${r.suggestions_created} suggestions`);
    if (typeof r.profiles_checked === 'number') parts.push(`${r.profiles_checked} checked`);
    if (typeof r.profiles_verified === 'number') parts.push(`${r.profiles_verified} verified`);
    if (typeof r.connections_found === 'number') parts.push(`${r.connections_found} connections`);
    if (typeof r.new_connections_created === 'number') parts.push(`${r.new_connections_created} new`);
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
      {/* Manual Trigger Buttons */}
      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-gray-900">Run Agents</h3>
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
                  placeholder="Search query..."
                  className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 w-64"
                  autoFocus
                />
                <button
                  onClick={handleDiscoveryTrigger}
                  disabled={!discoveryQuery.trim()}
                  className="px-3 py-2 text-sm font-medium text-blue-600 hover:bg-blue-50 rounded-lg disabled:opacity-50"
                >
                  Go
                </button>
              </div>
            )}
          </div>

          <button
            onClick={() => triggerAgent('verification', { batch_size: 10 })}
            disabled={triggerLoading === 'verification'}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors disabled:opacity-50"
          >
            {triggerLoading === 'verification' ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <ShieldCheck className="w-4 h-4" />
            )}
            Verification
          </button>

          <button
            onClick={() => triggerAgent('connection', { types: ['colleague', 'alumni', 'local_peer'] })}
            disabled={triggerLoading === 'connection'}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50"
          >
            {triggerLoading === 'connection' ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Link2 className="w-4 h-4" />
            )}
            Connections
          </button>
        </div>
      </div>

      {/* API Quota Bars + Pending Actions */}
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
              <p className="text-xs text-yellow-600 mt-1">Pending Suggestions</p>
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

      {/* Run History Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-6 pb-3">
          <h3 className="text-base font-semibold text-gray-900">Run History</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-y border-gray-100">
              <tr>
                <th className="text-left py-2.5 px-4 font-medium text-gray-500">Agent</th>
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
                    No agent runs yet. Use the buttons above to trigger one.
                  </td>
                </tr>
              ) : (
                runs.map((run) => {
                  const style = STATUS_STYLES[run.status] || STATUS_STYLES.pending;
                  const StatusIcon = style.icon;
                  const agent = AGENT_LABELS[run.agent_type];

                  return (
                    <tr key={run.id} className="hover:bg-gray-50/50">
                      <td className="py-2.5 px-4">
                        <span className="font-medium text-gray-900">
                          {agent?.label || run.agent_type}
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
                        {formatDuration(run.started_at, run.completed_at)}
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
