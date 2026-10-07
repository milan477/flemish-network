import { useEffect, useState, useCallback } from 'react';
import {
  Earth,
  Check,
  UserPlus,
  ExternalLink,
  Mail,
  Linkedin,
  Globe,
  Tag,
  MapPin,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Users,
  GitMerge,
  ArrowLeft,
  RefreshCw,
  AlertTriangle,
  Building2,
  X,
  Eye,
  Clock3,
} from 'lucide-react';
import {
  supabase,
  parseTitleFromName,
  personNamePartsForInsert,
  displayName,
  type Person,
  type Organization,
  type OrganizationUsLocationRole,
  type OrganizationUsNetworkStatus,
  type Sector,
} from '../../lib/supabase';
import {
  getDerivedLocationSummary,
  normalizeDerivedLabelSuggestions,
  type DerivedLabelSuggestion,
} from '../../lib/derivedLabels';
import { syncPersonFlemishConnections } from '../../lib/flemishConnectionSync';
import { lastVerifiedAtAfterMerge, verifiedAtForApproval } from '../../lib/discoveryApproval';
import { kickEmbeddingWorker } from '../../lib/embeddingRefresh';
import { notifyError, notifySuccess } from '../../lib/toast';
import { resolveLocationId as resolveOrCreateLocationId } from '../../lib/locations';

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
  profile_photo_url: string | null;
  sectors: string[] | null;
  source: string;
  source_urls: string[] | null;
  status: string;
  agent_run_id: string | null;
  created_by_staff_id?: string | null;
  created_by_name?: string | null;
  created_at: string;
  last_seen_at?: string | null;
  last_evidence_at?: string | null;
  evidence_count?: number | null;
  discovery_confidence?: number | null;
  suggested_us_network_status?: 'us_based' | 'us_connected_abroad' | null;
  suggested_us_network_confidence?: number | null;
  current_location_city?: string | null;
  current_location_country?: string | null;
  suggested_us_connections?: SuggestedUsConnection[] | null;
  reviewed_at?: string | null;
  review_outcome?: string | null;
  approved_person_id?: string | null;
  verification_status?: 'queued' | 'requested' | 'verifying' | 'verified' | 'failed' | null;
  verification_attempts?: number | null;
  verification_payload?: VerificationPayload | null;
  verified_at?: string | null;
}

export interface VerificationPayload {
  network_scope: 'us_based' | 'us_connected_abroad' | null;
  location_city: string | null;
  location_state: string | null;
  location_country: string | null;
  current_role: string | null;
  current_employer: string | null;
  profile_photo_url: string | null;
  profile_links: Array<{
    type: 'linkedin' | 'website';
    url: string;
    label: string | null;
    evidence_url: string;
    evidence_excerpt: string;
  }>;
  professional_sectors: string[];
  belgian_identity_confirmed: boolean;
  flemish_ties: string[];
  evidence: Array<{ url: string; excerpt: string }>;
  confidence: number;
  contradiction: boolean;
  contradiction_reason: string | null;
  notes: string | null;
}

interface SuggestedUsConnection {
  location_city?: string | null;
  location_state?: string | null;
  connection_label?: string | null;
  source_url?: string | null;
  evidence_excerpt?: string | null;
  confidence?: number | null;
}

interface DiscoveryEvidence {
  discovered_contact_id: string;
  page_url: string;
  page_title: string | null;
  page_type: string | null;
  evidence_excerpt: string | null;
  raw_location_text: string | null;
  raw_flemish_text: string | null;
  raw_role_text: string | null;
  extraction_confidence: number | null;
  created_at: string;
}

interface DiscoveredOrganization {
  id: string;
  name: string;
  website_url: string | null;
  description: string | null;
  candidate_key: string | null;
  source: string;
  suggested_us_network_status: OrganizationUsNetworkStatus | null;
  us_locations: SuggestedOrganizationLocation[] | null;
  sectors: string[] | null;
  flemish_belgian_relevance: string | null;
  source_urls: string[] | null;
  confidence: number | null;
  status: string;
  review_outcome: string | null;
  reviewed_at: string | null;
  approved_organization_id: string | null;
  created_at: string;
  last_seen_at: string | null;
  last_evidence_at: string | null;
  evidence_count: number | null;
  verification_status?: 'queued' | 'requested' | 'verifying' | 'verified' | 'failed' | null;
  verification_attempts?: number | null;
  verification_payload?: VerificationPayload | null;
  verified_at?: string | null;
}

interface SuggestedOrganizationLocation {
  city?: string | null;
  state?: string | null;
  role?: OrganizationUsLocationRole | string | null;
  label?: string | null;
  description?: string | null;
  source_url?: string | null;
  evidence_excerpt?: string | null;
  confidence?: number | null;
}

interface DiscoveryOrganizationEvidence {
  discovered_organization_id: string;
  page_url: string;
  page_title: string | null;
  page_type: string | null;
  source_type: string | null;
  source_url: string | null;
  evidence_excerpt: string | null;
  raw_relevance_text: string | null;
  raw_location_text: string | null;
  raw_sector_text: string | null;
  normalized_location_city: string | null;
  normalized_location_state: string | null;
  normalized_location_country: string | null;
  confidence: number | null;
  created_at: string;
}

interface DuplicateMatch {
  contactId: string;
  existingPerson: Person;
  reason: string;
}

function isContactReadyForBulkApproval(
  contact: DiscoveredContact,
  isDuplicate: boolean,
): boolean {
  if (isDuplicate) return false;
  if ((contact.verification_status ?? 'queued') !== 'verified') return false;
  if (!contact.suggested_us_network_status) return false;
  const confidence =
    contact.suggested_us_network_confidence ?? contact.discovery_confidence ?? 0;
  return confidence >= 0.8;
}

interface OrganizationDuplicateMatch {
  organizationId: string;
  existingOrganization: Organization;
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

function normalizeWebsite(value: string | null | undefined): string {
  return (value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/$/, '');
}

function normalizeName(value: string | null | undefined): string {
  return (value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function organizationStatusLabel(status: OrganizationUsNetworkStatus | null | undefined): string {
  switch (status) {
    case 'belgian_organization_with_us_presence':
      return 'Belgian org with US presence';
    case 'us_organization_connected_to_flanders':
      return 'US org connected to Flanders';
    case 'institutional_connector':
      return 'Institutional connector';
    case 'us_based_organization':
      return 'US-based organization';
    default:
      return 'Needs scope review';
  }
}

function organizationSourceLabel(source: string): string {
  if (source === 'manual') return 'Manual';
  if (source === 'import') return 'Import';
  if (source === 'agent_discovery' || source === 'frontier_page') return 'Discovery';
  return source.replace(/_/g, ' ');
}

function contactSourceLabel(source: string): string {
  if (source === 'manual') return 'Manual';
  if (source === 'import') return 'Import';
  if (source === 'linkedin_search') return 'LinkedIn';
  if (source === 'frontier_page') return 'Frontier Page';
  if (source === 'web_search' || source === 'agent_discovery') return 'Discovery';
  return source.replace(/_/g, ' ');
}

function approvedPersonDataSource(source: string, staffLaunchedDiscovery: boolean): string {
  if (source === 'manual') return 'manual';
  if (source === 'import') return 'csv_import';
  return staffLaunchedDiscovery ? 'discovery_agent' : 'ai_agent';
}

async function resolveContactOrigin(contact: DiscoveredContact): Promise<{
  staffId: string | null;
  name: string | null;
  staffLaunchedDiscovery: boolean;
}> {
  if (contact.source === 'manual' || contact.source === 'import') {
    return {
      staffId: contact.created_by_staff_id || null,
      name: contact.created_by_name || null,
      staffLaunchedDiscovery: false,
    };
  }

  if (!contact.agent_run_id) {
    return { staffId: null, name: 'System', staffLaunchedDiscovery: false };
  }

  const { data } = await supabase
    .from('agent_runs')
    .select('initiated_by_staff_id, initiated_by_name')
    .eq('id', contact.agent_run_id)
    .maybeSingle();

  return {
    staffId: data?.initiated_by_staff_id || null,
    name: data?.initiated_by_name || 'System',
    staffLaunchedDiscovery: Boolean(data?.initiated_by_staff_id || data?.initiated_by_name),
  };
}

async function retainApprovedPersonSources(
  personId: string,
  contact: DiscoveredContact,
  sectors: Sector[],
  includedFields?: Set<string>
) {
  const includes = (field: string) => !includedFields || includedFields.has(field);
  const evidence = contact.verification_payload?.evidence?.[0];
  const sourceUrl = evidence?.url || contact.source_urls?.[0] || null;
  const evidenceExcerpt = evidence?.excerpt || contact.bio || contact.flemish_connection || null;
  const sourceLabel = contact.source === 'manual' ? 'Manual discovery review' : 'Discovery evidence';
  const verificationStatus = sourceUrl ? 'sourced' : 'unverified';
  const locationValue = [contact.location_city, contact.location_state].filter(Boolean).join(', ') || null;
  const currentLocationValue = [contact.current_location_city, contact.current_location_country].filter(Boolean).join(', ') || null;
  const fields = [
    { fieldName: 'photo', sourceField: 'profile_photo_url', value: contact.profile_photo_url },
    { fieldName: 'about', sourceField: 'bio', value: contact.bio },
    { fieldName: 'location', sourceField: 'location', value: locationValue },
    { fieldName: 'current_location', sourceField: 'current_location', value: currentLocationValue },
    { fieldName: 'current_position', sourceField: 'current_position', value: contact.current_position },
    { fieldName: 'occupation', sourceField: 'occupation', value: contact.occupation },
  ].filter((field) => field.value && includes(field.sourceField));

  for (const field of fields) {
    await supabase
      .from('person_profile_sources')
      .update({ is_current: false })
      .eq('person_id', personId)
      .eq('field_name', field.fieldName)
      .eq('is_current', true);
  }

  const matchedSectors = includes('sectors')
    ? sectors.filter((sector) => contact.sectors?.includes(sector.name))
    : [];
  const sourceRows = [
    ...fields.map((field) => ({
      person_id: personId,
      field_name: field.fieldName,
      field_value: field.value,
      source_type: contact.source,
      source_label: sourceLabel,
      source_url: sourceUrl,
      evidence_excerpt: evidenceExcerpt,
      verification_status: verificationStatus,
      is_current: true,
    })),
    ...matchedSectors.map((sector) => ({
      person_id: personId,
      field_name: 'sector',
      field_value: sector.name,
      source_type: contact.source,
      source_label: sourceLabel,
      source_url: sourceUrl,
      evidence_excerpt: evidenceExcerpt,
      verification_status: verificationStatus,
      is_current: true,
    })),
  ];
  if (sourceRows.length > 0) {
    await supabase.from('person_profile_sources').insert(sourceRows);
  }

  const payloadContacts = (contact.verification_payload?.profile_links || []).map((link) => ({
    type: link.type,
    sourceField: link.type === 'linkedin' ? 'linkedin_url' : 'website_url',
    value: link.url,
    retainedSourceUrl: link.evidence_url,
    retainedExcerpt: link.evidence_excerpt,
  }));
  const contacts = [
    { type: 'email', sourceField: 'email', value: contact.email, retainedSourceUrl: sourceUrl, retainedExcerpt: evidenceExcerpt },
    ...payloadContacts,
    { type: 'linkedin', sourceField: 'linkedin_url', value: contact.linkedin_url, retainedSourceUrl: sourceUrl, retainedExcerpt: evidenceExcerpt },
    { type: 'website', sourceField: 'website_url', value: contact.website_url, retainedSourceUrl: sourceUrl, retainedExcerpt: evidenceExcerpt },
  ].filter((item, index, items) =>
    item.value &&
    includes(item.sourceField) &&
    items.findIndex((candidate) => candidate.type === item.type && candidate.value === item.value) === index
  );
  for (const type of new Set(contacts.map((item) => item.type))) {
    await supabase
      .from('person_contact_details')
      .update({ is_primary: false })
      .eq('person_id', personId)
      .eq('contact_type', type)
      .eq('is_primary', true);
  }
  for (const item of contacts) {
    const itemSourceUrl = item.retainedSourceUrl || sourceUrl;
    await supabase.from('person_contact_details').upsert({
      person_id: personId,
      contact_type: item.type,
      contact_value: item.value,
      is_primary: true,
      verification_status: itemSourceUrl ? 'sourced' : 'unverified',
      verification_method: itemSourceUrl ? 'web_verification' : null,
      source_label: itemSourceUrl ? 'Web verification' : sourceLabel,
      source_url: itemSourceUrl,
      evidence_excerpt: item.retainedExcerpt || evidenceExcerpt,
    }, { onConflict: 'person_id,contact_type,contact_value' });
  }

  if (includes('current_position') || includes('occupation')) {
    const occupationTitle = contact.current_position || contact.occupation;
    if (occupationTitle) {
      await supabase
        .from('person_experiences')
        .update({ is_current: false })
        .eq('person_id', personId)
        .eq('experience_type', 'occupation')
        .eq('is_current', true);
      const atParts = contact.current_position?.split(/\s+at\s+/i) || [];
      await supabase.from('person_experiences').insert({
        person_id: personId,
        experience_type: 'occupation',
        title: atParts[0] || occupationTitle,
        organization_name: atParts.length > 1 ? atParts.slice(1).join(' at ') : null,
        location_city: contact.location_city || contact.current_location_city || null,
        location_state: contact.location_state || null,
        location_country: contact.current_location_country || null,
        is_current: true,
        source_label: sourceLabel,
        source_url: sourceUrl,
        evidence_excerpt: evidenceExcerpt,
        verification_status: verificationStatus,
      });
    }
  }

  const educationMatch = contact.bio?.match(/studied\s+(.+?)\s+at\s+(.+?)\s+in\s+the United States/i);
  if (educationMatch && includes('bio')) {
    const educationLocation = (contact.suggested_us_connections || []).find((connection) =>
      /study|scholar|university|college|school/i.test(connection.connection_label || '')
    );
    await supabase.from('person_experiences').insert({
      person_id: personId,
      experience_type: 'education',
      title: educationMatch[1].trim(),
      organization_name: educationMatch[2].replace(/[.;,]+$/, '').trim(),
      location_city: educationLocation?.location_city || null,
      location_state: educationLocation?.location_state || null,
      location_country: 'United States',
      is_current: false,
      source_label: sourceLabel,
      source_url: sourceUrl,
      evidence_excerpt: evidenceExcerpt,
      verification_status: verificationStatus,
    });
  }
}

async function checkOrganizationDuplicates(
  organizations: DiscoveredOrganization[]
): Promise<OrganizationDuplicateMatch[]> {
  const { data: approvedOrganizations } = await supabase
    .from('organizations')
    .select('*, organization_us_locations(*, locations(*))');
  if (!approvedOrganizations || approvedOrganizations.length === 0) return [];

  const matches: OrganizationDuplicateMatch[] = [];

  for (const candidate of organizations) {
    const candidateWebsite = normalizeWebsite(candidate.website_url);
    const candidateName = normalizeName(candidate.name);

    for (const organization of approvedOrganizations as Organization[]) {
      const approvedWebsite = normalizeWebsite(organization.website_url);
      const approvedName = normalizeName(organization.name);

      if (candidateWebsite && approvedWebsite && candidateWebsite === approvedWebsite) {
        matches.push({
          organizationId: candidate.id,
          existingOrganization: organization,
          reason: `Website match: ${organization.website_url}`,
        });
        break;
      }

      if (candidateName && candidateName === approvedName) {
        matches.push({
          organizationId: candidate.id,
          existingOrganization: organization,
          reason: `Name match: ${organization.name}`,
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
  sectors: Sector[],
  networkStatus: 'us_based' | 'us_connected_abroad'
): Promise<boolean> {
  const parsed = parseTitleFromName(contact.name || '');
  const origin = await resolveContactOrigin(contact);
  const flemishConnectionText = contact.flemish_connection?.trim() || null;
  const locationId =
    networkStatus === 'us_based'
      ? await resolveOrCreateLocationId(contact.location_city, contact.location_state, {
          createIfMissing: true,
        })
      : null;

  const { data: person, error } = await supabase
    .from('people')
    .insert({
      name: contact.name,
      ...personNamePartsForInsert({
        title: parsed.title,
        firstName: parsed.firstName,
        lastName: parsed.lastName,
      }),
      current_position: contact.current_position || null,
      occupation: contact.occupation || null,
      location_id: locationId,
      us_network_status: networkStatus,
      current_location_city:
        networkStatus === 'us_connected_abroad'
          ? contact.current_location_city || null
          : null,
      current_location_country:
        networkStatus === 'us_connected_abroad'
          ? contact.current_location_country || null
          : null,
      bio: contact.bio || null,
      email: contact.email || null,
      email_verified: contact.email ? false : null,
      linkedin_url: contact.linkedin_url || null,
      website_url: contact.website_url || null,
      profile_photo_url: contact.profile_photo_url || null,
      data_source: approvedPersonDataSource(contact.source, origin.staffLaunchedDiscovery),
      last_verified_at: verifiedAtForApproval(contact),
      created_by_staff_id: origin.staffId,
      created_by_name: origin.name || 'Unknown',
    })
    .select('id')
    .maybeSingle();

  if (error || !person) {
    notifyError(error || new Error('The approved person was not returned.'), {
      hint: 'The contact remains in Verification. No approval status was changed.',
    });
    return false;
  }

  if (networkStatus === 'us_connected_abroad') {
    const connectionRows = (contact.suggested_us_connections || []).filter(
      (connection) => connection.location_city && connection.location_state
    );

    for (const connection of connectionRows) {
      const connectionLocationId = await resolveOrCreateLocationId(
        connection.location_city || null,
        connection.location_state || null,
        { createIfMissing: true }
      );
      if (!connectionLocationId) continue;

      await supabase.from('person_us_connections').insert({
        person_id: person.id,
        location_id: connectionLocationId,
        connection_label: connection.connection_label || null,
        source_url: connection.source_url || contact.source_urls?.[0] || null,
        evidence_excerpt: connection.evidence_excerpt || null,
        confidence: connection.confidence ?? contact.suggested_us_network_confidence ?? null,
      });
    }
  }

  try {
    if (flemishConnectionText) {
      await syncPersonFlemishConnections(person.id, flemishConnectionText);
      await supabase
        .from('person_flemish_connections')
        .update({
          role: 'discovery_review',
          confidence: contact.discovery_confidence ?? null,
          source_url: contact.source_urls?.[0] || null,
          evidence_excerpt: flemishConnectionText,
        })
        .eq('person_id', person.id);
    }
  } catch (err) {
    notifyError(err, { hint: 'Could not save Flemish connections for this discovered contact.' });
    return false;
  }

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
  await retainApprovedPersonSources(person.id, contact, sectors);
  const { error: reviewError } = await supabase
    .from('discovered_contacts')
    .update({
      status: 'approved',
      review_outcome:
        networkStatus === 'us_based'
          ? 'approved_us_based'
          : 'approved_us_connected_abroad',
      approved_person_id: person.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', contact.id);

  kickEmbeddingWorker();
  return !reviewError;
}

function normalizeOrganizationLocations(
  locations: SuggestedOrganizationLocation[] | null | undefined
): SuggestedOrganizationLocation[] {
  if (!Array.isArray(locations)) return [];
  return locations.filter((location) => location.city && location.state);
}

function sectorMatches(candidateSectors: string[] | null | undefined, sectors: Sector[]): Sector[] {
  const wanted = new Set((candidateSectors || []).map((name) => normalizeName(name)));
  if (wanted.size === 0) return [];
  return sectors.filter((sector) => wanted.has(normalizeName(sector.name)));
}

async function writeOrganizationSectors(
  organizationId: string,
  candidateSectors: string[] | null | undefined,
  sectors: Sector[]
) {
  const matched = sectorMatches(candidateSectors, sectors);
  if (matched.length === 0) return;

  await supabase.from('organization_sectors').upsert(
    matched.map((sector) => ({
      organization_id: organizationId,
      sector_id: sector.id,
    })),
    {
      onConflict: 'organization_id,sector_id',
      ignoreDuplicates: true,
    }
  );
}

async function writeOrganizationLocations(
  organizationId: string,
  locations: SuggestedOrganizationLocation[] | null | undefined
) {
  const normalizedLocations = normalizeOrganizationLocations(locations);

  for (const [index, location] of normalizedLocations.entries()) {
    const locationId = await resolveOrCreateLocationId(location.city || null, location.state || null, {
      createIfMissing: true,
    });
    if (!locationId) continue;

    await supabase.from('organization_us_locations').insert({
        organization_id: organizationId,
        location_id: locationId,
        location_role: location.role || 'other',
        label: location.label || (index === 0 ? 'Primary US location' : null),
        description: location.description || null,
        source_url: location.source_url || null,
        evidence_excerpt: location.evidence_excerpt || null,
        confidence: location.confidence ?? null,
        is_primary: index === 0,
      }
    );
  }
}

async function approveOrganization(
  organization: DiscoveredOrganization,
  sectors: Sector[],
  networkStatus: OrganizationUsNetworkStatus
): Promise<boolean> {
  const locations = normalizeOrganizationLocations(organization.us_locations);
  const primaryLocation = locations[0];
  const primaryLocationId = primaryLocation
    ? await resolveOrCreateLocationId(primaryLocation.city || null, primaryLocation.state || null, {
        createIfMissing: true,
      })
    : null;

  const { data: approvedOrganization, error } = await supabase
    .from('organizations')
    .insert({
      name: organization.name,
      type: 'Company',
      description: organization.description || null,
      website_url: organization.website_url || null,
      location_id: primaryLocationId,
      us_network_status: networkStatus,
    })
    .select('id')
    .maybeSingle();

  if (error || !approvedOrganization) return false;

  if (organization.flemish_belgian_relevance) {
    const { error: flemishError } = await supabase.rpc(
      'upsert_organization_flemish_connections_from_text',
      {
        p_organization_id: approvedOrganization.id,
        p_raw_text: organization.flemish_belgian_relevance,
      }
    );
    if (flemishError) return false;

    await supabase
      .from('organization_flemish_connections')
      .update({
        role: 'discovery_review',
        confidence: organization.confidence ?? null,
        source_url: organization.source_urls?.[0] || null,
        evidence_excerpt: organization.flemish_belgian_relevance,
      })
      .eq('organization_id', approvedOrganization.id);
  }

  await writeOrganizationSectors(approvedOrganization.id, organization.sectors, sectors);
  await writeOrganizationLocations(approvedOrganization.id, organization.us_locations);

  const { error: reviewError } = await supabase
    .from('discovered_organizations')
    .update({
      status: 'approved',
      review_outcome: 'approved_new',
      reviewed_at: new Date().toISOString(),
      approved_organization_id: approvedOrganization.id,
    })
    .eq('id', organization.id);

  kickEmbeddingWorker({
    entityType: 'organization',
    organizationIds: [approvedOrganization.id],
  });
  return !reviewError;
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
      if (fieldKey !== 'flemish_connection') {
        updates[fieldKey] = newVal;
      }
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
    const locationId = await resolveOrCreateLocationId(city, state, {
      createIfMissing: true,
    });
    if (locationId) {
      updates.location_id = locationId;
    }
  }

  // Remove location_city/location_state from direct updates (they don't exist on people table)
  delete updates.location_city;
  delete updates.location_state;

  const mergedVerifiedAt = lastVerifiedAtAfterMerge(existingPerson.last_verified_at, contact);
  if (mergedVerifiedAt) updates.last_verified_at = mergedVerifiedAt;

  const mergedFlemishConnection =
    selectedFields.includes('flemish_connection') && updates.flemish_connection !== undefined
      ? String(updates.flemish_connection)
      : selectedFields.includes('flemish_connection')
        ? contact.flemish_connection || null
        : null;
  delete updates.flemish_connection;

  if (Object.keys(updates).length > 0) {
    const { error } = await supabase
      .from('people')
      .update(updates)
      .eq('id', existingPerson.id);
    if (error) return false;
  }

  try {
    if (selectedFields.includes('flemish_connection')) {
      await syncPersonFlemishConnections(
        existingPerson.id,
        mergedFlemishConnection
      );
      if (mergedFlemishConnection) {
        await supabase
          .from('person_flemish_connections')
          .update({
            role: 'discovery_review',
            confidence: contact.discovery_confidence ?? null,
            source_url: contact.source_urls?.[0] || null,
            evidence_excerpt: mergedFlemishConnection,
          })
          .eq('person_id', existingPerson.id);
      }
    }
  } catch (err) {
    notifyError(err, { hint: 'Could not merge Flemish connections into the existing contact.' });
    return false;
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
        {
          onConflict: 'person_id,sector_id',
          ignoreDuplicates: true,
        }
      );
    }
  }
  const retainedFields = new Set(selectedFields);
  if (selectedFields.includes('location_city') || selectedFields.includes('location_state')) {
    retainedFields.add('location');
  }
  if (contact.sectors?.length) retainedFields.add('sectors');
  await retainApprovedPersonSources(existingPerson.id, contact, sectors, retainedFields);
  const { error: reviewError } = await supabase
    .from('discovered_contacts')
    .update({
      status: 'approved',
      review_outcome: 'approved_merge',
      approved_person_id: existingPerson.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', contact.id);

  kickEmbeddingWorker();
  return !reviewError;
}

async function mergeOrganizationIntoExisting(
  organization: DiscoveredOrganization,
  existingOrganization: Organization,
  sectors: Sector[]
): Promise<boolean> {
  const updates: Record<string, unknown> = {};

  if (organization.description && organization.description !== existingOrganization.description) {
    updates.description = existingOrganization.description
      ? `${existingOrganization.description}\n\n${organization.description}`
      : organization.description;
  }
  if (organization.website_url && !existingOrganization.website_url) {
    updates.website_url = organization.website_url;
  }
  if (organization.suggested_us_network_status) {
    updates.us_network_status = organization.suggested_us_network_status;
  }
  if (Object.keys(updates).length > 0) {
    const { error } = await supabase
      .from('organizations')
      .update(updates)
      .eq('id', existingOrganization.id);
    if (error) return false;
  }

  if (organization.flemish_belgian_relevance) {
    const { error: flemishError } = await supabase.rpc(
      'upsert_organization_flemish_connections_from_text',
      {
        p_organization_id: existingOrganization.id,
        p_raw_text: organization.flemish_belgian_relevance,
      }
    );
    if (flemishError) return false;

    await supabase
      .from('organization_flemish_connections')
      .update({
        role: 'discovery_review',
        confidence: organization.confidence ?? null,
        source_url: organization.source_urls?.[0] || null,
        evidence_excerpt: organization.flemish_belgian_relevance,
      })
      .eq('organization_id', existingOrganization.id);
  }

  await writeOrganizationSectors(existingOrganization.id, organization.sectors, sectors);
  await writeOrganizationLocations(existingOrganization.id, organization.us_locations);

  const { error: reviewError } = await supabase
    .from('discovered_organizations')
    .update({
      status: 'approved',
      review_outcome: 'approved_merge',
      reviewed_at: new Date().toISOString(),
      approved_organization_id: existingOrganization.id,
    })
    .eq('id', organization.id);

  kickEmbeddingWorker({
    entityType: 'organization',
    organizationIds: [existingOrganization.id],
  });
  return !reviewError;
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
                              Merge
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
              Fields marked "Merge" will combine both values instead of replacing.
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
              <Earth className="w-3.5 h-3.5 animate-spin" />
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

interface ContactPreviewModalProps {
  contact: DiscoveredContact;
  evidence: DiscoveryEvidence[];
  onClose: () => void;
}

function ContactPreviewModal({ contact, evidence, onClose }: ContactPreviewModalProps) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const payload = contact.verification_payload;
  const status = contact.verification_status ?? 'queued';
  const photo = payload?.profile_photo_url || contact.profile_photo_url;
  const role = payload?.current_role || contact.current_position || contact.occupation;
  const employer = payload?.current_employer;
  const city = payload?.location_city || contact.current_location_city || contact.location_city;
  const state = payload?.location_state || contact.location_state;
  const country = payload?.location_country || contact.current_location_country;
  const location = [city, state, country].filter(Boolean).join(', ');
  const sectors = payload?.professional_sectors?.length
    ? payload.professional_sectors
    : contact.sectors || [];
  const flemishTies = payload?.flemish_ties?.length
    ? payload.flemish_ties
    : contact.flemish_connection
      ? [contact.flemish_connection]
      : [];
  const retainedProfileLinks = [
    ...(contact.linkedin_url ? [{ type: 'linkedin' as const, url: contact.linkedin_url, label: 'LinkedIn', evidence_url: '', evidence_excerpt: '' }] : []),
    ...(contact.website_url ? [{ type: 'website' as const, url: contact.website_url, label: 'Website', evidence_url: '', evidence_excerpt: '' }] : []),
    ...(payload?.profile_links || []),
  ].filter((item, index, items) => items.findIndex((candidate) => candidate.url === item.url) === index);
  const sources = [
    ...(payload?.evidence || []).map((item) => ({ url: item.url, excerpt: item.excerpt })),
    ...(payload?.profile_links || []).map((item) => ({ url: item.evidence_url, excerpt: item.evidence_excerpt })),
    ...evidence.map((item) => ({ url: item.page_url, excerpt: item.evidence_excerpt || '' })),
  ].filter((item, index, items) => item.url && items.findIndex((candidate) => candidate.url === item.url) === index);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-gray-950/45 px-4 py-8 sm:py-12">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="candidate-profile-title"
        className="w-full max-w-5xl overflow-hidden rounded-2xl bg-gray-50 shadow-2xl"
      >
        <header className="border-b border-gray-200 bg-white px-6 py-5 sm:px-8">
          <div className="flex items-start justify-between gap-6">
            <div className="flex min-w-0 items-center gap-4">
              {photo ? (
                <img
                  src={photo}
                  alt={`${contact.name} profile`}
                  className="h-20 w-20 flex-shrink-0 rounded-full border border-gray-200 object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="flex h-20 w-20 flex-shrink-0 items-center justify-center rounded-full bg-yellow-100 text-2xl font-semibold text-yellow-800">
                  {contact.name.slice(0, 1).toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-gray-600">
                    Profile preview
                  </span>
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${status === 'verified' ? 'bg-green-100 text-green-700' : status === 'verifying' ? 'bg-blue-100 text-blue-700' : status === 'failed' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-800'}`}>
                    {status === 'verified' ? 'Verified' : status === 'verifying' ? 'Being verified' : status === 'requested' ? 'Queued for verification' : status === 'failed' ? 'Verification failed' : 'Discovered'}
                  </span>
                </div>
                <h2 id="candidate-profile-title" className="truncate text-2xl font-semibold text-gray-950">
                  {contact.name}
                </h2>
                {role && <p className="mt-1 text-sm text-gray-600">{role}{employer ? ` · ${employer}` : ''}</p>}
                {location && <p className="mt-1 flex items-center gap-1 text-sm text-gray-500"><MapPin className="h-3.5 w-3.5" />{location}</p>}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close profile preview"
              className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-800"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </header>

        <div className="grid gap-6 p-6 sm:p-8 lg:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]">
          <div className="space-y-6">
            <section className="rounded-xl border border-gray-200 bg-white p-6">
              <h3 className="text-base font-semibold text-gray-900">About</h3>
              <p className="mt-4 text-sm leading-7 text-gray-600">{contact.bio || payload?.notes || 'No biography found yet.'}</p>
            </section>

            <section className="rounded-xl border border-gray-200 bg-white p-6">
              <h3 className="text-base font-semibold text-gray-900">Education / Occupation</h3>
              <div className="mt-4 space-y-2 text-sm text-gray-600">
                <p><span className="font-medium text-gray-900">Role:</span> {role || 'Not found'}</p>
                <p><span className="font-medium text-gray-900">Organization:</span> {employer || 'Not found'}</p>
                <p><span className="font-medium text-gray-900">Location:</span> {location || 'Not found'}</p>
              </div>
            </section>

            <section className="rounded-xl border border-gray-200 bg-white p-6">
              <h3 className="text-base font-semibold text-gray-900">Flemish Connection</h3>
              <div className="mt-4 space-y-3">
                {flemishTies.length > 0 ? flemishTies.map((tie) => (
                  <div key={tie} className="rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-gray-800">{tie}</div>
                )) : <p className="text-sm text-gray-500">No Flemish connection verified yet.</p>}
              </div>
            </section>

            <section className="rounded-xl border border-gray-200 bg-white p-6">
              <h3 className="text-base font-semibold text-gray-900">US Connection</h3>
              <div className="mt-4 space-y-3">
                {contact.suggested_us_connections?.length ? contact.suggested_us_connections.map((connection, index) => (
                  <div key={`${connection.connection_label}-${index}`} className="rounded-lg border border-gray-200 px-4 py-3">
                    <p className="text-sm font-medium text-gray-900">{connection.connection_label || 'US connection'}</p>
                    {(connection.location_city || connection.location_state) && <p className="mt-1 text-xs text-gray-500">{[connection.location_city, connection.location_state].filter(Boolean).join(', ')}</p>}
                    {connection.evidence_excerpt && <p className="mt-2 text-sm leading-6 text-gray-600">{connection.evidence_excerpt}</p>}
                    {connection.source_url && <a href={connection.source_url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-blue-600">Source <ExternalLink className="h-3 w-3" /></a>}
                  </div>
                )) : <p className="text-sm text-gray-500">No US connection verified yet.</p>}
              </div>
            </section>

            <section className="rounded-xl border border-gray-200 bg-white p-6">
              <h3 className="text-base font-semibold text-gray-900">Sources</h3>
              <div className="mt-4 space-y-3">
                {sources.length > 0 ? sources.map((source) => (
                  <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer" className="block rounded-lg border border-gray-200 px-4 py-3 hover:border-blue-300">
                    <span className="flex items-center gap-1 text-sm font-medium text-blue-600">Open source <ExternalLink className="h-3.5 w-3.5" /></span>
                    {source.excerpt && <span className="mt-1 block text-xs leading-5 text-gray-500">{source.excerpt}</span>}
                  </a>
                )) : <p className="text-sm text-gray-500">No retained sources yet.</p>}
              </div>
            </section>
          </div>

          <aside className="space-y-6">
            <section className="rounded-xl border border-gray-200 bg-white p-5">
              <h3 className="text-sm font-semibold text-gray-900">Tags</h3>
              <div className="mt-3 flex flex-wrap gap-2">
                {sectors.length > 0 ? sectors.map((sector) => <span key={sector} className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-700">{sector}</span>) : <span className="text-sm text-gray-500">No tags</span>}
                {payload?.belgian_identity_confirmed && <span className="rounded-full bg-yellow-100 px-2.5 py-1 text-xs text-yellow-800">Belgian</span>}
              </div>
            </section>

            <section className="rounded-xl border border-gray-200 bg-white p-5">
              <h3 className="text-sm font-semibold text-gray-900">Contact details</h3>
              <div className="mt-3 space-y-3 text-sm">
                {contact.email && <a href={`mailto:${contact.email}`} className="flex items-center gap-2 text-blue-600"><Mail className="h-4 w-4" />{contact.email}</a>}
                {retainedProfileLinks.map((link) => (
                  <div key={link.url}>
                    <a href={link.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 break-all text-blue-600">
                      {link.type === 'linkedin' ? <Linkedin className="h-4 w-4 flex-shrink-0" /> : <Globe className="h-4 w-4 flex-shrink-0" />}
                      {link.label || (link.type === 'linkedin' ? 'LinkedIn' : link.url)}
                    </a>
                    {link.evidence_url && <a href={link.evidence_url} target="_blank" rel="noopener noreferrer" className="ml-6 mt-1 inline-flex items-center gap-1 text-xs text-gray-500">Source <ExternalLink className="h-3 w-3" /></a>}
                  </div>
                ))}
                {!contact.email && retainedProfileLinks.length === 0 && <p className="text-gray-500">No verified contact details.</p>}
              </div>
            </section>

            <section className="rounded-xl border border-gray-200 bg-white p-5">
              <h3 className="text-sm font-semibold text-gray-900">Record details</h3>
              <dl className="mt-3 space-y-3 text-xs">
                <div><dt className="text-gray-400">Added by</dt><dd className="mt-0.5 text-gray-700">{contact.created_by_name || 'Automated discovery'}</dd></div>
                <div><dt className="text-gray-400">Method</dt><dd className="mt-0.5 text-gray-700">{contactSourceLabel(contact.source)}</dd></div>
                <div><dt className="text-gray-400">Found</dt><dd className="mt-0.5 text-gray-700">{new Date(contact.created_at).toLocaleString()}</dd></div>
                <div><dt className="text-gray-400">Last update</dt><dd className="mt-0.5 text-gray-700">{new Date(contact.last_seen_at || contact.verified_at || contact.created_at).toLocaleString()}</dd></div>
              </dl>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}

// ── Main Panel ─────────────────────────────────────────────────────

interface DiscoveredContactsPanelProps {
  refreshKey?: number;
}

interface BulkApprovalProgress {
  completed: number;
  total: number;
  failed: number;
}

export default function DiscoveredContactsPanel({ refreshKey = 0 }: DiscoveredContactsPanelProps) {
  const [reviewStage, setReviewStage] = useState<'discovered' | 'verified'>('discovered');
  const [peopleOpen, setPeopleOpen] = useState(true);
  const [orgsOpen, setOrgsOpen] = useState(true);
  const [contacts, setContacts] = useState<DiscoveredContact[]>([]);
  const [organizations, setOrganizations] = useState<DiscoveredOrganization[]>([]);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<string | null>(null);
  const [bulkApprovalProgress, setBulkApprovalProgress] =
    useState<BulkApprovalProgress | null>(null);
  const [expandedSources, setExpandedSources] = useState<Set<string>>(
    new Set()
  );
  const [expandedEvidence, setExpandedEvidence] = useState<Set<string>>(
    new Set()
  );
  const [duplicates, setDuplicates] = useState<Map<string, DuplicateMatch>>(
    new Map()
  );
  const [evidenceByContact, setEvidenceByContact] = useState<
    Map<string, DiscoveryEvidence[]>
  >(new Map());
  const [evidenceByOrganization, setEvidenceByOrganization] = useState<
    Map<string, DiscoveryOrganizationEvidence[]>
  >(new Map());
  const [labelsByContact, setLabelsByContact] = useState<
    Map<string, DerivedLabelSuggestion[]>
  >(new Map());
  const [checkingDupes, setCheckingDupes] = useState(false);
  const [organizationDuplicates, setOrganizationDuplicates] = useState<
    Map<string, OrganizationDuplicateMatch>
  >(new Map());
  const [mergeTarget, setMergeTarget] = useState<{
    contact: DiscoveredContact;
    match: DuplicateMatch;
  } | null>(null);
  const [previewContact, setPreviewContact] = useState<DiscoveredContact | null>(null);

  const loadData = useCallback(async () => {
    // Lifecycle is owned by verification_status — NOT the legacy `status`
    // column. Filtering on status='pending' silently hides rows whose status
    // drifted (e.g. 'approved' + verification_status='queued').
    const verificationStates = ['queued', 'requested', 'verifying', 'verified', 'failed'];
    const [contactsRes, organizationsRes, sectorsRes] = await Promise.all([
      supabase
        .from('discovered_contacts')
        .select('*')
        .in('verification_status', verificationStates)
        .is('approved_person_id', null)
        .order('last_seen_at', { ascending: false }),
      supabase
        .from('discovered_organizations')
        .select('*')
        .in('verification_status', verificationStates)
        .is('approved_organization_id', null)
        .order('last_seen_at', { ascending: false }),
      supabase.from('sectors').select('*'),
    ]);

    const loadedContacts = (contactsRes.data || []) as DiscoveredContact[];
    const loadedOrganizations = (organizationsRes.data || []) as DiscoveredOrganization[];
    const loadedSectors = (sectorsRes.data || []) as Sector[];

    setContacts(loadedContacts);
    setOrganizations(loadedOrganizations);
    setSectors(loadedSectors);
    setLoading(false);

    if (loadedContacts.length > 0) {
      const contactIds = loadedContacts.map((contact) => contact.id);
      const [evidenceRes, labelRes] = await Promise.all([
        supabase
          .from('discovery_evidence')
          .select(
            'discovered_contact_id, page_url, page_title, page_type, evidence_excerpt, raw_location_text, raw_flemish_text, raw_role_text, extraction_confidence, created_at'
          )
          .in('discovered_contact_id', contactIds)
          .order('created_at', { ascending: false }),
        supabase
          .from('derived_label_suggestions')
          .select('*')
          .in('discovered_contact_id', contactIds)
          .eq('status', 'pending')
          .order('created_at', { ascending: false }),
      ]);

      const grouped = new Map<string, DiscoveryEvidence[]>();
      (((evidenceRes.data || []) as DiscoveryEvidence[]) || []).forEach((row) => {
        const existing = grouped.get(row.discovered_contact_id) || [];
        existing.push(row);
        grouped.set(row.discovered_contact_id, existing);
      });
      setEvidenceByContact(grouped);

      const labelMap = new Map<string, DerivedLabelSuggestion[]>();
      normalizeDerivedLabelSuggestions(labelRes.data || []).forEach((row) => {
        const contactId = row.discovered_contact_id;
        if (!contactId) return;
        const existing = labelMap.get(contactId) || [];
        existing.push(row);
        labelMap.set(contactId, existing);
      });
      setLabelsByContact(labelMap);
    } else {
      setEvidenceByContact(new Map());
      setLabelsByContact(new Map());
    }

    if (loadedOrganizations.length > 0) {
      const organizationIds = loadedOrganizations.map((organization) => organization.id);
      const { data: organizationEvidence } = await supabase
        .from('discovered_organization_evidence')
        .select(
          'discovered_organization_id, page_url, page_title, page_type, source_type, source_url, evidence_excerpt, raw_relevance_text, raw_location_text, raw_sector_text, normalized_location_city, normalized_location_state, normalized_location_country, confidence, created_at'
        )
        .in('discovered_organization_id', organizationIds)
        .order('created_at', { ascending: false });

      const grouped = new Map<string, DiscoveryOrganizationEvidence[]>();
      (((organizationEvidence || []) as DiscoveryOrganizationEvidence[]) || []).forEach((row) => {
        const existing = grouped.get(row.discovered_organization_id) || [];
        existing.push(row);
        grouped.set(row.discovered_organization_id, existing);
      });
      setEvidenceByOrganization(grouped);
    } else {
      setEvidenceByOrganization(new Map());
    }

    // Check for duplicates
    if (loadedContacts.length > 0 || loadedOrganizations.length > 0) {
      setCheckingDupes(true);
      const [matches, organizationMatches] = await Promise.all([
        loadedContacts.length > 0 ? checkDuplicates(loadedContacts) : Promise.resolve([]),
        loadedOrganizations.length > 0
          ? checkOrganizationDuplicates(loadedOrganizations)
          : Promise.resolve([]),
      ]);
      const dupeMap = new Map<string, DuplicateMatch>();
      for (const m of matches) {
        dupeMap.set(m.contactId, m);
      }
      setDuplicates(dupeMap);
      const organizationDupeMap = new Map<string, OrganizationDuplicateMatch>();
      for (const match of organizationMatches) {
        organizationDupeMap.set(match.organizationId, match);
      }
      setOrganizationDuplicates(organizationDupeMap);
      setCheckingDupes(false);
    } else {
      setDuplicates(new Map());
      setOrganizationDuplicates(new Map());
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData, refreshKey]);

  // Realtime: refresh on verification_status transitions or hard-deletes by agent-verify.
  useEffect(() => {
    const channel = supabase
      .channel('discovered-verification')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'discovered_contacts' },
        () => loadData(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'discovered_organizations' },
        () => loadData(),
      )
      .subscribe((status, err) => {
        if (err) {
          console.warn('[verification realtime]', status, err);
        } else {
          console.debug('[verification realtime]', status);
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadData]);

  const handleReject = useCallback(
    async (contact: DiscoveredContact) => {
      setActionId(contact.id);
      await supabase.from('discovered_contacts').delete().eq('id', contact.id);
      setContacts((prev) => prev.filter((c) => c.id !== contact.id));
      setDuplicates((prev) => {
        const next = new Map(prev);
        next.delete(contact.id);
        return next;
      });
      setActionId(null);
    },
    [],
  );

  const handleApproveAs = useCallback(
    async (
      contact: DiscoveredContact,
      networkStatus: 'us_based' | 'us_connected_abroad'
    ) => {
      setActionId(contact.id);
      const ok = await approveContact(contact, sectors, networkStatus);
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

  const handleApproveAll = useCallback(async () => {
    // Only approve non-duplicates with high-confidence scope suggestions in bulk.
    const nonDupes = contacts.filter((contact) =>
      isContactReadyForBulkApproval(contact, duplicates.has(contact.id))
    );
    if (nonDupes.length === 0) return;

    let completed = 0;
    let failed = 0;
    setActionId('all');
    setBulkApprovalProgress({ completed, total: nonDupes.length, failed });

    for (const contact of nonDupes) {
      let approved = false;
      try {
        approved = await approveContact(
          contact,
          sectors,
          contact.suggested_us_network_status === 'us_connected_abroad'
            ? 'us_connected_abroad'
            : 'us_based'
        );
      } catch (error) {
        notifyError(error, {
          hint: `${contact.name} remains in Verification and the remaining contacts will still be processed.`,
        });
      }

      completed += 1;
      if (!approved) failed += 1;
      setBulkApprovalProgress({ completed, total: nonDupes.length, failed });

      if (approved) {
        setContacts((previous) => previous.filter((item) => item.id !== contact.id));
        setDuplicates((previous) => {
          const next = new Map(previous);
          next.delete(contact.id);
          return next;
        });
      }
    }

    await loadData();
    if (failed === 0) {
      notifySuccess(
        `Added ${nonDupes.length} verified contact${nonDupes.length === 1 ? '' : 's'} to the network.`,
      );
    } else {
      notifyError(new Error(`${failed} of ${nonDupes.length} contacts could not be added.`), {
        hint: 'Failed contacts remain in Verification so you can retry them.',
      });
    }
    setBulkApprovalProgress(null);
    setActionId(null);
  }, [contacts, sectors, duplicates, loadData]);

  const handleVerifyQueued = useCallback(async () => {
    const queued = contacts.filter((contact) => {
      const status = contact.verification_status ?? 'queued';
      return status === 'queued' || status === 'failed';
    });
    if (queued.length === 0) return;

    setActionId('verify-queued');
    try {
      const { data, error } = await supabase.functions.invoke('agent-scheduler', {
        body: {
          action: 'verify_discovered',
          contact_ids: queued.map((contact) => contact.id),
          organization_ids: [],
        },
      });
      if (error) throw error;

      const started = Number(
        (data as { verification?: { contacts_enqueued?: number } } | null)
          ?.verification?.contacts_enqueued ?? 0,
      );
      if (started === 0) {
        throw new Error('No contacts were queued for verification.');
      }

      notifySuccess(`Queued ${started} contact${started === 1 ? '' : 's'} for verification.`, {
        hint: 'They are verified a few at a time in the background and move to Verified when done. You can leave this page or start a new Discovery meanwhile.',
      });
      await loadData();
    } catch (error) {
      notifyError(error, {
        hint: 'Queued contacts were left unchanged. Try again or check Runs for the failed verification batch.',
      });
    } finally {
      setActionId(null);
    }
  }, [contacts, loadData]);

  const handleVerifyContact = useCallback(async (contact: DiscoveredContact) => {
    setActionId(`verify-${contact.id}`);
    try {
      const { data, error } = await supabase.functions.invoke('agent-scheduler', {
        body: {
          action: 'verify_discovered',
          contact_ids: [contact.id],
          organization_ids: [],
        },
      });
      if (error) throw error;
      const started = Number(
        (data as { verification?: { contacts_enqueued?: number } } | null)
          ?.verification?.contacts_enqueued ?? 0,
      );
      if (started !== 1) throw new Error('This contact could not be queued for verification.');
      notifySuccess(`${contact.name} is queued for verification.`);
      await loadData();
    } catch (error) {
      notifyError(error, { hint: `${contact.name} remains in Discovered.` });
    } finally {
      setActionId(null);
    }
  }, [loadData]);

  const handleVerifyOrganizations = useCallback(async () => {
    const queued = organizations.filter((organization) => {
      const status = organization.verification_status ?? 'queued';
      return status === 'queued' || status === 'failed';
    });
    if (queued.length === 0) return;
    setActionId('verify-organizations');
    try {
      const { data, error } = await supabase.functions.invoke('agent-scheduler', {
        body: {
          action: 'verify_discovered',
          contact_ids: [],
          organization_ids: queued.map((organization) => organization.id),
        },
      });
      if (error) throw error;
      const started = Number(
        (data as { verification?: { organizations_enqueued?: number } } | null)
          ?.verification?.organizations_enqueued ?? 0,
      );
      if (started === 0) throw new Error('No organizations were queued for verification.');
      notifySuccess(`Queued ${started} organization${started === 1 ? '' : 's'} for verification.`, {
        hint: 'They are verified a few at a time in the background and move to Verified when done. You can leave this page or start a new Discovery meanwhile.',
      });
      await loadData();
    } catch (error) {
      notifyError(error, { hint: 'The organizations remain in Discovered.' });
    } finally {
      setActionId(null);
    }
  }, [organizations, loadData]);

  const handleVerifyOrganization = useCallback(async (organization: DiscoveredOrganization) => {
    setActionId(`verify-${organization.id}`);
    try {
      const { data, error } = await supabase.functions.invoke('agent-scheduler', {
        body: {
          action: 'verify_discovered',
          contact_ids: [],
          organization_ids: [organization.id],
        },
      });
      if (error) throw error;
      const started = Number(
        (data as { verification?: { organizations_enqueued?: number } } | null)
          ?.verification?.organizations_enqueued ?? 0,
      );
      if (started !== 1) throw new Error('This organization could not be queued for verification.');
      notifySuccess(`${organization.name} is queued for verification.`);
      await loadData();
    } catch (error) {
      notifyError(error, { hint: `${organization.name} remains in Discovered.` });
    } finally {
      setActionId(null);
    }
  }, [loadData]);

  const handleRejectAll = useCallback(async () => {
    // Only verified rows are eligible for rejection. Non-verified rows are in
    // the verify pipeline and must not be hard-deleted by a bulk reject.
    const eligible = contacts.filter(
      (c) => (c.verification_status ?? 'queued') === 'verified',
    );
    if (eligible.length === 0) {
      window.alert('No verified rows to reject. Queued/verifying rows must complete verification first.');
      return;
    }
    const reason = window.prompt(
      `Reject ${eligible.length} verified contact${eligible.length !== 1 ? 's' : ''}? Enter an optional rejection reason:`,
      '',
    );
    if (reason === null) return; // user cancelled
    setActionId('all');
    const ids = eligible.map((c) => c.id);
    await supabase
      .from('discovered_contacts')
      .update({ reject_reason: reason || 'bulk_reject', reviewed_at: new Date().toISOString() })
      .in('id', ids);
    await supabase.from('discovered_contacts').delete().in('id', ids);
    setContacts((prev) => prev.filter((c) => !ids.includes(c.id)));
    setDuplicates((prev) => {
      const next = new Map(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });
    setActionId(null);
  }, [contacts]);

  const handleRejectOrganization = useCallback(
    async (organization: DiscoveredOrganization) => {
      setActionId(organization.id);
      await supabase.from('discovered_organizations').delete().eq('id', organization.id);
      setOrganizations((prev) => prev.filter((item) => item.id !== organization.id));
      setOrganizationDuplicates((prev) => {
        const next = new Map(prev);
        next.delete(organization.id);
        return next;
      });
      setActionId(null);
    },
    [],
  );

  const handleApproveOrganization = useCallback(
    async (organization: DiscoveredOrganization) => {
      setActionId(organization.id);
      const ok = await approveOrganization(
        organization,
        sectors,
        organization.suggested_us_network_status || 'us_organization_connected_to_flanders'
      );
      if (ok) {
        setOrganizations((prev) => prev.filter((item) => item.id !== organization.id));
        setOrganizationDuplicates((prev) => {
          const next = new Map(prev);
          next.delete(organization.id);
          return next;
        });
      }
      setActionId(null);
    },
    [sectors]
  );

  const handleMergeOrganization = useCallback(
    async (organization: DiscoveredOrganization, match: OrganizationDuplicateMatch) => {
      setActionId(organization.id);
      const ok = await mergeOrganizationIntoExisting(
        organization,
        match.existingOrganization,
        sectors
      );
      if (ok) {
        setOrganizations((prev) => prev.filter((item) => item.id !== organization.id));
        setOrganizationDuplicates((prev) => {
          const next = new Map(prev);
          next.delete(organization.id);
          return next;
        });
      }
      setActionId(null);
    },
    [sectors]
  );

  const handleRejectAllOrganizations = useCallback(async () => {
    const eligible = organizations.filter(
      (o) => (o.verification_status ?? 'queued') === 'verified',
    );
    if (eligible.length === 0) {
      window.alert('No verified organizations to reject. Queued/verifying rows must complete verification first.');
      return;
    }
    const reason = window.prompt(
      `Reject ${eligible.length} verified organization${eligible.length !== 1 ? 's' : ''}? Enter an optional rejection reason:`,
      '',
    );
    if (reason === null) return;
    setActionId('all-organizations');
    const ids = eligible.map((o) => o.id);
    await supabase
      .from('discovered_organizations')
      .update({ reject_reason: reason || 'bulk_reject', reviewed_at: new Date().toISOString() })
      .in('id', ids);
    await supabase.from('discovered_organizations').delete().in('id', ids);
    setOrganizations((prev) => prev.filter((o) => !ids.includes(o.id)));
    setOrganizationDuplicates((prev) => {
      const next = new Map(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });
    setActionId(null);
  }, [organizations]);

  const handleApproveAllOrganizations = useCallback(async () => {
    setActionId('all-organizations');
    const verifiedOrgs = organizations.filter(
      (organization) =>
        (organization.verification_status ?? 'verified') === 'verified' &&
        !organizationDuplicates.has(organization.id),
    );
    for (const organization of verifiedOrgs) {
      await approveOrganization(
        organization,
        sectors,
        organization.suggested_us_network_status || 'us_organization_connected_to_flanders',
      );
    }
    await loadData();
    setActionId(null);
  }, [organizations, organizationDuplicates, sectors, loadData]);

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
    await handleApproveAs(
      contact,
      contact.suggested_us_network_status === 'us_connected_abroad'
        ? 'us_connected_abroad'
        : 'us_based'
    );
  }, [mergeTarget, handleApproveAs]);

  const toggleSources = (id: string) => {
    setExpandedSources((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleEvidence = (id: string) => {
    setExpandedEvidence((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Earth className="w-6 h-6 animate-spin text-yellow-600" />
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
  const verifiableContactCount = contacts.filter(
    (contact) => ['queued', 'failed'].includes(contact.verification_status ?? 'queued'),
  ).length;
  const requestedContactCount = contacts.filter(
    (contact) => contact.verification_status === 'requested',
  ).length;
  const discoveredContacts = contacts.filter(
    (contact) => (contact.verification_status ?? 'queued') !== 'verified',
  );
  const verifiedContacts = contacts.filter(
    (contact) => contact.verification_status === 'verified',
  );
  const visibleContacts = reviewStage === 'discovered' ? discoveredContacts : verifiedContacts;
  const verifyingContactCount = contacts.filter(
    (contact) => contact.verification_status === 'verifying',
  ).length;
  const readyContactCount = contacts.filter((contact) =>
    isContactReadyForBulkApproval(contact, duplicates.has(contact.id))
  ).length;
  const organizationDupeCount = organizationDuplicates.size;
  const organizationNewCount = organizations.length - organizationDupeCount;
  const verifiableOrganizationCount = organizations.filter(
    (organization) => ['queued', 'failed'].includes(organization.verification_status ?? 'queued'),
  ).length;
  const requestedOrganizationCount = organizations.filter(
    (organization) => organization.verification_status === 'requested',
  ).length;
  const discoveredOrganizations = organizations.filter(
    (organization) => (organization.verification_status ?? 'queued') !== 'verified',
  );
  const verifiedOrganizations = organizations.filter(
    (organization) => organization.verification_status === 'verified',
  );
  const readyOrganizationCount = verifiedOrganizations.filter(
    (organization) => !organizationDuplicates.has(organization.id),
  ).length;
  const visibleOrganizations = reviewStage === 'discovered'
    ? discoveredOrganizations
    : verifiedOrganizations;
  const verifyingOrganizationCount = organizations.filter(
    (organization) => organization.verification_status === 'verifying',
  ).length;
  const verifyingTotal = verifyingContactCount + verifyingOrganizationCount;
  const waitingTotal = requestedContactCount + requestedOrganizationCount;
  const discoveredTotal = discoveredContacts.length + discoveredOrganizations.length;
  const verifiedTotal = verifiedContacts.length + verifiedOrganizations.length;
  const candidateTotal = discoveredTotal + verifiedTotal;

  return (
    <div className="space-y-6">
      {previewContact && (
        <ContactPreviewModal
          contact={previewContact}
          evidence={evidenceByContact.get(previewContact.id) || []}
          onClose={() => setPreviewContact(null)}
        />
      )}

      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="max-w-3xl">
          <h2 className="text-lg font-semibold text-gray-950">Verification workflow</h2>
          <p className="mt-1 text-sm leading-6 text-gray-500">
            Discovery only finds candidates. Choose who to verify, review the deeper search, then add verified records to the network.
          </p>
        </div>
        <ol className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <li className="rounded-xl border border-yellow-200 bg-yellow-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-yellow-800">1 · Discovered</p>
            <p className="mt-2 text-2xl font-semibold text-gray-950">{candidateTotal}</p>
            <p className="mt-1 text-xs text-gray-600">All candidates from every Discovery run</p>
          </li>
          <li className="rounded-xl border border-yellow-300 bg-yellow-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-yellow-900">2 · Queued for verification</p>
            <p className="mt-2 text-2xl font-semibold text-gray-950">{waitingTotal}</p>
            <p className="mt-1 text-xs text-gray-600">Verify clicked, waiting for a slot</p>
          </li>
          <li className={`rounded-xl border p-4 ${verifyingTotal > 0 ? 'border-blue-300 bg-blue-50' : 'border-gray-200 bg-gray-50'}`}>
            <p className={`text-xs font-semibold uppercase tracking-wide ${verifyingTotal > 0 ? 'text-blue-700' : 'text-gray-500'}`}>3 · Being verified</p>
            <p className="mt-2 flex items-center gap-2 text-2xl font-semibold text-gray-950">{verifyingTotal}{verifyingTotal > 0 && <Earth className="h-4 w-4 animate-spin text-blue-600" />}</p>
            <p className="mt-1 text-xs text-gray-600">Deeper source search running</p>
          </li>
          <li className="rounded-xl border border-green-200 bg-green-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-green-700">4 · Verified</p>
            <p className="mt-2 text-2xl font-semibold text-gray-950">{verifiedTotal}</p>
            <p className="mt-1 text-xs text-gray-600">Ready for review</p>
          </li>
          <li className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">5 · Add</p>
            <p className="mt-2 text-sm font-semibold text-gray-900">Add to network</p>
            <p className="mt-1 text-xs text-gray-600">Only after verification</p>
          </li>
        </ol>

        <div className="mt-6 inline-flex rounded-lg bg-gray-100 p-1" role="tablist" aria-label="Verification stage">
          <button
            type="button"
            role="tab"
            aria-selected={reviewStage === 'discovered'}
            onClick={() => setReviewStage('discovered')}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${reviewStage === 'discovered' ? 'bg-white text-gray-950 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}
          >
            Discovered <span className="ml-1 text-xs">{discoveredTotal}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={reviewStage === 'verified'}
            onClick={() => setReviewStage('verified')}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${reviewStage === 'verified' ? 'bg-white text-gray-950 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}
          >
            Verified <span className="ml-1 text-xs">{verifiedTotal}</span>
          </button>
        </div>
      </section>

      {reviewStage === 'discovered' && verifyingTotal + waitingTotal > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 px-5 py-4 text-sm text-blue-900">
          <Earth className="h-4 w-4 flex-shrink-0 animate-spin" />
          <span>
            <strong>{verifyingTotal}</strong> being verified
            {waitingTotal > 0 && <>, <strong>{waitingTotal}</strong> queued</>}.
            {' '}This runs in the background, a few records at a time. You can start a new Discovery meanwhile.
          </span>
        </div>
      )}

      <div className="rounded-xl border border-gray-100 bg-white shadow-sm">
        <button
          onClick={() => setPeopleOpen((v) => !v)}
          className="flex w-full items-center gap-2 px-6 py-4 text-left hover:bg-gray-50"
        >
          {peopleOpen
            ? <ChevronDown className="h-4 w-4 text-gray-400" />
            : <ChevronRight className="h-4 w-4 text-gray-400" />}
          <Users className="h-4 w-4 text-gray-400" />
          <h2 className="text-lg font-semibold text-gray-900">{reviewStage === 'discovered' ? 'Discovered People' : 'Verified People'}</h2>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">
            {visibleContacts.length}
          </span>
        </button>
        {peopleOpen && (
          <div className="space-y-4 px-6 pb-6">
            {visibleContacts.length === 0 ? (
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-6 text-center">
                <p className="text-sm text-gray-500">No {reviewStage} people</p>
                <p className="mt-1 text-xs text-gray-400">
                  Start a Discovery run or add/import people from the Discovery tab.
                </p>
              </div>
            ) : (
              <>
      {/* Bulk actions */}
      <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 flex items-center justify-between">
        <div className="text-sm text-gray-700">
          <span className="font-semibold text-gray-900">
            {visibleContacts.length}
          </span>{' '}
          {reviewStage} contact{visibleContacts.length !== 1 ? 's' : ''}
          {checkingDupes ? (
            <span className="ml-2 text-xs text-gray-400">
              <Earth className="w-3 h-3 animate-spin inline mr-1" />
              Checking duplicates...
            </span>
          ) : reviewStage === 'verified' && dupeCount > 0 ? (
            <span className="ml-2 text-xs text-amber-600">
              ({dupeCount} duplicate{dupeCount !== 1 ? 's' : ''}, {newCount}{' '}
              new)
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {reviewStage === 'discovered' && verifiableContactCount > 0 && (
            <button
              onClick={handleVerifyQueued}
              disabled={actionId !== null}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors disabled:opacity-50"
            >
              {actionId === 'verify-queued' ? (
                <Earth className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              Verify all ({verifiableContactCount})
            </button>
          )}
          {reviewStage === 'verified' && <button
            onClick={handleApproveAll}
            disabled={actionId !== null || readyContactCount === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-green-700 bg-green-50 hover:bg-green-100 rounded-lg transition-colors disabled:opacity-50"
          >
            {bulkApprovalProgress ? (
              <Earth className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Check className="w-3.5 h-3.5" />
            )}
            {bulkApprovalProgress
              ? `Adding ${bulkApprovalProgress.completed}/${bulkApprovalProgress.total}`
              : `Add Verified (${readyContactCount})`}
          </button>
          }
          {reviewStage === 'verified' && <button
            onClick={handleRejectAll}
            disabled={actionId !== null || verifiedContacts.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded-lg transition-colors disabled:opacity-50"
          >
            <X className="w-3.5 h-3.5" />
            Reject Verified ({verifiedContacts.length})
          </button>
          }
        </div>
      </div>

      {/* Contact cards */}
      {visibleContacts.map((contact) => {
        const isActioning = actionId === contact.id || actionId === `verify-${contact.id}` || actionId === 'all';
        const dupeMatch = duplicates.get(contact.id);
        const evidenceRows = evidenceByContact.get(contact.id) || [];
        const derivedLabels = labelsByContact.get(contact.id) || [];
        const evidenceCount = contact.evidence_count || evidenceRows.length;
        const confidence =
          typeof contact.discovery_confidence === 'number'
            ? Math.round(contact.discovery_confidence * 100)
            : null;

        // Safer default: a NULL must NOT silently bypass the verify gate.
        const verificationStatus = contact.verification_status ?? 'queued';
        const isVerified = verificationStatus === 'verified';

        return (
          <div
            key={contact.id}
            className={`bg-white rounded-xl border transition-all px-5 py-4 ${
              !isVerified
                ? verificationStatus === 'verifying'
                  ? 'border-blue-300 bg-blue-50/30 shadow-sm'
                  : 'border-gray-200 hover:border-gray-300'
                : dupeMatch
                  ? 'border-amber-200 bg-amber-50/20'
                  : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            {!isVerified && (
              <div className={`flex items-center gap-1.5 mb-3 px-2.5 py-1.5 rounded-lg ${verificationStatus === 'failed' ? 'bg-red-100' : 'bg-slate-100'}`}>
                {verificationStatus === 'failed' ? (
                  <AlertTriangle className="w-3 h-3 text-red-600 flex-shrink-0" />
                ) : verificationStatus === 'verifying' ? (
                  <Earth className="w-3 h-3 text-slate-500 flex-shrink-0 animate-spin" />
                ) : (
                  <Clock3 className="w-3 h-3 text-slate-500 flex-shrink-0" />
                )}
                <span className={`text-[11px] font-medium ${verificationStatus === 'failed' ? 'text-red-700' : 'text-slate-600'}`}>
                  {verificationStatus === 'failed'
                    ? 'Verification failed — review or retry'
                    : verificationStatus === 'verifying'
                      ? 'Verifying — checking sources and Flemish ties…'
                      : verificationStatus === 'requested'
                        ? 'Queued for verification'
                        : 'Not verified yet'}
                </span>
              </div>
            )}
            {dupeMatch && isVerified && (
              <div className="flex items-center gap-1.5 mb-3 px-2.5 py-1.5 bg-amber-100/60 rounded-lg">
                <AlertTriangle className="w-3 h-3 text-amber-600 flex-shrink-0" />
                <span className="text-[11px] text-amber-700 font-medium">
                  Possible duplicate: {dupeMatch.reason}
                </span>
              </div>
            )}

            <div className="flex items-start justify-between gap-4">
              {contact.profile_photo_url && (
                <img
                  src={contact.profile_photo_url}
                  alt={`${contact.name} profile`}
                  className="h-12 w-12 flex-shrink-0 rounded-full border border-gray-200 object-cover"
                  loading="lazy"
                  referrerPolicy="no-referrer"
                />
              )}
              <div className="min-w-0 flex-1 space-y-1.5">
                {/* Name + occupation */}
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => setPreviewContact(contact)}
                    className="text-left text-sm font-semibold text-gray-900 underline-offset-2 hover:text-blue-700 hover:underline"
                  >
                    {contact.name}
                  </button>
                  {contact.occupation && (
                    <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 bg-yellow-50 text-yellow-800 rounded font-medium">
                      <Tag className="w-2.5 h-2.5" />
                      {contact.occupation}
                    </span>
                  )}
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                      contact.source === 'linkedin_search'
                        ? 'bg-blue-50 text-blue-600'
                      : contact.source === 'frontier_page'
                        ? 'bg-yellow-50 text-yellow-800'
                        : 'bg-amber-50 text-amber-600'
                    }`}
                  >
                    {contactSourceLabel(contact.source)}
                  </span>
                  {evidenceCount > 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded font-medium">
                      {evidenceCount} evidence
                    </span>
                  )}
                  {confidence !== null && confidence > 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 bg-purple-50 text-purple-600 rounded font-medium">
                      {confidence}% confidence
                    </span>
                  )}
                  {contact.suggested_us_network_status && (
                    <span className="text-[10px] px-1.5 py-0.5 bg-indigo-50 text-indigo-600 rounded font-medium">
                      {contact.suggested_us_network_status === 'us_connected_abroad'
                        ? 'US-connected abroad'
                        : 'US-based'}
                    </span>
                  )}
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
                    <span
                      className="line-clamp-2 text-xs text-yellow-600"
                      title={contact.flemish_connection}
                    >
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

                {derivedLabels.length > 0 && (
                  <div className="pt-1">
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                      Derived labels
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {derivedLabels.slice(0, 6).map((label) => {
                        const displayValue =
                          label.label_type === 'us_location'
                            ? getDerivedLocationSummary(label)
                            : label.label_value;

                        return (
                          <span
                            key={label.id}
                            className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-700"
                          >
                            {displayValue}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}

                {evidenceRows.length > 0 && (
                  <div className="pt-0.5">
                    <button
                      onClick={() => toggleEvidence(contact.id)}
                      className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      {expandedEvidence.has(contact.id) ? (
                        <ChevronUp className="w-2.5 h-2.5" />
                      ) : (
                        <ChevronDown className="w-2.5 h-2.5" />
                      )}
                      Evidence
                    </button>
                    {expandedEvidence.has(contact.id) && (
                      <div className="mt-2 space-y-2">
                        {evidenceRows.slice(0, 5).map((evidence, index) => (
                          <div
                            key={`${evidence.page_url}-${index}`}
                            className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <p className="text-[11px] font-medium text-gray-700 truncate">
                                  {evidence.page_title || evidence.page_url}
                                </p>
                                <p className="text-[10px] text-gray-400">
                                  {evidence.page_type || 'page'} ·{' '}
                                  {evidence.extraction_confidence
                                    ? `${Math.round(
                                        evidence.extraction_confidence * 100
                                      )}% confidence`
                                    : 'confidence n/a'}
                                </p>
                              </div>
                              <a
                                href={evidence.page_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[10px] text-blue-500 hover:text-blue-600 flex-shrink-0"
                              >
                                Open
                              </a>
                            </div>
                            {evidence.evidence_excerpt && (
                              <p className="mt-1.5 text-[11px] text-gray-600 leading-relaxed">
                                {evidence.evidence_excerpt}
                              </p>
                            )}
                            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-gray-400">
                              {evidence.raw_role_text && (
                                <span>Role: {evidence.raw_role_text}</span>
                              )}
                              {evidence.raw_location_text && (
                                <span>
                                  Location: {evidence.raw_location_text}
                                </span>
                              )}
                              {evidence.raw_flemish_text && (
                                <span>
                                  Flemish: {evidence.raw_flemish_text}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                        {evidenceRows.length > 5 && (
                          <p className="text-[10px] text-gray-400">
                            Showing 5 of {evidenceRows.length} evidence items.
                          </p>
                        )}
                      </div>
                    )}
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
                  <button
                    type="button"
                    onClick={() => setPreviewContact(contact)}
                    className="flex items-center gap-1 rounded-lg bg-gray-100 px-2.5 py-1.5 text-[11px] font-medium text-gray-700 transition-colors hover:bg-gray-200"
                  >
                    <Eye className="h-3 w-3" />
                    Preview profile
                  </button>
                  {!isVerified && (verificationStatus === 'verifying' || verificationStatus === 'requested') ? (
                    <span className="text-[11px] text-slate-500 italic">
                      {verificationStatus === 'verifying' ? 'Verification in progress' : 'Waiting for verification'}
                    </span>
                  ) : !isVerified ? (
                    <button
                      type="button"
                      onClick={() => void handleVerifyContact(contact)}
                      disabled={isActioning}
                      className="flex items-center gap-1 rounded-lg bg-blue-50 px-2.5 py-1.5 text-[11px] font-medium text-blue-700 transition-colors hover:bg-blue-100 disabled:opacity-50"
                    >
                      {isActioning ? <Earth className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                      {verificationStatus === 'failed' ? 'Retry verification' : 'Verify'}
                    </button>
                  ) : dupeMatch ? (
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
                      onClick={() =>
                        handleApproveAs(
                          contact,
                          contact.suggested_us_network_status ===
                            'us_connected_abroad'
                            ? 'us_connected_abroad'
                            : 'us_based'
                        )
                      }
                      disabled={isActioning}
                      className="flex items-center gap-1 text-[11px] font-medium px-2.5 py-1.5 text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-lg transition-colors disabled:opacity-50"
                    >
                      {isActioning ? (
                        <Earth className="w-3 h-3 animate-spin" />
                      ) : (
                        <UserPlus className="w-3 h-3" />
                      )}
                      Add Anyway
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() =>
                      handleApproveAs(
                        contact,
                        contact.suggested_us_network_status === 'us_connected_abroad'
                          ? 'us_connected_abroad'
                          : 'us_based',
                      )
                    }
                    disabled={isActioning}
                    className="flex items-center gap-1 text-[11px] font-medium px-2.5 py-1.5 text-green-700 bg-green-50 hover:bg-green-100 rounded-lg transition-colors disabled:opacity-50"
                  >
                    {isActioning ? (
                      <Earth className="w-3 h-3 animate-spin" />
                    ) : (
                      <UserPlus className="w-3 h-3" />
                    )}
                    Add
                  </button>
                )}
                {isVerified && (
                  <button
                    onClick={() => handleReject(contact)}
                    disabled={isActioning}
                    className="flex items-center gap-1 text-[11px] font-medium px-2.5 py-1.5 text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors disabled:opacity-50"
                  >
                    <X className="w-3 h-3" />
                    Reject
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}
              </>
            )}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-gray-100 bg-white shadow-sm">
        <button
          onClick={() => setOrgsOpen((v) => !v)}
          className="flex w-full items-center gap-2 px-6 py-4 text-left hover:bg-gray-50"
        >
          {orgsOpen
            ? <ChevronDown className="h-4 w-4 text-gray-400" />
            : <ChevronRight className="h-4 w-4 text-gray-400" />}
          <Building2 className="h-4 w-4 text-gray-400" />
          <h2 className="text-lg font-semibold text-gray-900">{reviewStage === 'discovered' ? 'Discovered Organizations' : 'Verified Organizations'}</h2>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">
            {visibleOrganizations.length}
          </span>
        </button>
        {orgsOpen && (
          <div className="space-y-4 px-6 pb-6">
            {visibleOrganizations.length === 0 ? (
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-6 text-center">
                <p className="text-sm text-gray-500">No {reviewStage} organizations</p>
                <p className="mt-1 text-xs text-gray-400">
                  Start a Discovery run or add/import organizations from the Discovery tab.
                </p>
              </div>
            ) : (
              <>
          <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 flex items-center justify-between">
            <div className="text-sm text-gray-700">
              <span className="font-semibold text-gray-900">{visibleOrganizations.length}</span>{' '}
              {reviewStage} organization{visibleOrganizations.length !== 1 ? 's' : ''}
              {checkingDupes ? (
                <span className="ml-2 text-xs text-gray-400">
                  <Earth className="w-3 h-3 animate-spin inline mr-1" />
                  Checking duplicates...
                </span>
              ) : reviewStage === 'verified' && organizationDupeCount > 0 ? (
                <span className="ml-2 text-xs text-amber-600">
                  ({organizationDupeCount} duplicate{organizationDupeCount !== 1 ? 's' : ''},{' '}
                  {organizationNewCount} new)
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              {reviewStage === 'discovered' && verifiableOrganizationCount > 0 && <button
                type="button"
                onClick={() => void handleVerifyOrganizations()}
                disabled={actionId !== null}
                className="flex items-center gap-1.5 rounded-lg bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-100 disabled:opacity-50"
              >
                {actionId === 'verify-organizations' ? <Earth className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                Verify all ({verifiableOrganizationCount})
              </button>}
              {reviewStage === 'verified' && <button
                onClick={handleApproveAllOrganizations}
                disabled={actionId !== null || readyOrganizationCount === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-green-700 bg-green-50 hover:bg-green-100 rounded-lg transition-colors disabled:opacity-50"
              >
                <Check className="w-3.5 h-3.5" />
                Add Verified ({readyOrganizationCount})
              </button>}
              {reviewStage === 'verified' && <button
                onClick={handleRejectAllOrganizations}
                disabled={actionId !== null || verifiedOrganizations.length === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded-lg transition-colors disabled:opacity-50"
              >
                <X className="w-3.5 h-3.5" />
                Reject Verified ({verifiedOrganizations.length})
              </button>}
            </div>
          </div>

          {visibleOrganizations.map((organization) => {
              const isActioning = actionId === organization.id || actionId === `verify-${organization.id}` || actionId === 'all-organizations';
              const dupeMatch = organizationDuplicates.get(organization.id);
              const evidenceRows = evidenceByOrganization.get(organization.id) || [];
              const evidenceCount = organization.evidence_count || evidenceRows.length;
              const confidence =
                typeof organization.confidence === 'number'
                  ? Math.round(organization.confidence * 100)
                  : null;
              const locations = normalizeOrganizationLocations(organization.us_locations);
              const orgVerificationStatus = organization.verification_status ?? 'queued';
              const orgIsVerified = orgVerificationStatus === 'verified';

              return (
                <div
                  key={organization.id}
                  className={`bg-white rounded-xl border transition-all px-5 py-4 ${
                    !orgIsVerified
                      ? orgVerificationStatus === 'verifying'
                        ? 'border-blue-300 bg-blue-50/30 shadow-sm'
                        : 'border-gray-200 hover:border-gray-300'
                      : dupeMatch
                        ? 'border-amber-200 bg-amber-50/20'
                        : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  {!orgIsVerified && (
                    <div className={`flex items-center gap-1.5 mb-3 px-2.5 py-1.5 rounded-lg ${orgVerificationStatus === 'failed' ? 'bg-red-100' : 'bg-slate-100'}`}>
                      {orgVerificationStatus === 'failed' ? (
                        <AlertTriangle className="w-3 h-3 text-red-600 flex-shrink-0" />
                      ) : orgVerificationStatus === 'verifying' ? (
                        <Earth className="w-3 h-3 text-slate-500 flex-shrink-0 animate-spin" />
                      ) : (
                        <Clock3 className="w-3 h-3 text-slate-500 flex-shrink-0" />
                      )}
                      <span className={`text-[11px] font-medium ${orgVerificationStatus === 'failed' ? 'text-red-700' : 'text-slate-600'}`}>
                        {orgVerificationStatus === 'failed'
                          ? 'Verification failed — review or retry'
                          : orgVerificationStatus === 'verifying'
                            ? 'Verifying — checking sources and Flemish ties…'
                            : orgVerificationStatus === 'requested'
                              ? 'Queued for verification'
                              : 'Not verified yet'}
                      </span>
                    </div>
                  )}
                  {dupeMatch && orgIsVerified && (
                    <div className="flex items-center gap-1.5 mb-3 px-2.5 py-1.5 bg-amber-100/60 rounded-lg">
                      <AlertTriangle className="w-3 h-3 text-amber-600 flex-shrink-0" />
                      <span className="text-[11px] text-amber-700 font-medium">
                        Possible duplicate: {dupeMatch.reason}
                      </span>
                    </div>
                  )}

                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-gray-900">{organization.name}</p>
                        <span className="text-[10px] px-1.5 py-0.5 bg-yellow-50 text-yellow-800 rounded font-medium">
                          {organizationSourceLabel(organization.source)}
                        </span>
                        {evidenceCount > 0 && (
                          <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded font-medium">
                            {evidenceCount} evidence
                          </span>
                        )}
                        {confidence !== null && confidence > 0 && (
                          <span className="text-[10px] px-1.5 py-0.5 bg-purple-50 text-purple-600 rounded font-medium">
                            {confidence}% confidence
                          </span>
                        )}
                        <span className="text-[10px] px-1.5 py-0.5 bg-indigo-50 text-indigo-600 rounded font-medium">
                          {organizationStatusLabel(organization.suggested_us_network_status)}
                        </span>
                      </div>

                      {organization.description && (
                        <p className="text-xs text-gray-500 leading-relaxed line-clamp-2">
                          {organization.description}
                        </p>
                      )}

                      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                        {locations.map((location, index) => (
                          <span
                            key={`${location.city}-${location.state}-${index}`}
                            className="inline-flex items-center gap-1 text-xs text-gray-400"
                          >
                            <MapPin className="w-3 h-3" />
                            {location.city}, {location.state}
                            {location.role ? ` (${location.role})` : ''}
                          </span>
                        ))}
                        {organization.flemish_belgian_relevance && (
                          <span
                            className="line-clamp-2 text-xs text-yellow-600"
                            title={organization.flemish_belgian_relevance}
                          >
                            {organization.flemish_belgian_relevance}
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5">
                        {organization.website_url && (
                          <a
                            href={
                              organization.website_url.startsWith('http')
                                ? organization.website_url
                                : `https://${organization.website_url}`
                            }
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-700"
                          >
                            <Globe className="w-3 h-3" />
                            Website
                            <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        )}
                      </div>

                      {organization.sectors && organization.sectors.length > 0 && (
                        <div className="flex flex-wrap gap-1 pt-0.5">
                          {organization.sectors.map((sector) => (
                            <span
                              key={sector}
                              className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded"
                            >
                              {sector}
                            </span>
                          ))}
                        </div>
                      )}

                      {evidenceRows.length > 0 && (
                        <div className="pt-0.5">
                          <button
                            onClick={() => toggleEvidence(organization.id)}
                            className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-gray-600 transition-colors"
                          >
                            {expandedEvidence.has(organization.id) ? (
                              <ChevronUp className="w-2.5 h-2.5" />
                            ) : (
                              <ChevronDown className="w-2.5 h-2.5" />
                            )}
                            Evidence
                          </button>
                          {expandedEvidence.has(organization.id) && (
                            <div className="mt-2 space-y-2">
                              {evidenceRows.slice(0, 5).map((evidence, index) => (
                                <div
                                  key={`${evidence.page_url}-${index}`}
                                  className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2"
                                >
                                  <div className="flex items-center justify-between gap-3">
                                    <div className="min-w-0">
                                      <p className="text-[11px] font-medium text-gray-700 truncate">
                                        {evidence.page_title || evidence.page_url}
                                      </p>
                                      <p className="text-[10px] text-gray-400">
                                        {evidence.page_type || evidence.source_type || 'page'} ·{' '}
                                        {evidence.confidence
                                          ? `${Math.round(evidence.confidence * 100)}% confidence`
                                          : 'confidence n/a'}
                                      </p>
                                    </div>
                                    <a
                                      href={evidence.page_url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-[10px] text-blue-500 hover:text-blue-600 flex-shrink-0"
                                    >
                                      Open
                                    </a>
                                  </div>
                                  {evidence.evidence_excerpt && (
                                    <p className="mt-1.5 text-[11px] text-gray-600 leading-relaxed">
                                      {evidence.evidence_excerpt}
                                    </p>
                                  )}
                                  <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-gray-400">
                                    {evidence.raw_location_text && (
                                      <span>Location: {evidence.raw_location_text}</span>
                                    )}
                                    {evidence.raw_sector_text && (
                                      <span>Sector: {evidence.raw_sector_text}</span>
                                    )}
                                    {evidence.raw_relevance_text && (
                                      <span>Flemish/Belgian: {evidence.raw_relevance_text}</span>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {organization.source_urls && organization.source_urls.length > 0 && (
                        <div className="pt-0.5">
                          <button
                            onClick={() => toggleSources(organization.id)}
                            className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-gray-600 transition-colors"
                          >
                            {expandedSources.has(organization.id) ? (
                              <ChevronUp className="w-2.5 h-2.5" />
                            ) : (
                              <ChevronDown className="w-2.5 h-2.5" />
                            )}
                            {organization.source_urls.length} source
                            {organization.source_urls.length !== 1 ? 's' : ''}
                          </button>
                          {expandedSources.has(organization.id) && (
                            <div className="mt-1 space-y-0.5 pl-3.5">
                              {organization.source_urls.map((url, index) => (
                                <a
                                  key={`${url}-${index}`}
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

                    <div className="flex flex-col items-end gap-1.5 flex-shrink-0 pt-0.5">
                      {!orgIsVerified && (orgVerificationStatus === 'verifying' || orgVerificationStatus === 'requested') ? (
                        <span className="text-[11px] text-slate-500 italic">
                          {orgVerificationStatus === 'verifying' ? 'Verification in progress' : 'Waiting for verification'}
                        </span>
                      ) : !orgIsVerified ? (
                        <button
                          type="button"
                          onClick={() => void handleVerifyOrganization(organization)}
                          disabled={isActioning}
                          className="flex items-center gap-1 rounded-lg bg-blue-50 px-2.5 py-1.5 text-[11px] font-medium text-blue-700 transition-colors hover:bg-blue-100 disabled:opacity-50"
                        >
                          {isActioning ? <Earth className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                          {orgVerificationStatus === 'failed' ? 'Retry verification' : 'Verify'}
                        </button>
                      ) : dupeMatch ? (
                        <>
                          <button
                            onClick={() => handleMergeOrganization(organization, dupeMatch)}
                            disabled={isActioning}
                            className="flex items-center gap-1 text-[11px] font-medium px-2.5 py-1.5 text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors disabled:opacity-50"
                          >
                            {isActioning ? (
                              <Earth className="w-3 h-3 animate-spin" />
                            ) : (
                              <GitMerge className="w-3 h-3" />
                            )}
                            Merge
                          </button>
                          <button
                            onClick={() => handleApproveOrganization(organization)}
                            disabled={isActioning}
                            className="flex items-center gap-1 text-[11px] font-medium px-2.5 py-1.5 text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-lg transition-colors disabled:opacity-50"
                          >
                            <Building2 className="w-3 h-3" />
                            Add Anyway
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => handleApproveOrganization(organization)}
                          disabled={isActioning}
                          className="flex items-center gap-1 text-[11px] font-medium px-2.5 py-1.5 text-green-700 bg-green-50 hover:bg-green-100 rounded-lg transition-colors disabled:opacity-50"
                        >
                          {isActioning ? (
                            <Earth className="w-3 h-3 animate-spin" />
                          ) : (
                            <Building2 className="w-3 h-3" />
                          )}
                          Add
                        </button>
                      )}
                      {orgIsVerified && (
                        <button
                          onClick={() => handleRejectOrganization(organization)}
                          disabled={isActioning}
                          className="flex items-center gap-1 text-[11px] font-medium px-2.5 py-1.5 text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors disabled:opacity-50"
                        >
                          <X className="w-3 h-3" />
                          Reject
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
