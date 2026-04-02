import { supabase } from './supabase';

export function kickEmbeddingWorker(batchSize = 5): void {
  supabase.functions
    .invoke('generate-embeddings', {
      body: { kick: true, batch_size: batchSize },
    })
    .catch(() => {
      // Queue state lives in Postgres; this nudge is best-effort only.
    });
}
