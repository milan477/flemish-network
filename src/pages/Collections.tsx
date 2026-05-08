import { useState, useEffect, useCallback } from 'react';
import { Plus, Library, User, Calendar, ChevronRight } from 'lucide-react';
import { supabase, type Collection } from '../lib/supabase';
import CollectionModal from '../components/CollectionModal';
import CollectionDetail from '../components/CollectionDetail';
import { useAuth } from '../lib/auth';

interface CollectionsProps {
  collectionId?: string;
  onNavigate: (page: string, id?: string) => void;
  showDetail?: boolean;
}

// Module-level cache — survives navigation/unmounts within the same session.
let _collectionsCache: Collection[] | null = null;

export default function Collections({
  collectionId,
  onNavigate,
  showDetail = false,
}: CollectionsProps) {
  const { canEdit } = useAuth();
  const [collections, setCollections] = useState<Collection[]>(_collectionsCache ?? []);
  const [loading, setLoading] = useState(_collectionsCache === null && !showDetail);
  const [showModal, setShowModal] = useState(false);
  const [editingCollection, setEditingCollection] = useState<Collection | undefined>();

  const fetchCollections = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!silent) setLoading(true);
    try {
      const { data, error } = await supabase
        .from('collections')
        .select(`
          *,
          member_count:collection_members(count)
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const formattedData = data.map(item => ({
        ...item,
        member_count: item.member_count[0]?.count || 0
      }));

      _collectionsCache = formattedData;
      setCollections(formattedData);
    } catch (err) {
      console.warn('[Collections] failed to load collections', err);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (showDetail) return;
    if (_collectionsCache !== null) {
      // Return visit: render cached data instantly, refresh silently in background.
      void fetchCollections({ silent: true });
    } else {
      void fetchCollections();
    }
  }, [fetchCollections, showDetail]);

  const handleCreateNew = () => {
    setEditingCollection(undefined);
    setShowModal(true);
  };

  const handleSaveCollection = () => {
    _collectionsCache = null; // invalidate so next render re-fetches visibly
    void fetchCollections();
  };

  if (showDetail && collectionId) {
    return (
      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <CollectionDetail
          collectionId={collectionId}
          onNavigate={onNavigate}
          onBack={() => onNavigate('collections')}
        />
      </main>
    );
  }

  return (
    <main className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2 flex items-center gap-3">
            <Library className="w-8 h-8 text-yellow-500" />
            Collections
          </h1>
          <p className="text-gray-600">
            Save and organize groups of contacts for missions, events, or research.
          </p>
        </div>

        {canEdit && (
          <button
            onClick={handleCreateNew}
            className="flex items-center px-6 py-3 bg-yellow-400 hover:bg-yellow-500 text-gray-900 font-bold rounded-xl transition-all shadow-sm hover:shadow-md"
          >
            <Plus className="w-5 h-5 mr-2" />
            New Collection
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-yellow-400"></div>
        </div>
      ) : collections.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-12 text-center max-w-2xl mx-auto mt-12">
          <div className="w-20 h-20 bg-yellow-50 rounded-full flex items-center justify-center mx-auto mb-6">
            <Library className="w-10 h-10 text-yellow-500" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-3">No collections yet</h2>
          <p className="text-gray-600 mb-8 leading-relaxed">
            {canEdit
              ? 'Create your first collection to start organizing members of the network. You can add people directly from their profiles or from the network directory.'
              : 'No collections have been created yet.'}
          </p>
          {canEdit && (
            <button
              onClick={handleCreateNew}
              className="px-8 py-3 bg-gray-900 text-white font-bold rounded-xl hover:bg-gray-800 transition-all shadow-md"
            >
              Create Your First Collection
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {collections.map((collection) => (
            <div
              key={collection.id}
              onClick={() => onNavigate('collection-detail', collection.id)}
              className="group bg-white rounded-2xl shadow-sm border border-gray-100 p-6 cursor-pointer hover:shadow-xl hover:scale-[1.02] transition-all duration-300 flex flex-col h-full"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="w-12 h-12 bg-yellow-50 rounded-xl flex items-center justify-center group-hover:bg-yellow-100 transition-colors">
                  <Library className="w-6 h-6 text-yellow-600" />
                </div>
                <div className="flex items-center text-sm font-medium text-gray-400 group-hover:text-yellow-600 transition-colors">
                  View Detail
                  <ChevronRight className="w-4 h-4 ml-1" />
                </div>
              </div>

              <h3 className="text-xl font-bold text-gray-900 mb-2 group-hover:text-yellow-600 transition-colors">
                {collection.name}
              </h3>
              
              <p className="text-gray-600 text-sm mb-6 line-clamp-2 flex-grow">
                {collection.description || 'No description provided.'}
              </p>

              <div className="flex items-center justify-between pt-6 border-t border-gray-50 mt-auto">
                <div className="flex items-center text-sm text-gray-500">
                  <User className="w-4 h-4 mr-1.5 text-gray-400" />
                  <span className="font-semibold text-gray-700">{collection.member_count}</span>
                  <span className="ml-1">members</span>
                </div>
                <div className="flex items-center text-xs text-gray-400">
                  <Calendar className="w-3.5 h-3.5 mr-1" />
                  {new Date(collection.created_at).toLocaleDateString()}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && canEdit && (
        <CollectionModal
          collection={editingCollection}
          onClose={() => setShowModal(false)}
          onSave={handleSaveCollection}
        />
      )}
    </main>
  );
}
