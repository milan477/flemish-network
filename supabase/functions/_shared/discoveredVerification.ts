// Verify-before-promote: enrich `discovered_contacts` and `discovered_organizations`
// rows in place. The Verification page only exposes Approve/Reject once a row has
// transitioned to verification_status='verified'. Contradictions are hard-deleted.

import type { JsonSchema } from "./aiContracts.ts";
import { callGeminiStructured } from "./gemini.ts";
import type { SupabaseAdminClient } from "./database.types.ts";
import { resolveVerifiedUsLocation } from "./locationPipeline.ts";
import {
  formatResultsForLLM,
  searchWeb,
  type WebSearchResult,
} from "./webSearch.ts";

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
  profile_photo_url: string | null;
  profile_links: Array<{
    type: "linkedin" | "website";
    url: string;
    label: string | null;
    evidence_url: string;
    evidence_excerpt: string;
  }>;
  professional_sectors: string[];
  belgian_identity_confirmed: boolean;
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
- What is their current residence, current employer, current role, and current professional sector?
- Is there an exact, direct profile-photo URL for this person in the supplied results?
- What is the exact LinkedIn profile URL for this person, if found?
- What other official professional or personal websites belong to this person (personal site, portfolio, employer biography, faculty/staff profile, or recognized professional directory)?

Current-fact rules:
- Treat scholarship, degree, and study-location facts as historical evidence only. Do not use them as the current role, employer, residence, or professional sector.
- Use null or an empty array when a current fact is not supported. Do not infer a current residence from a former university.
- professional_sectors may contain only: Artificial Intelligence, Biotechnology, Finance, Culture & Arts, Education, Research.
- Assign Education only when current professional work is in education, not merely because the person studied at a university.
- profile_photo_url must be an exact absolute image URL present in the supplied search results and must depict this exact person. Never use a logo, icon, placeholder, or inferred URL; otherwise use null.
- profile_links may contain LinkedIn plus other professional/personal websites. Every URL must be an exact result URL for this exact person. Do not construct or guess URLs. Do not include search-result pages, generic organization homepages, or unrelated people. Set evidence_url to the result that proves the link and retain a short excerpt.
- A Fayat award is one connection: "Fayat Scholarship". Do not add "Fayatbeurzen", "Fayat Scholarships", or "Flemish Government" as separate connections.
- Set belgian_identity_confirmed=true only when a source explicitly identifies the person as Belgian, a Belgian national, or from Belgium. A Fayat award, Belgian institution, name, or Flemish programme alone is not proof of nationality or origin.

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

// Gemini's response_schema is an OpenAPI subset: a nullable field is
// `{ type: "string", nullable: true }`. A JSON-Schema style `type: ["string",
// "null"]` is rejected with HTTP 400 ("Proto field is not repeating"), which
// silently failed every verify-before-promote call until 2026-09-14.
export const VERIFICATION_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    network_scope: { type: "string", enum: ["us_based", "us_connected_abroad"], nullable: true },
    location_city: { type: "string", nullable: true },
    location_state: { type: "string", nullable: true },
    location_country: { type: "string", nullable: true },
    current_role: { type: "string", nullable: true },
    current_employer: { type: "string", nullable: true },
    profile_photo_url: { type: "string", nullable: true },
    profile_links: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["linkedin", "website"] },
          url: { type: "string" },
          label: { type: "string", nullable: true },
          evidence_url: { type: "string" },
          evidence_excerpt: { type: "string" },
        },
        required: ["type", "url", "evidence_url", "evidence_excerpt"],
      },
    },
    professional_sectors: {
      type: "array",
      items: {
        type: "string",
        enum: [
          "Artificial Intelligence",
          "Biotechnology",
          "Finance",
          "Culture & Arts",
          "Education",
          "Research",
        ],
      },
    },
    belgian_identity_confirmed: { type: "boolean" },
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
    contradiction_reason: { type: "string", nullable: true },
    notes: { type: "string", nullable: true },
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

const PROFESSIONAL_SECTORS = new Set([
  "Artificial Intelligence",
  "Biotechnology",
  "Finance",
  "Culture & Arts",
  "Education",
  "Research",
]);

function normalizeHttpUrl(value: unknown): string | null {
  const candidate = safeStr(value);
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (/\b(logo|icon|placeholder|default-avatar|favicon)\b/i.test(parsed.href)) {
      return null;
    }
    return parsed.href;
  } catch {
    return null;
  }
}

export function normalizePayload(raw: unknown): VerificationPayload {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const scope = r.network_scope;
  const validScope = scope === "us_based" || scope === "us_connected_abroad" ? scope : null;
  const evidenceRaw = Array.isArray(r.evidence) ? r.evidence : [];
  const flemishTiesRaw = Array.isArray(r.flemish_ties) ? r.flemish_ties : [];
  const sectorRaw = Array.isArray(r.professional_sectors)
    ? r.professional_sectors
    : [];
  const profileLinksRaw = Array.isArray(r.profile_links) ? r.profile_links : [];
  return {
    network_scope: validScope,
    location_city: safeStr(r.location_city) || null,
    location_state: safeStr(r.location_state) || null,
    location_country: safeStr(r.location_country) || null,
    current_role: safeStr(r.current_role) || null,
    current_employer: safeStr(r.current_employer) || null,
    profile_photo_url: normalizeHttpUrl(r.profile_photo_url),
    profile_links: profileLinksRaw
      .flatMap((item) => {
        const link = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
        const type: "linkedin" | "website" | null =
          link.type === "linkedin" || link.type === "website" ? link.type : null;
        const url = normalizeHttpUrl(link.url);
        const evidenceUrl = normalizeHttpUrl(link.evidence_url);
        if (!type || !url || !evidenceUrl) return [];
        if (type === "linkedin" && !/^(www\.)?linkedin\.com$/i.test(new URL(url).hostname)) return [];
        return [{
          type,
          url,
          label: safeStr(link.label) || null,
          evidence_url: evidenceUrl,
          evidence_excerpt: safeStr(link.evidence_excerpt),
        }];
      })
      .filter((item, index, items) =>
        items.findIndex((candidate) => candidate.type === item.type && candidate.url === item.url) === index
      )
      .slice(0, 8),
    professional_sectors: sectorRaw
      .map((value) => safeStr(value))
      .filter((value) => PROFESSIONAL_SECTORS.has(value)),
    belgian_identity_confirmed: r.belgian_identity_confirmed === true,
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

export async function validatePayloadLocation(
  supabase: SupabaseAdminClient,
  payload: VerificationPayload,
): Promise<VerificationPayload> {
  if (payload.network_scope !== "us_based") return payload;

  if (payload.confidence < 0.85) {
    return {
      ...payload,
      location_city: null,
      location_state: null,
      location_country: null,
    };
  }

  const match = await resolveVerifiedUsLocation(
    supabase,
    payload.location_city || "",
    payload.location_state || "",
    payload.location_country || "",
  );

  return {
    ...payload,
    location_city: match?.city || null,
    location_state: match?.state || null,
    location_country: match ? "United States" : null,
  };
}

export function buildContactQuery(row: Record<string, unknown>): string {
  const parts: string[] = [`"${safeStr(row.name)}"`];
  const identityContext = safeStr(row.flemish_connection);
  if (identityContext) parts.push(identityContext);
  parts.push(
    "current residence",
    "current employer",
    "current role",
    "professional sector",
    "profile photo",
    "official website",
  );
  return parts.join(" ").slice(0, 240);
}

export function buildContactQueries(row: Record<string, unknown>): string[] {
  const name = safeStr(row.name);
  const identityContext = safeStr(row.flemish_connection);
  const context = identityContext ? ` ${identityContext}` : "";
  return [
    buildContactQuery(row),
    `"${name}"${context} site:linkedin.com/in`,
    `"${name}"${context} (official website OR portfolio OR professional profile OR biography) -site:linkedin.com`,
  ].map((query) => query.slice(0, 240));
}

function verifiedPhotoUrl(
  candidate: string | null,
  results: WebSearchResult[],
): string | null {
  if (!candidate) return null;
  const appearsInEvidence = results.some((result) =>
    result.url.includes(candidate) ||
    result.content.includes(candidate) ||
    (result.raw_content || "").includes(candidate)
  );
  return appearsInEvidence ? candidate : null;
}

function verifiedProfileLinks(
  links: VerificationPayload["profile_links"],
  results: WebSearchResult[],
): VerificationPayload["profile_links"] {
  const resultUrls = new Set(results.map((result) => result.url.replace(/\/$/, "")));
  return links.filter((link) => {
    const normalizedUrl = link.url.replace(/\/$/, "");
    const normalizedEvidenceUrl = link.evidence_url.replace(/\/$/, "");
    return resultUrls.has(normalizedUrl) && resultUrls.has(normalizedEvidenceUrl);
  });
}

function currentPosition(payload: VerificationPayload): string | null {
  if (payload.current_role && payload.current_employer) {
    return `${payload.current_role} at ${payload.current_employer}`;
  }
  return payload.current_role || payload.current_employer;
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
    const queries = recordKind === "discovered_contact"
      ? buildContactQueries(row as Record<string, unknown>)
      : [buildOrganizationQuery(row as Record<string, unknown>)];

    const searchResponses = await Promise.all(
      queries.map((query) => searchWeb(query, supabase)),
    );
    webSearches += searchResponses.length;
    const searchResults = searchResponses
      .flatMap((response) => response.results)
      .filter((result, index, results) =>
        result.url && results.findIndex((candidate) => candidate.url === result.url) === index
      )
      .slice(0, 24);

    if (searchResponses.every((response) => response.quota_exhausted) && searchResults.length === 0) {
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
      seed_program_context: recordKind === "discovered_contact"
        ? safeStr((row as Record<string, unknown>).bio)
        : "",
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

    const userPrompt = `Candidate seed data:\n${seedJson}\n\nSearch queries used:\n${queries.map((query) => `- ${query}`).join("\n")}\n\nWeb search results:\n${formatResultsForLLM(searchResults)}\n\nReturn the verification payload as JSON.`;

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

    const payload = await validatePayloadLocation(supabase, normalizePayload(data));
    payload.profile_photo_url = verifiedPhotoUrl(
      payload.profile_photo_url,
      searchResults,
    );
    payload.profile_links = verifiedProfileLinks(payload.profile_links, searchResults);

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
    update.suggested_us_network_confidence = payload.confidence;

    if (recordKind === "discovered_contact") {
      const isOfficialFayat = safeStr(
        (row as Record<string, unknown>).source,
      ) === "official_fayat_directory";
      const position = currentPosition(payload);
      if (position) update.current_position = position;
      if (payload.current_role) update.occupation = payload.current_role;
      if (payload.profile_photo_url) {
        update.profile_photo_url = payload.profile_photo_url;
      }
      const linkedin = payload.profile_links.find((link) => link.type === "linkedin");
      const website = payload.profile_links.find((link) => link.type === "website");
      if (linkedin) update.linkedin_url = linkedin.url;
      if (website) update.website_url = website.url;
      if (payload.professional_sectors.length > 0) {
        update.sectors = payload.professional_sectors;
      }
      if (isOfficialFayat) {
        update.flemish_connection = payload.belgian_identity_confirmed
          ? "Fayat Scholarship, Belgian"
          : "Fayat Scholarship";
      }
      if (payload.network_scope === "us_based") {
        if (payload.location_city) update.location_city = payload.location_city;
        if (payload.location_state) update.location_state = payload.location_state;
      } else if (payload.network_scope === "us_connected_abroad") {
        if (payload.location_city) update.current_location_city = payload.location_city;
        if (payload.location_country) {
          update.current_location_country = payload.location_country;
        }
      }

      const existingSourceUrls = Array.isArray(
          (row as Record<string, unknown>).source_urls,
        )
        ? ((row as Record<string, unknown>).source_urls as unknown[])
          .map((value) => safeStr(value))
          .filter(Boolean)
        : [];
      const evidenceUrls = payload.evidence.map((item) => item.url).filter(Boolean);
      const profileLinkUrls = payload.profile_links.flatMap((link) => [link.url, link.evidence_url]);
      update.source_urls = [...new Set([...existingSourceUrls, ...evidenceUrls, ...profileLinkUrls])];
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
    // Keep the failure visible and let the user choose whether to retry it.
    await supabase
      .from(tableName)
      .update({ verification_status: "failed", verification_run_id: null })
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
