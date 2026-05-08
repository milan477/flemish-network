// Verify-before-promote: enrich `discovered_contacts` and `discovered_organizations`
// rows in place. The Verification page only exposes Approve/Reject once a row has
// transitioned to verification_status='verified'. Contradictions are hard-deleted.

import type { JsonSchema } from "./aiContracts.ts";
import { callGeminiStructured } from "./gemini.ts";
import type { SupabaseAdminClient } from "./database.types.ts";
import { formatResultsForLLM, searchWeb } from "./webSearch.ts";

export type DiscoveredRecordKind = "discovered_contact" | "discovered_organization";

export type DiscoveredVerificationOutcome =
  | "verified"
  | "deleted_contradiction"
  | "deleted_low_confidence"
  | "skipped_quota"
  | "error";

export interface DiscoveredVerificationStep {
  record_kind: DiscoveredRecordKind;
  record_id: string;
  record_name: string;
  outcome: DiscoveredVerificationOutcome;
  detail?: string;
  llm_calls_made: number;
  web_searches_made: number;
}

export interface VerificationPayload {
  network_scope: "us_based" | "us_connected_abroad" | null;
  location_city: string | null;
  location_state: string | null;
  location_country: string | null;
  current_role: string | null;
  current_employer: string | null;
  flemish_ties: string[];
  evidence: Array<{ url: string; excerpt: string }>;
  confidence: number;
  contradiction: boolean;
  contradiction_reason: string | null;
  notes: string | null;
}

export interface RunDiscoveredVerificationOptions {
  geminiApiKey?: string;
  runId?: string;
  recordKind: DiscoveredRecordKind;
  recordId: string;
}

const VERIFICATION_PROMPT_CONTACT = `You verify whether a candidate person belongs in a directory of Flemish-connected professionals based in or connected to the United States.

Use the search results to assess:
- Does this person plausibly exist as described?
- Is there a Flemish or Belgian connection (study at KU Leuven/UGent/VUB/UAntwerp, work at imec, BAEF fellow, Belgian/Flemish heritage, etc.)?
- Where do they currently live or work?

Network scope rules:
- "us_based": currently lives or primarily works in the United States.
- "us_connected_abroad": lives outside the US but has clear, current US ties (US employer, US institution, recurring US presence).
- null: NO clear residence or US-tie signal in the evidence. Use null instead of guessing.

Set contradiction=true ONLY when the evidence directly disproves the Flemish/Belgian connection (e.g., the person is clearly someone else, or has no Flemish/Belgian tie at all). Lack of confirmation is NOT a contradiction; emit null/empty values instead.

flemish_ties: short factual phrases (e.g., "KU Leuven PhD 2018", "BAEF fellow 2021", "imec alumni").

evidence: 1-3 supporting URLs with one-sentence excerpts. Empty array if no useful evidence found.

confidence: 0..1, reflecting how strongly the search supports the candidate's identity AND Flemish connection.`;

const VERIFICATION_PROMPT_ORGANIZATION = `You verify whether a candidate organization belongs in a directory of Flemish-connected organizations with US activity.

Network scope rules (treat the org's primary US footprint):
- "us_based": HQ or main operations are in the United States.
- "us_connected_abroad": HQ is outside the US but the org has clear, current US programs, offices, or partnerships.
- null: NO clear US tie OR no clear Flemish/Belgian tie in the evidence. Use null instead of guessing.

Set contradiction=true ONLY when evidence directly disproves the Flemish/Belgian connection (org is unrelated, mistaken identity, etc.). Lack of confirmation is NOT a contradiction.

flemish_ties: short factual phrases (e.g., "Founded in Ghent", "imec spinoff", "Flanders Investment & Trade partner").

evidence: 1-3 supporting URLs with one-sentence excerpts. Empty array if no useful evidence found.

confidence: 0..1.`;

const VERIFICATION_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    network_scope: { type: ["string", "null"], enum: ["us_based", "us_connected_abroad", null] },
    location_city: { type: ["string", "null"] },
    location_state: { type: ["string", "null"] },
    location_country: { type: ["string", "null"] },
    current_role: { type: ["string", "null"] },
    current_employer: { type: ["string", "null"] },
    flemish_ties: { type: "array", items: { type: "string" } },
    evidence: {
      type: "array",
      items: {
        type: "object",
        properties: {
          url: { type: "string" },
          excerpt: { type: "string" },
        },
        required: ["url", "excerpt"],
      },
    },
    confidence: { type: "number" },
    contradiction: { type: "boolean" },
    contradiction_reason: { type: ["string", "null"] },
    notes: { type: ["string", "null"] },
  },
  required: [
    "network_scope",
    "flemish_ties",
    "evidence",
    "confidence",
    "contradiction",
  ],
};

function safeStr(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalizePayload(raw: unknown): VerificationPayload {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const scope = r.network_scope;
  const validScope = scope === "us_based" || scope === "us_connected_abroad" ? scope : null;
  const evidenceRaw = Array.isArray(r.evidence) ? r.evidence : [];
  const flemishTiesRaw = Array.isArray(r.flemish_ties) ? r.flemish_ties : [];
  return {
    network_scope: validScope,
    location_city: safeStr(r.location_city) || null,
    location_state: safeStr(r.location_state) || null,
    location_country: safeStr(r.location_country) || null,
    current_role: safeStr(r.current_role) || null,
    current_employer: safeStr(r.current_employer) || null,
    flemish_ties: flemishTiesRaw.map((value) => safeStr(value)).filter(Boolean).slice(0, 8),
    evidence: evidenceRaw
      .map((item) => {
        const e = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
        return { url: safeStr(e.url), excerpt: safeStr(e.excerpt) };
      })
      .filter((item) => item.url || item.excerpt)
      .slice(0, 3),
    confidence: Math.max(0, Math.min(1, Number(r.confidence) || 0)),
    contradiction: Boolean(r.contradiction),
    contradiction_reason: safeStr(r.contradiction_reason) || null,
    notes: safeStr(r.notes) || null,
  };
}

function buildContactQuery(row: Record<string, unknown>): string {
  const parts: string[] = [];
  parts.push(`"${safeStr(row.name)}"`);
  const employer = safeStr(row.current_position) || safeStr(row.occupation);
  if (employer) parts.push(`"${employer}"`);
  const flemish = safeStr(row.flemish_connection);
  if (flemish) parts.push(flemish);
  const loc = [safeStr(row.location_city), safeStr(row.location_state)].filter(Boolean).join(" ");
  if (loc) parts.push(loc);
  return parts.join(" ").slice(0, 240);
}

function buildOrganizationQuery(row: Record<string, unknown>): string {
  const parts: string[] = [`"${safeStr(row.name)}"`];
  const flemish = safeStr(row.flemish_belgian_relevance);
  if (flemish) parts.push(flemish);
  const site = safeStr(row.website_url);
  if (site) parts.push(site);
  parts.push("Flemish OR Belgian OR Flanders");
  return parts.join(" ").slice(0, 240);
}

export async function verifyDiscoveredRecord(
  supabase: SupabaseAdminClient,
  options: RunDiscoveredVerificationOptions,
): Promise<DiscoveredVerificationStep> {
  const { recordKind, recordId, runId, geminiApiKey } = options;
  const tableName = recordKind === "discovered_contact"
    ? "discovered_contacts"
    : "discovered_organizations";

  // 1. Mark as verifying.
  await supabase
    .from(tableName)
    .update({
      verification_status: "verifying",
      verification_run_id: runId ?? null,
    })
    .eq("id", recordId);

  // 2. Load the row.
  const { data: row, error: loadError } = await supabase
    .from(tableName)
    .select("*")
    .eq("id", recordId)
    .maybeSingle();

  if (loadError || !row) {
    return {
      record_kind: recordKind,
      record_id: recordId,
      record_name: "(unknown)",
      outcome: "error",
      detail: loadError?.message ?? "row missing",
      llm_calls_made: 0,
      web_searches_made: 0,
    };
  }

  const recordName = safeStr((row as Record<string, unknown>).name) || recordId;

  if (!geminiApiKey) {
    return {
      record_kind: recordKind,
      record_id: recordId,
      record_name: recordName,
      outcome: "error",
      detail: "GEMINI_API_KEY not configured",
      llm_calls_made: 0,
      web_searches_made: 0,
    };
  }

  let llmCalls = 0;
  let webSearches = 0;

  try {
    const query = recordKind === "discovered_contact"
      ? buildContactQuery(row as Record<string, unknown>)
      : buildOrganizationQuery(row as Record<string, unknown>);

    const search = await searchWeb(query, supabase);
    webSearches += 1;

    if (search.quota_exhausted) {
      // Reset to queued so a future run can retry.
      await supabase
        .from(tableName)
        .update({ verification_status: "queued", verification_run_id: null })
        .eq("id", recordId);
      return {
        record_kind: recordKind,
        record_id: recordId,
        record_name: recordName,
        outcome: "skipped_quota",
        detail: "web search quota exhausted",
        llm_calls_made: llmCalls,
        web_searches_made: webSearches,
      };
    }

    const seedJson = JSON.stringify({
      name: safeStr((row as Record<string, unknown>).name),
      seed_role: recordKind === "discovered_contact"
        ? safeStr((row as Record<string, unknown>).current_position)
        : safeStr((row as Record<string, unknown>).description),
      seed_location: recordKind === "discovered_contact"
        ? [
          safeStr((row as Record<string, unknown>).location_city),
          safeStr((row as Record<string, unknown>).location_state),
          safeStr((row as Record<string, unknown>).current_location_country),
        ].filter(Boolean).join(", ")
        : "",
      seed_flemish: recordKind === "discovered_contact"
        ? safeStr((row as Record<string, unknown>).flemish_connection)
        : safeStr((row as Record<string, unknown>).flemish_belgian_relevance),
      seed_website: safeStr((row as Record<string, unknown>).website_url),
      seed_linkedin: recordKind === "discovered_contact"
        ? safeStr((row as Record<string, unknown>).linkedin_url)
        : "",
      source_urls: Array.isArray((row as Record<string, unknown>).source_urls)
        ? (row as Record<string, unknown>).source_urls
        : [],
    });

    const userPrompt = `Candidate seed data:\n${seedJson}\n\nWeb search results for "${query}":\n${formatResultsForLLM(search.results)}\n\nReturn the verification payload as JSON.`;

    const { data } = await callGeminiStructured<unknown>({
      apiKey: geminiApiKey,
      route: "profile_verification",
      systemPrompt: recordKind === "discovered_contact"
        ? VERIFICATION_PROMPT_CONTACT
        : VERIFICATION_PROMPT_ORGANIZATION,
      userPrompt,
      schema: VERIFICATION_SCHEMA,
      parse: (value) => value,
      temperature: 0.2,
      emptyResponseFallback: {},
    });
    llmCalls += 1;

    const payload = normalizePayload(data);

    if (payload.contradiction) {
      await supabase.from(tableName).delete().eq("id", recordId);
      return {
        record_kind: recordKind,
        record_id: recordId,
        record_name: recordName,
        outcome: "deleted_contradiction",
        detail: payload.contradiction_reason ?? "contradiction",
        llm_calls_made: llmCalls,
        web_searches_made: webSearches,
      };
    }

    const update: Record<string, unknown> = {
      verification_status: "verified",
      verified_at: new Date().toISOString(),
      verification_payload: payload as unknown as Record<string, unknown>,
      verification_run_id: runId ?? null,
    };

    if (payload.network_scope) {
      update.suggested_us_network_status = recordKind === "discovered_contact"
        ? payload.network_scope
        : payload.network_scope === "us_based"
          ? "us_based_organization"
          : "belgian_organization_with_us_presence";
    }

    if (recordKind === "discovered_contact") {
      if (payload.location_city) update.current_location_city = payload.location_city;
      if (payload.location_country) update.current_location_country = payload.location_country;
    }

    await supabase.from(tableName).update(update).eq("id", recordId);

    return {
      record_kind: recordKind,
      record_id: recordId,
      record_name: recordName,
      outcome: "verified",
      detail: payload.network_scope
        ? `scope=${payload.network_scope} confidence=${payload.confidence.toFixed(2)}`
        : `scope=null confidence=${payload.confidence.toFixed(2)}`,
      llm_calls_made: llmCalls,
      web_searches_made: webSearches,
    };
  } catch (error) {
    // Reset to queued so the scheduler can retry.
    await supabase
      .from(tableName)
      .update({ verification_status: "queued", verification_run_id: null })
      .eq("id", recordId);
    return {
      record_kind: recordKind,
      record_id: recordId,
      record_name: recordName,
      outcome: "error",
      detail: error instanceof Error ? error.message : String(error),
      llm_calls_made: llmCalls,
      web_searches_made: webSearches,
    };
  }
}
