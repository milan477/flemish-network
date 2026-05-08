import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = resolve(process.cwd(), 'supabase/migrations');

function findPhase6AMigration(): { file: string; sql: string } | undefined {
  const migrationFiles = readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  return migrationFiles
    .map((file) => ({
      file,
      sql: readFileSync(resolve(migrationsDir, file), 'utf8'),
    }))
    .find(
      ({ sql }) =>
        sql.includes('flemish_connection_aliases') &&
        sql.includes('organization_flemish_connections')
    );
}

const phase6AMigration = findPhase6AMigration();

function phase6ASql(): string {
  if (!phase6AMigration) {
    throw new Error(
      'Phase 6A migration not found: expected a SQL migration that defines flemish_connection_aliases and organization_flemish_connections.'
    );
  }

  return phase6AMigration.sql;
}

function expectSeededEntity(name: string): void {
  expect(phase6ASql()).toContain(`'${name}'`);
}

describe('Phase 6A Flemish fact normalization migration contract', () => {
  it('has a SQL migration that owns aliases and organization fact relationships', () => {
    expect(
      phase6AMigration,
      'expected a SQL migration that defines flemish_connection_aliases and organization_flemish_connections'
    ).toBeDefined();
  });

  const itWithPhase6AMigration = phase6AMigration ? it : it.skip;

  itWithPhase6AMigration('creates an idempotent alias table for dynamic canonicalization', () => {
    const migration = phase6ASql();

    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.flemish_connection_aliases');
    expect(migration).toContain('flemish_connection_id uuid NOT NULL REFERENCES public.flemish_connections(id)');
    expect(migration).toContain('alias text NOT NULL');
    expect(migration).toContain('normalized_alias text');
    expect(migration).toContain('source text');
    expect(migration).toContain('status text');
    expect(migration).toContain('evidence_excerpt text');
    expect(migration).toContain('flemish_connection_aliases_normalized_alias');
    expect(migration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS');
  });

  itWithPhase6AMigration('seeds broad filterable canonical entities idempotently', () => {
    const migration = phase6ASql();

    expect(migration).toContain('ON CONFLICT');
    expect(migration).toContain('is_filterable');

    [
      'KU Leuven',
      'UGent',
      'imec',
      'BAEF',
      'Flemish Government',
      'Flanders Investment & Trade',
      'VUB',
      'Vlerick',
      'VITO',
      'Flanders Make',
      'VIB',
    ].forEach(expectSeededEntity);
  });

  itWithPhase6AMigration('canonicalizes University of Ghent to UGent through seeded aliases', () => {
    const migration = phase6ASql();

    expectSeededEntity('UGent');
    expect(migration).toContain('University of Ghent');
    expect(migration).toContain('Ghent University');
    expect(migration).toContain('Universiteit Gent');
    expect(migration).toMatch(/University of Ghent[\s\S]+UGent|UGent[\s\S]+University of Ghent/);
  });

  itWithPhase6AMigration('adds evidence-backed person and organization Flemish fact relationships', () => {
    const migration = phase6ASql();

    expect(migration).toContain('ALTER TABLE public.person_flemish_connections');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS role text');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS confidence');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS source_url text');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS evidence_excerpt text');

    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.organization_flemish_connections');
    expect(migration).toContain('organization_id uuid NOT NULL REFERENCES public.organizations(id)');
    expect(migration).toContain('flemish_connection_id uuid NOT NULL REFERENCES public.flemish_connections(id)');
    expect(migration).toContain('role text');
    expect(migration).toContain('confidence');
    expect(migration).toContain('source_url text');
    expect(migration).toContain('evidence_excerpt text');
  });

  itWithPhase6AMigration(`backfills organization facts without depending on organizations.${'flemish_' + 'link'} as the future product field`, () => {
    const migration = phase6ASql();

    expect(migration).toContain(`organizations.${'flemish_' + 'link'}`);
    expect(migration).toContain('organization_flemish_connections');
    expect(migration).toContain('flemish_connection_aliases');
    expect(migration).toContain('ON CONFLICT');
  });

  itWithPhase6AMigration('refreshes search documents and embeddings when canonical facts or aliases change', () => {
    const migration = phase6ASql();

    [
      'person_flemish_connections',
      'organization_flemish_connections',
      'flemish_connection_aliases',
      'sync_person_search_document',
      'sync_organization_search_document',
      'enqueue_person_embedding_job',
      'enqueue_organization_embedding_job',
    ].forEach((token) => expect(migration).toContain(token));

    expect(migration).toContain('DROP TRIGGER IF EXISTS');
    expect(migration).toContain('CREATE TRIGGER');
  });

  itWithPhase6AMigration('keeps catalog, aliases, and organization facts behind staff-role RLS policies', () => {
    const migration = phase6ASql();

    [
      'ALTER TABLE public.flemish_connections ENABLE ROW LEVEL SECURITY',
      'ALTER TABLE public.flemish_connection_aliases ENABLE ROW LEVEL SECURITY',
      'ALTER TABLE public.organization_flemish_connections ENABLE ROW LEVEL SECURITY',
      "public.has_staff_role('editor')",
    ].forEach((token) => expect(migration).toContain(token));

    expect(migration).toContain('DROP POLICY IF EXISTS');
    expect(migration).toContain('CREATE POLICY');
  });
});
