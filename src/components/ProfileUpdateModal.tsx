import { useState } from 'react';
import {
  X,
  RotateCw,
  Check,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { supabase, displayName, type Person } from '../lib/supabase';

interface Suggestion {
  current: string;
  suggested: string;
  source: string;
}

interface ProfileUpdateModalProps {
  person: Person;
  onClose: () => void;
  onApplied: () => void;
}

const FIELD_LABELS: Record<string, string> = {
  current_position: 'Position',
  bio: 'Bio',
  email: 'Email',
  phone: 'Phone',
  linkedin_url: 'LinkedIn',
  website_url: 'Website',
  twitter_url: 'Twitter',
  location_city: 'City',
  location_state: 'State',
  flemish_connection: 'Flemish Connection',
};

export default function ProfileUpdateModal({
  person,
  onClose,
  onApplied,
}: ProfileUpdateModalProps) {
  const [stage, setStage] = useState<'idle' | 'searching' | 'results' | 'applying' | 'done' | 'error'>('idle');
  const [suggestions, setSuggestions] = useState<Record<string, Suggestion>>({});
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [errorMsg, setErrorMsg] = useState('');

  const runSearch = async () => {
    setStage('searching');
    setErrorMsg('');

    try {
      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/update-profile`;
      const resp = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ personId: person.id }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(err.error || 'Request failed');
      }

      const data = await resp.json();
      const sugs = data.suggestions as Record<string, Suggestion>;

      if (sugs['_none']) {
        setSuggestions({});
        setStage('results');
        return;
      }

      setSuggestions(sugs);
      const sel: Record<string, boolean> = {};
      Object.keys(sugs).forEach((k) => { sel[k] = true; });
      setSelected(sel);
      setStage('results');
    } catch (err) {
      setErrorMsg((err as Error).message || 'Failed to search');
      setStage('error');
    }
  };

  const applySelected = async () => {
    setStage('applying');

    const updates: Record<string, string | null> = {};
    Object.entries(selected).forEach(([field, isSelected]) => {
      if (isSelected && suggestions[field]) {
        updates[field] = suggestions[field].suggested || null;
      }
    });

    if (Object.keys(updates).length === 0) {
      onApplied();
      return;
    }

    updates['updated_at'] = new Date().toISOString();

    const { error } = await supabase
      .from('people')
      .update(updates)
      .eq('id', person.id);

    if (error) {
      setErrorMsg(error.message);
      setStage('error');
      return;
    }

    setStage('done');
    setTimeout(() => onApplied(), 1200);
  };

  const toggleField = (field: string) => {
    setSelected((s) => ({ ...s, [field]: !s[field] }));
  };

  const selectedCount = Object.values(selected).filter(Boolean).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center">
              <RotateCw className="w-4.5 h-4.5 text-blue-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">AI Profile Update</h3>
              <p className="text-xs text-gray-500">{displayName(person)}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5">
          {stage === 'idle' && (
            <div className="text-center py-6">
              <p className="text-gray-600 mb-6">
                Search the web for updated information about this person and review suggestions before applying.
              </p>
              <button
                onClick={runSearch}
                className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors inline-flex items-center space-x-2"
              >
                <RotateCw className="w-4 h-4" />
                <span>Search for Updates</span>
              </button>
            </div>
          )}

          {stage === 'searching' && (
            <div className="text-center py-10">
              <Loader2 className="w-8 h-8 text-blue-500 animate-spin mx-auto mb-4" />
              <p className="text-gray-600">Searching the web for information about {displayName(person)}...</p>
            </div>
          )}

          {stage === 'results' && Object.keys(suggestions).length === 0 && (
            <div className="text-center py-8">
              <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
                <Check className="w-6 h-6 text-gray-400" />
              </div>
              <p className="text-gray-600 mb-1">No new information found</p>
              <p className="text-sm text-gray-400">This profile appears to be up to date.</p>
              <button
                onClick={onClose}
                className="mt-5 px-5 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-lg transition-colors"
              >
                Close
              </button>
            </div>
          )}

          {stage === 'results' && Object.keys(suggestions).length > 0 && (
            <div>
              <p className="text-sm text-gray-500 mb-4">
                Found {Object.keys(suggestions).length} suggested update{Object.keys(suggestions).length !== 1 ? 's' : ''}. Select which to apply:
              </p>
              <div className="space-y-3 max-h-72 overflow-y-auto">
                {Object.entries(suggestions).map(([field, sug]) => (
                  <label
                    key={field}
                    className={`flex items-start space-x-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      selected[field]
                        ? 'border-blue-200 bg-blue-50/50'
                        : 'border-gray-100 bg-gray-50/50 opacity-60'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selected[field] || false}
                      onChange={() => toggleField(field)}
                      className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                        {FIELD_LABELS[field] || field}
                      </div>
                      {sug.current && (
                        <div className="text-sm text-gray-400 line-through mb-1 truncate">
                          {sug.current}
                        </div>
                      )}
                      <div className="text-sm text-gray-900">{sug.suggested}</div>
                      <div className="text-xs text-gray-400 mt-1">{sug.source}</div>
                    </div>
                  </label>
                ))}
              </div>
              <div className="flex items-center justify-end gap-3 mt-5 pt-4 border-t border-gray-100">
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors text-sm font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={applySelected}
                  disabled={selectedCount === 0}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors inline-flex items-center space-x-2 disabled:opacity-40 text-sm"
                >
                  <Check className="w-4 h-4" />
                  <span>Apply {selectedCount} Update{selectedCount !== 1 ? 's' : ''}</span>
                </button>
              </div>
            </div>
          )}

          {stage === 'applying' && (
            <div className="text-center py-10">
              <Loader2 className="w-8 h-8 text-blue-500 animate-spin mx-auto mb-4" />
              <p className="text-gray-600">Applying updates...</p>
            </div>
          )}

          {stage === 'done' && (
            <div className="text-center py-8">
              <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
                <Check className="w-6 h-6 text-green-600" />
              </div>
              <p className="text-gray-900 font-medium">Profile updated successfully</p>
            </div>
          )}

          {stage === 'error' && (
            <div className="text-center py-8">
              <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
                <AlertCircle className="w-6 h-6 text-red-500" />
              </div>
              <p className="text-gray-900 font-medium mb-1">Something went wrong</p>
              <p className="text-sm text-gray-500 mb-5">{errorMsg}</p>
              <div className="flex items-center justify-center gap-3">
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors text-sm font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={runSearch}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors text-sm inline-flex items-center space-x-2"
                >
                  <RotateCw className="w-4 h-4" />
                  <span>Try Again</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
