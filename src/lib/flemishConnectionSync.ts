import { supabase } from './supabase';

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
