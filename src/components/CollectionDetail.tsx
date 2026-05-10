import { useState, useEffect, useCallback, useMemo, useReducer, useRef } from 'react';
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
  Building2,
  Check,
  RotateCcw,
  Undo2,
} from 'lucide-react';
import {
  supabase,
  type Collection,
  type CollectionMember,
  type Organization,
  type Person,
  displayName,
} from '../lib/supabase';
import {
  getOrganizationFlemishConnectionText,
  getPersonFlemishConnectionText,
} from '../lib/flemishConnections';
import CollectionModal from './CollectionModal';
import { suggestPeopleEmbedding, type CollectionSuggestionGap } from '../lib/aiService';
import { ProfileAvatar } from './ProfileAvatar';
import CollectionExportMenu from './CollectionExportMenu';
import CollectionSuggestionPreviewModal from './CollectionSuggestionPreviewModal';
import { useAuth } from '../lib/auth';
import { notifyError } from '../lib/toast';
import {
  collectionSuggestionDraftReducer,
  EMPTY_COLLECTION_SUGGESTION_DRAFT,
  getAcceptedDraftCandidates,
  getCollectionSuggestionExclusionPayload,
  getVisibleDraftCandidates,
  type CollectionSuggestionCandidate,
  type CollectionSuggestionDraftItem,
  type CollectionSuggestionDraftState,
} from '../lib/collectionSuggestionDraft';

interface CollectionDetailProps {
  collectionId: string;
  onNavigate: (page: string, id?: string) => void;
  onBack: () => void;
}

interface CachedCollectionSuggestions {
  draft: CollectionSuggestionDraftState;
  message: string;
  gap: CollectionSuggestionGap;
  showSuggestions: boolean;
  updatedAt: string;
}

// Module-level detail cache — keyed by collectionId, survives navigation within a session.
type DetailCacheEntry = { collection: Collection; members: CollectionMember[] };
const _detailCache = new Map<string, DetailCacheEntry>();

const COLLECTION_SUGGESTION_CACHE_VERSION = 1;

function collectionSuggestionCacheKey(collectionId: string): string {
  return `collection-suggestions:v${COLLECTION_SUGGESTION_CACHE_VERSION}:${collectionId}`;
}

function isDraftItem(value: unknown): value is CollectionSuggestionDraftItem {
  const item = value as CollectionSuggestionDraftItem;
  const candidate = item?.candidate;
  return (
    Boolean(candidate) &&
    (candidate.entity_type === 'person' || candidate.entity_type === 'organization') &&
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.reason === 'string' &&
    typeof candidate.score === 'number' &&
    typeof candidate.source_search === 'string' &&
    (item.status === 'pending' || item.status === 'accepted' || item.status === 'rejected')
  );
}

function isDraftState(value: unknown): value is CollectionSuggestionDraftState {
  const state = value as CollectionSuggestionDraftState;
  return (
    Array.isArray(state?.items) &&
    state.items.every(isDraftItem) &&
    Array.isArray(state.rejectedPeopleIds) &&
    state.rejectedPeopleIds.every((id) => typeof id === 'string') &&
    Array.isArray(state.rejectedOrganizationIds) &&
    state.rejectedOrganizationIds.every((id) => typeof id === 'string') &&
    Array.isArray(state.history)
  );
}

function readCachedCollectionSuggestions(key: string): CachedCollectionSuggestions | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedCollectionSuggestions>;
    if (!isDraftState(parsed.draft)) return null;
    return {
      draft: parsed.draft,
      message: typeof parsed.message === 'string' ? parsed.message : '',
      gap: parsed.gap?.should_offer
        ? parsed.gap as CollectionSuggestionGap
        : { should_offer: false },
      showSuggestions: Boolean(parsed.showSuggestions),
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export default function CollectionDetail({
  collectionId,
  onNavigate,
  onBack,
}: CollectionDetailProps) {
  const { canEdit } = useAuth();
  const navigate = useNavigate();
  const _cached = _detailCache.get(collectionId);
  const [collection, setCollection] = useState<Collection | null>(_cached?.collection ?? null);
  const [members, setMembers] = useState<CollectionMember[]>(_cached?.members ?? []);
  const [loading, setLoading] = useState(!_cached);
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
  const [previewCandidate, setPreviewCandidate] = useState<CollectionSuggestionCandidate | null>(null);
  const restoredSuggestionCacheRef = useRef(false);

  const currentMemberIds = useMemo(() => ({
    people: new Set(members.map((member) => member.person_id).filter(Boolean) as string[]),
    organizations: new Set(members.map((member) => member.organization_id).filter(Boolean) as string[]),
  }), [members]);
  const visibleDraftItems = useMemo(() => getVisibleDraftCandidates(draft), [draft]);
  const acceptedCandidates = useMemo(() => getAcceptedDraftCandidates(draft), [draft]);
  const acceptedCount = acceptedCandidates.length;
  const [suggestionGap, setSuggestionGap] = useState<CollectionSuggestionGap>({ should_offer: false });
  const suggestionCacheKey = useMemo(
    () => collectionSuggestionCacheKey(collectionId),
    [collectionId]
  );

  const fetchCollectionData = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!silent) setLoading(true);
    try {
      // Fetch collection info and members in parallel.
      // Members are fetched separately because Supabase cannot always infer both nullable member relationships (person_id / organization_id) from the schema cache.
      const [collRes, memRes] = await Promise.all([
        supabase.from('collections').select('*').eq('id', collectionId).single(),
        supabase
          .from('collection_members')
          .select('*')
          .eq('collection_id', collectionId)
          .order('added_at', { ascending: false }),
      ]);

      if (collRes.error) throw collRes.error;
      if (memRes.error) throw memRes.error;

      setCollection(collRes.data);

      const { data: memData } = memRes;

      const baseMembers = (memData || []) as CollectionMember[];
      const personIds = Array.from(new Set(baseMembers.map((member) => member.person_id).filter(Boolean) as string[]));
      const organizationIds = Array.from(new Set(baseMembers.map((member) => member.organization_id).filter(Boolean) as string[]));
      const [peopleRes, organizationsRes] = await Promise.all([
        personIds.length > 0
          ? supabase
              .from('people')
              .select('*, locations(*), person_flemish_connections(flemish_connection_id, flemish_connections(id, name, type))')
              .in('id', personIds)
          : Promise.resolve({ data: [], error: null }),
        organizationIds.length > 0
          ? supabase
              .from('organizations')
              .select('*, locations(*), organization_flemish_connections(flemish_connection_id, flemish_connections(id, name, type, entity_type, is_filterable))')
              .in('id', organizationIds)
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (peopleRes.error) throw peopleRes.error;
      if (organizationsRes.error) throw organizationsRes.error;

      const peopleById = new Map(
        ((peopleRes.data || []) as Person[]).map((person) => [person.id, person])
      );
      const organizationsById = new Map(
        ((organizationsRes.data || []) as Organization[]).map((organization) => [organization.id, organization])
      );

      const assembledMembers = baseMembers.map((member) => ({
        ...member,
        person: member.person_id ? peopleById.get(member.person_id) : undefined,
        organization: member.organization_id
          ? organizationsById.get(member.organization_id)
          : undefined,
      }));

      _detailCache.set(collectionId, { collection: collRes.data, members: assembledMembers });
      setMembers(assembledMembers);
    } catch (err) {
      console.warn('[CollectionDetail] failed to load collection', err);
      notifyError(err, { hint: 'Could not load this collection.' });
    } finally {
      if (!silent) setLoading(false);
    }
  }, [collectionId]);

  useEffect(() => {
    if (_detailCache.has(collectionId)) {
      void fetchCollectionData({ silent: true });
    } else {
      void fetchCollectionData();
    }
  }, [fetchCollectionData, collectionId]);

  useEffect(() => {
    const cached = readCachedCollectionSuggestions(suggestionCacheKey);
    if (cached) {
      dispatchDraft({ type: 'restore', state: cached.draft });
      setSuggestMessage(cached.message);
      setSuggestionGap(cached.gap);
      setShowSuggestions(cached.showSuggestions || getVisibleDraftCandidates(cached.draft).length > 0);
    }
    restoredSuggestionCacheRef.current = true;
  }, [suggestionCacheKey]);

  useEffect(() => {
    if (!restoredSuggestionCacheRef.current) return;
    const hasDraft = draft.items.length > 0;
    const hasMessage = Boolean(suggestMessage.trim());
    const hasGap = Boolean(suggestionGap.should_offer);

    if (!showSuggestions && !hasDraft && !hasMessage && !hasGap) {
      window.localStorage.removeItem(suggestionCacheKey);
      return;
    }

    const cachePayload: CachedCollectionSuggestions = {
      draft,
      message: suggestMessage,
      gap: suggestionGap,
      showSuggestions,
      updatedAt: new Date().toISOString(),
    };
    window.localStorage.setItem(suggestionCacheKey, JSON.stringify(cachePayload));
  }, [draft, showSuggestions, suggestMessage, suggestionCacheKey, suggestionGap]);

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
      _detailCache.delete(collectionId);
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

  const handleFindSimilar = async (
    draftForExclusions = draft,
    options: { replace?: boolean } = {}
  ) => {
    if (!collection) return;
    setSuggestLoading(true);
    setShowSuggestions(true);
    setSuggestError(null);
    setSuggestMessage('');
    if (options.replace) {
      dispatchDraft({ type: 'reset' });
      setSuggestionGap({ should_offer: false });
    }

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
      const organizationFlemishText = getOrganizationFlemishConnectionText(m.organization);
      if (organizationFlemishText) queryParts.push(organizationFlemishText);
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
      // Never surface raw JS exception text to staff — always a friendly banner.
      console.warn('[CollectionDetail] suggestion failed (non-fatal)', error);
      setSuggestError('Suggestions unavailable — please retry.');
    }

    setSuggestLoading(false);
  };

  const handleRefreshSuggestions = async () => {
    dispatchDraft({ type: 'reset' });
    setSuggestionGap({ should_offer: false });
    await handleFindSimilar(EMPTY_COLLECTION_SUGGESTION_DRAFT, { replace: true });
  };

  const handleResetDraft = () => {
    dispatchDraft({ type: 'reset' });
    setSuggestMessage('');
    setSuggestError(null);
    setSuggestionGap({ should_offer: false });
    setShowSuggestions(false);
    window.localStorage.removeItem(suggestionCacheKey);
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
      setSuggestMessage('');
      setShowSuggestions(false);
      window.localStorage.removeItem(suggestionCacheKey);
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
          <CollectionExportMenu
            members={members}
            filename={collection.name.replace(/\s+/g, '-').toLowerCase()}
          />
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
                  onClick={() => void handleRefreshSuggestions()}
                  disabled={suggestLoading}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-yellow-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-yellow-50 disabled:opacity-50"
                >
                  {suggestLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  Refresh
                </button>
                <button
                  type="button"
                  onClick={handleResetDraft}
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
                            type="button"
                            onClick={() => setPreviewCandidate(candidate)}
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
              const detailText = organization?.description || getOrganizationFlemishConnectionText(organization);

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

      {previewCandidate && (
        <CollectionSuggestionPreviewModal
          entityType={previewCandidate.entity_type}
          entityId={previewCandidate.id}
          onClose={() => setPreviewCandidate(null)}
          onOpenProfile={(entityType, entityId) => {
            setPreviewCandidate(null);
            onNavigate(entityType, entityId);
          }}
        />
      )}
    </div>
  );
}
