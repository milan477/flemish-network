import { assert, assertEquals } from "jsr:@std/assert@^1.0.0";
import { getGeminiModelChain } from "../gemini.ts";

Deno.test("profile verification uses current Gemini 3 models and excludes Gemini 2.5 Flash", () => {
  const models = getGeminiModelChain("profile_verification");

  assertEquals(models.slice(0, 4), [
    "gemini-3.8-flash",
    "gemini-3.7-flash",
    "gemini-3.6-flash",
    "gemini-3.1-pro-preview",
  ]);
  assert(models.includes("gemini-2.5-pro"));
  assert(models.every((model) => !model.toLowerCase().startsWith("gemini-2.5-flash")));
  assert(!models.includes("gemini-2.5-flash"));
});
