import { useState } from 'react';
import {
  CheckCircle,
  XCircle,
  CheckCheck,
  Loader2,
  ArrowRight,
  Inbox,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';

export interface ProfileSuggestion {
  id: string;
  person_id: string;
  field_name: string;
  current_value: string;
  suggested_value: string;
  source: string;
  status: string;
  created_at: string;
  person_name?: string;
}

interface SuggestedChangesProps {
  suggestions: ProfileSuggestion[];
  onRefresh: () => void;
}

const FIELD_LABELS: Record<string, string> = {
  current_position: 'Position',
  occupation: 'Occupation',
  email: 'Email',
  linkedin_url: 'LinkedIn',
  profile_photo_url: 'Profile Photo',
  bio: 'Bio',
  phone: 'Phone',
  website_url: 'Website',
  twitter_url: 'Twitter (X)',
  location_city: 'City',
  location_state: 'State',
  _status: 'Status Flag',
};

export default function SuggestedChanges({
  suggestions,
  onRefresh,
}: SuggestedChangesProps) {
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchProcessing, setBatchProcessing] = useState(false);

  const pending = suggestions.filter((s) => s.status === 'pending');

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === pending.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(pending.map((s) => s.id)));
    }
  };

  const approveSuggestion = async (suggestion: ProfileSuggestion) => {
    setProcessingIds((prev) => new Set([...prev, suggestion.id]));

    const advisoryField = suggestion.field_name.startsWith('_');
    const now = new Date().toISOString();

    await supabase
      .from('people')
      .update(
        advisoryField
          ? {
              last_verified_at: now,
              updated_at: now,
            }
          : {
              [suggestion.field_name]: suggestion.suggested_value,
              last_verified_at: now,
              updated_at: now,
            }
      )
      .eq('id', suggestion.person_id);

    await supabase
      .from('profile_suggestions')
      .update({ status: 'approved' })
      .eq('id', suggestion.id);

    setProcessingIds((prev) => {
      const next = new Set(prev);
      next.delete(suggestion.id);
      return next;
    });
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(suggestion.id);
      return next;
    });
    onRefresh();
  };

  const rejectSuggestion = async (id: string) => {
    setProcessingIds((prev) => new Set([...prev, id]));

    await supabase
      .from('profile_suggestions')
      .update({ status: 'rejected' })
      .eq('id', id);

    setProcessingIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    onRefresh();
  };

  const approveSelected = async () => {
    setBatchProcessing(true);
    const toApprove = pending.filter((s) => selectedIds.has(s.id));
    for (const s of toApprove) {
      await approveSuggestion(s);
    }
    setBatchProcessing(false);
  };

  const approveAll = async () => {
    setBatchProcessing(true);
    for (const s of pending) {
      await approveSuggestion(s);
    }
    setBatchProcessing(false);
  };

  if (pending.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-gray-400">
        <Inbox className="w-8 h-8 mb-2" />
        <p className="text-sm">No pending suggestions</p>
        <p className="text-xs mt-1">
          Use "Ask AI" on stale contacts to generate suggestions
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-3">
          <label className="flex items-center space-x-2 cursor-pointer">
            <input
              type="checkbox"
              checked={selectedIds.size === pending.length && pending.length > 0}
              onChange={toggleSelectAll}
              className="w-3.5 h-3.5 rounded border-gray-300 text-teal-600 focus:ring-teal-500"
            />
            <span className="text-xs text-gray-500">
              {selectedIds.size > 0
                ? `${selectedIds.size} selected`
                : 'Select all'}
            </span>
          </label>
        </div>
        <div className="flex items-center space-x-2">
          {selectedIds.size > 0 && (
            <button
              onClick={approveSelected}
              disabled={batchProcessing}
              className="flex items-center space-x-1.5 text-xs font-medium text-green-700 bg-green-50 hover:bg-green-100 px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50"
            >
              {batchProcessing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <CheckCheck className="w-3.5 h-3.5" />
              )}
              <span>Approve Selected ({selectedIds.size})</span>
            </button>
          )}
          <button
            onClick={approveAll}
            disabled={batchProcessing}
            className="flex items-center space-x-1.5 text-xs font-medium text-teal-700 bg-teal-50 hover:bg-teal-100 px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50"
          >
            {batchProcessing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <CheckCheck className="w-3.5 h-3.5" />
            )}
            <span>Accept All ({pending.length})</span>
          </button>
        </div>
      </div>

      <div className="border border-gray-100 rounded-lg overflow-hidden">
        <div className="divide-y divide-gray-50">
          {pending.map((suggestion) => {
            const isProcessing = processingIds.has(suggestion.id);
            const isSelected = selectedIds.has(suggestion.id);
            return (
              <div
                key={suggestion.id}
                className={`flex items-start px-4 py-3 transition-colors ${
                  isSelected ? 'bg-teal-50/40' : 'hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center pt-0.5 mr-3">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleSelect(suggestion.id)}
                    className="w-3.5 h-3.5 rounded border-gray-300 text-teal-600 focus:ring-teal-500"
                  />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center space-x-2 mb-1">
                    <span className="text-sm font-medium text-gray-900">
                      {suggestion.person_name}
                    </span>
                    <span className="px-1.5 py-0.5 text-[10px] font-medium bg-gray-100 text-gray-600 rounded">
                      {FIELD_LABELS[suggestion.field_name] || suggestion.field_name}
                    </span>
                    <span className="px-1.5 py-0.5 text-[10px] font-medium bg-blue-50 text-blue-700 rounded">
                      {suggestion.source}
                    </span>
                  </div>

                  <div className="flex items-start space-x-2 text-xs">
                    {suggestion.current_value && (
                      <>
                        <span className="text-gray-400 line-through max-w-[40%] truncate flex-shrink-0">
                          {suggestion.current_value}
                        </span>
                        <ArrowRight className="w-3 h-3 text-gray-300 flex-shrink-0 mt-0.5" />
                      </>
                    )}
                    <span className="text-gray-700 font-medium truncate">
                      {suggestion.suggested_value}
                    </span>
                  </div>

                  <p className="text-[10px] text-gray-400 mt-1">
                    {new Date(suggestion.created_at).toLocaleDateString()}
                  </p>
                </div>

                <div className="flex items-center space-x-1 flex-shrink-0 ml-3">
                  <button
                    onClick={() => approveSuggestion(suggestion)}
                    disabled={isProcessing || batchProcessing}
                    className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg transition-colors disabled:opacity-50"
                    title="Approve"
                  >
                    {isProcessing ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <CheckCircle className="w-4 h-4" />
                    )}
                  </button>
                  <button
                    onClick={() => rejectSuggestion(suggestion.id)}
                    disabled={isProcessing || batchProcessing}
                    className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                    title="Reject"
                  >
                    <XCircle className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
