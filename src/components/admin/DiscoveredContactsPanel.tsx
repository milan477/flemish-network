import { useEffect, useState, useCallback } from 'react';
import {
  Loader2,
  Check,
  X,
  UserPlus,
  Trash2,
  ExternalLink,
  Mail,
  Linkedin,
  Globe,
  Tag,
  MapPin,
  ChevronDown,
  ChevronUp,
  Users,
  GitMerge,
  ArrowLeft,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react';
import {
  supabase,
  parseTitleFromName,
  displayName,
  type Person,
  type Sector,
} from '../../lib/supabase';

interface DiscoveredContact {
  id: string;
  name: string;
  email: string | null;
  linkedin_url: string | null;
  current_position: string | null;
  occupation: string | null;
  location_city: string | null;
  location_state: string | null;
  bio: string | null;
  flemish_connection: string | null;
  website_url: string | null;
  sectors: string[] | null;
  source: string;
  source_urls: string[] | null;
  status: string;
  agent_run_id: string | null;
  created_at: string;
}

interface DuplicateMatch {
  contactId: string;
  existingPerson: Person;
  reason: string;
}

const MERGE_FIELDS: { key: string; label: string }[] = [
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

// Fields where both existing+new values should be merged via AI instead of replaced
const AI_MERGE_FIELDS = new Set(['bio', 'flemish_connection']);

function getVal(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  if (v === null || v === undefined) return '';
  return String(v);
}

async function resolveLocationId(
  city?: string | null,
  state?: string | null
): Promise<string | null> {
  if (!city || !state) return null;
  const { data } = await supabase
    .from('locations')
    .select('id')
    .eq('city', city)
    .eq('state', state)
    .maybeSingle();
  return data?.id || null;
}

async function checkDuplicates(
  contacts: DiscoveredContact[]
): Promise<DuplicateMatch[]> {
  const { data: allPeople } = await supabase
    .from('people')
    .select('*, locations(*)');
  if (!allPeople || allPeople.length === 0) return [];

  const matches: DuplicateMatch[] = [];

  for (const contact of contacts) {
    const cEmail = (contact.email || '').trim().toLowerCase();
    const cLinkedin = (contact.linkedin_url || '').trim().toLowerCase();
    const cName = (contact.name || '').trim().toLowerCase();

    for (const person of allPeople as Person[]) {
      const pEmail = (person.email || '').trim().toLowerCase();
      const pLinkedin = (person.linkedin_url || '').trim().toLowerCase();
      const pName = (person.name || '').trim().toLowerCase();
      const pFullName =
        `${person.first_name || ''} ${person.last_name || ''}`
          .trim()
          .toLowerCase();

      if (cEmail && pEmail && cEmail === pEmail) {
        matches.push({
          contactId: contact.id,
          existingPerson: person,
          reason: `Email match: ${contact.email}`,
        });
        break;
      }

      if (
        cLinkedin &&
        pLinkedin &&
        cLinkedin.replace(/\/$/, '') === pLinkedin.replace(/\/$/, '')
      ) {
        matches.push({
          contactId: contact.id,
          existingPerson: person,
          reason: `LinkedIn match`,
        });
        break;
      }

      if (cName && (cName === pName || cName === pFullName)) {
        matches.push({
          contactId: contact.id,
          existingPerson: person,
          reason: `Name match: ${person.name || pFullName}`,
        });
        break;
      }
    }
  }

  return matches;
}

async function mergeTextViaAI(
  fieldName: string,
  existingValue: string,
  newValue: string
): Promise<string> {
  const { data, error } = await supabase.functions.invoke('ai-agent', {
    body: {
      task: 'merge_text',
      context: {
        field_name: fieldName,
        existing_value: existingValue,
        new_value: newValue,
      },
    },
  });

  if (error || !data?.success || !data?.data?.merged) {
    // Fallback: concatenate with separator
    return `${existingValue}\n\n${newValue}`;
  }

  return data.data.merged;
}

async function approveContact(
  contact: DiscoveredContact,
  sectors: Sector[]
): Promise<boolean> {
  const parsed = parseTitleFromName(contact.name || '');
  const locationId = await resolveLocationId(
    contact.location_city,
    contact.location_state
  );

  const { data: person, error } = await supabase
    .from('people')
    .insert({
      name: contact.name,
      title: parsed.title || null,
      first_name: parsed.firstName || null,
      last_name: parsed.lastName || null,
      current_position: contact.current_position || null,
      occupation: contact.occupation || null,
      location_id: locationId,
      bio: contact.bio || null,
      flemish_connection: contact.flemish_connection || null,
      email: contact.email || null,
      email_verified: contact.email ? false : null,
      linkedin_url: contact.linkedin_url || null,
      website_url: contact.website_url || null,
      data_source: 'discovery_agent',
    })
    .select('id')
    .maybeSingle();

  if (error || !person) return false;

  if (contact.sectors && contact.sectors.length > 0) {
    const matched = sectors.filter((s) => contact.sectors!.includes(s.name));
    if (matched.length > 0) {
      await supabase.from('person_sectors').insert(
        matched.map((s) => ({
          person_id: person.id,
          sector_id: s.id,
        }))
      );
    }
  }

  supabase.functions
    .invoke('generate-embeddings', { body: { personId: person.id } })
    .catch(() => {});

  await supabase.from('discovered_contacts').delete().eq('id', contact.id);

  return true;
}

async function mergeIntoExisting(
  contact: DiscoveredContact,
  existingPerson: Person,
  selectedFields: string[],
  sectors: Sector[]
): Promise<boolean> {
  const updates: Record<string, unknown> = {};

  for (const fieldKey of selectedFields) {
    const newVal = getVal(
      contact as unknown as Record<string, unknown>,
      fieldKey
    );
    const existVal = getVal(
      existingPerson as unknown as Record<string, unknown>,
      fieldKey
    );

    if (!newVal) continue;

    // For text fields where both have values, merge via AI
    if (existVal && AI_MERGE_FIELDS.has(fieldKey)) {
      updates[fieldKey] = await mergeTextViaAI(fieldKey, existVal, newVal);
    } else if (fieldKey === 'location_city' || fieldKey === 'location_state') {
      // Location handled separately below
    } else {
      updates[fieldKey] = newVal;
    }
  }

  // Handle location: if city or state selected, resolve location_id
  if (
    selectedFields.includes('location_city') ||
    selectedFields.includes('location_state')
  ) {
    const city = selectedFields.includes('location_city')
      ? contact.location_city
      : existingPerson.locations?.city;
    const state = selectedFields.includes('location_state')
      ? contact.location_state
      : existingPerson.locations?.state;
    const locationId = await resolveLocationId(city, state);
    if (locationId) {
      updates.location_id = locationId;
    }
  }

  // Remove location_city/location_state from direct updates (they don't exist on people table)
  delete updates.location_city;
  delete updates.location_state;

  if (Object.keys(updates).length > 0) {
    const { error } = await supabase
      .from('people')
      .update(updates)
      .eq('id', existingPerson.id);
    if (error) return false;
  }

  // Merge sectors
  if (contact.sectors && contact.sectors.length > 0) {
    const matched = sectors.filter((s) => contact.sectors!.includes(s.name));
    if (matched.length > 0) {
      // Use upsert to avoid duplicates
      await supabase.from('person_sectors').upsert(
        matched.map((s) => ({
          person_id: existingPerson.id,
          sector_id: s.id,
        })),
        { onConflict: 'person_id,sector_id' }
      );
    }
  }

  // Regenerate embedding
  supabase.functions
    .invoke('generate-embeddings', { body: { personId: existingPerson.id } })
    .catch(() => {});

  // Delete from discovered_contacts
  await supabase.from('discovered_contacts').delete().eq('id', contact.id);

  return true;
}

// ── Merge Compare View ─────────────────────────────────────────────

function MergeCompare({
  contact,
  existingPerson,
  duplicateReason,
  sectors,
  onMerged,
  onAddNew,
  onBack,
}: {
  contact: DiscoveredContact;
  existingPerson: Person;
  duplicateReason: string;
  sectors: Sector[];
  onMerged: () => void;
  onAddNew: () => void;
  onBack: () => void;
}) {
  const existingRecord = {
    ...existingPerson,
    location_city: existingPerson.locations?.city || '',
    location_state: existingPerson.locations?.state || '',
  } as unknown as Record<string, unknown>;

  const newRecord = contact as unknown as Record<string, unknown>;

  const diffs = MERGE_FIELDS.filter((f) => {
    const newVal = getVal(newRecord, f.key);
    const existVal = getVal(existingRecord, f.key);
    return newVal && newVal !== existVal;
  });

  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(diffs.map((d) => d.key))
  );
  const [merging, setMerging] = useState(false);

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

  const handleMerge = async () => {
    setMerging(true);
    const ok = await mergeIntoExisting(
      contact,
      existingPerson,
      Array.from(selected),
      sectors
    );
    setMerging(false);
    if (ok) onMerged();
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100">
        <button
          onClick={onBack}
          className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-gray-900">
            Merge: {contact.name}
          </h3>
          <p className="text-xs text-amber-600 mt-0.5">{duplicateReason}</p>
        </div>
      </div>

      <div className="px-5 py-4">
        <div className="grid grid-cols-2 gap-4 mb-5">
          <div className="bg-blue-50/50 border border-blue-100 rounded-xl p-4">
            <p className="text-[10px] uppercase tracking-wider text-blue-500 font-semibold mb-2">
              New (Discovered)
            </p>
            <p className="text-sm font-semibold text-gray-900">
              {contact.name}
            </p>
            {contact.current_position && (
              <p className="text-xs text-gray-600 mt-0.5">
                {contact.current_position}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2 mt-2">
              {contact.email && (
                <span className="inline-flex items-center gap-1 text-[11px] text-gray-500">
                  <Mail className="w-3 h-3" />
                  {contact.email}
                </span>
              )}
              {contact.linkedin_url && (
                <span className="inline-flex items-center gap-1 text-[11px] text-blue-500">
                  <Linkedin className="w-3 h-3" />
                  LinkedIn
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
                    <th className="w-16 px-3 py-2.5 text-left text-gray-400 font-medium">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {diffs.map((field) => {
                    const newVal = getVal(newRecord, field.key);
                    const existVal = getVal(existingRecord, field.key);
                    const isSelected = selected.has(field.key);
                    const willAIMerge =
                      existVal && newVal && AI_MERGE_FIELDS.has(field.key);

                    return (
                      <tr
                        key={field.key}
                        className={`cursor-pointer transition-colors ${
                          isSelected ? 'bg-blue-50/30' : 'hover:bg-gray-50'
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
                        <td className="px-3 py-2.5">
                          {willAIMerge ? (
                            <span className="text-[10px] px-1.5 py-0.5 bg-purple-50 text-purple-600 rounded font-medium">
                              AI merge
                            </span>
                          ) : existVal ? (
                            <span className="text-[10px] px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded font-medium">
                              Replace
                            </span>
                          ) : (
                            <span className="text-[10px] px-1.5 py-0.5 bg-green-50 text-green-600 rounded font-medium">
                              Fill
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <p className="text-[10px] text-gray-400 mt-2">
              Fields marked "AI merge" will combine both values using AI instead
              of replacing.
            </p>
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
          disabled={merging}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-50"
        >
          <UserPlus className="w-3.5 h-3.5" />
          Add as New Contact
        </button>
        {diffs.length > 0 && selected.size > 0 && (
          <button
            onClick={handleMerge}
            disabled={merging}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50"
          >
            {merging ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
            Merge into Existing ({selected.size})
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main Panel ─────────────────────────────────────────────────────

export default function DiscoveredContactsPanel() {
  const [contacts, setContacts] = useState<DiscoveredContact[]>([]);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<string | null>(null);
  const [expandedSources, setExpandedSources] = useState<Set<string>>(
    new Set()
  );
  const [duplicates, setDuplicates] = useState<Map<string, DuplicateMatch>>(
    new Map()
  );
  const [checkingDupes, setCheckingDupes] = useState(false);
  const [mergeTarget, setMergeTarget] = useState<{
    contact: DiscoveredContact;
    match: DuplicateMatch;
  } | null>(null);

  const loadData = useCallback(async () => {
    const [contactsRes, sectorsRes] = await Promise.all([
      supabase
        .from('discovered_contacts')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: false }),
      supabase.from('sectors').select('*'),
    ]);

    const loadedContacts = (contactsRes.data || []) as DiscoveredContact[];
    const loadedSectors = (sectorsRes.data || []) as Sector[];

    setContacts(loadedContacts);
    setSectors(loadedSectors);
    setLoading(false);

    // Check for duplicates
    if (loadedContacts.length > 0) {
      setCheckingDupes(true);
      const matches = await checkDuplicates(loadedContacts);
      const dupeMap = new Map<string, DuplicateMatch>();
      for (const m of matches) {
        dupeMap.set(m.contactId, m);
      }
      setDuplicates(dupeMap);
      setCheckingDupes(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleApprove = useCallback(
    async (contact: DiscoveredContact) => {
      setActionId(contact.id);
      const ok = await approveContact(contact, sectors);
      if (ok) {
        setContacts((prev) => prev.filter((c) => c.id !== contact.id));
        setDuplicates((prev) => {
          const next = new Map(prev);
          next.delete(contact.id);
          return next;
        });
      }
      setActionId(null);
    },
    [sectors]
  );

  const handleReject = useCallback(async (contact: DiscoveredContact) => {
    setActionId(contact.id);
    await supabase
      .from('discovered_contacts')
      .update({ status: 'rejected' })
      .eq('id', contact.id);
    setContacts((prev) => prev.filter((c) => c.id !== contact.id));
    setDuplicates((prev) => {
      const next = new Map(prev);
      next.delete(contact.id);
      return next;
    });
    setActionId(null);
  }, []);

  const handleApproveAll = useCallback(async () => {
    // Only approve non-duplicates in bulk
    const nonDupes = contacts.filter((c) => !duplicates.has(c.id));
    for (const contact of nonDupes) {
      setActionId(contact.id);
      await approveContact(contact, sectors);
    }
    setActionId(null);
    await loadData();
  }, [contacts, sectors, duplicates, loadData]);

  const handleRejectAll = useCallback(async () => {
    setActionId('all');
    const ids = contacts.map((c) => c.id);
    await supabase
      .from('discovered_contacts')
      .update({ status: 'rejected' })
      .in('id', ids);
    setContacts([]);
    setDuplicates(new Map());
    setActionId(null);
  }, [contacts]);

  const handleMerged = useCallback(() => {
    const contactId = mergeTarget?.contact.id;
    setMergeTarget(null);
    if (contactId) {
      setContacts((prev) => prev.filter((c) => c.id !== contactId));
      setDuplicates((prev) => {
        const next = new Map(prev);
        next.delete(contactId);
        return next;
      });
    }
  }, [mergeTarget]);

  const handleAddNewFromMerge = useCallback(async () => {
    if (!mergeTarget) return;
    const contact = mergeTarget.contact;
    setMergeTarget(null);
    await handleApprove(contact);
  }, [mergeTarget, handleApprove]);

  const toggleSources = (id: string) => {
    setExpandedSources((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="w-6 h-6 animate-spin text-teal-600" />
      </div>
    );
  }

  if (contacts.length === 0) {
    return (
      <div className="bg-white rounded-xl p-8 shadow-sm border border-gray-100 text-center">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-gray-100 flex items-center justify-center mb-4">
          <Users className="w-7 h-7 text-gray-300" />
        </div>
        <p className="text-sm font-medium text-gray-500 mb-1">
          No pending discovered contacts
        </p>
        <p className="text-xs text-gray-400">
          Run the Discovery Agent from the Agents tab to find new contacts.
        </p>
      </div>
    );
  }

  // Show merge compare view
  if (mergeTarget) {
    return (
      <MergeCompare
        contact={mergeTarget.contact}
        existingPerson={mergeTarget.match.existingPerson}
        duplicateReason={mergeTarget.match.reason}
        sectors={sectors}
        onMerged={handleMerged}
        onAddNew={handleAddNewFromMerge}
        onBack={() => setMergeTarget(null)}
      />
    );
  }

  const dupeCount = duplicates.size;
  const newCount = contacts.length - dupeCount;

  return (
    <div className="space-y-4">
      {/* Bulk actions */}
      <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 flex items-center justify-between">
        <div className="text-sm text-gray-700">
          <span className="font-semibold text-gray-900">
            {contacts.length}
          </span>{' '}
          pending contact{contacts.length !== 1 ? 's' : ''}
          {checkingDupes ? (
            <span className="ml-2 text-xs text-gray-400">
              <Loader2 className="w-3 h-3 animate-spin inline mr-1" />
              Checking duplicates...
            </span>
          ) : dupeCount > 0 ? (
            <span className="ml-2 text-xs text-amber-600">
              ({dupeCount} duplicate{dupeCount !== 1 ? 's' : ''}, {newCount}{' '}
              new)
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleApproveAll}
            disabled={actionId !== null}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-green-700 bg-green-50 hover:bg-green-100 rounded-lg transition-colors disabled:opacity-50"
          >
            <Check className="w-3.5 h-3.5" />
            Approve{dupeCount > 0 ? ` New (${newCount})` : ' All'}
          </button>
          <button
            onClick={handleRejectAll}
            disabled={actionId !== null}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded-lg transition-colors disabled:opacity-50"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Reject All
          </button>
        </div>
      </div>

      {/* Contact cards */}
      {contacts.map((contact) => {
        const isActioning = actionId === contact.id || actionId === 'all';
        const dupeMatch = duplicates.get(contact.id);

        return (
          <div
            key={contact.id}
            className={`bg-white rounded-xl border transition-all px-5 py-4 ${
              dupeMatch
                ? 'border-amber-200 bg-amber-50/20'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            {dupeMatch && (
              <div className="flex items-center gap-1.5 mb-3 px-2.5 py-1.5 bg-amber-100/60 rounded-lg">
                <AlertTriangle className="w-3 h-3 text-amber-600 flex-shrink-0" />
                <span className="text-[11px] text-amber-700 font-medium">
                  Possible duplicate: {dupeMatch.reason}
                </span>
              </div>
            )}

            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1 space-y-1.5">
                {/* Name + occupation */}
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
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                      contact.source === 'linkedin_search'
                        ? 'bg-blue-50 text-blue-600'
                        : 'bg-amber-50 text-amber-600'
                    }`}
                  >
                    {contact.source === 'linkedin_search'
                      ? 'LinkedIn'
                      : 'Web Search'}
                  </span>
                </div>

                {/* Position */}
                {contact.current_position && (
                  <p className="text-xs text-gray-600">
                    {contact.current_position}
                  </p>
                )}

                {/* Bio */}
                {contact.bio && (
                  <p className="text-xs text-gray-500 leading-relaxed line-clamp-2">
                    {contact.bio}
                  </p>
                )}

                {/* Location + flemish connection */}
                <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                  {contact.location_city && (
                    <span className="inline-flex items-center gap-1 text-xs text-gray-400">
                      <MapPin className="w-3 h-3" />
                      {contact.location_city}
                      {contact.location_state &&
                        `, ${contact.location_state}`}
                    </span>
                  )}
                  {contact.flemish_connection && (
                    <span className="text-xs text-yellow-600">
                      {contact.flemish_connection}
                    </span>
                  )}
                </div>

                {/* Links */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5">
                  {contact.email && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-gray-600">
                      <Mail className="w-3 h-3 text-gray-400" />
                      {contact.email}
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
                      LinkedIn
                      <ExternalLink className="w-2.5 h-2.5" />
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
                      Website
                    </a>
                  )}
                </div>

                {/* Sectors */}
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

                {/* Source URLs */}
                {contact.source_urls && contact.source_urls.length > 0 && (
                  <div className="pt-0.5">
                    <button
                      onClick={() => toggleSources(contact.id)}
                      className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      {expandedSources.has(contact.id) ? (
                        <ChevronUp className="w-2.5 h-2.5" />
                      ) : (
                        <ChevronDown className="w-2.5 h-2.5" />
                      )}
                      {contact.source_urls.length} source
                      {contact.source_urls.length !== 1 ? 's' : ''}
                    </button>
                    {expandedSources.has(contact.id) && (
                      <div className="mt-1 space-y-0.5 pl-3.5">
                        {contact.source_urls.map((url, i) => (
                          <a
                            key={i}
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block text-[10px] text-blue-500 hover:text-blue-600 truncate max-w-[400px]"
                          >
                            {url}
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Action buttons */}
              <div className="flex flex-col items-end gap-1.5 flex-shrink-0 pt-0.5">
                {dupeMatch ? (
                  <>
                    <button
                      onClick={() =>
                        setMergeTarget({ contact, match: dupeMatch })
                      }
                      disabled={isActioning}
                      className="flex items-center gap-1 text-[11px] font-medium px-2.5 py-1.5 text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors disabled:opacity-50"
                    >
                      <GitMerge className="w-3 h-3" />
                      Merge
                    </button>
                    <button
                      onClick={() => handleApprove(contact)}
                      disabled={isActioning}
                      className="flex items-center gap-1 text-[11px] font-medium px-2.5 py-1.5 text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-lg transition-colors disabled:opacity-50"
                    >
                      {isActioning ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <UserPlus className="w-3 h-3" />
                      )}
                      Add Anyway
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => handleApprove(contact)}
                    disabled={isActioning}
                    className="flex items-center gap-1 text-[11px] font-medium px-2.5 py-1.5 text-green-700 bg-green-50 hover:bg-green-100 rounded-lg transition-colors disabled:opacity-50"
                  >
                    {isActioning ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <UserPlus className="w-3 h-3" />
                    )}
                    Approve
                  </button>
                )}
                <button
                  onClick={() => handleReject(contact)}
                  disabled={isActioning}
                  className="flex items-center gap-1 text-[11px] font-medium px-2.5 py-1.5 text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors disabled:opacity-50"
                >
                  <X className="w-3 h-3" />
                  Reject
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
