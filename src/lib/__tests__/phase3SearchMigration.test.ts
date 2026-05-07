import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260507000000_phase3_search_network.sql'),
  'utf8'
);

describe('Phase 3 organization search migration', () => {
  it('creates the organization search document table and lexical RPC', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS organization_search_documents');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION search_organizations_lexical');
    expect(migration).toContain('build_organization_search_tsv');
  });

  it('syncs organizations from facts that affect search coverage', () => {
    expect(migration).toContain('tr_sync_organization_search_document');
    expect(migration).toContain('tr_sync_organization_search_document_organization_sectors');
    expect(migration).toContain('tr_sync_organization_search_document_us_locations');
    expect(migration).toContain('tr_sync_organization_search_document_location');
  });

  it('indexes lexical, trigram, and location search fields', () => {
    expect(migration).toContain('organization_search_documents_search_tsv_idx');
    expect(migration).toContain('organization_search_documents_search_text_trgm_idx');
    expect(migration).toContain('organization_search_documents_location_trgm_idx');
  });
});
