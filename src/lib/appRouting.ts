import type { FilterPreset, MapFilters, SearchMatchMode } from './supabase';
import { DEFAULT_MAP_FILTERS } from './supabase';

export type AppPage =
  | 'dashboard'
  | 'person'
  | 'organization'
  | 'collections'
  | 'collection-detail'
  | 'admin'
  | 'add-contact'
  | 'account';

export type AdminTab = 'discovery' | 'verification' | 'growth' | 'system' | 'access';

export function normalizeAdminTab(tab?: string | null, canAccessAdminOnlyTabs = false): AdminTab {
  if (tab === 'discovery' || tab === 'verification' || tab === 'growth' || tab === 'system') {
    return tab;
  }
  if (tab === 'access' && canAccessAdminOnlyTabs) return 'access';
  return 'discovery';
}

export function isCanonicalAdminTab(tab?: string | null): tab is AdminTab {
  return (
    tab === 'discovery' ||
    tab === 'verification' ||
    tab === 'growth' ||
    tab === 'system' ||
    tab === 'access'
  );
}

export type DashboardViewMode = 'map' | 'list';

export interface DashboardRouteState {
  view: DashboardViewMode;
  query: string;
  matchMode: SearchMatchMode;
  filters: MapFilters;
  focusedCity: { city: string; state: string } | null;
}

function parseBooleanParam(
  value: string | null,
  defaultValue: boolean
): boolean {
  if (value === null) return defaultValue;
  return value !== '0' && value !== 'false';
}

function sanitizeValues(values: string[]): string[] {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean))
  );
}

export function normalizePage(page: string): AppPage {
  if (page === 'directory' || page === 'search') return 'dashboard';
  if (page === 'missions' || page === 'planner') return 'collections';
  return page as AppPage;
}

export function defaultDashboardRouteState(): DashboardRouteState {
  return {
    view: 'map',
    query: '',
    matchMode: 'all',
    filters: { ...DEFAULT_MAP_FILTERS },
    focusedCity: null,
  };
}

export function buildDashboardStateFromPreset(
  preset?: FilterPreset
): DashboardRouteState {
  const next = defaultDashboardRouteState();

  if (!preset) return next;

  if (preset.sector) next.filters.sector = preset.sector;
  if (preset.occupation) next.filters.occupation = preset.occupation;
  if (preset.flemishConnections) {
    next.filters.flemishConnections = sanitizeValues(preset.flemishConnections);
  }
  if (preset.focusCity) {
    next.focusedCity = {
      city: preset.focusCity.city,
      state: preset.focusCity.state,
    };
  }

  return next;
}

export function parseDashboardRouteState(
  searchParams: URLSearchParams
): DashboardRouteState {
  const query = searchParams.get('q')?.trim() || '';
  const viewParam = searchParams.get('view');
  const focusedCity = searchParams.get('focusCity');
  const focusedState = searchParams.get('focusState');

  return {
    view:
      viewParam === 'list' || (!viewParam && query.length > 0) ? 'list' : 'map',
    query,
    matchMode: searchParams.get('match') === 'any' ? 'any' : 'all',
    filters: {
      ...DEFAULT_MAP_FILTERS,
      showPeople: parseBooleanParam(searchParams.get('people'), true),
      showOrganizations: parseBooleanParam(searchParams.get('organizations'), true),
      personScope:
        searchParams.get('personScope') === 'us_based' ||
        searchParams.get('personScope') === 'us_connected_abroad'
          ? searchParams.get('personScope') as MapFilters['personScope']
          : 'all',
      sector: searchParams.get('sector')?.trim() || '',
      occupation: searchParams.get('occupation')?.trim() || '',
      city: searchParams.get('city')?.trim() || '',
      state: searchParams.get('state')?.trim() || '',
      flemishConnections: sanitizeValues(searchParams.getAll('fc')),
      availableForLectures: parseBooleanParam(
        searchParams.get('lectures'),
        false
      ),
    },
    focusedCity:
      focusedCity && focusedState
        ? { city: focusedCity, state: focusedState }
        : null,
  };
}

export function buildDashboardSearchParams(
  state: DashboardRouteState
): URLSearchParams {
  const params = new URLSearchParams();

  if (state.query) params.set('q', state.query);
  if (state.matchMode === 'any') params.set('match', 'any');
  if (state.view === 'list') {
    params.set('view', 'list');
  } else if (state.query) {
    params.set('view', 'map');
  }
  if (!state.filters.showPeople) params.set('people', '0');
  if (!state.filters.showOrganizations) params.set('organizations', '0');
  if (state.filters.personScope !== 'all') {
    params.set('personScope', state.filters.personScope);
  }
  if (state.filters.sector) params.set('sector', state.filters.sector);
  if (state.filters.occupation) {
    params.set('occupation', state.filters.occupation);
  }
  if (state.filters.city) params.set('city', state.filters.city);
  if (state.filters.state) params.set('state', state.filters.state);
  if (state.filters.availableForLectures) params.set('lectures', '1');

  sanitizeValues(state.filters.flemishConnections).forEach((connection) => {
    params.append('fc', connection);
  });

  if (state.focusedCity) {
    params.set('focusCity', state.focusedCity.city);
    params.set('focusState', state.focusedCity.state);
  }

  return params;
}

export function buildDashboardLocation(state: DashboardRouteState): {
  pathname: string;
  search: string;
} {
  const search = buildDashboardSearchParams(state).toString();
  return {
    pathname: '/',
    search: search ? `?${search}` : '',
  };
}

export function getCurrentPageFromPathname(pathname: string): AppPage {
  if (pathname.startsWith('/collections')) return 'collections';
  if (pathname.startsWith('/admin')) return 'admin';
  if (pathname.startsWith('/account')) return 'account';
  if (pathname.startsWith('/people')) return 'dashboard';
  if (pathname.startsWith('/organizations')) return 'dashboard';
  return 'dashboard';
}
