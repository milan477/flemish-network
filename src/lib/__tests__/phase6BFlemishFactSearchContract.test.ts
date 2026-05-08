import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const phase6BMigration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260507120000_phase6b_flemish_fact_search_canonicalization.sql'),
  'utf8'
);

const phase6DMigration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260507130000_phase6d_flemish_fact_cleanup.sql'),
  'utf8'
);

describe('Phase 6B Flemish fact search canonicalization contract', () => {
  it('rebuilds people search documents with canonical facts and relationship evidence', () => {
    expect(phase6BMigration).toContain('CREATE OR REPLACE FUNCTION build_people_search_document');
    expect(phase6BMigration).toContain('person_flemish_connections pfc');
    expect(phase6BMigration).toContain('pfc.role');
    expect(phase6BMigration).toContain('pfc.evidence_excerpt');
    expect(phase6BMigration).toContain('flemish_connection_aliases fca');
  });

  it('rebuilds organization search documents from normalized organization facts', () => {
    expect(phase6DMigration).toContain('CREATE OR REPLACE FUNCTION build_organization_search_document');
    expect(phase6DMigration).toContain('organization_flemish_connections ofc');
    expect(phase6DMigration).toContain('ofc.role');
    expect(phase6DMigration).toContain('ofc.evidence_excerpt');
    expect(phase6DMigration).not.toContain(`coalesce(o.${'flemish_' + 'link'}`);
  });

  it('keeps organization lexical scoring strong for canonical Flemish facts', () => {
    expect(phase6DMigration).toContain('CREATE OR REPLACE FUNCTION search_organizations_lexical');
    expect(phase6DMigration).toContain('d.flemish_fact_text_normalized % p.normalized_query');
    expect(phase6DMigration).toContain('0.24 * s.flemish_fact_score');
    expect(phase6DMigration).toContain('OR s.flemish_fact_score >= 0.35');
  });
});
