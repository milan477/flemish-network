import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const personProfileSource = readFileSync(
  resolve(process.cwd(), 'src/pages/PersonProfile.tsx'),
  'utf8'
);

const organizationProfileSource = readFileSync(
  resolve(process.cwd(), 'src/pages/OrganizationProfile.tsx'),
  'utf8'
);

// Phase 2A (UX_REMEDIATION_2026-05-08): per-connection chip + evidence row
// rendering was extracted into a shared <FlemishConnectionList> component used
// by both profile pages. Evidence-rendering assertions point at that file now.
const flemishConnectionListSource = readFileSync(
  resolve(process.cwd(), 'src/components/FlemishConnectionList.tsx'),
  'utf8'
);

const discoveryReviewSource = readFileSync(
  resolve(process.cwd(), 'src/components/admin/DiscoveredContactsPanel.tsx'),
  'utf8'
);

const collectionPreviewSource = readFileSync(
  resolve(process.cwd(), 'src/components/CollectionSuggestionPreviewModal.tsx'),
  'utf8'
);

describe('Phase 6C Flemish fact profile and approval contract', () => {
  it('loads profile fact relationship evidence for person and organization profiles', () => {
    expect(personProfileSource).toContain('person_flemish_connections(flemish_connection_id, role, confidence, source_url, evidence_excerpt');
    expect(organizationProfileSource).toContain('organization_flemish_connections(flemish_connection_id, role, confidence, source_url, evidence_excerpt');
    expect(flemishConnectionListSource).toContain('link.evidence_excerpt');
  });

  it('saves profile edits through canonical fact junctions instead of organization raw relevance', () => {
    expect(personProfileSource).toContain(".from('person_flemish_connections')");
    expect(organizationProfileSource).toContain(".from('organization_flemish_connections')");
    expect(organizationProfileSource).not.toContain('flemish_' + 'link');
  });

  it('writes Discovery approval organization relevance to normalized organization facts', () => {
    expect(discoveryReviewSource).toContain('upsert_organization_flemish_connections_from_text');
    expect(discoveryReviewSource).toContain(".from('organization_flemish_connections')");
    expect(discoveryReviewSource).not.toContain('updates.flemish_' + 'link');
  });

  it('keeps collection previews on canonical organization facts', () => {
    expect(collectionPreviewSource).toContain('getOrganizationFlemishConnectionText');
    expect(collectionPreviewSource).toContain('organization_flemish_connections');
    expect(collectionPreviewSource).not.toContain('organization?.flemish_' + 'link');
  });
});
