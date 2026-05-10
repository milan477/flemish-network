import { useState } from 'react';
import {
  ArrowRight,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Inbox,
  Info,
  Loader2,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import {
  formatConfidence,
  getMethodLabel,
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

interface OrgGroup {
  orgId: string;
  orgName: string;
  items: OrganizationProfileSuggestion[];
}

const ORG_FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  description: 'Description',
  website_url: 'Website',
  type: 'Type',
};

function groupByOrg(suggestions: OrganizationProfileSuggestion[]): OrgGroup[] {
  const map = new Map<string, OrgGroup>();
  for (const s of suggestions) {
    if (s.status !== 'pending') continue;
    const existing = map.get(s.organization_id);
    const name = s.organization_name || s.organization_id;
    if (existing) {
      existing.items.push(s);
    } else {
      map.set(s.organization_id, { orgId: s.organization_id, orgName: name, items: [s] });
    }
  }
  return Array.from(map.values());
}

function getRiskClasses(fieldName: string): string {
  const risk = getSuggestionRisk(fieldName);
  if (risk === 'low') return 'bg-green-50 text-green-700';
  if (risk === 'medium') return 'bg-amber-50 text-amber-700';
  return 'bg-red-50 text-red-700';
}

interface OrganizationSuggestedChangesProps {
  suggestions: OrganizationProfileSuggestion[];
  onRefresh: () => void;
}

export default function OrganizationSuggestedChanges({
  suggestions,
  onRefresh,
}: OrganizationSuggestedChangesProps) {
  const groups = groupByOrg(suggestions);

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());
  const [orgErrors, setOrgErrors] = useState<Record<string, string>>({});

  const toggle = (orgId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(orgId)) next.delete(orgId);
      else next.add(orgId);
      return next;
    });
  };

  const toggleItem = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllForOrg = (group: OrgGroup) => {
    const ids = group.items.map((s) => s.id);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const allSelected = ids.every((id) => prev.has(id));
      if (allSelected) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });
  };

  const setOrgError = (orgId: string, msg: string | null) => {
    setOrgErrors((prev) => {
      if (msg === null) { const next = { ...prev }; delete next[orgId]; return next; }
      return { ...prev, [orgId]: msg };
    });
  };

  const approveSuggestion = async (suggestion: OrganizationProfileSuggestion): Promise<void> => {
    const { error: updateError } = await supabase
      .from('organizations')
      .update({ updated_at: new Date().toISOString(), [suggestion.field_name]: suggestion.suggested_value })
      .eq('id', suggestion.organization_id);
    if (updateError) throw new Error(updateError.message);

    const { error: approvalError } = await supabase
      .from('profile_suggestions')
      .update({ status: 'approved' })
      .eq('id', suggestion.id);
    if (approvalError) throw new Error(approvalError.message);
  };

  const handleApproveMultiple = async (items: OrganizationProfileSuggestion[], orgId: string) => {
    setOrgError(orgId, null);
    for (const item of items) {
      setProcessingIds((prev) => new Set([...prev, item.id]));
      try {
        await approveSuggestion(item);
        setSelectedIds((prev) => { const next = new Set(prev); next.delete(item.id); return next; });
      } catch (err) {
        setOrgError(orgId, (err as Error).message || 'Approval failed');
        setProcessingIds((prev) => { const next = new Set(prev); next.delete(item.id); return next; });
        onRefresh();
        return;
      }
      setProcessingIds((prev) => { const next = new Set(prev); next.delete(item.id); return next; });
    }
    onRefresh();
  };

  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-gray-400">
        <Inbox className="mb-2 h-8 w-8" />
        <p className="text-sm">No pending organization suggestions</p>
        <p className="mt-1 text-xs">Run organization verification to queue reviewable suggestions.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {groups.map((group) => {
        const isExpanded = expandedIds.has(group.orgId);
        const groupIds = group.items.map((s) => s.id);
        const selectedInGroup = groupIds.filter((id) => selectedIds.has(id));
        const anyProcessing = groupIds.some((id) => processingIds.has(id));
        const orgError = orgErrors[group.orgId];

        return (
          <div key={group.orgId} className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
            {/* Header row */}
            <div
              className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-gray-50"
              onClick={() => toggle(group.orgId)}
            >
              <div className="text-gray-400">
                {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </div>

              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span className="text-sm font-semibold text-gray-900">{group.orgName}</span>
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
                  {group.items.length} {group.items.length === 1 ? 'change' : 'changes'}
                </span>
              </div>

              <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                {isExpanded && selectedInGroup.length > 0 && (
                  <button
                    disabled={anyProcessing}
                    onClick={() => {
                      const toApprove = group.items.filter((s) => selectedIds.has(s.id));
                      void handleApproveMultiple(toApprove, group.orgId);
                    }}
                    className="inline-flex items-center gap-1 rounded-lg bg-green-50 px-2.5 py-1.5 text-xs font-medium text-green-700 hover:bg-green-100 disabled:opacity-50"
                  >
                    {anyProcessing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCheck className="h-3.5 w-3.5" />}
                    Approve selected ({selectedInGroup.length})
                  </button>
                )}
                <button
                  disabled={anyProcessing}
                  onClick={() => void handleApproveMultiple(group.items, group.orgId)}
                  className="inline-flex items-center gap-1 rounded-lg bg-teal-50 px-2.5 py-1.5 text-xs font-medium text-teal-700 hover:bg-teal-100 disabled:opacity-50"
                >
                  {anyProcessing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCheck className="h-3.5 w-3.5" />}
                  Approve all ({group.items.length})
                </button>
              </div>
            </div>

            {/* Expanded content */}
            {isExpanded && (
              <div className="border-t border-gray-50">
                {orgError && (
                  <div className="mx-4 my-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">
                    {orgError}
                  </div>
                )}

                <div className="flex items-center gap-2 border-b border-gray-50 px-4 py-2">
                  <input
                    type="checkbox"
                    checked={groupIds.length > 0 && groupIds.every((id) => selectedIds.has(id))}
                    onChange={() => toggleAllForOrg(group)}
                    className="h-3.5 w-3.5 rounded border-gray-300 text-teal-600 focus:ring-teal-500"
                  />
                  <span className="text-[11px] text-gray-500">Select all</span>
                </div>

                <div className="divide-y divide-gray-50">
                  {group.items.map((suggestion) => {
                    const isProcessing = processingIds.has(suggestion.id);
                    const isSelected = selectedIds.has(suggestion.id);
                    const confidence = formatConfidence(suggestion.confidence);

                    return (
                      <div
                        key={suggestion.id}
                        className={`flex items-start gap-3 px-4 py-3 transition-colors ${isSelected ? 'bg-teal-50/30' : 'hover:bg-gray-50/50'}`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleItem(suggestion.id)}
                          className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-gray-300 text-teal-600 focus:ring-teal-500"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">
                              {ORG_FIELD_LABELS[suggestion.field_name] || suggestion.field_name}
                            </span>
                            {suggestion.method && (
                              <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
                                {getMethodLabel(suggestion.method)}
                              </span>
                            )}
                            {/* Phase 5C: combined Confidence + Risk chip with tooltip. */}
                            <span
                              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${getRiskClasses(suggestion.field_name)}`}
                              title="Confidence = how strong the evidence is. Risk = how sensitive the field is. Approve only when confidence is high AND the risk class is acceptable for this field."
                            >
                              {confidence
                                ? `${confidence.replace(' confidence', '')} · ${getSuggestionRiskLabel(suggestion.field_name)
                                    .replace(' Risk', '-risk')
                                    .toLowerCase()
                                    .replace(/^(\w)/, (m) => m.toUpperCase())} field`
                                : `${getSuggestionRiskLabel(suggestion.field_name)
                                    .replace(' Risk', '-risk')
                                    .toLowerCase()
                                    .replace(/^(\w)/, (m) => m.toUpperCase())} field`}
                              <Info className="h-3 w-3 opacity-70" />
                            </span>
                          </div>
                          <div className="mt-1 flex items-center gap-2 text-xs">
                            {suggestion.current_value && (
                              <>
                                <span className="truncate text-gray-400 line-through">{suggestion.current_value}</span>
                                <ArrowRight className="h-3 w-3 shrink-0 text-gray-300" />
                              </>
                            )}
                            <span className="font-medium text-gray-700">{suggestion.suggested_value}</span>
                          </div>
                          {suggestion.evidence_excerpt && (
                            <p className="mt-1 text-[11px] leading-relaxed text-gray-500">{suggestion.evidence_excerpt}</p>
                          )}
                          {suggestion.evidence_url && (
                            <a href={suggestion.evidence_url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-700">
                              Evidence <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                        </div>
                        {isProcessing && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-gray-400" />}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
