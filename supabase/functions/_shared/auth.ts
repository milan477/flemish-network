import { createClient, type User } from "npm:@supabase/supabase-js@2.57.4";
import type { Database, SupabaseAdminClient } from "./database.types.ts";

export type StaffRole = "viewer" | "editor" | "admin";

export interface StaffUserContext {
  id: string;
  user_id: string | null;
  email: string;
  full_name: string | null;
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

const SYSTEM_STAFF_USER: StaffUserContext = {
  id: "system",
  user_id: null,
  email: "system@scheduler.internal",
  full_name: "Scheduler",
  role: "editor",
  status: "active",
};

/**
 * Constant-time string comparison so a forged key cannot be guessed one byte
 * at a time from response timing.
 */
function constantTimeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const bytesA = encoder.encode(a);
  const bytesB = encoder.encode(b);
  let diff = bytesA.length ^ bytesB.length;
  const length = Math.max(bytesA.length, bytesB.length);
  for (let index = 0; index < length; index += 1) {
    diff |= (bytesA[index] ?? 0) ^ (bytesB[index] ?? 0);
  }
  return diff === 0;
}

function parseSecretKeyList(raw: string | undefined): string[] {
  if (!raw) return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    const items = Array.isArray(parsed) ? parsed : [parsed];
    return items
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object") {
          const record = item as Record<string, unknown>;
          const candidate = record.api_key ?? record.key ?? record.value ?? record.secret;
          return typeof candidate === "string" ? candidate : "";
        }
        return "";
      })
      .map((value) => value.trim())
      .filter(Boolean);
  } catch {
    return trimmed
      .split(/[\s,]+/)
      .map((value) => value.trim())
      .filter(Boolean);
  }
}

/**
 * Keys that identify an internal, machine-to-machine call: the service-role
 * key edge functions receive as SUPABASE_SERVICE_ROLE_KEY plus any secret API
 * keys Supabase exposes through SUPABASE_SECRET_KEYS. pg_cron and
 * agent-scheduler dispatch with one of these keys.
 */
export function loadInternalServiceKeys(
  env: (name: string) => string | undefined = (name) => Deno.env.get(name),
): string[] {
  const keys = new Set<string>();
  const serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (serviceRoleKey) keys.add(serviceRoleKey);
  for (const key of parseSecretKeyList(env("SUPABASE_SECRET_KEYS"))) {
    keys.add(key);
  }
  return [...keys];
}

export function extractRequestToken(req: Request): string {
  const authHeader = req.headers.get("Authorization") ||
    req.headers.get("authorization") || "";
  const bearer = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : "";
  if (bearer) return bearer;
  return (req.headers.get("apikey") || req.headers.get("Apikey") || "").trim();
}

/**
 * True when the request carries the project service-role key (or another
 * secret API key) instead of a user session. Only exact key equality counts;
 * a JWT that merely claims role=service_role is not trusted because gateway
 * JWT verification is disabled for these functions.
 */
export function isInternalServiceRequest(
  req: Request,
  keys: string[] = loadInternalServiceKeys(),
): boolean {
  const token = extractRequestToken(req);
  if (!token) return false;
  let matched = false;
  for (const key of keys) {
    if (constantTimeEqual(token, key)) matched = true;
  }
  return matched;
}

/**
 * Like requireStaffRole, but internal service calls (pg_cron tick,
 * agent-scheduler dispatch) are accepted as a synthetic editor. Use this in
 * every function the scheduler invokes; keep requireStaffRole for actions
 * that must be tied to a signed-in staff member.
 */
export async function requireStaffOrServiceRole(
  req: Request,
  supabase: SupabaseAdminClient,
  minimumRole: StaffRole = "viewer",
): Promise<{ user: User | null; staffUser: StaffUserContext; internal: boolean }> {
  if (isInternalServiceRequest(req)) {
    if (ROLE_RANK[SYSTEM_STAFF_USER.role] < ROLE_RANK[minimumRole]) {
      throw new HttpError(
        403,
        "Internal service calls cannot perform admin-only actions",
      );
    }
    return { user: null, staffUser: { ...SYSTEM_STAFF_USER }, internal: true };
  }
  const result = await requireStaffRole(req, supabase, minimumRole);
  return { ...result, internal: false };
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
    .select("id, user_id, email, full_name, role, status")
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
      role: nextRole,
      status: String(staffUser.status),
    },
  };
}
