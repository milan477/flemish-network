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
    const approved = collectionSuggestionDraftReducer(loaded, {
      type: 'approve',
      entity_type: 'organization',
      id: 'org-1',
    });

    expect(getAcceptedDraftCandidates(approved)).toEqual([organizationCandidate]);
    expect(getCollectionSuggestionExclusionPayload(approved)).toEqual({
      exclude_ids: [],
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
});
