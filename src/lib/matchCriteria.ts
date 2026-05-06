import {
  fuzzyMatch,
  OCCUPATION_CATEGORY_KEYWORDS,
  type MapFilters,
  type Organization,
  type Person,
  type SearchMatchMode,
} from './supabase';
import { getPersonFlemishConnectionText } from './flemishConnections';
import {
  organizationMatchesLocation,
  personMatchesLocation,
} from './networkScope';

interface MatchCriterion<T> {
  id: string;
  matches: (item: T) => boolean;
}

function personSectorNames(person: Person): string[] {
  const names: string[] = [];

  if (person.sector_names) {
    names.push(...person.sector_names.split(',').map((value) => value.trim()));
  }

  for (const link of person.person_sectors || []) {
    const sectors = Array.isArray(link.sectors)
      ? link.sectors
      : link.sectors
        ? [link.sectors]
        : [];
    for (const sector of sectors) {
      if (sector.name) names.push(sector.name);
    }
  }

  return Array.from(new Set(names.filter(Boolean)));
}

function personMatchesSector(person: Person, sector: string): boolean {
  const sectorNames = personSectorNames(person);
  if (sectorNames.some((name) => fuzzyMatch(sector, name))) return true;

  return fuzzyMatch(sector, person.occupation || '') ||
    fuzzyMatch(sector, person.current_position || '') ||
    fuzzyMatch(sector, person.bio || '');
}

function personMatchesOccupation(person: Person, occupation: string): boolean {
  const keywords = OCCUPATION_CATEGORY_KEYWORDS[occupation] || [occupation];
  const haystack = [
    person.occupation,
    person.current_position,
    person.bio,
  ].filter(Boolean).join(' ');

  return keywords.some((keyword) => fuzzyMatch(keyword, haystack));
}

function personMatchesFlemishConnection(person: Person, connection: string): boolean {
  return fuzzyMatch(connection, getPersonFlemishConnectionText(person) || '');
}

function organizationMatchesText(
  organization: Organization,
  needle: string
): boolean {
  return fuzzyMatch(needle, organization.type || '') ||
    fuzzyMatch(needle, organization.name || '') ||
    fuzzyMatch(needle, organization.description || '') ||
    fuzzyMatch(needle, organization.flemish_link || '');
}

function buildPersonCriteria(filters: MapFilters): MatchCriterion<Person>[] {
  const criteria: MatchCriterion<Person>[] = [];

  if (filters.sector) {
    criteria.push({
      id: `sector:${filters.sector}`,
      matches: (person) => personMatchesSector(person, filters.sector),
    });
  }

  if (filters.personScope !== 'all') {
    criteria.push({
      id: `personScope:${filters.personScope}`,
      matches: (person) => person.us_network_status === filters.personScope,
    });
  }

  if (filters.occupation) {
    criteria.push({
      id: `occupation:${filters.occupation}`,
      matches: (person) => personMatchesOccupation(person, filters.occupation),
    });
  }

  if (filters.city || filters.state) {
    criteria.push({
      id: `location:${filters.city}:${filters.state}`,
      matches: (person) => personMatchesLocation(person, filters),
    });
  }

  for (const connection of filters.flemishConnections) {
    criteria.push({
      id: `flemish:${connection}`,
      matches: (person) => personMatchesFlemishConnection(person, connection),
    });
  }

  return criteria;
}

function buildOrganizationCriteria(filters: MapFilters): MatchCriterion<Organization>[] {
  const criteria: MatchCriterion<Organization>[] = [];

  if (filters.sector) {
    criteria.push({
      id: `sector:${filters.sector}`,
      matches: (organization) => organizationMatchesText(organization, filters.sector),
    });
  }

  if (filters.occupation) {
    criteria.push({
      id: `occupation:${filters.occupation}`,
      matches: (organization) => organizationMatchesText(organization, filters.occupation),
    });
  }

  if (filters.city || filters.state) {
    criteria.push({
      id: `location:${filters.city}:${filters.state}`,
      matches: (organization) => organizationMatchesLocation(organization, filters),
    });
  }

  for (const connection of filters.flemishConnections) {
    criteria.push({
      id: `flemish:${connection}`,
      matches: (organization) => organizationMatchesText(organization, connection),
    });
  }

  return criteria;
}

function applyCriteria<T>(
  items: T[],
  criteria: MatchCriterion<T>[],
  matchMode: SearchMatchMode
): T[] {
  if (criteria.length === 0) return items;

  return items
    .map((item, index) => ({
      item,
      index,
      matchCount: criteria.filter((criterion) => criterion.matches(item)).length,
    }))
    .filter(({ matchCount }) =>
      matchMode === 'any' ? matchCount > 0 : matchCount === criteria.length
    )
    .sort((a, b) => b.matchCount - a.matchCount || a.index - b.index)
    .map(({ item }) => item);
}

export function countActiveMatchCriteria(filters: MapFilters): number {
  return buildPersonCriteria(filters).length;
}

export function applyPeopleMatchCriteria(
  people: Person[],
  filters: MapFilters,
  matchMode: SearchMatchMode
): Person[] {
  return applyCriteria(people, buildPersonCriteria(filters), matchMode);
}

export function applyOrganizationMatchCriteria(
  organizations: Organization[],
  filters: MapFilters,
  matchMode: SearchMatchMode
): Organization[] {
  return applyCriteria(
    organizations,
    buildOrganizationCriteria(filters),
    matchMode
  );
}

export function dashboardSearchCacheScope(
  filters: MapFilters,
  matchMode: SearchMatchMode
): string {
  return JSON.stringify({
    matchMode,
    personScope: filters.personScope,
    sector: filters.sector,
    occupation: filters.occupation,
    city: filters.city,
    state: filters.state,
    flemishConnections: [...filters.flemishConnections].sort(),
  });
}
