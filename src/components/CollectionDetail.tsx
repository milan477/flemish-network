import { useState, useEffect, useCallback } from 'react';
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
  Plus,
  Printer,
} from 'lucide-react';
import {
  supabase,
  type Collection,
  type CollectionMember,
  displayName,
} from '../lib/supabase';
import { getPersonFlemishConnectionText } from '../lib/flemishConnections';
import CollectionModal from './CollectionModal';
import { suggestPeopleEmbedding, type SuggestPeopleResult } from '../lib/aiService';
import { printCollectionBriefing } from '../lib/exportService';
import { ProfileAvatar } from './ProfileAvatar';
import PeopleExportMenu from './PeopleExportMenu';
import { useAuth } from '../lib/auth';
import { notifyError } from '../lib/toast';

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
  const [collection, setCollection] = useState<Collection | null>(null);
  const [members, setMembers] = useState<CollectionMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingNotes, setEditingNotes] = useState<string | null>(null);
  const [notesValue, setNotesValue] = useState('');
  const [isSavingNotes, setIsSavingNotes] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [suggestions, setSuggestions] = useState<SuggestPeopleResult[]>([]);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestMessage, setSuggestMessage] = useState('');
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [addingIds, setAddingIds] = useState<Set<string>>(new Set());

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

      // Fetch members with person data
      const { data: memData, error: memError } = await supabase
        .from('collection_members')
        .select('*, person:people(*, locations(*), person_flemish_connections(flemish_connection_id, flemish_connections(id, name, type)))')
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
    if (!window.confirm('Remove this person from the collection?')) return;

    try {
      const { error } = await supabase
        .from('collection_members')
        .delete()
        .eq('id', memberId);

      if (error) throw error;
      setMembers(members.filter((m) => m.id !== memberId));
    } catch (err) {
      notifyError(err, { hint: 'Could not remove this person from the collection.' });
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

      setMembers(
        members.map((m) =>
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

  const handleFindSimilar = async () => {
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
    });
    const query = queryParts.join('. ') || collection.name;

    try {
      const response = await suggestPeopleEmbedding(query, {
        collection_id: collectionId,
        max_results: 10,
      });
      setSuggestions(response.suggestions);
      setSuggestMessage(response.message);
    } catch (error) {
      setSuggestions([]);
      setSuggestError(
        error instanceof Error
          ? error.message
          : 'Unable to load suggested people right now.'
      );
    }

    setSuggestLoading(false);
  };

  const handleAddSuggestion = async (personId: string) => {
    setAddingIds((prev) => new Set([...prev, personId]));
    try {
      const { error } = await supabase
        .from('collection_members')
        .insert({ collection_id: collectionId, person_id: personId });
      if (error) throw error;
      // Remove from suggestions, refresh members
      setSuggestions((prev) => prev.filter((s) => s.id !== personId));
      await fetchCollectionData();
    } catch (err) {
      notifyError(err, { hint: 'Could not add this person to the collection.' });
    }
    setAddingIds((prev) => {
      const next = new Set(prev);
      next.delete(personId);
      return next;
    });
  };

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
                people={members.filter((m) => m.person).map((m) => m.person!)}
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
                className="flex items-center px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 rounded-lg transition-colors border border-gray-200 hover:border-gray-300"
              >
                <Printer className="w-4 h-4 mr-2" />
                Export Briefing
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
              onClick={handleFindSimilar}
              disabled={suggestLoading}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-yellow-400 hover:bg-yellow-500 text-gray-900 rounded-lg transition-colors disabled:opacity-50"
            >
              {suggestLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
              Find Similar People
            </button>
          )}
        </div>

        {showSuggestions && canEdit && (
          <div className="px-6 py-4 bg-yellow-50/50 border-b border-yellow-100">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-900">
                Suggested People
              </h3>
              <button
                onClick={() => setShowSuggestions(false)}
                className="p-1 text-gray-400 hover:text-gray-600 rounded"
              >
                <X className="w-4 h-4" />
              </button>
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
                Finding similar people...
              </div>
            ) : suggestions.length === 0 ? (
              <p className="text-sm text-gray-500 py-2">
                No suggestions found. Try generating embeddings first from the Admin page.
              </p>
            ) : (
              <div className="space-y-2">
                {suggestions.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center justify-between p-3 bg-white rounded-lg border border-gray-100"
                  >
                    <div className="min-w-0 flex-1">
                      <button
                        onClick={() => onNavigate('person', s.id)}
                        className="text-sm font-medium text-gray-900 hover:text-yellow-700 truncate block"
                      >
                        {s.name}
                      </button>
                      <p className="text-xs text-gray-500 truncate">{s.reason}</p>
                    </div>
                    <div className="flex items-center gap-2 ml-3 flex-shrink-0">
                      <span className="text-xs text-gray-400">
                        {(s.similarity * 100).toFixed(0)}%
                      </span>
                      {canEdit && (
                        <button
                          onClick={() => handleAddSuggestion(s.id)}
                          disabled={addingIds.has(s.id)}
                          className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-yellow-400 hover:bg-yellow-500 text-gray-900 rounded-md transition-colors disabled:opacity-50"
                        >
                          {addingIds.has(s.id) ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Plus className="w-3 h-3" />
                          )}
                          Add
                        </button>
                      )}
                    </div>
                  </div>
                ))}
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
                ? 'Search for people in the network and add them to this collection.'
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
              if (!member.person) return null;
              const person = member.person;

              return (
                <div key={member.id} className="p-6 hover:bg-gray-50/50 transition-colors">
                  <div className="flex flex-col lg:flex-row lg:items-start gap-6">
                    {/* Person Info Section - Fixed width on LG to align notes */}
                    <div className="flex items-start gap-4 lg:w-72 xl:w-80 flex-shrink-0">
                      <ProfileAvatar person={person} size="md" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="text-lg font-bold text-gray-900 truncate">
                            {displayName(person)}
                          </h4>
                          <button
                            onClick={() => onNavigate('person', person.id)}
                            className="p-1 text-gray-400 hover:text-yellow-600 transition-colors"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </button>
                        </div>
                        <div className="flex flex-col gap-1.5 text-xs text-gray-600">
                          {person.current_position && (
                            <div className="flex items-start">
                              <Briefcase className="w-3.5 h-3.5 mr-1.5 text-gray-400 mt-0.5 flex-shrink-0" />
                              <span className="line-clamp-2">
                                {person.current_position}
                              </span>
                            </div>
                          )}
                          {(person.locations?.city || person.locations?.state) && (
                            <div className="flex items-center">
                              <MapPin className="w-3.5 h-3.5 mr-1.5 text-gray-400 flex-shrink-0" />
                              <span className="truncate">
                                {[
                                  person.locations?.city,
                                  person.locations?.state,
                                ].filter(Boolean).join(', ')}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Notes Section - Flex-1 to fill space */}
                    <div className="flex-1">
                      {editingNotes === member.id ? (
                        <div className="space-y-2">
                          <textarea
                            value={notesValue}
                            onChange={(e) => setNotesValue(e.target.value)}
                            placeholder="Add notes about this person in this collection..."
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
