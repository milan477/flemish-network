import { appendCanonicalFlemishConnections } from "./flemishConnectionCatalog.ts";
import type { FlemishFactCandidate } from "./discoveryOrganizations.ts";

// Persistence rules for Discovery records (discovered_contacts and
// discovered_organizations): database write errors keep their Postgres
// SQLSTATE, one bad record never discards the rest of a page, and merges never
// rewrite a record's provenance.

export class DiscoveryWriteError extends Error {
  readonly code: string | null;

  constructor(message: string, code?: string | null) {
    super(message);
    this.name = "DiscoveryWriteError";
    this.code = code ?? null;
  }
}

// Wraps a PostgREST error, keeping the existing "<context>: <message>" format.
export function discoveryWriteError(
  context: string | null,
  error: { message: string; code?: string | null },
): DiscoveryWriteError {
  return new DiscoveryWriteError(
    context ? `${context}: ${error.message}` : error.message,
    error.code,
  );
}

// Postgres SQLSTATE classes 21 (cardinality violation), 22 (data exception)
// and 23 (integrity constraint violation) mean this record's data was
// rejected; retrying the page would fail the same way. Classification uses the
// SQLSTATE only: message text is not trusted because constraint and column
// names contain words like "network" that look like transport failures.
export function isRecordDataError(error: unknown): boolean {
  return error instanceof DiscoveryWriteError &&
    error.code !== null &&
    /^2[123]/.test(error.code);
}

export interface RecordSaveFailure {
  record: string;
  error: string;
  code: string | null;
  dataError: boolean;
  cause: unknown;
}

// Saves each record independently so one failure cannot discard the others.
export async function saveRecordsIsolated<T, R>(
  items: T[],
  save: (item: T) => Promise<R>,
  describe: (item: T) => string,
): Promise<{ saved: Array<{ item: T; result: R }>; failures: RecordSaveFailure[] }> {
  const saved: Array<{ item: T; result: R }> = [];
  const failures: RecordSaveFailure[] = [];

  for (const item of items) {
    try {
      saved.push({ item, result: await save(item) });
    } catch (error) {
      failures.push({
        record: describe(item),
        error: error instanceof Error ? error.message : String(error),
        code: error instanceof DiscoveryWriteError ? error.code : null,
        dataError: isRecordDataError(error),
        cause: error,
      });
    }
  }

  return { saved, failures };
}

// A page is processed when at least one record saved or every failure was the
// record's own data. Only a page where nothing saved because of a failure that
// is not a data error (transport, upstream, schema) goes back for a retry.
export function pageSaveNeedsRetry(
  savedCount: number,
  failures: RecordSaveFailure[],
): boolean {
  return savedCount === 0 && failures.some((failure) => !failure.dataError);
}

export interface DiscoveryProvenance {
  source: string;
  candidate_key: string | null;
  agent_run_id: string | null;
}

// A merge never rewrites who or what created the record: `source` (e.g.
// official_fayat_directory, import, manual), `candidate_key`, and the
// first-seen `agent_run_id` (origin attribution and per-query yield). Recency
// lives in last_seen_at / last_evidence_at. Incoming values only fill gaps.
export function preservedDiscoveryProvenance(
  existing: {
    source?: string | null;
    candidate_key?: string | null;
    agent_run_id?: string | null;
  },
  incoming: DiscoveryProvenance,
): DiscoveryProvenance {
  return {
    source: existing.source || incoming.source,
    candidate_key: existing.candidate_key || incoming.candidate_key,
    agent_run_id: existing.agent_run_id || incoming.agent_run_id,
  };
}

// A Flemish connection is a list of entities or short phrases joined with
// "; ", never a passage. The extraction model sometimes returns a whole press
// release, and merges prefer the longer text, so the shape is enforced where
// the value is composed for the write.
export interface ConnectionTextLimits {
  maxPartLength: number;
  maxTotalLength: number;
}

// discovered_contacts.flemish_connection: entity names and short phrases.
export const CONTACT_FLEMISH_CONNECTION_LIMITS: ConnectionTextLimits = {
  maxPartLength: 160,
  maxTotalLength: 400,
};

// discovered_organizations.flemish_belgian_relevance: a short rationale plus
// canonical entity names (the 800-character bound merges already applied).
export const ORGANIZATION_RELEVANCE_LIMITS: ConnectionTextLimits = {
  maxPartLength: 800,
  maxTotalLength: 800,
};

// Trims and deduplicates "; "-separated parts, drops parts longer than
// maxPartLength, and skips any part that would push the total past
// maxTotalLength so later short entity names still fit.
function boundConnectionParts(
  text: string,
  limits: ConnectionTextLimits,
): string {
  const seen = new Set<string>();
  const kept: string[] = [];
  let total = 0;

  for (const rawPart of text.split(";")) {
    const part = rawPart.replace(/\s+/g, " ").trim();
    if (!part || part.length > limits.maxPartLength) continue;
    const key = part.toLowerCase();
    if (seen.has(key)) continue;
    const added = (kept.length > 0 ? 2 : 0) + part.length;
    if (total + added > limits.maxTotalLength) continue;
    seen.add(key);
    kept.push(part);
    total += added;
  }

  return kept.join("; ");
}

// Bounds the raw text before appending canonical names: appending skips a name
// the raw text already mentions, and that mention may sit in a dropped passage.
export function composeFlemishConnectionText(
  rawText: string,
  candidates: FlemishFactCandidate[],
  limits: ConnectionTextLimits,
): string {
  return boundConnectionParts(
    appendCanonicalFlemishConnections(
      boundConnectionParts(rawText, limits),
      candidates,
    ),
    limits,
  );
}
