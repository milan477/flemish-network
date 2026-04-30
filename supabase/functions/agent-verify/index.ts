import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  createAdminClient,
  requireStaffRole,
} from "../_shared/auth.ts";
import { agentRunErrorKindFor, structuredErrorBody, statusForError, wrapHandler } from "../_shared/httpError.ts";
import type { SupabaseAdminClient } from "../_shared/database.types.ts";
import {
  buildVerificationDerivedLabels,
  upsertDerivedLabelSuggestions,
} from "../_shared/derivedLabels.ts";
import { getPrimaryGeminiModel } from "../_shared/gemini.ts";
import {
  fetchVerificationCandidates,
  getVerificationApifyAvailability,
  insertVerificationSuggestions,
  markPersonVerified,
  runVerificationForPerson,
  type VerificationStep,
} from "../_shared/verification.ts";
import { createLogger } from "../_shared/log.ts";

const log = createLogger("agent-verify");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, apikey, x-client-info",
};

const DEFAULT_BATCH_SIZE = 5;
const DEFAULT_MAX_AGE_MONTHS = 6;
const DEADLINE_MS = 55_000;

function safeStr(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function mergeProvider(currentProvider: string, nextProvider: string): string {
  if (!nextProvider || nextProvider === "none") return currentProvider;
  if (!currentProvider) return nextProvider;
  if (currentProvider === nextProvider) return currentProvider;
  return "mixed";
}

function mergeModel(currentModel: string, nextModel: string | null): string {
  const normalized = safeStr(nextModel);
  if (!normalized) return currentModel;
  if (!currentModel) return normalized;
  if (currentModel === normalized) return currentModel;
  return "mixed";
}

async function heartbeat(
  supabase: SupabaseAdminClient,
  runId?: string,
): Promise<void> {
  if (!runId) return;
  await supabase
    .from("agent_runs")
    .update({ heartbeat_at: new Date().toISOString() })
    .eq("id", runId);
}

function buildStep(
  person: {
    id: string;
    name: string;
    priority?: {
      priority_score: number;
      reasons: string[];
    };
  },
  status: VerificationStep["status"],
  path: VerificationStep["path"],
  detail?: string,
): VerificationStep {
  return {
    person_id: person.id,
    person_name: safeStr(person.name) || person.id,
    path,
    status,
    detail,
    priority_score: person.priority?.priority_score,
    priority_reasons: person.priority?.reasons,
  };
}

function getSuggestedValue(
  suggestions: Array<{
    field_name: string;
    suggested_value: string;
  }>,
  fieldName: string,
  fallback: string,
): string {
  return suggestions.find((suggestion) => suggestion.field_name === fieldName)?.suggested_value || fallback;
}

function getPrimaryEvidence(
  suggestions: Array<{
    evidence_url: string;
    evidence_excerpt: string;
    confidence: number;
    method: string;
  }>,
): {
  evidenceUrl: string;
  evidenceExcerpt: string;
  confidence: number;
  method: string | null;
} {
  const preferred = suggestions.find((suggestion) =>
    Boolean(suggestion.evidence_url || suggestion.evidence_excerpt)
  ) || suggestions[0];

  return {
    evidenceUrl: preferred?.evidence_url || "",
    evidenceExcerpt: preferred?.evidence_excerpt || "",
    confidence: Number(preferred?.confidence || 0),
    method: preferred?.method || null,
  };
}

Deno.serve(wrapHandler(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  let supabase: SupabaseAdminClient | null = null;
  let runId: string | undefined;
  let llmCallsMade = 0;
  let webSearchesMade = 0;
  let linkedinScrapesMade = 0;
  let webSearchProvider = "";
  let llmModelUsed = "";

  try {
    const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
    supabase = createAdminClient();
    await requireStaffRole(req, supabase, "editor");

    const body = await req.json().catch(() => ({}));
    const batchSizeRaw = Number(body.batch_size ?? DEFAULT_BATCH_SIZE);
    const maxAgeMonthsRaw = Number(body.max_age_months ?? DEFAULT_MAX_AGE_MONTHS);

    if (!Number.isFinite(batchSizeRaw) || batchSizeRaw < 1) {
      return new Response(
        JSON.stringify({ error: "batch_size must be a positive number" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    if (!Number.isFinite(maxAgeMonthsRaw) || maxAgeMonthsRaw < 0) {
      return new Response(
        JSON.stringify({ error: "max_age_months must be 0 or greater" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const batchSize = Math.min(Math.floor(batchSizeRaw), DEFAULT_BATCH_SIZE);
    const maxAgeMonths = Math.floor(maxAgeMonthsRaw);
    runId = safeStr(body.run_id) || undefined;
    const personIds = Array.isArray(body.person_ids)
      ? body.person_ids.map((value: unknown) => safeStr(value)).filter(Boolean)
      : safeStr(body.person_id)
        ? [safeStr(body.person_id)]
        : undefined;

    const startTime = Date.now();
    const timeLeft = () => DEADLINE_MS - (Date.now() - startTime);

    const candidates = await fetchVerificationCandidates(
      supabase,
      batchSize,
      maxAgeMonths,
      personIds,
    );
    let apifyAvailable = await getVerificationApifyAvailability();
    let quotaExhausted = false;
    let profilesChecked = 0;
    let profilesVerified = 0;
    let suggestionsCreated = 0;
    let suggestionsUpdated = 0;
    let duplicatesSkipped = 0;
    let derivedLabelsUpserted = 0;
    let skippedNoResults = 0;
    const errors: string[] = [];
    const warnings: string[] = [];
    const steps: VerificationStep[] = [];

    for (const person of candidates) {
      if (timeLeft() < 5_000) {
        errors.push("Stopped early to avoid edge function timeout");
        break;
      }

      await heartbeat(supabase, runId);
      profilesChecked += 1;

      try {
        const result = await runVerificationForPerson(supabase, person, {
          geminiApiKey,
          apifyAvailable,
        });

        apifyAvailable = result.apify_available_after;
        llmCallsMade += result.llm_calls_made;
        linkedinScrapesMade += result.linkedin_scrapes_made;
        webSearchesMade += result.web_searches_made;
        webSearchProvider = mergeProvider(webSearchProvider, result.web_search_provider);
        llmModelUsed = mergeModel(llmModelUsed, result.llm_model_used);

        if (result.warnings.length > 0) {
          warnings.push(
            ...result.warnings.map((warning) => `${person.name}: ${warning}`),
          );
        }

        if (result.status === "quota_exhausted") {
          quotaExhausted = true;
          steps.push(buildStep(person, result.status, result.path, result.detail));
          break;
        }

        if (result.status === "suggestions") {
          const insertResult = await insertVerificationSuggestions(
            supabase,
            person.id,
            result.suggestions,
            { agentRunId: runId },
          );
          suggestionsCreated += insertResult.inserted;
          suggestionsUpdated += insertResult.updated;
          duplicatesSkipped += insertResult.duplicatesSkipped;
          const evidence = getPrimaryEvidence(result.suggestions);
          derivedLabelsUpserted += await upsertDerivedLabelSuggestions(
            supabase,
            await buildVerificationDerivedLabels(supabase, {
              personId: person.id,
              agentRunId: runId || null,
              source: result.path === "linkedin" ? "LinkedIn verification" : "Web verification",
              currentPosition: getSuggestedValue(
                result.suggestions,
                "current_position",
                safeStr(person.current_position),
              ),
              occupation: getSuggestedValue(
                result.suggestions,
                "occupation",
                safeStr(person.occupation),
              ),
              bio: getSuggestedValue(
                result.suggestions,
                "bio",
                safeStr(person.bio),
              ),
              locationCity: getSuggestedValue(
                result.suggestions,
                "location_city",
                safeStr(person.locations?.city),
              ),
              locationState: getSuggestedValue(
                result.suggestions,
                "location_state",
                safeStr(person.locations?.state),
              ),
              rawLocationText:
                result.suggestions.find((suggestion) =>
                  suggestion.field_name === "location_city" ||
                  suggestion.field_name === "location_state"
                )?.evidence_excerpt ||
                [person.locations?.city, person.locations?.state].filter(Boolean).join(", "),
              flemishTexts: [safeStr(person.bio), safeStr(person.current_position)],
              evidenceUrl: evidence.evidenceUrl,
              evidenceExcerpt: evidence.evidenceExcerpt,
              method: evidence.method,
              suggestionConfidence: evidence.confidence,
            }),
          );
          steps.push(buildStep(person, result.status, result.path, result.detail));
          continue;
        }

        if (result.status === "verified") {
          await markPersonVerified(supabase, person.id);
          profilesVerified += 1;
          derivedLabelsUpserted += await upsertDerivedLabelSuggestions(
            supabase,
            await buildVerificationDerivedLabels(supabase, {
              personId: person.id,
              agentRunId: runId || null,
              source: result.path === "linkedin" ? "LinkedIn verification" : "Web verification",
              currentPosition: safeStr(person.current_position),
              occupation: safeStr(person.occupation),
              bio: safeStr(person.bio),
              locationCity: safeStr(person.locations?.city),
              locationState: safeStr(person.locations?.state),
              rawLocationText: [person.locations?.city, person.locations?.state].filter(Boolean).join(", "),
              flemishTexts: [safeStr(person.bio), safeStr(person.current_position)],
              evidenceUrl: "",
              evidenceExcerpt: "",
              method: result.path === "linkedin" ? "linkedin_scrape" : "web_search_llm",
              suggestionConfidence: result.path === "linkedin" ? 0.92 : 0.76,
            }),
          );
          steps.push(buildStep(person, result.status, result.path, result.detail));
          continue;
        }

        if (result.status === "no_results") {
          skippedNoResults += 1;
          steps.push(buildStep(person, result.status, result.path, result.detail));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";
        errors.push(`${person.name}: verification failed (${message})`);
        steps.push(buildStep(person, "error", "web_search", message));
      }
    }

    const result = {
      profiles_checked: profilesChecked,
      suggestions_created: suggestionsCreated,
      suggestions_updated: suggestionsUpdated,
      profiles_verified: profilesVerified,
      skipped_no_results: skippedNoResults,
      duplicates_skipped: duplicatesSkipped,
      derived_labels_upserted: derivedLabelsUpserted,
      quota_exhausted: quotaExhausted,
      llm_calls_made: llmCallsMade,
      linkedin_scrapes_made: linkedinScrapesMade,
      web_searches_made: webSearchesMade,
      web_search_provider: webSearchProvider || "none",
      llm_model_used:
        llmCallsMade > 0
          ? llmModelUsed || getPrimaryGeminiModel("profile_verification")
          : null,
      candidate_priorities: candidates.map((candidate) => ({
        person_id: candidate.id,
        person_name: candidate.name,
        priority_score: candidate.priority?.priority_score ?? null,
        reasons: candidate.priority?.reasons ?? [],
      })),
      warnings: warnings.length > 0 ? warnings : undefined,
      errors: errors.length > 0 ? errors : undefined,
      steps,
    };

    if (runId && supabase) {
      const costEstimate =
        llmCallsMade * 0.001 + linkedinScrapesMade * 0.003 + webSearchesMade * 0.0005;
      await supabase
        .from("agent_runs")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          results: result,
          llm_calls_made: llmCallsMade,
          llm_model_used:
            llmCallsMade > 0
              ? llmModelUsed || getPrimaryGeminiModel("profile_verification")
              : null,
          web_searches_made: webSearchesMade,
          web_search_provider: webSearchProvider || "none",
          cost_estimate_usd: Math.round(costEstimate * 10000) / 10000,
        })
        .eq("id", runId);
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    if (runId && supabase) {
      const { error: updateError } = await supabase
        .from("agent_runs")
        .update({
          status: "failed",
          completed_at: new Date().toISOString(),
          error_message: error instanceof Error ? error.message : "Unknown error",
          error_kind: agentRunErrorKindFor(error),
          llm_calls_made: llmCallsMade,
          llm_model_used:
            llmCallsMade > 0
              ? llmModelUsed || getPrimaryGeminiModel("profile_verification")
              : null,
          web_searches_made: webSearchesMade,
          web_search_provider: webSearchProvider || "none",
        })
        .eq("id", runId);

      if (updateError) {
        log.withRun(runId).error("persist_run_failure_failed", {
          runId,
          message: updateError.message,
        });
      }
    }

    return new Response(
      JSON.stringify({
        ...structuredErrorBody(error),
        llm_calls_made: llmCallsMade,
        linkedin_scrapes_made: linkedinScrapesMade,
        web_searches_made: webSearchesMade,
      }),
      {
        status: statusForError(error),
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
}));
