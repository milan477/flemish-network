import { useState } from 'react';
import {
  ArrowRight,
  CheckCheck,
  CheckCircle,
  ExternalLink,
  Info,
  Inbox,
  Loader2,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import { supabase, US_STATES } from '../../lib/supabase';
import { resolveLocationId } from '../../lib/locations';
import {
  formatConfidence,
  getMethodLabel,
  getSuggestionGuidance,
  getSuggestionRisk,
  getSuggestionRiskLabel,
  isActionableSuggestion,
  VERIFICATION_FIELD_LABELS,
  type VerificationSuggestion,
} from '../../lib/verification';

const US_STATE_NAMES = new Set(US_STATES.map((s) => s.name.toLowerCase()));
const US_STATE_CODES = new Set(US_STATES.map((s) => s.code.toLowerCase()));

/** Returns true if the value clearly identifies a US state (full name or code). */
function isUsState(value: string | null | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  if (!v) return false;
  return US_STATE_NAMES.has(v) || US_STATE_CODES.has(v);
}

/** Returns true if the suggested location change moves a US person to a non-US locale. */
function isNonUsLocaleChange(
  suggestion: ProfileSuggestion,
  pairedStateSuggestion: ProfileSuggestion | undefined,
  currentState: string | null | undefined,
): boolean {
  // Domain assumption: persons of interest are US-based. Flag any city/state
  // change whose destination state is not a recognized US state.
  if (
    suggestion.field_name !== 'location_city' &&
    suggestion.field_name !== 'location_state'
  ) {
    return false;
  }
  const destinationState =
    suggestion.field_name === 'location_state'
      ? suggestion.suggested_value
      : pairedStateSuggestion?.suggested_value || currentState || '';
  // If destination state is empty we can't classify; skip the guard.
  if (!destinationState || !destinationState.trim()) return false;
  return !isUsState(destinationState);
}

export interface ProfileSuggestion extends VerificationSuggestion {
  id: string;
  person_id: string;
  status: string;
  created_at: string;
  person_name?: string;
}

interface SuggestedChangesProps {
  suggestions: ProfileSuggestion[];
  onRefresh: () => void;
}

function getRiskClasses(fieldName: string): string {
  const risk = getSuggestionRisk(fieldName);
  if (risk === 'low') return 'bg-green-50 text-green-700';
  if (risk === 'medium') return 'bg-amber-50 text-amber-700';
  return 'bg-red-50 text-red-700';
}

export default function SuggestedChanges({
  suggestions,
  onRefresh,
}: SuggestedChangesProps) {
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchProcessing, setBatchProcessing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // Phase 5C: in-app confirmation modal for non-US locale changes (no native confirm()).
  const [pendingNonUsConfirm, setPendingNonUsConfirm] = useState<{
    suggestion: ProfileSuggestion;
    destinationCity: string;
    destinationState: string;
    resolve: (ok: boolean) => void;
  } | null>(null);

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

  const approveSuggestion = async (suggestion: ProfileSuggestion): Promise<boolean> => {
    setProcessingIds((prev) => new Set([...prev, suggestion.id]));
    setErrorMsg(null);

    try {
      const advisoryField = !isActionableSuggestion(suggestion.field_name);
      const now = new Date().toISOString();
      const personUpdates: Record<string, string | null> = {
        last_verified_at: now,
        updated_at: now,
      };

      if (!advisoryField) {
        if (
          suggestion.field_name === 'location_city' ||
          suggestion.field_name === 'location_state'
        ) {
          const { data: personRow, error: personError } = await supabase
            .from('people')
            .select('id, locations(city, state)')
            .eq('id', suggestion.person_id)
            .maybeSingle();

          if (personError || !personRow) {
            throw new Error(personError?.message || 'Failed to load current location');
          }

          const currentLocation = Array.isArray(personRow.locations)
            ? personRow.locations[0]
            : personRow.locations;

          const pairedCitySuggestion = suggestions.find(
            (item) =>
              item.person_id === suggestion.person_id &&
              item.status === 'pending' &&
              item.field_name === 'location_city'
          );
          const pairedStateSuggestion = suggestions.find(
            (item) =>
              item.person_id === suggestion.person_id &&
              item.status === 'pending' &&
              item.field_name === 'location_state'
          );

          const nextCity =
            (suggestion.field_name === 'location_city'
              ? suggestion.suggested_value
              : pairedCitySuggestion?.suggested_value || currentLocation?.city || '').trim();
          const nextState =
            (suggestion.field_name === 'location_state'
              ? suggestion.suggested_value
              : pairedStateSuggestion?.suggested_value || currentLocation?.state || '').trim();

          // Phase 5C: destination-locale guard. If this change moves a US-based
          // person of interest to a non-US locale, require explicit confirmation
          // through an in-app modal (never the native confirm()).
          if (
            isNonUsLocaleChange(
              suggestion,
              pairedStateSuggestion,
              currentLocation?.state,
            )
          ) {
            const confirmed = await new Promise<boolean>((resolve) => {
              setPendingNonUsConfirm({
                suggestion,
                destinationCity: nextCity,
                destinationState: nextState,
                resolve,
              });
            });
            if (!confirmed) {
              throw new Error(
                'Non-US locale change cancelled. Persons of interest are assumed US-based; confirm explicitly to proceed.',
              );
            }
          }

          if (nextCity && nextState) {
            const locationId = await resolveLocationId(nextCity, nextState, {
              createIfMissing: true,
            });

            if (!locationId) {
              throw new Error(`Could not resolve the location "${nextCity}, ${nextState}".`);
            }

            personUpdates.location_id = locationId;
          } else if (!nextCity && !nextState) {
            personUpdates.location_id = null;
          } else {
            throw new Error(
              'Location suggestions require both city and state to resolve a location.'
            );
          }
        } else {
          personUpdates[suggestion.field_name] = suggestion.suggested_value;
        }
      }

      const { error: updateError } = await supabase
        .from('people')
        .update(personUpdates)
        .eq('id', suggestion.person_id);

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

  const approveAll = async () => {
    setBatchProcessing(true);
    for (const suggestion of pending) {
      await approveSuggestion(suggestion);
    }
    setBatchProcessing(false);
  };

  if (pending.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-gray-400">
        <Inbox className="mb-2 h-8 w-8" />
        <p className="text-sm">No pending suggestions</p>
        <p className="mt-1 text-xs">
          Use stale-contact verification to queue reviewable suggestions
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center space-x-3">
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
        </div>
        <div className="flex items-center space-x-2">
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
          <button
            onClick={approveAll}
            disabled={batchProcessing}
            className="flex items-center space-x-1.5 rounded-lg bg-teal-50 px-2.5 py-1.5 text-xs font-medium text-teal-700 transition-colors hover:bg-teal-100 disabled:opacity-50"
          >
            {batchProcessing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <CheckCheck className="h-3.5 w-3.5" />
            )}
            <span>Approve All ({pending.length})</span>
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {errorMsg}
        </div>
      )}

      {pendingNonUsConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="non-us-confirm-title"
        >
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
            <div className="mb-3 flex items-start gap-2">
              <ShieldAlert className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-600" />
              <div>
                <h3 id="non-us-confirm-title" className="text-sm font-semibold text-gray-900">
                  Confirm non-US locale change
                </h3>
                <p className="mt-1 text-xs text-gray-600">
                  This suggestion would move{' '}
                  <span className="font-medium">
                    {pendingNonUsConfirm.suggestion.person_name || 'this person'}
                  </span>{' '}
                  to{' '}
                  <span className="font-medium">
                    {[pendingNonUsConfirm.destinationCity, pendingNonUsConfirm.destinationState]
                      .filter(Boolean)
                      .join(', ') || 'an unspecified locale'}
                  </span>
                  , which is outside the United States. The Flemish Network platform assumes
                  persons of interest are US-based — please confirm explicitly before approving.
                </p>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => {
                  pendingNonUsConfirm.resolve(false);
                  setPendingNonUsConfirm(null);
                }}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  pendingNonUsConfirm.resolve(true);
                  setPendingNonUsConfirm(null);
                }}
                className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
              >
                Confirm change
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-gray-100">
        <div className="divide-y divide-gray-50">
          {pending.map((suggestion) => {
            const isProcessing = processingIds.has(suggestion.id);
            const isSelected = selectedIds.has(suggestion.id);
            const confidence = formatConfidence(suggestion.confidence);
            const actionable = isActionableSuggestion(suggestion.field_name);

            return (
              <div
                key={suggestion.id}
                className={`px-4 py-4 transition-colors ${
                  isSelected ? 'bg-teal-50/40' : 'hover:bg-gray-50'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="flex items-center pt-0.5">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelect(suggestion.id)}
                      className="h-3.5 w-3.5 rounded border-gray-300 text-teal-600 focus:ring-teal-500"
                    />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-gray-900">
                        {suggestion.person_name}
                      </span>
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">
                        {VERIFICATION_FIELD_LABELS[suggestion.field_name] || suggestion.field_name}
                      </span>
                      {suggestion.method && (
                        <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
                          {getMethodLabel(suggestion.method)}
                        </span>
                      )}
                      {/* Phase 5C: Risk and Confidence are different things. Render
                          them as one combined chip ("Confidence X% · <Risk> field")
                          with a single info-tooltip explaining precedence. */}
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${getRiskClasses(
                          suggestion.field_name
                        )}`}
                        title="Confidence = how strong the evidence is. Risk = how sensitive the field is. Approve only when confidence is high AND the risk class is acceptable for this field."
                      >
                        {confidence
                          ? `${confidence.replace(' confidence', '')} · ${getSuggestionRiskLabel(
                              suggestion.field_name,
                            )
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

                    {suggestion.field_name === 'bio' ? (
                      // Phase 5C: bio diff stacks vertically (full width is fine for prose).
                      <div className="space-y-1 text-xs">
                        {suggestion.current_value && (
                          <div className="rounded bg-gray-50 px-2 py-1 text-gray-400 line-through">
                            {suggestion.current_value}
                          </div>
                        )}
                        <div className="rounded bg-white px-2 py-1 font-medium text-gray-700">
                          {suggestion.suggested_value}
                        </div>
                        {!actionable && (
                          <span className="inline-flex items-center gap-1 rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-700">
                            <ShieldAlert className="h-3 w-3" />
                            Advisory only
                          </span>
                        )}
                      </div>
                    ) : (
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
                        {!actionable && (
                          <span className="inline-flex items-center gap-1 rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-700">
                            <ShieldAlert className="h-3 w-3" />
                            Advisory only
                          </span>
                        )}
                      </div>
                    )}

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
