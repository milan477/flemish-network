import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260507004000_organization_embeddings_search.sql'),
  'utf8'
);

const edgeDatabaseTypes = readFileSync(
  resolve(process.cwd(), 'supabase/functions/_shared/database.types.ts'),
  'utf8'
);

describe('organization embeddings migration', () => {
  it('adds organization-level embeddings, chunk vectors, and queue tables', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS embedding extensions.vector(768)');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS embedding_dirty_at');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS embedding_generated_at');
    expect(migration).toContain('organizations_embedding_hnsw_idx');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS organization_text_chunks');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS organization_embedding_jobs');
  });

  it('creates organization vector and chunk match RPCs', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION match_organizations');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION match_organization_text_chunks');
    expect(migration).toContain('exclude_organization_id uuid DEFAULT NULL');
    expect(migration).toContain('ORDER BY o.embedding <=> query_embedding');
    expect(migration).toContain('ORDER BY c.embedding <=> query_embedding');
  });

  it('queues organization embeddings when approved organization facts change', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION enqueue_organization_embedding_job');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION enqueue_dirty_organization_embedding_jobs');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION claim_organization_embedding_jobs');
    expect(migration).toContain('tr_mark_organization_embedding_dirty');
    expect(migration).toContain('tr_mark_organization_embedding_dirty_organization_sectors');
    expect(migration).toContain('tr_mark_organization_embedding_dirty_us_locations');
    expect(migration).toContain('tr_mark_organization_embedding_dirty_location');
    expect(migration).toContain('SELECT enqueue_dirty_organization_embedding_jobs()');
  });

  it('refreshes organization search documents with richer location text', () => {
    expect(migration).toContain('format_organization_location_search_text');
    expect(migration).toContain('sync_organization_primary_location_id');
    expect(migration).toContain('tr_sync_organization_primary_location_id_us_locations');
    expect(migration).toContain('CROSS JOIN LATERAL build_organization_search_document(o.id) AS doc');
  });

  it('updates edge database types for organization semantic search tables and RPCs', () => {
    expect(edgeDatabaseTypes).toContain('embedding_dirty_at: string | null;');
    expect(edgeDatabaseTypes).toContain('organization_embedding_jobs: Table<OrganizationEmbeddingJobRow>;');
    expect(edgeDatabaseTypes).toContain('organization_text_chunks: Table<OrganizationTextChunkRow>;');
    expect(edgeDatabaseTypes).toContain('match_organizations');
    expect(edgeDatabaseTypes).toContain('match_organization_text_chunks');
    expect(edgeDatabaseTypes).toContain('claim_organization_embedding_jobs');
  });
});
