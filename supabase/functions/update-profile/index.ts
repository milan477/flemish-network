import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  createAdminClient,
  requireStaffRole,
} from "../_shared/auth.ts";
import { errorToResponse, jsonError, wrapHandler } from "../_shared/httpError.ts";
import {
  getVerificationApifyAvailability,
  loadVerificationPerson,
  runVerificationForPerson,
} from "../_shared/verification.ts";
import { createTimer } from "../_shared/log.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, apikey, x-client-info",
};

function safeStr(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

Deno.serve(wrapHandler(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const timer = createTimer("update-profile", "update-profile");
  try {
    const supabase = createAdminClient();
    await timer.span("auth", () => requireStaffRole(req, supabase, "editor"));

    const body = await req.json().catch(() => ({}));
    const personId = safeStr(body.personId);

    if (!personId) {
      return jsonError(400, "invalid_input", "personId is required");
    }

    const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
    const person = await timer.span("load_person", () => loadVerificationPerson(supabase, personId));

    if (!person) {
      return jsonError(404, "not_found", "Person not found");
    }

    const apifyAvailable = await timer.span("check_apify_available", () => getVerificationApifyAvailability());
    const result = await timer.span("run_verification_person", () =>
      runVerificationForPerson(supabase, person, { geminiApiKey, apifyAvailable })
    );

    return new Response(
      JSON.stringify({
        personId: person.id,
        personName: person.name,
        suggestionsCount: result.suggestions.length,
        suggestions: result.suggestions,
        status: result.status,
        path: result.path,
        detail: result.detail,
        warnings: result.warnings,
        web_search_provider: result.web_search_provider,
        llm_model_used: result.llm_model_used,
        _timing: (timer.flush(), timer.summary()),
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    return errorToResponse(error);
  }
}));
