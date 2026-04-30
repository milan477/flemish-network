import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getCachedDashboardSearch,
  setCachedDashboardSearch,
  setLastDashboardLocation,
  getLastDashboardLocation,
} from '../dashboardSession';

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('dashboardSession - search cache', () => {
  it('roundtrips a cached search by query', () => {
    setCachedDashboardSearch({
      query: 'AI in Boston',
      nameMatches: [],
      aiResults: [],
      snippets: [['p1', 'snippet text']],
    });
    const got = getCachedDashboardSearch('AI in Boston');
    expect(got).not.toBeNull();
    expect(got?.snippets).toEqual([['p1', 'snippet text']]);
    expect(got?.updatedAt).toBeTypeOf('number');
  });

  it('normalizes query for hits (case + trim insensitive)', () => {
    setCachedDashboardSearch({
      query: '  AI in Boston  ',
      nameMatches: [],
      aiResults: [],
      snippets: [],
    });
    expect(getCachedDashboardSearch('ai in boston')).not.toBeNull();
  });

  it('returns null on miss', () => {
    expect(getCachedDashboardSearch('nothing here')).toBeNull();
  });

  it('returns null for empty query', () => {
    expect(getCachedDashboardSearch('   ')).toBeNull();
  });

  it('skips writes for empty query', () => {
    setCachedDashboardSearch({
      query: '   ',
      nameMatches: [],
      aiResults: [],
      snippets: [],
    });
    expect(window.sessionStorage.getItem('dashboard-search-cache-v1')).toBeNull();
  });

  it('replaces existing entry rather than duplicating it', () => {
    setCachedDashboardSearch({
      query: 'foo',
      nameMatches: [],
      aiResults: [],
      snippets: [['a', 'one']],
    });
    setCachedDashboardSearch({
      query: 'FOO',
      nameMatches: [],
      aiResults: [],
      snippets: [['b', 'two']],
    });
    const raw = JSON.parse(
      window.sessionStorage.getItem('dashboard-search-cache-v1')!
    );
    expect(raw).toHaveLength(1);
    expect(raw[0].snippets).toEqual([['b', 'two']]);
  });

  it('caps cache to 10 entries (LRU eviction)', () => {
    for (let i = 0; i < 12; i++) {
      setCachedDashboardSearch({
        query: `q-${i}`,
        nameMatches: [],
        aiResults: [],
        snippets: [],
      });
    }
    const raw = JSON.parse(
      window.sessionStorage.getItem('dashboard-search-cache-v1')!
    );
    expect(raw).toHaveLength(10);
    // Most recent (q-11) is at the head; oldest (q-0, q-1) evicted.
    expect(raw[0].query).toBe('q-11');
    expect(getCachedDashboardSearch('q-0')).toBeNull();
    expect(getCachedDashboardSearch('q-11')).not.toBeNull();
  });

  it('survives a JSON parse error gracefully', () => {
    window.sessionStorage.setItem('dashboard-search-cache-v1', 'not-json');
    expect(getCachedDashboardSearch('foo')).toBeNull();
  });
});

describe('dashboardSession - last location', () => {
  it('roundtrips a path that starts with /', () => {
    setLastDashboardLocation('/?q=foo');
    expect(getLastDashboardLocation()).toBe('/?q=foo');
  });

  it('rejects locations that do not start with /', () => {
    setLastDashboardLocation('http://evil.example.com');
    expect(getLastDashboardLocation()).toBeNull();
  });

  it('returns null when stored value is malformed', () => {
    window.sessionStorage.setItem('last-dashboard-location-v1', 'not-a-path');
    expect(getLastDashboardLocation()).toBeNull();
  });
});

describe('dashboardSession - storage failures', () => {
  it('swallows setItem quota errors', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceeded');
    });
    expect(() =>
      setCachedDashboardSearch({
        query: 'x',
        nameMatches: [],
        aiResults: [],
        snippets: [],
      })
    ).not.toThrow();
    expect(() => setLastDashboardLocation('/')).not.toThrow();
  });

  it('returns null reads when getItem throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(getCachedDashboardSearch('x')).toBeNull();
    expect(getLastDashboardLocation()).toBeNull();
  });
});
