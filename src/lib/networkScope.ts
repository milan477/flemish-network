import type {
  LocationSummaryRow,
  MapCluster,
  MapFilters,
  Organization,
  OrganizationUsLocation,
  Person,
  PersonUsConnection,
} from './supabase';
import { lookupCity } from './locations';

export function isUsConnectedAbroad(person: Pick<Person, 'us_network_status'>): boolean {
  return person.us_network_status === 'us_connected_abroad';
}

export function personCardLocationLabel(person: Person): string {
  if (isUsConnectedAbroad(person)) return 'Connected to US';
  if (person.locations?.city) {
    return `Based in ${person.locations.city}${person.locations.state ? `, ${person.locations.state}` : ''}`;
  }
  return '';
}

export function currentAbroadBaseLabel(
  person: Pick<Person, 'current_location_city' | 'current_location_country'>
): string {
  return [person.current_location_city, person.current_location_country]
    .filter(Boolean)
    .join(', ');
}

export function personUsConnectionSummary(person: Person): string {
  const connections = person.person_us_connections || [];
  if (connections.length === 0) return '';

  const labels = connections
    .map((connection) => {
      const label = connection.connection_label || 'US connection';
      const location = connection.locations?.city
        ? `${connection.locations.city}${connection.locations.state ? `, ${connection.locations.state}` : ''}`
        : '';
      return [label, location].filter(Boolean).join(' in ');
    })
    .filter(Boolean);

  if (labels.length === 0) return '';
  return `${person.name} is connected to the US through ${labels.join('; ')}.`;
}

export function personClusterContext(person: Person, city: string, state: string): string {
  const matchingConnection = (person.person_us_connections || []).find(
    (connection) =>
      connection.locations?.city === city && connection.locations?.state === state
  );
  const connectionLabel = matchingConnection?.connection_label || 'US connection';
  const abroadBase = currentAbroadBaseLabel(person);

  return [connectionLabel, abroadBase ? `Based in ${abroadBase}` : '']
    .filter(Boolean)
    .join(' · ');
}

export function organizationUsLocationLabel(location: OrganizationUsLocation): string {
  const roleLabels: Record<string, string> = {
    hq: 'HQ',
    office: 'US office',
    branch: 'Branch',
    factory: 'Factory',
    lab: 'Lab',
    accelerator: 'Accelerator',
    partner_site: 'Partner location',
    expansion_target: 'Expansion target',
    event_site: 'Event site',
    other: 'US location',
  };
  return location.label || roleLabels[location.location_role] || 'US location';
}

function locationMatches(
  location: { city?: string | null; state?: string | null } | undefined,
  filters: Pick<MapFilters, 'city' | 'state'>
): boolean {
  if (!filters.city && !filters.state) return true;

  const cityMatches = filters.city ? location?.city === filters.city : true;
  const stateMatches = filters.state ? location?.state === filters.state : true;

  return cityMatches && stateMatches;
}

export function personMatchesLocation(person: Person, filters: Pick<MapFilters, 'city' | 'state'>): boolean {
  if (!filters.city && !filters.state) return true;

  if (!isUsConnectedAbroad(person)) {
    return locationMatches(person.locations, filters);
  }

  return (person.person_us_connections || []).some((connection) =>
    locationMatches(connection.locations, filters)
  );
}

export function organizationMatchesLocation(
  organization: Organization,
  filters: Pick<MapFilters, 'city' | 'state'>
): boolean {
  if (!filters.city && !filters.state) return true;

  const usLocations = organization.organization_us_locations || [];
  if (usLocations.some((location) => locationMatches(location.locations, filters))) {
    return true;
  }

  return locationMatches(organization.locations, filters);
}

function clusterLocation(
  clusterMap: Map<string, MapCluster>,
  location: { city: string; state: string; latitude: number | null; longitude: number | null },
  addEntity: (cluster: MapCluster) => void
) {
  if (!location.city || !location.state) return;

  const coords = lookupCity(location.city, location.state);
  const lat = coords?.lat ?? location.latitude;
  const lng = coords?.lng ?? location.longitude;

  if (lat == null || lng == null) return;

  const key = `${location.city}|${location.state}`;
  if (!clusterMap.has(key)) {
    clusterMap.set(key, {
      city: location.city,
      state: location.state,
      lat: Number(lat),
      lng: Number(lng),
      people: [],
      organizations: [],
    });
  }

  addEntity(clusterMap.get(key)!);
}

function personPlacementConnections(person: Person): PersonUsConnection[] {
  if (!isUsConnectedAbroad(person)) return [];
  return person.person_us_connections || [];
}

function organizationPlacementLocations(organization: Organization): OrganizationUsLocation[] {
  return organization.organization_us_locations || [];
}

export function buildLightClusters(
  rows: LocationSummaryRow[],
  filters: MapFilters
): MapCluster[] {
  const clusterMap = new Map<string, MapCluster>();

  for (const row of rows) {
    if (!row.city || !row.state || row.lat == null || row.lng == null) continue;

    const personContrib = filters.showPeople ? row.person_count : 0;
    const orgContrib = filters.showOrganizations ? row.org_count : 0;
    if (personContrib + orgContrib === 0) continue;

    const key = `${row.city}|${row.state}`;
    const existing = clusterMap.get(key);
    if (existing) {
      existing.personCount = (existing.personCount ?? 0) + personContrib;
      existing.orgCount = (existing.orgCount ?? 0) + orgContrib;
    } else {
      clusterMap.set(key, {
        city: row.city,
        state: row.state,
        lat: row.lat,
        lng: row.lng,
        people: [],
        organizations: [],
        personCount: personContrib,
        orgCount: orgContrib,
      });
    }
  }

  return Array.from(clusterMap.values()).filter(
    (c) => (c.personCount ?? 0) + (c.orgCount ?? 0) > 0
  );
}

export function buildNetworkClusters(
  people: Person[],
  organizations: Organization[],
  filters: MapFilters
): MapCluster[] {
  const clusterMap = new Map<string, MapCluster>();

  if (filters.showPeople) {
    for (const person of people) {
      if (isUsConnectedAbroad(person)) {
        for (const connection of personPlacementConnections(person)) {
          if (connection.locations) {
            clusterLocation(clusterMap, connection.locations, (cluster) => {
              if (!cluster.people.some((row) => row.id === person.id)) {
                cluster.people.push(person);
              }
            });
          }
        }
        continue;
      }

      if (person.locations) {
        clusterLocation(clusterMap, person.locations, (cluster) => {
          cluster.people.push(person);
        });
      }
    }
  }

  if (filters.showOrganizations) {
    for (const organization of organizations) {
      const placements = organizationPlacementLocations(organization);
      if (placements.length > 0) {
        for (const placement of placements) {
          if (placement.locations) {
            clusterLocation(clusterMap, placement.locations, (cluster) => {
              cluster.organizations.push(organization);
            });
          }
        }
        continue;
      }

      if (organization.locations) {
        clusterLocation(clusterMap, organization.locations, (cluster) => {
          cluster.organizations.push(organization);
        });
      }
    }
  }

  return Array.from(clusterMap.values());
}
