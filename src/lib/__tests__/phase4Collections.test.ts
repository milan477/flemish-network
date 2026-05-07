import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  collectionSuggestionDraftReducer,
  EMPTY_COLLECTION_SUGGESTION_DRAFT,
  getAcceptedDraftCandidates,
  getCollectionSuggestionExclusionPayload,
  getVisibleDraftCandidates,
  type CollectionSuggestionCandidate,
} from '../collectionSuggestionDraft';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260507003000_phase4_collection_organizations.sql'),
  'utf8'
);

const suggestPeopleFunction = readFileSync(
  resolve(process.cwd(), 'supabase/functions/suggest-people/index.ts'),
  'utf8'
);

const frontendTypes = readFileSync(resolve(process.cwd(), 'src/lib/supabase.ts'), 'utf8');

const collectionModalSource = readFileSync(
  resolve(process.cwd(), 'src/components/CollectionModal.tsx'),
  'utf8'
);

const collectionDetailSource = readFileSync(
  resolve(process.cwd(), 'src/components/CollectionDetail.tsx'),
  'utf8'
);

const addToCollectionDropdownSource = readFileSync(
  resolve(process.cwd(), 'src/components/AddToCollectionDropdown.tsx'),
  'utf8'
);

const directoryGridSource = readFileSync(
  resolve(process.cwd(), 'src/components/DirectoryGrid.tsx'),
  'utf8'
);

const organizationProfileSource = readFileSync(
  resolve(process.cwd(), 'src/pages/OrganizationProfile.tsx'),
  'utf8'
);

const edgeDatabaseTypes = readFileSync(
  resolve(process.cwd(), 'supabase/functions/_shared/database.types.ts'),
  'utf8'
);

const personCandidate: CollectionSuggestionCandidate = {
  entity_type: 'person',
  id: 'person-1',
  name: 'Ada Person',
  reason: 'Relevant person',
  score: 0.9,
  source_search: 'biotech leaders',
};

const organizationCandidate: CollectionSuggestionCandidate = {
  entity_type: 'organization',
  id: 'org-1',
  name: 'Flanders Lab',
  reason: 'Relevant organization',
  score: 0.8,
  source_search: 'biotech organizations',
};

describe('Phase 4 collection member migration', () => {
  it('supports exactly one person or organization member per row', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE');
    expect(migration).toContain('ALTER COLUMN person_id DROP NOT NULL');
    expect(migration).toContain('collection_members_exactly_one_entity');
    expect(migration).toContain('(person_id IS NOT NULL AND organization_id IS NULL)');
    expect(migration).toContain('(person_id IS NULL AND organization_id IS NOT NULL)');
  });

  it('prevents duplicate people and duplicate organizations independently', () => {
    expect(migration).toContain('collection_members_collection_person_unique_idx');
    expect(migration).toContain('WHERE person_id IS NOT NULL');
    expect(migration).toContain('collection_members_collection_organization_unique_idx');
    expect(migration).toContain('WHERE organization_id IS NOT NULL');
    expect(migration).toContain('idx_collection_members_organization');
  });

  it('allows RLS-checked inserts and updates for either member type only', () => {
    expect(migration).toContain('CREATE POLICY "Allow public insert access on collection_members"');
    expect(migration).toContain('CREATE POLICY "Allow public update access on collection_members"');
    expect(migration).toContain('collection_id IS NOT NULL');
    expect(migration).toContain('(person_id IS NOT NULL AND organization_id IS NULL)');
    expect(migration).toContain('(person_id IS NULL AND organization_id IS NOT NULL)');
  });

  it('updates frontend and edge collection member types for mixed members', () => {
    expect(frontendTypes).toContain('person_id: string | null;');
    expect(frontendTypes).toContain('organization_id: string | null;');
    expect(frontendTypes).toContain('person?: Person;');
    expect(frontendTypes).toContain('organization?: Organization;');
    expect(edgeDatabaseTypes).toContain('interface CollectionMemberRow');
    expect(edgeDatabaseTypes).toContain('person_id: string | null;');
    expect(edgeDatabaseTypes).toContain('organization_id: string | null;');
    expect(edgeDatabaseTypes).toContain('collection_members: Table<CollectionMemberRow>;');
  });
});

describe('suggest-people collection suggestion contract', () => {
  it('keeps the deployed function name while returning mixed candidates and gap handoff shape', () => {
    expect(suggestPeopleFunction).toContain('exclude_organization_ids');
    expect(suggestPeopleFunction).toContain('search_organizations_lexical');
    expect(suggestPeopleFunction).toContain('entity_type: "organization"');
    expect(suggestPeopleFunction).toContain('candidates');
    expect(suggestPeopleFunction).toContain('gap');
    expect(suggestPeopleFunction).toContain('suggestions: candidates');
  });

  it('uses Gemini routing for parsing and reranking without accepting unknown rerank IDs', () => {
    expect(suggestPeopleFunction).toContain('route: "query_parsing"');
    expect(suggestPeopleFunction).toContain('route: "offline_evaluation"');
    expect(suggestPeopleFunction).toContain('applyRerankAndBackfill');
    expect(suggestPeopleFunction).toContain('Never invent IDs');
  });

  it('retrieves collection candidates through shared intent and fused semantic ranking', () => {
    expect(suggestPeopleFunction).toContain('interface SearchIntent');
    expect(suggestPeopleFunction).toContain('semanticQuery: originalQuery');
    expect(suggestPeopleFunction).toContain('search_query: intent.lexicalQuery');
    expect(suggestPeopleFunction).toContain('"match_organizations"');
    expect(suggestPeopleFunction).toContain('"match_organization_text_chunks"');
    expect(suggestPeopleFunction).toContain('organizationVectorById');
    expect(suggestPeopleFunction).toContain('organizationChunkById');
    expect(suggestPeopleFunction).toContain('config.vectorWeight * optionalReciprocalRank');
  });
});

describe('collection suggestion draft reducer', () => {
  it('loads mixed candidates and suppresses duplicates', () => {
    const state = collectionSuggestionDraftReducer(EMPTY_COLLECTION_SUGGESTION_DRAFT, {
      type: 'load',
      candidates: [personCandidate, organizationCandidate, personCandidate],
    });

    expect(state.items).toHaveLength(2);
    expect(state.items.map((item) => item.candidate.entity_type)).toEqual(['person', 'organization']);
  });

  it('approves candidates and exposes accepted items for saves', () => {
    const loaded = collectionSuggestionDraftReducer(EMPTY_COLLECTION_SUGGESTION_DRAFT, {
      type: 'load',
      candidates: [personCandidate, organizationCandidate],
    });
    const approvedPerson = collectionSuggestionDraftReducer(loaded, {
      type: 'approve',
      entity_type: 'person',
      id: 'person-1',
    });
    const approved = collectionSuggestionDraftReducer(approvedPerson, {
      type: 'approve',
      entity_type: 'organization',
      id: 'org-1',
    });

    expect(getAcceptedDraftCandidates(approved)).toEqual([personCandidate, organizationCandidate]);
    expect(getCollectionSuggestionExclusionPayload(approved)).toEqual({
      exclude_ids: ['person-1'],
      exclude_organization_ids: ['org-1'],
    });
  });

  it('rejects candidates, suppresses them until undo or reset, and tracks mixed exclusions', () => {
    const loaded = collectionSuggestionDraftReducer(EMPTY_COLLECTION_SUGGESTION_DRAFT, {
      type: 'load',
      candidates: [personCandidate, organizationCandidate],
    });
    const rejectedPerson = collectionSuggestionDraftReducer(loaded, {
      type: 'reject',
      entity_type: 'person',
      id: 'person-1',
    });
    const rejectedBoth = collectionSuggestionDraftReducer(rejectedPerson, {
      type: 'reject',
      entity_type: 'organization',
      id: 'org-1',
    });

    expect(getVisibleDraftCandidates(rejectedBoth)).toEqual([]);
    expect(getCollectionSuggestionExclusionPayload(rejectedBoth)).toEqual({
      exclude_ids: ['person-1'],
      exclude_organization_ids: ['org-1'],
    });

    const reloaded = collectionSuggestionDraftReducer(rejectedBoth, {
      type: 'load',
      candidates: [personCandidate, organizationCandidate],
    });
    expect(getVisibleDraftCandidates(reloaded)).toEqual([]);

    const undone = collectionSuggestionDraftReducer(reloaded, { type: 'undo' });
    expect(getVisibleDraftCandidates(undone).map((item) => item.candidate.id)).toEqual(['org-1']);

    const reset = collectionSuggestionDraftReducer(undone, { type: 'reset' });
    const loadedAfterReset = collectionSuggestionDraftReducer(reset, {
      type: 'load',
      candidates: [personCandidate, organizationCandidate],
    });
    expect(loadedAfterReset.items).toHaveLength(2);
  });

  it('does not let approve bypass rejected suppression without undo or reset', () => {
    const loaded = collectionSuggestionDraftReducer(EMPTY_COLLECTION_SUGGESTION_DRAFT, {
      type: 'load',
      candidates: [personCandidate],
    });
    const rejected = collectionSuggestionDraftReducer(loaded, {
      type: 'reject',
      entity_type: 'person',
      id: 'person-1',
    });
    const approvedAfterReject = collectionSuggestionDraftReducer(rejected, {
      type: 'approve',
      entity_type: 'person',
      id: 'person-1',
    });

    expect(getVisibleDraftCandidates(approvedAfterReject)).toEqual([]);
    expect(getAcceptedDraftCandidates(approvedAfterReject)).toEqual([]);
    expect(getCollectionSuggestionExclusionPayload(approvedAfterReject)).toEqual({
      exclude_ids: ['person-1'],
      exclude_organization_ids: [],
    });

    const undone = collectionSuggestionDraftReducer(approvedAfterReject, { type: 'undo' });
    const approvedAfterUndo = collectionSuggestionDraftReducer(undone, {
      type: 'approve',
      entity_type: 'person',
      id: 'person-1',
    });

    expect(getAcceptedDraftCandidates(approvedAfterUndo)).toEqual([personCandidate]);
    expect(getCollectionSuggestionExclusionPayload(approvedAfterUndo)).toEqual({
      exclude_ids: ['person-1'],
      exclude_organization_ids: [],
    });
  });

  it('restores cached collection suggestion drafts without changing statuses', () => {
    const loaded = collectionSuggestionDraftReducer(EMPTY_COLLECTION_SUGGESTION_DRAFT, {
      type: 'load',
      candidates: [personCandidate, organizationCandidate],
    });
    const approved = collectionSuggestionDraftReducer(loaded, {
      type: 'approve',
      entity_type: 'person',
      id: 'person-1',
    });

    const restored = collectionSuggestionDraftReducer(EMPTY_COLLECTION_SUGGESTION_DRAFT, {
      type: 'restore',
      state: approved,
    });

    expect(restored).toEqual(approved);
    expect(getAcceptedDraftCandidates(restored)).toEqual([personCandidate]);
  });
});

describe('collection creation suggestion UI contract', () => {
  it('uses draft approval controls and saves only approved mixed candidates', () => {
    expect(collectionModalSource).toContain('collectionSuggestionDraftReducer');
    expect(collectionModalSource).toContain('getAcceptedDraftCandidates');
    expect(collectionModalSource).toContain('getCollectionSuggestionExclusionPayload');
    expect(collectionModalSource).toContain("type: 'approve'");
    expect(collectionModalSource).toContain("type: 'reject'");
    expect(collectionModalSource).toContain("type: 'undo'");
    expect(collectionModalSource).toContain("type: 'reset'");
    expect(collectionModalSource).toContain('person_id: candidate.id');
    expect(collectionModalSource).toContain('organization_id: candidate.id');
  });

  it('keeps collection suggestion and Discovery vocabulary in the creation flow', () => {
    expect(collectionModalSource).toContain('Collection Suggestions');
    expect(collectionModalSource).toContain('Review collection suggestions before they are saved.');
    expect(collectionModalSource).toContain('/admin/discovery?prompt=');
    expect(collectionModalSource).toContain('Open Discovery');
    expect(collectionModalSource).not.toContain('Suggested People');
    expect(collectionModalSource).not.toContain('agent-');
  });
});

describe('collection detail mixed member UI contract', () => {
  it('queries and renders mixed collection members with shared notes behavior', () => {
    expect(collectionDetailSource).toContain("Supabase cannot always infer both nullable member relationships");
    expect(collectionDetailSource).toContain(".from('collection_members')");
    expect(collectionDetailSource).toContain(".from('organizations')");
    expect(collectionDetailSource).toContain('organizationsById');
    expect(collectionDetailSource).toContain('member.organization');
    expect(collectionDetailSource).toContain("onNavigate(isPerson ? 'person' : 'organization'");
    expect(collectionDetailSource).toContain('Add notes about this member in this collection');
    expect(collectionDetailSource).toContain('Remove this member from the collection');
    expect(collectionDetailSource).toContain('Export People Briefing');
  });

  it('uses the shared draft workflow for detail collection suggestions and saves mixed accepted candidates', () => {
    expect(collectionDetailSource).toContain('collectionSuggestionDraftReducer');
    expect(collectionDetailSource).toContain('getAcceptedDraftCandidates');
    expect(collectionDetailSource).toContain('getCollectionSuggestionExclusionPayload');
    expect(collectionDetailSource).toContain('currentMemberIds');
    expect(collectionDetailSource).toContain('exclude_organization_ids');
    expect(collectionDetailSource).toContain("type: 'approve'");
    expect(collectionDetailSource).toContain("type: 'reject'");
    expect(collectionDetailSource).toContain("type: 'reset'");
    expect(collectionDetailSource).toContain('person_id: candidate.id');
    expect(collectionDetailSource).toContain('organization_id: candidate.id');
    expect(collectionDetailSource).toContain('Open Discovery');
    expect(collectionDetailSource).toContain('Find Collection Suggestions');
    expect(collectionDetailSource).toContain('collectionSuggestionCacheKey');
    expect(collectionDetailSource).toContain('readCachedCollectionSuggestions');
    expect(collectionDetailSource).toContain('CollectionSuggestionPreviewModal');
    expect(collectionDetailSource).toContain('setPreviewCandidate(candidate)');
    expect(collectionDetailSource).toContain('Refresh');
    expect(collectionDetailSource).not.toContain('Suggested People');
    expect(collectionDetailSource).not.toContain('Find Similar People');
    expect(collectionDetailSource).not.toContain('agent-');
  });
});

describe('add-to-collection mixed entity control', () => {
  it('supports people and organizations while preventing invalid mixed member inserts', () => {
    expect(addToCollectionDropdownSource).toContain('personIds?: string[]');
    expect(addToCollectionDropdownSource).toContain('organizationIds?: string[]');
    expect(addToCollectionDropdownSource).toContain("entityColumn = entityType === 'person' ? 'person_id' : 'organization_id'");
    expect(addToCollectionDropdownSource).toContain('validEntitySelection = entityIds.length > 0 && hasPeople !== hasOrganizations');
    expect(addToCollectionDropdownSource).toContain("person_id: entityType === 'person' ? entityId : null");
    expect(addToCollectionDropdownSource).toContain("organization_id: entityType === 'organization' ? entityId : null");
    expect(addToCollectionDropdownSource).toContain('.in(entityColumn, entityIds)');
  });

  it('places organization add controls on search result cards and profiles', () => {
    expect(directoryGridSource).toContain('function OrganizationCard');
    expect(directoryGridSource).toContain('organizationIds={[organization.id]}');
    expect(directoryGridSource).toContain('title="Add to collection"');
    expect(organizationProfileSource).toContain('AddToCollectionDropdown');
    expect(organizationProfileSource).toContain('organizationIds={[organization.id]}');
    expect(organizationProfileSource).toContain('Add to Collection');
  });
});
