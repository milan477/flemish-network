import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, apikey, x-client-info",
};

interface GeocodePair {
  city: string;
  state: string;
}

interface GeocodeResult {
  city: string;
  state: string;
  lat: number;
  lng: number;
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
  } catch {
    // geocoding failed for this pair
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { pairs }: { pairs: GeocodePair[] } = await req.json();
    if (!pairs || !Array.isArray(pairs)) {
      return new Response(
        JSON.stringify({ error: "pairs array is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const capped = pairs.slice(0, 25);
    const results: GeocodeResult[] = [];

    for (let i = 0; i < capped.length; i++) {
      const { city, state } = capped[i];

      const { data: existing } = await supabase
        .from("locations")
        .select("latitude, longitude")
        .eq("city", city)
        .eq("state", state)
        .maybeSingle();

      if (existing) {
        results.push({ city, state, lat: existing.latitude, lng: existing.longitude });
        continue;
      }

      const coords = await geocodeOne(city, state);
      if (coords) {
        results.push({ city, state, ...coords });

        await supabase
          .from("locations")
          .insert({ city, state, latitude: coords.lat, longitude: coords.lng });
      }

      if (i < capped.length - 1) {
        await new Promise((r) => setTimeout(r, 1100));
      }
    }

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
