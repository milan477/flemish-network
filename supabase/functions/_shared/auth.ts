import { createClient, type User } from "npm:@supabase/supabase-js@2";
import type { Database, SupabaseAdminClient } from "./database.types.ts";

export type StaffRole = "viewer" | "editor" | "admin";

export interface StaffUserContext {
  id: string;
  user_id: string | null;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  role: StaffRole;
  status: string;
}

export type HttpErrorCode =
  | "auth_failed"
  | "forbidden"
  | "invalid_input"
  | "not_found"
  | "quota_exhausted"
  | "network"
  | "db_timeout"
  | "agent_failure"
  | "unknown";

export class HttpError extends Error {
  status: number;
  code: HttpErrorCode;
  hint?: string;

  constructor(
    status: number,
    message: string,
    options?: { code?: HttpErrorCode; hint?: string },
  ) {
    super(message);
    this.status = status;
    this.code = options?.code || defaultCodeForStatus(status);
    this.hint = options?.hint;
  }
}

function defaultCodeForStatus(status: number): HttpErrorCode {
  if (status === 401) return "auth_failed";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 400 || status === 422) return "invalid_input";
  if (status === 429) return "quota_exhausted";
  if (status === 504 || status === 408) return "db_timeout";
  if (status >= 500) return "agent_failure";
  return "unknown";
}

const ROLE_RANK: Record<StaffRole, number> = {
  viewer: 1,
  editor: 2,
  admin: 3,
};

function normalizeEmail(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
}

function getUserDisplayName(user: User): string | null {
  const metadata = user.user_metadata || {};
  const fullName = typeof metadata.full_name === "string"
    ? metadata.full_name.trim()
    : "";
  const name = typeof metadata.name === "string" ? metadata.name.trim() : "";
  return fullName || name || null;
}

export function createAdminClient(): SupabaseAdminClient {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceKey) {
    throw new HttpError(
      500,
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    );
  }

  return createClient<Database>(supabaseUrl, serviceKey);
}

export async function requireStaffRole(
  req: Request,
  supabase: SupabaseAdminClient,
  minimumRole: StaffRole = "viewer",
): Promise<{ user: User; staffUser: StaffUserContext }> {
  const authHeader = req.headers.get("Authorization") ||
    req.headers.get("authorization") || "";

  if (!authHeader.startsWith("Bearer ")) {
    throw new HttpError(401, "Missing bearer token");
  }

  const accessToken = authHeader.slice("Bearer ".length).trim();
  if (!accessToken) {
    throw new HttpError(401, "Missing bearer token");
  }

  const { data: userData, error: userError } = await supabase.auth.getUser(
    accessToken,
  );

  if (userError || !userData.user) {
    throw new HttpError(401, userError?.message || "Invalid bearer token");
  }

  const user = userData.user;
  const email = normalizeEmail(user.email);
  if (!email) {
    throw new HttpError(403, "Signed-in account is missing an email address");
  }

  const { data: staffUser, error: staffError } = await supabase
    .from("staff_users")
    .select("id, user_id, email, full_name, avatar_url, role, status")
    .eq("email", email)
    .maybeSingle();

  if (staffError) {
    throw new HttpError(500, staffError.message);
  }

  if (!staffUser) {
    throw new HttpError(403, "This email is not approved for this workspace");
  }

  if (staffUser.status === "disabled") {
    throw new HttpError(403, "This account has been disabled");
  }

  if (staffUser.user_id && staffUser.user_id !== user.id) {
    throw new HttpError(
      403,
      "This email is already linked to another account",
    );
  }

  const nextRole = (staffUser.role || "viewer") as StaffRole;
  if (ROLE_RANK[nextRole] < ROLE_RANK[minimumRole]) {
    throw new HttpError(403, "You do not have permission to use this action");
  }

  const displayName = getUserDisplayName(user);
  if (
    !staffUser.user_id || staffUser.status !== "active" ||
    (!staffUser.full_name && displayName)
  ) {
    const updates: Record<string, string | null> = {
      user_id: user.id,
      status: "active",
      last_sign_in_at: new Date().toISOString(),
    };

    if (!staffUser.full_name && displayName) {
      updates.full_name = displayName;
    }

    const { error: updateError } = await supabase
      .from("staff_users")
      .update(updates)
      .eq("id", staffUser.id);

    if (updateError) {
      throw new HttpError(500, updateError.message);
    }
  }

  return {
    user,
    staffUser: {
      id: String(staffUser.id),
      user_id: staffUser.user_id ? String(staffUser.user_id) : null,
      email: String(staffUser.email),
      full_name: staffUser.full_name ? String(staffUser.full_name) : null,
      avatar_url: staffUser.avatar_url ? String(staffUser.avatar_url) : null,
      role: nextRole,
      status: String(staffUser.status),
    },
  };
}
