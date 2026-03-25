import { useState } from 'react';
import {
  Plus,
  Loader2,
  Check,
  Edit3,
  AlertTriangle,
  ExternalLink,
  Mail,
  Linkedin,
  Globe,
  ChevronDown,
  ChevronUp,
  Tag,
  XCircle,
  GitCompare,
} from 'lucide-react';
import type { SearchedContact } from '../../lib/aiService';

import CitySearch from '../CitySearch';

export interface DiscoveredContact extends SearchedContact {
  id: string;
}

interface ContactCardProps {
  contact: DiscoveredContact;
  isAdded: boolean;
  isAdding: boolean;
  onAdd: (contact: DiscoveredContact) => void;
  onEdit: (contact: DiscoveredContact) => void;
  onCompare?: (contact: DiscoveredContact) => void;
}

const INPUT_CLS =
  'w-full text-xs bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-yellow-400';

export function ContactCardEdit({
  contact,
  onSave,
  onCancel,
}: {
  contact: DiscoveredContact;
  onSave: (updated: DiscoveredContact) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<DiscoveredContact>({ ...contact });
  const set = (field: string, value: string | null) =>
    setForm((f) => ({ ...f, [field]: value }));

  return (
    <div className="border border-yellow-200 bg-yellow-50/30 rounded-xl p-4 space-y-2.5">
      <input
        value={form.name}
        onChange={(e) => set('name', e.target.value)}
        className={`${INPUT_CLS} !text-sm font-medium`}
        placeholder="Name"
      />
      <div className="grid grid-cols-2 gap-2">
        <input
          value={form.current_position || ''}
          onChange={(e) => set('current_position', e.target.value)}
          className={INPUT_CLS}
          placeholder="Position"
        />
        <input
          value={form.occupation || ''}
          onChange={(e) => set('occupation', e.target.value)}
          className={INPUT_CLS}
          placeholder="Occupation (e.g. Researcher)"
          list="chatbot-occ-suggestions"
        />
        <datalist id="chatbot-occ-suggestions">
          <option value="Professor" />
          <option value="Researcher" />
          <option value="Engineer" />
          <option value="Executive" />
          <option value="Creative" />
          <option value="Entrepreneur" />
          <option value="Manager" />
          <option value="Consultant" />
        </datalist>
      </div>
      <div className="grid grid-cols-1 gap-2">
        <CitySearch
          value={form.location_id || ''}
          cityStateDisplay={form.locations ? `${form.locations.city}, ${form.locations.state}` : ''}
          onChange={(id, city, state, lat, lng) => {
            setForm(f => ({
              ...f,
              location_id: id,
              locations: id ? { id, city, state, latitude: lat || 0, longitude: lng || 0 } : undefined
            }));
          }}
          className="!flex-none"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input
          value={form.flemish_connection || ''}
          onChange={(e) => set('flemish_connection', e.target.value)}
          className={INPUT_CLS}
          placeholder="Flemish connection"
        />
        <input
          value={form.email || ''}
          onChange={(e) => set('email', e.target.value)}
          className={INPUT_CLS}
          placeholder="Email"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input
          value={form.linkedin_url || ''}
          onChange={(e) => set('linkedin_url', e.target.value)}
          className={INPUT_CLS}
          placeholder="LinkedIn URL"
        />
        <input
          value={form.website_url || ''}
          onChange={(e) => set('website_url', e.target.value)}
          className={INPUT_CLS}
          placeholder="Website URL"
        />
      </div>
      <textarea
        value={form.bio || ''}
        onChange={(e) => set('bio', e.target.value)}
        className={`${INPUT_CLS} resize-none`}
        rows={2}
        placeholder="Bio"
      />
      <div className="flex justify-end space-x-1.5 pt-1">
        <button
          onClick={onCancel}
          className="text-xs px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={() => onSave(form)}
          className="text-xs px-3 py-1.5 bg-yellow-100 text-yellow-700 rounded-lg hover:bg-yellow-200 transition-colors font-medium"
        >
          Save
        </button>
      </div>
    </div>
  );
}

export default function ContactCard({
  contact,
  isAdded,
  isAdding,
  onAdd,
  onEdit,
  onCompare,
}: ContactCardProps) {
  const [showSources, setShowSources] = useState(false);
  const isDupe = contact.is_duplicate;

  return (
    <div
      className={`border rounded-xl px-4 py-3 transition-all ${
        isAdded
          ? 'bg-green-50/60 border-green-200'
          : isDupe
            ? 'bg-amber-50/40 border-amber-200'
            : 'bg-white border-gray-200 hover:border-gray-300'
      }`}
    >
      {isDupe && !isAdded && (
        <div className="flex items-center space-x-1.5 mb-2.5 px-2.5 py-1.5 bg-amber-100/60 rounded-lg">
          <AlertTriangle className="w-3 h-3 text-amber-600 flex-shrink-0" />
          <span className="text-[11px] text-amber-700 font-medium">
            {contact.duplicate_reason || 'Possible duplicate'}
          </span>
        </div>
      )}

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-gray-900">
              {contact.name}
            </p>
            {contact.occupation && (
              <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 bg-teal-50 text-teal-700 rounded font-medium">
                <Tag className="w-2.5 h-2.5" />
                {contact.occupation}
              </span>
            )}
          </div>

          {contact.current_position && (
            <p className="text-xs text-gray-600">{contact.current_position}</p>
          )}

          {contact.bio && (
            <p className="text-xs text-gray-500 leading-relaxed line-clamp-2">
              {contact.bio}
            </p>
          )}

          <div className="flex flex-wrap gap-x-3 gap-y-0.5">
            {contact.locations?.city && (
              <span className="text-xs text-gray-400">
                {contact.locations?.city}
                {contact.locations?.state && `, ${contact.locations?.state}`}
              </span>
            )}
            {contact.flemish_connection && (
              <span className="text-xs text-yellow-600">
                {contact.flemish_connection}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5">
            {contact.email && (
              <span className="inline-flex items-center gap-1 text-[11px] text-gray-600">
                <Mail className="w-3 h-3 text-gray-400" />
                <span>{contact.email}</span>
                <span title="Unverified - verify from profile page">
                  <XCircle className="w-3 h-3 text-red-400" />
                </span>
                {contact.email_source && (
                  <a
                    href={contact.email_source}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-500 hover:text-blue-600"
                    title={`Source: ${contact.email_source}`}
                  >
                    <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                )}
              </span>
            )}
            {contact.linkedin_url && (
              <a
                href={contact.linkedin_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-700"
              >
                <Linkedin className="w-3 h-3" />
                <span>LinkedIn</span>
              </a>
            )}
            {contact.website_url && (
              <a
                href={
                  contact.website_url.startsWith('http')
                    ? contact.website_url
                    : `https://${contact.website_url}`
                }
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-700"
              >
                <Globe className="w-3 h-3" />
                <span>Website</span>
              </a>
            )}
          </div>

          {contact.sectors && contact.sectors.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-0.5">
              {contact.sectors.map((s) => (
                <span
                  key={s}
                  className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded"
                >
                  {s}
                </span>
              ))}
            </div>
          )}

          {contact.sources && contact.sources.length > 0 && (
            <div className="pt-0.5">
              <button
                onClick={() => setShowSources(!showSources)}
                className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-gray-600 transition-colors"
              >
                {showSources ? (
                  <ChevronUp className="w-2.5 h-2.5" />
                ) : (
                  <ChevronDown className="w-2.5 h-2.5" />
                )}
                <span>
                  {contact.sources.length} source
                  {contact.sources.length !== 1 ? 's' : ''}
                </span>
              </button>
              {showSources && (
                <div className="mt-1 space-y-0.5 pl-3.5">
                  {contact.sources.map((url, i) => (
                    <a
                      key={i}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block text-[10px] text-blue-500 hover:text-blue-600 truncate max-w-[260px]"
                    >
                      {url}
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-col items-end gap-1.5 flex-shrink-0 pt-0.5">
          {isAdded ? (
            <span className="text-xs text-green-600 font-medium flex items-center space-x-1">
              <Check className="w-3 h-3" />
              <span>Added</span>
            </span>
          ) : (
            <>
              <button
                onClick={() => onEdit(contact)}
                className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                title="Edit before adding"
              >
                <Edit3 className="w-3.5 h-3.5" />
              </button>
              {isDupe && onCompare && (
                <button
                  onClick={() => onCompare(contact)}
                  className="flex items-center gap-1 text-[11px] font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 px-2 py-1 rounded-lg transition-colors"
                  title="Compare with existing contact"
                >
                  <GitCompare className="w-3 h-3" />
                  <span>Compare</span>
                </button>
              )}
              <button
                onClick={() => onAdd(contact)}
                disabled={isAdding}
                className={`flex items-center gap-1 text-[11px] font-medium px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50 ${
                  isDupe
                    ? 'text-amber-700 bg-amber-50 hover:bg-amber-100'
                    : 'text-yellow-700 hover:text-yellow-800 bg-yellow-50 hover:bg-yellow-100'
                }`}
              >
                {isAdding ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Plus className="w-3 h-3" />
                )}
                <span>{isDupe ? 'Add Anyway' : 'Add'}</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
