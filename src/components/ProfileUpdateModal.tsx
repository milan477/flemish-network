import { useState } from 'react';
import {
  AlertCircle,
  Check,
  ExternalLink,
  Loader2,
  RotateCw,
  ShieldAlert,
  X,
} from 'lucide-react';
import { supabase, displayName, type Person } from '../lib/supabase';
import { resolveLocationId } from '../lib/locations';
import {
  formatConfidence,
  getMethodLabel,
  getSuggestionGuidance,
  getSuggestionKey,
  getSuggestionRisk,
  getSuggestionRiskLabel,
  isActionableSuggestion,
  normalizeVerificationSuggestions,
  VERIFICATION_FIELD_LABELS,
  type VerificationSuggestion,
} from '../lib/verification';

interface ProfileUpdateModalProps {
  person: Person;
  onClose: () => void;
  onApplied: () => void;
}

type Stage = 'idle' | 'searching' | 'results' | 'applying' | 'done' | 'error';

function getRiskClasses(fieldName: string): string {
  const risk = getSuggestionRisk(fieldName);
  if (risk === 'low') return 'bg-green-50 text-green-700';
  if (risk === 'medium') return 'bg-amber-50 text-amber-700';
  return 'bg-red-50 text-red-700';
}

export default function ProfileUpdateModal({
  person,
  onClose,
  onApplied,
}: ProfileUpdateModalProps) {
  const [stage, setStage] = useState<Stage>('idle');
  const [suggestions, setSuggestions] = useState<VerificationSuggestion[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [errorMsg, setErrorMsg] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);

  const actionableSuggestions = suggestions.filter((suggestion) =>
    isActionableSuggestion(suggestion.field_name)
  );

  const selectedSuggestions = actionableSuggestions.filter((suggestion, index) => {
    const key = getSuggestionKey(suggestion, index);
    return selected[key];
  });

  const runSearch = async () => {
    setStage('searching');
    setErrorMsg('');
    setWarnings([]);

    try {
      const { data, error } = await supabase.functions.invoke('update-profile', {
        body: { personId: person.id },
      });

      if (error) {
        throw new Error(error.message);
      }

      const nextSuggestions = normalizeVerificationSuggestions(data?.suggestions);
      const nextWarnings = Array.isArray(data?.warnings)
        ? data.warnings.filter((warning: unknown): warning is string => typeof warning === 'string')
        : [];

      setWarnings(nextWarnings);
      setSuggestions(nextSuggestions);

      const nextSelected: Record<string, boolean> = {};
      nextSuggestions.forEach((suggestion, index) => {
        if (isActionableSuggestion(suggestion.field_name)) {
          nextSelected[getSuggestionKey(suggestion, index)] = true;
        }
      });
      setSelected(nextSelected);
      setStage('results');
    } catch (err) {
      setErrorMsg((err as Error).message || 'Failed to run verification preview');
      setStage('error');
    }
  };

  const applySelected = async () => {
    setStage('applying');
    setErrorMsg('');

    const updates: Record<string, string | null> = {};
    selectedSuggestions.forEach((suggestion) => {
      updates[suggestion.field_name] = suggestion.suggested_value || null;
    });

    if (Object.keys(updates).length === 0) {
      setStage('results');
      return;
    }

    if ('location_city' in updates || 'location_state' in updates) {
      const nextCity =
        ('location_city' in updates
          ? updates.location_city
          : person.locations?.city || null)?.trim() || null;
      const nextState =
        ('location_state' in updates
          ? updates.location_state
          : person.locations?.state || null)?.trim() || null;

      delete updates.location_city;
      delete updates.location_state;

      if (nextCity && nextState) {
        const locationId = await resolveLocationId(nextCity, nextState, {
          createIfMissing: true,
        });

        if (!locationId) {
          setErrorMsg(`Could not resolve the location "${nextCity}, ${nextState}".`);
          setStage('error');
          return;
        }

        updates.location_id = locationId;
      } else if (!nextCity && !nextState) {
        updates.location_id = null;
      } else {
        setErrorMsg(
          'Location updates require both city and state. Apply both suggestions together or leave them unchecked.'
        );
        setStage('error');
        return;
      }
    }

    const title = 'title' in updates ? updates.title : person.title;
    const first = 'first_name' in updates ? updates.first_name : person.first_name;
    const last = 'last_name' in updates ? updates.last_name : person.last_name;

    if ('title' in updates || 'first_name' in updates || 'last_name' in updates) {
      if (!('name' in updates)) {
        updates.name = [title, first, last].filter(Boolean).join(' ') || person.name;
      }
    }

    updates.last_verified_at = new Date().toISOString();
    updates.updated_at = new Date().toISOString();

    const { error } = await supabase.from('people').update(updates).eq('id', person.id);

    if (error) {
      setErrorMsg(error.message);
      setStage('error');
      return;
    }

    setStage('done');
    setTimeout(() => onApplied(), 1200);
  };

  const toggleField = (key: string) => {
    setSelected((current) => ({ ...current, [key]: !current[key] }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <div className="flex items-center space-x-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50">
              <RotateCw className="h-4.5 w-4.5 text-blue-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Verification Preview</h3>
              <p className="text-xs text-gray-500">{displayName(person)}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-6 py-5">
          {stage === 'idle' && (
            <div className="py-6 text-center">
              <p className="mb-6 text-gray-600">
                Run the shared verification pipeline for this profile, review the evidence, and choose
                which low/medium-risk updates to apply directly.
              </p>
              <button
                onClick={runSearch}
                className="inline-flex items-center space-x-2 rounded-lg bg-blue-600 px-6 py-2.5 font-medium text-white transition-colors hover:bg-blue-700"
              >
                <RotateCw className="h-4 w-4" />
                <span>Run Verification</span>
              </button>
            </div>
          )}

          {stage === 'searching' && (
            <div className="py-10 text-center">
              <Loader2 className="mx-auto mb-4 h-8 w-8 animate-spin text-blue-500" />
              <p className="text-gray-600">
                Verifying profile evidence for {displayName(person)}...
              </p>
            </div>
          )}

          {warnings.length > 0 && stage === 'results' && (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              {warnings.map((warning, index) => (
                <p key={`${warning}-${index}`}>{warning}</p>
              ))}
            </div>
          )}

          {stage === 'results' && suggestions.length === 0 && (
            <div className="py-8 text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
                <Check className="h-6 w-6 text-gray-400" />
              </div>
              <p className="mb-1 text-gray-600">No new information found</p>
              <p className="text-sm text-gray-400">This profile appears to be up to date.</p>
              <button
                onClick={onClose}
                className="mt-5 rounded-lg bg-gray-100 px-5 py-2 font-medium text-gray-700 transition-colors hover:bg-gray-200"
              >
                Close
              </button>
            </div>
          )}

          {stage === 'results' && suggestions.length > 0 && (
            <div>
              <p className="mb-4 text-sm text-gray-500">
                Found {suggestions.length} verification signal{suggestions.length !== 1 ? 's' : ''}.
                High-risk items stay review-first; only actionable updates can be applied from here.
              </p>

              <div className="max-h-[28rem] space-y-3 overflow-y-auto pr-1">
                {suggestions.map((suggestion, index) => {
                  const key = getSuggestionKey(suggestion, index);
                  const actionable = isActionableSuggestion(suggestion.field_name);
                  const confidence = formatConfidence(suggestion.confidence);

                  return (
                    <label
                      key={key}
                      className={`block rounded-xl border p-4 transition-colors ${
                        actionable && selected[key]
                          ? 'border-blue-200 bg-blue-50/50'
                          : 'border-gray-100 bg-gray-50/70'
                      } ${!actionable ? 'cursor-default' : 'cursor-pointer'}`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="pt-0.5">
                          {actionable ? (
                            <input
                              type="checkbox"
                              checked={selected[key] || false}
                              onChange={() => toggleField(key)}
                              className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            />
                          ) : (
                            <ShieldAlert className="mt-0.5 h-4 w-4 text-red-500" />
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="mb-2 flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold text-gray-900">
                              {VERIFICATION_FIELD_LABELS[suggestion.field_name] || suggestion.field_name}
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

                          {suggestion.current_value && (
                            <div className="mb-1 text-sm text-gray-400 line-through">
                              {suggestion.current_value}
                            </div>
                          )}
                          <div className="text-sm font-medium text-gray-900">
                            {suggestion.suggested_value}
                          </div>

                          <p className="mt-2 text-xs text-gray-500">
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
                                    onClick={(event) => event.stopPropagation()}
                                  >
                                    <ExternalLink className="h-3 w-3" />
                                    <span>Open evidence</span>
                                  </a>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>

              <div className="mt-5 flex items-center justify-between border-t border-gray-100 pt-4">
                <div className="text-xs text-gray-500">
                  {selectedSuggestions.length > 0
                    ? `${selectedSuggestions.length} actionable update${
                        selectedSuggestions.length !== 1 ? 's' : ''
                      } selected`
                    : 'No direct profile writes selected'}
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={onClose}
                    className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100"
                  >
                    Close
                  </button>
                  <button
                    onClick={applySelected}
                    disabled={selectedSuggestions.length === 0}
                    className="inline-flex items-center space-x-2 rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-40"
                  >
                    <Check className="h-4 w-4" />
                    <span>
                      Apply {selectedSuggestions.length} Update
                      {selectedSuggestions.length !== 1 ? 's' : ''}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {stage === 'applying' && (
            <div className="py-10 text-center">
              <Loader2 className="mx-auto mb-4 h-8 w-8 animate-spin text-blue-500" />
              <p className="text-gray-600">Applying selected profile updates...</p>
            </div>
          )}

          {stage === 'done' && (
            <div className="py-8 text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
                <Check className="h-6 w-6 text-green-600" />
              </div>
              <p className="font-medium text-gray-900">Profile updated</p>
              <p className="mt-1 text-sm text-gray-500">Selected verification changes were applied.</p>
            </div>
          )}

          {stage === 'error' && (
            <div className="py-8 text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
                <AlertCircle className="h-6 w-6 text-red-600" />
              </div>
              <p className="font-medium text-red-700">{errorMsg || 'Verification failed'}</p>
              <button
                onClick={() => setStage('idle')}
                className="mt-5 rounded-lg bg-gray-100 px-5 py-2 font-medium text-gray-700 transition-colors hover:bg-gray-200"
              >
                Try Again
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
