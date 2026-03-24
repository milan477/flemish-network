import { useState } from 'react';
import {
  UserPlus,
  FileUp,
  Bot,
  Plus,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Phone,
  Mail,
  Linkedin,
  Globe,
  MapPin,
  Briefcase,
  Users,
  ChevronDown,
  X,
} from 'lucide-react';
import { supabase, FLEMISH_OPTIONS, OCCUPATION_OPTIONS, type Sector, type Person } from '../../lib/supabase';
import AdminChatbot from './AdminChatbot';
import CsvImport from './CsvImport';
import CitySearch from '../CitySearch';

interface AddContactPanelProps {
  sectors: Sector[];
  onContactAdded: () => void;
}

type Tab = 'manual' | 'import' | 'ai';

const TABS: { key: Tab; label: string; icon: typeof UserPlus }[] = [
  { key: 'manual', label: 'Add Manually', icon: UserPlus },
  { key: 'import', label: 'Import File', icon: FileUp },
  { key: 'ai', label: 'AI Assistant', icon: Bot },
];

const INPUT_CLS =
  'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:border-transparent';

const TITLE_OPTIONS = ['', 'Dr', 'Prof', 'Ms', 'Mrs', 'Mr', 'Miss'];

interface ManualForm {
  title: string;
  firstName: string;
  lastName: string;
  current_position: string;
  occupation: string;
  location_city: string;
  location_state: string;
  bio: string;
  flemish_connection: string;
  phone: string;
  email: string;
  linkedin_url: string;
  website_url: string;
  twitter_url: string;
  sectorIds: string[];
}

const EMPTY_FORM: ManualForm = {
  title: '',
  firstName: '',
  lastName: '',
  current_position: '',
  occupation: '',
  location_city: '',
  location_state: '',
  bio: '',
  flemish_connection: '',
  phone: '',
  email: '',
  linkedin_url: '',
  website_url: '',
  twitter_url: '',
  sectorIds: [],
};

function ensureProtocol(url: string): string {
  if (!url || !url.trim()) return '';
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return trimmed;
}

export default function AddContactPanel({
  sectors,
  onContactAdded,
}: AddContactPanelProps) {
  const [tab, setTab] = useState<Tab>('ai');
  const [addedPerson, setAddedPerson] = useState<Person | null>(null);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-yellow-200 overflow-hidden">
      <div className="px-6 pt-6 pb-0">
        <div className="flex items-center space-x-3 mb-4">
          <div className="w-9 h-9 rounded-lg bg-yellow-100 flex items-center justify-center">
            <UserPlus className="w-4.5 h-4.5 text-yellow-700" />
          </div>
          <h2 className="text-lg font-semibold text-gray-900">
            Add New Contacts
          </h2>
        </div>
        <div className="flex space-x-1 border-b border-gray-100">
          {TABS.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                onClick={() => {
                  setTab(t.key);
                  if (t.key !== 'manual') setAddedPerson(null);
                }}
                className={`flex items-center space-x-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
                  tab === t.key
                    ? 'border-yellow-500 text-yellow-700'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {(tab === 'manual' || tab === 'import') && (
        <div className="p-6">
          {tab === 'manual' && (
            <div className="flex gap-6">
              <div className="flex-1 max-w-2xl">
                <ManualAddForm
                  sectors={sectors}
                  onContactAdded={onContactAdded}
                  onPersonAdded={setAddedPerson}
                />
              </div>
              {addedPerson && (
                <div className="w-72 flex-shrink-0">
                  <PersonPreview person={addedPerson} />
                </div>
              )}
            </div>
          )}
          {tab === 'import' && (
            <div className="max-w-3xl">
              <CsvImport onContactAdded={onContactAdded} />
            </div>
          )}
        </div>
      )}

      <div className={tab === 'ai' ? '' : 'hidden'}>
        <AdminChatbot sectors={sectors} onContactAdded={onContactAdded} />
      </div>
    </div>
  );
}

function PersonPreview({ person }: { person: Person }) {
  const fullName = [person.title, person.first_name, person.last_name]
    .filter(Boolean)
    .join(' ') || person.name;
  const initials = [
    (person.first_name || '')[0],
    (person.last_name || '')[0],
  ]
    .filter(Boolean)
    .join('')
    .toUpperCase() || person.name?.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();

  return (
    <div className="bg-yellow-50/60 border border-yellow-200 rounded-xl p-5 space-y-4 sticky top-6">
      <div className="flex items-center gap-2 mb-1">
        <CheckCircle2 className="w-4 h-4 text-green-500" />
        <span className="text-xs font-medium text-green-600">Contact Added</span>
      </div>

      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-yellow-200 to-amber-300 flex items-center justify-center flex-shrink-0">
          <span className="text-sm font-bold text-yellow-800">{initials}</span>
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-gray-900 text-sm truncate">{fullName}</p>
          {person.current_position && (
            <p className="text-xs text-gray-500 truncate">{person.current_position}</p>
          )}
        </div>
      </div>

      <div className="space-y-2 text-xs">
        {person.occupation && (
          <div className="flex items-center gap-2 text-gray-600">
            <Briefcase className="w-3 h-3 text-gray-400 flex-shrink-0" />
            <span className="truncate">{person.occupation}</span>
          </div>
        )}
        {(person.location_city || person.location_state) && (
          <div className="flex items-center gap-2 text-gray-600">
            <MapPin className="w-3 h-3 text-gray-400 flex-shrink-0" />
            <span className="truncate">
              {[person.location_city, person.location_state].filter(Boolean).join(', ')}
            </span>
          </div>
        )}
        {person.email && (
          <div className="flex items-center gap-2 text-gray-600">
            <Mail className="w-3 h-3 text-gray-400 flex-shrink-0" />
            <span className="truncate">{person.email}</span>
          </div>
        )}
        {person.phone && (
          <div className="flex items-center gap-2 text-gray-600">
            <Phone className="w-3 h-3 text-gray-400 flex-shrink-0" />
            <span className="truncate">{person.phone}</span>
          </div>
        )}
        {person.linkedin_url && (
          <div className="flex items-center gap-2 text-gray-600">
            <Linkedin className="w-3 h-3 text-gray-400 flex-shrink-0" />
            <span className="truncate">{person.linkedin_url}</span>
          </div>
        )}
        {person.website_url && (
          <div className="flex items-center gap-2 text-gray-600">
            <Globe className="w-3 h-3 text-gray-400 flex-shrink-0" />
            <span className="truncate">{person.website_url}</span>
          </div>
        )}
        {person.flemish_connection && (
          <div className="flex items-center gap-2 text-gray-600">
            <Users className="w-3 h-3 text-gray-400 flex-shrink-0" />
            <span className="truncate">{person.flemish_connection}</span>
          </div>
        )}
        {person.bio && (
          <p className="text-gray-500 leading-relaxed pt-1 border-t border-yellow-200 mt-2">
            {person.bio}
          </p>
        )}
      </div>
    </div>
  );
}

interface DuplicateMatch {
  id: string;
  name: string;
  email?: string | null;
}

function ManualAddForm({
  sectors,
  onContactAdded,
  onPersonAdded,
}: {
  sectors: Sector[];
  onContactAdded: () => void;
  onPersonAdded: (person: Person) => void;
}) {
  const [form, setForm] = useState<ManualForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [dupeMatch, setDupeMatch] = useState<DuplicateMatch | null>(null);
  const [dupeChecking, setDupeChecking] = useState(false);
  const [flemishConnections, setFlemishConnections] = useState<string[]>([]);
  const [removedFlemishConnections, setRemovedFlemishConnections] = useState<string[]>([]);
  const [customFlemish, setCustomFlemish] = useState('');

  const checkDuplicate = async () => {
    const first = form.firstName.trim().toLowerCase();
    const last = form.lastName.trim().toLowerCase();
    const email = form.email.trim().toLowerCase();

    if (!first) return null;

    const { data: allPeople } = await supabase
      .from('people')
      .select('id, name, first_name, last_name, email');

    if (!allPeople) return null;

    for (const person of allPeople) {
      const pFirst = (person.first_name || '').trim().toLowerCase();
      const pLast = (person.last_name || '').trim().toLowerCase();
      const pEmail = (person.email || '').trim().toLowerCase();
      const pName = (person.name || '').trim().toLowerCase();
      const fullName = `${first} ${last}`.trim();

      if (email && pEmail && email === pEmail) {
        return { id: person.id, name: person.name || `${person.first_name} ${person.last_name}`, email: person.email };
      }
      if (first && last && pFirst === first && pLast === last) {
        return { id: person.id, name: person.name || `${person.first_name} ${person.last_name}`, email: person.email };
      }
      if (fullName && pName === fullName) {
        return { id: person.id, name: person.name, email: person.email };
      }
    }

    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.firstName.trim()) {
      setError('First name is required');
      return;
    }
    setSaving(true);
    setError('');
    setDupeMatch(null);

    setDupeChecking(true);
    const dupe = await checkDuplicate();
    setDupeChecking(false);

    if (dupe) {
      setDupeMatch(dupe);
      setSaving(false);
      return;
    }

    await insertContact();
  };

  const insertContact = async () => {
    setSaving(true);
    const first = form.firstName.trim();
    const last = form.lastName.trim();
    const fullName = [form.title, first, last].filter(Boolean).join(' ');
    const flemishStr = flemishConnections.join(', ');

    const linkedin = ensureProtocol(form.linkedin_url || '');
    const website = ensureProtocol(form.website_url || '');
    const twitter = ensureProtocol(form.twitter_url || '');

    const { data: person, error: insertErr } = await supabase
      .from('people')
      .insert({
        name: fullName,
        title: form.title || null,
        first_name: first,
        last_name: last || null,
        current_position: form.current_position || null,
        occupation: form.occupation || null,
        location_city: form.location_city || null,
        location_state: form.location_state || null,
        bio: form.bio || null,
        flemish_connection: flemishStr || null,
        phone: form.phone || null,
        email: form.email || null,
        linkedin_url: linkedin || null,
        website_url: website || null,
        twitter_url: twitter || null,
      })
      .select('*')
      .maybeSingle();

    if (insertErr || !person) {
      setError(insertErr?.message || 'Failed to add contact');
      setSaving(false);
      return;
    }

    if (form.sectorIds.length > 0) {
      await supabase.from('person_sectors').insert(
        form.sectorIds.map((sid) => ({
          person_id: person.id,
          sector_id: sid,
        }))
      );
    }

    setSaving(false);
    setSuccess(true);
    setDupeMatch(null);
    onPersonAdded(person as Person);
    setForm(EMPTY_FORM);
    setFlemishConnections([]);
    setRemovedFlemishConnections([]);
    onContactAdded();
    setTimeout(() => setSuccess(false), 5000);
  };

  const toggleSector = (id: string) => {
    setForm((f) => ({
      ...f,
      sectorIds: f.sectorIds.includes(id)
        ? f.sectorIds.filter((s) => s !== id)
        : [...f.sectorIds, id],
    }));
  };

  const toggleFlemish = (option: string) => {
    setFlemishConnections((prev) => {
      const exists = prev.includes(option);
      if (exists) {
        setRemovedFlemishConnections(r => [...new Set([...r, option])]);
        return prev.filter((s) => s !== option);
      } else {
        setRemovedFlemishConnections(r => r.filter(i => i !== option));
        return [...prev, option];
      }
    });
  };

  const handleAddCustomFlemish = (e: React.KeyboardEvent | React.MouseEvent) => {
    if ('key' in e && e.key !== 'Enter') return;
    e.preventDefault();
    const val = customFlemish.trim();
    if (val && !flemishConnections.includes(val)) {
      toggleFlemish(val);
      setCustomFlemish('');
    }
  };

  const set = (field: keyof ManualForm, value: string) => {
    setForm((f) => {
      const next = { ...f, [field]: value };
      
      // Auto-inference for Flemish Connection from Bio
      if (field === 'bio') {
        const lowerBio = value.toLowerCase();
        const detected = FLEMISH_OPTIONS.filter(opt => 
          lowerBio.includes(opt.toLowerCase()) && 
          !flemishConnections.includes(opt) &&
          !removedFlemishConnections.includes(opt)
        );
        if (detected.length > 0) {
          setFlemishConnections(prev => [...new Set([...prev, ...detected])]);
        }
      }
      
      return next;
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-[100px,1fr,1fr] gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Title
          </label>
          <div className="relative">
            <select
              value={form.title}
              onChange={(e) => set('title', e.target.value)}
              className={`${INPUT_CLS} appearance-none pr-8`}
            >
              {TITLE_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {t || '--'}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            First Name *
          </label>
          <input
            value={form.firstName}
            onChange={(e) => set('firstName', e.target.value)}
            className={INPUT_CLS}
            placeholder="Jan"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Last Name
          </label>
          <input
            value={form.lastName}
            onChange={(e) => set('lastName', e.target.value)}
            className={INPUT_CLS}
            placeholder="De Vries"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Position / Title
          </label>
          <input
            value={form.current_position}
            onChange={(e) => set('current_position', e.target.value)}
            className={INPUT_CLS}
            placeholder="AI Researcher at MIT"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Occupation
          </label>
          <div className="relative">
            <select
              value={form.occupation}
              onChange={(e) => set('occupation', e.target.value)}
              className={`${INPUT_CLS} appearance-none pr-8`}
            >
              <option value="">Select Occupation</option>
              {OCCUPATION_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          </div>
        </div>
      </div>

      <div className="flex flex-col space-y-1">
        <label className="block text-xs font-medium text-gray-600 mb-1">
          City & State
        </label>
        <div className="flex items-center space-x-2">
          <MapPin className="w-4 h-4 text-gray-400 flex-shrink-0" />
          <CitySearch
            value={form.location_city}
            state={form.location_state}
            onChange={(city, state) => {
              set('location_city', city);
              set('location_state', state);
            }}
            placeholder="Search city..."
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1 flex items-center space-x-1">
            <Phone className="w-3 h-3 text-gray-400" />
            <span>Phone</span>
          </label>
          <input
            value={form.phone}
            onChange={(e) => set('phone', e.target.value)}
            className={INPUT_CLS}
            placeholder="+1 555 123 4567"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1 flex items-center space-x-1">
            <Mail className="w-3 h-3 text-gray-400" />
            <span>Email</span>
          </label>
          <input
            value={form.email}
            onChange={(e) => set('email', e.target.value)}
            className={INPUT_CLS}
            placeholder="jan@example.com"
            type="email"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1 flex items-center space-x-1">
            <Linkedin className="w-3 h-3 text-gray-400" />
            <span>LinkedIn</span>
          </label>
          <input
            value={form.linkedin_url}
            onChange={(e) => set('linkedin_url', e.target.value)}
            className={INPUT_CLS}
            placeholder="linkedin.com/in/jandevries"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1 flex items-center space-x-1">
            <Globe className="w-3 h-3 text-gray-400" />
            <span>Website</span>
          </label>
          <input
            value={form.website_url}
            onChange={(e) => set('website_url', e.target.value)}
            className={INPUT_CLS}
            placeholder="jandevries.com"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1 flex items-center space-x-1">
            <svg className="w-3 h-3 text-gray-400 fill-current" viewBox="0 0 24 24">
              <title>Twitter (X)</title>
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
            <span>Twitter (X)</span>
          </label>
          <input
            value={form.twitter_url}
            onChange={(e) => set('twitter_url', e.target.value)}
            className={INPUT_CLS}
            placeholder="x.com/jandevries"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">
          Bio
        </label>
        <textarea
          value={form.bio}
          onChange={(e) => set('bio', e.target.value)}
          className={`${INPUT_CLS} resize-none`}
          rows={3}
          placeholder="Brief description..."
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1.5">
          Flemish Connection
        </label>
        <div className="flex flex-wrap gap-2 mb-3">
          {FLEMISH_OPTIONS.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => toggleFlemish(opt)}
              className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
                flemishConnections.includes(opt)
                  ? 'bg-blue-100 text-blue-700 ring-1 ring-blue-300'
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
            >
              {opt}
            </button>
          ))}
          {/* Custom tags */}
          {flemishConnections.filter(opt => !FLEMISH_OPTIONS.includes(opt)).map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => toggleFlemish(opt)}
              className="text-xs px-3 py-1.5 rounded-full font-medium transition-colors bg-amber-100 text-amber-700 ring-1 ring-amber-300 flex items-center space-x-1"
            >
              <span>{opt}</span>
              <X className="w-3 h-3" />
            </button>
          ))}
        </div>
        <div className="flex items-center space-x-2 max-w-xs">
          <input
            type="text"
            value={customFlemish}
            onChange={(e) => setCustomFlemish(e.target.value)}
            onKeyDown={handleAddCustomFlemish}
            placeholder="Add custom connection..."
            className="flex-1 px-3 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
          />
          <button
            type="button"
            onClick={handleAddCustomFlemish}
            className="p-1.5 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1.5">
          Sectors
        </label>
        <div className="flex flex-wrap gap-2">
          {sectors.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => toggleSector(s.id)}
              className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
                form.sectorIds.includes(s.id)
                  ? 'bg-yellow-100 text-yellow-700 ring-1 ring-yellow-300'
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>
      </div>
      {dupeMatch && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
          <div className="flex items-center gap-2 mb-2">
            <Users className="w-4 h-4 text-amber-600" />
            <p className="text-sm font-medium text-amber-700">
              Possible duplicate found
            </p>
          </div>
          <p className="text-xs text-amber-600 mb-3">
            "{form.firstName} {form.lastName}" matches existing contact "{dupeMatch.name}"
            {dupeMatch.email ? ` (${dupeMatch.email})` : ''}.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setDupeMatch(null);
                insertContact();
              }}
              className="text-xs font-medium px-3 py-1.5 bg-yellow-500 hover:bg-yellow-600 text-white rounded-lg transition-colors"
            >
              Add Anyway
            </button>
            <button
              type="button"
              onClick={() => setDupeMatch(null)}
              className="text-xs font-medium px-3 py-1.5 bg-white hover:bg-gray-50 text-gray-600 border border-gray-200 rounded-lg transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-center space-x-2 text-sm text-red-600">
          <AlertCircle className="w-4 h-4" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex items-center space-x-3">
        <button
          type="submit"
          disabled={saving || dupeChecking}
          className="flex items-center space-x-2 px-5 py-2.5 bg-yellow-500 hover:bg-yellow-600 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
        >
          {saving || dupeChecking ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Plus className="w-4 h-4" />
          )}
          <span>{dupeChecking ? 'Checking...' : 'Add Contact'}</span>
        </button>
        {success && (
          <span className="flex items-center space-x-1 text-sm text-green-600">
            <CheckCircle2 className="w-4 h-4" />
            <span>Contact added</span>
          </span>
        )}
      </div>
    </form>
  );
}
