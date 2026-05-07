import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260507006000_phase5a_discovery_organization_contract.sql'),
  'utf8'
);

const edgeDatabaseTypes = readFileSync(
  resolve(process.cwd(), 'supabase/functions/_shared/database.types.ts'),
  'utf8'
);

describe('Phase 5A discovery organization contract', () => {
  it('adds staging and dedupe fields to pending organizations', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS candidate_key text');
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'agent_discovery'");
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS first_seen_at');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS last_seen_at');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS last_evidence_at');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS evidence_count integer NOT NULL DEFAULT 0');
    expect(migration).toContain('discovered_organizations_pending_candidate_key_idx');
    expect(migration).toContain('discovered_organizations_pending_website_idx');
  });

  it('creates a separate evidence table with page, source, raw, normalized, and confidence fields', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.discovered_organization_evidence');
    expect(migration).toContain('discovered_organization_id uuid NOT NULL REFERENCES public.discovered_organizations(id)');
    expect(migration).toContain('discovery_page_id uuid REFERENCES public.discovery_pages(id)');
    expect(migration).toContain('evidence_key text NOT NULL UNIQUE');
    expect(migration).toContain('page_url text NOT NULL');
    expect(migration).toContain('source_type text');
    expect(migration).toContain('evidence_excerpt text');
    expect(migration).toContain('raw_relevance_text text');
    expect(migration).toContain('raw_location_text text');
    expect(migration).toContain('raw_sector_text text');
    expect(migration).toContain('normalized_location_city text');
    expect(migration).toContain('normalized_location_state text');
    expect(migration).toContain('normalized_location_country text');
    expect(migration).toContain('confidence numeric(5,2)');
  });

  it('rolls evidence counts onto pending organizations', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.refresh_discovered_organization_evidence_rollup');
    expect(migration).toContain('tr_refresh_discovered_organization_evidence_rollup_insert');
    expect(migration).toContain('tr_refresh_discovered_organization_evidence_rollup_update');
    expect(migration).toContain('tr_refresh_discovered_organization_evidence_rollup_delete');
  });

  it('replaces broad organization discovery RLS with editor policies', () => {
    expect(migration).toContain('DROP POLICY IF EXISTS "Public read discovered_organizations"');
    expect(migration).toContain('DROP POLICY IF EXISTS "Public insert discovered_organizations"');
    expect(migration).toContain('DROP POLICY IF EXISTS "Public update discovered_organizations"');
    expect(migration).toContain("USING (public.has_staff_role('editor'))");
    expect(migration).toContain("WITH CHECK (public.has_staff_role('editor'))");
    expect(migration).toContain('ON public.discovered_organization_evidence FOR SELECT');
    expect(migration).toContain('ON public.discovered_organization_evidence FOR INSERT');
  });

  it('updates edge database types for the new organization evidence contract', () => {
    expect(edgeDatabaseTypes).toContain('candidate_key: string;');
    expect(edgeDatabaseTypes).toContain('last_evidence_at: string | null;');
    expect(edgeDatabaseTypes).toContain('evidence_count: number;');
    expect(edgeDatabaseTypes).toContain('interface DiscoveredOrganizationEvidenceRow');
    expect(edgeDatabaseTypes).toContain('discovered_organization_evidence: Table<DiscoveredOrganizationEvidenceRow>;');
  });
});
