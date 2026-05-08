import { describe, expect, it } from 'vitest';
import {
  buildPeopleCsv,
  buildPeopleWorksheetData,
  type PersonWithSectors,
} from '../exportService';

const basePerson: PersonWithSectors = {
  id: 'person-1',
  name: 'Dr. Jan De Smet',
  title: 'Dr.',
  first_name: 'Jan',
  last_name: 'De Smet',
  current_position: 'Founder, CEO at Acme; Labs',
  bio: 'Line one\nLine "two" with café',
  locations: {
    id: 'loc-1',
    city: 'New York',
    state: 'NY',
    latitude: null,
    longitude: null,
  },
  sectorNames: ['AI', 'Semiconductors'],
  flemish_connection: 'KU Leuven, imec',
  email: 'jan@example.com',
  linkedin_url: 'https://linkedin.com/in/jandesmet',
  website_url: 'https://example.com/profile?tags=a,b',
  twitter_url: 'https://x.com/jandesmet',
  created_at: '2026-05-01T00:00:00.000Z',
  updated_at: '2026-05-01T00:00:00.000Z',
};

describe('people export formatting', () => {
  it('keeps comma CSV structure while escaping commas, quotes, line breaks, and accents', () => {
    const csv = buildPeopleCsv([basePerson]);

    expect(csv).toContain('"Founder, CEO at Acme; Labs"');
    expect(csv).toContain('"Line one\nLine ""two"" with café"');
    expect(csv).toContain('AI; Semiconductors');
    expect(csv).toContain('"imec, KU Leuven"');
    expect(csv).toContain('"https://example.com/profile?tags=a,b"');
  });

  it('builds native worksheet rows without CSV delimiter concerns', () => {
    const rows = buildPeopleWorksheetData([basePerson]);

    expect(rows[0]).toContain('Position');
    expect(rows[1][3]).toBe('Founder, CEO at Acme; Labs');
    expect(rows[1][5]).toBe('Line one\nLine "two" with café');
    expect(rows[1][8]).toBe('AI; Semiconductors');
    expect(rows[1][12]).toBe('https://example.com/profile?tags=a,b');
  });
});
