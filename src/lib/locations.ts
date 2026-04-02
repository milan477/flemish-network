import { supabase, US_STATES } from './supabase';

interface LocationCoords {
  lat: number;
  lng: number;
}

let cache: Map<string, LocationCoords> | null = null;
let loadPromise: Promise<void> | null = null;
const locationIdCache = new Map<string, string>();
const STATE_NAME_TO_CODE = new Map<string, string>();

for (const state of US_STATES) {
  STATE_NAME_TO_CODE.set(state.name.toLowerCase(), state.code);
  STATE_NAME_TO_CODE.set(state.code.toLowerCase(), state.code);
}

async function fetchLocations() {
  const { data } = await supabase
    .from('locations')
    .select('city, state, latitude, longitude');
  cache = new Map();
  for (const loc of data || []) {
    if (loc.latitude == null || loc.longitude == null) continue;
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

export function normalizeStateCode(raw?: string | null): string {
  const trimmed = raw?.trim() || '';
  if (!trimmed) return '';
  return STATE_NAME_TO_CODE.get(trimmed.toLowerCase()) || trimmed;
}

export async function resolveLocationId(
  city?: string | null,
  state?: string | null,
  options: { createIfMissing?: boolean } = {}
): Promise<string | null> {
  const normalizedCity = city?.trim() || '';
  const normalizedState = normalizeStateCode(state);

  if (!normalizedCity || !normalizedState) {
    return null;
  }

  const cacheKey = `${normalizedCity.toLowerCase()}|${normalizedState.toLowerCase()}`;
  const cached = locationIdCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const { data: existing } = await supabase
    .from('locations')
    .select('id')
    .ilike('city', normalizedCity)
    .eq('state', normalizedState)
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    locationIdCache.set(cacheKey, existing.id);
    return existing.id;
  }

  if (!options.createIfMissing) {
    return null;
  }

  const { data: geocodeData, error: geocodeError } = await supabase.functions.invoke('geocode', {
    body: {
      candidates: [{ city: normalizedCity, state: normalizedState }],
    },
  });

  if (!geocodeError) {
    const geocoded = Array.isArray(geocodeData?.results)
      ? geocodeData.results[0]
      : null;

    if (geocoded?.location_id) {
      locationIdCache.set(cacheKey, geocoded.location_id);
      if (typeof geocoded.lat === 'number' && typeof geocoded.lng === 'number') {
        addToCache(normalizedCity, normalizedState, geocoded.lat, geocoded.lng);
      }
      return geocoded.location_id;
    }
  }

  const { data: created } = await supabase
    .from('locations')
    .insert({
      city: normalizedCity,
      state: normalizedState,
      latitude: null,
      longitude: null,
    })
    .select('id')
    .maybeSingle();

  if (created?.id) {
    locationIdCache.set(cacheKey, created.id);
    return created.id;
  }

  const { data: refetched } = await supabase
    .from('locations')
    .select('id')
    .ilike('city', normalizedCity)
    .eq('state', normalizedState)
    .limit(1)
    .maybeSingle();

  if (refetched?.id) {
    locationIdCache.set(cacheKey, refetched.id);
    return refetched.id;
  }

  return null;
}

export function lookupCity(
  city: string,
  state: string
): LocationCoords | null {
  if (!cache) return null;
  const key = `${city},${state}`;
  const exact = cache.get(key);
  if (exact) return exact;

  // No fuzzy fallback by city name alone - it's too dangerous (e.g. Portland OR vs Portland ME)
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
