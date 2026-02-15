const cache = new Map<string, { lat: number; lng: number }>();

export async function geocodeBatch(
  pairs: { city: string; state: string }[]
): Promise<Map<string, { lat: number; lng: number }>> {
  const uncached = pairs.filter((p) => !cache.has(`${p.city},${p.state}`));

  if (uncached.length > 0) {
    try {
      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/geocode`;
      const resp = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ pairs: uncached }),
      });

      if (resp.ok) {
        const data = await resp.json();
        for (const r of data.results) {
          cache.set(`${r.city},${r.state}`, { lat: r.lat, lng: r.lng });
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
