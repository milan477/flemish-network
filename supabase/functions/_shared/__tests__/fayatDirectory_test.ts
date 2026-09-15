import { assertEquals, assertStringIncludes } from "jsr:@std/assert@^1.0.0";
import {
  getOfficialFayatUsLaureates,
  isOfficialFayatLaureatesUrl,
  OFFICIAL_FAYAT_LAUREATES_URL,
} from "../fayatDirectory.ts";

Deno.test("official Fayat directory fallback contains all published US laureates", () => {
  const laureates = getOfficialFayatUsLaureates(OFFICIAL_FAYAT_LAUREATES_URL);

  assertEquals(laureates?.length, 31);
  assertEquals(new Set(laureates?.map((row) => row.name)).size, 31);
  assertEquals(
    laureates?.every((row) =>
      Boolean(
        row.name && row.institution && row.program && row.city && row.state,
      )
    ),
    true,
  );
  assertStringIncludes(
    laureates?.find((row) => row.name === "Milan Yanouk M Liessens Dujardin")
      ?.institution || "",
    "Berkeley",
  );
  assertEquals(
    laureates?.some((row) => /fernand\s+lazard/i.test(JSON.stringify(row))),
    false,
  );
});

Deno.test("Fayat fallback is restricted to the exact official Vlaanderen page", () => {
  assertEquals(
    isOfficialFayatLaureatesUrl(`${OFFICIAL_FAYAT_LAUREATES_URL}/?source=test`),
    true,
  );
  assertEquals(
    getOfficialFayatUsLaureates("https://example.com/fayatbeurzen"),
    null,
  );
});
