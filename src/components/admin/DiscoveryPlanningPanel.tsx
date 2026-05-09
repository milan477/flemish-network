import { useCallback, useEffect, useState } from 'react';
import {
  Loader2,
  Sparkles,
  Play,
  Search,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';

export interface RecommendedAction {
  id: string;
  action_type: 'entity_pivot' | 'gap_refresh' | 'domain_revisit';
  title: string;
  detail: string;
  query: string;
  priority_score: number;
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

interface ReflectionSuggestion {
  id: string;
  surface: string | null;
  lens: string | null;
  context_key: string;
  rationale: string;
  generated_at: string;
  consumed_attempt_count: number;
  expires_at: string;
}

interface DiscoveryPlanningPanelProps {
  onRunDiscovery: (action: RecommendedAction) => void;
  onStartDiscovery: () => void;
  onExploreSuggestion: (suggestionId: string, surface: string | null, lens: string | null) => void;
  isRunning: boolean;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function SurfaceBadge({ label }: { label: string }) {
  const display = label.replace(/_/g, ' ');
  return (
    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-teal-50 text-teal-700 border border-teal-100 capitalize">
      {display}
    </span>
  );
}

function LensBadge({ label }: { label: string }) {
  const display = label.replace(/_/g, ' ');
  return (
    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-100 capitalize">
      {display}
    </span>
  );
}

export default function DiscoveryPlanningPanel({
  onStartDiscovery,
  onExploreSuggestion,
  isRunning,
}: DiscoveryPlanningPanelProps) {
  const [reflectionSuggestions, setReflectionSuggestions] = useState<ReflectionSuggestion[]>([]);
  const [reflectionLoading, setReflectionLoading] = useState(true);
  const [reflectionRunning, setReflectionRunning] = useState(false);
  const [reflectionError, setReflectionError] = useState<string | null>(null);

  const loadReflection = useCallback(async () => {
    setReflectionLoading(true);
    setReflectionError(null);
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('discovery_reflection_suggestions')
      .select('id,surface,lens,context_key,rationale,generated_at,consumed_attempt_count,expires_at')
      .gt('expires_at', now)
      .order('generated_at', { ascending: false })
      .limit(20);
    if (error) {
      setReflectionError(error.message);
    } else {
      setReflectionSuggestions((data || []) as ReflectionSuggestion[]);
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
      await loadReflection();
    } else {
      setReflectionError(data?.message || 'Reflection run returned an unexpected response');
    }
    setReflectionRunning(false);
  }, [loadReflection]);

  useEffect(() => {
    loadReflection();
  }, [loadReflection]);

  return (
    <div className="space-y-4">
      {/* Main card — matches verification page pattern */}
      <div className="rounded-xl border border-gray-100 bg-white shadow-sm">
        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100">
          <Sparkles className="w-4 h-4 text-violet-500" />
          <h2 className="text-lg font-semibold text-gray-900">Where to look next</h2>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">
            {reflectionSuggestions.length}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => void runReflectionNow()}
              disabled={reflectionRunning}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-50"
            >
              {reflectionRunning ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Play className="w-3.5 h-3.5" />
              )}
              Refresh suggestions
            </button>
            <button
              onClick={() => {
                const top = reflectionSuggestions.find((s) => s.consumed_attempt_count === 0)
                  || reflectionSuggestions[0];
                if (top) {
                  onExploreSuggestion(top.id, top.surface, top.lens);
                } else {
                  onStartDiscovery();
                }
              }}
              disabled={isRunning}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors disabled:opacity-50"
              title={
                reflectionSuggestions.length > 0
                  ? 'Run discovery on the top unresolved suggestion'
                  : 'No suggestions available — falls back to bandit allocation'
              }
            >
              {isRunning ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Search className="w-3.5 h-3.5" />
              )}
              Start discovery run
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-4">
          {reflectionError && (
            <p className="text-xs text-red-500 mb-3">{reflectionError}</p>
          )}

          {reflectionLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="w-5 h-5 animate-spin text-gray-300" />
            </div>
          ) : reflectionSuggestions.length === 0 ? (
            <div className="rounded-xl border border-gray-100 bg-gray-50 p-6 text-center">
              <p className="text-sm text-gray-500">No exploration suggestions yet</p>
              <p className="mt-1 text-xs text-gray-400">
                Click "Refresh suggestions" to generate AI-guided search directions.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {reflectionSuggestions.map((s) => (
                <div
                  key={s.id}
                  className="bg-white rounded-xl border border-gray-200 hover:border-gray-300 transition-all px-5 py-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex flex-wrap gap-1.5">
                        {s.surface && <SurfaceBadge label={s.surface} />}
                        {s.lens && <LensBadge label={s.lens} />}
                        {s.context_key && (
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">
                            {s.context_key.replace(/_/g, ' ')}
                          </span>
                        )}
                      </div>
                      <p className="text-sm font-medium text-gray-900 leading-snug">{s.rationale}</p>
                      <p className="text-[11px] text-gray-400">
                        Generated {formatDate(s.generated_at)}
                        {s.consumed_attempt_count > 0 && ` · used ${s.consumed_attempt_count}×`}
                      </p>
                    </div>
                    <button
                      onClick={() => onExploreSuggestion(s.id, s.surface, s.lens)}
                      disabled={isRunning}
                      className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors disabled:opacity-50"
                    >
                      {isRunning ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Search className="w-3.5 h-3.5" />
                      )}
                      Explore
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
