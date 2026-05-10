import { describe, it, expect } from 'vitest';
import {
  buildDashboardSearchParams,
  parseDashboardRouteState,
  defaultDashboardRouteState,
  buildDashboardStateFromPreset,
  buildDashboardLocation,
  isCanonicalAdminTab,
  normalizePage,
  getCurrentPageFromPathname,
  normalizeAdminTab,
  parseAdminDiscoveryPrompt,
  parseAddContactMode,
  type DashboardRouteState,
} from '../appRouting';
import { DEFAULT_MAP_FILTERS } from '../supabase';

function roundtrip(state: DashboardRouteState): DashboardRouteState {
  const params = buildDashboardSearchParams(state);
  return parseDashboardRouteState(new URLSearchParams(params.toString()));
}

describe('appRouting - dashboard URL roundtrip', () => {
  it('default state always emits symmetric people/organizations toggles', () => {
    // Phase 4A: showPeople/showOrganizations are written explicitly in both
    // states so toggling on->off->on round-trips even when merging onto an
    // existing search.
    const params = buildDashboardSearchParams(defaultDashboardRouteState());
    expect(params.get('people')).toBe('1');
    expect(params.get('organizations')).toBe('1');
    expect(roundtrip(defaultDashboardRouteState())).toEqual(
      defaultDashboardRouteState()
    );
  });

  it('roundtrips list view with query', () => {
    const state: DashboardRouteState = {
      view: 'list',
      query: 'biotech',
      matchMode: 'all',
      filters: { ...DEFAULT_MAP_FILTERS },
      focusedCity: null,
    };
    expect(roundtrip(state)).toEqual(state);
  });

  it('roundtrips full filter set (sector, occupation, city, state, lectures, fc)', () => {
    const state: DashboardRouteState = {
      view: 'map',
      query: '',
      matchMode: 'all',
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
      matchMode: 'all',
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
      matchMode: 'all',
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
      matchMode: 'all',
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
      matchMode: 'all',
      filters: { ...DEFAULT_MAP_FILTERS },
      focusedCity: null,
    };
    const params = buildDashboardSearchParams(state);
    expect(params.get('view')).toBe('map');
    expect(roundtrip(state)).toEqual(state);
  });

  it('roundtrips match criteria mode when set to any', () => {
    const state: DashboardRouteState = {
      view: 'list',
      query: 'ku leuven biotech boston',
      matchMode: 'any',
      filters: {
        ...DEFAULT_MAP_FILTERS,
        sector: 'Biotechnology',
        city: 'Boston',
        state: 'MA',
        flemishConnections: ['KU Leuven'],
      },
      focusedCity: null,
    };
    const params = buildDashboardSearchParams(state);
    expect(params.get('match')).toBe('any');
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
      matchMode: 'all',
      filters: { ...DEFAULT_MAP_FILTERS },
      focusedCity: null,
    };
    const loc = buildDashboardLocation(state);
    expect(loc.pathname).toBe('/');
    expect(loc.search.startsWith('?')).toBe(true);
    expect(loc.search).toContain('q=foo');

    const empty = buildDashboardLocation(defaultDashboardRouteState());
    // Phase 4A: default state still emits the symmetric people/organizations
    // toggles, so the search is non-empty but encodes the defaults.
    expect(empty.search).toContain('people=1');
    expect(empty.search).toContain('organizations=1');
  });
});

describe('appRouting - admin tabs', () => {
  it('normalizes canonical staff workspace tabs', () => {
    expect(normalizeAdminTab('discovery')).toBe('discovery');
    expect(normalizeAdminTab('verification')).toBe('verification');
    expect(normalizeAdminTab('growth')).toBe('growth');
    expect(normalizeAdminTab('system')).toBe('system');
  });

  it('defaults unknown admin tabs to discovery', () => {
    expect(normalizeAdminTab('agents')).toBe('discovery');
    expect(normalizeAdminTab('discovered')).toBe('discovery');
    expect(normalizeAdminTab('overview')).toBe('discovery');
    expect(normalizeAdminTab('unknown')).toBe('discovery');
  });

  it('keeps access admin-only', () => {
    expect(normalizeAdminTab('access')).toBe('discovery');
    expect(normalizeAdminTab('access', true)).toBe('access');
  });

  it('identifies canonical admin tabs', () => {
    expect(isCanonicalAdminTab('discovery')).toBe(true);
    expect(isCanonicalAdminTab('verification')).toBe(true);
    expect(isCanonicalAdminTab('growth')).toBe(true);
    expect(isCanonicalAdminTab('system')).toBe(true);
    expect(isCanonicalAdminTab('access')).toBe(true);
    expect(isCanonicalAdminTab('agents')).toBe(false);
    expect(isCanonicalAdminTab('overview')).toBe(false);
    expect(isCanonicalAdminTab(undefined)).toBe(false);
  });
});

describe('appRouting - admin discovery prompt', () => {
  it('decodes prompt route state for discovery prefill', () => {
    const params = new URLSearchParams(
      'prompt=Find%20KU%20Leuven%20alumni%20in%20Boston%20biotech'
    );

    expect(parseAdminDiscoveryPrompt(params)).toBe(
      'Find KU Leuven alumni in Boston biotech'
    );
  });

  it('defaults to an empty prompt when no handoff prompt is present', () => {
    expect(parseAdminDiscoveryPrompt(new URLSearchParams())).toBe('');
  });
});

describe('appRouting - add contact mode', () => {
  it('decodes ?mode=manual|import|discovery', () => {
    expect(parseAddContactMode(new URLSearchParams('mode=manual'))).toBe('manual');
    expect(parseAddContactMode(new URLSearchParams('mode=import'))).toBe('import');
    expect(parseAddContactMode(new URLSearchParams('mode=discovery'))).toBe('discovery');
  });

  it('defaults to discovery when mode is missing or unknown', () => {
    expect(parseAddContactMode(new URLSearchParams())).toBe('discovery');
    expect(parseAddContactMode(new URLSearchParams('mode=bogus'))).toBe('discovery');
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
    expect(getCurrentPageFromPathname('/account')).toBe('account');
    expect(getCurrentPageFromPathname('/people/123')).toBe('dashboard');
    expect(getCurrentPageFromPathname('/organizations/abc')).toBe('dashboard');
    expect(getCurrentPageFromPathname('/')).toBe('dashboard');
  });
});
