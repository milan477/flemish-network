import { assert, assertEquals } from "jsr:@std/assert@^1.0.0";
import { getGeminiModelChain } from "../gemini.ts";

Deno.test("profile verification always starts with Gemini 3.5 Flash and never uses Pro", () => {
  const models = getGeminiModelChain("profile_verification");

  assertEquals(models[0], "gemini-3.5-flash");
  assert(models.every((model) => model.toLowerCase().includes("flash")));
  assert(!models.includes("gemini-2.5-pro"));
});
