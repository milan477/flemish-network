// Pivot Validation — Phase 5 (Discovery Redesign)
//
// Validates whether a newly-discovered entity pivot is genuinely
// Flemish/Belgian-relevant before it enters the active rotation.
//
// A pivot scoring < 0.5 is rejected. On any error the fallback score of 0.5
// is returned so the caller can treat the pivot as borderline-valid and still
// promote it; this prevents a single Gemini failure from silently killing
// legitimate pivots.

import { callGeminiStructured } from "./gemini.ts";

export interface PivotValidationResult {
  /** 0–1; pivots with score < 0.5 should be rejected. */
  score: number;
  rationale: string;
}

const VALIDATION_SYSTEM_PROMPT = `You are a quality filter for a discovery agent that finds people with Flemish/Belgian ties in the United States professional network.

You will be given an entity (organization, institution, fellowship, lab, association, event, etc.) that has been extracted as a potential discovery pivot — meaning the agent plans to use it as a seed for finding more people.

Your job: decide whether this entity is genuinely useful for finding Flemish/Belgian-connected Americans.

Score 0–1:
- 1.0: Clearly Flemish/Belgian institution (KU Leuven, imec, BAEF, VUB, Ghent University, Flanders, Belgian company headquartered in Belgium, etc.)
- 0.7–0.9: Indirectly but reliably Flemish/Belgian-relevant (Belgian-American Chamber, entity closely tied to Flemish companies or government, strong Belgian-origin brand)
- 0.5–0.6: Borderline — possible link but weak or ambiguous evidence
- 0.3–0.4: US or international entity with incidental Belgian mentions (e.g. a US hospital that once hired a Belgian researcher)
- 0.0–0.2: Not Flemish/Belgian-relevant at all (generic US company, US university, person name that is not an institution, nonsense, etc.)

Reject score < 0.5 means this entity would waste discovery budget by generating queries that do not find Flemish/Belgian people.

Return strictly JSON: { "score": <number 0-1>, "rationale": "<short reason, max 120 chars>" }`;

const VALIDATION_SCHEMA = {
  type: "object",
  properties: {
    score: { type: "number" },
    rationale: { type: "string" },
  },
  required: ["score", "rationale"],
};

/**
 * Ask Gemini whether this pivot entity is genuinely Flemish/Belgian-relevant.
 *
 * @param entityName - The canonical entity name extracted by the agent.
 * @param entityType - The entity type (organization, lab, fellowship, etc.).
 * @param sourceExcerpts - Short excerpts from pages where this entity appeared.
 * @param apiKey - Gemini API key.
 */
export async function validatePivot(
  entityName: string,
  entityType: string,
  sourceExcerpts: string[],
  apiKey: string,
): Promise<PivotValidationResult> {
  const excerptText = sourceExcerpts
    .filter((e) => e && e.trim())
    .slice(0, 4)
    .map((e, i) => `[${i + 1}] ${e.slice(0, 250)}`)
    .join("\n");

  const userPrompt = [
    `ENTITY_NAME: ${entityName}`,
    `ENTITY_TYPE: ${entityType}`,
    excerptText ? `SOURCE_EXCERPTS:\n${excerptText}` : "SOURCE_EXCERPTS: (none provided)",
    "",
    "Is this entity Flemish/Belgian-relevant in a way that makes it useful for finding more Flemish-Americans? Return a score 0-1 with rationale.",
  ].join("\n");

  try {
    const { data } = await callGeminiStructured<{ score: number; rationale: string }>({
      apiKey,
      route: "query_generation", // uses gemini-2.5-flash-lite per route table
      systemPrompt: VALIDATION_SYSTEM_PROMPT,
      userPrompt,
      schema: VALIDATION_SCHEMA,
      temperature: 0.1,
      parse: (payload) => {
        const obj = payload as Record<string, unknown>;
        const score = typeof obj.score === "number" ? obj.score : parseFloat(String(obj.score));
        const rationale = typeof obj.rationale === "string" ? obj.rationale : "no_rationale";
        if (isNaN(score) || score < 0 || score > 1) {
          throw new Error(`Invalid score: ${score}`);
        }
        return { score: Math.round(score * 100) / 100, rationale };
      },
    });
    return data;
  } catch {
    // Fallback on any error: treat as borderline-valid so we don't silently
    // discard pivots due to transient Gemini failures.
    return { score: 0.5, rationale: "validation_failed" };
  }
}
