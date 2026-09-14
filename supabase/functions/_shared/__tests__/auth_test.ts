import { assert, assertEquals, assertRejects } from "jsr:@std/assert@^1.0.0";
import {
  HttpError,
  isInternalServiceRequest,
  loadInternalServiceKeys,
  requireStaffOrServiceRole,
} from "../auth.ts";
import type { SupabaseAdminClient } from "../database.types.ts";

const SERVICE_KEY = "sb_secret_test_service_role_key_0123456789";
const SECRET_KEY = "sb_secret_second_key_abcdefghijklmnopqrstu";

function envWith(values: Record<string, string | undefined>) {
  return (name: string) => values[name];
}

function requestWith(headers: Record<string, string>): Request {
  return new Request("https://example.invalid/functions/v1/agent-discovery", {
    method: "POST",
    headers,
  });
}

// A JWT whose payload claims role=service_role but which is not the project key.
function forgedServiceRoleJwt(): string {
  const encode = (value: unknown) =>
    btoa(JSON.stringify(value)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${
    encode({ role: "service_role", ref: "ofzuhajxwxggybkuzefq", iss: "supabase" })
  }.forgedsignature`;
}

Deno.test("loadInternalServiceKeys: collects the service-role key and secret keys in every format", () => {
  assertEquals(loadInternalServiceKeys(envWith({})), []);
  assertEquals(
    loadInternalServiceKeys(envWith({ SUPABASE_SERVICE_ROLE_KEY: ` ${SERVICE_KEY} ` })),
    [SERVICE_KEY],
  );
  assertEquals(
    loadInternalServiceKeys(envWith({
      SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
      SUPABASE_SECRET_KEYS: JSON.stringify([SECRET_KEY, SERVICE_KEY]),
    })),
    [SERVICE_KEY, SECRET_KEY],
  );
  assertEquals(
    loadInternalServiceKeys(envWith({
      SUPABASE_SECRET_KEYS: JSON.stringify([{ name: "default", api_key: SECRET_KEY }]),
    })),
    [SECRET_KEY],
  );
  assertEquals(
    loadInternalServiceKeys(envWith({ SUPABASE_SECRET_KEYS: `${SECRET_KEY}, ${SERVICE_KEY}` })),
    [SECRET_KEY, SERVICE_KEY],
  );
});

Deno.test("isInternalServiceRequest: accepts only an exact configured key", () => {
  const keys = [SERVICE_KEY, SECRET_KEY];

  assert(isInternalServiceRequest(requestWith({ Authorization: `Bearer ${SERVICE_KEY}` }), keys));
  assert(isInternalServiceRequest(requestWith({ Authorization: `Bearer ${SECRET_KEY}` }), keys));
  assert(isInternalServiceRequest(requestWith({ apikey: SERVICE_KEY }), keys));

  assertEquals(isInternalServiceRequest(requestWith({}), keys), false);
  assertEquals(isInternalServiceRequest(requestWith({ Authorization: "Bearer " }), keys), false);
  assertEquals(
    isInternalServiceRequest(requestWith({ Authorization: `Bearer ${SERVICE_KEY}x` }), keys),
    false,
  );
  assertEquals(
    isInternalServiceRequest(requestWith({ Authorization: `Bearer ${SERVICE_KEY.slice(0, -1)}` }), keys),
    false,
  );
  assertEquals(
    isInternalServiceRequest(requestWith({ Authorization: `Bearer ${forgedServiceRoleJwt()}` }), keys),
    false,
  );
  assertEquals(isInternalServiceRequest(requestWith({ Authorization: `Bearer ${SERVICE_KEY}` }), []), false);
});

Deno.test("requireStaffOrServiceRole: internal calls become a synthetic editor without touching Supabase", async () => {
  const previous = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY);
  try {
    const supabase = new Proxy({}, {
      get() {
        throw new Error("Supabase must not be called for internal service requests");
      },
    }) as unknown as SupabaseAdminClient;

    const result = await requireStaffOrServiceRole(
      requestWith({ Authorization: `Bearer ${SERVICE_KEY}` }),
      supabase,
      "editor",
    );
    assertEquals(result.internal, true);
    assertEquals(result.user, null);
    assertEquals(result.staffUser.role, "editor");

    await assertRejects(
      () =>
        requireStaffOrServiceRole(
          requestWith({ Authorization: `Bearer ${SERVICE_KEY}` }),
          supabase,
          "admin",
        ),
      HttpError,
      "admin-only",
    );
  } finally {
    if (previous === undefined) Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
    else Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", previous);
  }
});

Deno.test("requireStaffOrServiceRole: non-internal calls still require a signed-in staff user", async () => {
  const previous = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY);
  try {
    const supabase = {
      auth: {
        getUser: () =>
          Promise.resolve({
            data: { user: null },
            error: { message: "invalid claim: missing sub claim" },
          }),
      },
    } as unknown as SupabaseAdminClient;

    await assertRejects(
      () =>
        requireStaffOrServiceRole(
          requestWith({ Authorization: `Bearer ${forgedServiceRoleJwt()}` }),
          supabase,
          "editor",
        ),
      HttpError,
      "missing sub claim",
    );
  } finally {
    if (previous === undefined) Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
    else Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", previous);
  }
});
