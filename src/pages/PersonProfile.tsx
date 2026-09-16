import { useEffect, useState, useCallback } from 'react';
import {
  MapPin,
  Briefcase,
  ArrowLeft,
  Linkedin,
  Globe,
  Mail,
  Pencil,
  Save,
  X,
  RotateCw,
  Earth,
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
  ExternalLink,
  GraduationCap,
  History,
  UserCheck,
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
import { kickEmbeddingWorker } from '../lib/embeddingRefresh';
import ProfileUpdateModal from '../components/ProfileUpdateModal';
import CitySearch from '../components/CitySearch';
import AddToCollectionDropdown from '../components/AddToCollectionDropdown';
import { ProfileAvatar } from '../components/ProfileAvatar';
import LoadingGlobe from '../components/LoadingGlobe';
import FlemishConnectionSelector from '../components/FlemishConnectionSelector';
import FlemishConnectionList from '../components/FlemishConnectionList';
import { getLastDashboardLocation } from '../lib/dashboardSession';
import { useSmartBack } from '../lib/useSmartBack';
import { useAuth } from '../lib/auth';
import {
  currentAbroadBaseLabel,
  isUsConnectedAbroad,
} from '../lib/networkScope';

interface PersonProfileProps {
  personId: string;
  onNavigate: (page: string, id?: string, preset?: FilterPreset) => void;
}

interface PersonSector {
  sector_id: string;
  sectors: { name: string } | null;
}

interface ProfileSourceRecord {
  id: string;
  person_id: string;
  field_name: string;
  field_value: string | null;
  is_current: boolean;
  source_type: string;
  source_label: string;
  source_url: string | null;
  evidence_excerpt: string | null;
  verification_status: 'unverified' | 'sourced' | 'verified' | 'rejected';
  verified_at: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
}

interface ContactDetailRecord {
  id: string;
  contact_type: 'email' | 'linkedin' | 'website' | 'twitter' | 'other';
  contact_value: string;
  verification_status: 'unverified' | 'sourced' | 'verified' | 'rejected';
  verification_method: string | null;
  verified_at: string | null;
  source_label: string;
  source_url: string | null;
  evidence_excerpt: string | null;
}

interface PersonExperienceRecord {
  id: string;
  experience_type: 'education' | 'occupation';
  title: string;
  organization_name: string | null;
  location_city: string | null;
  location_state: string | null;
  location_country: string | null;
  start_date: string | null;
  end_date: string | null;
  is_current: boolean | null;
  source_label: string;
  source_url: string | null;
  evidence_excerpt: string | null;
  verification_status: 'unverified' | 'sourced' | 'verified' | 'rejected';
  verified_at: string | null;
}

interface PersonTagRecord {
  id: string;
  tag: string;
  source_label: string;
  source_url: string | null;
  evidence_excerpt: string | null;
  verification_status: 'unverified' | 'sourced' | 'verified' | 'rejected';
}

const PROFILE_ACTION_BUTTON =
  'inline-flex h-9 items-center justify-center gap-2 rounded-lg border px-3.5 text-sm font-medium transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50';
const PROFILE_ACTION_PRIMARY =
  `${PROFILE_ACTION_BUTTON} border-yellow-400 bg-yellow-400 text-gray-950 shadow-sm hover:border-yellow-500 hover:bg-yellow-500`;
const PROFILE_ACTION_SECONDARY =
  `${PROFILE_ACTION_BUTTON} border-gray-200 bg-white text-gray-700 shadow-sm hover:border-yellow-300 hover:bg-yellow-50 hover:text-gray-950`;
const PROFILE_ACTION_DANGER =
  `${PROFILE_ACTION_BUTTON} border-gray-200 bg-white text-gray-600 shadow-sm hover:border-red-200 hover:bg-red-50 hover:text-red-700`;

function normalizeUrl(url: string): { ok: true; value: string } | { ok: false; reason: string } {
  if (!url || !url.trim()) return { ok: true, value: '' };
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const u = new URL(trimmed);
      if (!/\./.test(u.hostname) || u.hostname.length < 4) {
        return { ok: false, reason: 'Enter a valid URL (e.g. https://example.com).' };
      }
      return { ok: true, value: u.toString() };
    } catch {
      return { ok: false, reason: 'Enter a valid URL (e.g. https://example.com).' };
    }
  }
  // Allow bare domain shape — require at least one dot and a TLD.
  if (/^([\w-]+\.)+[a-z]{2,}(\/.*)?$/i.test(trimmed)) {
    try {
      const u = new URL(`https://${trimmed}`);
      return { ok: true, value: u.toString() };
    } catch {
      return { ok: false, reason: 'Enter a valid URL (e.g. https://example.com).' };
    }
  }
  return { ok: false, reason: 'Enter a valid URL (e.g. https://example.com).' };
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
  const { canEdit, isAdmin, staffUser } = useAuth();
  const goBack = useSmartBack(() => getLastDashboardLocation() || '/');
  const [person, setPerson] = useState<Person | null>(null);
  const [personSectors, setPersonSectors] = useState<{ id: string; name: string }[]>([]);
  const [profileSources, setProfileSources] = useState<ProfileSourceRecord[]>([]);
  const [contactDetails, setContactDetails] = useState<ContactDetailRecord[]>([]);
  const [experiences, setExperiences] = useState<PersonExperienceRecord[]>([]);
  const [personTags, setPersonTags] = useState<PersonTagRecord[]>([]);
  const [allSectors, setAllSectors] = useState<Sector[]>([]);
  const [allFlemishConnections, setAllFlemishConnections] = useState<FlemishConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Person>>({});
  const [editSectorIds, setEditSectorIds] = useState<string[]>([]);
  const [editTags, setEditTags] = useState<string[]>([]);
  const [editFlemishConnections, setEditFlemishConnections] = useState<FlemishConnection[]>([]);
  const [editLocationDisplay, setEditLocationDisplay] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [showCollections, setShowCollections] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const loadPerson = useCallback(async () => {
    const [
      personRes,
      sectorsRes,
      allSectorsRes,
      flemishRes,
      sourcesRes,
      contactsRes,
      experiencesRes,
      tagsRes,
    ] = await Promise.all([
      supabase
        .from('people')
        .select('*, locations(*), person_us_connections(*, locations(*)), person_flemish_connections(flemish_connection_id, role, confidence, source_url, evidence_excerpt, flemish_connections(id, name, type, entity_type, is_filterable))')
        .eq('id', personId)
        .maybeSingle(),
      supabase.from('person_sectors').select('sector_id, sectors(name)').eq('person_id', personId),
      supabase.from('sectors').select('*'),
      supabase.from('flemish_connections').select('id, name, type, entity_type, is_filterable').order('name'),
      supabase
        .from('person_profile_sources')
        .select('*')
        .eq('person_id', personId)
        .eq('is_current', true)
        .order('updated_at', { ascending: false }),
      supabase
        .from('person_contact_details')
        .select('*')
        .eq('person_id', personId)
        .eq('is_primary', true)
        .neq('verification_status', 'rejected')
        .order('is_primary', { ascending: false }),
      supabase
        .from('person_experiences')
        .select('*')
        .eq('person_id', personId)
        .neq('verification_status', 'rejected')
        .order('is_current', { ascending: false }),
      supabase
        .from('person_tags')
        .select('*')
        .eq('person_id', personId)
        .neq('verification_status', 'rejected')
        .order('tag'),
    ]);

    const personData = personRes.data;
    setPerson(personData);
    setAllSectors((allSectorsRes.data || []) as Sector[]);
    setAllFlemishConnections((flemishRes.data || []) as FlemishConnection[]);
    setProfileSources((sourcesRes.data || []) as ProfileSourceRecord[]);
    setContactDetails((contactsRes.data || []) as ContactDetailRecord[]);
    setExperiences((experiencesRes.data || []) as PersonExperienceRecord[]);
    setPersonTags((tagsRes.data || []) as PersonTagRecord[]);

    const ps = ((sectorsRes.data || []) as unknown as PersonSector[])
      .filter((r) => r.sectors?.name)
      .map((r) => ({ id: r.sector_id, name: r.sectors!.name }));
    setPersonSectors(ps);

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
      current_location_city: person.current_location_city || '',
      current_location_country: person.current_location_country || '',
      bio: person.bio || '',
      email: person.email || '',
      linkedin_url: person.linkedin_url || '',
      website_url: person.website_url || '',
      twitter_url: person.twitter_url || '',
      profile_photo_url: person.profile_photo_url || '',
    });
    setEditSectorIds(personSectors.map((s) => s.id));
    setEditTags(personTags.map((tag) => tag.tag));
    setEditFlemishConnections(
      reconcileConnections(getPersonFlemishConnections(person), allFlemishConnections)
    );
    setEditing(true);
  };

  const cancelEditing = () => {
    setEditing(false);
    setEditForm({});
    setEditSectorIds([]);
    setEditTags([]);
    setEditFlemishConnections([]);
  };

  const saveEdits = async () => {
    if (!person) return;
    setSaving(true);

    const first = (editForm.first_name || '').trim();
    const last = (editForm.last_name || '').trim();
    const title = (editForm.title || '').trim();
    const computedName = [title, first, last].filter(Boolean).join(' ') || editForm.name || person.name;

    const linkedinResult = normalizeUrl(editForm.linkedin_url || '');
    const twitterResult = normalizeUrl(editForm.twitter_url || '');
    const websiteResult = normalizeUrl(editForm.website_url || '');

    if (!linkedinResult.ok) {
      setSaveError(`LinkedIn URL: ${linkedinResult.reason}`);
      setSaving(false);
      return;
    }
    if (!twitterResult.ok) {
      setSaveError(`Twitter URL: ${twitterResult.reason}`);
      setSaving(false);
      return;
    }
    if (!websiteResult.ok) {
      setSaveError(`Website URL: ${websiteResult.reason}`);
      setSaving(false);
      return;
    }

    const updatePayload = {
      name: computedName,
      title: title,
      first_name: first,
      last_name: last,
      current_position: editForm.current_position || null,
      occupation: editForm.occupation || null,
      location_id: editForm.location_id || null,
      current_location_city: editForm.current_location_city || null,
      current_location_country: editForm.current_location_country || null,
      bio: editForm.bio || null,
      email: editForm.email || null,
      linkedin_url: linkedinResult.value || null,
      website_url: websiteResult.value || null,
      twitter_url: twitterResult.value || null,
      profile_photo_url: editForm.profile_photo_url || null,
      // Profile edits MUST NOT auto-verify. Verification is owned by the
      // verify pipeline (/admin/verification, agent-verify).
      updated_at: new Date().toISOString(),
    };

    const { data: updatedPerson, error: updateErr } = await supabase
      .from('people')
      .update(updatePayload)
      .eq('id', person.id)
      .select('*, locations(*), person_us_connections(*, locations(*)), person_flemish_connections(flemish_connection_id, role, confidence, source_url, evidence_excerpt, flemish_connections(id, name, type, entity_type, is_filterable))')
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

    const actorName = staffUser?.full_name || staffUser?.email || 'Manual profile edit';
    const manualSourceBase = {
      person_id: person.id,
      source_type: 'manual',
      source_label: 'Manual profile edit',
      evidence_excerpt: `Edited by ${actorName}`,
      verification_status: 'unverified',
      created_by_staff_id: staffUser?.id || null,
      created_by_name: actorName,
      is_current: true,
    };

    const locationValue = updatedPerson.locations
      ? [updatedPerson.locations.city, updatedPerson.locations.state].filter(Boolean).join(', ')
      : null;
    const currentLocationValue = [
      updatedPerson.current_location_city,
      updatedPerson.current_location_country,
    ].filter(Boolean).join(', ') || null;
    const changedProfileFields = [
      { fieldName: 'name', changed: computedName !== person.name, value: computedName },
      { fieldName: 'photo', changed: updatePayload.profile_photo_url !== person.profile_photo_url, value: updatePayload.profile_photo_url },
      { fieldName: 'about', changed: updatePayload.bio !== person.bio, value: updatePayload.bio },
      { fieldName: 'location', changed: updatePayload.location_id !== person.location_id, value: locationValue },
      {
        fieldName: 'current_location',
        changed:
          updatePayload.current_location_city !== person.current_location_city ||
          updatePayload.current_location_country !== person.current_location_country,
        value: currentLocationValue,
      },
      { fieldName: 'current_position', changed: updatePayload.current_position !== person.current_position, value: updatePayload.current_position },
      { fieldName: 'occupation', changed: updatePayload.occupation !== person.occupation, value: updatePayload.occupation },
    ].filter((field) => field.changed);

    if (changedProfileFields.length > 0) {
      const changedNames = changedProfileFields.map((field) => field.fieldName);
      const { error: retireSourcesError } = await supabase
        .from('person_profile_sources')
        .update({ is_current: false })
        .eq('person_id', person.id)
        .in('field_name', changedNames)
        .eq('is_current', true);
      if (retireSourcesError) {
        setSaveError(`Profile saved, but source history could not be updated: ${retireSourcesError.message}`);
      } else {
        const { error: sourceInsertError } = await supabase
          .from('person_profile_sources')
          .insert(changedProfileFields.map((field) => ({
            ...manualSourceBase,
            field_name: field.fieldName,
            field_value: field.value,
          })));
        if (sourceInsertError) {
          setSaveError(`Profile saved, but its new sources could not be retained: ${sourceInsertError.message}`);
        }
      }
    }

    const contactChanges = [
      { type: 'email', oldValue: person.email, value: updatePayload.email },
      { type: 'linkedin', oldValue: person.linkedin_url, value: updatePayload.linkedin_url },
      { type: 'website', oldValue: person.website_url, value: updatePayload.website_url },
      { type: 'twitter', oldValue: person.twitter_url, value: updatePayload.twitter_url },
    ].filter((contact) => contact.oldValue !== contact.value);

    for (const contact of contactChanges) {
      await supabase
        .from('person_contact_details')
        .update({ is_primary: false })
        .eq('person_id', person.id)
        .eq('contact_type', contact.type)
        .eq('is_primary', true);

      if (contact.value) {
        await supabase
          .from('person_contact_details')
          .upsert({
            person_id: person.id,
            contact_type: contact.type,
            contact_value: contact.value,
            is_primary: true,
            verification_status: 'unverified',
            verification_method: null,
            verified_at: null,
            source_label: 'Manual profile edit',
            source_url: null,
            evidence_excerpt: `Edited by ${actorName}`,
            created_by_staff_id: staffUser?.id || null,
            created_by_name: actorName,
          }, { onConflict: 'person_id,contact_type,contact_value' });
      }
    }

    if (
      updatePayload.current_position !== person.current_position ||
      updatePayload.occupation !== person.occupation
    ) {
      await supabase
        .from('person_experiences')
        .update({ is_current: false })
        .eq('person_id', person.id)
        .eq('experience_type', 'occupation')
        .eq('is_current', true);

      const occupationTitle = updatePayload.current_position || updatePayload.occupation;
      if (occupationTitle) {
        const atParts = updatePayload.current_position?.split(/\s+at\s+/i) || [];
        await supabase.from('person_experiences').insert({
          person_id: person.id,
          experience_type: 'occupation',
          title: atParts[0] || occupationTitle,
          organization_name: atParts.length > 1 ? atParts.slice(1).join(' at ') : null,
          location_city: updatedPerson.locations?.city || updatedPerson.current_location_city || null,
          location_state: updatedPerson.locations?.state || null,
          location_country: updatedPerson.current_location_country || null,
          is_current: true,
          source_label: 'Manual profile edit',
          source_url: null,
          evidence_excerpt: `Edited by ${actorName}`,
          verification_status: 'unverified',
          created_by_staff_id: staffUser?.id || null,
          created_by_name: actorName,
        });
      }
    }

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

      if (insertConnectionError) {
        setSaveError(`Profile info saved, but error saving Flemish connections: ${insertConnectionError.message}`);
        setSaving(false);
        return;
      }

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

    const currentIds = personSectors.map((s) => s.id);
    const toRemove = currentIds.filter((id) => !editSectorIds.includes(id));
    const toAdd = editSectorIds.filter((id) => !currentIds.includes(id));

    try {
      const nextIds = ensuredConnections.map((connection) => connection.id);
      const existingLinks = person.person_flemish_connections || [];
      const existingIds = existingLinks
        .map((link) => link.flemish_connection_id)
        .filter((id): id is string => Boolean(id));
      const removeIds = existingIds.filter((id) => !nextIds.includes(id));
      const addOrKeepRows = ensuredConnections.map((connection) => {
        const existingLink = existingLinks.find(
          (link) => link.flemish_connection_id === connection.id
        );
        return {
          person_id: person.id,
          flemish_connection_id: connection.id,
          role: existingLink?.role || 'profile_fact',
          confidence: existingLink?.confidence ?? 1,
          source_url: existingLink?.source_url || null,
          evidence_excerpt: existingLink?.evidence_excerpt || `Added manually by ${actorName}`,
        };
      });

      if (removeIds.length > 0) {
        const { error: deleteFlemishError } = await supabase
          .from('person_flemish_connections')
          .delete()
          .eq('person_id', person.id)
          .in('flemish_connection_id', removeIds);
        if (deleteFlemishError) throw deleteFlemishError;
      }

      if (addOrKeepRows.length > 0) {
        const { error: upsertFlemishError } = await supabase
          .from('person_flemish_connections')
          .upsert(addOrKeepRows, {
            onConflict: 'person_id,flemish_connection_id',
          });
        if (upsertFlemishError) throw upsertFlemishError;
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

      const priorTagNames = personTags.map((tag) => tag.tag);
      const normalizedEditTags = Array.from(new Set(editTags.map((tag) => tag.trim()).filter(Boolean)));
      const removedTags = priorTagNames.filter((tag) =>
        !normalizedEditTags.some((next) => next.toLowerCase() === tag.toLowerCase())
      );
      const addedTags = normalizedEditTags.filter((tag) =>
        !priorTagNames.some((existing) => existing.toLowerCase() === tag.toLowerCase())
      );
      if (removedTags.length > 0) {
        const { error: removeTagsError } = await supabase
          .from('person_tags')
          .update({ verification_status: 'rejected' })
          .eq('person_id', person.id)
          .in('tag', removedTags);
        if (removeTagsError) throw removeTagsError;
      }
      if (addedTags.length > 0) {
        const { error: addTagsError } = await supabase
          .from('person_tags')
          .upsert(addedTags.map((tag) => ({
            person_id: person.id,
            tag,
            source_label: 'Manual profile edit',
            source_url: null,
            evidence_excerpt: `Added manually by ${actorName}`,
            verification_status: 'unverified',
            verified_at: null,
            created_by_staff_id: staffUser?.id || null,
            created_by_name: actorName,
          })), { onConflict: 'person_id,tag' });
        if (addTagsError) throw addTagsError;
      }

      if (toRemove.length > 0 || toAdd.length > 0) {
        const { error: retireSectorSourcesError } = await supabase
          .from('person_profile_sources')
          .update({ is_current: false })
          .eq('person_id', person.id)
          .eq('field_name', 'sector')
          .eq('is_current', true);
        if (retireSectorSourcesError) throw retireSectorSourcesError;

        const selectedSectorNames = allSectors
          .filter((sector) => editSectorIds.includes(sector.id))
          .map((sector) => sector.name);
        if (selectedSectorNames.length > 0) {
          const { error: insertSectorSourcesError } = await supabase
            .from('person_profile_sources')
            .insert(selectedSectorNames.map((name) => ({
              ...manualSourceBase,
              field_name: 'sector',
              field_value: name,
            })));
          if (insertSectorSourcesError) throw insertSectorSourcesError;
        }
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
      await loadPerson();
      kickEmbeddingWorker();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setSaveError(`Profile info saved, but error updating related tags: ${message}`);
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

  const updateContactVerification = async (
    contactId: string,
    status: 'verified' | 'rejected'
  ) => {
    const { error } = await supabase
      .from('person_contact_details')
      .update({
        verification_status: status,
        verification_method: status === 'verified' ? 'staff_review' : 'marked_outdated',
        verified_at: status === 'verified' ? new Date().toISOString() : null,
        is_primary: status !== 'rejected',
      })
      .eq('id', contactId);
    if (error) {
      setSaveError(`Could not update contact verification: ${error.message}`);
      return;
    }
    await loadPerson();
  };

  const deletePerson = async () => {
    if (!person || deleting) return;

    const confirmed = window.confirm(
      `Delete ${displayName(person)}? This permanently removes the contact and related collection, tag, search, and verification records.`
    );

    if (!confirmed) return;

    setDeleting(true);
    setSaveError(null);

    const { error } = await supabase
      .from('people')
      .delete()
      .eq('id', person.id);

    if (error) {
      setSaveError(`Error deleting contact: ${error.message}`);
      setDeleting(false);
      return;
    }

    onNavigate('dashboard');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-64px)]">
        <LoadingGlobe className="h-12 w-12" label="Loading profile" />
      </div>
    );
  }

  if (!person) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center">
        <h2 className="text-2xl font-semibold text-gray-900 mb-4">Person not found</h2>
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
                <div className="flex flex-col items-center gap-2">
                  <ProfileAvatar person={person} size="lg" />
                  <SourceLinks
                    items={profileSources.filter((source) => source.field_name === 'photo')}
                    compact
                  />
                </div>
              )}
              <div className="flex-1 min-w-0">
                {editing ? (
                  <EditHeader editForm={editForm} setField={setField} setEditForm={setEditForm} editLocationDisplay={editLocationDisplay} setEditLocationDisplay={setEditLocationDisplay} />
                ) : (
                  <ViewHeader person={person} onNavigate={onNavigate} />
                )}

                <div
                  className="mt-5 flex w-fit max-w-full flex-wrap items-center gap-1.5 rounded-xl border border-gray-200 bg-gray-50/80 p-1.5"
                  role="group"
                  aria-label="Profile actions"
                  data-print-hide
                >
                  {!editing && (
                    <>
                      {canEdit && (
                        <>
                          <button
                            onClick={startEditing}
                            className={PROFILE_ACTION_PRIMARY}
                          >
                            <Pencil className="w-4 h-4" />
                            <span>Edit</span>
                          </button>
                          <button
                            onClick={() => setShowUpdateModal(true)}
                            className={PROFILE_ACTION_SECONDARY}
                            title="Look for profile updates and additional information"
                          >
                            <RotateCw className="w-4 h-4" />
                            <span>Update</span>
                          </button>
                          <div className="relative">
                            <button
                              onClick={() => setShowCollections(!showCollections)}
                              className={`${PROFILE_ACTION_BUTTON} ${
                                showCollections
                                  ? 'border-yellow-300 bg-yellow-50 text-yellow-800 shadow-sm'
                                  : 'border-gray-200 bg-white text-gray-700 shadow-sm hover:border-yellow-300 hover:bg-yellow-50 hover:text-gray-950'
                              }`}
                              aria-expanded={showCollections}
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
                        </>
                      )}
                      <button
                        onClick={() => window.print()}
                        className={PROFILE_ACTION_SECONDARY}
                      >
                        <Printer className="w-4 h-4" />
                        <span>Print</span>
                      </button>
                      {canEdit && isAdmin && (
                        <button
                          onClick={deletePerson}
                          disabled={deleting}
                          className={PROFILE_ACTION_DANGER}
                        >
                          {deleting ? (
                            <Earth className="w-4 h-4 animate-spin" />
                          ) : (
                            <Trash2 className="w-4 h-4" />
                          )}
                          <span>Delete</span>
                        </button>
                      )}
                    </>
                  )}
                  {editing && (
                    <>
                      <button
                        onClick={saveEdits}
                        disabled={saving}
                        className={PROFILE_ACTION_PRIMARY}
                      >
                        {saving ? <Earth className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        <span>Save</span>
                      </button>
                      <button
                        onClick={cancelEditing}
                        className={PROFILE_ACTION_SECONDARY}
                      >
                        <X className="w-4 h-4" />
                        <span>Cancel</span>
                      </button>
                    </>
                  )}
                </div>
                {saveError && (
                  <div className="mt-2 px-4 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-center justify-between">
                    <span>{saveError}</span>
                    <button onClick={() => setSaveError(null)} className="ml-2 text-red-500 hover:text-red-700"><X className="w-4 h-4" /></button>
                  </div>
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
              editTags={editTags}
              setEditTags={setEditTags}
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
            <ViewBody
              person={person}
              personSectors={personSectors}
              profileSources={profileSources}
              contactDetails={contactDetails}
              experiences={experiences}
              personTags={personTags}
              canEdit={canEdit}
              onUpdateContactVerification={updateContactVerification}
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
  const verifiedDate = person.last_verified_at ? new Date(person.last_verified_at).toLocaleDateString() : null;
  const personCity = person.locations?.city || '';
  const personState = person.locations?.state || '';
  const abroadBase = currentAbroadBaseLabel(person);
  const sourceLabels: Record<string, string> = {
    manual: 'Manual',
    csv_import: 'File',
    ai_agent: 'Automated discovery',
    discovery_agent: 'Discovery',
    self_reported: 'Manual',
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
      {personCity && (
        <button
          onClick={() =>
            onNavigate('dashboard', undefined, {
              focusCity: {
                city: personCity,
                state: personState,
              },
            })
          }
          className="flex items-center space-x-2 text-gray-600 hover:text-yellow-700 mb-1 transition-colors group"
        >
          <MapPin className="w-5 h-5" />
          <span className="group-hover:underline">
            {personCity}
            {personState && `, ${personState}`}
          </span>
        </button>
      )}
      {isUsConnectedAbroad(person) && abroadBase && (
        <div className="flex items-center space-x-2 text-gray-600 mb-1">
          <Globe className="w-5 h-5" />
          <span>Currently based in {abroadBase}</span>
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
            <Earth className="w-6 h-6 text-white animate-spin" />
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
          <MapPin className="w-4 h-4 text-gray-400 flex-shrink-0" />
          <input
            value={editForm.current_location_city || ''}
            onChange={(e) => setField('current_location_city', e.target.value)}
            className={INPUT_CLS}
            placeholder="Current city abroad"
          />
        </div>
        <div className="flex items-center space-x-2">
          <Globe className="w-4 h-4 text-gray-400 flex-shrink-0" />
          <input
            value={editForm.current_location_country || ''}
            onChange={(e) => setField('current_location_country', e.target.value)}
            className={INPUT_CLS}
            placeholder="Current country abroad"
          />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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

function EditBody({
  editForm,
  setField,
  allSectors,
  allFlemishConnections,
  editSectorIds,
  toggleEditSector,
  editTags,
  setEditTags,
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
  editTags: string[];
  setEditTags: React.Dispatch<React.SetStateAction<string[]>>;
  editFlemishConnections: FlemishConnection[];
  setEditFlemishConnections: React.Dispatch<React.SetStateAction<FlemishConnection[]>>;
  onCreateFlemishConnection: (
    name: string,
    type: FlemishConnection['type']
  ) => Promise<FlemishConnection | null>;
}) {
  const [tagDraft, setTagDraft] = useState('');
  const addTag = () => {
    const nextTag = tagDraft.trim();
    if (!nextTag) return;
    setEditTags((current) =>
      current.some((tag) => tag.toLowerCase() === nextTag.toLowerCase())
        ? current
        : [...current, nextTag]
    );
    setTagDraft('');
  };

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
      <div>
        <label className="text-sm font-medium text-gray-700 mb-2 block">Tags</label>
        <div className="flex gap-2">
          <input
            value={tagDraft}
            onChange={(event) => setTagDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                addTag();
              }
            }}
            className={INPUT_CLS}
            placeholder="Add a tag"
          />
          <button type="button" onClick={addTag} className={PROFILE_ACTION_SECONDARY}>Add</button>
        </div>
        {editTags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {editTags.map((tag) => (
              <span key={tag} className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-sm text-gray-700">
                {tag}
                <button
                  type="button"
                  onClick={() => setEditTags((current) => current.filter((item) => item !== tag))}
                  className="text-gray-400 hover:text-red-600"
                  aria-label={`Remove ${tag}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
          </div>
        )}
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
  Research: { bg: 'bg-yellow-50', text: 'text-yellow-800' },
};

interface SourceDisplayItem {
  source_label?: string | null;
  source_url?: string | null;
  evidence_excerpt?: string | null;
  verification_status?: 'unverified' | 'sourced' | 'verified' | 'rejected' | null;
}

function formatProfileDate(value?: string | null, withTime = false): string {
  if (!value) return 'Unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return withTime
    ? date.toLocaleString()
    : date.toLocaleDateString();
}

function profileSourceLabel(value?: string | null): string {
  const labels: Record<string, string> = {
    manual: 'Manual',
    csv_import: 'File',
    ai_agent: 'Automated discovery',
    discovery_agent: 'Discovery',
    self_reported: 'Manual',
  };
  return value ? labels[value] || value : 'Unknown';
}

function statusClasses(status?: string | null): string {
  if (status === 'verified') return 'bg-green-50 text-green-700 border-green-100';
  if (status === 'sourced') return 'bg-blue-50 text-blue-700 border-blue-100';
  return 'bg-gray-50 text-gray-500 border-gray-100';
}

function statusLabel(status?: string | null): string {
  if (status === 'verified') return 'Verified';
  if (status === 'sourced') return 'Source retained';
  return 'Unverified';
}

function SourceLinks({
  items,
  compact = false,
}: {
  items: SourceDisplayItem[];
  compact?: boolean;
}) {
  const unique = items.filter((item, index, all) => {
    const key = `${item.source_url || ''}|${item.source_label || ''}|${item.evidence_excerpt || ''}`;
    return all.findIndex((candidate) =>
      `${candidate.source_url || ''}|${candidate.source_label || ''}|${candidate.evidence_excerpt || ''}` === key
    ) === index;
  });

  if (unique.length === 0) {
    return compact ? null : <p className="mt-3 text-xs text-gray-400">No retained source yet.</p>;
  }

  return (
    <div className={`${compact ? 'justify-center' : ''} mt-3 flex flex-wrap items-center gap-2`}>
      {unique.map((item, index) => {
        const label = item.source_label || 'Source';
        const content = (
          <>
            <Link className="h-3 w-3" />
            <span>{compact ? 'Source' : label}</span>
            {item.source_url && <ExternalLink className="h-3 w-3" />}
          </>
        );
        const className =
          'inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-600 transition-colors hover:border-yellow-300 hover:text-yellow-800';

        return item.source_url ? (
          <a
            key={`${item.source_url}-${index}`}
            href={item.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className={className}
            title={item.evidence_excerpt || label}
          >
            {content}
          </a>
        ) : (
          <span
            key={`${label}-${index}`}
            className={className}
            title={item.evidence_excerpt || 'Source URL unavailable'}
          >
            {content}
          </span>
        );
      })}
    </div>
  );
}

function ProfileSection({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="mb-4 flex items-center gap-2">
        <span className="text-yellow-600">{icon}</span>
        <h2 className="text-base font-semibold text-gray-900">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function ViewBody({
  person,
  personSectors,
  profileSources,
  contactDetails,
  experiences,
  personTags,
  canEdit,
  onUpdateContactVerification,
  onNavigate,
}: {
  person: Person;
  personSectors: { id: string; name: string }[];
  profileSources: ProfileSourceRecord[];
  contactDetails: ContactDetailRecord[];
  experiences: PersonExperienceRecord[];
  personTags: PersonTagRecord[];
  canEdit: boolean;
  onUpdateContactVerification: (
    contactId: string,
    status: 'verified' | 'rejected'
  ) => Promise<void>;
  onNavigate: (page: string, id?: string, preset?: FilterPreset) => void;
}) {
  const flemishConnections = getPersonFlemishConnections(person);
  const locationSources = profileSources.filter((source) =>
    source.field_name === 'location' || source.field_name === 'current_location'
  );
  const aboutSources = profileSources.filter((source) => source.field_name === 'about');
  const workSources = profileSources.filter((source) =>
    ['current_position', 'occupation', 'sector'].includes(source.field_name)
  );
  const primaryLocation = person.locations
    ? `${person.locations.city}${person.locations.state ? `, ${person.locations.state}` : ''}`
    : null;
  const abroadLocation = currentAbroadBaseLabel(person);

  return (
    <div className="space-y-5 border-t border-gray-100 pt-7">
      <ProfileSection title="Verification status" icon={<UserCheck className="h-4 w-4" />}>
        <div className="flex flex-wrap items-center gap-3">
          <span className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium ${statusClasses(person.last_verified_at ? 'verified' : 'unverified')}`}>
            {person.last_verified_at ? <ShieldCheck className="h-3.5 w-3.5" /> : <ShieldAlert className="h-3.5 w-3.5" />}
            {person.last_verified_at ? 'Verified profile' : 'Unverified profile'}
          </span>
          <span className="text-sm text-gray-500">
            {person.last_verified_at
              ? `Last verified ${formatProfileDate(person.last_verified_at, true)}`
              : 'No completed profile verification yet'}
          </span>
        </div>
      </ProfileSection>

      <ProfileSection title="About" icon={<Database className="h-4 w-4" />}>
        {person.bio ? (
          <p className="whitespace-pre-wrap leading-relaxed text-gray-700">{person.bio}</p>
        ) : (
          <p className="text-sm text-gray-400">No description found yet.</p>
        )}
        <SourceLinks items={aboutSources} />
      </ProfileSection>

      <ProfileSection title="Location" icon={<MapPin className="h-4 w-4" />}>
        {primaryLocation || abroadLocation ? (
          <div className="space-y-2 text-sm text-gray-700">
            {primaryLocation && <p>{primaryLocation}</p>}
            {abroadLocation && <p>Currently based in {abroadLocation}</p>}
          </div>
        ) : (
          <p className="text-sm text-gray-400">No current residence found yet.</p>
        )}
        <SourceLinks items={locationSources} />
      </ProfileSection>

      <ProfileSection title="Education / Occupation" icon={<GraduationCap className="h-4 w-4" />}>
        {experiences.length > 0 ? (
          <div className="space-y-3">
            {experiences.map((experience) => {
              const experienceLocation = [
                experience.location_city,
                experience.location_state,
                experience.location_country,
              ].filter(Boolean).join(', ');
              return (
                <div key={experience.id} className="rounded-lg border border-gray-100 bg-gray-50/70 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                        {experience.experience_type === 'education' ? 'Education' : 'Occupation'}
                        {experience.is_current ? ' · Current' : ''}
                      </p>
                      <p className="mt-1 font-medium text-gray-900">{experience.title}</p>
                      {experience.organization_name && (
                        <p className="mt-1 text-sm text-gray-600">{experience.organization_name}</p>
                      )}
                      {experienceLocation && (
                        <p className="mt-1 flex items-center gap-1 text-sm text-gray-500">
                          <MapPin className="h-3.5 w-3.5" />
                          {experienceLocation}
                        </p>
                      )}
                    </div>
                    <span className={`rounded-md border px-2 py-1 text-[10px] font-medium ${statusClasses(experience.verification_status)}`}>
                      {statusLabel(experience.verification_status)}
                    </span>
                  </div>
                  <SourceLinks items={[experience]} />
                </div>
              );
            })}
          </div>
        ) : person.current_position || person.occupation ? (
          <div>
            <p className="font-medium text-gray-900">{person.current_position || person.occupation}</p>
            {person.occupation && person.current_position && (
              <p className="mt-1 text-sm text-gray-500">{person.occupation}</p>
            )}
          </div>
        ) : (
          <p className="text-sm text-gray-400">No education or occupation facts found yet.</p>
        )}

        <div className="mt-4 border-t border-gray-100 pt-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Professional sectors</p>
          {personSectors.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {personSectors.map((sector) => {
                const colors = SECTOR_COLORS[sector.name] || { bg: 'bg-gray-50', text: 'text-gray-700' };
                return (
                  <button
                    key={sector.id}
                    onClick={() => onNavigate('dashboard', undefined, { sector: sector.name })}
                    className={`rounded-lg px-3 py-1.5 text-sm font-medium ${colors.bg} ${colors.text} transition-all hover:ring-2 hover:ring-yellow-300`}
                  >
                    {sector.name}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-gray-400">No current professional sector assigned.</p>
          )}
          <SourceLinks items={workSources} />
        </div>
      </ProfileSection>

      <ProfileSection title="Tags" icon={<Tag className="h-4 w-4" />}>
        {personTags.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {personTags.map((tag) => (
              <span key={tag.id} className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-sm text-gray-700" title={tag.evidence_excerpt || undefined}>
                {tag.tag}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-400">No tags assigned yet.</p>
        )}
        <SourceLinks items={personTags} />
      </ProfileSection>

      <ProfileSection title="Flemish Connection" icon={<Link className="h-4 w-4" />}>
        {flemishConnections.length > 0 ? (
          <FlemishConnectionList
            links={person.person_flemish_connections || []}
            onSelect={(name) =>
              onNavigate('dashboard', undefined, { flemishConnections: [name] })
            }
            sourceIcon="link"
          />
        ) : (
          <p className="text-sm text-gray-400">No Flemish connection retained yet.</p>
        )}
      </ProfileSection>

      <ProfileSection title="US Connection" icon={<Globe className="h-4 w-4" />}>
        {(person.person_us_connections || []).length > 0 ? (
          <div className="space-y-2">
            {(person.person_us_connections || []).map((connection, index) => {
              const confidence = connection.confidence === null || connection.confidence === undefined
                ? null
                : `${Math.round(connection.confidence * 100)}% confidence`;
              const location = connection.locations;
              const locationLabel = location
                ? `${location.city}, ${location.state}`
                : null;

              return (
                <div
                  key={connection.id || `${connection.location_id}-${index}`}
                  className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    {location ? (
                      <button
                        type="button"
                        onClick={() => onNavigate('dashboard', undefined, {
                          focusCity: {
                            city: location.city,
                            state: location.state,
                          },
                        })}
                        className="cursor-pointer rounded-md bg-blue-50 px-3 py-1 text-sm font-medium text-blue-700 transition-all hover:ring-2 hover:ring-blue-300"
                      >
                        {connection.connection_label || 'United States connection'}
                      </button>
                    ) : (
                      <span className="rounded-md bg-blue-50 px-3 py-1 text-sm font-medium text-blue-700">
                        {connection.connection_label || 'United States connection'}
                      </span>
                    )}
                    {locationLabel && (
                      <span className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-xs text-gray-500">
                        {locationLabel}
                      </span>
                    )}
                    {confidence && <span className="text-xs text-gray-500">{confidence}</span>}
                  </div>
                  {connection.evidence_excerpt && (
                    <p className="mt-1 text-xs text-gray-500">{connection.evidence_excerpt}</p>
                  )}
                  {connection.source_url && (
                    <a
                      href={connection.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
                    >
                      <Link className="h-3 w-3" />
                      Source
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-gray-400">No US connection retained yet.</p>
        )}
      </ProfileSection>

      <ProfileSection title="Contact details" icon={<Mail className="h-4 w-4" />}>
        {contactDetails.length > 0 ? (
          <div className="space-y-3">
            {contactDetails.map((contact) => {
              const href = contact.contact_type === 'email'
                ? `mailto:${contact.contact_value}`
                : contact.contact_value;
              return (
                <div key={contact.id} className="flex flex-col gap-2 rounded-lg border border-gray-100 p-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                      {contact.contact_type}
                    </p>
                    <a
                      href={href}
                      target={contact.contact_type === 'email' ? undefined : '_blank'}
                      rel={contact.contact_type === 'email' ? undefined : 'noopener noreferrer'}
                      className="mt-1 inline-flex max-w-full items-center gap-1 break-all text-sm font-medium text-blue-700 hover:underline"
                    >
                      {contact.contact_value}
                      {contact.contact_type !== 'email' && <ExternalLink className="h-3.5 w-3.5 flex-shrink-0" />}
                    </a>
                    <SourceLinks items={[contact]} />
                  </div>
                  <div className="flex flex-col items-start gap-2 sm:items-end">
                    <span className={`w-fit rounded-md border px-2 py-1 text-[10px] font-medium ${statusClasses(contact.verification_status)}`}>
                      {statusLabel(contact.verification_status)}
                    </span>
                    {canEdit && (
                      <div className="flex flex-wrap gap-2">
                        {contact.verification_status !== 'verified' && (
                          <button
                            type="button"
                            onClick={() => onUpdateContactVerification(contact.id, 'verified')}
                            className="text-xs font-medium text-green-700 hover:underline"
                          >
                            Verify contact
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onUpdateContactVerification(contact.id, 'rejected')}
                          className="text-xs font-medium text-red-600 hover:underline"
                        >
                          Mark outdated
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-gray-400">No contact details found.</p>
        )}
        <p className="mt-3 text-xs text-gray-400">
          Contact details have a separate verification status. A retained source does not automatically verify that the address is current.
        </p>
      </ProfileSection>

      <ProfileSection title="Stats" icon={<History className="h-4 w-4" />}>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-gray-400">Added</dt>
            <dd className="mt-1 text-sm font-medium text-gray-800">{formatProfileDate(person.created_at, true)}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-gray-400">Added by</dt>
            <dd className="mt-1 text-sm font-medium text-gray-800">{person.created_by_name || 'Unknown'}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-gray-400">How</dt>
            <dd className="mt-1 text-sm font-medium text-gray-800">{profileSourceLabel(person.data_source)}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-gray-400">Last update</dt>
            <dd className="mt-1 text-sm font-medium text-gray-800">{formatProfileDate(person.updated_at, true)}</dd>
            {person.updated_by_name && (
              <dd className="mt-1 text-xs text-gray-500">by {person.updated_by_name}</dd>
            )}
          </div>
        </dl>
      </ProfileSection>
    </div>
  );
}
