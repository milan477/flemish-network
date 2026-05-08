import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const PROJECT_REF = 'ofzuhajxwxggybkuzefq';
const PEOPLE_COUNT = 160;
const ORGANIZATION_COUNT = 75;

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const resetConfirm = process.env.PHASE3_RESET_CONFIRM;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
}

if (resetConfirm !== PROJECT_REF) {
  throw new Error(`Set PHASE3_RESET_CONFIRM=${PROJECT_REF} to reset and seed Phase 3 data.`);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

interface LocationSeed {
  city: string;
  state: string;
  latitude: number;
  longitude: number;
}

interface OrganizationSeed {
  key: string;
  name: string;
  type: string;
  description: string;
  flemish_link: string;
  status: string;
  sectors: string[];
  primaryLocation: LocationSeed;
  extraLocations?: LocationSeed[];
}

const locations: LocationSeed[] = [
  { city: 'Boston', state: 'MA', latitude: 42.3601, longitude: -71.0589 },
  { city: 'New York', state: 'NY', latitude: 40.7128, longitude: -74.006 },
  { city: 'San Francisco', state: 'CA', latitude: 37.7749, longitude: -122.4194 },
  { city: 'San Diego', state: 'CA', latitude: 32.7157, longitude: -117.1611 },
  { city: 'Los Angeles', state: 'CA', latitude: 34.0522, longitude: -118.2437 },
  { city: 'Seattle', state: 'WA', latitude: 47.6062, longitude: -122.3321 },
  { city: 'Austin', state: 'TX', latitude: 30.2672, longitude: -97.7431 },
  { city: 'Houston', state: 'TX', latitude: 29.7604, longitude: -95.3698 },
  { city: 'Chicago', state: 'IL', latitude: 41.8781, longitude: -87.6298 },
  { city: 'Washington', state: 'DC', latitude: 38.9072, longitude: -77.0369 },
  { city: 'Durham', state: 'NC', latitude: 35.994, longitude: -78.8986 },
  { city: 'Atlanta', state: 'GA', latitude: 33.749, longitude: -84.388 },
  { city: 'Miami', state: 'FL', latitude: 25.7617, longitude: -80.1918 },
  { city: 'Cambridge', state: 'MA', latitude: 42.3736, longitude: -71.1097 },
  { city: 'Boston', state: 'NY', latitude: 42.6289, longitude: -78.7375 },
  { city: 'California', state: 'MD', latitude: 38.3004, longitude: -76.5075 },
];

const abroadLocations = [
  { city: 'Leuven', country: 'Belgium' },
  { city: 'Ghent', country: 'Belgium' },
  { city: 'Brussels', country: 'Belgium' },
  { city: 'Antwerp', country: 'Belgium' },
];

const sectors = [
  'Artificial Intelligence',
  'Biotechnology',
  'Research',
  'Education',
  'Finance',
  'Culture & Arts',
];

const flemishConnections = [
  { name: 'KU Leuven', type: 'university' },
  { name: 'UGent', type: 'university' },
  { name: 'VUB', type: 'university' },
  { name: 'UAntwerp', type: 'university' },
  { name: 'UHasselt', type: 'university' },
  { name: 'Vlerick Business School', type: 'university' },
  { name: 'imec', type: 'company' },
  { name: 'VIB', type: 'company' },
  { name: 'VITO', type: 'company' },
  { name: 'Flanders Make', type: 'company' },
  { name: 'BAEF', type: 'other' },
  { name: 'Fayat Scholarship', type: 'government' },
  { name: 'Flanders Investment & Trade', type: 'government' },
];

const orgSpecials: OrganizationSeed[] = [
  {
    key: 'ku-leuven-boston-life-sciences',
    name: 'Leuven Boston Life Sciences Forum',
    type: 'Research network',
    description: 'KU Leuven alumni and Belgian biotech researchers in Boston coordinate therapeutics seminars with Cambridge labs.',
    flemish_link: 'KU Leuven, VIB',
    status: 'institutional_connector',
    sectors: ['Biotechnology', 'Life Sciences', 'Research'],
    primaryLocation: locations[0],
  },
  {
    key: 'imec-california-deep-tech',
    name: 'imec California Deep Tech Hub',
    type: 'Research lab',
    description: 'Interuniversity Microelectronics Centre collaboration with California semiconductor startups and AI hardware teams.',
    flemish_link: 'imec',
    status: 'belgian_organization_with_us_presence',
    sectors: ['Semiconductor', 'AI', 'Research'],
    primaryLocation: locations[2],
    extraLocations: [locations[3]],
  },
  {
    key: 'belgian-biotech-new-york',
    name: 'Belgian Biotech New York Exchange',
    type: 'Industry association',
    description: 'Belgian-founded biotech companies with New York clinical operations, investor briefings, and Flanders life sciences ties.',
    flemish_link: 'VIB, Flanders Investment & Trade',
    status: 'institutional_connector',
    sectors: ['Biotechnology', 'Life Sciences', 'Finance'],
    primaryLocation: locations[1],
    extraLocations: [locations[0]],
  },
];

function pick<T>(items: T[], index: number): T {
  return items[index % items.length];
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function deleteFrom(table: string, column = 'id') {
  const { error } = await supabase.from(table).delete().not(column, 'is', null);
  if (error) {
    console.warn(`[seed:phase3] Skipped ${table}: ${error.message}`);
  }
}

async function deleteWhereNotNull(table: string, column: string) {
  const { error } = await supabase.from(table).delete().not(column, 'is', null);
  if (error) {
    console.warn(`[seed:phase3] Skipped ${table}: ${error.message}`);
  }
}

async function resetPhase3Data() {
  await deleteWhereNotNull('collection_members', 'person_id');
  await deleteWhereNotNull('search_clicks', 'person_id');
  await deleteWhereNotNull('person_text_chunks', 'person_id');
  await deleteWhereNotNull('embedding_jobs', 'person_id');
  await deleteWhereNotNull('profile_suggestions', 'person_id');
  await deleteWhereNotNull('derived_label_suggestions', 'person_id');
  await deleteWhereNotNull('connection_suggestions', 'from_person_id');
  await deleteFrom('connections');
  await deleteWhereNotNull('people_search_documents', 'person_id');
  await deleteWhereNotNull('organization_search_documents', 'organization_id');
  await deleteWhereNotNull('person_us_connections', 'person_id');
  await deleteWhereNotNull('person_flemish_connections', 'person_id');
  await deleteWhereNotNull('person_sectors', 'person_id');
  await deleteWhereNotNull('organization_us_locations', 'organization_id');
  await deleteWhereNotNull('organization_sectors', 'organization_id');
  await deleteWhereNotNull('plan_suggested_people', 'person_id');
  await deleteFrom('people');
  await deleteFrom('organizations');
}

async function ensureCatalogs() {
  const { data: locationRows, error: locationError } = await supabase
    .from('locations')
    .upsert(locations, { onConflict: 'city,state' })
    .select('id, city, state');
  if (locationError) throw locationError;

  const { data: sectorRows, error: sectorError } = await supabase
    .from('sectors')
    .upsert(sectors.map((name) => ({ name })), { onConflict: 'name' })
    .select('id, name');
  if (sectorError) throw sectorError;

  const { data: connectionRows, error: connectionError } = await supabase
    .from('flemish_connections')
    .upsert(flemishConnections, { onConflict: 'normalized_name' })
    .select('id, name');
  if (connectionError) throw connectionError;

  return {
    locationByKey: new Map((locationRows || []).map((row) => [`${row.city}|${row.state}`, row.id])),
    sectorByName: new Map((sectorRows || []).map((row) => [row.name, row.id])),
    connectionByName: new Map((connectionRows || []).map((row) => [row.name, row.id])),
  };
}

function buildOrganizations(): OrganizationSeed[] {
  const types = ['Company', 'Research lab', 'University center', 'Venture fund', 'Cultural organization', 'Public agency'];
  const statuses = [
    'us_based_organization',
    'belgian_organization_with_us_presence',
    'us_organization_connected_to_flanders',
    'institutional_connector',
  ];
  const result = [...orgSpecials];

  for (let index = result.length; index < ORGANIZATION_COUNT; index += 1) {
    const location = pick(locations.slice(0, 14), index);
    const sector = pick(sectors, index);
    const tie = pick(flemishConnections, index + 3).name;
    const type = pick(types, index);
    const metroSlug = slug(`${location.city}-${location.state}`);
    const sectorSlug = slug(sector);
    result.push({
      key: `${metroSlug}-${sectorSlug}-org-${String(index + 1).padStart(2, '0')}`,
      name: `${location.city} ${sector} Flanders ${type} ${String(index + 1).padStart(2, '0')}`,
      type,
      description: `${type} in ${location.city} with ${sector.toLowerCase()} programs and ${tie} relevance for Flemish and Belgian network search testing.`,
      flemish_link: index % 9 === 0 ? 'Attended Belgian conference' : tie,
      status: pick(statuses, index),
      sectors: [sector, pick(sectors, index + 5)],
      primaryLocation: location,
      extraLocations: index % 8 === 0 ? [pick(locations.slice(0, 14), index + 4)] : undefined,
    });
  }

  return result;
}

async function seedOrganizations(catalogs: Awaited<ReturnType<typeof ensureCatalogs>>) {
  const organizationSeeds = buildOrganizations();
  const { data: insertedOrganizations, error } = await supabase
    .from('organizations')
    .insert(
      organizationSeeds.map((organization) => ({
        name: organization.name,
        type: organization.type,
        description: organization.description,
        flemish_link: organization.flemish_link,
        us_network_status: organization.status,
        location_id: catalogs.locationByKey.get(`${organization.primaryLocation.city}|${organization.primaryLocation.state}`),
      }))
    )
    .select('id, name');
  if (error) throw error;

  const orgIdByName = new Map((insertedOrganizations || []).map((row) => [row.name, row.id]));
  const sectorLinks = [];
  const locationLinks = [];

  for (const organization of organizationSeeds) {
    const organizationId = orgIdByName.get(organization.name);
    if (!organizationId) continue;

    for (const sector of Array.from(new Set(organization.sectors))) {
      const sectorId = catalogs.sectorByName.get(sector);
      if (sectorId) sectorLinks.push({ organization_id: organizationId, sector_id: sectorId });
    }

    const placements = [organization.primaryLocation, ...(organization.extraLocations || [])];
    placements.forEach((location, index) => {
      const locationId = catalogs.locationByKey.get(`${location.city}|${location.state}`);
      if (!locationId) return;
      locationLinks.push({
        organization_id: organizationId,
        location_id: locationId,
        location_role: index === 0 ? 'hq' : 'lab',
        label: index === 0 ? 'Primary US location' : 'Additional US site',
        description: `${organization.name} ${index === 0 ? 'primary' : 'secondary'} US presence in ${location.city}.`,
        confidence: 1,
        is_primary: index === 0,
      });
    });
  }

  if (sectorLinks.length > 0) {
    const { error: sectorError } = await supabase.from('organization_sectors').insert(sectorLinks);
    if (sectorError) throw sectorError;
  }

  if (locationLinks.length > 0) {
    const { error: locationError } = await supabase.from('organization_us_locations').insert(locationLinks);
    if (locationError) throw locationError;
  }

  return { organizationSeeds, orgIdByName };
}

async function seedPeople(
  catalogs: Awaited<ReturnType<typeof ensureCatalogs>>,
  organizations: Awaited<ReturnType<typeof seedOrganizations>>
) {
  const firstNames = ['Annelies', 'Bram', 'Charlotte', 'Daan', 'Els', 'Felix', 'Griet', 'Hanne', 'Jan', 'Kato', 'Lena', 'Maarten'];
  const lastNames = ['Vermeulen', 'Peeters', 'Janssens', 'Willems', 'De Smet', 'Claes', 'Martens', 'Goossens', 'Bogaerts', 'Mertens'];
  const roles = ['Founder', 'Research director', 'Principal scientist', 'Professor', 'Investor', 'Product lead', 'Policy advisor', 'Curator'];
  const statuses = ['us_based', 'us_based', 'us_based', 'us_based', 'us_connected_abroad', 'needs_review'];
  const peopleRows = [];
  const personMeta = [];

  for (let index = 0; index < PEOPLE_COUNT; index += 1) {
    const location = pick(locations.slice(0, 14), index);
    const sector = pick(sectors, index + (index % 5));
    const tie = pick(flemishConnections, index + 2).name;
    const role = pick(roles, index);
    const status = pick(statuses, index);
    const firstName = pick(firstNames, index);
    const lastName = pick(lastNames, index + Math.floor(index / firstNames.length));
    const specialPhrase =
      index < 14
        ? 'KU Leuven Boston collaboration and Leuven-trained life sciences work'
        : index < 30
          ? 'imec California semiconductor and AI hardware partnership'
          : index < 42
            ? 'Belgian biotech New York clinical operations and investor network'
            : `${tie} and ${sector.toLowerCase()} activity across the Flemish network`;
    const organization = pick(organizations.organizationSeeds, index);

    peopleRows.push({
      name: `${firstName} ${lastName} ${String(index + 1).padStart(3, '0')}`,
      first_name: firstName,
      last_name: `${lastName} ${String(index + 1).padStart(3, '0')}`,
      title: index % 11 === 0 ? 'Dr.' : null,
      current_position: `${role}, ${organization.name}`,
      occupation: role.includes('Professor') || role.includes('scientist') ? 'Academic/Researcher' : role,
      bio: `Synthetic Phase 3 profile for ${sector.toLowerCase()} search. ${specialPhrase}. Uses alias coverage such as Catholic University of Leuven, KUL, Ghent University, or Belgian American Educational Foundation when relevant.`,
      us_network_status: status,
      current_location_city: status === 'us_connected_abroad' ? pick(abroadLocations, index).city : null,
      current_location_country: status === 'us_connected_abroad' ? pick(abroadLocations, index).country : null,
      location_id: status === 'us_connected_abroad' ? null : catalogs.locationByKey.get(`${location.city}|${location.state}`),
      organization_id: organizations.orgIdByName.get(organization.name),
      email: `phase3.person.${index + 1}@example.invalid`,
      linkedin_url: `https://www.linkedin.com/in/phase3-${index + 1}`,
      available_for_lectures: index % 4 === 0,
      open_to_mentorship: index % 5 === 0,
      welcomes_visits: index % 6 === 0,
      data_source: 'phase3_synthetic_seed',
      last_verified_at: index % 3 === 0 ? new Date('2026-05-07T00:00:00Z').toISOString() : null,
    });
    personMeta.push({ sector, secondarySector: pick(sectors, index + 4), tie, location, status });
  }

  const { data: insertedPeople, error } = await supabase
    .from('people')
    .insert(peopleRows)
    .select('id, email');
  if (error) throw error;

  const personIdByEmail = new Map((insertedPeople || []).map((row) => [row.email, row.id]));
  const sectorLinks = [];
  const connectionLinks = [];
  const usConnectionLinks = [];

  personMeta.forEach((meta, index) => {
    const personId = personIdByEmail.get(`phase3.person.${index + 1}@example.invalid`);
    if (!personId) return;

    for (const sector of Array.from(new Set([meta.sector, meta.secondarySector]))) {
      const sectorId = catalogs.sectorByName.get(sector);
      if (sectorId) sectorLinks.push({ person_id: personId, sector_id: sectorId });
    }

    const connectionId = catalogs.connectionByName.get(meta.tie);
    if (connectionId) connectionLinks.push({ person_id: personId, flemish_connection_id: connectionId });

    if (meta.status === 'us_connected_abroad') {
      const locationId = catalogs.locationByKey.get(`${meta.location.city}|${meta.location.state}`);
      if (locationId) {
        usConnectionLinks.push({
          person_id: personId,
          location_id: locationId,
          connection_label: `US advisory connection in ${meta.location.city}`,
          evidence_excerpt: `Synthetic US-connected-abroad evidence for ${meta.location.city}.`,
          confidence: 0.92,
        });
      }
    }
  });

  if (sectorLinks.length > 0) {
    const { error: sectorError } = await supabase.from('person_sectors').insert(sectorLinks);
    if (sectorError) throw sectorError;
  }

  if (connectionLinks.length > 0) {
    const { error: connectionError } = await supabase.from('person_flemish_connections').insert(connectionLinks);
    if (connectionError) throw connectionError;
  }

  if (usConnectionLinks.length > 0) {
    const { error: usConnectionError } = await supabase.from('person_us_connections').insert(usConnectionLinks);
    if (usConnectionError) throw usConnectionError;
  }
}

async function main() {
  console.log('[seed:phase3] Resetting approved people and organizations...');
  await resetPhase3Data();

  console.log('[seed:phase3] Ensuring catalogs...');
  const catalogs = await ensureCatalogs();

  console.log('[seed:phase3] Seeding organizations...');
  const organizations = await seedOrganizations(catalogs);

  console.log('[seed:phase3] Seeding people...');
  await seedPeople(catalogs, organizations);

  console.log(`[seed:phase3] Seeded ${PEOPLE_COUNT} people and ${ORGANIZATION_COUNT} organizations.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
