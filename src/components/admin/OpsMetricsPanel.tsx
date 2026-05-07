import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { supabase } from '../../lib/supabase';

type ModelDefaults = Record<string, string[] | string>;

interface PhaseMetric {
  metric_key: string;
  metric_value: number | string | null;
  unit: string;
  description: string;
}

interface MetricsPayload {
  generated_at: string;
  model_defaults: ModelDefaults;
  phase_metrics: PhaseMetric[];
}

const METRIC_ORDER = [
  'search_benchmark_success_rate_pct',
  'discovery_source_recall_pct',
  'discovery_approved_per_100_fetched_pages',
  'discovery_multi_evidence_rate_pct',
  'discovery_review_approval_rate_pct',
  'profile_suggestion_approval_rate_pct',
  'discovery_duplicate_rate_pct',
  'profiles_with_embeddings_pct',
  'profiles_with_verified_us_location_pct',
  'gap_closure_rate_pct',
  'connection_suggestion_acceptance_rate_pct',
] as const;

const METRIC_LABELS: Record<string, string> = {
  profile_suggestion_approval_rate_pct: 'record suggestion approval rate pct',
  profiles_with_embeddings_pct: 'records with embeddings pct',
  profiles_with_verified_us_location_pct: 'records with verified US location pct',
};

function formatMetricLabel(metricKey: string): string {
  return METRIC_LABELS[metricKey] || metricKey.replace(/_/g, ' ');
}

function formatMetricValue(metric: PhaseMetric): string {
  const rawValue =
    typeof metric.metric_value === 'string'
      ? Number(metric.metric_value)
      : metric.metric_value;

  if (rawValue === null || rawValue === undefined || Number.isNaN(rawValue)) {
    return '—';
  }

  if (metric.unit === 'percent') {
    return `${rawValue.toFixed(2)}%`;
  }

  if (metric.unit === 'count') {
    return rawValue.toFixed(2).replace(/\.00$/, '');
  }

  return String(rawValue);
}

function formatModelChain(value: string[] | string): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value) || value.length === 0) return 'Not configured';
  if (value.length === 1) return value[0];
  return `${value[0]} -> ${value.slice(1).join(' -> ')}`;
}

function isPreviewModel(value: string[] | string): boolean {
  const models = Array.isArray(value) ? value : [value];
  return models.some((model) => model.includes('preview'));
}

export default function OpsMetricsPanel() {
  const [payload, setPayload] = useState<MetricsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadMetrics = useCallback(async () => {
    setLoading(true);
    setError(null);

    const { data, error: invokeError } = await supabase.functions.invoke(
      'agent-scheduler',
      {
        body: { action: 'metrics' },
      }
    );

    if (invokeError) {
      setError(invokeError.message);
      setLoading(false);
      return;
    }

    setPayload((data?.metrics || null) as MetricsPayload | null);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadMetrics();
  }, [loadMetrics]);

  const orderedMetrics = useMemo(() => {
    const metrics = payload?.phase_metrics || [];
    return metrics.slice().sort((a, b) => {
      const aIndex = METRIC_ORDER.indexOf(a.metric_key as (typeof METRIC_ORDER)[number]);
      const bIndex = METRIC_ORDER.indexOf(b.metric_key as (typeof METRIC_ORDER)[number]);
      const normalizedA = aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex;
      const normalizedB = bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex;
      return normalizedA - normalizedB;
    });
  }, [payload]);

  const modelEntries = useMemo(
    () =>
      Object.entries(payload?.model_defaults || {}).filter(
        ([key]) => !key.startsWith('_')
      ),
    [payload]
  );

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
            <h3 className="text-base font-semibold text-gray-900">Model & Metrics</h3>
            <p className="text-xs text-red-500 mt-1">
              {error || 'Metrics are unavailable.'}
            </p>
          </div>
          <button
            onClick={loadMetrics}
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
    <div className="space-y-4">
      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h3 className="text-base font-semibold text-gray-900">Model & Metrics</h3>
            <p className="text-xs text-gray-500 mt-1">
              Stable Gemini 2.5 production defaults plus the Phase 5 success metrics.
            </p>
          </div>
          <button
            onClick={loadMetrics}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {modelEntries.map(([key, value]) => (
            <div
              key={key}
              className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-3"
            >
              <div className="flex items-center justify-between gap-3 mb-1.5">
                <p className="text-[11px] uppercase tracking-wide text-gray-500 font-medium">
                  {key.replace(/_/g, ' ')}
                </p>
                <span
                  className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                    isPreviewModel(value)
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-emerald-100 text-emerald-700'
                  }`}
                >
                  {isPreviewModel(value) ? 'Preview Override' : 'Stable Default'}
                </span>
              </div>
              <p className="text-sm text-gray-800 leading-relaxed">
                {formatModelChain(value)}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {orderedMetrics.map((metric) => (
          <div
            key={metric.metric_key}
            className="bg-white rounded-xl p-4 shadow-sm border border-gray-100"
          >
            <p className="text-[11px] uppercase tracking-wide text-gray-500 font-medium">
              {formatMetricLabel(metric.metric_key)}
            </p>
            <p className="text-2xl font-semibold text-gray-900 mt-2">
              {formatMetricValue(metric)}
            </p>
            <p className="text-xs text-gray-500 mt-2 leading-relaxed">
              {metric.description}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
