import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  createAdminClient,
  HttpError,
  requireStaffRole,
  type StaffRole,
} from "../_shared/auth.ts";
import { jsonError, wrapHandler } from "../_shared/httpError.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, apikey, x-client-info",
};

const ROLE_OPTIONS = new Set<StaffRole>(["viewer", "editor", "admin"]);

function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeRole(value: unknown): StaffRole {
  return typeof value === "string" && ROLE_OPTIONS.has(value as StaffRole)
    ? value as StaffRole
    : "viewer";
}

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
  await requireStaffRole(req, supabase, "admin");

  const body = await req.json();
  const email = normalizeEmail(body?.email);
  const fullName = normalizeName(body?.full_name);
  const role = normalizeRole(body?.role);
  const redirectTo = typeof body?.redirect_to === "string"
    ? body.redirect_to
    : undefined;

  if (!email || !email.includes("@")) {
    return jsonError(400, "invalid_input", "A valid email is required");
  }

  const { data: existingStaff, error: existingError } = await supabase
    .from("staff_users")
    .select("id, email, status")
    .eq("email", email)
    .maybeSingle();

  if (existingError) {
    throw new HttpError(500, existingError.message);
  }

  if (existingStaff?.status === "active") {
    throw new HttpError(409, "This staff account is already active", {
      code: "invalid_input",
    });
  }

  if (existingStaff?.status === "disabled") {
    throw new HttpError(409, "This staff account is disabled", {
      code: "forbidden",
    });
  }

  const staffPayload = {
    email,
    full_name: fullName,
    role,
    status: "invited",
    password_reset_required: true,
  };

  const staffWrite = existingStaff
    ? await supabase
      .from("staff_users")
      .update(staffPayload)
      .eq("id", existingStaff.id)
      .select("id")
      .single()
    : await supabase
      .from("staff_users")
      .insert(staffPayload)
      .select("id")
      .single();

  if (staffWrite.error) {
    throw new HttpError(500, staffWrite.error.message);
  }

  const { data: inviteData, error: inviteError } = await supabase.auth.admin
    .inviteUserByEmail(email, {
      data: fullName ? { full_name: fullName } : undefined,
      redirectTo,
    });

  if (inviteError) {
    throw new HttpError(500, inviteError.message);
  }

  return jsonResponse({
    staff_user_id: staffWrite.data.id,
    auth_user_id: inviteData.user?.id || null,
  });
}));
