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

const scheduler = readFileSync(
  resolve(process.cwd(), 'supabase/functions/agent-scheduler/index.ts'),
  'utf8'
);

const discoveryAgent = readFileSync(
  resolve(process.cwd(), 'supabase/functions/agent-discovery/index.ts'),
  'utf8'
);

const discoveryCrawler = readFileSync(
  resolve(process.cwd(), 'supabase/functions/_shared/discovery.ts'),
  'utf8'
);

const discoveredPhotoMigration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260915130000_discovered_contact_profile_photo.sql'),
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
    expect(reviewPanel).toContain('peopleOpen');
    expect(reviewPanel).toContain('orgsOpen');
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
    expect(reviewPanel).toContain('data_source: approvedPersonDataSource(contact.source, origin.staffLaunchedDiscovery)');
    expect(reviewPanel).toContain('created_by_name: origin.name');
    expect(approvedPeopleSourceBackfill).toContain("WHEN 'manual' THEN 'manual'");
    expect(approvedPeopleSourceBackfill).toContain("WHEN 'import' THEN 'csv_import'");
    expect(approvedPeopleSourceBackfill).toContain('discovered.approved_person_id = person.id');
  });

  it('starts queued discovery verification explicitly and only enables approval for ready rows', () => {
    expect(reviewPanel).toContain('handleVerifyQueued');
    expect(reviewPanel).toContain("action: 'verify_discovered'");
    expect(reviewPanel).toContain('Verify all ({verifiableContactCount})');
    expect(reviewPanel).toContain("contact.verification_status === 'requested'");
    expect(reviewPanel).toContain('`Add Verified (${readyContactCount})`');
    expect(reviewPanel).toContain('readyContactCount === 0');
    expect(reviewPanel).toContain(".is('approved_person_id', null)");
    expect(reviewPanel).toContain(".is('approved_organization_id', null)");
  });

  it('does not mistake a US study connection for an abroad current location and surfaces approval errors', () => {
    expect(reviewPanel).toContain('? contact.current_location_city || null');
    expect(reviewPanel).toContain('The contact remains in Verification. No approval status was changed.');
    expect(reviewPanel).toContain("contact.suggested_us_network_status === 'us_connected_abroad'");
  });

  it('keeps bulk approval visibly active until every ready contact is processed', () => {
    expect(reviewPanel).toContain("setActionId('all')");
    expect(reviewPanel).toContain('setBulkApprovalProgress({ completed, total: nonDupes.length, failed })');
    expect(reviewPanel).toContain('Adding ${bulkApprovalProgress.completed}/${bulkApprovalProgress.total}');
    expect(reviewPanel).toContain('Failed contacts remain in Verification so you can retry them.');
  });

  it('crawls reviewable person photos and preserves them on approval', () => {
    expect(discoveryCrawler).toContain('extractProfileImageCandidates');
    expect(discoveryCrawler).toContain('meta[property="og:image"]');
    expect(discoveryAgent).toContain('Image candidates found on this page:');
    expect(discoveryAgent).toContain('profile_photo_url: mergedContact.profile_photo_url || null');
    expect(reviewPanel).toContain('profile_photo_url: contact.profile_photo_url || null');
    expect(discoveredPhotoMigration).toContain('ADD COLUMN IF NOT EXISTS profile_photo_url text');
  });

  it('only drains discovered verification after a user starts it', () => {
    expect(scheduler).toContain('onSuccess?: (response: Response) => Promise<void>');
    expect(scheduler).toContain('if (action === "verify_discovered")');
    expect(scheduler).not.toContain('autoEnqueueDiscoveredVerification');
    expect(scheduler).toContain('user_requested: true');
    // Only rows a staff member moved to 'requested' are drained, by batches
    // and by the tick, and abandoned 'verifying' rows are recovered.
    expect(scheduler).toContain('.eq("verification_status", "requested")');
    expect(scheduler).toContain('.or("verification_status.is.null,verification_status.in.(queued,failed)")');
    expect(scheduler).toContain('await recoverOrphanedVerification(supabase)');
    expect(scheduler).toContain('await drainRequestedVerification(supabase, supabaseUrl, req)');
  });
});
