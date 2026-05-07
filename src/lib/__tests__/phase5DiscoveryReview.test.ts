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
});
