import { describe, expect, it } from 'vitest';
import {
  canonicalizeFlemishConnection,
  canonicalizeFlemishConnectionFilter,
  DEFAULT_FLEMISH_CONNECTIONS,
} from '../flemishConnections';

describe('flemish connection canonicalization', () => {
  it('keeps the default filter catalog aligned with Phase 6 broad entities', () => {
    expect(DEFAULT_FLEMISH_CONNECTIONS.map((connection) => connection.name).sort()).toEqual([
      'KU Leuven',
      'UGent',
      'imec',
      'BAEF',
      'Flemish Government',
      'FIT',
      'VUB',
      'Vlerick',
      'VITO',
      'Flanders Make',
      'VIB',
    ].sort());
  });

  it('canonicalizes representative aliases to the seeded canonical names', () => {
    expect(canonicalizeFlemishConnection('University of Ghent')?.name).toBe('UGent');
    expect(canonicalizeFlemishConnectionFilter('Flanders Investment and Trade')).toBe('FIT');
    expect(canonicalizeFlemishConnectionFilter('Belgian American Educational Foundation')).toBe('BAEF');
  });
});
