import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  getAiAgentTasks,
  getAiAgentTaskDefinition,
  isAiAgentTask,
} from "../_shared/aiContracts.ts";
import {
  createAdminClient,
  HttpError,
  requireStaffRole,
} from "../_shared/auth.ts";
import { structuredErrorBody, statusForError, wrapHandler } from "../_shared/httpError.ts";
import { callGeminiStructured } from "../_shared/gemini.ts";
import { createTimer } from "../_shared/log.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, apikey, x-client-info",
};

Deno.serve(wrapHandler(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const timer = createTimer("ai-agent", "ai-agent");
  try {
    const supabase = createAdminClient();
    await timer.span("auth", () => requireStaffRole(req, supabase, "viewer"));

    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) {
      throw new HttpError(
        500,
        "GEMINI_API_KEY is not configured.",
        {
          code: "agent_failure",
          hint: "Set GEMINI_API_KEY in edge function secrets.",
        },
      );
    }

    const body = await req.json();
    const task = String(body.task || "");
    const context: Record<string, unknown> = body.context || {};

    if (!task || !isAiAgentTask(task)) {
      throw new HttpError(
        400,
        `Unknown task: ${task}. Valid tasks: ${getAiAgentTasks().join(", ")}`,
        { code: "invalid_input" },
      );
    }

    const definition = getAiAgentTaskDefinition(task);
    const userPrompt = definition.buildUserPrompt(context);
    const { data: result, modelUsed } = await timer.span(
      `gemini_${task}`,
      () => callGeminiStructured({
        apiKey,
        route: definition.modelRoute,
        systemPrompt: definition.systemPrompt,
        userPrompt,
        schema: definition.schema,
        parse: definition.normalizeResult,
        attemptsPerModel: 2,
      }),
      { route: definition.modelRoute, task },
    );

    return new Response(
      JSON.stringify({
        success: true,
        data: result,
        meta: {
          task_status: definition.status,
          model_used: modelUsed,
        },
        _timing: (timer.flush({ task }), timer.summary({ task })),
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    const body = structuredErrorBody(err);
    return new Response(
      JSON.stringify({ success: false, ...body }),
      {
        status: statusForError(err),
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
}));
