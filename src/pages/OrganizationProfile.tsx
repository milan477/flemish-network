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
  Library,
  ShieldCheck,
} from 'lucide-react';
import {
  supabase,
  displayName,
  type Organization,
  type Person,
  type Sector,
  type FilterPreset,
  type FlemishConnection,
} from '../lib/supabase';
import CitySearch from '../components/CitySearch';
import AddToCollectionDropdown from '../components/AddToCollectionDropdown';
import { ProfileAvatar } from '../components/ProfileAvatar';
import FlemishConnectionSelector from '../components/FlemishConnectionSelector';
import {
  canonicalizeFlemishConnection,
  flattenOrganizationFlemishConnections,
  type OrganizationFlemishConnectionLink,
} from '../lib/flemishConnections';
import { kickEmbeddingWorker } from '../lib/embeddingRefresh';
import { getLastDashboardLocation } from '../lib/dashboardSession';
import { useSmartBack } from '../lib/useSmartBack';
import { useAuth } from '../lib/auth';
import { organizationUsLocationLabel } from '../lib/networkScope';

interface OrganizationProfileProps {
  organizationId: string;
  onNavigate: (page: string, id?: string, preset?: FilterPreset) => void;
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

function organizationFlemishLinks(
  organization: Organization | null
): OrganizationFlemishConnectionLink[] {
  return organization?.organization_flemish_connections || [];
}

function formatConfidence(confidence: number | null | undefined): string | null {
  if (confidence === null || confidence === undefined) return null;
  return `${Math.round(confidence * 100)}% confidence`;
}

const SECTOR_COLORS: Record<string, { bg: string; text: string; ring: string }> = {
  'Artificial Intelligence': { bg: 'bg-blue-50', text: 'text-blue-700', ring: 'hover:ring-blue-300' },
  Biotechnology: { bg: 'bg-green-50', text: 'text-green-700', ring: 'hover:ring-green-300' },
  Finance: { bg: 'bg-amber-50', text: 'text-amber-700', ring: 'hover:ring-amber-300' },
  Education: { bg: 'bg-yellow-50', text: 'text-yellow-700', ring: 'hover:ring-yellow-300' },
  'Culture & Arts': { bg: 'bg-pink-50', text: 'text-pink-700', ring: 'hover:ring-pink-300' },
  Research: { bg: 'bg-cyan-50', text: 'text-cyan-700', ring: 'hover:ring-cyan-300' },
};

export default function OrganizationProfile({ organizationId, onNavigate }: OrganizationProfileProps) {
  const { canEdit } = useAuth();
  const goBack = useSmartBack(() => getLastDashboardLocation() || '/');
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [peopleCount, setPeopleCount] = useState(0);
  const [showAllPeople, setShowAllPeople] = useState(false);
  const [orgSectors, setOrgSectors] = useState<{ id: string; name: string }[]>([]);
  const [allSectors, setAllSectors] = useState<Sector[]>([]);
  const [allFlemishConnections, setAllFlemishConnections] = useState<FlemishConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Organization>>({});
  const [editSectorIds, setEditSectorIds] = useState<string[]>([]);
  const [editFlemishConnections, setEditFlemishConnections] = useState<FlemishConnection[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showCollections, setShowCollections] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{ count: number; status: string } | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const loadOrganization = useCallback(async () => {
    const [orgRes, sectorsRes, allSectorsRes, flemishRes] = await Promise.all([
      supabase
        .from('organizations')
        .select('*, locations(*), organization_us_locations(*, locations(*)), organization_flemish_connections(flemish_connection_id, role, confidence, source_url, evidence_excerpt, flemish_connections(id, name, type, entity_type, is_filterable))')
        .eq('id', organizationId)
        .maybeSingle(),
      supabase.from('organization_sectors').select('sector_id, sectors(name)').eq('organization_id', organizationId),
      supabase.from('sectors').select('*'),
      supabase.from('flemish_connections').select('id, name, type, entity_type, is_filterable').order('name'),
    ]);

    const orgData = orgRes.data;
    setOrganization(orgData);
    setAllSectors((allSectorsRes.data || []) as Sector[]);
    setAllFlemishConnections((flemishRes.data || []) as FlemishConnection[]);

    const os = ((sectorsRes.data || []) as unknown as OrganizationSector[])
      .filter((r) => r.sectors?.name)
      .map((r) => ({ id: r.sector_id, name: r.sectors!.name }));
    setOrgSectors(os);

    if (orgData) {
      setEditFlemishConnections(
        reconcileConnections(
          flattenOrganizationFlemishConnections(
            (orgData as Organization).organization_flemish_connections
          ),
          (flemishRes.data || []) as FlemishConnection[]
        )
      );
    }

    setLoading(false);
  }, [organizationId]);

  const loadPeople = useCallback(async () => {
    let query = supabase
      .from('people')
      .select('*, locations(*), person_us_connections(*, locations(*))', {
        count: 'exact',
      })
      .eq('organization_id', organizationId)
      .order('name');

    if (!showAllPeople) {
      query = query.limit(6);
    }

    const { data, count } = await query;

    setPeople(data || []);
    setPeopleCount(count || 0);
  }, [organizationId, showAllPeople]);

  useEffect(() => {
    setShowAllPeople(false);
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
      location_id: organization.location_id || '',
    });
    setEditSectorIds(orgSectors.map((s) => s.id));
    setEditFlemishConnections(
      reconcileConnections(
        flattenOrganizationFlemishConnections(organization.organization_flemish_connections),
        allFlemishConnections
      )
    );
    setShowCollections(false);
    setEditing(true);
  };

  const cancelEditing = () => {
    setEditing(false);
    setEditForm({});
    setEditSectorIds([]);
    setEditFlemishConnections([]);
  };

  const handleVerify = useCallback(async () => {
    if (!organization) return;
    setVerifying(true);
    setVerifyResult(null);
    setVerifyError(null);
    try {
      const { data, error } = await supabase.functions.invoke('agent-verify', {
        body: {
          mode: 'preview',
          record_type: 'organization',
          record_id: organization.id,
        },
      });
      if (error) throw error;
      setVerifyResult({
        count: typeof data?.suggestions_count === 'number' ? data.suggestions_count : 0,
        status: typeof data?.status === 'string' ? data.status : 'unknown',
      });
    } catch (err) {
      setVerifyError(err instanceof Error ? err.message : 'Verification failed');
    }
    setVerifying(false);
  }, [organization]);

  const saveEdits = async () => {
    if (!organization) return;
    setSaving(true);

    const website = ensureProtocol(editForm.website_url || '');

    const updatePayload = {
      name: editForm.name,
      type: editForm.type,
      description: editForm.description || null,
      website_url: website || null,
      location_id: editForm.location_id || null,
      updated_at: new Date().toISOString(),
    };

    const { data: updatedOrg, error: updateErr } = await supabase
      .from('organizations')
      .update(updatePayload)
                      .eq('id', organization.id)
      .select('*, locations(*), organization_us_locations(*, locations(*)), organization_flemish_connections(flemish_connection_id, role, confidence, source_url, evidence_excerpt, flemish_connections(id, name, type, entity_type, is_filterable))')
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
          if (normalizeConnectionName(connection.name) !== normalizeConnectionName(existing.name)) {
            await supabase.rpc('add_flemish_connection_alias', {
              p_connection_name: existing.name,
              p_alias: connection.name,
              p_source: 'staff',
              p_status: 'approved',
              p_confidence: 1,
              p_source_url: null,
              p_evidence_excerpt: null,
            });
          }
          ensuredConnections.push(existing);
          continue;
        }

        const { data: inserted, error: insertConnectionError } = await supabase
          .from('flemish_connections')
          .insert({
            name: canonical.name,
            type: canonical.type,
            entity_type: canonical.type,
            is_filterable: canonical.is_filterable ?? false,
            connection_group: canonical.connection_group ?? null,
          })
          .select('id, name, type, entity_type, is_filterable')
          .maybeSingle();

        if (insertConnectionError) throw insertConnectionError;
        if (inserted) {
          if (normalizeConnectionName(connection.name) !== normalizeConnectionName((inserted as FlemishConnection).name)) {
            await supabase.rpc('add_flemish_connection_alias', {
              p_connection_name: (inserted as FlemishConnection).name,
              p_alias: connection.name,
              p_source: 'staff',
              p_status: 'approved',
              p_confidence: 1,
              p_source_url: null,
              p_evidence_excerpt: null,
            });
          }
          ensuredConnections.push(inserted as FlemishConnection);
        }
      }

      const nextFlemishIds = ensuredConnections.map((connection) => connection.id);
      const existingLinks = organization.organization_flemish_connections || [];
      const existingFlemishIds = existingLinks
        .map((link) => link.flemish_connection_id)
        .filter((id): id is string => Boolean(id));
      const removeFlemishIds = existingFlemishIds.filter((id) => !nextFlemishIds.includes(id));

      if (removeFlemishIds.length > 0) {
        const { error: deleteFlemishError } = await supabase
          .from('organization_flemish_connections')
          .delete()
          .eq('organization_id', organization.id)
          .in('flemish_connection_id', removeFlemishIds);
        if (deleteFlemishError) throw deleteFlemishError;
      }

      if (ensuredConnections.length > 0) {
        const { error: upsertFlemishError } = await supabase
          .from('organization_flemish_connections')
          .upsert(
            ensuredConnections.map((connection) => {
              const existingLink = existingLinks.find(
                (link) => link.flemish_connection_id === connection.id
              );
              return {
                organization_id: organization.id,
                flemish_connection_id: connection.id,
                role: existingLink?.role || 'profile_fact',
                confidence: existingLink?.confidence ?? 1,
                source_url: existingLink?.source_url || null,
                evidence_excerpt: existingLink?.evidence_excerpt || null,
              };
            }),
            { onConflict: 'organization_id,flemish_connection_id' }
          );
        if (upsertFlemishError) throw upsertFlemishError;
      }

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

      setAllFlemishConnections((prev) =>
        reconcileConnections([...prev, ...ensuredConnections], [...prev, ...ensuredConnections])
      );
      await loadOrganization();
      setEditing(false);
      kickEmbeddingWorker({
        entityType: 'organization',
        organizationIds: [organization.id],
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setSaveError(`Organization info saved, but error updating related facts: ${message}`);
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
          onClick={goBack}
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
        onClick={goBack}
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
                      <button
                        onClick={() =>
                          onNavigate('dashboard', undefined, {
                            focusCity: {
                              city: organization.locations?.city || '',
                              state: organization.locations?.state || '',
                            },
                          })
                        }
                        className="group flex items-center space-x-2 text-gray-600 hover:text-yellow-700 transition-colors"
                      >
                        <MapPin className="w-5 h-5 text-gray-400" />
                        <span className="group-hover:underline">
                          {organization.locations?.city}, {organization.locations?.state}
                        </span>
                      </button>
                    )}
                    {organization.organization_us_locations &&
                      organization.organization_us_locations.length > 0 && (
                        <div className="w-full flex flex-wrap gap-2 mt-1">
                          {organization.organization_us_locations.map((location) => (
                            <button
                              key={location.id || `${location.location_id}-${location.location_role}`}
                              onClick={() =>
                                location.locations?.city &&
                                onNavigate('dashboard', undefined, {
                                  focusCity: {
                                    city: location.locations.city,
                                    state: location.locations.state,
                                  },
                                })
                              }
                              className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-1.5 text-left text-xs text-emerald-800 hover:border-emerald-200"
                            >
                              <span className="font-semibold">
                                {organizationUsLocationLabel(location)}
                              </span>
                              {location.locations?.city && (
                                <span>
                                  {' '}
                                  · {location.locations.city}, {location.locations.state}
                                </span>
                              )}
                            </button>
                          ))}
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
                  {orgSectors.map((s) => {
                    const colors = SECTOR_COLORS[s.name] || {
                      bg: 'bg-gray-50',
                      text: 'text-gray-700',
                      ring: 'hover:ring-gray-300',
                    };

                    return (
                      <button
                        key={s.id}
                        onClick={() => onNavigate('dashboard', undefined, { sector: s.name })}
                        className={`px-3 py-1 ${colors.bg} ${colors.text} rounded-full text-sm font-medium transition-all hover:ring-2 ${colors.ring}`}
                      >
                        {s.name}
                      </button>
                    );
                  })}
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
                    {canEdit && (
                      <>
                        <button
                          onClick={startEditing}
                          className="px-6 py-2 bg-yellow-400 hover:bg-yellow-500 text-gray-900 font-medium rounded-lg transition-colors flex items-center space-x-2"
                        >
                          <Pencil className="w-4 h-4" />
                          <span>Edit Organization</span>
                        </button>
                        <div className="relative">
                          <button
                            onClick={() => setShowCollections(!showCollections)}
                            className={`px-6 py-2 font-medium rounded-lg transition-colors flex items-center space-x-2 ${
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
                              organizationIds={[organization.id]}
                              onClose={() => setShowCollections(false)}
                            />
                          )}
                        </div>
                      </>
                    )}
                    <div className="flex flex-col">
                      <button
                        onClick={handleVerify}
                        disabled={verifying}
                        className="px-6 py-2 bg-teal-50 text-teal-700 hover:bg-teal-100 font-medium rounded-lg transition-colors flex items-center space-x-2 disabled:opacity-50"
                      >
                        {verifying ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <ShieldCheck className="w-4 h-4" />
                        )}
                        <span>Verify</span>
                      </button>
                      {verifyResult && (
                        <span className="mt-1 text-xs text-gray-500">
                          {verifyResult.count > 0
                            ? `${verifyResult.count} suggestion${verifyResult.count === 1 ? '' : 's'} found`
                            : 'Looks current'}
                        </span>
                      )}
                      {verifyError && (
                        <span className="mt-1 text-xs text-red-500">{verifyError}</span>
                      )}
                    </div>
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

            {!editing &&
              organization.organization_us_locations &&
              organization.organization_us_locations.length > 0 && (
                <div className="pb-8 border-b border-gray-200">
                  <h2 className="text-lg font-semibold text-gray-900 mb-3">
                    US Locations
                  </h2>
                  <div className="space-y-3">
                    {organization.organization_us_locations.map((location) => (
                      <div
                        key={location.id || `${location.location_id}-${location.location_role}`}
                        className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-gray-900">
                              {organizationUsLocationLabel(location)}
                              {location.is_primary ? ' · Primary' : ''}
                            </p>
                            {location.locations?.city && (
                              <p className="text-xs text-gray-500 mt-0.5">
                                {location.locations.city}, {location.locations.state}
                              </p>
                            )}
                          </div>
                          <span className="rounded-full bg-white px-2 py-1 text-[11px] font-medium text-gray-500 border border-gray-200">
                            {location.location_role.replace(/_/g, ' ')}
                          </span>
                        </div>
                        {location.description && (
                          <p className="text-sm text-gray-600 mt-2">
                            {location.description}
                          </p>
                        )}
                        {location.evidence_excerpt && (
                          <p className="text-xs text-gray-500 mt-2 italic">
                            {location.evidence_excerpt}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

            <div className={`pb-8 ${editing ? '' : 'border-b border-gray-200'}`}>
              <h2 className="text-lg font-semibold text-gray-900 mb-3">Flemish Connection</h2>
              {editing ? (
                <FlemishConnectionSelector
                  options={allFlemishConnections}
                  value={editFlemishConnections}
                  onChange={setEditFlemishConnections}
                  placeholder="Search canonical Flemish facts..."
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
                    if (existing) {
                      if (normalizeConnectionName(name) !== normalizeConnectionName(existing.name)) {
                        await supabase.rpc('add_flemish_connection_alias', {
                          p_connection_name: existing.name,
                          p_alias: name,
                          p_source: 'staff',
                          p_status: 'approved',
                          p_confidence: 1,
                          p_source_url: null,
                          p_evidence_excerpt: null,
                        });
                      }
                      return existing;
                    }

                    const { data, error } = await supabase
                      .from('flemish_connections')
                      .insert({
                        name: canonical.name,
                        type: canonical.type,
                        entity_type: canonical.type,
                        is_filterable: canonical.is_filterable ?? false,
                        connection_group: canonical.connection_group ?? null,
                      })
                      .select('id, name, type, entity_type, is_filterable')
                      .maybeSingle();

                    if (error || !data) {
                      setSaveError(error?.message || 'Failed to create Flemish connection');
                      return null;
                    }

                    const created = data as FlemishConnection;
                    if (normalizeConnectionName(name) !== normalizeConnectionName(created.name)) {
                      await supabase.rpc('add_flemish_connection_alias', {
                        p_connection_name: created.name,
                        p_alias: name,
                        p_source: 'staff',
                        p_status: 'approved',
                        p_confidence: 1,
                        p_source_url: null,
                        p_evidence_excerpt: null,
                      });
                    }
                    setAllFlemishConnections((prev) =>
                      reconcileConnections([...prev, created], [...prev, created])
                    );
                    return created;
                  }}
                />
              ) : (
                organizationFlemishLinks(organization).length > 0 ? (
                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                      {organizationFlemishLinks(organization).map((link, idx) => {
                        const connection = Array.isArray(link.flemish_connections)
                          ? link.flemish_connections[0]
                          : link.flemish_connections;
                        if (!connection?.name) return null;
                      return (
                        <button
                          key={`${connection.id || connection.name}-${idx}`}
                          onClick={() =>
                            onNavigate('dashboard', undefined, {
                              flemishConnections: [connection.name],
                            })
                          }
                          className="px-4 py-2 rounded-lg text-sm font-medium transition-all hover:ring-2 bg-blue-50 text-blue-700 hover:ring-blue-300"
                        >
                          {connection.name}
                        </button>
                      );
                      })}
                    </div>
                    <div className="space-y-2">
                      {organizationFlemishLinks(organization).map((link, idx) => {
                        const connection = Array.isArray(link.flemish_connections)
                          ? link.flemish_connections[0]
                          : link.flemish_connections;
                        if (!connection?.name) return null;
                        return (
                          <div
                            key={`${connection.id || connection.name}-evidence-${idx}`}
                            className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium text-gray-800">{connection.name}</span>
                              {link.role && (
                                <span className="rounded-full bg-white px-2 py-0.5 text-xs text-gray-500 border border-gray-200">
                                  {link.role.replace(/_/g, ' ')}
                                </span>
                              )}
                              {formatConfidence(link.confidence) && (
                                <span className="text-xs text-gray-500">
                                  {formatConfidence(link.confidence)}
                                </span>
                              )}
                            </div>
                            {link.evidence_excerpt && (
                              <p className="mt-1 text-xs text-gray-500">{link.evidence_excerpt}</p>
                            )}
                            {link.source_url && (
                              <a
                                href={link.source_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
                              >
                                <ExternalLink className="h-3 w-3" />
                                Source
                              </a>
                            )}
                          </div>
                        );
                      })}
                    </div>
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
              {peopleCount > 6 && (
                <button
                  type="button"
                  onClick={() => setShowAllPeople((value) => !value)}
                  className="text-yellow-600 hover:text-yellow-700 font-medium text-sm"
                >
                  {showAllPeople ? 'Show fewer contacts' : `See all ${peopleCount} contacts`}
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
                      <ProfileAvatar person={person} size="md" />
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
