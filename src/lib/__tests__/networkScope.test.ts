import { describe, expect, it } from 'vitest';
import {
  buildNetworkClusters,
  personCardLocationLabel,
  personClusterContext,
} from '../networkScope';
import { DEFAULT_MAP_FILTERS, type Organization, type Person } from '../supabase';

const boston = {
  id: 'loc-boston',
  city: 'Boston',
  state: 'MA',
  latitude: 42.36,
  longitude: -71.05,
};

const newYork = {
  id: 'loc-nyc',
  city: 'New York',
  state: 'NY',
  latitude: 40.71,
  longitude: -74,
};

function person(overrides: Partial<Person>): Person {
  return {
    id: 'person-1',
    name: 'Test Person',
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    ...overrides,
  };
}

function organization(overrides: Partial<Organization>): Organization {
  return {
    id: 'org-1',
    name: 'Test Org',
    type: 'Company',
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    ...overrides,
  };
}

describe('networkScope', () => {
  it('formats person card labels for based and connected people', () => {
    expect(personCardLocationLabel(person({ locations: boston }))).toBe(
      'Based in Boston, MA'
    );
    expect(
      personCardLocationLabel(
        person({ us_network_status: 'us_connected_abroad' })
      )
    ).toBe('Connected to US');
  });

  it('places based and connected people in separate US map locations', () => {
    const based = person({
      id: 'based',
      name: 'Based Person',
      us_network_status: 'us_based',
      locations: boston,
    });
    const connected = person({
      id: 'connected',
      name: 'Connected Person',
      us_network_status: 'us_connected_abroad',
      current_location_city: 'Leuven',
      current_location_country: 'Belgium',
      person_us_connections: [
        {
          person_id: 'connected',
          location_id: newYork.id,
          connection_label: 'Yale alumnus',
          locations: newYork,
        },
      ],
    });

    const clusters = buildNetworkClusters(
      [based, connected],
      [],
      DEFAULT_MAP_FILTERS
    );

    expect(clusters.find((cluster) => cluster.city === 'Boston')?.people).toEqual([
      based,
    ]);
    expect(clusters.find((cluster) => cluster.city === 'New York')?.people).toEqual([
      connected,
    ]);
    expect(personClusterContext(connected, 'New York', 'NY')).toBe(
      'Yale alumnus · Based in Leuven, Belgium'
    );
  });

  it('places organizations at every organization_us_locations location', () => {
    const org = organization({
      organization_us_locations: [
        {
          organization_id: 'org-1',
          location_id: boston.id,
          location_role: 'office',
          locations: boston,
        },
        {
          organization_id: 'org-1',
          location_id: newYork.id,
          location_role: 'lab',
          locations: newYork,
        },
      ],
    });

    const clusters = buildNetworkClusters([], [org], DEFAULT_MAP_FILTERS);

    expect(clusters.find((cluster) => cluster.city === 'Boston')?.organizations).toEqual([
      org,
    ]);
    expect(clusters.find((cluster) => cluster.city === 'New York')?.organizations).toEqual([
      org,
    ]);
  });
});
