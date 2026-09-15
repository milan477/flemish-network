import { describe, expect, it } from 'vitest';
import {
  buildSearchRefinementSuggestions,
  exactSearchKeywords,
  personExactSearchScore,
  personMatchesExactSearch,
  resultMatchesRefinement,
} from '../searchRefinements';
import type { HybridSearchResultItem, SmartSearchKeywords } from '../aiService';

const emptyKeywords: SmartSearchKeywords = {
  name: [], occupation: [], sector: [], location_city: [], location_state: [],
  current_position: [], flemish_connection: [], bio: [],
};

const berkeleyPerson: HybridSearchResultItem = {
  entity_type: 'person',
  id: 'p1',
  name: 'Alex Example',
  first_name: 'Alex',
  last_name: 'Example',
  title: null,
  current_position: 'Researcher at UC Berkeley',
  bio: 'Studied engineering at UC Berkeley.',
  occupation: 'Researcher',
  flemish_connection: null,
  profile_photo_url: null,
  email: null,
  linkedin_url: null,
  last_verified_at: null,
  available_for_lectures: null,
  location_id: 'l1',
  locations: { city: 'Berkeley', state: 'CA' },
  score: 1,
  snippet: 'UC Berkeley researcher',
};

describe('search refinements', () => {
  it('normalizes generic shorthand into canonical query concepts', () => {
    expect(exactSearchKeywords('uni of chicago')).toEqual(['university', 'chicago']);
  });

  it('splits an ambiguous Berkeley query into university and location suggestions', () => {
    const suggestions = buildSearchRefinementSuggestions('Berkeley', {
      ...emptyKeywords,
      location_city: ['berkeley'],
    }, [berkeleyPerson]);

    expect(suggestions.map((suggestion) => suggestion.label)).toEqual([
      'University: UC Berkeley',
      'Location: Berkeley',
    ]);
  });

  it('strictly separates university and location matches', () => {
    const suggestions = buildSearchRefinementSuggestions('Berkeley', {
      ...emptyKeywords,
      location_city: ['berkeley'],
    }, [berkeleyPerson]);
    const university = suggestions[0];
    const location = suggestions[1];
    const chicagoPerson = {
      ...berkeleyPerson,
      id: 'p2',
      current_position: 'Researcher at the University of Chicago',
      bio: 'Based in Chicago.',
      snippet: 'University of Chicago researcher',
      locations: { city: 'Chicago', state: 'IL' },
    };

    expect(resultMatchesRefinement(berkeleyPerson, university)).toBe(true);
    expect(resultMatchesRefinement(chicagoPerson, university)).toBe(false);
    expect(resultMatchesRefinement(berkeleyPerson, location)).toBe(true);
    expect(resultMatchesRefinement(chicagoPerson, location)).toBe(false);
  });

  it('uses AI-extracted facets for general queries', () => {
    const suggestions = buildSearchRefinementSuggestions('biotech in Boston', {
      ...emptyKeywords,
      sector: ['biotechnology'],
      location_city: ['boston'],
      location_state: ['ma'],
    }, []);

    expect(suggestions.map((suggestion) => suggestion.label)).toEqual([
      'Location: Boston, MA',
      'Sector: Biotechnology',
    ]);
  });

  it('keeps general matches literal and excludes unrelated semantic results', () => {
    const unrelatedPerson = {
      ...berkeleyPerson,
      id: 'p2',
      current_position: 'Fayat scholar',
      bio: 'Studied at UC Berkeley.',
      snippet: 'Fayat scholarship alumnus',
    };
    const harvardPerson = {
      ...berkeleyPerson,
      id: 'p3',
      current_position: 'Student at Harvard University',
      bio: 'Completed a degree at Harvard.',
      snippet: 'Harvard University alumnus',
    };

    expect(personMatchesExactSearch(unrelatedPerson as never, 'harvard', unrelatedPerson.snippet)).toBe(false);
    expect(personMatchesExactSearch(harvardPerson as never, 'harvard', harvardPerson.snippet)).toBe(true);
  });

  it('requires the complete submitted phrase for general matches', () => {
    const fullMatch = {
      ...berkeleyPerson,
      current_position: 'Student at New York University',
      bio: 'Completed graduate study in New York.',
    };
    const partialMatch = {
      ...berkeleyPerson,
      current_position: 'University administrator in New York',
      bio: 'Works in higher education.',
    };

    expect(personExactSearchScore(fullMatch as never, 'new york university')).toBe(1);
    expect(personExactSearchScore(partialMatch as never, 'new york university')).toBe(0);
    expect(personMatchesExactSearch(partialMatch as never, 'new york university')).toBe(false);
  });

  it('infers a canonical institution concept from matching result text', () => {
    const chicagoResult: HybridSearchResultItem = {
      ...berkeleyPerson,
      current_position: 'Student at the University of Chicago',
      bio: 'Completed a degree at the University of Chicago.',
      snippet: 'University of Chicago alumnus',
    };

    const suggestions = buildSearchRefinementSuggestions(
      'uni of chicago',
      { ...emptyKeywords, current_position: ['university'], location_city: ['chicago'] },
      [chicagoResult]
    );

    expect(suggestions.map((suggestion) => suggestion.label)).toContain(
      'University: University of Chicago'
    );
  });

  it('expands an acronym by matching it to an institution in the results', () => {
    const nyuResult: HybridSearchResultItem = {
      ...berkeleyPerson,
      current_position: 'Researcher at New York University',
      bio: 'Completed a degree at New York University.',
      snippet: 'New York University alumnus',
    };

    const suggestions = buildSearchRefinementSuggestions(
      'NYU',
      emptyKeywords,
      [nyuResult]
    );

    expect(suggestions.map((suggestion) => suggestion.label)).toContain(
      'University: New York University'
    );
  });
});
