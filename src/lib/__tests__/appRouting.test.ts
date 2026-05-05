import { describe, it, expect } from 'vitest';
import {
  buildDashboardSearchParams,
  parseDashboardRouteState,
  defaultDashboardRouteState,
  buildDashboardStateFromPreset,
  buildDashboardLocation,
  normalizePage,
  getCurrentPageFromPathname,
  type DashboardRouteState,
} from '../appRouting';
import { DEFAULT_MAP_FILTERS } from '../supabase';

function roundtrip(state: DashboardRouteState): DashboardRouteState {
  const params = buildDashboardSearchParams(state);
  return parseDashboardRouteState(new URLSearchParams(params.toString()));
}

describe('appRouting - dashboard URL roundtrip', () => {
  it('default state encodes to empty search', () => {
    const params = buildDashboardSearchParams(defaultDashboardRouteState());
    expect(params.toString()).toBe('');
    expect(roundtrip(defaultDashboardRouteState())).toEqual(
      defaultDashboardRouteState()
    );
  });

  it('roundtrips list view with query', () => {
    const state: DashboardRouteState = {
      view: 'list',
      query: 'biotech',
      filters: { ...DEFAULT_MAP_FILTERS },
      focusedCity: null,
    };
    expect(roundtrip(state)).toEqual(state);
  });

  it('roundtrips full filter set (sector, occupation, city, state, lectures, fc)', () => {
    const state: DashboardRouteState = {
      view: 'map',
      query: '',
      filters: {
        showPeople: true,
        showOrganizations: true,
        personScope: 'all',
        sector: 'Biotechnology',
        occupation: 'Executive/Leadership',
        city: 'Boston',
        state: 'MA',
        flemishConnections: ['KU Leuven', 'imec'],
        availableForLectures: true,
      },
      focusedCity: null,
    };
    expect(roundtrip(state)).toEqual(state);
  });

  it('roundtrips show-people / show-organizations toggles set to false', () => {
    const state: DashboardRouteState = {
      view: 'map',
      query: '',
      filters: {
        ...DEFAULT_MAP_FILTERS,
        showPeople: false,
        showOrganizations: false,
      },
      focusedCity: null,
    };
    expect(roundtrip(state)).toEqual(state);
  });

  it('roundtrips person scope filter', () => {
    const state: DashboardRouteState = {
      view: 'map',
      query: '',
      filters: {
        ...DEFAULT_MAP_FILTERS,
        personScope: 'us_connected_abroad',
      },
      focusedCity: null,
    };
    const params = buildDashboardSearchParams(state);
    expect(params.get('personScope')).toBe('us_connected_abroad');
    expect(roundtrip(state)).toEqual(state);
  });

  it('roundtrips focusedCity', () => {
    const state: DashboardRouteState = {
      view: 'map',
      query: '',
      filters: { ...DEFAULT_MAP_FILTERS },
      focusedCity: { city: 'Austin', state: 'TX' },
    };
    expect(roundtrip(state)).toEqual(state);
  });

  it('dedupes flemishConnections during roundtrip', () => {
    const params = new URLSearchParams();
    params.append('fc', 'KU Leuven');
    params.append('fc', 'KU Leuven');
    params.append('fc', '  imec  ');
    const parsed = parseDashboardRouteState(params);
    expect(parsed.filters.flemishConnections.sort()).toEqual(
      ['KU Leuven', 'imec'].sort()
    );
  });

  it('defaults to list view when query present and no view param', () => {
    const parsed = parseDashboardRouteState(new URLSearchParams('q=hello'));
    expect(parsed.view).toBe('list');
  });

  it('respects explicit view=map even with query', () => {
    const parsed = parseDashboardRouteState(new URLSearchParams('q=x&view=map'));
    expect(parsed.view).toBe('map');
  });

  it('encodes view=map when a query is present so it roundtrips', () => {
    const state: DashboardRouteState = {
      view: 'map',
      query: 'los angeles',
      filters: { ...DEFAULT_MAP_FILTERS },
      focusedCity: null,
    };
    const params = buildDashboardSearchParams(state);
    expect(params.get('view')).toBe('map');
    expect(roundtrip(state)).toEqual(state);
  });

  it('parseBooleanParam treats "0"/"false" as false, anything else as true', () => {
    const trueParsed = parseDashboardRouteState(
      new URLSearchParams('people=1&organizations=true')
    );
    expect(trueParsed.filters.showPeople).toBe(true);
    expect(trueParsed.filters.showOrganizations).toBe(true);

    const falseParsed = parseDashboardRouteState(
      new URLSearchParams('people=0&organizations=false')
    );
    expect(falseParsed.filters.showPeople).toBe(false);
    expect(falseParsed.filters.showOrganizations).toBe(false);
  });

  it('buildDashboardLocation prefixes search with ?', () => {
    const state: DashboardRouteState = {
      view: 'list',
      query: 'foo',
      filters: { ...DEFAULT_MAP_FILTERS },
      focusedCity: null,
    };
    const loc = buildDashboardLocation(state);
    expect(loc.pathname).toBe('/');
    expect(loc.search.startsWith('?')).toBe(true);
    expect(loc.search).toContain('q=foo');

    const empty = buildDashboardLocation(defaultDashboardRouteState());
    expect(empty.search).toBe('');
  });
});

describe('appRouting - presets', () => {
  it('returns default when no preset', () => {
    expect(buildDashboardStateFromPreset()).toEqual(defaultDashboardRouteState());
  });

  it('applies sector / occupation / fc / focusCity from preset', () => {
    const state = buildDashboardStateFromPreset({
      sector: 'Finance',
      occupation: 'Professional',
      flemishConnections: ['KU Leuven', '  ', 'KU Leuven'],
      focusCity: { city: 'Chicago', state: 'IL' },
    });
    expect(state.filters.sector).toBe('Finance');
    expect(state.filters.occupation).toBe('Professional');
    expect(state.filters.flemishConnections).toEqual(['KU Leuven']);
    expect(state.focusedCity).toEqual({ city: 'Chicago', state: 'IL' });
  });
});

describe('appRouting - normalizePage / getCurrentPageFromPathname', () => {
  it('aliases legacy page names', () => {
    expect(normalizePage('directory')).toBe('dashboard');
    expect(normalizePage('search')).toBe('dashboard');
    expect(normalizePage('missions')).toBe('collections');
    expect(normalizePage('planner')).toBe('collections');
    expect(normalizePage('admin')).toBe('admin');
  });

  it('routes pathnames to their page', () => {
    expect(getCurrentPageFromPathname('/admin')).toBe('admin');
    expect(getCurrentPageFromPathname('/admin/system')).toBe('admin');
    expect(getCurrentPageFromPathname('/collections')).toBe('collections');
    expect(getCurrentPageFromPathname('/collections/abc')).toBe('collections');
    expect(getCurrentPageFromPathname('/contacts/new')).toBe('add-contact');
    expect(getCurrentPageFromPathname('/account')).toBe('account');
    expect(getCurrentPageFromPathname('/people/123')).toBe('dashboard');
    expect(getCurrentPageFromPathname('/organizations/abc')).toBe('dashboard');
    expect(getCurrentPageFromPathname('/')).toBe('dashboard');
  });
});
