import { useState } from 'react';
import {
  ArrowRight,
  CheckCheck,
  CheckCircle,
  ExternalLink,
  Inbox,
  Loader2,
  XCircle,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import {
  formatConfidence,
  getMethodLabel,
  getSuggestionGuidance,
  getSuggestionRisk,
  getSuggestionRiskLabel,
  type VerificationSuggestion,
} from '../../lib/verification';

export interface OrganizationProfileSuggestion extends VerificationSuggestion {
  id: string;
  organization_id: string;
  status: string;
  created_at: string;
  organization_name?: string;
}

const ORG_FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  description: 'Description',
  website_url: 'Website',
  type: 'Type',
};

interface OrganizationSuggestedChangesProps {
  suggestions: OrganizationProfileSuggestion[];
  onRefresh: () => void;
}

function getRiskClasses(fieldName: string): string {
  const risk = getSuggestionRisk(fieldName);
  if (risk === 'low') return 'bg-green-50 text-green-700';
  if (risk === 'medium') return 'bg-amber-50 text-amber-700';
  return 'bg-red-50 text-red-700';
}

export default function OrganizationSuggestedChanges({
  suggestions,
  onRefresh,
}: OrganizationSuggestedChangesProps) {
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchProcessing, setBatchProcessing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const pending = suggestions.filter((suggestion) => suggestion.status === 'pending');

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === pending.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(pending.map((suggestion) => suggestion.id)));
    }
  };

  const approveSuggestion = async (suggestion: OrganizationProfileSuggestion): Promise<boolean> => {
    setProcessingIds((prev) => new Set([...prev, suggestion.id]));
    setErrorMsg(null);

    try {
      const orgUpdates: Record<string, string | null> = {
        updated_at: new Date().toISOString(),
        [suggestion.field_name]: suggestion.suggested_value,
      };

      const { error: updateError } = await supabase
        .from('organizations')
        .update(orgUpdates)
        .eq('id', suggestion.organization_id);

      if (updateError) {
        throw new Error(updateError.message);
      }

      const { error: approvalError } = await supabase
        .from('profile_suggestions')
        .update({ status: 'approved' })
        .eq('id', suggestion.id);

      if (approvalError) {
        throw new Error(approvalError.message);
      }

      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(suggestion.id);
        return next;
      });
      onRefresh();
      return true;
    } catch (err) {
      setErrorMsg((err as Error).message || 'Failed to approve suggestion');
      return false;
    } finally {
      setProcessingIds((prev) => {
        const next = new Set(prev);
        next.delete(suggestion.id);
        return next;
      });
    }
  };

  const rejectSuggestion = async (id: string) => {
    setProcessingIds((prev) => new Set([...prev, id]));

    await supabase.from('profile_suggestions').update({ status: 'rejected' }).eq('id', id);

    setProcessingIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    onRefresh();
  };

  const approveSelected = async () => {
    setBatchProcessing(true);
    const toApprove = pending.filter((suggestion) => selectedIds.has(suggestion.id));
    for (const suggestion of toApprove) {
      await approveSuggestion(suggestion);
    }
    setBatchProcessing(false);
  };

  if (pending.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-gray-400">
        <Inbox className="mb-2 h-8 w-8" />
        <p className="text-sm">No pending organization suggestions</p>
        <p className="mt-1 text-xs">
          Run organization verification (durable mode) to queue reviewable suggestions
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <label className="flex cursor-pointer items-center space-x-2">
          <input
            type="checkbox"
            checked={selectedIds.size === pending.length && pending.length > 0}
            onChange={toggleSelectAll}
            className="h-3.5 w-3.5 rounded border-gray-300 text-teal-600 focus:ring-teal-500"
          />
          <span className="text-xs text-gray-500">
            {selectedIds.size > 0 ? `${selectedIds.size} selected` : 'Select all'}
          </span>
        </label>
        {selectedIds.size > 0 && (
          <button
            onClick={approveSelected}
            disabled={batchProcessing}
            className="flex items-center space-x-1.5 rounded-lg bg-green-50 px-2.5 py-1.5 text-xs font-medium text-green-700 transition-colors hover:bg-green-100 disabled:opacity-50"
          >
            {batchProcessing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <CheckCheck className="h-3.5 w-3.5" />
            )}
            <span>Approve Selected ({selectedIds.size})</span>
          </button>
        )}
      </div>

      {errorMsg && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {errorMsg}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-gray-100">
        <div className="divide-y divide-gray-50">
          {pending.map((suggestion) => {
            const isProcessing = processingIds.has(suggestion.id);
            const isSelected = selectedIds.has(suggestion.id);
            const confidence = formatConfidence(suggestion.confidence);

            return (
              <div
                key={suggestion.id}
                className={`px-4 py-4 transition-colors ${
                  isSelected ? 'bg-teal-50/40' : 'hover:bg-gray-50'
                }`}
              >
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleSelect(suggestion.id)}
                    className="mt-1 h-3.5 w-3.5 rounded border-gray-300 text-teal-600 focus:ring-teal-500"
                  />

                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-gray-900">
                        {suggestion.organization_name || 'Unknown organization'}
                      </span>
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">
                        {ORG_FIELD_LABELS[suggestion.field_name] || suggestion.field_name}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${getRiskClasses(
                          suggestion.field_name
                        )}`}
                      >
                        {getSuggestionRiskLabel(suggestion.field_name)}
                      </span>
                      {suggestion.method && (
                        <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
                          {getMethodLabel(suggestion.method)}
                        </span>
                      )}
                      {confidence && (
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-600">
                          {confidence}
                        </span>
                      )}
                    </div>

                    <div className="flex items-start space-x-2 text-xs">
                      {suggestion.current_value && (
                        <>
                          <span className="max-w-[40%] flex-shrink-0 truncate text-gray-400 line-through">
                            {suggestion.current_value}
                          </span>
                          <ArrowRight className="mt-0.5 h-3 w-3 flex-shrink-0 text-gray-300" />
                        </>
                      )}
                      <span className="truncate font-medium text-gray-700">
                        {suggestion.suggested_value}
                      </span>
                    </div>

                    <p className="mt-2 text-[11px] text-gray-500">
                      {getSuggestionGuidance(suggestion.field_name)}
                    </p>

                    {(suggestion.evidence_excerpt || suggestion.evidence_url) && (
                      <div className="mt-3 rounded-lg border border-gray-200 bg-white px-3 py-2">
                        {suggestion.evidence_excerpt && (
                          <p className="text-xs leading-5 text-gray-600">
                            {suggestion.evidence_excerpt}
                          </p>
                        )}
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
                          {suggestion.source && <span>{suggestion.source}</span>}
                          {suggestion.evidence_url && (
                            <a
                              href={suggestion.evidence_url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-700"
                            >
                              <ExternalLink className="h-3 w-3" />
                              <span>Open evidence</span>
                            </a>
                          )}
                        </div>
                      </div>
                    )}

                    <p className="mt-2 text-[10px] text-gray-400">
                      {new Date(suggestion.created_at).toLocaleDateString()}
                    </p>
                  </div>

                  <div className="ml-3 flex flex-shrink-0 items-center space-x-1">
                    <button
                      onClick={() => approveSuggestion(suggestion)}
                      disabled={isProcessing || batchProcessing}
                      className="rounded-lg p-1.5 text-green-600 transition-colors hover:bg-green-50 disabled:opacity-50"
                      title="Approve"
                    >
                      {isProcessing ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <CheckCircle className="h-4 w-4" />
                      )}
                    </button>
                    <button
                      onClick={() => rejectSuggestion(suggestion.id)}
                      disabled={isProcessing || batchProcessing}
                      className="rounded-lg p-1.5 text-red-500 transition-colors hover:bg-red-50 disabled:opacity-50"
                      title="Reject"
                    >
                      <XCircle className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
