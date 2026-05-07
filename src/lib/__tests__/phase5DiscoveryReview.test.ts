import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const reviewPanel = readFileSync(
  resolve(process.cwd(), 'src/components/admin/DiscoveredContactsPanel.tsx'),
  'utf8'
);

const manualIntake = readFileSync(
  resolve(process.cwd(), 'src/components/admin/AddContactPanel.tsx'),
  'utf8'
);

const importIntake = readFileSync(
  resolve(process.cwd(), 'src/components/admin/CsvImport.tsx'),
  'utf8'
);

const discoveredContactsPolicyFix = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260507007000_fix_discovered_contacts_editor_insert_policy.sql'),
  'utf8'
);

const approvedPeopleSourceBackfill = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260507009000_backfill_approved_people_manual_import_source.sql'),
  'utf8'
);

describe('Phase 5D discovery review contract', () => {
  it('keeps manual and import organization intake pending-only', () => {
    expect(manualIntake).toContain(".from('discovered_organizations')");
    expect(importIntake).toContain(".from('discovered_organizations')");
    expect(manualIntake).not.toContain(".from('organizations')\n      .insert");
    expect(importIntake).not.toContain(".from('organizations')\n      .insert");
  });

  it('promotes organizations only from explicit reviewer approval', () => {
    expect(reviewPanel).toContain('async function approveOrganization');
    expect(reviewPanel).toContain(".from('organizations')");
    expect(reviewPanel).toContain(".from('organization_sectors')");
    expect(reviewPanel).toContain(".from('organization_us_locations')");
    expect(reviewPanel).toContain(".from('discovered_organizations')");
    expect(reviewPanel).toContain("review_outcome: 'approved_new'");
    expect(reviewPanel).toContain('approved_organization_id');
    expect(reviewPanel).toContain("entityType: 'organization'");
  });

  it('shows separate pending queues with organization sources and evidence', () => {
    expect(reviewPanel).toContain("useState<'people' | 'organizations'>");
    expect(reviewPanel).toContain('discovered_organization_evidence');
    expect(reviewPanel).toContain('organizationSourceLabel');
    expect(reviewPanel).toContain('source_urls');
    expect(reviewPanel).toContain('evidence_excerpt');
  });

  it('allows editor staff to insert pending people into discovery review', () => {
    expect(discoveredContactsPolicyFix).toContain('CREATE POLICY "Editors can insert discovered_contacts"');
    expect(discoveredContactsPolicyFix).toContain('ON public.discovered_contacts FOR INSERT');
    expect(discoveredContactsPolicyFix).toContain("WITH CHECK (public.has_staff_role('editor'))");
  });

  it('preserves manual and import provenance when approving pending people', () => {
    expect(reviewPanel).toContain('function approvedPersonDataSource');
    expect(reviewPanel).toContain("if (source === 'manual') return 'manual'");
    expect(reviewPanel).toContain("if (source === 'import') return 'csv_import'");
    expect(reviewPanel).toContain('data_source: approvedPersonDataSource(contact.source)');
    expect(approvedPeopleSourceBackfill).toContain("WHEN 'manual' THEN 'manual'");
    expect(approvedPeopleSourceBackfill).toContain("WHEN 'import' THEN 'csv_import'");
    expect(approvedPeopleSourceBackfill).toContain('discovered.approved_person_id = person.id');
  });
});
