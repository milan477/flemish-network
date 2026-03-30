import { useEffect, useState, useCallback } from 'react';
import {
  MapPin,
  Briefcase,
  ArrowLeft,
  Users,
  Network,
  Linkedin,
  Globe,
  Mail,
  Phone,
  Pencil,
  Save,
  X,
  RotateCw,
  Loader2,
  Tag,
  ChevronDown,
  Library,
  ShieldCheck,
  ShieldAlert,
  Database,
  Printer,
  Camera,
  Trash2,
  Link,
} from 'lucide-react';
import {
  supabase,
  displayName,
  OCCUPATION_OPTIONS,
  type Person,
  type Sector,
  type FilterPreset,
  type FlemishConnection,
} from '../lib/supabase';
import {
  canonicalizeFlemishConnection,
  extractFlemishConnectionsFromText,
  getPersonFlemishConnections,
} from '../lib/flemishConnections';
import ProfileUpdateModal from '../components/ProfileUpdateModal';
import CitySearch from '../components/CitySearch';
import AddToCollectionDropdown from '../components/AddToCollectionDropdown';
import { generateEmbedding } from '../lib/aiService';
import { ProfileAvatar } from '../components/ProfileAvatar';
import ConnectionGraphModal, { type GraphConnection } from '../components/ConnectionGraphModal';
import FlemishConnectionSelector from '../components/FlemishConnectionSelector';

interface PersonProfileProps {
  personId: string;
  onNavigate: (page: string, id?: string, preset?: FilterPreset) => void;
}

interface PersonSector {
  sector_id: string;
  sectors: { name: string } | null;
}

interface ConnectionRow {
  id: string;
  from_person_id: string | null;
  to_person_id: string | null;
  relationship_type: string | null;
  strength: number | null;
}

interface RelatedConnectionPersonRow {
  id: string;
  name: string;
  title?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  current_position?: string | null;
  occupation?: string | null;
  profile_photo_url?: string | null;
  email?: string | null;
  location_id?: string | null;
  locations?:
    | GraphConnection['person']['locations']
    | GraphConnection['person']['locations'][]
    | null;
}

function formatRelationshipType(type: string): string {
  if (type === 'local_peer') return 'Local Peer';
  return type
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function buildGraphConnections(
  rows: ConnectionRow[],
  relatedPeople: GraphConnection['person'][],
  currentPersonId: string
): GraphConnection[] {
  const peopleById = new Map(relatedPeople.map((relatedPerson) => [relatedPerson.id, relatedPerson]));
  const connectionsByPerson = new Map<string, GraphConnection>();

  for (const row of rows) {
    const connectedPersonId =
      row.from_person_id === currentPersonId ? row.to_person_id : row.from_person_id;

    if (!connectedPersonId) continue;

    const connectedPerson = peopleById.get(connectedPersonId);
    if (!connectedPerson) continue;

    const existing = connectionsByPerson.get(connectedPersonId);
    if (existing) {
      if (row.relationship_type && !existing.relationshipTypes.includes(row.relationship_type)) {
        existing.relationshipTypes.push(row.relationship_type);
      }
      existing.connectionIds.push(row.id);
      existing.strength = Math.max(existing.strength, row.strength || 0);
      continue;
    }

    connectionsByPerson.set(connectedPersonId, {
      person: connectedPerson,
      relationshipTypes: row.relationship_type ? [row.relationship_type] : [],
      connectionIds: [row.id],
      strength: row.strength || 0,
    });
  }

  return Array.from(connectionsByPerson.values())
    .map((connection) => ({
      ...connection,
      relationshipTypes: connection.relationshipTypes.sort(),
    }))
    .sort((a, b) => {
      if (b.relationshipTypes.length !== a.relationshipTypes.length) {
        return b.relationshipTypes.length - a.relationshipTypes.length;
      }
      return a.person.name.localeCompare(b.person.name);
    });
}

function normalizeRelatedPeople(
  rows: RelatedConnectionPersonRow[]
): GraphConnection['person'][] {
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    title: row.title || undefined,
    first_name: row.first_name || undefined,
    last_name: row.last_name || undefined,
    current_position: row.current_position || undefined,
    occupation: row.occupation || undefined,
    profile_photo_url: row.profile_photo_url || undefined,
    email: row.email || undefined,
    location_id: row.location_id || undefined,
    locations: Array.isArray(row.locations) ? row.locations[0] || undefined : row.locations || undefined,
  }));
}

function ensureProtocol(url: string): string {
  if (!url || !url.trim()) return '';
  const trimmed = url.trim();
  // If it's just an @username, leave it (or maybe prefix with x.com/ later?)
  // For now, only prefix if it doesn't look like an absolute URL
  if (!/^https?:\/\//i.test(trimmed) && trimmed.includes('.')) {
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

export default function PersonProfile({ personId, onNavigate }: PersonProfileProps) {
  const [person, setPerson] = useState<Person | null>(null);
  const [personSectors, setPersonSectors] = useState<{ id: string; name: string }[]>([]);
  const [allSectors, setAllSectors] = useState<Sector[]>([]);
  const [allFlemishConnections, setAllFlemishConnections] = useState<FlemishConnection[]>([]);
  const [connections, setConnections] = useState<GraphConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Person>>({});
  const [editSectorIds, setEditSectorIds] = useState<string[]>([]);
  const [editFlemishConnections, setEditFlemishConnections] = useState<FlemishConnection[]>([]);
  const [editLocationDisplay, setEditLocationDisplay] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [showCollections, setShowCollections] = useState(false);
  const [showConnectionGraph, setShowConnectionGraph] = useState(false);

  const loadPerson = useCallback(async () => {
    const [personRes, sectorsRes, allSectorsRes, connRes, flemishRes] = await Promise.all([
      supabase
        .from('people')
        .select('*, locations(*), person_flemish_connections(flemish_connection_id, flemish_connections(id, name, type))')
        .eq('id', personId)
        .maybeSingle(),
      supabase.from('person_sectors').select('sector_id, sectors(name)').eq('person_id', personId),
      supabase.from('sectors').select('*'),
      supabase
        .from('connections')
        .select('id, from_person_id, to_person_id, relationship_type, strength')
        .or(`from_person_id.eq.${personId},to_person_id.eq.${personId}`)
        .limit(100),
      supabase.from('flemish_connections').select('id, name, type').order('name'),
    ]);

    const personData = personRes.data;
    setPerson(personData);
    setAllSectors((allSectorsRes.data || []) as Sector[]);
    setAllFlemishConnections((flemishRes.data || []) as FlemishConnection[]);

    const ps = ((sectorsRes.data || []) as unknown as PersonSector[])
      .filter((r) => r.sectors?.name)
      .map((r) => ({ id: r.sector_id, name: r.sectors!.name }));
    setPersonSectors(ps);

    const connectionRows = (connRes.data || []) as ConnectionRow[];
    const relatedPersonIds = Array.from(
      new Set(
        connectionRows
          .map((row) => (row.from_person_id === personId ? row.to_person_id : row.from_person_id))
          .filter((id): id is string => Boolean(id))
      )
    );

    if (relatedPersonIds.length > 0) {
      const { data: relatedPeople } = await supabase
        .from('people')
        .select('id, name, title, first_name, last_name, current_position, occupation, profile_photo_url, email, location_id, locations(*)')
        .in('id', relatedPersonIds);

      setConnections(
        buildGraphConnections(
          connectionRows,
          normalizeRelatedPeople((relatedPeople || []) as RelatedConnectionPersonRow[]),
          personId
        )
      );
    } else {
      setConnections([]);
    }

    if (personData) {
      setEditFlemishConnections(
        reconcileConnections(
          getPersonFlemishConnections(personData as Person),
          (flemishRes.data || []) as FlemishConnection[]
        )
      );
    }

    setLoading(false);
  }, [personId]);

  useEffect(() => {
    loadPerson();
  }, [loadPerson, personId]);

  const startEditing = () => {
    if (!person) return;
    setEditLocationDisplay(person.locations ? `${person.locations.city}, ${person.locations.state}` : '');
    setEditForm({
      name: person.name,
      title: person.title || '',
      first_name: person.first_name || '',
      last_name: person.last_name || '',
      current_position: person.current_position || '',
      occupation: person.occupation || '',
      location_id: person.location_id || '',
      bio: person.bio || '',
      flemish_connection: person.flemish_connection || '',
      phone: person.phone || '',
      email: person.email || '',
      linkedin_url: person.linkedin_url || '',
      website_url: person.website_url || '',
      twitter_url: person.twitter_url || '',
      profile_photo_url: person.profile_photo_url || '',
    });
    setEditSectorIds(personSectors.map((s) => s.id));
    setEditFlemishConnections(
      reconcileConnections(getPersonFlemishConnections(person), allFlemishConnections)
    );
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

    const flemishStr = editFlemishConnections.map((connection) => connection.name).join(', ');

    const linkedin = ensureProtocol(editForm.linkedin_url || '');
    const twitter = ensureProtocol(editForm.twitter_url || '');
    const website = ensureProtocol(editForm.website_url || '');

    const updatePayload = {
      name: computedName,
      title: title, // DB has NOT NULL DEFAULT ''
      first_name: first, // DB has NOT NULL DEFAULT ''
      last_name: last, // DB has NOT NULL DEFAULT ''
      current_position: editForm.current_position || null,
      occupation: editForm.occupation || null,
      location_id: editForm.location_id || null,
      bio: editForm.bio || null,
      flemish_connection: flemishStr || null,
      phone: editForm.phone || null,
      email: editForm.email || null,
      linkedin_url: linkedin || null,
      website_url: website || null,
      twitter_url: twitter || null,
      profile_photo_url: editForm.profile_photo_url || null,
      last_verified_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { data: updatedPerson, error: updateErr } = await supabase
      .from('people')
      .update(updatePayload)
      .eq('id', person.id)
      .select('*, locations(*), person_flemish_connections(flemish_connection_id, flemish_connections(id, name, type))')
      .maybeSingle();

    if (updateErr) {
      setSaveError(`Error saving: ${updateErr.message}`);
      setSaving(false);
      return;
    }

    if (!updatedPerson) {
      setSaveError('The update was not applied. You might not have permission to edit this profile.');
      setSaving(false);
      return;
    }
    setSaveError(null);

    setPerson(updatedPerson as Person);
    // Regenerate embedding after profile update
    generateEmbedding(person.id);

    const ensuredConnections: FlemishConnection[] = [];
    for (const connection of editFlemishConnections) {
      const canonical =
        canonicalizeFlemishConnection(connection.name) || {
          name: connection.name.trim(),
          type: connection.type,
        };
      const existing = allFlemishConnections.find(
        (option) => normalizeConnectionName(option.name) === normalizeConnectionName(canonical.name)
      );

      if (existing) {
        ensuredConnections.push(existing);
        continue;
      }

      const { data: inserted, error: insertConnectionError } = await supabase
        .from('flemish_connections')
        .insert({
          name: canonical.name,
          type: canonical.type,
        })
        .select('id, name, type')
        .maybeSingle();

      if (insertConnectionError) {
        setSaveError(`Profile info saved, but error saving Flemish connections: ${insertConnectionError.message}`);
        setSaving(false);
        return;
      }

      if (inserted) {
        ensuredConnections.push(inserted as FlemishConnection);
      }
    }

    const currentIds = personSectors.map((s) => s.id);
    const toRemove = currentIds.filter((id) => !editSectorIds.includes(id));
    const toAdd = editSectorIds.filter((id) => !currentIds.includes(id));

    try {
      const { error: deleteFlemishError } = await supabase
        .from('person_flemish_connections')
        .delete()
        .eq('person_id', person.id);
      if (deleteFlemishError) throw deleteFlemishError;

      if (ensuredConnections.length > 0) {
        const { error: insertFlemishError } = await supabase
          .from('person_flemish_connections')
          .insert(
            ensuredConnections.map((connection) => ({
              person_id: person.id,
              flemish_connection_id: connection.id,
            }))
          );
        if (insertFlemishError) throw insertFlemishError;
      }

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
        const { error: insertErr } = await supabase
          .from('person_sectors')
          .insert(toAdd.map((sid) => ({ person_id: person.id, sector_id: sid })));
        if (insertErr) throw insertErr;
      }

      setPerson({
        ...(updatedPerson as Person),
        person_flemish_connections: ensuredConnections.map((connection) => ({
          person_id: person.id,
          flemish_connection_id: connection.id,
          flemish_connections: connection,
        })),
      });
      setAllFlemishConnections((prev) =>
        reconcileConnections([...prev, ...ensuredConnections], [...prev, ...ensuredConnections])
      );
      setEditFlemishConnections(ensuredConnections);
      setEditing(false);
    } catch (err: any) {
      setSaveError(`Profile info saved, but error updating related tags: ${err.message}`);
      setEditing(false);
    }

    setSaving(false);
  };

  const toggleEditSector = (id: string) => {
    setEditSectorIds((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  };

  const setField = (field: string, value: string) => {
    setEditForm((f) => {
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
          setEditFlemishConnections((prev) =>
            reconcileConnections([...prev, ...detected], allFlemishConnections)
          );
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


  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <button
        onClick={() => onNavigate('directory')}
        className="flex items-center space-x-2 text-gray-600 hover:text-gray-900 mb-6 transition-colors"
        data-print-hide
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Back to directory</span>
      </button>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-8">
          <div className="flex items-start justify-between mb-8">
            <div className="flex items-start space-x-6 flex-1">
              {editing ? (
                <EditableAvatar
                  person={person}
                  editForm={editForm}
                  setField={setField}
                />
              ) : (
                <ProfileAvatar person={person} size="lg" />
              )}
              <div className="flex-1 min-w-0">
                {editing ? (
                  <EditHeader editForm={editForm} setField={setField} setEditForm={setEditForm} editLocationDisplay={editLocationDisplay} setEditLocationDisplay={setEditLocationDisplay} />
                ) : (
                  <ViewHeader person={person} onNavigate={onNavigate} />
                )}

                <div className="flex flex-wrap items-center gap-3 mt-4" data-print-hide>
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
                      <div className="relative">
                        <button
                          onClick={() => setShowCollections(!showCollections)}
                          className={`px-5 py-2 font-medium rounded-lg transition-colors flex items-center space-x-2 ${
                            showCollections 
                              ? 'bg-yellow-100 text-yellow-700' 
                              : 'bg-yellow-50 text-yellow-600 hover:bg-yellow-100'
                          }`}
                        >
                          <Library className="w-4 h-4" />
                          <span>Add to Collection</span>
                        </button>
                        {showCollections && (
                          <AddToCollectionDropdown 
                            personIds={[personId]} 
                            onClose={() => setShowCollections(false)} 
                          />
                        )}
                      </div>
                      {person.email && (
                        <a
                          href={`mailto:${person.email}`}
                          className="px-5 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 font-medium rounded-lg transition-colors flex items-center space-x-2"
                        >
                          <Mail className="w-4 h-4" />
                          <span>Email</span>
                        </a>
                      )}
                      <button
                        onClick={() => window.print()}
                        className="px-5 py-2 bg-gray-50 hover:bg-gray-100 text-gray-600 font-medium rounded-lg transition-colors flex items-center space-x-2 border border-gray-200"
                      >
                        <Printer className="w-4 h-4" />
                        <span>Print</span>
                      </button>
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
                {saveError && (
                  <div className="mt-2 px-4 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-center justify-between">
                    <span>{saveError}</span>
                    <button onClick={() => setSaveError(null)} className="ml-2 text-red-500 hover:text-red-700"><X className="w-4 h-4" /></button>
                  </div>
                )}

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
              allFlemishConnections={allFlemishConnections}
              editSectorIds={editSectorIds}
              toggleEditSector={toggleEditSector}
              editFlemishConnections={editFlemishConnections}
              setEditFlemishConnections={setEditFlemishConnections}
              onCreateFlemishConnection={async (name, type) => {
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
                  setSaveError(error?.message || 'Failed to create Flemish connection');
                  return null;
                }

                const created = data as FlemishConnection;
                setAllFlemishConnections((prev) =>
                  reconcileConnections([...prev, created], [...prev, created])
                );
                return created;
              }}
            />
          ) : (
            <ViewBody
              person={person}
              personSectors={personSectors}
              connections={connections}
              onOpenGraph={() => setShowConnectionGraph(true)}
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

      {showConnectionGraph && (
        <ConnectionGraphModal
          person={person}
          connections={connections}
          onClose={() => setShowConnectionGraph(false)}
          onNavigate={onNavigate}
        />
      )}
    </div>
  );
}

const INPUT_CLS =
  'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:border-transparent';

function ViewHeader({ person, onNavigate }: { person: Person; onNavigate: (page: string, id?: string, preset?: FilterPreset) => void }) {
  const verifiedDate = person.last_verified_at ? new Date(person.last_verified_at).toLocaleDateString() : null;
  const sourceLabels: Record<string, string> = {
    manual: 'Added manually',
    csv_import: 'Added via CSV import',
    ai_agent: 'AI-discovered',
    self_reported: 'Self-reported',
  };

  return (
    <>
      <div className="flex items-center gap-3 mb-2">
        <h1 className="text-3xl font-semibold text-gray-900">{displayName(person)}</h1>
        {verifiedDate ? (
          <div className="flex items-center gap-1.5 px-2 py-1 bg-green-50 text-green-700 rounded-lg text-xs font-medium border border-green-100" title={`Verified on ${verifiedDate}`}>
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Verified</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 px-2 py-1 bg-gray-50 text-gray-500 rounded-lg text-xs font-medium border border-gray-100" title="Not yet verified by a human">
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>Unverified</span>
          </div>
        )}
      </div>
      
      {person.data_source && (
        <div className="flex items-center gap-1.5 text-gray-400 mb-4">
          <Database className="w-3.5 h-3.5" />
          <span className="text-[11px] font-medium uppercase tracking-wider">
            {sourceLabels[person.data_source] || person.data_source}
          </span>
        </div>
      )}

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
      {person.locations?.city && (
        <button
          onClick={() => onNavigate('dashboard', undefined, { focusCity: { city: person.locations?.city!, state: person.locations?.state || '' } })}
          className="flex items-center space-x-2 text-gray-600 hover:text-yellow-700 mb-1 transition-colors group"
        >
          <MapPin className="w-5 h-5" />
          <span className="group-hover:underline">{person.locations?.city}{person.locations?.state && `, ${person.locations?.state}`}</span>
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

function EditableAvatar({
  person,
  editForm,
  setField,
}: {
  person: Person;
  editForm: Partial<Person>;
  setField: (field: string, value: string) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);

  const previewPerson = {
    ...person,
    profile_photo_url: editForm.profile_photo_url || person.profile_photo_url,
    email: editForm.email || person.email,
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) return;
    if (file.size > 5 * 1024 * 1024) return; // 5MB limit

    setUploading(true);
    const ext = file.name.split('.').pop() || 'jpg';
    const path = `${person.id}/${Date.now()}.${ext}`;

    const { error } = await supabase.storage
      .from('profile-photos')
      .upload(path, file, { upsert: true });

    if (!error) {
      const { data: urlData } = supabase.storage
        .from('profile-photos')
        .getPublicUrl(path);
      setField('profile_photo_url', urlData.publicUrl);
    }
    setUploading(false);
  };

  const handleRemovePhoto = () => {
    setField('profile_photo_url', '');
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative group">
        <ProfileAvatar person={previewPerson} size="lg" />
        <label className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-full opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
          {uploading ? (
            <Loader2 className="w-6 h-6 text-white animate-spin" />
          ) : (
            <Camera className="w-6 h-6 text-white" />
          )}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileUpload}
            disabled={uploading}
          />
        </label>
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setShowUrlInput(!showUrlInput)}
          className="text-[10px] text-gray-400 hover:text-gray-600 flex items-center gap-0.5"
          title="Paste image URL"
        >
          <Link className="w-3 h-3" />
          URL
        </button>
        {(editForm.profile_photo_url || person.profile_photo_url) && (
          <button
            type="button"
            onClick={handleRemovePhoto}
            className="text-[10px] text-red-400 hover:text-red-600 flex items-center gap-0.5"
            title="Remove photo"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        )}
      </div>
      {showUrlInput && (
        <input
          type="url"
          placeholder="Paste image URL..."
          value={editForm.profile_photo_url || ''}
          onChange={(e) => setField('profile_photo_url', e.target.value)}
          className="w-28 text-[10px] px-2 py-1 border border-gray-200 rounded text-gray-600 focus:outline-none focus:ring-1 focus:ring-yellow-400"
        />
      )}
    </div>
  );
}

function EditHeader({
  editForm,
  setField,
  setEditForm,
  editLocationDisplay,
  setEditLocationDisplay,
}: {
  editForm: Partial<Person>;
  setField: (f: string, v: string) => void;
  setEditForm: React.Dispatch<React.SetStateAction<Partial<Person>>>;
  editLocationDisplay: string;
  setEditLocationDisplay: React.Dispatch<React.SetStateAction<string>>;
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
          <CitySearch
            value={editForm.location_id || ''}
            cityStateDisplay={editLocationDisplay}
            onChange={(id, city, state) => {
              setEditForm(f => ({ ...f, location_id: id }));
              setEditLocationDisplay(id ? `${city}, ${state}` : '');
            }}
            placeholder="Search city..."
          />
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
          <svg className="w-4 h-4 text-gray-400 flex-shrink-0 fill-current" viewBox="0 0 24 24">
            <title>Twitter (X)</title>
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
          </svg>
          <input
            value={editForm.twitter_url || ''}
            onChange={(e) => setField('twitter_url', e.target.value)}
            className={INPUT_CLS}
            placeholder="Twitter (X) URL"
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
          className="p-2 rounded-lg border border-gray-200 text-gray-500 hover:text-gray-900 hover:border-gray-900 transition-colors"
        >
          <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24" aria-hidden="true">
            <title>Twitter (X)</title>
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
          </svg>
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
  allFlemishConnections,
  editSectorIds,
  toggleEditSector,
  editFlemishConnections,
  setEditFlemishConnections,
  onCreateFlemishConnection,
}: {
  editForm: Partial<Person>;
  setField: (f: string, v: string) => void;
  allSectors: Sector[];
  allFlemishConnections: FlemishConnection[];
  editSectorIds: string[];
  toggleEditSector: (id: string) => void;
  editFlemishConnections: FlemishConnection[];
  setEditFlemishConnections: React.Dispatch<React.SetStateAction<FlemishConnection[]>>;
  onCreateFlemishConnection: (
    name: string,
    type: FlemishConnection['type']
  ) => Promise<FlemishConnection | null>;
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
        <FlemishConnectionSelector
          options={allFlemishConnections}
          value={editFlemishConnections}
          onChange={setEditFlemishConnections}
          onCreateOption={onCreateFlemishConnection}
          placeholder="Search universities, companies, government links..."
        />
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

function ViewBody({
  person,
  personSectors,
  connections,
  onOpenGraph,
  onNavigate,
}: {
  person: Person;
  personSectors: { id: string; name: string }[];
  connections: GraphConnection[];
  onOpenGraph: () => void;
  onNavigate: (page: string, id?: string, preset?: FilterPreset) => void;
}) {
  const connectionTypeCounts = connections.reduce<Record<string, number>>((counts, connection) => {
    connection.relationshipTypes.forEach((type) => {
      counts[type] = (counts[type] || 0) + 1;
    });
    return counts;
  }, {});
  const flemishConnections = getPersonFlemishConnections(person);

  return (
    <>
      {person.bio && (
        <div className="mb-8 pb-8 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900 mb-3">About</h2>
          <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">{person.bio}</p>
        </div>
      )}

      {flemishConnections.length > 0 && (
        <div className="mb-8 pb-8 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900 mb-3">Flemish Connection</h2>
          <div className="flex flex-wrap gap-2">
            {flemishConnections.map((connection) => (
              <button
                key={connection.id}
                onClick={() => onNavigate('dashboard', undefined, { flemishConnections: [connection.name] })}
                className="px-4 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer hover:ring-2 bg-blue-50 text-blue-700 hover:ring-blue-300"
              >
                {connection.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mb-8 pb-8 border-b border-gray-200">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Sectors</h2>
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
          <button
            onClick={onOpenGraph}
            disabled={connections.length === 0}
            className="text-yellow-600 hover:text-yellow-700 disabled:text-gray-300 disabled:cursor-not-allowed font-medium text-sm flex items-center space-x-1 transition-colors"
          >
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
        {connections.length > 0 ? (
          <>
            <div className="mt-4 flex flex-wrap gap-2">
              {Object.entries(connectionTypeCounts)
                .sort((a, b) => b[1] - a[1])
                .map(([type, count]) => (
                  <span
                    key={type}
                    className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-700"
                  >
                    {formatRelationshipType(type)}: {count}
                  </span>
                ))}
            </div>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {connections.slice(0, 4).map((connection) => (
                <button
                  key={connection.person.id}
                  onClick={() => onNavigate('person', connection.person.id)}
                  className="rounded-xl border border-gray-100 bg-white p-4 text-left transition-all hover:border-yellow-200 hover:bg-yellow-50/40"
                >
                  <div className="flex items-start gap-3">
                    <ProfileAvatar person={connection.person} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-gray-900 truncate">
                        {displayName(connection.person)}
                      </div>
                      {connection.person.current_position && (
                        <div className="mt-1 text-sm text-gray-600 line-clamp-2">
                          {connection.person.current_position}
                        </div>
                      )}
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {connection.relationshipTypes.map((type) => (
                          <span
                            key={`${connection.person.id}-${type}`}
                            className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-700"
                          >
                            {formatRelationshipType(type)}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </>
        ) : (
          <p className="mt-4 text-sm text-gray-400">
            No direct connections yet. Run the Connections agent from Admin to generate them.
          </p>
        )}
      </div>
    </>
  );
}
