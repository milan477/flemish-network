import { useState } from 'react';
import {
  ArrowLeft,
  UserPlus,
  RefreshCw,
  Check,
  Mail,
  Linkedin,
  Globe,
} from 'lucide-react';
import { displayName, type Person } from '../../lib/supabase';
import type { DiscoveredContact } from './ContactCard';

interface DuplicateCompareProps {
  newContact: DiscoveredContact;
  existingPerson: Person;
  onUpdate: (selectedFields: string[]) => void;
  onAddNew: () => void;
  onBack: () => void;
}

const COMPARE_FIELDS: { key: string; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'current_position', label: 'Position' },
  { key: 'occupation', label: 'Occupation' },
  { key: 'location_city', label: 'City' },
  { key: 'location_state', label: 'State' },
  { key: 'bio', label: 'Bio' },
  { key: 'flemish_connection', label: 'Flemish Connection' },
  { key: 'email', label: 'Email' },
  { key: 'linkedin_url', label: 'LinkedIn' },
  { key: 'website_url', label: 'Website' },
];

function getVal(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  if (v === null || v === undefined) return '';
  return String(v);
}

export default function DuplicateCompare({
  newContact,
  existingPerson,
  onUpdate,
  onAddNew,
  onBack,
}: DuplicateCompareProps) {
  const diffs = COMPARE_FIELDS.filter((f) => {
    const newVal = getVal(newContact as unknown as Record<string, unknown>, f.key);
    const existVal = getVal(existingPerson as unknown as Record<string, unknown>, f.key);
    return newVal && newVal !== existVal;
  });

  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(diffs.map((d) => d.key))
  );

  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const toggleAll = () => {
    if (selected.size === diffs.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(diffs.map((d) => d.key)));
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100">
        <button
          onClick={onBack}
          className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-gray-900">
            Compare: {newContact.name}
          </h3>
          <p className="text-xs text-amber-600 mt-0.5">
            {newContact.duplicate_reason}
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        <div className="grid grid-cols-2 gap-4 mb-5">
          <div className="bg-blue-50/50 border border-blue-100 rounded-xl p-4">
            <p className="text-[10px] uppercase tracking-wider text-blue-500 font-semibold mb-2">
              New (AI-Discovered)
            </p>
            <p className="text-sm font-semibold text-gray-900">
              {newContact.name}
            </p>
            {newContact.current_position && (
              <p className="text-xs text-gray-600 mt-0.5">
                {newContact.current_position}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2 mt-2">
              {newContact.email && (
                <span className="inline-flex items-center gap-1 text-[11px] text-gray-500">
                  <Mail className="w-3 h-3" />
                  {newContact.email}
                </span>
              )}
              {newContact.linkedin_url && (
                <span className="inline-flex items-center gap-1 text-[11px] text-blue-500">
                  <Linkedin className="w-3 h-3" />
                  LinkedIn
                </span>
              )}
              {newContact.website_url && (
                <span className="inline-flex items-center gap-1 text-[11px] text-gray-500">
                  <Globe className="w-3 h-3" />
                  Website
                </span>
              )}
            </div>
          </div>

          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
            <p className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-2">
              Existing Contact
            </p>
            <p className="text-sm font-semibold text-gray-900">
              {displayName(existingPerson)}
            </p>
            {existingPerson.current_position && (
              <p className="text-xs text-gray-600 mt-0.5">
                {existingPerson.current_position}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2 mt-2">
              {existingPerson.email && (
                <span className="inline-flex items-center gap-1 text-[11px] text-gray-500">
                  <Mail className="w-3 h-3" />
                  {existingPerson.email}
                </span>
              )}
              {existingPerson.linkedin_url && (
                <span className="inline-flex items-center gap-1 text-[11px] text-blue-500">
                  <Linkedin className="w-3 h-3" />
                  LinkedIn
                </span>
              )}
              {existingPerson.website_url && (
                <span className="inline-flex items-center gap-1 text-[11px] text-gray-500">
                  <Globe className="w-3 h-3" />
                  Website
                </span>
              )}
            </div>
          </div>
        </div>

        {diffs.length > 0 ? (
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-gray-700">
                {diffs.length} field{diffs.length !== 1 ? 's' : ''} can be
                updated
              </p>
              <button
                onClick={toggleAll}
                className="text-[11px] text-gray-500 hover:text-gray-700 transition-colors"
              >
                {selected.size === diffs.length
                  ? 'Deselect all'
                  : 'Select all'}
              </button>
            </div>

            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="w-8 px-3 py-2.5" />
                    <th className="px-3 py-2.5 text-left text-gray-500 font-medium">
                      Field
                    </th>
                    <th className="px-3 py-2.5 text-left text-blue-500 font-medium">
                      New Value
                    </th>
                    <th className="px-3 py-2.5 text-left text-gray-400 font-medium">
                      Current Value
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {diffs.map((field) => {
                    const newVal = getVal(
                      newContact as unknown as Record<string, unknown>,
                      field.key
                    );
                    const existVal = getVal(
                      existingPerson as unknown as Record<string, unknown>,
                      field.key
                    );
                    const isSelected = selected.has(field.key);

                    return (
                      <tr
                        key={field.key}
                        className={`cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-blue-50/30'
                            : 'hover:bg-gray-50'
                        }`}
                        onClick={() => toggle(field.key)}
                      >
                        <td className="px-3 py-2.5 text-center">
                          <div
                            className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
                              isSelected
                                ? 'bg-blue-500 border-blue-500'
                                : 'border-gray-300'
                            }`}
                          >
                            {isSelected && (
                              <Check className="w-3 h-3 text-white" />
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 font-medium text-gray-700">
                          {field.label}
                        </td>
                        <td className="px-3 py-2.5 text-blue-700 max-w-[180px] truncate">
                          {newVal}
                        </td>
                        <td className="px-3 py-2.5 text-gray-400 max-w-[180px] truncate">
                          {existVal || '-'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="text-center py-6">
            <p className="text-sm text-gray-500">
              No differences found between the contacts.
            </p>
          </div>
        )}
      </div>

      <div className="px-5 py-4 border-t border-gray-100 flex items-center justify-end gap-3 bg-white">
        <button
          onClick={onAddNew}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
        >
          <UserPlus className="w-3.5 h-3.5" />
          Add as New Contact
        </button>
        {diffs.length > 0 && selected.size > 0 && (
          <button
            onClick={() => onUpdate(Array.from(selected))}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Update Existing ({selected.size})
          </button>
        )}
      </div>
    </div>
  );
}
