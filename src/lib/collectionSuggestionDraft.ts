export type CollectionSuggestionEntityType = 'person' | 'organization';
export type CollectionSuggestionDraftStatus = 'pending' | 'accepted' | 'rejected';

export interface CollectionSuggestionCandidate {
  entity_type: CollectionSuggestionEntityType;
  id: string;
  name: string;
  reason: string;
  score: number;
  snippet?: string;
  source_search: string;
}

export interface CollectionSuggestionDraftItem {
  candidate: CollectionSuggestionCandidate;
  status: CollectionSuggestionDraftStatus;
}

export interface CollectionSuggestionExclusionPayload {
  exclude_ids: string[];
  exclude_organization_ids: string[];
}

interface DraftHistoryEntry {
  key: string;
  previousStatus: CollectionSuggestionDraftStatus;
}

export interface CollectionSuggestionDraftState {
  items: CollectionSuggestionDraftItem[];
  rejectedPeopleIds: string[];
  rejectedOrganizationIds: string[];
  history: DraftHistoryEntry[];
}

export type CollectionSuggestionDraftAction =
  | { type: 'load'; candidates: CollectionSuggestionCandidate[] }
  | { type: 'approve'; entity_type: CollectionSuggestionEntityType; id: string }
  | { type: 'reject'; entity_type: CollectionSuggestionEntityType; id: string }
  | { type: 'undo'; entity_type?: CollectionSuggestionEntityType; id?: string }
  | { type: 'reset' };

export const EMPTY_COLLECTION_SUGGESTION_DRAFT: CollectionSuggestionDraftState = {
  items: [],
  rejectedPeopleIds: [],
  rejectedOrganizationIds: [],
  history: [],
};

export function collectionSuggestionCandidateKey(
  entityType: CollectionSuggestionEntityType,
  id: string
): string {
  return `${entityType}:${id}`;
}

function keyForCandidate(candidate: CollectionSuggestionCandidate): string {
  return collectionSuggestionCandidateKey(candidate.entity_type, candidate.id);
}

function includesId(values: string[], id: string): boolean {
  return values.includes(id);
}

function addUniqueId(values: string[], id: string): string[] {
  return includesId(values, id) ? values : [...values, id];
}

function removeId(values: string[], id: string): string[] {
  return values.filter((value) => value !== id);
}

function isRejectedSuppressed(
  state: CollectionSuggestionDraftState,
  candidate: CollectionSuggestionCandidate
): boolean {
  return candidate.entity_type === 'person'
    ? includesId(state.rejectedPeopleIds, candidate.id)
    : includesId(state.rejectedOrganizationIds, candidate.id);
}

function setSuppressedRejected(
  state: CollectionSuggestionDraftState,
  entityType: CollectionSuggestionEntityType,
  id: string,
  suppressed: boolean
): Pick<CollectionSuggestionDraftState, 'rejectedPeopleIds' | 'rejectedOrganizationIds'> {
  if (entityType === 'person') {
    return {
      rejectedPeopleIds: suppressed
        ? addUniqueId(state.rejectedPeopleIds, id)
        : removeId(state.rejectedPeopleIds, id),
      rejectedOrganizationIds: state.rejectedOrganizationIds,
    };
  }

  return {
    rejectedPeopleIds: state.rejectedPeopleIds,
    rejectedOrganizationIds: suppressed
      ? addUniqueId(state.rejectedOrganizationIds, id)
      : removeId(state.rejectedOrganizationIds, id),
  };
}

function updateStatus(
  state: CollectionSuggestionDraftState,
  entityType: CollectionSuggestionEntityType,
  id: string,
  status: CollectionSuggestionDraftStatus,
  trackHistory = true
): CollectionSuggestionDraftState {
  const key = collectionSuggestionCandidateKey(entityType, id);
  const item = state.items.find((entry) => keyForCandidate(entry.candidate) === key);
  if (!item || item.status === status) return state;

  const suppression = setSuppressedRejected(
    state,
    entityType,
    id,
    status === 'rejected'
  );

  return {
    ...state,
    ...suppression,
    items: state.items.map((entry) =>
      keyForCandidate(entry.candidate) === key ? { ...entry, status } : entry
    ),
    history: trackHistory
      ? [...state.history, { key, previousStatus: item.status }]
      : state.history,
  };
}

export function collectionSuggestionDraftReducer(
  state: CollectionSuggestionDraftState,
  action: CollectionSuggestionDraftAction
): CollectionSuggestionDraftState {
  switch (action.type) {
    case 'load': {
      const existingKeys = new Set(state.items.map((item) => keyForCandidate(item.candidate)));
      const nextItems = [...state.items];

      for (const candidate of action.candidates) {
        const key = keyForCandidate(candidate);
        if (existingKeys.has(key) || isRejectedSuppressed(state, candidate)) {
          continue;
        }
        existingKeys.add(key);
        nextItems.push({ candidate, status: 'pending' });
      }

      return { ...state, items: nextItems };
    }

    case 'approve': {
      const key = collectionSuggestionCandidateKey(action.entity_type, action.id);
      const item = state.items.find((entry) => keyForCandidate(entry.candidate) === key);
      if (item?.status === 'rejected') return state;
      return updateStatus(state, action.entity_type, action.id, 'accepted');
    }

    case 'reject':
      return updateStatus(state, action.entity_type, action.id, 'rejected');

    case 'undo': {
      const key = action.entity_type && action.id
        ? collectionSuggestionCandidateKey(action.entity_type, action.id)
        : state.history[state.history.length - 1]?.key;
      if (!key) return state;

      const item = state.items.find((entry) => keyForCandidate(entry.candidate) === key);
      if (!item) return state;

      const historyIndex = [...state.history]
        .reverse()
        .findIndex((entry) => entry.key === key);
      const historyEntry = historyIndex >= 0
        ? state.history[state.history.length - 1 - historyIndex]
        : null;
      const nextStatus = historyEntry?.previousStatus || 'pending';
      const nextState = updateStatus(
        { ...state, history: historyEntry ? state.history.filter((entry) => entry !== historyEntry) : state.history },
        item.candidate.entity_type,
        item.candidate.id,
        nextStatus,
        false
      );

      return {
        ...nextState,
        history: historyEntry
          ? state.history.filter((entry) => entry !== historyEntry)
          : state.history,
      };
    }

    case 'reset':
      return EMPTY_COLLECTION_SUGGESTION_DRAFT;
  }
}

export function getVisibleDraftCandidates(
  state: CollectionSuggestionDraftState
): CollectionSuggestionDraftItem[] {
  return state.items.filter((item) => item.status !== 'rejected');
}

export function getAcceptedDraftCandidates(
  state: CollectionSuggestionDraftState
): CollectionSuggestionCandidate[] {
  return state.items
    .filter((item) => item.status === 'accepted')
    .map((item) => item.candidate);
}

export function getCollectionSuggestionExclusionPayload(
  state: CollectionSuggestionDraftState
): CollectionSuggestionExclusionPayload {
  const accepted = getAcceptedDraftCandidates(state);
  return {
    exclude_ids: Array.from(new Set([
      ...state.rejectedPeopleIds,
      ...accepted
        .filter((candidate) => candidate.entity_type === 'person')
        .map((candidate) => candidate.id),
    ])),
    exclude_organization_ids: Array.from(new Set([
      ...state.rejectedOrganizationIds,
      ...accepted
        .filter((candidate) => candidate.entity_type === 'organization')
        .map((candidate) => candidate.id),
    ])),
  };
}
