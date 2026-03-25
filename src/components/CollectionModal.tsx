import { useState } from 'react';
import { X, Check, Loader2, Sparkles, MapPin, Briefcase } from 'lucide-react';
import { supabase, type Collection, type Person, displayName, personInitials } from '../lib/supabase';
import { suggestPeople } from '../lib/aiService';

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
  const [name, setName] = useState(collection?.name || '');
  const [description, setDescription] = useState(collection?.description || '');
  const [step, setStep] = useState<Step>('form');
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [suggestions, setSuggestions] = useState<{ person: Person; reason: string; score: number }[]>([]);
  const [selectedPersonIds, setSelectedPersonIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const handleNext = async () => {
    if (!name.trim()) return;
    
    // If we're editing, just save
    if (collection) {
      handleFinalSave();
      return;
    }

    // If new, show suggestions
    setStep('suggestions');
    setIsLoadingSuggestions(true);
    try {
      const results = await suggestPeople(`${name} ${description}`);
      setSuggestions(results);
      // Auto-select top matches (score > 0.2)
      const topIds = new Set(results.filter(r => r.score > 0.2).map(r => r.person.id));
      setSelectedPersonIds(topIds);
    } catch (err) {
      console.error('Error getting suggestions:', err);
    } finally {
      setIsLoadingSuggestions(false);
    }
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

        // Add selected members
        if (selectedPersonIds.size > 0) {
          const members = Array.from(selectedPersonIds).map(personId => ({
            collection_id: savedCollection.id,
            person_id: personId,
            notes: 'AI suggested'
          }));
          
          const { error: memError } = await supabase
            .from('collection_members')
            .insert(members);
          
          if (memError) throw memError;
        }
      }
      
      onSave(savedCollection);
      onClose();
    } catch (err: any) {
      console.error('Error saving collection:', err);
      setError(err.message || 'Failed to save collection');
      setIsSaving(false);
    }
  };

  const togglePerson = (id: string) => {
    const next = new Set(selectedPersonIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedPersonIds(next);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <h2 className="text-xl font-semibold text-gray-900">
            {collection ? 'Edit Collection' : step === 'form' ? 'New Collection' : 'Suggested People'}
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
                  placeholder="What is this collection for? AI will use this to suggest people."
                />
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm text-gray-600 mb-2">
                <Sparkles className="w-4 h-4 text-yellow-500" />
                <span>AI found {suggestions.length} people who might fit this collection:</span>
              </div>

              {isLoadingSuggestions ? (
                <div className="py-12 flex flex-col items-center justify-center space-y-4">
                  <Loader2 className="w-8 h-8 text-yellow-500 animate-spin" />
                  <p className="text-sm text-gray-500">Analyzing the network...</p>
                </div>
              ) : suggestions.length === 0 ? (
                <div className="py-12 text-center bg-gray-50 rounded-xl border border-dashed border-gray-200">
                  <p className="text-gray-500">No specific suggestions found. You can add people manually later.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {suggestions.map(({ person, reason }) => {
                    const isSelected = selectedPersonIds.has(person.id);
                    return (
                      <div 
                        key={person.id}
                        onClick={() => togglePerson(person.id)}
                        className={`p-4 rounded-xl border transition-all cursor-pointer ${
                          isSelected 
                            ? 'bg-yellow-50 border-yellow-200 shadow-sm' 
                            : 'bg-white border-gray-100 hover:border-gray-200'
                        }`}
                      >
                        <div className="flex items-start gap-4">
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${isSelected ? 'bg-yellow-200' : 'bg-gray-100'}`}>
                            {isSelected ? (
                              <Check className="w-5 h-5 text-yellow-700" />
                            ) : (
                              <span className="text-xs font-bold text-gray-400">{personInitials(person)}</span>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between">
                              <h4 className="font-bold text-gray-900 truncate">{displayName(person)}</h4>
                              <div className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${isSelected ? 'bg-yellow-400 text-gray-900' : 'bg-gray-100 text-gray-400'}`}>
                                {isSelected ? 'Selected' : 'Suggest'}
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-xs text-gray-500">
                              {person.current_position && (
                                <div className="flex items-center">
                                  <Briefcase className="w-3 h-3 mr-1" />
                                  <span className="truncate max-w-[150px]">{person.current_position}</span>
                                </div>
                              )}
                              {person.locations?.city && (
                                <div className="flex items-center">
                                  <MapPin className="w-3 h-3 mr-1" />
                                  <span>{person.locations?.city}, {person.locations?.state}</span>
                                </div>
                              )}
                            </div>
                            <p className="mt-2 text-xs text-gray-600 italic line-clamp-1">
                              "{reason}"
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
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
                {collection ? 'Save Changes' : 'Next: Suggestions'}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleFinalSave}
                disabled={isSaving}
                className="px-6 py-2 bg-gray-900 hover:bg-black text-white text-sm font-bold rounded-lg transition-all shadow-md flex items-center gap-2"
              >
                {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {selectedPersonIds.size > 0 
                  ? `Create with ${selectedPersonIds.size} people`
                  : 'Create empty collection'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
