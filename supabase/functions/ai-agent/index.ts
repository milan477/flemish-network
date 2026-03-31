import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  getAiAgentTasks,
  getAiAgentTaskDefinition,
  isAiAgentTask,
} from "../_shared/aiContracts.ts";
import { callGeminiStructured } from "../_shared/gemini.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, apikey, x-client-info",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "GEMINI_API_KEY is not configured. Add it as an edge function secret.",
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const body = await req.json();
    const task = String(body.task || "");
    const context: Record<string, unknown> = body.context || {};

    if (!task || !isAiAgentTask(task)) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Unknown task: ${task}. Valid tasks: ${getAiAgentTasks().join(", ")}`,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const definition = getAiAgentTaskDefinition(task);
    const userPrompt = definition.buildUserPrompt(context);
    const { data: result, modelUsed } = await callGeminiStructured({
      apiKey,
      route: definition.modelRoute,
      systemPrompt: definition.systemPrompt,
      userPrompt,
      schema: definition.schema,
      parse: definition.normalizeResult,
      attemptsPerModel: 2,
    });

    return new Response(
      JSON.stringify({
        success: true,
        data: result,
        meta: {
          task_status: definition.status,
          model_used: modelUsed,
        },
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        success: false,
        error: (err as Error).message || "Internal error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
