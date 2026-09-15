import type { SupabaseAdminClient } from "./database.types.ts";
import type { FlemishFactCandidate } from "./discoveryOrganizations.ts";

interface FlemishConnectionLookupRow {
  id: string;
  name: string;
  entity_type?: string | null;
}

interface FlemishConnectionCatalogRow extends FlemishConnectionLookupRow {
  normalized_name?: string | null;
  is_filterable?: boolean | null;
  flemish_connection_aliases?:
    | Array<{
      alias?: string | null;
      status?: string | null;
    }>
    | null;
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function containsConnectionName(text: string, name: string): boolean {
  const searchableText = ` ${
    text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
  } `;
  const searchableName = name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return Boolean(searchableName) &&
    searchableText.includes(` ${searchableName} `);
}

function inferConnectionType(
  value: string,
): "university" | "government" | "company" | "other" {
  if (
    /\b(university|universiteit|college|school|faculty|campus)\b/i.test(value)
  ) {
    return "university";
  }
  if (
    /\b(government|ministry|department|delegation|consulate|embassy|agency|public)\b/i
      .test(value)
  ) {
    return "government";
  }
  if (
    /\b(inc|llc|ltd|corp|corporation|company|technologies|labs?|group|ventures|industries|imec)\b/i
      .test(value)
  ) {
    return "company";
  }
  return "other";
}

function rowsFromRpc(data: unknown): FlemishConnectionLookupRow[] {
  if (!Array.isArray(data)) return [];
  return data.filter((row): row is FlemishConnectionLookupRow =>
    Boolean(row && typeof row === "object" && "id" in row && "name" in row)
  );
}

async function lookupConnection(
  supabase: SupabaseAdminClient,
  values: string[],
): Promise<FlemishConnectionLookupRow | null> {
  for (const value of values) {
    if (!value.trim()) continue;
    const { data, error } = await supabase.rpc("lookup_flemish_connection", {
      p_name_or_alias: value,
    });
    if (error) {
      throw new Error(`Failed to look up Flemish connection: ${error.message}`);
    }
    const match = rowsFromRpc(data)[0];
    if (match) return match;
  }
  return null;
}

export async function loadFlemishConnectionCatalogPrompt(
  supabase: SupabaseAdminClient,
): Promise<string> {
  const { data, error } = await supabase
    .from("flemish_connections")
    .select(
      "id, name, normalized_name, entity_type, is_filterable, flemish_connection_aliases(alias, status)",
    )
    .order("name");

  if (error) {
    throw new Error(
      `Failed to load Flemish connection catalog: ${error.message}`,
    );
  }

  const rows = (data || []) as FlemishConnectionCatalogRow[];
  if (rows.length === 0) {
    return "The canonical Flemish connection catalog is currently empty.";
  }

  const catalogLines = rows.map((row) => {
    const aliases = (row.flemish_connection_aliases || [])
      .filter((alias) => alias.status === "approved" && alias.alias?.trim())
      .map((alias) => alias.alias!.trim());
    const aliasText = aliases.length > 0
      ? `; approved aliases: ${aliases.join(", ")}`
      : "";
    return `- ${row.name} [${row.entity_type || "other"}]${aliasText}`;
  });

  return [
    "Canonical Flemish connection catalog (authoritative for this run):",
    ...catalogLines,
  ].join("\n");
}

export async function resolveModelFlemishFactCandidates(
  supabase: SupabaseAdminClient,
  candidates: FlemishFactCandidate[],
): Promise<FlemishFactCandidate[]> {
  const resolved: FlemishFactCandidate[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    const proposedName = candidate.canonical_name.trim();
    const proposedAlias = candidate.candidate_alias.trim();
    if (!proposedName) continue;

    const canonicalMatch = await lookupConnection(supabase, [proposedName]);
    const aliasMatch = proposedAlias &&
        normalizeKey(proposedAlias) !== normalizeKey(proposedName)
      ? await lookupConnection(supabase, [proposedAlias])
      : null;
    let connection = aliasMatch || canonicalMatch;
    if (!connection) {
      const proposedType = inferConnectionType(proposedName);
      const { data: connectionId, error } = await supabase.rpc(
        "ensure_flemish_connection",
        {
          p_name: proposedName,
          p_type: proposedType,
          p_is_filterable: false,
          p_connection_group: "model_discovery",
        },
      );
      if (error || !connectionId) {
        throw new Error(
          `Failed to create Flemish connection: ${
            error?.message || "missing connection id"
          }`,
        );
      }
      connection = {
        id: String(connectionId),
        name: proposedName,
        entity_type: proposedType,
      };
    }

    const alias = proposedAlias || proposedName;
    if (normalizeKey(alias) !== normalizeKey(connection.name) && !aliasMatch) {
      const { error } = await supabase.rpc("add_flemish_connection_alias", {
        p_connection_name: connection.name,
        p_alias: alias,
        p_source: "model",
        p_status: "pending",
        p_confidence: candidate.confidence || undefined,
        p_source_url: candidate.source_url || undefined,
        p_evidence_excerpt: candidate.evidence_excerpt ||
          candidate.raw_evidence || undefined,
      });
      if (error) {
        throw new Error(
          `Failed to store Flemish alias candidate: ${error.message}`,
        );
      }
    }

    const key = `${connection.id}|${normalizeKey(alias)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    resolved.push({
      ...candidate,
      canonical_name: connection.name,
      candidate_alias: alias,
    });
  }

  return resolved;
}

export function appendCanonicalFlemishConnections(
  rawText: string,
  candidates: FlemishFactCandidate[],
): string {
  const original = rawText.trim();
  const names = Array.from(
    new Set(candidates.map((candidate) => candidate.canonical_name.trim())),
  )
    .filter(Boolean)
    .filter((name) => !containsConnectionName(original, name));

  return [original, ...names].filter(Boolean).join("; ");
}
