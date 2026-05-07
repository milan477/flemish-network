import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env", quiet: true });
loadEnv({ path: ".env.local", override: true, quiet: true });

/**
 * Smoke harness — calls each deployed edge function with a minimal known fixture
 * and validates the response shape. Exits non-zero on any failure.
 *
 * Required env:
 *   VITE_SUPABASE_URL            — project URL
 *   VITE_SUPABASE_ANON_KEY       — used to sign in a temporary smoke user
 *   SUPABASE_SERVICE_ROLE_KEY    — used only to create/cleanup the smoke user + staff row
 *   SMOKE_TEST_PERSON_ID         — (optional) UUID of a real person for read paths
 *   SMOKE_TEST_ACCESS_TOKEN      — (optional) use an existing staff JWT instead of provisioning
 */

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const personIdFixture = process.env.SMOKE_TEST_PERSON_ID || "";
const suppliedAccessToken = process.env.SMOKE_TEST_ACCESS_TOKEN || "";
const isLocalSupabase =
  Boolean(supabaseUrl) &&
  (supabaseUrl.includes("127.0.0.1") || supabaseUrl.includes("localhost"));

if (!supabaseUrl || !anonKey || !serviceRoleKey) {
  console.error(
    "Missing VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, or SUPABASE_SERVICE_ROLE_KEY. Export all three before running the smoke harness."
  );
  process.exit(1);
}

interface SmokeCheck {
  name: string;
  label?: string;
  body?: unknown;
  method?: "POST" | "GET";
  query?: string;
  /** Returns null on success, or a string explaining what's wrong with the response */
  validate?: (body: unknown, status: number, response: Response) => string | null;
  /** Skip if env not set — return reason string */
  skipReason?: () => string | null;
  /** Allow 4xx responses if validate accepts them (for input-validation paths) */
  allowClientError?: boolean;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

const checks: SmokeCheck[] = [
  {
    name: "ai-agent",
    body: { task: "smart_search", context: { query: "biotech in Boston" } },
    validate: (body) => {
      if (!isObject(body)) return "expected object";
      const data = isObject(body.data) ? body.data : {};
      if (!("keywords" in data) && !("error" in body)) {
        return "missing data.keywords/error in response";
      }
      return null;
    },
  },
  {
    name: "search-people",
    body: { query: "Boston" },
    validate: (body) => {
      if (!isObject(body)) return "expected object";
      if ("error" in body && body.error) return `error: ${JSON.stringify(body.error)}`;
      if (!("results" in body)) return "missing results array";
      return null;
    },
  },
  {
    name: "suggest-people",
    body: { query: "biotech founder" },
    validate: (body) => {
      if (!isObject(body)) return "expected object";
      return null;
    },
  },
  {
    name: "geocode",
    body: { pairs: [{ city: "Boston", state: "MA" }] },
    validate: (body) => {
      if (!isObject(body)) return "expected object";
      if (!("results" in body) && !("error" in body)) return "missing results/error";
      return null;
    },
  },
  {
    name: "generate-embeddings",
    method: "POST",
    body: { kick: true },
    validate: (body) => {
      if (!isObject(body)) return "expected object";
      return null;
    },
  },
  {
    name: "agent-scheduler",
    body: { source: "smoke", action: "metrics" },
    validate: (body) => {
      if (!isObject(body)) return "expected object";
      if (!("metrics" in body) && !("error" in body)) return "missing metrics/error";
      return null;
    },
  },
  {
    name: "agent-discovery",
    body: { dryRun: true },
    allowClientError: true,
    validate: (body) => {
      if (!isObject(body)) return "expected object";
      return null;
    },
  },
  {
    name: "agent-verify",
    body: { dryRun: true },
    allowClientError: true,
    validate: (body) => {
      if (!isObject(body)) return "expected object";
      return null;
    },
  },
  {
    name: "update-profile",
    skipReason: () =>
      personIdFixture ? null : "set SMOKE_TEST_PERSON_ID to run update-profile smoke",
    body: { person_id: personIdFixture, dryRun: true },
    allowClientError: true,
    validate: (body) => {
      if (!isObject(body)) return "expected object";
      return null;
    },
  },
];

interface Result {
  name: string;
  status: "PASS" | "FAIL" | "SKIP";
  ms: number;
  detail?: string;
}

interface SmokeSession {
  accessToken: string;
  userId?: string;
  email?: string;
}

async function serviceFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${supabaseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey!,
      ...(init.headers || {}),
    },
  });
}

async function provisionSmokeSession(): Promise<SmokeSession> {
  if (suppliedAccessToken) return { accessToken: suppliedAccessToken };

  const email = `smoke-test-${Date.now()}@example.invalid`;
  const password = `Smoke-${crypto.randomUUID()}!`;

  const createUser = await serviceFetch("/auth/v1/admin/users", {
    method: "POST",
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: "Smoke Test User" },
    }),
  });
  const created = await createUser.json() as { id?: string; msg?: string; error?: string };
  if (!createUser.ok || !created.id) {
    if (isLocalSupabase && createUser.status === 403) {
      throw new Error(
        "Failed to create local smoke auth user. VITE_SUPABASE_URL points to local Supabase, so SUPABASE_SERVICE_ROLE_KEY must be the local service-role key in .env.local or your shell environment."
      );
    }
    throw new Error(`Failed to create smoke auth user: ${JSON.stringify(created)}`);
  }

  const staffUpsert = await serviceFetch("/rest/v1/staff_users", {
    method: "POST",
    body: JSON.stringify({
      user_id: created.id,
      email,
      full_name: "Smoke Test User",
      role: "editor",
      status: "active",
    }),
  });
  if (!staffUpsert.ok) {
    throw new Error(`Failed to upsert smoke staff row: ${await staffUpsert.text()}`);
  }

  const signIn = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: anonKey!,
    },
    body: JSON.stringify({ email, password }),
  });
  const session = await signIn.json() as { access_token?: string; error_description?: string };
  if (!signIn.ok || !session.access_token) {
    throw new Error(`Failed to sign in smoke user: ${JSON.stringify(session)}`);
  }

  return { accessToken: session.access_token, userId: created.id, email };
}

async function cleanupSmokeSession(session: SmokeSession): Promise<void> {
  if (!session.email || !session.userId) return;
  await serviceFetch(`/rest/v1/staff_users?email=eq.${encodeURIComponent(session.email)}`, {
    method: "DELETE",
  }).catch(() => undefined);
  await serviceFetch(`/auth/v1/admin/users/${session.userId}`, {
    method: "DELETE",
  }).catch(() => undefined);
}

async function runOne(check: SmokeCheck, accessToken: string): Promise<Result> {
  const displayName = check.label || check.name;
  if (check.skipReason) {
    const reason = check.skipReason();
    if (reason) return { name: displayName, status: "SKIP", ms: 0, detail: reason };
  }

  const url = `${supabaseUrl}/functions/v1/${check.name}${check.query || ""}`;
  const start = Date.now();

  try {
    const res = await fetch(url, {
      method: check.method || "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        apikey: anonKey!,
      },
      body: check.body !== undefined ? JSON.stringify(check.body) : undefined,
    });

    const ms = Date.now() - start;
    let parsed: unknown = null;
    const text = await res.text();
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      return {
        name: displayName,
        status: "FAIL",
        ms,
        detail: `non-JSON response (status ${res.status}): ${text.slice(0, 120)}`,
      };
    }

    if (!res.ok && !check.allowClientError) {
      return {
        name: displayName,
        status: "FAIL",
        ms,
        detail: `HTTP ${res.status}: ${JSON.stringify(parsed).slice(0, 200)}`,
      };
    }

    if (check.validate) {
      const failure = check.validate(parsed, res.status, res);
      if (failure) {
        return { name: displayName, status: "FAIL", ms, detail: failure };
      }
    }

    return { name: displayName, status: "PASS", ms };
  } catch (err) {
    return {
      name: displayName,
      status: "FAIL",
      ms: Date.now() - start,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

async function main() {
  console.log(`smoke harness against ${supabaseUrl}`);
  const session = await provisionSmokeSession();
  const results: Result[] = [];
  try {
    for (const check of checks) {
      const r = await runOne(check, session.accessToken);
      results.push(r);
      const pad = (s: string, n: number) => s.padEnd(n);
      const tag =
        r.status === "PASS" ? "\x1b[32mPASS\x1b[0m" :
        r.status === "SKIP" ? "\x1b[33mSKIP\x1b[0m" :
        "\x1b[31mFAIL\x1b[0m";
      console.log(
        `${tag} ${pad(r.name, 22)} ${String(r.ms).padStart(5)}ms${r.detail ? "  " + r.detail : ""}`
      );
    }
  } finally {
    await cleanupSmokeSession(session);
  }

  const failed = results.filter((r) => r.status === "FAIL").length;
  const skipped = results.filter((r) => r.status === "SKIP").length;
  const passed = results.length - failed - skipped;
  console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
