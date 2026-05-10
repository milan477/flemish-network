import { useMemo, useReducer, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Check, Loader2, Sparkles, User, Building2, RotateCcw, Undo2 } from 'lucide-react';
import { supabase, type Collection } from '../lib/supabase';
import { suggestPeopleEmbedding, type CollectionSuggestionGap } from '../lib/aiService';
import {
  collectionSuggestionDraftReducer,
  EMPTY_COLLECTION_SUGGESTION_DRAFT,
  getAcceptedDraftCandidates,
  getCollectionSuggestionExclusionPayload,
  getVisibleDraftCandidates,
  type CollectionSuggestionCandidate,
} from '../lib/collectionSuggestionDraft';

interface CollectionModalProps {
  collection?: Collection;
  onClose: () => void;
  onSave: (collection: Collection) => void;
}

type Step = 'form' | 'suggestions';

export default function CollectionModal({
  collection,
  onClose,
  onSave,
}: CollectionModalProps) {
  const navigate = useNavigate();
  const [name, setName] = useState(collection?.name || '');
  const [description, setDescription] = useState(collection?.description || '');
  const [step, setStep] = useState<Step>('form');
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [draft, dispatchDraft] = useReducer(
    collectionSuggestionDraftReducer,
    EMPTY_COLLECTION_SUGGESTION_DRAFT
  );
  const [suggestionGap, setSuggestionGap] = useState<CollectionSuggestionGap>({ should_offer: false });
  const [error, setError] = useState<string | null>(null);

  const visibleDraftItems = useMemo(() => getVisibleDraftCandidates(draft), [draft]);
  const acceptedCandidates = useMemo(() => getAcceptedDraftCandidates(draft), [draft]);
  const acceptedCount = acceptedCandidates.length;

  const loadSuggestions = async (
    draftForExclusions = draft
  ) => {
    const query = `${name} ${description}`.trim();
    if (!query) return;

    setIsLoadingSuggestions(true);
    setError(null);
    try {
      const exclusions = getCollectionSuggestionExclusionPayload(draftForExclusions);
      const response = await suggestPeopleEmbedding(query, {
        collection_id: collection?.id,
        ...exclusions,
      });
      dispatchDraft({ type: 'load', candidates: response.candidates });
      setSuggestionGap(response.gap || { should_offer: false });
    } catch (err) {
      console.warn('[CollectionModal] suggestion failed (non-fatal)', err);
      // Never surface raw JS exception text to staff — always a friendly banner.
      setError('Suggestions unavailable — please retry.');
    } finally {
      setIsLoadingSuggestions(false);
    }
  };

  const handleNext = async () => {
    if (!name.trim()) return;
    setStep('suggestions');
    await loadSuggestions();
  };

  const handleFinalSave = async () => {
    setIsSaving(true);
    setError(null);

    try {
      let savedCollection: Collection;
      
      if (collection) {
        const { data, error: updateError } = await supabase
          .from('collections')
          .update({
            name: name.trim(),
            description: description.trim(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', collection.id)
          .select()
          .single();

        if (updateError) throw updateError;
        savedCollection = data;
      } else {
        const { data, error: insertError } = await supabase
          .from('collections')
          .insert({
            name: name.trim(),
            description: description.trim(),
          })
          .select()
          .single();

        if (insertError) throw insertError;
        savedCollection = data;
      }

      // Add only approved draft members.
      if (acceptedCandidates.length > 0) {
        const members = acceptedCandidates.map((candidate) => {
          const base = {
            collection_id: savedCollection.id,
            notes: 'Collection suggestion',
          };

          return candidate.entity_type === 'person'
            ? { ...base, person_id: candidate.id, organization_id: null }
            : { ...base, person_id: null, organization_id: candidate.id };
        });

        const { error: memError } = await supabase
          .from('collection_members')
          .insert(members);

        if (memError) throw memError;
      }
      
      onSave(savedCollection);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save collection');
      setIsSaving(false);
    }
  };

  const handleResetDraft = async () => {
    dispatchDraft({ type: 'reset' });
    setSuggestionGap({ should_offer: false });
    await loadSuggestions(EMPTY_COLLECTION_SUGGESTION_DRAFT);
  };

  const handleDiscoveryHandoff = () => {
    const prompt = suggestionGap.suggested_prompt?.trim() || `${name} ${description}`.trim();
    navigate(`/admin/discovery?prompt=${encodeURIComponent(prompt)}`);
    onClose();
  };

  const formatScore = (score: number) => `${Math.round(score * 100)}% match`;

  const entityLabel = (candidate: CollectionSuggestionCandidate) =>
    candidate.entity_type === 'person' ? 'Person' : 'Organization';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <h2 className="text-xl font-semibold text-gray-900">
            {collection ? 'Edit Collection' : step === 'form' ? 'New Collection' : 'Collection Suggestions'}
          </h2>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {error && (
            <div className="mb-4 p-3 text-sm text-red-600 bg-red-50 rounded-lg">
              {error}
            </div>
          )}

          {step === 'form' ? (
            <div className="space-y-4">
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
                  Name
                </label>
                <input
                  type="text"
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-500 focus:border-yellow-500 outline-none transition-shadow"
                  placeholder="e.g., Biotech Leaders in Boston"
                  required
                  autoFocus
                />
              </div>

              <div>
                <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-1">
                  Description (optional)
                </label>
                <textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-500 focus:border-yellow-500 outline-none transition-shadow resize-none"
                  placeholder="What is this collection for? Collection suggestions will use this context."
                />
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <Sparkles className="w-4 h-4 text-yellow-500" />
                  <span>
                    Review collection suggestions before they are saved.
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void loadSuggestions()}
                    disabled={isLoadingSuggestions}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {isLoadingSuggestions ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                    More
                  </button>
                  <button
                    type="button"
                    onClick={handleResetDraft}
                    disabled={isLoadingSuggestions}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Reset
                  </button>
                </div>
              </div>

              {isLoadingSuggestions ? (
                <div className="py-12 flex flex-col items-center justify-center space-y-4">
                  <Loader2 className="w-8 h-8 text-yellow-500 animate-spin" />
                  <p className="text-sm text-gray-500">Analyzing the network...</p>
                </div>
              ) : visibleDraftItems.length === 0 ? (
                <div className="py-12 text-center bg-gray-50 rounded-xl border border-dashed border-gray-200">
                  <p className="text-gray-500">No pending collection suggestions. You can add members manually later.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {visibleDraftItems.map(({ candidate, status }) => {
                    const isAccepted = status === 'accepted';
                    return (
                      <div 
                        key={`${candidate.entity_type}:${candidate.id}`}
                        className={`p-4 rounded-xl border transition-all ${
                          isAccepted
                            ? 'bg-yellow-50 border-yellow-200 shadow-sm' 
                            : 'bg-white border-gray-100 hover:border-gray-200'
                        }`}
                      >
                        <div className="flex items-start gap-4">
                          {isAccepted ? (
                            <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 bg-yellow-200">
                              <Check className="w-5 h-5 text-yellow-700" />
                            </div>
                          ) : (
                            <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 bg-gray-100 text-gray-500">
                              {candidate.entity_type === 'person' ? (
                                <User className="w-5 h-5" />
                              ) : (
                                <Building2 className="w-5 h-5" />
                              )}
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                              <div className="min-w-0">
                                <h4 className="font-bold text-gray-900 truncate">{candidate.name}</h4>
                                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                                  <span className="rounded bg-gray-100 px-2 py-0.5 font-semibold text-gray-600">
                                    {entityLabel(candidate)}
                                  </span>
                                  {Number.isFinite(candidate.score) && <span>{formatScore(candidate.score)}</span>}
                                  {candidate.source_search && (
                                    <span className="truncate">Source search: {candidate.source_search}</span>
                                  )}
                                </div>
                              </div>
                              <div className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${isAccepted ? 'bg-yellow-400 text-gray-900' : 'bg-gray-100 text-gray-400'}`}>
                                {isAccepted ? 'Approved' : 'Pending'}
                              </div>
                            </div>
                            <p className="mt-3 text-sm text-gray-700">
                              {candidate.reason}
                            </p>
                            {candidate.snippet && (
                              <p className="mt-2 text-xs text-gray-500 line-clamp-2">
                                {candidate.snippet}
                              </p>
                            )}
                            <div className="mt-4 flex flex-wrap gap-2">
                              {isAccepted ? (
                                <button
                                  type="button"
                                  onClick={() => dispatchDraft({
                                    type: 'undo',
                                    entity_type: candidate.entity_type,
                                    id: candidate.id,
                                  })}
                                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                                >
                                  <Undo2 className="h-3.5 w-3.5" />
                                  Undo
                                </button>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => dispatchDraft({
                                      type: 'approve',
                                      entity_type: candidate.entity_type,
                                      id: candidate.id,
                                    })}
                                    className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-black"
                                  >
                                    <Check className="h-3.5 w-3.5" />
                                    Approve
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => dispatchDraft({
                                      type: 'reject',
                                      entity_type: candidate.entity_type,
                                      id: candidate.id,
                                    })}
                                    className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                                  >
                                    Reject
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {suggestionGap.should_offer && (
                <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-blue-950">Discovery can expand coverage</h3>
                      {suggestionGap.reason && (
                        <p className="mt-1 text-sm text-blue-900">{suggestionGap.reason}</p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={handleDiscoveryHandoff}
                      className="rounded-lg bg-blue-900 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-950"
                    >
                      Open Discovery
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between flex-shrink-0 bg-gray-50/50">
          <button
            type="button"
            onClick={step === 'suggestions' ? () => setStep('form') : onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          >
            {step === 'suggestions' ? 'Back' : 'Cancel'}
          </button>
          
          <div className="flex gap-3">
            {step === 'form' ? (
              <button
                type="button"
                onClick={handleNext}
                disabled={!name.trim()}
                className="px-6 py-2 bg-yellow-400 hover:bg-yellow-500 disabled:bg-gray-200 disabled:text-gray-400 text-gray-900 text-sm font-bold rounded-lg transition-all shadow-sm"
              >
                Next: Suggestions
              </button>
            ) : (
              <button
                type="button"
                onClick={handleFinalSave}
                disabled={isSaving}
                className="px-6 py-2 bg-gray-900 hover:bg-black text-white text-sm font-bold rounded-lg transition-all shadow-md flex items-center gap-2"
              >
                {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {collection
                  ? acceptedCount > 0
                    ? `Save with ${acceptedCount} approved`
                    : 'Save changes'
                  : acceptedCount > 0
                    ? `Create with ${acceptedCount} approved`
                    : 'Create empty collection'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
