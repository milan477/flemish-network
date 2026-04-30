import { supabase } from './supabase';

export function kickEmbeddingWorker(batchSize = 5): void {
  // Queue state lives in Postgres; this nudge is best-effort only — but log
  // failures so a permanently-down worker is visible in the browser console
  // instead of being silently dropped (Phase 6.3 audit).
  supabase.functions
    .invoke('generate-embeddings', {
      body: { kick: true, batch_size: batchSize },
    })
    .catch((err) => {
      console.warn('[embeddingRefresh] kick failed (non-fatal)', err);
    });
}
