import { useEffect, useState, useCallback } from 'react';
import {
  MapPin,
  Briefcase,
  ArrowLeft,
  Users,
  Network,
  Linkedin,
  Globe,
  Twitter,
  Mail,
  Phone,
  Pencil,
  Save,
  X,
  RotateCw,
  Loader2,
  Tag,
  ChevronDown,
} from 'lucide-react';
import { supabase, displayName, personInitials, FLEMISH_OPTIONS, OCCUPATION_OPTIONS, US_STATES, MAJOR_CITIES, type Person, type Sector, type FilterPreset } from '../lib/supabase';
import ProfileUpdateModal from '../components/ProfileUpdateModal';

interface PersonProfileProps {
  personId: string;
  onNavigate: (page: string, id?: string, preset?: FilterPreset) => void;
}

interface PersonSector {
  sector_id: string;
  sectors: { name: string } | null;
}

export default function PersonProfile({ personId, onNavigate }: PersonProfileProps) {
  const [person, setPerson] = useState<Person | null>(null);
  const [personSectors, setPersonSectors] = useState<{ id: string; name: string }[]>([]);
  const [allSectors, setAllSectors] = useState<Sector[]>([]);
  const [connections, setConnections] = useState<{ id: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Person>>({});
  const [editSectorIds, setEditSectorIds] = useState<string[]>([]);
  const [editFlemishConnections, setEditFlemishConnections] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [showUpdateModal, setShowUpdateModal] = useState(false);

  const loadPerson = useCallback(async () => {
    const [personRes, sectorsRes, allSectorsRes, connRes] = await Promise.all([
      supabase.from('people').select('*').eq('id', personId).maybeSingle(),
      supabase.from('person_sectors').select('sector_id, sectors(name)').eq('person_id', personId),
      supabase.from('sectors').select('*'),
      supabase.from('connections').select('id').or(`from_person_id.eq.${personId},to_person_id.eq.${personId}`).limit(50),
    ]);

    const personData = personRes.data;
    setPerson(personData);
    setAllSectors((allSectorsRes.data || []) as Sector[]);
    setConnections(connRes.data || []);

    const ps = ((sectorsRes.data || []) as unknown as PersonSector[])
      .filter((r) => r.sectors?.name)
      .map((r) => ({ id: r.sector_id, name: r.sectors!.name }));
    setPersonSectors(ps);

    if (personData) {
      const flemish = personData.flemish_connection
        ? personData.flemish_connection.split(',').map((s: string) => s.trim()).filter(Boolean)
        : [];
      setEditFlemishConnections(flemish);
    }

    setLoading(false);
  }, [personId]);

  useEffect(() => {
    loadPerson();
  }, [loadPerson]);

  const startEditing = () => {
    if (!person) return;
    setEditForm({
      name: person.name,
      title: person.title || '',
      first_name: person.first_name || '',
      last_name: person.last_name || '',
      current_position: person.current_position || '',
      occupation: person.occupation || '',
      location_city: person.location_city || '',
      location_state: person.location_state || '',
      bio: person.bio || '',
      flemish_connection: person.flemish_connection || '',
      phone: person.phone || '',
      email: person.email || '',
      linkedin_url: person.linkedin_url || '',
      website_url: person.website_url || '',
      twitter_url: person.twitter_url || '',
    });
    setEditSectorIds(personSectors.map((s) => s.id));
    const flemish = person.flemish_connection
      ? person.flemish_connection.split(',').map((s: string) => s.trim()).filter(Boolean)
      : [];
    setEditFlemishConnections(flemish);
    setEditing(true);
  };

  const cancelEditing = () => {
    setEditing(false);
    setEditForm({});
    setEditSectorIds([]);
    setEditFlemishConnections([]);
  };

  const saveEdits = async () => {
    if (!person) return;
    setSaving(true);

    const first = (editForm.first_name || '').trim();
    const last = (editForm.last_name || '').trim();
    const title = (editForm.title || '').trim();
    const computedName = [title, first, last].filter(Boolean).join(' ') || editForm.name || person.name;

    const flemishStr = editFlemishConnections.join(', ');

    const { error: updateErr } = await supabase
      .from('people')
      .update({
        name: computedName,
        title: title || null,
        first_name: first || null,
        last_name: last || null,
        current_position: editForm.current_position || null,
        occupation: editForm.occupation || null,
        location_city: editForm.location_city || null,
        location_state: editForm.location_state || null,
        bio: editForm.bio || null,
        flemish_connection: flemishStr || null,
        phone: editForm.phone || null,
        email: editForm.email || null,
        linkedin_url: editForm.linkedin_url || null,
        website_url: editForm.website_url || null,
        twitter_url: editForm.twitter_url || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', person.id);

    if (!updateErr) {
      const currentIds = personSectors.map((s) => s.id);
      const toRemove = currentIds.filter((id) => !editSectorIds.includes(id));
      const toAdd = editSectorIds.filter((id) => !currentIds.includes(id));

      if (toRemove.length > 0) {
        for (const sid of toRemove) {
          await supabase
            .from('person_sectors')
            .delete()
            .eq('person_id', person.id)
            .eq('sector_id', sid);
        }
      }

      if (toAdd.length > 0) {
        await supabase
          .from('person_sectors')
          .insert(toAdd.map((sid) => ({ person_id: person.id, sector_id: sid })));
      }
    }

    setSaving(false);
    setEditing(false);
    await loadPerson();
  };

  const toggleEditSector = (id: string) => {
    setEditSectorIds((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  };

  const toggleEditFlemish = (option: string) => {
    setEditFlemishConnections((prev) =>
      prev.includes(option) ? prev.filter((s) => s !== option) : [...prev, option]
    );
  };

  const setField = (field: string, value: string) => {
    setEditForm((f) => {
      const next = { ...f, [field]: value };
      
      // Auto-inference for Flemish Connection from Bio
      if (field === 'bio') {
        const lowerBio = value.toLowerCase();
        const detected = FLEMISH_OPTIONS.filter(opt => 
          lowerBio.includes(opt.toLowerCase()) && !editFlemishConnections.includes(opt)
        );
        if (detected.length > 0) {
          setEditFlemishConnections(prev => [...new Set([...prev, ...detected])]);
        }
      }
      
      return next;
    });
  };

  const handleUpdateApplied = () => {
    setShowUpdateModal(false);
    loadPerson();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-64px)]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-yellow-600"></div>
      </div>
    );
  }

  if (!person) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center">
        <h2 className="text-2xl font-semibold text-gray-900 mb-4">Person not found</h2>
        <button
          onClick={() => onNavigate('directory')}
          className="text-yellow-600 hover:text-yellow-700 font-medium"
        >
          Return to directory
        </button>
      </div>
    );
  }

  const initials = personInitials(person);

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <button
        onClick={() => onNavigate('directory')}
        className="flex items-center space-x-2 text-gray-600 hover:text-gray-900 mb-6 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Back to directory</span>
      </button>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-8">
          <div className="flex items-start justify-between mb-8">
            <div className="flex items-start space-x-6 flex-1">
              <div className="w-24 h-24 rounded-full bg-gradient-to-br from-blue-100 to-blue-200 flex items-center justify-center flex-shrink-0">
                <span className="text-3xl font-semibold text-blue-700">{initials}</span>
              </div>
              <div className="flex-1 min-w-0">
                {editing ? (
                  <EditHeader editForm={editForm} setField={setField} />
                ) : (
                  <ViewHeader person={person} onNavigate={onNavigate} />
                )}

                <div className="flex flex-wrap items-center gap-3 mt-4">
                  {!editing && (
                    <>
                      <button
                        onClick={startEditing}
                        className="px-5 py-2 bg-yellow-400 hover:bg-yellow-500 text-gray-900 font-medium rounded-lg transition-colors flex items-center space-x-2"
                      >
                        <Pencil className="w-4 h-4" />
                        <span>Edit Profile</span>
                      </button>
                      <button
                        onClick={() => setShowUpdateModal(true)}
                        className="px-5 py-2 bg-gray-100 hover:bg-gray-200 text-gray-900 font-medium rounded-lg transition-colors flex items-center space-x-2"
                      >
                        <RotateCw className="w-4 h-4" />
                        <span>AI Update</span>
                      </button>
                      {person.email && (
                        <a
                          href={`mailto:${person.email}`}
                          className="px-5 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 font-medium rounded-lg transition-colors flex items-center space-x-2"
                        >
                          <Mail className="w-4 h-4" />
                          <span>Email</span>
                        </a>
                      )}
                    </>
                  )}
                  {editing && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={saveEdits}
                        disabled={saving}
                        className="px-5 py-2 bg-green-500 hover:bg-green-600 text-white font-medium rounded-lg transition-colors flex items-center space-x-2 disabled:opacity-50"
                      >
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        <span>Save</span>
                      </button>
                      <button
                        onClick={cancelEditing}
                        className="px-5 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-lg transition-colors flex items-center space-x-2"
                      >
                        <X className="w-4 h-4" />
                        <span>Cancel</span>
                      </button>
                    </div>
                  )}
                </div>

                {!editing && (
                  <SocialLinks person={person} />
                )}
              </div>
            </div>
          </div>

          {editing ? (
            <EditBody
              editForm={editForm}
              setField={setField}
              allSectors={allSectors}
              editSectorIds={editSectorIds}
              toggleEditSector={toggleEditSector}
              editFlemishConnections={editFlemishConnections}
              toggleEditFlemish={toggleEditFlemish}
            />
          ) : (
            <ViewBody
              person={person}
              personSectors={personSectors}
              connections={connections}
              onNavigate={onNavigate}
            />
          )}
        </div>
      </div>

      {showUpdateModal && (
        <ProfileUpdateModal
          person={person}
          onClose={() => setShowUpdateModal(false)}
          onApplied={handleUpdateApplied}
        />
      )}
    </div>
  );
}

const INPUT_CLS =
  'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:border-transparent';

function ViewHeader({ person, onNavigate }: { person: Person; onNavigate: (page: string, id?: string, preset?: FilterPreset) => void }) {
  return (
    <>
      <h1 className="text-3xl font-semibold text-gray-900 mb-2">{displayName(person)}</h1>
      {person.current_position && (
        <div className="flex items-center space-x-2 text-gray-600 mb-1">
          <Briefcase className="w-5 h-5" />
          <span className="text-lg">{person.current_position}</span>
        </div>
      )}
      {person.occupation && (
        <div className="flex items-center space-x-2 text-gray-500 mb-1">
          <Tag className="w-4 h-4" />
          <span className="text-sm font-medium">{person.occupation}</span>
        </div>
      )}
      {person.location_city && (
        <button
          onClick={() => onNavigate('dashboard', undefined, { focusCity: { city: person.location_city!, state: person.location_state || '' } })}
          className="flex items-center space-x-2 text-gray-600 hover:text-yellow-700 mb-1 transition-colors group"
        >
          <MapPin className="w-5 h-5" />
          <span className="group-hover:underline">{person.location_city}{person.location_state && `, ${person.location_state}`}</span>
        </button>
      )}
      {person.phone && (
        <div className="flex items-center space-x-2 text-gray-500 mb-1">
          <Phone className="w-4 h-4" />
          <span className="text-sm">{person.phone}</span>
        </div>
      )}
      {person.email && (
        <div className="flex items-center space-x-2 text-gray-500">
          <Mail className="w-4 h-4" />
          <span className="text-sm">{person.email}</span>
        </div>
      )}
    </>
  );
}

function EditHeader({
  editForm,
  setField,
}: {
  editForm: Partial<Person>;
  setField: (f: string, v: string) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[90px,1fr,1fr] gap-3">
        <div>
          <select
            value={editForm.title || ''}
            onChange={(e) => setField('title', e.target.value)}
            className={`${INPUT_CLS} text-sm`}
          >
            <option value="">Title</option>
            <option value="Dr">Dr</option>
            <option value="Prof">Prof</option>
            <option value="Ms">Ms</option>
            <option value="Mrs">Mrs</option>
            <option value="Mr">Mr</option>
            <option value="Miss">Miss</option>
          </select>
        </div>
        <input
          value={editForm.first_name || ''}
          onChange={(e) => setField('first_name', e.target.value)}
          className={`${INPUT_CLS} text-lg font-semibold`}
          placeholder="First name"
        />
        <input
          value={editForm.last_name || ''}
          onChange={(e) => setField('last_name', e.target.value)}
          className={`${INPUT_CLS} text-lg font-semibold`}
          placeholder="Last name"
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <div className="flex items-center space-x-2">
          <Briefcase className="w-4 h-4 text-gray-400 flex-shrink-0" />
          <input
            value={editForm.current_position || ''}
            onChange={(e) => setField('current_position', e.target.value)}
            className={INPUT_CLS}
            placeholder="Position / Title"
          />
        </div>
        <div className="flex items-center space-x-2">
          <Tag className="w-4 h-4 text-gray-400 flex-shrink-0" />
          <div className="relative flex-1">
            <select
              value={editForm.occupation || ''}
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
        <div className="flex items-center space-x-2 sm:col-span-2 lg:col-span-1">
          <MapPin className="w-4 h-4 text-gray-400 flex-shrink-0" />
          <div className="flex flex-1 gap-2">
            <div className="flex-[3] relative">
              <input
                value={editForm.location_city || ''}
                onChange={(e) => setField('location_city', e.target.value)}
                className={INPUT_CLS}
                placeholder="City"
                list="edit-city-suggestions"
              />
              <datalist id="edit-city-suggestions">
                {MAJOR_CITIES.map(city => <option key={city} value={city} />)}
              </datalist>
            </div>
            <div className="flex-[2] relative">
              <select
                value={editForm.location_state || ''}
                onChange={(e) => setField('location_state', e.target.value)}
                className={`${INPUT_CLS} appearance-none pr-8`}
              >
                <option value="">State</option>
                {US_STATES.map((s) => (
                  <option key={s.code} value={s.code}>{s.name}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            </div>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="flex items-center space-x-2">
          <Phone className="w-4 h-4 text-gray-400 flex-shrink-0" />
          <input
            value={editForm.phone || ''}
            onChange={(e) => setField('phone', e.target.value)}
            className={INPUT_CLS}
            placeholder="Phone"
          />
        </div>
        <div className="flex items-center space-x-2">
          <Mail className="w-4 h-4 text-gray-400 flex-shrink-0" />
          <input
            value={editForm.email || ''}
            onChange={(e) => setField('email', e.target.value)}
            className={INPUT_CLS}
            placeholder="Email"
            type="email"
          />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="flex items-center space-x-2">
          <Linkedin className="w-4 h-4 text-gray-400 flex-shrink-0" />
          <input
            value={editForm.linkedin_url || ''}
            onChange={(e) => setField('linkedin_url', e.target.value)}
            className={INPUT_CLS}
            placeholder="LinkedIn URL"
          />
        </div>
        <div className="flex items-center space-x-2">
          <Twitter className="w-4 h-4 text-gray-400 flex-shrink-0" />
          <input
            value={editForm.twitter_url || ''}
            onChange={(e) => setField('twitter_url', e.target.value)}
            className={INPUT_CLS}
            placeholder="Twitter URL"
          />
        </div>
        <div className="flex items-center space-x-2">
          <Globe className="w-4 h-4 text-gray-400 flex-shrink-0" />
          <input
            value={editForm.website_url || ''}
            onChange={(e) => setField('website_url', e.target.value)}
            className={INPUT_CLS}
            placeholder="Website URL"
          />
        </div>
      </div>
    </div>
  );
}

function SocialLinks({ person }: { person: Person }) {
  return (
    <div className="flex flex-wrap items-center gap-2 mt-3">
      {person.linkedin_url && (
        <a
          href={person.linkedin_url}
          target="_blank"
          rel="noopener noreferrer"
          className="p-2 rounded-lg border border-gray-200 text-gray-500 hover:text-[#0A66C2] hover:border-[#0A66C2] transition-colors"
        >
          <Linkedin className="w-5 h-5" />
        </a>
      )}
      {person.twitter_url && (
        <a
          href={person.twitter_url}
          target="_blank"
          rel="noopener noreferrer"
          className="p-2 rounded-lg border border-gray-200 text-gray-500 hover:text-[#1DA1F2] hover:border-[#1DA1F2] transition-colors"
        >
          <Twitter className="w-5 h-5" />
        </a>
      )}
      {person.website_url && (
        <a
          href={person.website_url}
          target="_blank"
          rel="noopener noreferrer"
          className="p-2 rounded-lg border border-gray-200 text-gray-500 hover:text-teal-600 hover:border-teal-600 transition-colors"
        >
          <Globe className="w-5 h-5" />
        </a>
      )}
    </div>
  );
}

function EditBody({
  editForm,
  setField,
  allSectors,
  editSectorIds,
  toggleEditSector,
  editFlemishConnections,
  toggleEditFlemish,
}: {
  editForm: Partial<Person>;
  setField: (f: string, v: string) => void;
  allSectors: Sector[];
  editSectorIds: string[];
  toggleEditSector: (id: string) => void;
  editFlemishConnections: string[];
  toggleEditFlemish: (opt: string) => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <label className="text-sm font-medium text-gray-700 mb-2 block">About</label>
        <textarea
          value={editForm.bio || ''}
          onChange={(e) => setField('bio', e.target.value)}
          className={`${INPUT_CLS} resize-none`}
          rows={4}
          placeholder="Bio..."
        />
      </div>
      <div>
        <label className="text-sm font-medium text-gray-700 mb-2 block">Flemish Connection</label>
        <div className="flex flex-wrap gap-2">
          {FLEMISH_OPTIONS.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => toggleEditFlemish(opt)}
              className={`text-sm px-4 py-1.5 rounded-full font-medium transition-colors ${
                editFlemishConnections.includes(opt)
                  ? 'bg-blue-100 text-blue-700 ring-1 ring-blue-300'
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
            >
              {opt}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="text-sm font-medium text-gray-700 mb-2 block">Sectors</label>
        <div className="flex flex-wrap gap-2">
          {allSectors.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => toggleEditSector(s.id)}
              className={`text-sm px-4 py-1.5 rounded-full font-medium transition-colors ${
                editSectorIds.includes(s.id)
                  ? 'bg-yellow-100 text-yellow-700 ring-1 ring-yellow-300'
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

const SECTOR_COLORS: Record<string, { bg: string; text: string }> = {
  'Artificial Intelligence': { bg: 'bg-blue-50', text: 'text-blue-700' },
  Biotechnology: { bg: 'bg-green-50', text: 'text-green-700' },
  Finance: { bg: 'bg-amber-50', text: 'text-amber-700' },
  Education: { bg: 'bg-yellow-50', text: 'text-yellow-700' },
  'Culture & Arts': { bg: 'bg-pink-50', text: 'text-pink-700' },
  Research: { bg: 'bg-cyan-50', text: 'text-cyan-700' },
};

function matchFlemishOptions(text: string): string[] {
  const lower = text.toLowerCase();
  return FLEMISH_OPTIONS.filter((opt) => lower.includes(opt.toLowerCase()));
}

function ViewBody({
  person,
  personSectors,
  connections,
  onNavigate,
}: {
  person: Person;
  personSectors: { id: string; name: string }[];
  connections: { id: string }[];
  onNavigate: (page: string, id?: string, preset?: FilterPreset) => void;
}) {
  return (
    <>
      {person.bio && (
        <div className="mb-8 pb-8 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900 mb-3">About</h2>
          <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">{person.bio}</p>
        </div>
      )}

      {person.flemish_connection && (
        <div className="mb-8 pb-8 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900 mb-3">Flemish Connection</h2>
          <div className="flex flex-wrap gap-2">
            {(() => {
              const matched = matchFlemishOptions(person.flemish_connection!);
              if (matched.length === 0) {
                return <p className="text-gray-700">{person.flemish_connection}</p>;
              }
              
              // If there are specific matched tags, show them as tags.
              // We also want to show any extra text that might be in flemish_connection
              // but for now, the UI usually just has the tags.
              return matched.map(m => (
                <button
                  key={m}
                  onClick={() => onNavigate('dashboard', undefined, { flemishConnections: [m] })}
                  className="px-4 py-2 bg-blue-50 text-blue-700 rounded-lg text-sm font-medium hover:ring-2 hover:ring-blue-300 transition-all cursor-pointer"
                >
                  {m}
                </button>
              ));
            })()}
          </div>
        </div>
      )}

      <div className="mb-8 pb-8 border-b border-gray-200">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Sectors & Expertise</h2>
        {personSectors.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {personSectors.map((s) => {
              const colors = SECTOR_COLORS[s.name] || { bg: 'bg-gray-50', text: 'text-gray-700' };
              return (
                <button
                  key={s.id}
                  onClick={() => onNavigate('dashboard', undefined, { sector: s.name })}
                  className={`px-4 py-2 ${colors.bg} ${colors.text} rounded-lg text-sm font-medium hover:ring-2 hover:ring-yellow-300 transition-all cursor-pointer`}
                >
                  {s.name}
                </button>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-gray-400">No sectors assigned yet</p>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Network</h2>
          <button className="text-yellow-600 hover:text-yellow-700 font-medium text-sm flex items-center space-x-1">
            <Network className="w-4 h-4" />
            <span>View graph</span>
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 bg-gray-50 rounded-lg">
            <div className="flex items-center space-x-2 text-gray-700 mb-1">
              <Users className="w-4 h-4" />
              <span className="font-medium">Direct Connections</span>
            </div>
            <p className="text-2xl font-semibold text-gray-900">{connections.length}</p>
          </div>
          <div className="p-4 bg-gray-50 rounded-lg">
            <div className="flex items-center space-x-2 text-gray-700 mb-1">
              <Network className="w-4 h-4" />
              <span className="font-medium">Network Reach</span>
            </div>
            <p className="text-2xl font-semibold text-gray-900">{connections.length * 12}</p>
          </div>
        </div>
      </div>
    </>
  );
}
