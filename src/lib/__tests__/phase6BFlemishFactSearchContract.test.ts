import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260507120000_phase6b_flemish_fact_search_canonicalization.sql'),
  'utf8'
);

describe('Phase 6B Flemish fact search canonicalization contract', () => {
  it('rebuilds people search documents with canonical facts and relationship evidence', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION build_people_search_document');
    expect(migration).toContain('person_flemish_connections pfc');
    expect(migration).toContain('pfc.role');
    expect(migration).toContain('pfc.evidence_excerpt');
    expect(migration).toContain('flemish_connection_aliases fca');
  });

  it('rebuilds organization search documents from normalized organization facts', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION build_organization_search_document');
    expect(migration).toContain('organization_flemish_connections ofc');
    expect(migration).toContain('ofc.role');
    expect(migration).toContain('ofc.evidence_excerpt');
    expect(migration).not.toContain('coalesce(o.flemish_link');
  });

  it('keeps organization lexical scoring strong for canonical Flemish facts', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION search_organizations_lexical');
    expect(migration).toContain('d.flemish_link_normalized % p.normalized_query');
    expect(migration).toContain('0.24 * s.flemish_link_score');
    expect(migration).toContain('OR s.flemish_link_score >= 0.35');
  });
});
