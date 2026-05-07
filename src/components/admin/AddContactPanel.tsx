import { useEffect, useState } from 'react';
import {
  UserPlus,
  FileUp,
  Plus,
  AlertCircle,
  XCircle,
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
  Building2,
} from 'lucide-react';
import {
  supabase,
  OCCUPATION_OPTIONS,
  type Sector,
  type Person,
  type FlemishConnection,
  type PersonUsNetworkStatus,
  type OrganizationUsNetworkStatus,
} from '../../lib/supabase';
import {
  canonicalizeFlemishConnection,
  extractFlemishConnectionsFromText,
  getPersonFlemishConnectionNames,
} from '../../lib/flemishConnections';
import CsvImport from './CsvImport';
import CitySearch from '../CitySearch';
import FlemishConnectionSelector from '../FlemishConnectionSelector';
import { personCardLocationLabel, currentAbroadBaseLabel } from '../../lib/networkScope';
import { buildCandidateKeyForMode } from '../../lib/csvParser';

interface AddContactPanelProps {
  sectors: Sector[];
  onContactAdded: () => void;
  initialTab?: Tab;
}

type Tab = 'manual' | 'import';

const TABS: { key: Tab; label: string; icon: typeof UserPlus }[] = [
  { key: 'manual', label: 'Add Manually', icon: UserPlus },
  { key: 'import', label: 'Import File', icon: FileUp },
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
  us_network_status: PersonUsNetworkStatus;
  location_id: string;
  location_display?: string;
  current_location_city: string;
  current_location_country: string;
  usConnections: ManualUsConnection[];
  bio: string;
  phone: string;
  email: string;
  linkedin_url: string;
  website_url: string;
  twitter_url: string;
  sectorIds: string[];
}

interface ManualOrganizationForm {
  name: string;
  website_url: string;
  description: string;
  suggested_us_network_status: OrganizationUsNetworkStatus;
  location_id: string;
  location_display: string;
  location_role: string;
  flemish_belgian_relevance: string;
  evidence_url: string;
  evidence_excerpt: string;
  confidence: string;
  sectorIds: string[];
}

interface ManualUsConnection {
  id: string;
  location_id: string;
  location_display: string;
  connection_label: string;
}

function emptyUsConnection(): ManualUsConnection {
  return {
    id: crypto.randomUUID(),
    location_id: '',
    location_display: '',
    connection_label: '',
  };
}

function createEmptyForm(): ManualForm {
  return {
    title: '',
    firstName: '',
    lastName: '',
    current_position: '',
    occupation: '',
    us_network_status: 'us_based',
    location_id: '',
    location_display: '',
    current_location_city: '',
    current_location_country: '',
    usConnections: [emptyUsConnection()],
    bio: '',
    phone: '',
    email: '',
    linkedin_url: '',
    website_url: '',
    twitter_url: '',
    sectorIds: [],
  };
}

function createEmptyOrganizationForm(): ManualOrganizationForm {
  return {
    name: '',
    website_url: '',
    description: '',
    suggested_us_network_status: 'us_organization_connected_to_flanders',
    location_id: '',
    location_display: '',
    location_role: 'other',
    flemish_belgian_relevance: '',
    evidence_url: '',
    evidence_excerpt: '',
    confidence: '',
    sectorIds: [],
  };
}

function ensureProtocol(url: string): string {
  if (!url || !url.trim()) return '';
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return trimmed;
}

function normalizeConnectionName(value: string) {
  return value.trim().toLowerCase();
}

function reconcileConnections(
  selected: FlemishConnection[],
  options: FlemishConnection[]
): FlemishConnection[] {
  const byName = new Map(
    options.map((connection) => [normalizeConnectionName(connection.name), connection])
  );
  const deduped = new Map<string, FlemishConnection>();

  selected.forEach((connection) => {
    const key = normalizeConnectionName(connection.name);
    const resolved = byName.get(key) || connection;
    if (!deduped.has(key)) {
      deduped.set(key, resolved);
    }
  });

  return Array.from(deduped.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export default function AddContactPanel({
  sectors,
  onContactAdded,
  initialTab = 'manual',
}: AddContactPanelProps) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [addedPerson, setAddedPerson] = useState<Person | null>(null);
  const [manualMode, setManualMode] = useState<'people' | 'organizations'>('people');

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-yellow-200 overflow-hidden">
      <div className="px-6 pt-6 pb-0">
        <div className="flex items-center space-x-3 mb-4">
          <div className="w-9 h-9 rounded-lg bg-yellow-100 flex items-center justify-center">
            <UserPlus className="w-4.5 h-4.5 text-yellow-700" />
          </div>
          <h2 className="text-lg font-semibold text-gray-900">
            Discovery Intake
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

      <div className="p-6">
        {tab === 'manual' && (
          <div className="space-y-4">
            <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1">
              {[
                { value: 'people' as const, label: 'People', icon: UserPlus },
                { value: 'organizations' as const, label: 'Organizations', icon: Building2 },
              ].map((option) => {
                const Icon = option.icon;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => {
                      setManualMode(option.value);
                      setAddedPerson(null);
                    }}
                    className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium ${
                      manualMode === option.value
                        ? 'bg-yellow-100 text-yellow-800'
                        : 'text-gray-500 hover:bg-gray-50'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {option.label}
                  </button>
                );
              })}
            </div>
            <div className="flex gap-6">
              <div className="flex-1 max-w-2xl">
                {manualMode === 'people' ? (
                  <ManualAddForm
                    sectors={sectors}
                    onContactAdded={onContactAdded}
                    onPersonAdded={setAddedPerson}
                  />
                ) : (
                  <ManualOrganizationFormComponent
                    sectors={sectors}
                    onContactAdded={onContactAdded}
                  />
                )}
              </div>
            {addedPerson && (
              <div className="w-72 flex-shrink-0">
                <PersonPreview person={addedPerson} />
              </div>
            )}
            </div>
          </div>
        )}
        {tab === 'import' && (
          <div className="max-w-3xl">
            <CsvImport onContactAdded={onContactAdded} />
          </div>
        )}
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
  const flemishLabel = getPersonFlemishConnectionNames(person).join(', ');
  const locationLabel = personCardLocationLabel(person);
  const abroadBase = currentAbroadBaseLabel(person);

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
        {locationLabel && (
          <div className="flex items-center gap-2 text-gray-600">
            <MapPin className="w-3 h-3 text-gray-400 flex-shrink-0" />
            <span className="truncate">{locationLabel}</span>
          </div>
        )}
        {abroadBase && (
          <div className="flex items-center gap-2 text-gray-600">
            <Globe className="w-3 h-3 text-gray-400 flex-shrink-0" />
            <span className="truncate">Based in {abroadBase}</span>
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
        {flemishLabel && (
          <div className="flex items-center gap-2 text-gray-600">
            <Users className="w-3 h-3 text-gray-400 flex-shrink-0" />
            <span className="truncate">{flemishLabel}</span>
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
  const [form, setForm] = useState<ManualForm>(() => createEmptyForm());
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [dupeMatch, setDupeMatch] = useState<DuplicateMatch | null>(null);
  const [dupeChecking, setDupeChecking] = useState(false);
  const [allFlemishConnections, setAllFlemishConnections] = useState<FlemishConnection[]>([]);
  const [flemishConnections, setFlemishConnections] = useState<FlemishConnection[]>([]);

  useEffect(() => {
    supabase
      .from('flemish_connections')
      .select('id, name, type')
      .order('name')
      .then(({ data }) => {
        setAllFlemishConnections((data || []) as FlemishConnection[]);
      });
  }, []);

  const checkDuplicate = async () => {
    const first = form.firstName.trim().toLowerCase();
    const last = form.lastName.trim().toLowerCase();
    const email = form.email.trim().toLowerCase();

    if (!first) return null;

    const [{ data: allPeople }, { data: pendingPeople }] = await Promise.all([
      supabase
        .from('people')
        .select('id, name, first_name, last_name, email, location_id, locations(*)'),
      supabase
        .from('discovered_contacts')
        .select('id, name, email, candidate_key')
        .eq('status', 'pending'),
    ]);

    const fullName = `${first} ${last}`.trim();
    const candidateKey = buildCandidateKeyForMode(
      {
        first_name: form.firstName,
        last_name: form.lastName,
        email: form.email,
        linkedin_url: form.linkedin_url,
      },
      'people'
    );

    for (const person of allPeople || []) {
      const pFirst = (person.first_name || '').trim().toLowerCase();
      const pLast = (person.last_name || '').trim().toLowerCase();
      const pEmail = (person.email || '').trim().toLowerCase();
      const pName = (person.name || '').trim().toLowerCase();

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

    for (const candidate of pendingPeople || []) {
      const cEmail = (candidate.email || '').trim().toLowerCase();
      const cName = (candidate.name || '').trim().toLowerCase();
      if (
        candidate.candidate_key === candidateKey ||
        (email && cEmail && email === cEmail) ||
        (fullName && cName === fullName)
      ) {
        return { id: candidate.id, name: candidate.name, email: candidate.email };
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
    if (form.us_network_status === 'us_based' && !form.location_id) {
      setError('US-based people need a US base city.');
      return;
    }
    if (form.us_network_status === 'us_connected_abroad') {
      const hasAbroadBase =
        form.current_location_city.trim() && form.current_location_country.trim();
      const hasUsConnection = form.usConnections.some((connection) => connection.location_id);
      if (!hasAbroadBase) {
        setError('US-connected abroad people need a current city and country.');
        return;
      }
      if (!hasUsConnection) {
        setError('US-connected abroad people need at least one US connection location.');
        return;
      }
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
    const flemishStr = flemishConnections.map((connection) => connection.name).join(', ');

    const linkedin = ensureProtocol(form.linkedin_url || '');
    const website = ensureProtocol(form.website_url || '');
    const twitter = ensureProtocol(form.twitter_url || '');

    const candidateKey = buildCandidateKeyForMode(
      {
        first_name: first,
        last_name: last,
        email: form.email,
        linkedin_url: linkedin,
      },
      'people'
    );
    const sectorNames = sectors
      .filter((sector) => form.sectorIds.includes(sector.id))
      .map((sector) => sector.name);
    const sourceUrls = [linkedin, website, twitter].filter(Boolean);
    const suggestedConnections = form.usConnections
      .filter((connection) => connection.location_id || connection.location_display)
      .map((connection) => {
        const [city, state] = connection.location_display.split(',').map((part) => part.trim());
        return {
          location_city: city || null,
          location_state: state || null,
          connection_label: connection.connection_label.trim() || null,
          source_url: null,
          evidence_excerpt: null,
          confidence: null,
        };
      });

    const { data: candidate, error: insertErr } = await supabase
      .from('discovered_contacts')
      .insert({
        name: fullName,
        current_position: form.current_position || null,
        occupation: form.occupation || null,
        location_city:
          form.us_network_status === 'us_based'
            ? (form.location_display || '').split(',')[0]?.trim() || null
            : null,
        location_state:
          form.us_network_status === 'us_based'
            ? (form.location_display || '').split(',')[1]?.trim() || null
            : null,
        suggested_us_network_status: form.us_network_status,
        current_location_city:
          form.us_network_status === 'us_connected_abroad'
            ? form.current_location_city.trim() || null
            : null,
        current_location_country:
          form.us_network_status === 'us_connected_abroad'
            ? form.current_location_country.trim() || null
            : null,
        bio: form.bio || null,
        phone: form.phone || null,
        email: form.email || null,
        linkedin_url: linkedin || null,
        website_url: website || null,
        sectors: sectorNames,
        flemish_connection: flemishStr || null,
        source: 'manual',
        source_urls: sourceUrls,
        candidate_key: candidateKey,
        suggested_us_connections: suggestedConnections,
        discovery_confidence: 0.7,
      })
      .select('id, name')
      .maybeSingle();

    if (insertErr || !candidate) {
      setError(insertErr?.message || 'Failed to add pending contact');
      setSaving(false);
      return;
    }

    setSaving(false);
    setSuccess(true);
    setDupeMatch(null);
    onPersonAdded({
      id: candidate.id,
      name: fullName,
      title: form.title || null,
      first_name: first,
      last_name: last,
      current_position: form.current_position || undefined,
      occupation: form.occupation || undefined,
      email: form.email || undefined,
      phone: form.phone || undefined,
      linkedin_url: linkedin || undefined,
      website_url: website || undefined,
      bio: form.bio || undefined,
      us_network_status: form.us_network_status,
      current_location_city: form.current_location_city || null,
      current_location_country: form.current_location_country || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as Person);
    setForm(createEmptyForm());
    setFlemishConnections([]);
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

  const setField = (field: keyof ManualForm, value: string) => {
    setForm((f) => {
      const next = { ...f, [field]: value };

      if (field === 'bio') {
        const detected = reconcileConnections(
          extractFlemishConnectionsFromText(value).map((connection) => {
            const existing = allFlemishConnections.find(
              (option) =>
                normalizeConnectionName(option.name) ===
                normalizeConnectionName(connection.name)
            );
            return existing || { id: connection.name.toLowerCase(), ...connection };
          }),
          allFlemishConnections
        );

        if (detected.length > 0) {
          setFlemishConnections((prev) =>
            reconcileConnections([...prev, ...detected], allFlemishConnections)
          );
        }
      }

      return next;
    });
  };

  const updateUsConnection = (
    id: string,
    updater: (connection: ManualUsConnection) => ManualUsConnection
  ) => {
    setForm((f) => ({
      ...f,
      usConnections: f.usConnections.map((connection) =>
        connection.id === id ? updater(connection) : connection
      ),
    }));
  };

  const removeUsConnection = (id: string) => {
    setForm((f) => ({
      ...f,
      usConnections:
        f.usConnections.length > 1
          ? f.usConnections.filter((connection) => connection.id !== id)
          : [emptyUsConnection()],
    }));
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
              onChange={(e) => setField('title', e.target.value)}
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
            onChange={(e) => setField('firstName', e.target.value)}
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
            onChange={(e) => setField('lastName', e.target.value)}
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
            onChange={(e) => setField('current_position', e.target.value)}
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
              onChange={(e) => setField('occupation', e.target.value)}
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

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">
          People Scope
        </label>
        <div className="grid grid-cols-2 gap-2">
          {[
            { value: 'us_based', label: 'US-based' },
            { value: 'us_connected_abroad', label: 'US-connected abroad' },
          ].map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() =>
                setForm((f) => ({
                  ...f,
                  us_network_status: option.value as PersonUsNetworkStatus,
                }))
              }
              className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                form.us_network_status === option.value
                  ? 'border-yellow-400 bg-yellow-50 text-yellow-800'
                  : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {form.us_network_status === 'us_based' ? (
        <div className="flex flex-col space-y-1">
          <label className="block text-xs font-medium text-gray-600 mb-1">
            US Base City & State *
          </label>
          <div className="flex items-center space-x-2">
            <MapPin className="w-4 h-4 text-gray-400 flex-shrink-0" />
            <CitySearch
              value={form.location_id}
              cityStateDisplay={form.location_display}
              onChange={(id, city, state) => {
                setForm(f => ({
                  ...f,
                  location_id: id,
                  location_display: id ? `${city}, ${state}` : ''
                }));
              }}
              placeholder="Search US city..."
            />
          </div>
        </div>
      ) : (
        <div className="space-y-3 rounded-xl border border-indigo-100 bg-indigo-50/30 p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Current City Abroad *
              </label>
              <input
                value={form.current_location_city}
                onChange={(e) => setField('current_location_city', e.target.value)}
                className={INPUT_CLS}
                placeholder="Leuven"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Current Country Abroad *
              </label>
              <input
                value={form.current_location_country}
                onChange={(e) => setField('current_location_country', e.target.value)}
                className={INPUT_CLS}
                placeholder="Belgium"
              />
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-medium text-gray-600">
                US Connections *
              </label>
              <button
                type="button"
                onClick={() =>
                  setForm((f) => ({
                    ...f,
                    usConnections: [...f.usConnections, emptyUsConnection()],
                  }))
                }
                className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-white px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-50"
              >
                <Plus className="w-3 h-3" />
                Add
              </button>
            </div>

            {form.usConnections.map((connection, index) => (
              <div
                key={connection.id}
                className="space-y-2 rounded-lg border border-indigo-100 bg-white p-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-700">
                    Connection {index + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeUsConnection(connection.id)}
                    className="text-gray-300 hover:text-red-500"
                    title="Remove connection"
                  >
                    <XCircle className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex items-center space-x-2">
                  <MapPin className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  <CitySearch
                    value={connection.location_id}
                    cityStateDisplay={connection.location_display}
                    onChange={(id, city, state) =>
                      updateUsConnection(connection.id, (current) => ({
                        ...current,
                        location_id: id,
                        location_display: id ? `${city}, ${state}` : '',
                      }))
                    }
                    placeholder="Search US connection city..."
                  />
                </div>
                <input
                  value={connection.connection_label}
                  onChange={(e) =>
                    updateUsConnection(connection.id, (current) => ({
                      ...current,
                      connection_label: e.target.value,
                    }))
                  }
                  className={INPUT_CLS}
                  placeholder="Connection, e.g. Yale alumnus"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1 flex items-center space-x-1">
            <Phone className="w-3 h-3 text-gray-400" />
            <span>Phone</span>
          </label>
          <input
            value={form.phone}
            onChange={(e) => setField('phone', e.target.value)}
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
            onChange={(e) => setField('email', e.target.value)}
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
            onChange={(e) => setField('linkedin_url', e.target.value)}
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
            onChange={(e) => setField('website_url', e.target.value)}
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
            onChange={(e) => setField('twitter_url', e.target.value)}
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
          onChange={(e) => setField('bio', e.target.value)}
          className={`${INPUT_CLS} resize-none`}
          rows={3}
          placeholder="Brief description..."
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1.5">
          Flemish Connection
        </label>
        <FlemishConnectionSelector
          options={allFlemishConnections}
          value={flemishConnections}
          onChange={setFlemishConnections}
          onCreateOption={async (name, type) => {
            const canonical =
              canonicalizeFlemishConnection(name) || {
                name: name.trim(),
                type,
              };

            const existing = allFlemishConnections.find(
              (connection) =>
                normalizeConnectionName(connection.name) ===
                normalizeConnectionName(canonical.name)
            );
            if (existing) return existing;

            const { data, error } = await supabase
              .from('flemish_connections')
              .insert({
                name: canonical.name,
                type: canonical.type,
              })
              .select('id, name, type')
              .maybeSingle();

            if (error || !data) {
              setError(error?.message || 'Failed to create Flemish connection');
              return null;
            }

            const created = data as FlemishConnection;
            setAllFlemishConnections((prev) =>
              reconcileConnections([...prev, created], [...prev, created])
            );
            return created;
          }}
          placeholder="Search universities, companies, government links..."
        />
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
            "{form.firstName} {form.lastName}" matches existing or pending contact "{dupeMatch.name}"
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
              Create Pending Anyway
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
          <span>{dupeChecking ? 'Checking...' : 'Create Pending Contact'}</span>
        </button>
        {success && (
          <span className="flex items-center space-x-1 text-sm text-green-600">
            <CheckCircle2 className="w-4 h-4" />
            <span>Pending contact created</span>
          </span>
        )}
      </div>
    </form>
  );
}

function ManualOrganizationFormComponent({
  sectors,
  onContactAdded,
}: {
  sectors: Sector[];
  onContactAdded: () => void;
}) {
  const [form, setForm] = useState<ManualOrganizationForm>(() => createEmptyOrganizationForm());
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [dupeMatch, setDupeMatch] = useState<DuplicateMatch | null>(null);

  const setField = (field: keyof ManualOrganizationForm, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const toggleSector = (id: string) => {
    setForm((current) => ({
      ...current,
      sectorIds: current.sectorIds.includes(id)
        ? current.sectorIds.filter((sectorId) => sectorId !== id)
        : [...current.sectorIds, id],
    }));
  };

  const checkDuplicate = async (): Promise<DuplicateMatch | null> => {
    const name = form.name.trim().toLowerCase();
    const website = ensureProtocol(form.website_url || '').toLowerCase().replace(/\/$/, '');
    const candidateKey = buildCandidateKeyForMode(
      { name: form.name, website_url: form.website_url },
      'organizations'
    );

    if (!name) return null;

    const [{ data: approved }, { data: pending }] = await Promise.all([
      supabase.from('organizations').select('id, name, website_url'),
      supabase
        .from('discovered_organizations')
        .select('id, name, website_url, candidate_key')
        .eq('status', 'pending'),
    ]);

    for (const org of approved || []) {
      const orgWebsite = ensureProtocol(org.website_url || '').toLowerCase().replace(/\/$/, '');
      if (
        (website && orgWebsite && website === orgWebsite) ||
        (org.name || '').trim().toLowerCase() === name
      ) {
        return { id: org.id, name: org.name, email: null };
      }
    }

    for (const org of pending || []) {
      const orgWebsite = ensureProtocol(org.website_url || '').toLowerCase().replace(/\/$/, '');
      if (
        org.candidate_key === candidateKey ||
        (website && orgWebsite && website === orgWebsite) ||
        (org.name || '').trim().toLowerCase() === name
      ) {
        return { id: org.id, name: org.name, email: null };
      }
    }

    return null;
  };

  const insertOrganization = async () => {
    setSaving(true);
    setError('');

    const candidateKey = buildCandidateKeyForMode(
      { name: form.name, website_url: form.website_url },
      'organizations'
    );
    const sectorNames = sectors
      .filter((sector) => form.sectorIds.includes(sector.id))
      .map((sector) => sector.name);
    const sourceUrl = ensureProtocol(form.evidence_url || form.website_url || '');
    const parsedConfidence = Number(form.confidence);
    const confidence = Number.isFinite(parsedConfidence)
      ? Math.max(0, Math.min(1, parsedConfidence))
      : 0.7;
    const [city, state] = form.location_display.split(',').map((part) => part.trim());

    const { data: candidate, error: insertError } = await supabase
      .from('discovered_organizations')
      .insert({
        name: form.name.trim(),
        website_url: ensureProtocol(form.website_url),
        description: form.description || null,
        candidate_key: candidateKey,
        source: 'manual',
        suggested_us_network_status: form.suggested_us_network_status,
        us_locations: form.location_id
          ? [
              {
                city,
                state,
                role: form.location_role || 'other',
                source_url: sourceUrl,
                evidence_excerpt: form.evidence_excerpt || null,
                confidence,
              },
            ]
          : [],
        sectors: sectorNames,
        flemish_belgian_relevance: form.flemish_belgian_relevance || null,
        source_urls: sourceUrl ? [sourceUrl] : [],
        confidence,
      })
      .select('id')
      .maybeSingle();

    if (insertError || !candidate) {
      setError(insertError?.message || 'Failed to create pending organization');
      setSaving(false);
      return;
    }

    if (sourceUrl || form.evidence_excerpt) {
      const { error: evidenceError } = await supabase
        .from('discovered_organization_evidence')
        .insert({
          discovered_organization_id: candidate.id,
          evidence_key: `${candidateKey}:manual:${sourceUrl || form.evidence_excerpt}`,
          page_url: sourceUrl || ensureProtocol(form.website_url) || 'manual-intake',
          source_type: 'manual',
          source_url: sourceUrl,
          evidence_excerpt: form.evidence_excerpt || null,
          raw_relevance_text: form.flemish_belgian_relevance || null,
          raw_location_text: form.location_display || null,
          raw_sector_text: sectorNames.join('; ') || null,
          normalized_location_city: city || null,
          normalized_location_state: state || null,
          normalized_location_country: form.location_id ? 'United States' : null,
          confidence,
          observed_at: new Date().toISOString(),
        });

      if (evidenceError) {
        setError(evidenceError.message);
        setSaving(false);
        return;
      }
    }

    setSaving(false);
    setSuccess(true);
    setDupeMatch(null);
    setForm(createEmptyOrganizationForm());
    onContactAdded();
    setTimeout(() => setSuccess(false), 5000);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.name.trim()) {
      setError('Organization name is required');
      return;
    }
    if (!form.evidence_url.trim() && !form.evidence_excerpt.trim()) {
      setError('Manual organization intake needs an evidence URL or excerpt.');
      return;
    }

    setSaving(true);
    const duplicate = await checkDuplicate();
    setSaving(false);
    if (duplicate) {
      setDupeMatch(duplicate);
      return;
    }

    await insertOrganization();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">Organization Name *</label>
        <input
          value={form.name}
          onChange={(event) => setField('name', event.target.value)}
          className={INPUT_CLS}
          placeholder="Flanders Investment & Trade New York"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Website</label>
          <input
            value={form.website_url}
            onChange={(event) => setField('website_url', event.target.value)}
            className={INPUT_CLS}
            placeholder="example.org"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Organization Scope</label>
          <div className="relative">
            <select
              value={form.suggested_us_network_status}
              onChange={(event) =>
                setField(
                  'suggested_us_network_status',
                  event.target.value as OrganizationUsNetworkStatus
                )
              }
              className={`${INPUT_CLS} appearance-none pr-8`}
            >
              <option value="us_based_organization">US-based organization</option>
              <option value="belgian_organization_with_us_presence">Belgian organization with US presence</option>
              <option value="us_organization_connected_to_flanders">US organization connected to Flanders</option>
              <option value="institutional_connector">Institutional connector</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          </div>
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">US Location</label>
        <div className="flex items-center space-x-2">
          <MapPin className="h-4 w-4 flex-shrink-0 text-gray-400" />
          <CitySearch
            value={form.location_id}
            cityStateDisplay={form.location_display}
            onChange={(id, city, state) =>
              setForm((current) => ({
                ...current,
                location_id: id,
                location_display: id ? `${city}, ${state}` : '',
              }))
            }
            placeholder="Search US city..."
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Location Role</label>
          <input
            value={form.location_role}
            onChange={(event) => setField('location_role', event.target.value)}
            className={INPUT_CLS}
            placeholder="office, partner site, expansion target"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Confidence</label>
          <input
            value={form.confidence}
            onChange={(event) => setField('confidence', event.target.value)}
            className={INPUT_CLS}
            placeholder="0.8"
          />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">Flemish/Belgian Relevance</label>
        <textarea
          value={form.flemish_belgian_relevance}
          onChange={(event) => setField('flemish_belgian_relevance', event.target.value)}
          className={`${INPUT_CLS} resize-none`}
          rows={3}
          placeholder="Why this organization belongs in Discovery review..."
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Evidence URL *</label>
          <input
            value={form.evidence_url}
            onChange={(event) => setField('evidence_url', event.target.value)}
            className={INPUT_CLS}
            placeholder="https://..."
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Evidence Excerpt *</label>
          <input
            value={form.evidence_excerpt}
            onChange={(event) => setField('evidence_excerpt', event.target.value)}
            className={INPUT_CLS}
            placeholder="Short source excerpt"
          />
        </div>
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-medium text-gray-600">Sectors</label>
        <div className="flex flex-wrap gap-2">
          {sectors.map((sector) => (
            <button
              key={sector.id}
              type="button"
              onClick={() => toggleSector(sector.id)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                form.sectorIds.includes(sector.id)
                  ? 'bg-yellow-100 text-yellow-700 ring-1 ring-yellow-300'
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
            >
              {sector.name}
            </button>
          ))}
        </div>
      </div>

      {dupeMatch && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <div className="mb-2 flex items-center gap-2">
            <Users className="h-4 w-4 text-amber-600" />
            <p className="text-sm font-medium text-amber-700">Possible duplicate found</p>
          </div>
          <p className="mb-3 text-xs text-amber-600">
            "{form.name}" matches existing or pending organization "{dupeMatch.name}".
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setDupeMatch(null);
                insertOrganization();
              }}
              className="rounded-lg bg-yellow-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-yellow-600"
            >
              Create Pending Anyway
            </button>
            <button
              type="button"
              onClick={() => setDupeMatch(null)}
              className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-center space-x-2 text-sm text-red-600">
          <AlertCircle className="h-4 w-4" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex items-center space-x-3">
        <button
          type="submit"
          disabled={saving}
          className="flex items-center space-x-2 rounded-lg bg-yellow-500 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-yellow-600 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          <span>Create Pending Organization</span>
        </button>
        {success && (
          <span className="flex items-center space-x-1 text-sm text-green-600">
            <CheckCircle2 className="h-4 w-4" />
            <span>Pending organization created</span>
          </span>
        )}
      </div>
    </form>
  );
}
