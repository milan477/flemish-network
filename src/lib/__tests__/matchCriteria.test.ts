import { describe, expect, it } from 'vitest';
import {
  applyPeopleMatchCriteria,
  countActiveMatchCriteria,
} from '../matchCriteria';
import { DEFAULT_MAP_FILTERS, type Person } from '../supabase';

function person(overrides: Partial<Person>): Person {
  return {
    id: overrides.id || 'person-id',
    name: overrides.name || 'Person',
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

describe('matchCriteria', () => {
  it('counts person scope as a match criterion', () => {
    expect(
      countActiveMatchCriteria({
        ...DEFAULT_MAP_FILTERS,
        sector: 'Finance',
        personScope: 'us_based',
      })
    ).toBe(2);
  });

  it('applies all vs any across sector and person scope', () => {
    const filters = {
      ...DEFAULT_MAP_FILTERS,
      sector: 'Finance',
      personScope: 'us_based' as const,
    };
    const people = [
      person({ id: 'both', sector_names: 'Finance', us_network_status: 'us_based' }),
      person({ id: 'sector', sector_names: 'Finance', us_network_status: 'us_connected_abroad' }),
      person({ id: 'scope', sector_names: 'Biotechnology', us_network_status: 'us_based' }),
      person({ id: 'neither', sector_names: 'Biotechnology', us_network_status: 'us_connected_abroad' }),
    ];

    expect(applyPeopleMatchCriteria(people, filters, 'all').map((row) => row.id))
      .toEqual(['both']);
    expect(applyPeopleMatchCriteria(people, filters, 'any').map((row) => row.id))
      .toEqual(['both', 'sector', 'scope']);
  });
});
