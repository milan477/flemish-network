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
  MapPin,
  ShieldAlert,
  Tag,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { kickEmbeddingWorker } from '../../lib/embeddingRefresh';
import {
  DERIVED_LABEL_TYPE_LABELS,
  formatDerivedLabelConfidence,
  getDerivedLabelBadgeClasses,
  getDerivedLabelMetadata,
  getDerivedLocationSummary,
  isCanonicalDerivedLabel,
  type DerivedLabelSuggestion,
} from '../../lib/derivedLabels';
import { canonicalizeFlemishConnection } from '../../lib/flemishConnections';
import { resolveLocationId } from '../../lib/locations';
import {
  formatConfidence,
  getMethodLabel,
  getSuggestionRisk,
  getSuggestionRiskLabel,
  isActionableSuggestion,
  VERIFICATION_FIELD_LABELS,
  type VerificationSuggestion,
} from '../../lib/verification';

export interface ProfileSuggestion extends VerificationSuggestion {
  id: string;
  person_id: string;
  status: string;
  created_at: string;
  person_name?: string;
}

type ChangeItem =
  | { kind: 'suggestion'; data: ProfileSuggestion }
  | { kind: 'label'; data: DerivedLabelSuggestion };

interface PersonGroup {
  personId: string;
  personName: string;
  items: ChangeItem[];
}

function itemKey(item: ChangeItem): string {
  return item.kind === 'suggestion' ? `s:${item.data.id}` : `l:${item.data.id}`;
}

function groupByPerson(
  suggestions: ProfileSuggestion[],
  labels: DerivedLabelSuggestion[],
): PersonGroup[] {
  const map = new Map<string, PersonGroup>();

  for (const s of suggestions) {
    if (s.status !== 'pending') continue;
    const existing = map.get(s.person_id);
    const name = s.person_name || s.person_id;
    if (existing) {
      existing.items.push({ kind: 'suggestion', data: s });
    } else {
      map.set(s.person_id, { personId: s.person_id, personName: name, items: [{ kind: 'suggestion', data: s }] });
    }
  }

  for (const l of labels) {
    if (l.status !== 'pending' || !l.person_id) continue;
    const pid = l.person_id;
    const existing = map.get(pid);
    const name = l.person_name || pid;
    if (existing) {
      existing.items.push({ kind: 'label', data: l });
    } else {
      map.set(pid, { personId: pid, personName: name, items: [{ kind: 'label', data: l }] });
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

interface PersonChangesGroupProps {
  profileSuggestions: ProfileSuggestion[];
  derivedLabels: DerivedLabelSuggestion[];
  onRefresh: () => void;
}

export default function PersonChangesGroup({
  profileSuggestions,
  derivedLabels,
  onRefresh,
}: PersonChangesGroupProps) {
  const groups = groupByPerson(profileSuggestions, derivedLabels);

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [processingKeys, setProcessingKeys] = useState<Set<string>>(new Set());
  const [personErrors, setPersonErrors] = useState<Record<string, string>>({});

  const toggle = (personId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(personId)) next.delete(personId);
      else next.add(personId);
      return next;
    });
  };

  const toggleItem = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAllForPerson = (group: PersonGroup) => {
    const keys = group.items.map(itemKey);
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      const allSelected = keys.every((k) => prev.has(k));
      if (allSelected) keys.forEach((k) => next.delete(k));
      else keys.forEach((k) => next.add(k));
      return next;
    });
  };

  const markProcessing = (key: string, on: boolean) => {
    setProcessingKeys((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const setPersonError = (personId: string, msg: string | null) => {
    setPersonErrors((prev) => {
      if (msg === null) {
        const next = { ...prev };
        delete next[personId];
        return next;
      }
      return { ...prev, [personId]: msg };
    });
  };

  const approveProfileSuggestion = async (
    suggestion: ProfileSuggestion,
    allPersonItems: ChangeItem[],
  ): Promise<void> => {
    const now = new Date().toISOString();
    const personUpdates: Record<string, string | null> = { last_verified_at: now, updated_at: now };
    const advisoryField = !isActionableSuggestion(suggestion.field_name);

    if (!advisoryField) {
      if (suggestion.field_name === 'location_city' || suggestion.field_name === 'location_state') {
        const { data: personRow, error: personError } = await supabase
          .from('people')
          .select('id, locations(city, state)')
          .eq('id', suggestion.person_id)
          .maybeSingle();

        if (personError || !personRow) throw new Error(personError?.message || 'Failed to load current location');

        const currentLocation = Array.isArray(personRow.locations)
          ? personRow.locations[0]
          : personRow.locations;

        const pairedCity = allPersonItems.find(
          (i) => i.kind === 'suggestion' && i.data.status === 'pending' && i.data.field_name === 'location_city',
        ) as { kind: 'suggestion'; data: ProfileSuggestion } | undefined;
        const pairedState = allPersonItems.find(
          (i) => i.kind === 'suggestion' && i.data.status === 'pending' && i.data.field_name === 'location_state',
        ) as { kind: 'suggestion'; data: ProfileSuggestion } | undefined;

        const nextCity = (
          suggestion.field_name === 'location_city'
            ? suggestion.suggested_value
            : pairedCity?.data.suggested_value || (currentLocation as { city?: string } | null)?.city || ''
        ).trim();
        const nextState = (
          suggestion.field_name === 'location_state'
            ? suggestion.suggested_value
            : pairedState?.data.suggested_value || (currentLocation as { state?: string } | null)?.state || ''
        ).trim();

        if (nextCity && nextState) {
          const locationId = await resolveLocationId(nextCity, nextState, { createIfMissing: true });
          if (!locationId) throw new Error(`Could not resolve the location "${nextCity}, ${nextState}".`);
          personUpdates.location_id = locationId;
        } else if (!nextCity && !nextState) {
          personUpdates.location_id = null;
        } else {
          throw new Error('Location suggestions require both city and state to resolve a location.');
        }
      } else {
        personUpdates[suggestion.field_name] = suggestion.suggested_value;
      }
    }

    const { error: updateError } = await supabase.from('people').update(personUpdates).eq('id', suggestion.person_id);
    if (updateError) throw new Error(updateError.message);

    const { error: approvalError } = await supabase
      .from('profile_suggestions')
      .update({ status: 'approved' })
      .eq('id', suggestion.id);
    if (approvalError) throw new Error(approvalError.message);
  };

  const approveDerivedLabel = async (label: DerivedLabelSuggestion): Promise<void> => {
    if (!label.person_id) return;
    const now = new Date().toISOString();
    let promotedAt: string | null = null;
    let shouldKickEmbeddings = false;

    if (isCanonicalDerivedLabel(label.label_type)) {
      if (label.label_type === 'occupation') {
        const { error } = await supabase.from('people').update({ occupation: label.label_value, updated_at: now }).eq('id', label.person_id);
        if (error) throw new Error(error.message);
        promotedAt = now;
        shouldKickEmbeddings = true;
      }

      if (label.label_type === 'sector') {
        const { data: sectorRow, error: sectorError } = await supabase
          .from('sectors').select('id').eq('name', label.label_value).limit(1).maybeSingle();
        if (sectorError || !sectorRow?.id) throw new Error(sectorError?.message || `Unknown sector "${label.label_value}"`);
        const { error } = await supabase.from('person_sectors').upsert(
          [{ person_id: label.person_id, sector_id: sectorRow.id }],
          { onConflict: 'person_id,sector_id', ignoreDuplicates: true },
        );
        if (error) throw new Error(error.message);
        promotedAt = now;
        shouldKickEmbeddings = true;
      }

      if (label.label_type === 'flemish_entity') {
        const metadata = getDerivedLabelMetadata(label);
        const rawValue = (typeof metadata.raw_value === 'string' && metadata.raw_value) || label.raw_value || label.label_value;
        const canonical = canonicalizeFlemishConnection(rawValue) || canonicalizeFlemishConnection(label.label_value) || { name: label.label_value, type: 'other' as const };

        const { data: lookupRows, error: lookupError } = await supabase.rpc('lookup_flemish_connection', { raw_name: rawValue });
        if (lookupError) throw new Error(lookupError.message);

        let connectionId = Array.isArray(lookupRows) && lookupRows[0]?.id ? String(lookupRows[0].id) : null;
        if (!connectionId) {
          const { data: ensuredId, error: ensureError } = await supabase.rpc('ensure_flemish_connection', {
            p_name: canonical.name, p_type: canonical.type, p_is_filterable: false, p_connection_group: 'derived_label',
          });
          if (ensureError || !ensuredId) throw new Error(ensureError?.message || 'Failed to create Flemish entity');
          connectionId = String(ensuredId);
        }

        const { error } = await supabase.from('person_flemish_connections').upsert(
          [{
            person_id: label.person_id,
            flemish_connection_id: connectionId,
            role: typeof metadata.role === 'string' && metadata.role ? metadata.role : 'derived_label',
            confidence: label.confidence ?? null,
            source_url: label.evidence_url || null,
            evidence_excerpt: label.evidence_excerpt || rawValue,
          }],
          { onConflict: 'person_id,flemish_connection_id', ignoreDuplicates: false },
        );
        if (error) throw new Error(error.message);

        const alias = typeof metadata.candidate_alias === 'string' ? metadata.candidate_alias.trim() : '';
        if (alias && alias.toLowerCase() !== canonical.name.toLowerCase()) {
          await supabase.rpc('add_flemish_connection_alias', {
            p_connection_name: canonical.name, p_alias: alias, p_source: 'model', p_status: 'pending',
            p_confidence: label.confidence ?? null, p_source_url: label.evidence_url || null,
            p_evidence_excerpt: label.evidence_excerpt || rawValue,
          });
        }

        promotedAt = now;
        shouldKickEmbeddings = true;
      }

      if (label.label_type === 'us_location') {
        const metadata = getDerivedLabelMetadata(label);
        const city = typeof metadata.parsed_city === 'string' ? metadata.parsed_city : '';
        const state = typeof metadata.parsed_state === 'string' ? metadata.parsed_state : '';
        const locationId =
          (typeof metadata.location_id === 'string' && metadata.location_id) ||
          (await resolveLocationId(city, state, { createIfMissing: true }));
        if (!locationId) throw new Error('Could not resolve the suggested US location.');
        const { error } = await supabase.from('people').update({ location_id: locationId, updated_at: now }).eq('id', label.person_id);
        if (error) throw new Error(error.message);
        promotedAt = now;
        shouldKickEmbeddings = true;
      }
    }

    const { error: approvalError } = await supabase
      .from('derived_label_suggestions')
      .update({ status: 'approved', reviewed_at: now, promoted_at: promotedAt })
      .eq('id', label.id);
    if (approvalError) throw new Error(approvalError.message);

    if (shouldKickEmbeddings) kickEmbeddingWorker();
  };

  const approveItem = async (item: ChangeItem, allPersonItems: ChangeItem[]): Promise<void> => {
    if (item.kind === 'suggestion') await approveProfileSuggestion(item.data, allPersonItems);
    else await approveDerivedLabel(item.data);
  };

  const handleApproveMultiple = async (items: ChangeItem[], personId: string, allItems: ChangeItem[]) => {
    setPersonError(personId, null);
    for (const item of items) {
      const key = itemKey(item);
      markProcessing(key, true);
      try {
        await approveItem(item, allItems);
        setSelectedKeys((prev) => { const next = new Set(prev); next.delete(key); return next; });
      } catch (err) {
        setPersonError(personId, (err as Error).message || 'Approval failed');
        markProcessing(key, false);
        onRefresh();
        return;
      }
      markProcessing(key, false);
    }
    onRefresh();
  };

  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-gray-400">
        <Inbox className="mb-2 h-8 w-8" />
        <p className="text-sm">No pending suggestions</p>
        <p className="mt-1 text-xs">Run stale-contact verification to queue reviewable suggestions.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {groups.map((group) => {
        const isExpanded = expandedIds.has(group.personId);
        const groupKeys = group.items.map(itemKey);
        const selectedInGroup = groupKeys.filter((k) => selectedKeys.has(k));
        const anyProcessing = groupKeys.some((k) => processingKeys.has(k));
        const personError = personErrors[group.personId];

        const suggestionCount = group.items.filter((i) => i.kind === 'suggestion').length;
        const labelCount = group.items.filter((i) => i.kind === 'label').length;

        return (
          <div key={group.personId} className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
            {/* Header row */}
            <div
              className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-gray-50"
              onClick={() => toggle(group.personId)}
            >
              <div className="text-gray-400">
                {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </div>

              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span className="text-sm font-semibold text-gray-900">{group.personName}</span>
                {suggestionCount > 0 && (
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
                    {suggestionCount} field {suggestionCount === 1 ? 'change' : 'changes'}
                  </span>
                )}
                {labelCount > 0 && (
                  <span className="rounded-full bg-purple-50 px-2 py-0.5 text-[10px] font-medium text-purple-700">
                    {labelCount} {labelCount === 1 ? 'label' : 'labels'}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                {isExpanded && selectedInGroup.length > 0 && (
                  <button
                    disabled={anyProcessing}
                    onClick={() => {
                      const toApprove = group.items.filter((i) => selectedKeys.has(itemKey(i)));
                      void handleApproveMultiple(toApprove, group.personId, group.items);
                    }}
                    className="inline-flex items-center gap-1 rounded-lg bg-green-50 px-2.5 py-1.5 text-xs font-medium text-green-700 hover:bg-green-100 disabled:opacity-50"
                  >
                    {anyProcessing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCheck className="h-3.5 w-3.5" />}
                    Approve selected ({selectedInGroup.length})
                  </button>
                )}
                <button
                  disabled={anyProcessing}
                  onClick={() => void handleApproveMultiple(group.items, group.personId, group.items)}
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
                {personError && (
                  <div className="mx-4 my-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">
                    {personError}
                  </div>
                )}

                {/* Select all toggle for this person */}
                <div className="flex items-center gap-2 border-b border-gray-50 px-4 py-2">
                  <input
                    type="checkbox"
                    checked={groupKeys.length > 0 && groupKeys.every((k) => selectedKeys.has(k))}
                    onChange={() => toggleAllForPerson(group)}
                    className="h-3.5 w-3.5 rounded border-gray-300 text-teal-600 focus:ring-teal-500"
                  />
                  <span className="text-[11px] text-gray-500">Select all</span>
                </div>

                <div className="divide-y divide-gray-50">
                  {group.items.map((item) => {
                    const key = itemKey(item);
                    const isProcessing = processingKeys.has(key);
                    const isSelected = selectedKeys.has(key);

                    if (item.kind === 'suggestion') {
                      const s = item.data;
                      const confidence = formatConfidence(s.confidence);
                      const actionable = isActionableSuggestion(s.field_name);

                      return (
                        <div
                          key={key}
                          className={`flex items-start gap-3 px-4 py-3 transition-colors ${isSelected ? 'bg-teal-50/30' : 'hover:bg-gray-50/50'}`}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleItem(key)}
                            className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-gray-300 text-teal-600 focus:ring-teal-500"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">
                                {VERIFICATION_FIELD_LABELS[s.field_name] || s.field_name}
                              </span>
                              {s.method && (
                                <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
                                  {getMethodLabel(s.method)}
                                </span>
                              )}
                              <span
                                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${getRiskClasses(s.field_name)}`}
                                title="Confidence = how strong the evidence is. Risk = how sensitive the field is. Approve only when confidence is high AND the risk class is acceptable for this field."
                              >
                                {confidence
                                  ? `${confidence.replace(' confidence', '')} · ${getSuggestionRiskLabel(s.field_name)
                                      .replace(' Risk', '-risk')
                                      .toLowerCase()
                                      .replace(/^(\w)/, (m) => m.toUpperCase())} field`
                                  : `${getSuggestionRiskLabel(s.field_name)
                                      .replace(' Risk', '-risk')
                                      .toLowerCase()
                                      .replace(/^(\w)/, (m) => m.toUpperCase())} field`}
                                <Info className="h-3 w-3 opacity-70" />
                              </span>
                              {!actionable && (
                                <span className="inline-flex items-center gap-1 rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-700">
                                  <ShieldAlert className="h-3 w-3" />
                                  Advisory only
                                </span>
                              )}
                            </div>
                            <div className="mt-1 flex items-center gap-2 text-xs">
                              {s.current_value && (
                                <>
                                  <span className="truncate text-gray-400 line-through">{s.current_value}</span>
                                  <ArrowRight className="h-3 w-3 shrink-0 text-gray-300" />
                                </>
                              )}
                              <span className="font-medium text-gray-700">{s.suggested_value}</span>
                            </div>
                            {s.evidence_excerpt && (
                              <p className="mt-1 text-[11px] leading-relaxed text-gray-500">{s.evidence_excerpt}</p>
                            )}
                            {s.evidence_url && (
                              <a href={s.evidence_url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-700">
                                Evidence <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                          </div>
                          {isProcessing && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-gray-400" />}
                        </div>
                      );
                    }

                    // kind === 'label'
                    const l = item.data;
                    const displayValue = l.label_type === 'us_location' ? getDerivedLocationSummary(l) : l.label_value;
                    const confidence = formatDerivedLabelConfidence(l.confidence);
                    const metadata = getDerivedLabelMetadata(l);
                    const isCanonical = isCanonicalDerivedLabel(l.label_type);

                    return (
                      <div
                        key={key}
                        className={`flex items-start gap-3 px-4 py-3 transition-colors ${isSelected ? 'bg-teal-50/30' : 'hover:bg-gray-50/50'}`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleItem(key)}
                          className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-gray-300 text-teal-600 focus:ring-teal-500"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${getDerivedLabelBadgeClasses(l.label_type)}`}>
                              {DERIVED_LABEL_TYPE_LABELS[l.label_type]}
                            </span>
                            {confidence && <span className="text-[10px] text-gray-500">{confidence}</span>}
                            {!isCanonical && (
                              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-600">Review-only</span>
                            )}
                            {Boolean(metadata.review_required) && l.label_type === 'us_location' && (
                              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] text-amber-700">Review required</span>
                            )}
                          </div>
                          <div className="mt-1 flex items-center gap-1.5 text-xs">
                            {l.label_type === 'us_location'
                              ? <MapPin className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                              : <Tag className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                            }
                            <span className="font-medium text-gray-900">{displayValue}</span>
                            {l.source && <span className="text-[11px] text-gray-500">· {l.source}</span>}
                          </div>
                          {l.evidence_excerpt && (
                            <p className="mt-1 text-[11px] leading-relaxed text-gray-500">{l.evidence_excerpt}</p>
                          )}
                          {l.evidence_url && (
                            <a href={l.evidence_url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-700">
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
