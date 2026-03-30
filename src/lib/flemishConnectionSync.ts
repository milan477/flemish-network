import { supabase } from './supabase';

export async function requeuePersonEmbedding(personId: string): Promise<void> {
  const { error } = await supabase.functions.invoke('generate-embeddings', {
    body: { personId },
  });

  if (error) {
    throw error;
  }
}

export async function syncPersonFlemishConnections(
  personId: string,
  rawText?: string | null
): Promise<void> {
  const { error } = await supabase.rpc('refresh_person_flemish_connections', {
    p_person_id: personId,
    p_raw_text: rawText?.trim() || null,
  });

  if (error) {
    throw error;
  }
}

export async function syncPersonFlemishConnectionsAndRequeue(
  personId: string,
  rawText?: string | null
): Promise<void> {
  await syncPersonFlemishConnections(personId, rawText);
  await requeuePersonEmbedding(personId);
}
