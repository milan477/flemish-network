import { useCallback, useEffect, useState } from 'react';
import {
  ChevronDown,
  Loader2,
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

function formatCategoryValue(value: string): string {
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

const CONTEXT_LABELS: Record<string, string> = {
  geo: 'Location',
  domain: 'Domain',
  sector: 'Sector',
  stage: 'Career stage',
};

interface ProposalCategory {
  label: string;
  value: string;
}

function getProposalCategories(suggestion: ReflectionSuggestion): ProposalCategory[] {
  const categories: ProposalCategory[] = [];
  const contextParts = suggestion.context_key
    .split(/[,;|](?=[a-z_ ]+:)/i)
    .map((part) => part.trim())
    .filter(Boolean);

  contextParts.forEach((part) => {
    const separatorIndex = part.indexOf(':');
    if (separatorIndex > 0) {
      const key = part.slice(0, separatorIndex).trim().toLowerCase();
      const value = part.slice(separatorIndex + 1).trim();
      if (value) {
        categories.push({
          label: CONTEXT_LABELS[key] || formatCategoryValue(key),
          value: formatCategoryValue(value),
        });
      }
    } else {
      categories.push({ label: 'Focus', value: formatCategoryValue(part) });
    }
  });

  if (contextParts.length === 0 && suggestion.context_key.trim()) {
    categories.push({ label: 'Focus', value: formatCategoryValue(suggestion.context_key) });
  }

  if (suggestion.surface) {
    categories.push({ label: 'Source', value: formatCategoryValue(suggestion.surface) });
  }
  if (suggestion.lens) {
    categories.push({ label: 'Approach', value: formatCategoryValue(suggestion.lens) });
  }

  return categories;
}

function getProposalTitle(suggestion: ReflectionSuggestion, categories: ProposalCategory[]): string {
  const location = categories.find((category) => category.label === 'Location');
  const sector = categories.find((category) => category.label === 'Sector');
  const domain = categories.find((category) => category.label === 'Domain');
  const careerStage = categories.find((category) => category.label === 'Career stage');

  if (location && sector) return `${sector.value} in ${location.value}`;
  if (location && domain) return `${domain.value} in ${location.value}`;
  if (careerStage && sector) return `${careerStage.value} · ${sector.value}`;

  const primaryCategory = categories[0];
  if (primaryCategory) return primaryCategory.value;
  if (suggestion.surface) return formatCategoryValue(suggestion.surface);
  if (suggestion.lens) return formatCategoryValue(suggestion.lens);
  return 'Open exploration';
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
      <section className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
        <div className="flex flex-col gap-5 border-b border-gray-100 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="max-w-2xl">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold text-gray-900">Where to look next</h2>
              <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-600">
                {reflectionSuggestions.length}
              </span>
            </div>
            <p className="mt-1 text-sm leading-6 text-gray-500">
              Focused proposals based on gaps in the current network. Review the categories, then launch the most useful search.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => void runReflectionNow()}
              disabled={reflectionRunning}
              className="flex items-center gap-1.5 rounded-lg bg-gray-100 px-3 py-2 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-200 disabled:opacity-50"
            >
              {reflectionRunning ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Play className="w-3.5 h-3.5" />
              )}
              Refresh proposals
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
              className="flex items-center gap-1.5 rounded-lg bg-yellow-400 px-3 py-2 text-xs font-semibold text-gray-900 transition-colors hover:bg-yellow-500 disabled:opacity-50"
              title={
                reflectionSuggestions.length > 0
                  ? 'Launch discovery on the top unresolved proposal'
                  : 'No suggestions available — falls back to bandit allocation'
              }
            >
              {isRunning ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Search className="w-3.5 h-3.5" />
              )}
              Launch next proposal
            </button>
          </div>
        </div>

        <div className="bg-gray-50/50 px-6 py-5 sm:px-7">
          {reflectionError && (
            <p className="text-xs text-red-500 mb-3">{reflectionError}</p>
          )}

          {reflectionLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="w-5 h-5 animate-spin text-gray-300" />
            </div>
          ) : reflectionSuggestions.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center">
              <p className="text-sm font-medium text-gray-700">No discovery proposals yet</p>
              <p className="mt-1 text-xs text-gray-500">
                Select "Refresh proposals" to generate AI-guided search directions.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {reflectionSuggestions.map((suggestion, index) => {
                const categories = getProposalCategories(suggestion);
                return (
                  <article
                    key={suggestion.id}
                    className="flex min-h-64 flex-col rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-yellow-400 hover:shadow-md"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-yellow-700">
                          Proposal {String(index + 1).padStart(2, '0')}
                        </p>
                        <h3 className="mt-1 text-lg font-semibold text-gray-950">
                          {getProposalTitle(suggestion, categories)}
                        </h3>
                      </div>
                      {suggestion.consumed_attempt_count > 0 && (
                        <span className="rounded-full bg-gray-100 px-2 py-1 text-[11px] font-medium text-gray-500">
                          Used {suggestion.consumed_attempt_count}×
                        </span>
                      )}
                    </div>

                    <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-y border-gray-100 py-4">
                      {categories.map((category) => (
                        <div key={`${category.label}-${category.value}`} className="min-w-0">
                          <dt className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                            {category.label}
                          </dt>
                          <dd className="mt-0.5 truncate text-sm font-medium text-gray-800" title={category.value}>
                            {category.value}
                          </dd>
                        </div>
                      ))}
                    </dl>

                    <details className="group mt-3">
                      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-semibold text-gray-600 hover:text-gray-900">
                        <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
                        View explanation
                      </summary>
                      <p className="mt-2 text-sm leading-6 text-gray-600">{suggestion.rationale}</p>
                    </details>

                    <div className="mt-auto flex items-end justify-between gap-4 pt-5">
                      <p className="text-[11px] text-gray-400">
                        Generated {formatDate(suggestion.generated_at)}
                      </p>
                      <button
                        onClick={() => onExploreSuggestion(suggestion.id, suggestion.surface, suggestion.lens)}
                        disabled={isRunning}
                        className="flex flex-shrink-0 items-center gap-1.5 rounded-lg bg-yellow-400 px-3.5 py-2 text-xs font-semibold text-gray-900 transition-colors hover:bg-yellow-500 disabled:opacity-50"
                      >
                        {isRunning ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Search className="h-3.5 w-3.5" />
                        )}
                        Launch
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
