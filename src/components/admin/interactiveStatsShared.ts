import type { FilterPreset, Person } from '../../lib/supabase';

export type FreshnessTier = 'fresh' | 'aging' | 'stale' | 'outdated';
export type AvailabilityFilter = 'lectures' | 'mentorship' | 'visits';
export type CompletenessField =
  | 'email'
  | 'linkedin_url'
  | 'profile_photo_url'
  | 'bio'
  | 'sector'
  | 'flemish_connection';

export interface CrossFilterState {
  sector: string | null;
  occupationCategory: string | null;
  flemishConnection: string | null;
  state: string | null;
  city: string | null;
  freshnessTier: FreshnessTier | null;
  availability: AvailabilityFilter[];
  completenessField: { field: CompletenessField; has: boolean } | null;
}

export interface PersonSectorRow {
  person_id: string;
  sector_id: string;
  sectors: { name: string } | null;
}

export interface ConnectionStatsRow {
  from_person_id: string | null;
  to_person_id: string | null;
  relationship_type: string | null;
}

export const EMPTY_CROSS_FILTERS: CrossFilterState = {
  sector: null,
  occupationCategory: null,
  flemishConnection: null,
  state: null,
  city: null,
  freshnessTier: null,
  availability: [],
  completenessField: null,
};

export const COMPLETENESS_FIELD_LABELS: Record<CompletenessField, string> = {
  email: 'Email',
  linkedin_url: 'LinkedIn',
  profile_photo_url: 'Photo',
  bio: 'Bio',
  sector: 'Sector',
  flemish_connection: 'Flemish Connection',
};

export const FRESHNESS_TIER_LABELS: Record<FreshnessTier, string> = {
  fresh: 'Up to date',
  aging: 'Aging (30-90d)',
  stale: 'Stale (3-12mo)',
  outdated: 'Outdated (>1yr)',
};

export function getFreshnessTier(
  person: Pick<Person, 'updated_at'>
): FreshnessTier {
  const days = Math.floor(
    (Date.now() - new Date(person.updated_at).getTime()) /
      (1000 * 60 * 60 * 24)
  );

  if (days < 30) return 'fresh';
  if (days < 90) return 'aging';
  if (days < 365) return 'stale';
  return 'outdated';
}

export function mapCategoryToNetworkOccupation(
  category: string | null
): FilterPreset['occupation'] | undefined {
  switch (category) {
    case 'Professors':
    case 'Researchers':
      return 'Academic/Researcher';
    case 'Engineers':
    case 'Creatives':
    case 'Healthcare':
    case 'Finance':
      return 'Professional';
    case 'Executives':
    case 'Entrepreneurs':
    case 'Government':
      return 'Executive/Leadership';
    default:
      return undefined;
  }
}

export function buildNetworkPreset(
  filters: CrossFilterState
): FilterPreset | null {
  const preset: FilterPreset = {};

  if (filters.sector) preset.sector = filters.sector;

  const mappedOccupation = mapCategoryToNetworkOccupation(
    filters.occupationCategory
  );
  if (mappedOccupation) preset.occupation = mappedOccupation;

  if (filters.flemishConnection) {
    preset.flemishConnections = [filters.flemishConnection];
  }

  if (filters.city && filters.state) {
    preset.focusCity = { city: filters.city, state: filters.state };
  }

  return Object.keys(preset).length > 0 ? preset : null;
}
