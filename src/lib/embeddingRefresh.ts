import { supabase } from './supabase';

type EmbeddingRefreshEntityType = 'person' | 'organization' | 'all';

interface EmbeddingRefreshOptions {
  batchSize?: number;
  entityType?: EmbeddingRefreshEntityType;
  personIds?: string[];
  organizationIds?: string[];
}

export function kickEmbeddingWorker(
  batchSizeOrOptions: number | EmbeddingRefreshOptions = 5
): void {
  const options = typeof batchSizeOrOptions === 'number'
    ? { batchSize: batchSizeOrOptions }
    : batchSizeOrOptions;
  const batchSize = options.batchSize || 5;
  const entityType = options.entityType || (
    options.organizationIds?.length && options.personIds?.length
      ? 'all'
      : options.organizationIds?.length
        ? 'organization'
        : 'person'
  );

  // Queue state lives in Postgres; this nudge is best-effort only — but log
  // failures so a permanently-down worker is visible in the browser console
  // instead of being silently dropped (Phase 6.3 audit).
  supabase.functions
    .invoke('generate-embeddings', {
      body: {
        kick: true,
        batch_size: batchSize,
        entity_type: entityType,
        person_ids: options.personIds,
        organization_ids: options.organizationIds,
      },
    })
    .catch((err) => {
      console.warn('[embeddingRefresh] kick failed (non-fatal)', err);
    });
}
