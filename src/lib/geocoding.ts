import { supabase } from './supabase';

const cache = new Map<string, { lat: number; lng: number }>();

export async function geocodeBatch(
  pairs: { city: string; state: string }[]
): Promise<Map<string, { lat: number; lng: number }>> {
  const uncached = pairs.filter((p) => !cache.has(`${p.city},${p.state}`));

  if (uncached.length > 0) {
    try {
      const { data, error } = await supabase.functions.invoke('geocode', {
        body: { pairs: uncached },
      });

      if (!error && Array.isArray(data?.results)) {
        for (const r of data.results) {
          if (typeof r.city === 'string' && typeof r.state === 'string') {
            cache.set(`${r.city},${r.state}`, { lat: r.lat, lng: r.lng });
          }
        }
      }
    } catch {
      // geocoding unavailable
    }
  }

  const resultMap = new Map<string, { lat: number; lng: number }>();
  for (const pair of pairs) {
    const key = `${pair.city},${pair.state}`;
    const coords = cache.get(key);
    if (coords) resultMap.set(key, coords);
  }

  return resultMap;
}
