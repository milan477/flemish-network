import { assertEquals } from "jsr:@std/assert@^1.0.0";
import {
  buildContactQuery,
  buildContactQueries,
  normalizePayload,
  validatePayloadLocation,
} from "../discoveredVerification.ts";
import type { SupabaseAdminClient } from "../database.types.ts";

Deno.test("official Fayat candidates request current professional facts", () => {
  const query = buildContactQuery({
    name: "Example Laureate",
    source: "official_fayat_directory",
    flemish_connection: "Fayatbeurzen laureate",
  });

  assertEquals(query.includes('"Example Laureate"'), true);
  assertEquals(query.includes("current residence"), true);
  assertEquals(query.includes("current employer"), true);
  assertEquals(query.includes("current role"), true);
  assertEquals(query.includes("professional sector"), true);
  assertEquals(query.includes("profile photo"), true);
});

Deno.test("contact verification searches LinkedIn and other professional websites", () => {
  const queries = buildContactQueries({
    name: "Example Laureate",
    flemish_connection: "Fayat Scholarship",
  });

  assertEquals(queries.length, 3);
  assertEquals(queries.some((query) => query.includes("site:linkedin.com/in")), true);
  assertEquals(queries.some((query) => query.includes("official website OR portfolio")), true);
});

Deno.test("verification payload keeps only canonical sectors and safe photo URLs", () => {
  const payload = normalizePayload({
    network_scope: "us_based",
    profile_photo_url: "https://example.com/people/example.jpg",
    profile_links: [
      {
        type: "linkedin",
        url: "https://www.linkedin.com/in/example-laureate",
        label: "LinkedIn",
        evidence_url: "https://www.linkedin.com/in/example-laureate",
        evidence_excerpt: "Professional profile for Example Laureate.",
      },
      {
        type: "website",
        url: "https://example.com/about",
        label: "Personal website",
        evidence_url: "https://example.com/about",
        evidence_excerpt: "Official biography.",
      },
    ],
    professional_sectors: ["Research", "Student", "Education"],
    belgian_identity_confirmed: true,
    flemish_ties: [],
    evidence: [],
    confidence: 0.8,
    contradiction: false,
  });

  assertEquals(payload.profile_photo_url, "https://example.com/people/example.jpg");
  assertEquals(payload.profile_links.length, 2);
  assertEquals(payload.professional_sectors, ["Research", "Education"]);
  assertEquals(payload.belgian_identity_confirmed, true);

  const placeholder = normalizePayload({
    profile_photo_url: "https://example.com/default-avatar.png",
  });
  assertEquals(placeholder.profile_photo_url, null);
});

Deno.test("discovered verification rejects an unrecognized US city/state pair", async () => {
  const chain = {
    select() { return this; },
    ilike() { return this; },
    eq() { return this; },
    limit() { return this; },
    async maybeSingle() { return { data: null, error: null }; },
  };
  const supabase = { from: () => chain } as unknown as SupabaseAdminClient;
  const payload = normalizePayload({
    network_scope: "us_based",
    location_city: "Brussels",
    location_state: "CA",
    confidence: 0.94,
  });

  const validated = await validatePayloadLocation(supabase, payload);
  assertEquals(validated.location_city, null);
  assertEquals(validated.location_state, null);
  assertEquals(validated.location_country, null);
});

Deno.test("discovered verification requires high confidence for current US location", async () => {
  const supabase = ({
    from: () => {
      throw new Error("location lookup should not run");
    },
  }) as unknown as SupabaseAdminClient;
  const payload = normalizePayload({
    network_scope: "us_based",
    location_city: "Los Angeles",
    location_state: "CA",
    confidence: 0.7,
  });

  const validated = await validatePayloadLocation(supabase, payload);
  assertEquals(validated.location_city, null);
  assertEquals(validated.location_state, null);
});
