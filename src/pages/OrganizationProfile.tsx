import { useEffect, useState, useCallback } from 'react';
import {
  MapPin,
  Building2,
  ArrowLeft,
  Users,
  ExternalLink,
  Pencil,
  Save,
  X,
  Loader2,
  ChevronDown,
  Globe,
  Plus,
} from 'lucide-react';
import { supabase, displayName, personInitials, FLEMISH_OPTIONS, type Organization, type Person, type Sector } from '../lib/supabase';
import CitySearch from '../components/CitySearch';

interface OrganizationProfileProps {
  organizationId: string;
  onNavigate: (page: string, id?: string) => void;
}

interface OrganizationSector {
  sector_id: string;
  sectors: { name: string } | null;
}

function ensureProtocol(url: string): string {
  if (!url || !url.trim()) return '';
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed) && trimmed.includes('.')) {
    return `https://${trimmed}`;
  }
  return trimmed;
}

export default function OrganizationProfile({ organizationId, onNavigate }: OrganizationProfileProps) {
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [orgSectors, setOrgSectors] = useState<{ id: string; name: string }[]>([]);
  const [allSectors, setAllSectors] = useState<Sector[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Organization>>({});
  const [editSectorIds, setEditSectorIds] = useState<string[]>([]);
  const [editFlemishConnections, setEditFlemishConnections] = useState<string[]>([]);
  const [customFlemish, setCustomFlemish] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const loadOrganization = useCallback(async () => {
    const [orgRes, sectorsRes, allSectorsRes] = await Promise.all([
      supabase.from('organizations').select('*, locations(*)').eq('id', organizationId).maybeSingle(),
      supabase.from('organization_sectors').select('sector_id, sectors(name)').eq('organization_id', organizationId),
      supabase.from('sectors').select('*'),
    ]);

    const orgData = orgRes.data;
    setOrganization(orgData);
    setAllSectors((allSectorsRes.data || []) as Sector[]);

    const os = ((sectorsRes.data || []) as unknown as OrganizationSector[])
      .filter((r) => r.sectors?.name)
      .map((r) => ({ id: r.sector_id, name: r.sectors!.name }));
    setOrgSectors(os);

    if (orgData) {
      const flemish = orgData.flemish_link
        ? orgData.flemish_link.split(',').map((s: string) => s.trim()).filter(Boolean)
        : [];
      setEditFlemishConnections(flemish);
    }

    setLoading(false);
  }, [organizationId]);

  const loadPeople = useCallback(async () => {
    const { data } = await supabase
      .from('people').select('*, locations(*)')
      .eq('organization_id', organizationId)
      .limit(6);

    setPeople(data || []);
  }, [organizationId]);

  useEffect(() => {
    loadOrganization();
    loadPeople();
  }, [loadOrganization, loadPeople, organizationId]);

  const startEditing = () => {
    if (!organization) return;
    setEditForm({
      name: organization.name,
      type: organization.type,
      description: organization.description || '',
      website_url: organization.website_url || '',
      flemish_link: organization.flemish_link || '',
      location_id: organization.location_id || '',
    });
    setEditSectorIds(orgSectors.map((s) => s.id));
    const flemish = organization.flemish_link
      ? organization.flemish_link.split(',').map((s: string) => s.trim()).filter(Boolean)
      : [];
    setEditFlemishConnections(flemish);
    setEditing(true);
  };

  const cancelEditing = () => {
    setEditing(false);
    setEditForm({});
    setEditSectorIds([]);
    setEditFlemishConnections([]);
    setCustomFlemish('');
  };

  const saveEdits = async () => {
    if (!organization) return;
    setSaving(true);

    const flemishStr = editFlemishConnections.join(', ');
    const website = ensureProtocol(editForm.website_url || '');

    const updatePayload = {
      name: editForm.name,
      type: editForm.type,
      description: editForm.description || null,
      website_url: website || null,
      flemish_link: flemishStr || null,
      location_id: editForm.location_id || null,
      updated_at: new Date().toISOString(),
    };

    const { data: updatedOrg, error: updateErr } = await supabase
      .from('organizations')
      .update(updatePayload)
      .eq('id', organization.id)
      .select('*, locations(*)')
      .maybeSingle();

    if (updateErr) {
      setSaveError(`Error saving: ${updateErr.message}`);
      setSaving(false);
      return;
    }

    if (!updatedOrg) {
      setSaveError('The update was not applied. You might not have permission to edit this organization.');
      setSaving(false);
      return;
    }
    setSaveError(null);

    setOrganization(updatedOrg as Organization);

    const currentIds = orgSectors.map((s) => s.id);
    const toRemove = currentIds.filter((id) => !editSectorIds.includes(id));
    const toAdd = editSectorIds.filter((id) => !currentIds.includes(id));

    try {
      if (toRemove.length > 0) {
        for (const sid of toRemove) {
          await supabase
            .from('organization_sectors')
            .delete()
            .eq('organization_id', organization.id)
            .eq('sector_id', sid);
        }
      }

      if (toAdd.length > 0) {
        const { error: insertErr } = await supabase
          .from('organization_sectors')
          .insert(toAdd.map((sid) => ({ organization_id: organization.id, sector_id: sid })));
        if (insertErr) throw insertErr;
      }

      await loadOrganization();
      setEditing(false);
    } catch (err: any) {
      setSaveError(`Organization info saved, but error updating sectors: ${err.message}`);
      await loadOrganization();
      setEditing(false);
    }
    setSaving(false);
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

  const handleAddCustomFlemish = (e: React.KeyboardEvent | React.MouseEvent) => {
    if ('key' in e && e.key !== 'Enter') return;
    e.preventDefault();
    const val = customFlemish.trim();
    if (val && !editFlemishConnections.includes(val)) {
      toggleEditFlemish(val);
      setCustomFlemish('');
    }
  };

  const setField = (field: string, value: string) => {
    setEditForm((f) => ({ ...f, [field]: value }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-64px)]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-yellow-600"></div>
      </div>
    );
  }

  if (!organization) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center">
        <h2 className="text-2xl font-semibold text-gray-900 mb-4">Organization not found</h2>
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
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Back to directory</span>
      </button>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-8">
          <div className="flex items-start space-x-6 mb-8">
            <div className="w-24 h-24 rounded-xl bg-gradient-to-br from-green-100 to-green-200 flex items-center justify-center flex-shrink-0">
              <Building2 className="w-12 h-12 text-green-700" />
            </div>
            <div className="flex-1">
              {editing ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <input
                      value={editForm.name || ''}
                      onChange={(e) => setField('name', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:border-transparent"
                      placeholder="Organization Name"
                    />
                    <div className="relative">
                      <select
                        value={editForm.type || ''}
                        onChange={(e) => setField('type', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-lg focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:border-transparent appearance-none pr-10"
                      >
                        <option value="Company">Company</option>
                        <option value="University">University</option>
                        <option value="Research Institute">Research Institute</option>
                        <option value="Non-Profit">Non-Profit</option>
                        <option value="Government">Government</option>
                        <option value="Other">Other</option>
                      </select>
                      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none" />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="flex items-center space-x-2">
                      <MapPin className="w-5 h-5 text-gray-400 flex-shrink-0" />
                      <CitySearch
                        value={editForm.location_id || ''}
                        cityStateDisplay={organization.locations ? `${organization.locations.city}, ${organization.locations.state}` : ''}
                        onChange={(id) => setField('location_id', id)}
                        placeholder="Search city..."
                      />
                    </div>
                    <div className="flex items-center space-x-2">
                      <Globe className="w-5 h-5 text-gray-400 flex-shrink-0" />
                      <input
                        value={editForm.website_url || ''}
                        onChange={(e) => setField('website_url', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:border-transparent"
                        placeholder="Website URL"
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <h1 className="text-3xl font-semibold text-gray-900 mb-2">{organization.name}</h1>
                  <p className="text-lg text-gray-600 mb-2">{organization.type}</p>
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mb-4">
                    {organization.locations?.city && (
                      <div className="flex items-center space-x-2 text-gray-600">
                        <MapPin className="w-5 h-5 text-gray-400" />
                        <span>{organization.locations?.city}, {organization.locations?.state}</span>
                      </div>
                    )}
                    {organization.website_url && (
                      <a
                        href={organization.website_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center space-x-2 text-blue-600 hover:text-blue-700 transition-colors"
                      >
                        <Globe className="w-5 h-5 text-blue-500" />
                        <span className="text-sm font-medium">{organization.website_url.replace(/^https?:\/\//, '')}</span>
                      </a>
                    )}
                  </div>
                </>
              )}
              
              {!editing && orgSectors.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-4">
                  {orgSectors.map((s) => (
                    <span
                      key={s.id}
                      className="px-3 py-1 bg-blue-50 text-blue-700 rounded-full text-sm font-medium"
                    >
                      {s.name}
                    </span>
                  ))}
                </div>
              )}
              
              <div className="flex flex-wrap gap-3 mt-6">
                {editing ? (
                  <>
                    <button
                      onClick={saveEdits}
                      disabled={saving}
                      className="px-6 py-2 bg-green-500 hover:bg-green-600 text-white font-medium rounded-lg transition-colors flex items-center space-x-2 disabled:opacity-50"
                    >
                      {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                      <span>Save Changes</span>
                    </button>
                    <button
                      onClick={cancelEditing}
                      className="px-6 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-lg transition-colors flex items-center space-x-2"
                    >
                      <X className="w-4 h-4" />
                      <span>Cancel</span>
                    </button>
                  </>
                ) : (
                  <>
                    {saveError && (
                      <div className="px-4 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-center justify-between">
                        <span>{saveError}</span>
                        <button onClick={() => setSaveError(null)} className="ml-2 text-red-500 hover:text-red-700"><X className="w-4 h-4" /></button>
                      </div>
                    )}
                    <button
                      onClick={startEditing}
                      className="px-6 py-2 bg-yellow-400 hover:bg-yellow-500 text-gray-900 font-medium rounded-lg transition-colors flex items-center space-x-2"
                    >
                      <Pencil className="w-4 h-4" />
                      <span>Edit Organization</span>
                    </button>
                    {organization.website_url && (
                      <a
                        href={organization.website_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-6 py-2 bg-yellow-50 text-yellow-700 hover:bg-yellow-100 font-medium rounded-lg transition-colors flex items-center space-x-2"
                      >
                        <ExternalLink className="w-4 h-4" />
                        <span>Visit Website</span>
                      </a>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-8">
            <div className={`pb-8 ${editing ? '' : 'border-b border-gray-200'}`}>
              <h2 className="text-lg font-semibold text-gray-900 mb-3">About</h2>
              {editing ? (
                <textarea
                  value={editForm.description || ''}
                  onChange={(e) => setField('description', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:border-transparent resize-none"
                  rows={4}
                  placeholder="Organization description..."
                />
              ) : (
                organization.description ? (
                  <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">{organization.description}</p>
                ) : (
                  <p className="text-gray-400 italic">No description provided</p>
                )
              )}
            </div>

            <div className={`pb-8 ${editing ? '' : 'border-b border-gray-200'}`}>
              <h2 className="text-lg font-semibold text-gray-900 mb-3">Flemish Connection</h2>
              {editing ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap gap-2 mb-3">
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
                    {editFlemishConnections.filter(opt => !FLEMISH_OPTIONS.includes(opt)).map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => toggleEditFlemish(opt)}
                        className="text-sm px-4 py-1.5 rounded-full font-medium transition-colors bg-amber-100 text-amber-700 ring-1 ring-amber-300 flex items-center space-x-1"
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
                      className="flex-1 px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
                    />
                    <button
                      type="button"
                      onClick={handleAddCustomFlemish}
                      className="p-1.5 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ) : (
                organization.flemish_link ? (
                  <div className="flex flex-wrap gap-2">
                    {organization.flemish_link.split(',').map(s => s.trim()).filter(Boolean).map((m, idx) => {
                      const isStandard = FLEMISH_OPTIONS.includes(m);
                      return (
                        <span
                          key={`${m}-${idx}`}
                          className={`px-4 py-2 rounded-lg text-sm font-medium ${
                            isStandard 
                              ? 'bg-blue-50 text-blue-700' 
                              : 'bg-amber-50 text-amber-700 border border-amber-100'
                          }`}
                        >
                          {m}
                        </span>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-gray-400 italic">No Flemish connection info provided</p>
                )
              )}
            </div>

            {editing && (
              <div className="pb-8">
                <h2 className="text-lg font-semibold text-gray-900 mb-3">Sectors</h2>
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
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center space-x-2">
                <Users className="w-5 h-5 text-gray-600" />
                <h2 className="text-lg font-semibold text-gray-900">Key Contacts</h2>
              </div>
              {people.length > 6 && (
                <button className="text-yellow-600 hover:text-yellow-700 font-medium text-sm">
                  See all {people.length} contacts
                </button>
              )}
            </div>

            {people.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {people.map((person) => (
                  <button
                    key={person.id}
                    onClick={() => onNavigate('person', person.id)}
                    className="bg-gray-50 rounded-xl p-4 hover:bg-gray-100 transition-colors text-left border border-gray-200"
                  >
                    <div className="flex items-start space-x-3">
                      <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-100 to-blue-200 flex items-center justify-center flex-shrink-0">
                        <span className="text-lg font-semibold text-blue-700">
                          {personInitials(person)}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium text-gray-900 mb-1">{displayName(person)}</h3>
                        {person.current_position && (
                          <p className="text-sm text-gray-600 line-clamp-2">{person.current_position}</p>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 bg-gray-50 rounded-xl">
                <Users className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                <p className="text-gray-600">No contacts found</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
