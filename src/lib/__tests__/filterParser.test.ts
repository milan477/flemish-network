import { describe, it, expect } from 'vitest';
import { parseFiltersFromQuery } from '../filterParser';
import { DEFAULT_MAP_FILTERS } from '../supabase';

const base = () => ({ ...DEFAULT_MAP_FILTERS, flemishConnections: [] });

describe('parseFiltersFromQuery', () => {
  describe('reset keywords', () => {
    it.each(['reset', 'clear', 'show all'])('resets filters on "%s"', (q) => {
      const current = { ...base(), sector: 'Finance', city: 'Boston' };
      const { filters, message } = parseFiltersFromQuery(q, current);
      expect(filters).toEqual(DEFAULT_MAP_FILTERS);
      expect(message).toMatch(/cleared/i);
    });
  });

  describe('sector', () => {
    it('detects "AI" via word-boundary alias', () => {
      const { filters } = parseFiltersFromQuery('looking for ai people', base());
      expect(filters.sector).toBe('Artificial Intelligence');
    });

    it('detects "biotech"', () => {
      const { filters } = parseFiltersFromQuery('biotech founders', base());
      expect(filters.sector).toBe('Biotechnology');
    });

    it('does not match alias inside another word', () => {
      const { filters } = parseFiltersFromQuery('paint', base());
      expect(filters.sector).toBe('');
    });
  });

  describe('occupation', () => {
    it('detects "ceo"', () => {
      const { filters } = parseFiltersFromQuery('ceo in nyc', base());
      expect(filters.occupation).toBe('Executive/Leadership');
    });

    it('detects "researcher"', () => {
      const { filters } = parseFiltersFromQuery('researcher', base());
      expect(filters.occupation).toBe('Academic/Researcher');
    });
  });

  describe('US state', () => {
    it('detects full name "California"', () => {
      const { filters } = parseFiltersFromQuery('people in California', base());
      expect(filters.state).toBe('CA');
    });

    it('detects 2-letter code with word boundary', () => {
      const { filters } = parseFiltersFromQuery('show ny contacts', base());
      expect(filters.state).toBe('NY');
    });

    it('does not match a 2-letter code embedded in a word', () => {
      const { filters } = parseFiltersFromQuery('many', base());
      expect(filters.state).toBe('');
    });
  });

  describe('cities', () => {
    it('detects "sf" → San Francisco', () => {
      const { filters } = parseFiltersFromQuery('sf engineers', base());
      expect(filters.city).toBe('San Francisco');
    });

    it('detects multi-word "new orleans"', () => {
      const { filters } = parseFiltersFromQuery('new orleans culture', base());
      expect(filters.city).toBe('New Orleans');
    });
  });

  describe('flemish connections', () => {
    it('detects single connection', () => {
      const { filters } = parseFiltersFromQuery('ku leuven alumni', base());
      expect(filters.flemishConnections).toEqual(['KU Leuven']);
    });

    it('collects multiple connections', () => {
      const { filters } = parseFiltersFromQuery('vub or ugent or imec', base());
      expect(filters.flemishConnections.sort()).toEqual(['UGent', 'VUB', 'imec'].sort());
    });
  });

  describe('lectures', () => {
    it('detects speaker keyword', () => {
      const { filters } = parseFiltersFromQuery('available speakers', base());
      expect(filters.availableForLectures).toBe(true);
    });
  });

  describe('combined / edge cases', () => {
    it('handles empty query — no filters detected', () => {
      const current = base();
      const { filters, message } = parseFiltersFromQuery('', current);
      expect(filters).toBe(current);
      expect(message).toMatch(/no specific filters/i);
    });

    it('handles malformed input without throwing', () => {
      expect(() =>
        parseFiltersFromQuery('!@#$%^&*()', base())
      ).not.toThrow();
    });

    it('is case-insensitive', () => {
      const { filters } = parseFiltersFromQuery('AI in CA', base());
      expect(filters.sector).toBe('Artificial Intelligence');
      expect(filters.state).toBe('CA');
    });

    it('detects sector + state + occupation together', () => {
      const { filters, message } = parseFiltersFromQuery(
        'biotech researcher Massachusetts',
        base()
      );
      expect(filters.sector).toBe('Biotechnology');
      expect(filters.occupation).toBe('Academic/Researcher');
      expect(filters.state).toBe('MA');
      expect(message).toContain('Filtering by');
    });

    it('handles non-ASCII city names without crashing', () => {
      expect(() =>
        parseFiltersFromQuery('São Paulo café', base())
      ).not.toThrow();
    });
  });
});
