import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, HttpError, requireStaffRole } from "../_shared/auth.ts";
import { structuredErrorBody, statusForError, wrapHandler } from "../_shared/httpError.ts";
import type { SupabaseAdminClient } from "../_shared/database.types.ts";
import { createLogger } from "../_shared/log.ts";

const log = createLogger("eval-holdout-check");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, apikey, x-client-info",
};

const DEFAULT_LOOKBACK_DAYS = 30;

interface HoldoutRow {
  id: string;
  full_name: string;
  known_aliases: string[] | null;
}

interface CandidateRow {
  id: string;
  name: string;
  agent_run_id: string | null;
  last_seen_at: string | null;
  created_at: string | null;
}

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function nameMatches(holdout: HoldoutRow, candidateName: string): boolean {
  const norm = normalizeName(candidateName);
  if (!norm) return false;
  const targets = [holdout.full_name, ...(holdout.known_aliases || [])]
    .map(normalizeName)
    .filter((s) => s.length > 0);
  return targets.some((target) => norm === target);
}

async function isAuthorizedServiceCall(req: Request): Promise<boolean> {
  const authHeader = req.headers.get("Authorization") ||
    req.headers.get("authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return false;
  const token = authHeader.slice("Bearer ".length).trim();
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  return !!serviceKey && token === serviceKey;
}

async function runHoldoutCheck(
  supabase: SupabaseAdminClient,
  lookbackDays: number,
): Promise<{
  holdout_count: number;
  matched_count: number;
  unchanged_count: number;
  lookback_days: number;
}> {
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();

  const { data: holdout, error: holdoutError } = await supabase
    .from("discovery_eval_holdout")
    .select("id, full_name, known_aliases");
  if (holdoutError) {
    throw new HttpError(500, `Failed to load holdout: ${holdoutError.message}`);
  }

  const holdoutRows: HoldoutRow[] = holdout || [];

  const { data: candidates, error: candidateError } = await supabase
    .from("discovered_contacts")
    .select("id, name, agent_run_id, last_seen_at, created_at")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(5000);
  if (candidateError) {
    throw new HttpError(500, `Failed to load candidates: ${candidateError.message}`);
  }

  const candidateRows: CandidateRow[] = (candidates || []) as CandidateRow[];

  let matched = 0;
  let unchanged = 0;
  for (const row of holdoutRows) {
    const hit = candidateRows.find((candidate) => nameMatches(row, candidate.name));
    if (!hit) {
      unchanged += 1;
      continue;
    }
    const seenAt = hit.last_seen_at || hit.created_at || new Date().toISOString();
    const { error: updateError } = await supabase
      .from("discovery_eval_holdout")
      .update({
        last_seen_as_candidate_at: seenAt,
        last_seen_candidate_id: hit.id,
        last_seen_run_id: hit.agent_run_id,
      })
      .eq("id", row.id);
    if (updateError) {
      log.warn("holdout_update_failed", { id: row.id, error: updateError.message });
      continue;
    }
    matched += 1;
  }

  return {
    holdout_count: holdoutRows.length,
    matched_count: matched,
    unchanged_count: unchanged,
    lookback_days: lookbackDays,
  };
}

Deno.serve(wrapHandler(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabase = createAdminClient();

    const isService = await isAuthorizedServiceCall(req);
    if (!isService) {
      await requireStaffRole(req, supabase, "editor");
    }

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const lookbackDays = Math.max(
      1,
      Math.min(180, Number(body.lookback_days || DEFAULT_LOOKBACK_DAYS)),
    );

    const result = await runHoldoutCheck(supabase, lookbackDays);

    return new Response(JSON.stringify({ status: "ok", ...result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    log.warn("eval_holdout_check_failed", error);
    return new Response(JSON.stringify(structuredErrorBody(error)), {
      status: statusForError(error),
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}));
