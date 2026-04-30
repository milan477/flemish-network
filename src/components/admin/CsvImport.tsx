import { useState, useRef, useEffect } from "react";
import {
  Upload,
  AlertCircle,
  CheckCircle2,
  Loader2,
  X,
  ArrowRight,
  FileSpreadsheet,
  Columns,
  Check,
  AlertTriangle,
  ChevronDown,
  Users,
  Download,
  RefreshCw,
  Tags,
} from "lucide-react";
import { supabase, US_STATES, type Sector } from "../../lib/supabase";
import { kickEmbeddingWorker } from "../../lib/embeddingRefresh";
import { syncPersonFlemishConnections } from "../../lib/flemishConnectionSync";
import {
  parseCSV,
  parseExcel,
  suggestMappings,
  applyMappings,
  validateMappedRows,
  downloadTemplate,
  PROFILE_FIELDS,
  FULL_NAME_FIELD,
  type FieldMapping,
  type CsvParseResult,
  type MappedRow,
} from "../../lib/csvParser";

type Step = "upload" | "map" | "confirm" | "importing" | "done";
type DupeAction = "skip" | "update" | "create";

// Build lookup: full state name → code (e.g. "california" → "CA")
const STATE_NAME_TO_CODE = new Map<string, string>();
for (const s of US_STATES) {
  STATE_NAME_TO_CODE.set(s.name.toLowerCase(), s.code);
  STATE_NAME_TO_CODE.set(s.code.toLowerCase(), s.code);
}

/** Normalize a state value (full name or code) to its 2-letter code. */
function normalizeStateCode(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  return STATE_NAME_TO_CODE.get(trimmed) || raw.trim();
}

interface CsvImportProps {
  onContactAdded: () => void;
}

interface DupeInfo {
  rowIdx: number;
  existingName: string;
  existingId: string;
}

interface ImportSummary {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: { row: number; name: string; reason: string }[];
  warnings: { row: number; name: string; reason: string }[];
  csvSectorLinks: number;
  personIds: string[];
}

interface UpdatedPersonSnapshot {
  personId: string;
  fields: {
    title: string | null;
    current_position: string | null;
    occupation: string | null;
    bio: string | null;
    email: string | null;
    phone: string | null;
    linkedin_url: string | null;
    website_url: string | null;
    location_id: string | null;
  };
  sectorIds: string[];
  flemishConnectionIds: string[];
}

const IMPORT_CANCELLED = "IMPORT_CANCELLED";

function getErrorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

const SECTOR_VALUE_ALIASES = new Map<string, string>([
  ["ai", "artificial intelligence"],
  ["machine learning", "artificial intelligence"],
  ["ml", "artificial intelligence"],
  ["biotech", "biotechnology"],
  ["life sciences", "biotechnology"],
  ["arts and culture", "culture and arts"],
  ["cultural arts", "culture and arts"],
  ["r&d", "research"],
  ["research and development", "research"],
]);

function normalizeSectorName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[.]/g, "")
    .replace(/\s+/g, " ");
}

function splitSectorCell(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(/(?:[;\n|]+|,(?=\s*[A-Za-z]))/g)
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
}

function buildSectorLookup(allSectors: Sector[]): Map<string, Sector> {
  const lookup = new Map<string, Sector>();

  for (const sector of allSectors) {
    lookup.set(normalizeSectorName(sector.name), sector);
  }

  return lookup;
}

function resolveSectorIds(
  rawValue: string,
  sectorLookup: Map<string, Sector>,
): { sectorIds: string[]; unknown: string[] } {
  const sectorIds = new Set<string>();
  const unknown = new Set<string>();

  for (const token of splitSectorCell(rawValue)) {
    const normalized = normalizeSectorName(token);
    const aliased = SECTOR_VALUE_ALIASES.get(normalized) || normalized;
    const sector = sectorLookup.get(aliased);

    if (sector) {
      sectorIds.add(sector.id);
    } else {
      unknown.add(token);
    }
  }

  return {
    sectorIds: Array.from(sectorIds),
    unknown: Array.from(unknown),
  };
}

function confidenceLabel(score: number): {
  text: string;
  color: string;
} {
  if (score >= 0.85)
    return { text: "Exact", color: "text-green-600 bg-green-50" };
  if (score >= 0.6)
    return { text: "Good", color: "text-yellow-700 bg-yellow-50" };
  if (score >= 0.4)
    return { text: "Possible", color: "text-amber-600 bg-amber-50" };
  return { text: "", color: "" };
}

async function checkDuplicates(rows: MappedRow[]): Promise<DupeInfo[]> {
  const { data: allPeople } = await supabase
    .from("people")
    .select(
      "id, first_name, last_name, name, email, location_id, locations(*)",
    );

  if (!allPeople || allPeople.length === 0) return [];

  const dupes: DupeInfo[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowFirst = (row.first_name || "").trim().toLowerCase();
    const rowLast = (row.last_name || "").trim().toLowerCase();
    const rowEmail = (row.email || "").trim().toLowerCase();

    for (const person of allPeople) {
      const pFirst = (person.first_name || "").trim().toLowerCase();
      const pLast = (person.last_name || "").trim().toLowerCase();
      const pEmail = (person.email || "").trim().toLowerCase();
      const pName = (person.name || "").trim().toLowerCase();
      const rowFull = `${rowFirst} ${rowLast}`.trim();

      if (rowEmail && pEmail && rowEmail === pEmail) {
        dupes.push({
          rowIdx: i,
          existingName:
            person.name || `${person.first_name} ${person.last_name}`,
          existingId: person.id,
        });
        break;
      }

      if (rowFirst && rowLast && pFirst === rowFirst && pLast === rowLast) {
        dupes.push({
          rowIdx: i,
          existingName:
            person.name || `${person.first_name} ${person.last_name}`,
          existingId: person.id,
        });
        break;
      }

      if (rowFull && pName === rowFull) {
        dupes.push({
          rowIdx: i,
          existingName: person.name,
          existingId: person.id,
        });
        break;
      }
    }
  }

  return dupes;
}

const ALL_DISPLAY_FIELDS = [...PROFILE_FIELDS, FULL_NAME_FIELD];

export default function CsvImport({ onContactAdded }: CsvImportProps) {
  const [step, setStep] = useState<Step>("upload");
  const [parsed, setParsed] = useState<CsvParseResult | null>(null);
  const [mappings, setMappings] = useState<FieldMapping[]>([]);
  const [validRows, setValidRows] = useState<MappedRow[]>([]);
  const [invalidRows, setInvalidRows] = useState<
    { row: MappedRow; reason: string }[]
  >([]);
  const [dupes, setDupes] = useState<DupeInfo[]>([]);
  const [dupeAction, setDupeAction] = useState<DupeAction>("skip");
  const [checkingDupes, setCheckingDupes] = useState(false);
  const [error, setError] = useState("");
  const [fileName, setFileName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // Import progress state
  const [importProgress, setImportProgress] = useState({
    current: 0,
    total: 0,
  });
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(
    null,
  );
  const [cancelRequested, setCancelRequested] = useState(false);
  const [rollbackInProgress, setRollbackInProgress] = useState(false);

  // Sector assignment state
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [selectedSectorIds, setSelectedSectorIds] = useState<string[]>([]);
  const [assigningSectors, setAssigningSectors] = useState(false);
  const [sectorsAssigned, setSectorsAssigned] = useState(false);
  const cancelRequestedRef = useRef(false);

  useEffect(() => {
    supabase
      .from("sectors")
      .select("*")
      .then(({ data }) => {
        setSectors((data || []) as Sector[]);
      });
  }, []);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setError("");
    setImportSummary(null);

    const isExcel = /\.xlsx?$/i.test(file.name);

    if (isExcel) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const buffer = ev.target?.result as ArrayBuffer;
        if (!buffer) {
          setError("Could not read file");
          return;
        }
        const result = parseExcel(buffer);
        if (result.headers.length === 0) {
          setError("No headers found in the file");
          return;
        }
        if (result.rows.length === 0) {
          setError("File has headers but no data rows");
          return;
        }
        setParsed(result);
        const suggested = suggestMappings(result.headers);
        setMappings(suggested);
        setStep("map");
      };
      reader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const text = ev.target?.result as string;
        if (!text) {
          setError("Could not read file");
          return;
        }
        const result = parseCSV(text);
        if (result.headers.length === 0) {
          setError("No headers found in the file");
          return;
        }
        if (result.rows.length === 0) {
          setError("File has headers but no data rows");
          return;
        }
        setParsed(result);
        const suggested = suggestMappings(result.headers);
        setMappings(suggested);
        setStep("map");
      };
      reader.readAsText(file);
    }
  };

  const updateMapping = (fieldKey: string, csvColumn: string) => {
    setMappings((prev) =>
      prev.map((m) =>
        m.fieldKey === fieldKey
          ? { ...m, csvColumn, confidence: csvColumn ? 1 : 0 }
          : m,
      ),
    );
  };

  const handleConfirm = async () => {
    if (!parsed) return;
    const mapped = applyMappings(parsed.rows, parsed.headers, mappings);
    const { valid, invalid } = validateMappedRows(mapped);
    setValidRows(valid);
    setInvalidRows(invalid);

    setCheckingDupes(true);
    const found = await checkDuplicates(valid);
    setDupes(found);
    setCheckingDupes(false);

    setStep("confirm");
  };

  const handleImport = async () => {
    setStep("importing");
    setCancelRequested(false);
    setRollbackInProgress(false);
    cancelRequestedRef.current = false;
    const summary: ImportSummary = {
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      errors: [],
      warnings: [],
      csvSectorLinks: 0,
      personIds: [],
    };
    const dupeIdxSet = new Set(dupes.map((d) => d.rowIdx));
    const dupeMap = new Map(dupes.map((d) => [d.rowIdx, d]));
    const createdPersonIds: string[] = [];
    const updatedSnapshots = new Map<string, UpdatedPersonSnapshot>();

    const runImport = async () => {
      // Local cache for resolved locations (avoids repeated DB queries for same city/state)
      const locCache = new Map<string, string>();
      const availableSectors =
        sectors.length > 0
          ? sectors
          : (((await supabase.from("sectors").select("*")).data ||
              []) as Sector[]);
      const sectorLookup = buildSectorLookup(availableSectors);

      if (sectors.length === 0 && availableSectors.length > 0) {
        setSectors(availableSectors);
      }

      const ensureNotCancelled = () => {
        if (cancelRequestedRef.current) {
          throw new Error(IMPORT_CANCELLED);
        }
      };

      const trackTouchedPerson = (personId: string) => {
        if (!summary.personIds.includes(personId)) {
          summary.personIds.push(personId);
        }
      };

      // Resolve a city+state pair to a location_id, querying DB with case-insensitive match
      async function resolveLocationId(
        rawCity: string,
        rawState: string,
      ): Promise<string | null> {
        const city = rawCity.trim();
        const stateCode = normalizeStateCode(rawState);
        if (!city || !stateCode) return null;

        const cacheKey = `${city.toLowerCase()}|${stateCode.toLowerCase()}`;
        if (locCache.has(cacheKey)) return locCache.get(cacheKey)!;

        const { data: existing } = await supabase
          .from("locations")
          .select("id")
          .ilike("city", city)
          .eq("state", stateCode)
          .limit(1)
          .maybeSingle();

        if (existing) {
          locCache.set(cacheKey, existing.id);
          return existing.id;
        }

        const { data: created } = await supabase
          .from("locations")
          .insert({ city, state: stateCode })
          .select("id")
          .maybeSingle();

        if (created) {
          locCache.set(cacheKey, created.id);
          return created.id;
        }

        return null;
      }

      async function captureUpdatedPersonSnapshot(
        personId: string,
      ): Promise<void> {
        if (updatedSnapshots.has(personId)) return;

        const [personResult, sectorResult, flemishResult] = await Promise.all([
          supabase
            .from("people")
            .select(
              "title, current_position, occupation, bio, email, phone, linkedin_url, website_url, location_id",
            )
            .eq("id", personId)
            .maybeSingle(),
          supabase
            .from("person_sectors")
            .select("sector_id")
            .eq("person_id", personId),
          supabase
            .from("person_flemish_connections")
            .select("flemish_connection_id")
            .eq("person_id", personId),
        ]);

        if (personResult.error || !personResult.data) {
          throw new Error(
            personResult.error?.message ||
              "Failed to capture existing contact state",
          );
        }
        if (sectorResult.error) {
          throw new Error(
            sectorResult.error.message ||
              "Failed to capture existing sector links",
          );
        }
        if (flemishResult.error) {
          throw new Error(
            flemishResult.error.message ||
              "Failed to capture existing Flemish connections",
          );
        }

        updatedSnapshots.set(personId, {
          personId,
          fields: {
            title: personResult.data.title || null,
            current_position: personResult.data.current_position || null,
            occupation: personResult.data.occupation || null,
            bio: personResult.data.bio || null,
            email: personResult.data.email || null,
            phone: personResult.data.phone || null,
            linkedin_url: personResult.data.linkedin_url || null,
            website_url: personResult.data.website_url || null,
            location_id: personResult.data.location_id || null,
          },
          sectorIds: (sectorResult.data || []).map((entry) => entry.sector_id),
          flemishConnectionIds: (flemishResult.data || []).map(
            (entry) => entry.flemish_connection_id,
          ),
        });
      }

      async function rollbackImport(): Promise<void> {
        const createdIds = Array.from(new Set(createdPersonIds));

        for (let i = 0; i < createdIds.length; i += 100) {
          const batch = createdIds.slice(i, i + 100);
          const { error: deletePeopleError } = await supabase
            .from("people")
            .delete()
            .in("id", batch);

          if (deletePeopleError) {
            throw new Error(
              deletePeopleError.message ||
                "Failed to remove created contacts during rollback",
            );
          }
        }

        for (const snapshot of updatedSnapshots.values()) {
          const { error: restorePersonError } = await supabase
            .from("people")
            .update(snapshot.fields)
            .eq("id", snapshot.personId);

          if (restorePersonError) {
            throw new Error(
              restorePersonError.message ||
                "Failed to restore updated contact during rollback",
            );
          }

          const { error: clearSectorError } = await supabase
            .from("person_sectors")
            .delete()
            .eq("person_id", snapshot.personId);

          if (clearSectorError) {
            throw new Error(
              clearSectorError.message ||
                "Failed to clear sector links during rollback",
            );
          }

          if (snapshot.sectorIds.length > 0) {
            const { error: restoreSectorError } = await supabase
              .from("person_sectors")
              .insert(
                snapshot.sectorIds.map((sectorId) => ({
                  person_id: snapshot.personId,
                  sector_id: sectorId,
                })),
              );

            if (restoreSectorError) {
              throw new Error(
                restoreSectorError.message ||
                  "Failed to restore sector links during rollback",
              );
            }
          }

          const { error: clearFlemishError } = await supabase
            .from("person_flemish_connections")
            .delete()
            .eq("person_id", snapshot.personId);

          if (clearFlemishError) {
            throw new Error(
              clearFlemishError.message ||
                "Failed to clear Flemish connections during rollback",
            );
          }

          if (snapshot.flemishConnectionIds.length > 0) {
            const { error: restoreFlemishError } = await supabase
              .from("person_flemish_connections")
              .insert(
                snapshot.flemishConnectionIds.map((flemishConnectionId) => ({
                  person_id: snapshot.personId,
                  flemish_connection_id: flemishConnectionId,
                })),
              );

            if (restoreFlemishError) {
              throw new Error(
                restoreFlemishError.message ||
                  "Failed to restore Flemish connections during rollback",
              );
            }
          }
        }
      }

      async function assignRowSectors(
        personId: string,
        row: MappedRow,
        rowNumber: number,
        fullName: string,
      ) {
        const rawSectors = (row.sectors || "").trim();
        if (!rawSectors) return;

        const { sectorIds, unknown } = resolveSectorIds(
          rawSectors,
          sectorLookup,
        );

        if (unknown.length > 0) {
          summary.warnings.push({
            row: rowNumber,
            name: fullName,
            reason: `Unknown sector value${unknown.length !== 1 ? "s" : ""}: ${unknown.join(", ")}`,
          });
        }

        if (sectorIds.length === 0) return;

        const payload = sectorIds.map((sectorId) => ({
          person_id: personId,
          sector_id: sectorId,
        }));
        const { error } = await supabase
          .from("person_sectors")
          .upsert(payload, {
            onConflict: "person_id,sector_id",
            ignoreDuplicates: true,
          });

        if (error) {
          throw new Error(error.message || "Failed to assign imported sectors");
        }

        summary.csvSectorLinks += sectorIds.length;
      }

      const total = validRows.length;
      setImportProgress({ current: 0, total });

      try {
        for (let i = 0; i < validRows.length; i++) {
          ensureNotCancelled();

          const row = validRows[i];
          const isDupe = dupeIdxSet.has(i);
          const first = (row.first_name || "").trim();
          const last = (row.last_name || "").trim();
          const fullName = [row.title, first, last].filter(Boolean).join(" ");

          // Handle duplicates based on user choice
          if (isDupe) {
            if (dupeAction === "skip") {
              summary.skipped++;
              setImportProgress({ current: i + 1, total });
              continue;
            }

            if (dupeAction === "update") {
              const dupe = dupeMap.get(i)!;
              await captureUpdatedPersonSnapshot(dupe.existingId);
              ensureNotCancelled();

              const locationId = await resolveLocationId(
                row.location_city || "",
                row.location_state || "",
              );
              ensureNotCancelled();

              const updateFields: Record<string, string | null> = {};
              if (row.title) updateFields.title = row.title;
              if (row.current_position)
                updateFields.current_position = row.current_position;
              if (row.occupation) updateFields.occupation = row.occupation;
              if (row.bio) updateFields.bio = row.bio;
              if (row.email) updateFields.email = row.email;
              if (row.phone) updateFields.phone = row.phone;
              if (row.linkedin_url)
                updateFields.linkedin_url = row.linkedin_url;
              if (row.website_url) updateFields.website_url = row.website_url;
              if (locationId) updateFields.location_id = locationId;

              const hasScalarUpdates = Object.keys(updateFields).length > 0;
              const hasLinkedUpdates = Boolean(
                (row.flemish_connection || "").trim() ||
                (row.sectors || "").trim(),
              );

              if (!hasScalarUpdates && !hasLinkedUpdates) {
                summary.skipped++;
                setImportProgress({ current: i + 1, total });
                continue;
              }

              if (hasScalarUpdates) {
                const { error: updateErr } = await supabase
                  .from("people")
                  .update(updateFields)
                  .eq("id", dupe.existingId);

                if (updateErr) {
                  summary.failed++;
                  summary.errors.push({
                    row: i + 1,
                    name: fullName,
                    reason: updateErr.message,
                  });
                  setImportProgress({ current: i + 1, total });
                  continue;
                }
              }

              ensureNotCancelled();

              try {
                if (row.flemish_connection) {
                  await syncPersonFlemishConnections(
                    dupe.existingId,
                    row.flemish_connection,
                  );
                }

                ensureNotCancelled();
                await assignRowSectors(dupe.existingId, row, i + 1, fullName);
              } catch (err) {
                if (err instanceof Error && err.message === IMPORT_CANCELLED) {
                  throw err;
                }
                summary.failed++;
                summary.errors.push({
                  row: i + 1,
                  name: fullName,
                  reason: getErrorMessage(err, "Failed to sync linked data"),
                });
                setImportProgress({ current: i + 1, total });
                continue;
              }

              summary.updated++;
              trackTouchedPerson(dupe.existingId);

              setImportProgress({ current: i + 1, total });
              continue;
            }
            // dupeAction === 'create' falls through to normal insert below
          }

          // Resolve location_id (normalizes state names to codes, case-insensitive city match)
          const locationId = await resolveLocationId(
            row.location_city || "",
            row.location_state || "",
          );
          ensureNotCancelled();

          const { data: person, error: insertErr } = await supabase
            .from("people")
            .insert({
              name: fullName,
              title: row.title || null,
              first_name: first,
              last_name: last || null,
              current_position: row.current_position || null,
              occupation: row.occupation || null,
              location_id: locationId || null,
              bio: row.bio || null,
              email: row.email || null,
              phone: row.phone || null,
              linkedin_url: row.linkedin_url || null,
              website_url: row.website_url || null,
              data_source: "csv_import",
            })
            .select("id")
            .maybeSingle();

          if (person) {
            createdPersonIds.push(person.id);
            try {
              if (row.flemish_connection) {
                await syncPersonFlemishConnections(
                  person.id,
                  row.flemish_connection,
                );
              }
              ensureNotCancelled();
              await assignRowSectors(person.id, row, i + 1, fullName);
            } catch (err) {
              if (err instanceof Error && err.message === IMPORT_CANCELLED) {
                throw err;
              }
              summary.failed++;
              summary.errors.push({
                row: i + 1,
                name: fullName,
                reason: getErrorMessage(err, "Failed to sync linked data"),
              });
              setImportProgress({ current: i + 1, total });
              continue;
            }

            summary.created++;
            trackTouchedPerson(person.id);
          } else {
            summary.failed++;
            summary.errors.push({
              row: i + 1,
              name: fullName,
              reason: insertErr?.message || "Unknown error",
            });
          }

          setImportProgress({ current: i + 1, total });
        }
      } catch (err) {
        if (!(err instanceof Error) || err.message !== IMPORT_CANCELLED) {
          throw err;
        }
      }

      if (cancelRequestedRef.current) {
        setRollbackInProgress(true);

        try {
          await rollbackImport();
          setError(
            `Import cancelled. Rolled back ${createdPersonIds.length} created contact${createdPersonIds.length !== 1 ? "s" : ""} and ${updatedSnapshots.size} updated contact${updatedSnapshots.size !== 1 ? "s" : ""}.`,
          );
        } catch (rollbackErr) {
          setError(
            getErrorMessage(
              rollbackErr,
              "Import cancellation failed while rolling back changes",
            ),
          );
        } finally {
          setRollbackInProgress(false);
          setCancelRequested(false);
          cancelRequestedRef.current = false;
          setImportProgress({ current: 0, total: 0 });
          setImportSummary(null);
          onContactAdded();
          setStep("confirm");
        }
        return;
      }

      if (summary.personIds.length > 0) {
        kickEmbeddingWorker(20);
      }

      setImportSummary(summary);
      onContactAdded();
      setStep("done");
    };

    try {
      await runImport();
    } catch (err) {
      setRollbackInProgress(false);
      setCancelRequested(false);
      cancelRequestedRef.current = false;
      setImportProgress({ current: 0, total: 0 });
      setError(getErrorMessage(err, "Import failed"));
      setStep("confirm");
    }
  };

  const handleBulkSectorAssign = async () => {
    if (!importSummary || selectedSectorIds.length === 0) return;
    setAssigningSectors(true);

    const rows = importSummary.personIds.flatMap((pid) =>
      selectedSectorIds.map((sid) => ({ person_id: pid, sector_id: sid })),
    );

    // Insert in batches of 200 to avoid payload limits
    for (let i = 0; i < rows.length; i += 200) {
      await supabase.from("person_sectors").upsert(rows.slice(i, i + 200), {
        onConflict: "person_id,sector_id",
        ignoreDuplicates: true,
      });
    }

    setAssigningSectors(false);
    setSectorsAssigned(true);
  };

  const handleReset = () => {
    cancelRequestedRef.current = false;
    setStep("upload");
    setParsed(null);
    setMappings([]);
    setValidRows([]);
    setInvalidRows([]);
    setDupes([]);
    setDupeAction("skip");
    setError("");
    setImportSummary(null);
    setImportProgress({ current: 0, total: 0 });
    setCancelRequested(false);
    setRollbackInProgress(false);
    setFileName("");
    setSelectedSectorIds([]);
    setSectorsAssigned(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleCancelImport = () => {
    if (cancelRequestedRef.current || rollbackInProgress) return;
    cancelRequestedRef.current = true;
    setCancelRequested(true);
  };

  const firstNameMapping = mappings.find((m) => m.fieldKey === "first_name");
  const fullNameMapping = mappings.find((m) => m.fieldKey === "_full_name");
  const hasNameMapped = !!(
    (firstNameMapping && firstNameMapping.csvColumn) ||
    (fullNameMapping && fullNameMapping.csvColumn)
  );

  const dupeIdxSet = new Set(dupes.map((d) => d.rowIdx));
  const nonDupeCount = validRows.filter((_, i) => !dupeIdxSet.has(i)).length;
  const importCount = dupeAction === "skip" ? nonDupeCount : validRows.length;

  return (
    <div className="space-y-5">
      {error && (
        <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {step === "upload" && (
        <div>
          <div
            onClick={() => fileRef.current?.click()}
            className="border-2 border-dashed border-yellow-200 rounded-xl p-10 text-center cursor-pointer hover:border-yellow-400 hover:bg-yellow-50/40 transition-all group"
          >
            <Upload className="w-9 h-9 text-yellow-300 group-hover:text-yellow-500 mx-auto mb-3 transition-colors" />
            <p className="text-sm font-medium text-gray-700 mb-1">
              Click to upload a file
            </p>
            <p className="text-xs text-gray-400 leading-relaxed max-w-md mx-auto">
              Accepted formats:{" "}
              <span className="font-medium text-gray-500">.csv</span>,{" "}
              <span className="font-medium text-gray-500">.xlsx</span>,{" "}
              <span className="font-medium text-gray-500">.xls</span>,{" "}
              <span className="font-medium text-gray-500">.tsv</span>,{" "}
              <span className="font-medium text-gray-500">.txt</span>
            </p>
            <p className="text-xs text-gray-400 mt-1">
              We'll guide you through mapping columns to contact fields.
            </p>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.txt,.tsv,.xlsx,.xls"
            onChange={handleFile}
            className="hidden"
          />

          <div className="flex items-center gap-2 mt-3">
            <button
              onClick={() => downloadTemplate("csv")}
              className="flex items-center gap-1.5 text-xs text-yellow-700 hover:text-yellow-800 bg-yellow-50 hover:bg-yellow-100 border border-yellow-200 px-3 py-1.5 rounded-lg transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Download CSV template
            </button>
            <button
              onClick={() => downloadTemplate("xlsx")}
              className="flex items-center gap-1.5 text-xs text-yellow-700 hover:text-yellow-800 bg-yellow-50 hover:bg-yellow-100 border border-yellow-200 px-3 py-1.5 rounded-lg transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Download Excel template
            </button>
          </div>
        </div>
      )}

      {step === "map" && parsed && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-yellow-50 flex items-center justify-center">
                <FileSpreadsheet className="w-4 h-4 text-yellow-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900">
                  Map Columns
                </p>
                <p className="text-xs text-gray-500">
                  {fileName} -- {parsed.totalRows} row
                  {parsed.totalRows !== 1 ? "s" : ""}, {parsed.headers.length}{" "}
                  column{parsed.headers.length !== 1 ? "s" : ""}
                </p>
              </div>
            </div>
            <button
              onClick={handleReset}
              className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
            >
              Start over
            </button>
          </div>

          <div className="bg-yellow-50/40 border border-yellow-200 rounded-xl overflow-hidden">
            <div className="grid grid-cols-[1fr,auto,1fr,auto] items-center gap-0 px-4 py-2.5 border-b border-yellow-200 bg-yellow-100/50">
              <span className="text-[10px] uppercase tracking-wider font-semibold text-yellow-700">
                Profile Field
              </span>
              <span />
              <span className="text-[10px] uppercase tracking-wider font-semibold text-yellow-700">
                CSV Column
              </span>
              <span className="text-[10px] uppercase tracking-wider font-semibold text-yellow-700 text-right">
                Match
              </span>
            </div>

            <div className="divide-y divide-yellow-100">
              {ALL_DISPLAY_FIELDS.map((field) => {
                const mapping = mappings.find((m) => m.fieldKey === field.key);
                if (!mapping) return null;
                const selected = mapping.csvColumn || "";
                const conf = mapping.confidence || 0;
                const confInfo = selected
                  ? confidenceLabel(conf)
                  : { text: "", color: "" };

                return (
                  <div
                    key={field.key}
                    className="grid grid-cols-[1fr,auto,1fr,auto] items-center gap-3 px-4 py-2.5"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm text-gray-800">
                        {field.label}
                      </span>
                      {field.required && (
                        <span className="text-[10px] text-red-500 font-semibold">
                          *
                        </span>
                      )}
                    </div>

                    <ArrowRight className="w-3.5 h-3.5 text-yellow-300" />

                    <div className="relative">
                      <select
                        value={selected}
                        onChange={(e) =>
                          updateMapping(field.key, e.target.value)
                        }
                        className={`w-full text-sm border rounded-lg pl-3 pr-8 py-1.5 appearance-none focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:border-transparent transition-all ${
                          selected
                            ? "border-yellow-300 bg-yellow-50/60 text-gray-800"
                            : "border-gray-200 bg-white text-gray-400"
                        }`}
                      >
                        <option value="">-- Skip --</option>
                        {parsed.headers.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
                    </div>

                    <div className="w-16 text-right">
                      {confInfo.text && (
                        <span
                          className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${confInfo.color}`}
                        >
                          {confInfo.text}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {!hasNameMapped && (
            <div className="flex items-center gap-2 text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span>
                Either <strong>First Name</strong> or <strong>Full Name</strong>{" "}
                must be mapped to proceed.
              </span>
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              onClick={handleConfirm}
              disabled={!hasNameMapped}
              className="flex items-center gap-2 px-5 py-2.5 bg-yellow-500 hover:bg-yellow-600 disabled:bg-gray-200 disabled:text-gray-400 text-white text-sm font-medium rounded-lg transition-colors"
            >
              <Columns className="w-4 h-4" />
              <span>Preview Import</span>
            </button>
            <button
              onClick={handleReset}
              className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {step === "confirm" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-yellow-50 flex items-center justify-center">
                <Check className="w-4 h-4 text-yellow-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900">
                  Confirm Import
                </p>
                <p className="text-xs text-gray-500">
                  {nonDupeCount} new, {dupes.length} duplicate
                  {dupes.length !== 1 ? "s" : ""}, {invalidRows.length} invalid
                </p>
              </div>
            </div>
            <button
              onClick={() => setStep("map")}
              className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
            >
              Back to mapping
            </button>
          </div>

          {checkingDupes && (
            <div className="flex items-center gap-2 text-sm text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2.5">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Checking for duplicates...</span>
            </div>
          )}

          {dupes.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 space-y-3">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-amber-600" />
                <p className="text-xs font-medium text-amber-700">
                  {dupes.length} duplicate{dupes.length !== 1 ? "s" : ""} found
                </p>
              </div>

              <div className="space-y-0.5 max-h-20 overflow-y-auto">
                {dupes.map((d, i) => {
                  const row = validRows[d.rowIdx];
                  return (
                    <p key={i} className="text-[11px] text-amber-600">
                      "{row?.first_name} {row?.last_name}" matches existing "
                      {d.existingName}"
                    </p>
                  );
                })}
              </div>

              <div>
                <p className="text-[10px] uppercase tracking-wider font-semibold text-amber-700 mb-1.5">
                  How to handle duplicates:
                </p>
                <div className="flex flex-wrap gap-2">
                  {[
                    {
                      value: "skip" as DupeAction,
                      label: "Skip duplicates",
                      desc: "Don't import matching rows",
                    },
                    {
                      value: "update" as DupeAction,
                      label: "Update existing",
                      desc: "Overwrite with new data",
                    },
                    {
                      value: "create" as DupeAction,
                      label: "Create anyway",
                      desc: "Import as new contacts",
                    },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setDupeAction(opt.value)}
                      className={`text-left px-3 py-2 rounded-lg border text-xs transition-all ${
                        dupeAction === opt.value
                          ? "border-amber-400 bg-amber-100 text-amber-800"
                          : "border-amber-200 bg-white text-amber-600 hover:bg-amber-50"
                      }`}
                    >
                      <span className="font-medium">{opt.label}</span>
                      <span className="block text-[10px] opacity-70 mt-0.5">
                        {opt.desc}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {invalidRows.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
              <p className="text-xs font-medium text-red-700 mb-1.5">
                {invalidRows.length} row
                {invalidRows.length !== 1 ? "s" : ""} will be skipped:
              </p>
              <div className="space-y-0.5 max-h-20 overflow-y-auto">
                {invalidRows.map((inv, i) => (
                  <p key={i} className="text-[11px] text-red-600">
                    Row {i + 1}: {inv.reason}
                  </p>
                ))}
              </div>
            </div>
          )}

          {validRows.length > 0 &&
            (() => {
              // Build column list from mapped fields that have data
              const mappedFields = mappings
                .filter((m) => m.csvColumn && m.fieldKey !== "_full_name")
                .map((m) => {
                  const field = PROFILE_FIELDS.find(
                    (f) => f.key === m.fieldKey,
                  );
                  return field ? { key: field.key, label: field.label } : null;
                })
                .filter(Boolean) as { key: string; label: string }[];

              // Always include first_name/last_name if full_name was mapped (they get split)
              const keys = new Set(mappedFields.map((f) => f.key));
              if (!keys.has("first_name")) {
                mappedFields.unshift({
                  key: "first_name",
                  label: "First Name",
                });
              }
              if (
                !keys.has("last_name") &&
                validRows.some((r) => r.last_name)
              ) {
                const fnIdx = mappedFields.findIndex(
                  (f) => f.key === "first_name",
                );
                mappedFields.splice(fnIdx + 1, 0, {
                  key: "last_name",
                  label: "Last Name",
                });
              }

              return (
                <div className="border border-yellow-200 rounded-lg max-h-64 overflow-x-auto overflow-y-auto">
                  <table className="text-xs w-max min-w-full">
                    <thead className="bg-yellow-50 sticky top-0 z-10">
                      <tr>
                        {mappedFields.map((f) => (
                          <th
                            key={f.key}
                            className="px-3 py-2 text-left text-yellow-700 font-medium whitespace-nowrap"
                          >
                            {f.label}
                          </th>
                        ))}
                        <th className="px-3 py-2 w-16 text-center text-yellow-700 font-medium sticky right-0 bg-yellow-50">
                          Status
                        </th>
                        <th className="px-3 py-2 w-8 sticky right-0 bg-yellow-50" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-yellow-100">
                      {validRows.map((row, i) => {
                        const isDupe = dupeIdxSet.has(i);
                        return (
                          <tr
                            key={i}
                            className={
                              isDupe
                                ? "bg-amber-50/50 opacity-60"
                                : "hover:bg-yellow-50/30"
                            }
                          >
                            {mappedFields.map((f) => (
                              <td
                                key={f.key}
                                className="px-3 py-2 text-gray-600 whitespace-nowrap max-w-[200px] truncate"
                              >
                                {row[f.key] || "-"}
                              </td>
                            ))}
                            <td className="px-3 py-2 text-center sticky right-8 bg-white">
                              {isDupe ? (
                                <span className="text-[10px] font-semibold text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded">
                                  {dupeAction === "skip"
                                    ? "Skip"
                                    : dupeAction === "update"
                                      ? "Update"
                                      : "New"}
                                </span>
                              ) : (
                                <span className="text-[10px] font-semibold text-green-600 bg-green-50 px-1.5 py-0.5 rounded">
                                  New
                                </span>
                              )}
                            </td>
                            <td className="px-2 py-2 sticky right-0 bg-white">
                              {!isDupe && (
                                <button
                                  onClick={() =>
                                    setValidRows((prev) =>
                                      prev.filter((_, idx) => idx !== i),
                                    )
                                  }
                                  className="p-1 text-gray-300 hover:text-red-500 transition-colors"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })()}

          <div className="flex items-center gap-3">
            <button
              onClick={handleImport}
              disabled={importCount === 0}
              className="flex items-center gap-2 px-5 py-2.5 bg-yellow-500 hover:bg-yellow-600 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
            >
              <Upload className="w-4 h-4" />
              <span>
                Import {importCount} Contact
                {importCount !== 1 ? "s" : ""}
              </span>
            </button>
            <button
              onClick={handleReset}
              className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {step === "importing" && (
        <div className="py-8 space-y-4">
          <div className="flex items-center justify-center gap-2 text-sm text-yellow-700">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span>
              {rollbackInProgress
                ? "Cancelling import and rolling back changes..."
                : cancelRequested
                  ? `Stopping after current step... ${importProgress.current} / ${importProgress.total}`
                  : `Importing contacts... ${importProgress.current} / ${importProgress.total}`}
            </span>
          </div>
          <div className="w-full bg-yellow-100 rounded-full h-2.5 overflow-hidden">
            <div
              className="bg-yellow-500 h-2.5 rounded-full transition-all duration-300"
              style={{
                width:
                  importProgress.total > 0
                    ? `${(importProgress.current / importProgress.total) * 100}%`
                    : "0%",
              }}
            />
          </div>
          <p className="text-[11px] text-gray-400 text-center">
            {rollbackInProgress
              ? "Restoring any contacts that were already created or updated"
              : cancelRequested
                ? "Waiting for the current database step to finish before rollback starts"
                : importProgress.total > 0
                  ? `${Math.round((importProgress.current / importProgress.total) * 100)}% complete`
                  : "Starting..."}
          </p>
          <div className="flex justify-center">
            <button
              onClick={handleCancelImport}
              disabled={cancelRequested || rollbackInProgress}
              className="px-4 py-2 text-sm border border-red-200 text-red-600 rounded-lg hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {rollbackInProgress
                ? "Rolling back..."
                : cancelRequested
                  ? "Cancelling..."
                  : "Cancel Import"}
            </button>
          </div>
        </div>
      )}

      {step === "done" && importSummary && (
        <div className="space-y-5">
          <div className="text-center py-4">
            <div className="w-12 h-12 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <CheckCircle2 className="w-6 h-6 text-yellow-600" />
            </div>
            <p className="text-sm font-semibold text-gray-900 mb-3">
              Import Complete
            </p>

            {/* Summary grid */}
            <div className="grid grid-cols-4 gap-3 max-w-md mx-auto mb-4">
              {importSummary.created > 0 && (
                <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                  <p className="text-lg font-bold text-green-700">
                    {importSummary.created}
                  </p>
                  <p className="text-[10px] text-green-600 font-medium">
                    Created
                  </p>
                </div>
              )}
              {importSummary.updated > 0 && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
                  <p className="text-lg font-bold text-blue-700">
                    {importSummary.updated}
                  </p>
                  <p className="text-[10px] text-blue-600 font-medium">
                    Updated
                  </p>
                </div>
              )}
              {importSummary.skipped > 0 && (
                <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                  <p className="text-lg font-bold text-gray-500">
                    {importSummary.skipped}
                  </p>
                  <p className="text-[10px] text-gray-500 font-medium">
                    Skipped
                  </p>
                </div>
              )}
              {importSummary.failed > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  <p className="text-lg font-bold text-red-700">
                    {importSummary.failed}
                  </p>
                  <p className="text-[10px] text-red-600 font-medium">Failed</p>
                </div>
              )}
            </div>

            {importSummary.personIds.length > 0 && (
              <div className="space-y-1">
                <p className="text-[11px] text-gray-400 flex items-center justify-center gap-1">
                  <RefreshCw className="w-3 h-3" />
                  Embeddings are being generated in the background
                </p>
                {importSummary.csvSectorLinks > 0 && (
                  <p className="text-[11px] text-gray-500">
                    Imported {importSummary.csvSectorLinks} sector link
                    {importSummary.csvSectorLinks !== 1 ? "s" : ""} from CSV
                    data
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Error details */}
          {importSummary.errors.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
              <p className="text-xs font-medium text-red-700 mb-1.5">
                Failed rows:
              </p>
              <div className="space-y-0.5 max-h-24 overflow-y-auto">
                {importSummary.errors.map((err, i) => (
                  <p key={i} className="text-[11px] text-red-600">
                    Row {err.row} ({err.name}): {err.reason}
                  </p>
                ))}
              </div>
            </div>
          )}

          {importSummary.warnings.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
              <p className="text-xs font-medium text-amber-700 mb-1.5">
                Import warnings:
              </p>
              <div className="space-y-0.5 max-h-24 overflow-y-auto">
                {importSummary.warnings.map((warning, i) => (
                  <p key={i} className="text-[11px] text-amber-700">
                    Row {warning.row} ({warning.name}): {warning.reason}
                  </p>
                ))}
              </div>
            </div>
          )}

          {/* Bulk sector assignment */}
          {importSummary.personIds.length > 0 && sectors.length > 0 && (
            <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-4 space-y-3">
              <div className="flex items-center gap-2">
                <Tags className="w-4 h-4 text-gray-500" />
                <p className="text-xs font-semibold text-gray-700">
                  Add the same sectors to {importSummary.personIds.length}{" "}
                  imported contact
                  {importSummary.personIds.length !== 1 ? "s" : ""}
                </p>
              </div>

              <p className="text-[11px] text-gray-500">
                Use this if you want to add one shared sector set to every
                imported contact. Per-row sectors from the CSV were already
                applied above when available.
              </p>

              {!sectorsAssigned ? (
                <>
                  <div className="flex flex-wrap gap-1.5">
                    {sectors.map((s) => {
                      const selected = selectedSectorIds.includes(s.id);
                      return (
                        <button
                          key={s.id}
                          onClick={() =>
                            setSelectedSectorIds((prev) =>
                              selected
                                ? prev.filter((id) => id !== s.id)
                                : [...prev, s.id],
                            )
                          }
                          className={`text-xs px-3 py-1.5 rounded-full border transition-all ${
                            selected
                              ? "bg-yellow-100 border-yellow-400 text-yellow-800 font-medium"
                              : "bg-white border-gray-200 text-gray-600 hover:border-gray-300"
                          }`}
                        >
                          {s.name}
                        </button>
                      );
                    })}
                  </div>

                  {selectedSectorIds.length > 0 && (
                    <button
                      onClick={handleBulkSectorAssign}
                      disabled={assigningSectors}
                      className="flex items-center gap-2 px-4 py-2 bg-yellow-500 hover:bg-yellow-600 text-white text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
                    >
                      {assigningSectors ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Tags className="w-3.5 h-3.5" />
                      )}
                      Add {selectedSectorIds.length} sector
                      {selectedSectorIds.length !== 1 ? "s" : ""} to all
                    </button>
                  )}
                </>
              ) : (
                <div className="flex items-center gap-2 text-xs text-green-600">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Sectors added successfully</span>
                </div>
              )}
            </div>
          )}

          <div className="text-center">
            <button
              onClick={handleReset}
              className="text-sm text-yellow-600 hover:text-yellow-700 font-medium transition-colors"
            >
              Import another file
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
