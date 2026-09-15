import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { trustedOfficialFayatPayload } from "../discoveredVerification.ts";
import { OFFICIAL_FAYAT_LAUREATES_URL } from "../fayatDirectory.ts";

Deno.test("trusted official Fayat candidates verify without an LLM or web search", () => {
  const payload = trustedOfficialFayatPayload({
    name: "Example Laureate",
    source: "official_fayat_directory",
    source_urls: [OFFICIAL_FAYAT_LAUREATES_URL],
    occupation: "Fayat Scholarship laureate",
    bio: "Fayat Scholarship laureate; studied at a U.S. institution.",
    flemish_connection: "Fayatbeurzen (Fayat Scholarships)",
  });

  assertEquals(payload?.network_scope, "us_connected_abroad");
  assertEquals(payload?.confidence, 1);
  assertEquals(payload?.contradiction, false);
  assertEquals(payload?.evidence[0]?.url, OFFICIAL_FAYAT_LAUREATES_URL);
});

Deno.test("untrusted discovery sources still require normal verification", () => {
  assertEquals(
    trustedOfficialFayatPayload({
      name: "Example Person",
      source: "web_search",
      source_urls: [OFFICIAL_FAYAT_LAUREATES_URL],
    }),
    null,
  );
});
