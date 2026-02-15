import { supabase } from './supabase';

interface LocationCoords {
  lat: number;
  lng: number;
}

let cache: Map<string, LocationCoords> | null = null;
let loadPromise: Promise<void> | null = null;

async function fetchLocations() {
  const { data } = await supabase
    .from('locations')
    .select('city, state, latitude, longitude');
  cache = new Map();
  for (const loc of data || []) {
    cache.set(`${loc.city},${loc.state}`, {
      lat: loc.latitude,
      lng: loc.longitude,
    });
  }
}

export async function ensureLocationsLoaded(): Promise<void> {
  if (cache) return;
  if (!loadPromise) {
    loadPromise = fetchLocations();
  }
  await loadPromise;
}

export function lookupCity(
  city: string,
  state: string
): LocationCoords | null {
  if (!cache) return null;
  const key = `${city},${state}`;
  const exact = cache.get(key);
  if (exact) return exact;

  const cityLower = city.toLowerCase();
  for (const [k, v] of cache) {
    const [c] = k.split(',');
    if (c.toLowerCase() === cityLower) return v;
  }

  return null;
}

export function addToCache(
  city: string,
  state: string,
  lat: number,
  lng: number
) {
  if (!cache) cache = new Map();
  cache.set(`${city},${state}`, { lat, lng });
}
