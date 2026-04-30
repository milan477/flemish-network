import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  createAdminClient,
  requireStaffRole,
} from "../_shared/auth.ts";
import { errorToResponse, jsonError, wrapHandler } from "../_shared/httpError.ts";
import {
  findExistingUsLocation,
  parseLocationCandidate,
  safeString,
} from "../_shared/locationPipeline.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, apikey, x-client-info",
};

interface GeocodePair {
  city?: string;
  state?: string;
  raw_text?: string;
  country?: string;
}

interface GeocodeResult {
  raw_text: string;
  city: string;
  state: string;
  country: string;
  location_id: string | null;
  lat: number | null;
  lng: number | null;
  is_us_candidate: boolean;
  parser_confidence: number;
  geocoded: boolean;
  review_required: boolean;
}

async function geocodeOne(
  city: string,
  state: string
): Promise<{ lat: number; lng: number } | null> {
  try {
    const params = new URLSearchParams({
      q: `${city}, ${state}, United States`,
      format: "json",
      limit: "1",
    });
    const resp = await fetch(
      `https://nominatim.openstreetmap.org/search?${params}`,
      {
        headers: {
          "User-Agent": "FlemishNetworkDirectory/1.0",
        },
      }
    );
    const data = await resp.json();
    if (Array.isArray(data) && data.length > 0) {
      return {
        lat: parseFloat(data[0].lat),
        lng: parseFloat(data[0].lon),
      };
    }
  } catch (error) {
    console.warn("[geocode] Nominatim lookup failed", { city, state, error });
  }
  return null;
}

Deno.serve(wrapHandler(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabase = createAdminClient();
    await requireStaffRole(req, supabase, "viewer");

    const body = await req.json();
    const pairs = Array.isArray(body?.pairs)
      ? body.pairs as GeocodePair[]
      : Array.isArray(body?.candidates)
        ? body.candidates as GeocodePair[]
        : [];

    if (!pairs || !Array.isArray(pairs)) {
      return jsonError(400, "invalid_input", "pairs or candidates array is required");
    }

    const capped = pairs.slice(0, 25);
    const results: GeocodeResult[] = [];

    for (let i = 0; i < capped.length; i++) {
      const input = capped[i];
      const parsed = parseLocationCandidate(
        safeString(input.raw_text),
        safeString(input.city),
        safeString(input.state),
        safeString(input.country)
      );

      if (!parsed.label_value) {
        results.push({
          raw_text: safeString(input.raw_text),
          city: "",
          state: "",
          country: safeString(input.country),
          location_id: null,
          lat: null,
          lng: null,
          is_us_candidate: false,
          parser_confidence: 0,
          geocoded: false,
          review_required: true,
        });
        continue;
      }

      const existing = parsed.is_us_candidate && parsed.city && parsed.state
        ? await findExistingUsLocation(supabase, parsed.city, parsed.state)
        : null;

      if (existing) {
        results.push({
          raw_text: parsed.raw_text,
          city: parsed.city,
          state: parsed.state,
          country: parsed.country,
          location_id: existing.id,
          lat: existing.latitude === null ? null : Number(existing.latitude),
          lng: existing.longitude === null ? null : Number(existing.longitude),
          is_us_candidate: parsed.is_us_candidate,
          parser_confidence: parsed.parser_confidence,
          geocoded: existing.latitude !== null && existing.longitude !== null,
          review_required: parsed.review_required,
        });
        continue;
      }

      if (!parsed.is_us_candidate || !parsed.city || !parsed.state) {
        results.push({
          raw_text: parsed.raw_text,
          city: parsed.city,
          state: parsed.state,
          country: parsed.country,
          location_id: null,
          lat: null,
          lng: null,
          is_us_candidate: parsed.is_us_candidate,
          parser_confidence: parsed.parser_confidence,
          geocoded: false,
          review_required: true,
        });
        continue;
      }

      const coords = await geocodeOne(parsed.city, parsed.state);
      const { data: upserted, error: upsertError } = await supabase
        .from("locations")
        .upsert({
          city: parsed.city,
          state: parsed.state,
          latitude: coords?.lat ?? null,
          longitude: coords?.lng ?? null,
          geocode_source: coords ? "nominatim" : null,
          geocoded_at: coords ? new Date().toISOString() : null,
        }, {
          onConflict: "city,state",
        })
        .select("id")
        .maybeSingle();

      if (upsertError) {
        throw upsertError;
      }

      results.push({
        raw_text: parsed.raw_text,
        city: parsed.city,
        state: parsed.state,
        country: parsed.country,
        location_id: upserted?.id || null,
        lat: coords?.lat ?? null,
        lng: coords?.lng ?? null,
        is_us_candidate: parsed.is_us_candidate,
        parser_confidence: parsed.parser_confidence,
        geocoded: Boolean(coords),
        review_required: parsed.review_required || !coords,
      });

      if (i < capped.length - 1) {
        await new Promise((r) => setTimeout(r, 1100));
      }
    }

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return errorToResponse(err);
  }
}));
