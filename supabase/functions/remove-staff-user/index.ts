import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  createAdminClient,
  HttpError,
  requireStaffRole,
} from "../_shared/auth.ts";
import { jsonError, wrapHandler } from "../_shared/httpError.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, apikey, x-client-info",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

Deno.serve(wrapHandler(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonError(405, "invalid_input", "POST is required");
  }

  const supabase = createAdminClient();
  const { staffUser: caller } = await requireStaffRole(req, supabase, "admin");

  const body = await req.json().catch(() => ({}));
  const staffUserId = typeof body?.staff_user_id === "string"
    ? body.staff_user_id.trim()
    : "";

  if (!staffUserId) {
    return jsonError(400, "invalid_input", "staff_user_id is required");
  }

  if (staffUserId === caller.id) {
    throw new HttpError(400, "You cannot remove your own access", {
      code: "invalid_input",
    });
  }

  const { data: existing, error: lookupError } = await supabase
    .from("staff_users")
    .select("id, user_id, email")
    .eq("id", staffUserId)
    .maybeSingle();

  if (lookupError) {
    throw new HttpError(500, lookupError.message);
  }

  if (!existing) {
    throw new HttpError(404, "Staff user not found", { code: "not_found" });
  }

  const { error: deleteError } = await supabase
    .from("staff_users")
    .delete()
    .eq("id", staffUserId);

  if (deleteError) {
    throw new HttpError(500, deleteError.message);
  }

  if (existing.user_id) {
    const { error: authDeleteError } = await supabase.auth.admin.deleteUser(
      existing.user_id,
    );
    if (authDeleteError && !/not.?found/i.test(authDeleteError.message)) {
      throw new HttpError(500, authDeleteError.message);
    }
  }

  return jsonResponse({
    removed_staff_user_id: staffUserId,
    removed_auth_user_id: existing.user_id,
    email: existing.email,
  });
}));
