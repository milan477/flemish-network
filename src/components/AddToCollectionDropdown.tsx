import React, { useState, useEffect, useRef } from 'react';
import { Library, Plus, Check, Loader2 } from 'lucide-react';
import { supabase, type Collection } from '../lib/supabase';

interface AddToCollectionDropdownProps {
  personId: string;
  onClose?: () => void;
}

export default function AddToCollectionDropdown({
  personId,
  onClose,
}: AddToCollectionDropdownProps) {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [memberOf, setMemberOf] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [showCreateInline, setShowCreateInline] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchData();
    
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        onClose?.();
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [personId]);

  const fetchData = async () => {
    setLoading(true);
    try {
      // Fetch all collections
      const { data: colls, error: collsError } = await supabase
        .from('collections')
        .select('*')
        .order('name');
      
      if (collsError) throw collsError;
      setCollections(colls || []);

      // Fetch which collections this person belongs to
      const { data: memberships, error: memError } = await supabase
        .from('collection_members')
        .select('collection_id')
        .eq('person_id', personId);
      
      if (memError) throw memError;
      setMemberOf(memberships?.map(m => m.collection_id) || []);
    } catch (err) {
      console.error('Error fetching collection data:', err);
    } finally {
      setLoading(false);
    }
  };

  const toggleCollection = async (collectionId: string) => {
    setProcessingId(collectionId);
    const isMember = memberOf.includes(collectionId);

    try {
      if (isMember) {
        const { error } = await supabase
          .from('collection_members')
          .delete()
          .eq('collection_id', collectionId)
          .eq('person_id', personId);
        
        if (error) throw error;
        setMemberOf(memberOf.filter(id => id !== collectionId));
      } else {
        const { error } = await supabase
          .from('collection_members')
          .insert({
            collection_id: collectionId,
            person_id: personId
          });
        
        if (error) throw error;
        setMemberOf([...memberOf, collectionId]);
      }
    } catch (err) {
      console.error('Error toggling collection membership:', err);
    } finally {
      setProcessingId(null);
    }
  };

  const handleCreateCollection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCollectionName.trim()) return;

    setLoading(true);
    try {
      const { data: newColl, error: insertError } = await supabase
        .from('collections')
        .insert({ name: newCollectionName.trim() })
        .select()
        .single();
      
      if (insertError) throw insertError;

      // Add person to the new collection
      const { error: memError } = await supabase
        .from('collection_members')
        .insert({
          collection_id: newColl.id,
          person_id: personId
        });
      
      if (memError) throw memError;

      setCollections(prev => [...prev, newColl].sort((a, b) => a.name.localeCompare(b.name)));
      setMemberOf(prev => [...prev, newColl.id]);
      setNewCollectionName('');
      setShowCreateInline(false);
    } catch (err) {
      console.error('Error creating collection:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div 
      ref={dropdownRef}
      className="absolute right-0 top-full mt-2 w-64 bg-white rounded-xl shadow-xl border border-gray-100 z-[70] overflow-hidden"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="px-4 py-3 border-b border-gray-50 bg-gray-50/50">
        <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 flex items-center gap-2">
          <Library className="w-3 h-3" />
          Add to Collection
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
          collections.map(collection => (
            <button
              key={collection.id}
              onClick={() => toggleCollection(collection.id)}
              disabled={processingId === collection.id}
              className="w-full px-4 py-2 text-left hover:bg-gray-50 flex items-center justify-between group transition-colors"
            >
              <span className="text-sm text-gray-700 truncate">{collection.name}</span>
              {processingId === collection.id ? (
                <Loader2 className="w-4 h-4 text-gray-300 animate-spin" />
              ) : memberOf.includes(collection.id) ? (
                <Check className="w-4 h-4 text-green-500" />
              ) : (
                <Plus className="w-4 h-4 text-gray-300 group-hover:text-gray-400 opacity-0 group-hover:opacity-100 transition-all" />
              )}
            </button>
          ))
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
