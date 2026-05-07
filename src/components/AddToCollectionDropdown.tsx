import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Library, Plus, Check, Loader2, Minus } from 'lucide-react';
import { supabase, type Collection } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { notifyError } from '../lib/toast';

const EMPTY_IDS: string[] = [];

interface AddToCollectionDropdownProps {
  personIds?: string[];
  organizationIds?: string[];
  onClose?: () => void;
  onSuccess?: () => void;
}

export default function AddToCollectionDropdown({
  personIds = EMPTY_IDS,
  organizationIds = EMPTY_IDS,
  onClose,
  onSuccess,
}: AddToCollectionDropdownProps) {
  const { canEdit } = useAuth();
  const [collections, setCollections] = useState<Collection[]>([]);
  const [membershipCount, setMembershipCount] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [showCreateInline, setShowCreateInline] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  const hasPeople = personIds.length > 0;
  const hasOrganizations = organizationIds.length > 0;
  const entityType = hasOrganizations ? 'organization' : 'person';
  const entityColumn = entityType === 'person' ? 'person_id' : 'organization_id';
  const entityIds = entityType === 'person' ? personIds : organizationIds;
  const validEntitySelection = entityIds.length > 0 && hasPeople !== hasOrganizations;
  const isBulk = entityIds.length > 1;
  const entityLabel = entityType === 'person' ? 'person' : 'organization';
  const entityLabelPlural = entityType === 'person' ? 'people' : 'organizations';
  const entityIdsKey = useMemo(
    () => JSON.stringify({ personIds, organizationIds }),
    [personIds, organizationIds]
  );

  const fetchData = useCallback(async () => {
    if (!validEntitySelection) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      // Fetch all collections
      const { data: colls, error: collsError } = await supabase
        .from('collections')
        .select('*')
        .order('name');
      
      if (collsError) throw collsError;
      setCollections(colls || []);

      // Fetch which collections these entities belong to.
      const { data: memberships, error: memError } = await supabase
        .from('collection_members')
        .select(`collection_id, ${entityColumn}`)
        .in(entityColumn, entityIds);
      
      if (memError) throw memError;
      
      const counts: Record<string, number> = {};
      memberships?.forEach(m => {
        counts[m.collection_id] = (counts[m.collection_id] || 0) + 1;
      });
      setMembershipCount(counts);
    } catch (err) {
      console.warn('[AddToCollectionDropdown] failed to load memberships', err);
    } finally {
      setLoading(false);
    }
  }, [entityColumn, entityIds, validEntitySelection]);

  useEffect(() => {
    if (!canEdit) return;
    void fetchData();
    
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        onClose?.();
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [canEdit, fetchData, onClose, entityIdsKey]);

  const toggleCollection = async (collectionId: string) => {
    if (!validEntitySelection) {
      notifyError(new Error('Select either people or organizations before updating a collection.'), {
        hint: 'Could not update collection membership.',
      });
      return;
    }

    setProcessingId(collectionId);
    const count = membershipCount[collectionId] || 0;
    const allAreMembers = count === entityIds.length;

    try {
      if (allAreMembers) {
        // Remove all selected entities of this type.
        const { error } = await supabase
          .from('collection_members')
          .delete()
          .eq('collection_id', collectionId)
          .in(entityColumn, entityIds);
        
        if (error) throw error;
        setMembershipCount(prev => ({ ...prev, [collectionId]: 0 }));
      } else {
        // Add selected entities that are not already members.
        const { data: existing } = await supabase
          .from('collection_members')
          .select(entityColumn)
          .eq('collection_id', collectionId)
          .in(entityColumn, entityIds);
        
        const existingRows = (existing || []) as Array<Record<string, string | null>>;
        const existingIds = new Set(
          existingRows
            .map((row) => row[entityColumn])
            .filter((id): id is string => typeof id === 'string') || []
        );
        const toAdd = entityIds.filter(id => !existingIds.has(id));

        if (toAdd.length > 0) {
          const { error } = await supabase
            .from('collection_members')
            .insert(toAdd.map(entityId => ({
              collection_id: collectionId,
              person_id: entityType === 'person' ? entityId : null,
              organization_id: entityType === 'organization' ? entityId : null,
            })));
          
          if (error) throw error;
        }
        setMembershipCount(prev => ({ ...prev, [collectionId]: entityIds.length }));
      }
      onSuccess?.();
    } catch (err) {
      notifyError(err, { hint: 'Could not update collection membership.' });
    } finally {
      setProcessingId(null);
    }
  };

  const handleCreateCollection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCollectionName.trim() || !validEntitySelection) return;

    setLoading(true);
    try {
      const { data: newColl, error: insertError } = await supabase
        .from('collections')
        .insert({ name: newCollectionName.trim() })
        .select()
        .single();
      
      if (insertError) throw insertError;

      // Add selected entities to the new collection.
      const { error: memError } = await supabase
        .from('collection_members')
        .insert(entityIds.map(entityId => ({
          collection_id: newColl.id,
          person_id: entityType === 'person' ? entityId : null,
          organization_id: entityType === 'organization' ? entityId : null,
        })));
      
      if (memError) throw memError;

      setCollections(prev => [...prev, newColl].sort((a, b) => a.name.localeCompare(b.name)));
      setMembershipCount(prev => ({ ...prev, [newColl.id]: entityIds.length }));
      setNewCollectionName('');
      setShowCreateInline(false);
      onSuccess?.();
    } catch (err) {
      notifyError(err, { hint: 'Could not create the collection.' });
    } finally {
      setLoading(false);
    }
  };

  if (!canEdit || !validEntitySelection) {
    return null;
  }

  return (
    <div 
      ref={dropdownRef}
      className="absolute right-0 top-full mt-2 w-64 bg-white rounded-xl shadow-xl border border-gray-100 z-[70] overflow-hidden"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="px-4 py-3 border-b border-gray-50 bg-gray-50/50">
        <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 flex items-center gap-2">
          <Library className="w-3 h-3" />
          {isBulk ? `Add ${entityIds.length} ${entityLabelPlural} to Collection` : 'Add to Collection'}
        </h4>
      </div>

      <div className="max-h-64 overflow-y-auto py-2">
        {loading && collections.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <Loader2 className="w-6 h-6 text-yellow-500 animate-spin mx-auto mb-2" />
            <p className="text-xs text-gray-400">Loading collections...</p>
          </div>
        ) : collections.length === 0 && !showCreateInline ? (
          <div className="px-4 py-6 text-center">
            <p className="text-sm text-gray-500 mb-3">No collections yet</p>
          </div>
        ) : (
          collections.map(collection => {
            const count = membershipCount[collection.id] || 0;
            const allIn = count === entityIds.length;
            const someIn = count > 0 && count < entityIds.length;

            return (
              <button
                key={collection.id}
                onClick={() => toggleCollection(collection.id)}
                disabled={processingId === collection.id}
                className="w-full px-4 py-2 text-left hover:bg-gray-50 flex items-center justify-between group transition-colors"
              >
                <div className="flex flex-col min-w-0">
                  <span className="text-sm text-gray-700 truncate">{collection.name}</span>
                  {isBulk && count > 0 && (
                    <span className="text-[10px] text-gray-400">
                      {count} of {entityIds.length} {entityLabelPlural} added
                    </span>
                  )}
                </div>
                {processingId === collection.id ? (
                  <Loader2 className="w-4 h-4 text-gray-300 animate-spin" />
                ) : allIn ? (
                  <Check className="w-4 h-4 text-green-500" />
                ) : someIn ? (
                  <Minus className="w-4 h-4 text-yellow-500" />
                ) : (
                  <Plus className="w-4 h-4 text-gray-300 group-hover:text-gray-400 opacity-0 group-hover:opacity-100 transition-all" />
                )}
              </button>
            );
          })
        )}
      </div>

      <div className="p-2 border-t border-gray-50">
        {showCreateInline ? (
          <form onSubmit={handleCreateCollection} className="space-y-2 p-2">
            <input
              type="text"
              value={newCollectionName}
              onChange={(e) => setNewCollectionName(e.target.value)}
              placeholder="Collection name..."
              aria-label={`New collection name for ${entityLabel}`}
              className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-yellow-500 focus:border-yellow-500 outline-none"
              autoFocus
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowCreateInline(false)}
                className="flex-1 px-3 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!newCollectionName.trim() || loading}
                className="flex-1 px-3 py-1.5 text-xs font-bold bg-yellow-400 text-gray-900 rounded-lg hover:bg-yellow-500 transition-colors disabled:bg-gray-100 disabled:text-gray-400"
              >
                Create
              </button>
            </div>
          </form>
        ) : (
          <button
            onClick={() => setShowCreateInline(true)}
            className="w-full px-3 py-2 text-left text-sm font-medium text-yellow-600 hover:bg-yellow-50 rounded-lg flex items-center transition-colors"
          >
            <Plus className="w-4 h-4 mr-2" />
            Create new collection
          </button>
        )}
      </div>
    </div>
  );
}
