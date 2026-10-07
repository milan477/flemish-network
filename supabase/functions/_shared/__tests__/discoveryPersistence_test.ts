import { assert, assertEquals } from "jsr:@std/assert@^1.0.0";
import type { FlemishFactCandidate } from "../discoveryOrganizations.ts";
import {
  composeFlemishConnectionText,
  CONTACT_FLEMISH_CONNECTION_LIMITS,
  discoveryWriteError,
  isRecordDataError,
  ORGANIZATION_RELEVANCE_LIMITS,
  pageSaveNeedsRetry,
  preservedDiscoveryProvenance,
  saveRecordsIsolated,
} from "../discoveryPersistence.ts";

const checkViolation = {
  code: "23514",
  message:
    'new row for relation "discovered_contacts" violates check constraint "discovered_contacts_suggested_us_network_status_check"',
};

Deno.test("preservedDiscoveryProvenance: a merge keeps the official Fayat row's identity and first-seen run", () => {
  assertEquals(
    preservedDiscoveryProvenance(
      {
        source: "official_fayat_directory",
        candidate_key: "fayat:jan peeters",
        agent_run_id: "run-official",
      },
      {
        source: "frontier_page",
        candidate_key: "name:jan peeters|vlaanderen.be",
        agent_run_id: "run-scheduled",
      },
    ),
    {
      source: "official_fayat_directory",
      candidate_key: "fayat:jan peeters",
      agent_run_id: "run-official",
    },
  );
});

Deno.test("preservedDiscoveryProvenance: fills provenance the existing row never had", () => {
  assertEquals(
    preservedDiscoveryProvenance(
      { source: null, candidate_key: "", agent_run_id: undefined },
      {
        source: "frontier_page",
        candidate_key: "name:jan peeters|baef.be",
        agent_run_id: "run-2",
      },
    ),
    {
      source: "frontier_page",
      candidate_key: "name:jan peeters|baef.be",
      agent_run_id: "run-2",
    },
  );
});

Deno.test("discoveryWriteError: keeps the message format and the Postgres SQLSTATE", () => {
  const error = discoveryWriteError(
    "Failed to update discovered contact",
    checkViolation,
  );
  assertEquals(
    error.message,
    `Failed to update discovered contact: ${checkViolation.message}`,
  );
  assertEquals(error.code, "23514");
  assertEquals(discoveryWriteError(null, checkViolation).message, checkViolation.message);
});

Deno.test("isRecordDataError: only Postgres data, integrity, and cardinality errors are per-record", () => {
  assert(isRecordDataError(discoveryWriteError(null, checkViolation)));
  assert(isRecordDataError(discoveryWriteError(null, { code: "23505", message: "duplicate key" })));
  assert(isRecordDataError(discoveryWriteError(null, { code: "22001", message: "value too long" })));
  assert(
    isRecordDataError(
      discoveryWriteError(null, {
        code: "21000",
        message: "ON CONFLICT DO UPDATE command cannot affect row a second time",
      }),
    ),
  );
  // Schema drift and transport failures are not the record's fault.
  assertEquals(
    isRecordDataError(discoveryWriteError(null, { code: "PGRST204", message: "column not found" })),
    false,
  );
  assertEquals(isRecordDataError(new Error("fetch failed: network error")), false);
  // A constraint message without a SQLSTATE is not trusted (constraint names contain words like "network").
  assertEquals(isRecordDataError(new Error(checkViolation.message)), false);
});

Deno.test("saveRecordsIsolated: one failing contact does not discard the rest of the page", async () => {
  const attempted: string[] = [];
  const outcome = await saveRecordsIsolated(
    ["Ann", "Bert", "Cas"],
    (name) => {
      attempted.push(name);
      if (name === "Bert") {
        return Promise.reject(discoveryWriteError(null, checkViolation));
      }
      return Promise.resolve(`id-${name}`);
    },
    (name) => name,
  );

  assertEquals(attempted, ["Ann", "Bert", "Cas"]);
  assertEquals(outcome.saved.map((entry) => entry.result), ["id-Ann", "id-Cas"]);
  assertEquals(outcome.failures.length, 1);
  assertEquals(outcome.failures[0].record, "Bert");
  assertEquals(outcome.failures[0].error, checkViolation.message);
  assertEquals(outcome.failures[0].code, "23514");
  assertEquals(outcome.failures[0].dataError, true);
  assertEquals(pageSaveNeedsRetry(outcome.saved.length, outcome.failures), false);
});

Deno.test("pageSaveNeedsRetry: retry the page only when nothing saved and a failure was not a data error", async () => {
  const transient = await saveRecordsIsolated(
    ["Ann"],
    () => Promise.reject(new Error("Gemini 503: temporarily unavailable")),
    (name) => name,
  );
  assertEquals(transient.failures[0].dataError, false);
  assertEquals(transient.failures[0].code, null);
  assertEquals(pageSaveNeedsRetry(0, transient.failures), true);
  // Something saved: the page is processed even though another record hit a transient error.
  assertEquals(pageSaveNeedsRetry(1, transient.failures), false);

  const dataOnly = await saveRecordsIsolated(
    ["Ann", "Bert"],
    () => Promise.reject(discoveryWriteError(null, checkViolation)),
    (name) => name,
  );
  assertEquals(pageSaveNeedsRetry(0, dataOnly.failures), false);
  assertEquals(pageSaveNeedsRetry(0, []), false);
});

function factCandidate(canonicalName: string): FlemishFactCandidate {
  return {
    canonical_name: canonicalName,
    candidate_alias: "",
    role: "alumnus",
    source_url: "https://example.com",
    evidence_excerpt: "",
    confidence: 0.9,
    raw_evidence: "",
  };
}

// Shape of the prod "Nikolai Kley" row: the extraction model put a whole press release in flemish_connection.
const pressRelease =
  "Orionis Biosciences is a life sciences company pioneering the creation of highly selective and tunable therapeutics for cancer and other diseases, today announced that the first patient has been dosed. " +
  "The company was founded by scientists with decades of experience in drug discovery. ".repeat(24);

Deno.test("composeFlemishConnectionText: a passage is dropped and the canonical entity kept", () => {
  assert(pressRelease.length > 2000);
  assertEquals(
    composeFlemishConnectionText(
      pressRelease,
      [factCandidate("UGent")],
      CONTACT_FLEMISH_CONNECTION_LIMITS,
    ),
    "UGent",
  );
});

Deno.test("composeFlemishConnectionText: an entity named only inside a dropped passage is still appended", () => {
  assertEquals(
    composeFlemishConnectionText(
      `${pressRelease} He earned his PhD at UGent.`,
      [factCandidate("UGent")],
      CONTACT_FLEMISH_CONNECTION_LIMITS,
    ),
    "UGent",
  );
});

Deno.test("composeFlemishConnectionText: short phrases are trimmed, deduplicated, and kept in order", () => {
  const sentence =
    "Associated with the Belgian American Educational Foundation (BAEF) facilitating educational exchange between Belgium and the USA.";
  assertEquals(
    composeFlemishConnectionText(sentence, [factCandidate("BAEF")], CONTACT_FLEMISH_CONNECTION_LIMITS),
    sentence,
  );
  assertEquals(
    composeFlemishConnectionText(
      "  KU   Leuven ;KU Leuven;;  BAEF fellow ",
      [factCandidate("Fayat Scholarship")],
      CONTACT_FLEMISH_CONNECTION_LIMITS,
    ),
    "KU Leuven; BAEF fellow; Fayat Scholarship",
  );
  assertEquals(
    composeFlemishConnectionText("", [], CONTACT_FLEMISH_CONNECTION_LIMITS),
    "",
  );
});

Deno.test("composeFlemishConnectionText: the total is capped without starving later short entities", () => {
  const phrase = (index: number) => `Long but legitimate connection phrase number ${index} ${"x".repeat(100)}`;
  const result = composeFlemishConnectionText(
    [phrase(1), phrase(2), phrase(3), phrase(4)].join("; "),
    [factCandidate("KU Leuven")],
    CONTACT_FLEMISH_CONNECTION_LIMITS,
  );
  assert(result.length <= CONTACT_FLEMISH_CONNECTION_LIMITS.maxTotalLength);
  assert(result.startsWith(phrase(1)));
  assert(result.endsWith("; KU Leuven"));
});

Deno.test("composeFlemishConnectionText: organization relevance keeps a rationale but not a page dump", () => {
  const rationale =
    "The University of Antwerp is a Flemish university, and the Department of Political Science offers a Master's program in Political Science that is taught in English and focuses on understanding the theory and practice of political decision making. The department also emphasizes its local anchoring and international orientation, with a focus on regional (Flanders) and national (Belgium) politics.";
  assertEquals(
    composeFlemishConnectionText(rationale, [factCandidate("UAntwerp")], ORGANIZATION_RELEVANCE_LIMITS),
    `${rationale}; UAntwerp`,
  );
  assertEquals(
    composeFlemishConnectionText(`${pressRelease}${pressRelease}`, [factCandidate("UAntwerp")], ORGANIZATION_RELEVANCE_LIMITS),
    "UAntwerp",
  );
});
