import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const searchFunction = readFileSync(
  resolve(process.cwd(), 'supabase/functions/search-people/index.ts'),
  'utf8'
);

describe('search-people Phase 3 contract', () => {
  it('returns mixed people and organization result envelopes with snippets', () => {
    expect(searchFunction).toContain('entity_type: "person"');
    expect(searchFunction).toContain('entity_type: "organization"');
    expect(searchFunction).toContain('people: visiblePeople');
    expect(searchFunction).toContain('organizations: visibleOrganizations');
    expect(searchFunction).toContain('snippet');
    expect(searchFunction).toContain('rationale');
  });

  it('supports organization visibility filters without changing the route name', () => {
    expect(searchFunction).toContain('filters?.show_people !== false');
    expect(searchFunction).toContain('filters?.show_organizations !== false');
    expect(searchFunction).toContain('search_organizations_lexical');
  });
});
