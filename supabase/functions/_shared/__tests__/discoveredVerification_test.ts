import { assert, assertEquals } from "jsr:@std/assert@^1.0.0";
import { VERIFICATION_SCHEMA } from "../discoveredVerification.ts";

// Gemini's structured-output schema is an OpenAPI subset. It rejects
// JSON-Schema style unions such as `type: ["string", "null"]` with HTTP 400,
// so every nullable field has to be expressed as `nullable: true`.
function collectTypeViolations(node: unknown, path: string, out: string[]): void {
  if (!node || typeof node !== "object") return;
  const record = node as Record<string, unknown>;
  if ("type" in record && typeof record.type !== "string") {
    out.push(`${path}.type is ${JSON.stringify(record.type)}`);
  }
  if (Array.isArray(record.enum) && record.enum.some((value) => value === null)) {
    out.push(`${path}.enum contains null`);
  }
  if (record.properties && typeof record.properties === "object") {
    for (const [key, child] of Object.entries(record.properties as Record<string, unknown>)) {
      collectTypeViolations(child, `${path}.${key}`, out);
    }
  }
  if (record.items) collectTypeViolations(record.items, `${path}[]`, out);
}

Deno.test("VERIFICATION_SCHEMA only uses Gemini-compatible scalar types and nullable flags", () => {
  const violations: string[] = [];
  collectTypeViolations(VERIFICATION_SCHEMA, "schema", violations);
  assertEquals(violations, []);

  const properties = VERIFICATION_SCHEMA.properties as Record<string, Record<string, unknown>>;
  assertEquals(properties.network_scope.nullable, true);
  assertEquals(properties.network_scope.enum, ["us_based", "us_connected_abroad"]);
  for (const key of ["location_city", "current_role", "contradiction_reason", "notes"]) {
    assert(properties[key].nullable === true, `${key} must be nullable`);
  }
});
