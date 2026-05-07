import { useState, useEffect, useCallback, useMemo, useReducer } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronLeft,
  Trash2,
  ExternalLink,
  MapPin,
  Briefcase,
  User,
  X,
  FileText,
  Save,
  Pencil,
  Sparkles,
  Loader2,
  Printer,
  Building2,
  Check,
  RotateCcw,
  Undo2,
} from 'lucide-react';
import {
  supabase,
  type Collection,
  type CollectionMember,
  displayName,
} from '../lib/supabase';
import { getPersonFlemishConnectionText } from '../lib/flemishConnections';
import CollectionModal from './CollectionModal';
import { suggestPeopleEmbedding, type CollectionSuggestionGap } from '../lib/aiService';
import { printCollectionBriefing } from '../lib/exportService';
import { ProfileAvatar } from './ProfileAvatar';
import PeopleExportMenu from './PeopleExportMenu';
import { useAuth } from '../lib/auth';
import { notifyError } from '../lib/toast';
import {
  collectionSuggestionDraftReducer,
  EMPTY_COLLECTION_SUGGESTION_DRAFT,
  getAcceptedDraftCandidates,
  getCollectionSuggestionExclusionPayload,
  getVisibleDraftCandidates,
  type CollectionSuggestionCandidate,
  type CollectionSuggestionDraftState,
} from '../lib/collectionSuggestionDraft';

interface CollectionDetailProps {
  collectionId: string;
  onNavigate: (page: string, id?: string) => void;
  onBack: () => void;
}

export default function CollectionDetail({
  collectionId,
  onNavigate,
  onBack,
}: CollectionDetailProps) {
  const { canEdit } = useAuth();
  const navigate = useNavigate();
  const [collection, setCollection] = useState<Collection | null>(null);
  const [members, setMembers] = useState<CollectionMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingNotes, setEditingNotes] = useState<string | null>(null);
  const [notesValue, setNotesValue] = useState('');
  const [isSavingNotes, setIsSavingNotes] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [draft, dispatchDraft] = useReducer(
    collectionSuggestionDraftReducer,
    EMPTY_COLLECTION_SUGGESTION_DRAFT
  );
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [savingDraftMembers, setSavingDraftMembers] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestMessage, setSuggestMessage] = useState('');
  const [suggestError, setSuggestError] = useState<string | null>(null);

  const personMembers = useMemo(
    () => members.filter((member) => member.person).map((member) => member.person!),
    [members]
  );
  const currentMemberIds = useMemo(() => ({
    people: new Set(members.map((member) => member.person_id).filter(Boolean) as string[]),
    organizations: new Set(members.map((member) => member.organization_id).filter(Boolean) as string[]),
  }), [members]);
  const visibleDraftItems = useMemo(() => getVisibleDraftCandidates(draft), [draft]);
  const acceptedCandidates = useMemo(() => getAcceptedDraftCandidates(draft), [draft]);
  const acceptedCount = acceptedCandidates.length;
  const [suggestionGap, setSuggestionGap] = useState<CollectionSuggestionGap>({ should_offer: false });

  const fetchCollectionData = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch collection info
      const { data: collData, error: collError } = await supabase
        .from('collections')
        .select('*')
        .eq('id', collectionId)
        .single();

      if (collError) throw collError;
      setCollection(collData);

      // Fetch members with person and organization data
      const { data: memData, error: memError } = await supabase
        .from('collection_members')
        .select('*, person:people(*, locations(*), person_flemish_connections(flemish_connection_id, flemish_connections(id, name, type))), organization:organizations(*, locations(*))')
        .eq('collection_id', collectionId)
        .order('added_at', { ascending: false });

      if (memError) throw memError;
      setMembers(memData || []);
    } catch (err) {
      console.warn('[CollectionDetail] failed to load collection', err);
      notifyError(err, { hint: 'Could not load this collection.' });
    } finally {
      setLoading(false);
    }
  }, [collectionId]);

  useEffect(() => {
    void fetchCollectionData();
  }, [fetchCollectionData]);

  const handleRemoveMember = async (memberId: string) => {
    if (!window.confirm('Remove this member from the collection?')) return;

    try {
      const { error } = await supabase
        .from('collection_members')
        .delete()
        .eq('id', memberId);

      if (error) throw error;
      setMembers((current) => current.filter((m) => m.id !== memberId));
    } catch (err) {
      notifyError(err, { hint: 'Could not remove this member from the collection.' });
    }
  };

  const startEditingNotes = (member: CollectionMember) => {
    setEditingNotes(member.id);
    setNotesValue(member.notes || '');
  };

  const saveNotes = async (memberId: string) => {
    setIsSavingNotes(true);
    try {
      const { error } = await supabase
        .from('collection_members')
        .update({ notes: notesValue })
        .eq('id', memberId);

      if (error) throw error;

      setMembers((current) =>
        current.map((m) =>
          m.id === memberId ? { ...m, notes: notesValue } : m
        )
      );
      setEditingNotes(null);
    } catch (err) {
      notifyError(err, { hint: 'Could not save notes.' });
    } finally {
      setIsSavingNotes(false);
    }
  };

  const handleDeleteCollection = async () => {
    if (!collection) return;
    if (
      !window.confirm(
        'Are you sure you want to delete this collection? This action cannot be undone.'
      )
    )
      return;

    try {
      const { error } = await supabase
        .from('collections')
        .delete()
        .eq('id', collection.id);

      if (error) throw error;
      onBack();
    } catch (err) {
      notifyError(err, { hint: 'Could not delete the collection.' });
    }
  };

  const getDraftExclusionsWithCurrentMembers = (
    draftState: CollectionSuggestionDraftState
  ) => {
    const exclusions = getCollectionSuggestionExclusionPayload(draftState);
    return {
      exclude_ids: Array.from(new Set([...exclusions.exclude_ids, ...currentMemberIds.people])),
      exclude_organization_ids: Array.from(new Set([
        ...exclusions.exclude_organization_ids,
        ...currentMemberIds.organizations,
      ])),
    };
  };

  const isCurrentMemberCandidate = (candidate: CollectionSuggestionCandidate) =>
    candidate.entity_type === 'person'
      ? currentMemberIds.people.has(candidate.id)
      : currentMemberIds.organizations.has(candidate.id);

  const handleFindSimilar = async (draftForExclusions = draft) => {
    if (!collection) return;
    setSuggestLoading(true);
    setShowSuggestions(true);
    setSuggestError(null);
    setSuggestMessage('');

    // Build query from collection description + top member bios
    const queryParts: string[] = [];
    if (collection.description) queryParts.push(collection.description);
    members.slice(0, 5).forEach((m) => {
      if (m.person?.current_position) queryParts.push(m.person.current_position);
      if (m.person?.occupation) queryParts.push(m.person.occupation);
      if (m.person?.bio) queryParts.push(m.person.bio);
      const flemishText = getPersonFlemishConnectionText(m.person);
      if (flemishText) queryParts.push(flemishText);
      if (m.organization?.type) queryParts.push(m.organization.type);
      if (m.organization?.description) queryParts.push(m.organization.description);
      if (m.organization?.flemish_link) queryParts.push(m.organization.flemish_link);
    });
    const query = queryParts.join('. ') || collection.name;

    try {
      const exclusions = getDraftExclusionsWithCurrentMembers(draftForExclusions);
      const response = await suggestPeopleEmbedding(query, {
        collection_id: collectionId,
        ...exclusions,
        max_results: 10,
      });
      const candidates = response.candidates.filter((candidate) => !isCurrentMemberCandidate(candidate));
      dispatchDraft({ type: 'load', candidates });
      setSuggestMessage(response.message);
      setSuggestionGap(response.gap || { should_offer: false });
    } catch (error) {
      setSuggestError(
        error instanceof Error
          ? error.message
          : 'Unable to load collection suggestions right now.'
      );
    }

    setSuggestLoading(false);
  };

  const handleResetDraft = async () => {
    dispatchDraft({ type: 'reset' });
    setSuggestionGap({ should_offer: false });
    await handleFindSimilar(EMPTY_COLLECTION_SUGGESTION_DRAFT);
  };

  const handleDiscoveryHandoff = () => {
    if (!collection) return;
    const prompt = suggestionGap.suggested_prompt?.trim() ||
      [collection.name, collection.description].filter(Boolean).join(' ');
    navigate(`/admin/discovery?prompt=${encodeURIComponent(prompt)}`);
  };

  const handleSaveAcceptedSuggestions = async () => {
    const newCandidates = acceptedCandidates.filter(
      (candidate) => !isCurrentMemberCandidate(candidate)
    );
    if (newCandidates.length === 0) return;

    setSavingDraftMembers(true);
    try {
      const rows = newCandidates.map((candidate) => {
        const base = {
          collection_id: collectionId,
          notes: 'Collection suggestion',
        };

        return candidate.entity_type === 'person'
          ? { ...base, person_id: candidate.id, organization_id: null }
          : { ...base, person_id: null, organization_id: candidate.id };
      });

      const { error } = await supabase
        .from('collection_members')
        .insert(rows);
      if (error) throw error;
      dispatchDraft({ type: 'reset' });
      setSuggestionGap({ should_offer: false });
      setShowSuggestions(false);
      await fetchCollectionData();
    } catch (err) {
      notifyError(err, { hint: 'Could not add approved suggestions to the collection.' });
    } finally {
      setSavingDraftMembers(false);
    }
  };

  const formatScore = (score: number) => `${Math.round(score * 100)}% match`;

  const entityLabel = (candidate: CollectionSuggestionCandidate) =>
    candidate.entity_type === 'person' ? 'Person' : 'Organization';

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-yellow-400"></div>
      </div>
    );
  }

  if (!collection) {
    return (
      <div className="p-8 text-center bg-white rounded-xl shadow-sm border border-gray-100">
        <h3 className="text-lg font-semibold text-gray-900 mb-2">
          Collection not found
        </h3>
        <button
          onClick={onBack}
          className="text-yellow-600 hover:text-yellow-700 font-medium"
        >
          Back to Collections
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <button
            onClick={onBack}
            className="flex items-center text-sm font-medium text-gray-500 hover:text-gray-900 transition-colors mb-4"
          >
            <ChevronLeft className="w-4 h-4 mr-1" />
            Back to Collections
          </button>
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-3xl font-bold text-gray-900">
              {collection.name}
            </h1>
            {canEdit && (
              <button
                onClick={() => setShowEditModal(true)}
                className="p-1.5 text-gray-400 hover:text-yellow-600 hover:bg-yellow-50 rounded-lg transition-all"
                title="Edit collection name/description"
              >
                <Pencil className="w-5 h-5" />
              </button>
            )}
          </div>
          {collection.description && (
            <p className="text-gray-600 max-w-2xl">{collection.description}</p>
          )}
        </div>

        <div className="flex items-center gap-3">
          {members.length > 0 && (
            <>
              <PeopleExportMenu
                people={personMembers}
                filename={`${collection.name.replace(/\s+/g, '-').toLowerCase()}.csv`}
                buttonClassName="flex items-center space-x-2 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 rounded-lg transition-colors border border-gray-200 hover:border-gray-300 disabled:opacity-50"
              />
              <button
                onClick={() => {
                  printCollectionBriefing(
                    collection.name,
                    collection.description,
                    members.filter((m) => m.person).map((m) => ({ person: m.person!, notes: m.notes }))
                  );
                }}
                disabled={personMembers.length === 0}
                className="flex items-center px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 rounded-lg transition-colors border border-gray-200 hover:border-gray-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Printer className="w-4 h-4 mr-2" />
                Export People Briefing
              </button>
            </>
          )}
          {canEdit && (
            <button
              onClick={handleDeleteCollection}
              className="flex items-center px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors border border-transparent hover:border-red-100"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete Collection
            </button>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">
            Members ({members.length})
          </h2>
          {canEdit && (
            <button
              onClick={() => void handleFindSimilar()}
              disabled={suggestLoading}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-yellow-400 hover:bg-yellow-500 text-gray-900 rounded-lg transition-colors disabled:opacity-50"
            >
              {suggestLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
              Find Collection Suggestions
            </button>
          )}
        </div>

        {showSuggestions && canEdit && (
          <div className="px-6 py-4 bg-yellow-50/50 border-b border-yellow-100">
            <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">
                  Collection Suggestions
                </h3>
                <p className="text-xs text-gray-500">
                  Review suggestions before adding them as collection members.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleFindSimilar()}
                  disabled={suggestLoading}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-yellow-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-yellow-50 disabled:opacity-50"
                >
                  {suggestLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  More
                </button>
                <button
                  type="button"
                  onClick={() => void handleResetDraft()}
                  disabled={suggestLoading}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-yellow-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-yellow-50 disabled:opacity-50"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Reset
                </button>
                <button
                  onClick={() => setShowSuggestions(false)}
                  className="p-1 text-gray-400 hover:text-gray-600 rounded"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            {suggestError && (
              <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {suggestError}
              </div>
            )}
            {!suggestError && suggestMessage && (
              <p className="mb-3 text-sm text-gray-600">{suggestMessage}</p>
            )}
            {suggestLoading ? (
              <div className="flex items-center gap-2 text-sm text-gray-500 py-4">
                <Loader2 className="w-4 h-4 animate-spin" />
                Finding collection suggestions...
              </div>
            ) : visibleDraftItems.length === 0 ? (
              <p className="text-sm text-gray-500 py-2">
                No pending collection suggestions.
              </p>
            ) : (
              <div className="space-y-2">
                {visibleDraftItems.map(({ candidate, status }) => (
                  <div
                    key={`${candidate.entity_type}:${candidate.id}`}
                    className={`p-3 rounded-lg border ${
                      status === 'accepted'
                        ? 'border-yellow-200 bg-yellow-50'
                        : 'border-gray-100 bg-white'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 flex-1 items-start gap-3">
                        <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-500">
                          {candidate.entity_type === 'person' ? (
                            <User className="h-4 w-4" />
                          ) : (
                            <Building2 className="h-4 w-4" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <button
                            onClick={() => onNavigate(candidate.entity_type, candidate.id)}
                            className="block truncate text-sm font-semibold text-gray-900 hover:text-yellow-700"
                          >
                            {candidate.name}
                          </button>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                            <span className="rounded bg-gray-100 px-2 py-0.5 font-semibold text-gray-600">
                              {entityLabel(candidate)}
                            </span>
                            {Number.isFinite(candidate.score) && <span>{formatScore(candidate.score)}</span>}
                            {candidate.source_search && (
                              <span className="truncate">Source search: {candidate.source_search}</span>
                            )}
                          </div>
                          <p className="mt-2 text-xs text-gray-600">{candidate.reason}</p>
                          {candidate.snippet && (
                            <p className="mt-1 text-xs text-gray-500 line-clamp-2">{candidate.snippet}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-shrink-0 items-center gap-2">
                        {status === 'accepted' ? (
                          <button
                            type="button"
                            onClick={() => dispatchDraft({
                              type: 'undo',
                              entity_type: candidate.entity_type,
                              id: candidate.id,
                            })}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors rounded-md border border-gray-200 bg-white hover:bg-gray-50"
                          >
                            <Undo2 className="h-3 w-3" />
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
                              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-yellow-400 hover:bg-yellow-500 text-gray-900 rounded-md transition-colors"
                            >
                              <Check className="h-3 w-3" />
                              Approve
                            </button>
                            <button
                              type="button"
                              onClick={() => dispatchDraft({
                                type: 'reject',
                                entity_type: candidate.entity_type,
                                id: candidate.id,
                              })}
                              className="px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors rounded-md border border-gray-200 bg-white hover:bg-gray-50"
                            >
                              Reject
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs text-gray-500">
                    {acceptedCount} approved suggestion{acceptedCount === 1 ? '' : 's'} ready to add.
                  </p>
                  <button
                    type="button"
                    onClick={handleSaveAcceptedSuggestions}
                    disabled={savingDraftMembers || acceptedCount === 0}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-black disabled:opacity-50"
                  >
                    {savingDraftMembers ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                    Add Approved
                  </button>
                </div>
              </div>
            )}
            {suggestionGap.should_offer && (
              <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50 p-4">
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

        {members.length === 0 ? (
          <div className="p-12 text-center">
            <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <User className="w-8 h-8 text-gray-300" />
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-1">
              Your collection is empty
            </h3>
            <p className="text-gray-500 mb-6">
              {canEdit
                ? 'Search the network and add members to this collection.'
                : 'This collection does not have any members yet.'}
            </p>
            <button
              onClick={() => onNavigate('dashboard')}
              className="px-6 py-2 bg-yellow-400 hover:bg-yellow-500 text-gray-900 font-semibold rounded-lg transition-colors shadow-sm"
            >
              Browse Network
            </button>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {members.map((member) => {
              const person = member.person;
              const organization = member.organization;
              const isPerson = Boolean(person);
              const entityName = person
                ? displayName(person)
                : organization?.name || 'Unknown member';
              const entityTypeLabel = isPerson ? 'Person' : 'Organization';
              const locationText = person
                ? [person.locations?.city, person.locations?.state].filter(Boolean).join(', ')
                : [organization?.locations?.city, organization?.locations?.state].filter(Boolean).join(', ');
              const roleText = person?.current_position || organization?.type;
              const detailText = organization?.description || organization?.flemish_link;

              return (
                <div key={member.id} className="p-6 hover:bg-gray-50/50 transition-colors">
                  <div className="flex flex-col lg:flex-row lg:items-start gap-6">
                    <div className="flex items-start gap-4 lg:w-72 xl:w-80 flex-shrink-0">
                      {person ? (
                        <ProfileAvatar person={person} size="md" />
                      ) : (
                        <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-500">
                          <Building2 className="h-6 w-6" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="text-lg font-bold text-gray-900 truncate">
                            {entityName}
                          </h4>
                          {(person || organization) && (
                            <button
                              onClick={() => onNavigate(isPerson ? 'person' : 'organization', (person || organization)!.id)}
                              className="p-1 text-gray-400 hover:text-yellow-600 transition-colors"
                            >
                              <ExternalLink className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                        <div className="flex flex-col gap-1.5 text-xs text-gray-600">
                          <span className="w-fit rounded bg-gray-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-gray-500">
                            {entityTypeLabel}
                          </span>
                          {roleText && (
                            <div className="flex items-start">
                              <Briefcase className="w-3.5 h-3.5 mr-1.5 text-gray-400 mt-0.5 flex-shrink-0" />
                              <span className="line-clamp-2">
                                {roleText}
                              </span>
                            </div>
                          )}
                          {locationText && (
                            <div className="flex items-center">
                              <MapPin className="w-3.5 h-3.5 mr-1.5 text-gray-400 flex-shrink-0" />
                              <span className="truncate">{locationText}</span>
                            </div>
                          )}
                          {!person && detailText && (
                            <p className="line-clamp-2 text-gray-500">{detailText}</p>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex-1">
                      {editingNotes === member.id ? (
                        <div className="space-y-2">
                          <textarea
                            value={notesValue}
                            onChange={(e) => setNotesValue(e.target.value)}
                            placeholder="Add notes about this member in this collection..."
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-500 focus:border-yellow-500 outline-none transition-shadow resize-none"
                            rows={3}
                            autoFocus
                          />
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() => setEditingNotes(null)}
                              className="px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 rounded-md transition-colors"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={() => saveNotes(member.id)}
                              disabled={isSavingNotes}
                              className="flex items-center px-3 py-1 text-xs font-semibold bg-gray-900 text-white rounded-md hover:bg-gray-800 transition-colors disabled:bg-gray-400"
                            >
                              <Save className="w-3 h-3 mr-1" />
                              {isSavingNotes ? 'Saving...' : 'Save Notes'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div
                          onClick={() => {
                            if (canEdit) startEditingNotes(member);
                          }}
                          className={`group p-3 bg-gray-50 rounded-lg border border-transparent min-h-[64px] ${
                            canEdit
                              ? 'cursor-pointer hover:border-gray-200 transition-all'
                              : ''
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                              Notes
                            </span>
                            <FileText className="w-3 h-3 text-gray-300 group-hover:text-gray-400 transition-colors" />
                          </div>
                          <p className={`text-sm ${member.notes ? 'text-gray-700' : 'text-gray-400 italic'}`}>
                            {member.notes || 'Click to add notes...'}
                          </p>
                        </div>
                      )}
                    </div>

                    <div className="flex items-start justify-end">
                      {canEdit && (
                        <button
                          onClick={() => handleRemoveMember(member.id)}
                          className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Remove from collection"
                        >
                          <X className="w-5 h-5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showEditModal && canEdit && (
        <CollectionModal
          collection={collection}
          onClose={() => setShowEditModal(false)}
          onSave={(updated) => {
            setCollection(updated);
            setShowEditModal(false);
          }}
        />
      )}
    </div>
  );
}
