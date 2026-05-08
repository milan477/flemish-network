// Universal Gemini-Flash query generator for the discovery agent.
//
// Every search query the agent issues — custom user query, source-pack lane,
// entity pivot — flows through this helper. There are no hand-written query
// templates anywhere in the discovery pipeline; angles are produced per-run by
// Gemini given an `(intent, surfaces?, lenses?, context)` tuple.
//
// On Gemini failure (timeout, malformed output, transport error) the helper
// falls back to a single boolean-grouped fallback query so seeding still makes
// progress. The fallback is intentionally minimal — it must not reintroduce
// the old multi-template logic that biases toward a single basin.

import { callGeminiStructured } from "./gemini.ts";
import { normalizeWhitespace, safeString } from "./discovery.ts";

const DEFAULT_MAX_QUERIES = 6;

export interface QueryGenerationContext {
  knownEntities?: string[];
  coverageGapLabel?: string | null;
  coverageGapSector?: string | null;
  avoidQueryShapes?: string[];
  rotationSeed?: string;
  /** Top reputable domains — include as site: operators when relevant. */
  preferredSiteOperators?: string[];
  /** Low-reputation or manually blocked domains — avoid as site: operators. */
  blockedDomains?: string[];
}

export interface QueryGenerationInput {
  intent: string;
  surfaces?: string[];
  lenses?: string[];
  context?: QueryGenerationContext;
  maxQueries?: number;
  runId?: string | null;
}

export interface GeneratedQuery {
  query: string;
  surface: string | null;
  lens: string | null;
  rationale: string;
}

export interface QueryGenerationResult {
  queries: GeneratedQuery[];
  modelUsed: string | null;
  fallbackUsed: boolean;
  fallbackReason: string | null;
}

const SYSTEM_PROMPT =
  `You generate web-search queries for a discovery agent that finds people with Flemish/Belgian ties relevant to a US-focused professional network.

The network includes TWO kinds of relevant people:
1. US-based: Flemish/Belgian people currently living or working in the United States.
2. US-connected-abroad: Flemish/Belgian people based outside the US but with an active, evidence-bearing US tie — e.g. visiting/affiliate professor at a US university, advisor or board seat at a US org, frequent US speaking engagements, US lab collaboration, joint appointment, or a US patent/grant collaboration.

Both surfaces are valid discovery targets.

Given an INTENT, optional SURFACE hints (page types like linkedin_profile, faculty_page, lab_roster, company_team, board_of_directors, news_article, alumni_magazine, conference_speakers, podcast_transcript, fellowship_announcement, embassy_event, chamber_directory, trade_mission_roster, wikipedia, op_ed, substack_post), optional LENS hints (named_entity, surface_phrase, nationality_role, sector_geo, alumni_network, company_affiliation, event_participation), and CONTEXT (known entities, coverage-gap geography/sector, query shapes to avoid, rotation seed) — produce 4-6 semantically distinct search queries that each probe a DIFFERENT angle.

Hard requirements for every query:
- Self-contained, well-formed, pasteable into a generic web search engine.
- Use proper boolean operators with parentheses for grouping. Example: \`(Belgian OR Flemish OR "from Ghent" OR "from Antwerp" OR "from Leuven") "United States"\`. NEVER write \`Belgian OR Flemish United States\` — precedence is wrong.
- Quote multi-word entities, places, and titles. Example: "KU Leuven", "Ghent University", "from Antwerp", "visiting professor".
- When a surface is hinted, use \`site:\` operators that match it (linkedin.com/in for linkedin_profile; *.edu for faculty_page/alumni_magazine; kuleuven.be / ugent.be / vub.be / uantwerpen.be / imec-int.com / baef.be for Flemish-institution surfaces; crunchbase.com for crunchbase_profile; en.wikipedia.org for wikipedia). Pick what fits — do not blanket-stuff.
- Include surface-form phrasing variants alongside abstract labels: "from Ghent", "born in Antwerp", "Belgian-born", "PhD KU Leuven", "raised in Flanders".
- Reference canonical Flemish entities (KU Leuven, Ghent University/UGent, VUB, UAntwerpen, imec, BAEF, Vlerick, FIT) only when relevant to the intent or explicitly listed in context.knownEntities.
- Do NOT emit any query whose shape matches an entry in context.avoidQueryShapes.
- Do NOT emit any query that uses a site: operator for a domain listed in context.blockedDomains.
- When context.preferredSiteOperators contains domains and a surface hint suggests they are relevant, USE a site: operator for one of those domains in at least one query. Prefer the highest-yield domain from the list.
- Across the SET, vary the angle: at least one query SHOULD target US-based people (with \`"United States"\`, USA, or a US city/state) and at least one SHOULD target US-connected-abroad people (Flemish person + explicit US-tie phrase + optional US institution). Not every query needs to mention "United States".
- Use context.rotationSeed to vary across runs of the same intent — do not return the same set verbatim each time.

For each query also return:
- "surface": one surface tag from the hints (or your best inference), or null if not surface-specific.
- "lens": one lens tag from the hints (or your best inference), or null if not lens-specific.
- "rationale": short label of which angle this probes (e.g. "us_based_alumni", "us_connected_abroad_visiting_prof", "linkedin_surface").

Return strictly JSON: { "queries": [ { "query": "...", "surface": "...|null", "lens": "...|null", "rationale": "..." }, ... ] }`;

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    queries: {
      type: "array",
      items: {
        type: "object",
        properties: {
          query: { type: "string" },
          surface: { type: "string", nullable: true },
          lens: { type: "string", nullable: true },
          rationale: { type: "string" },
        },
        required: ["query", "rationale"],
      },
    },
  },
  required: ["queries"],
};

function nullableTag(value: unknown): string | null {
  const text = normalizeWhitespace(safeString(value));
  if (!text) return null;
  if (text.toLowerCase() === "null") return null;
  return text;
}

function buildFallback(input: QueryGenerationInput): GeneratedQuery {
  const intent = normalizeWhitespace(input.intent);
  const surface = (input.surfaces && input.surfaces[0]) || null;
  const lens = (input.lenses && input.lenses[0]) || null;
  return {
    query:
      `${intent} (Belgian OR Flemish OR "from Ghent" OR "from Antwerp" OR "from Leuven") "United States"`,
    surface: surface ? normalizeWhitespace(surface) || null : null,
    lens: lens ? normalizeWhitespace(lens) || null : null,
    rationale: "fallback_origin_surface_forms",
  };
}

function buildUserPrompt(input: QueryGenerationInput, max: number): string {
  const ctx = input.context || {};
  const lines: string[] = [];
  lines.push(`INTENT: ${normalizeWhitespace(input.intent)}`);
  if (input.surfaces && input.surfaces.length > 0) {
    lines.push(`SURFACE_HINTS: ${input.surfaces.join(", ")}`);
  }
  if (input.lenses && input.lenses.length > 0) {
    lines.push(`LENS_HINTS: ${input.lenses.join(", ")}`);
  }
  if (ctx.knownEntities && ctx.knownEntities.length > 0) {
    lines.push(`KNOWN_ENTITIES: ${ctx.knownEntities.join(", ")}`);
  }
  if (ctx.coverageGapLabel) {
    lines.push(`COVERAGE_GAP_LABEL: ${ctx.coverageGapLabel}`);
  }
  if (ctx.coverageGapSector) {
    lines.push(`COVERAGE_GAP_SECTOR: ${ctx.coverageGapSector}`);
  }
  if (ctx.avoidQueryShapes && ctx.avoidQueryShapes.length > 0) {
    lines.push(`AVOID_QUERY_SHAPES: ${ctx.avoidQueryShapes.join(" | ")}`);
  }
  if (ctx.preferredSiteOperators && ctx.preferredSiteOperators.length > 0) {
    lines.push(`PREFERRED_SITE_OPERATORS: ${ctx.preferredSiteOperators.join(", ")} (use site: for at least one when surface-relevant)`);
  }
  if (ctx.blockedDomains && ctx.blockedDomains.length > 0) {
    lines.push(`BLOCKED_DOMAINS: ${ctx.blockedDomains.join(", ")} (never use site: for these)`);
  }
  const seed = ctx.rotationSeed || input.runId || new Date().toISOString();
  lines.push(`ROTATION_SEED: ${seed}`);
  lines.push("");
  lines.push(
    `Return up to ${max} diverse, well-formed search queries probing different surfaces. Vary angles vs. other runs with the same intent.`,
  );
  return lines.join("\n");
}

export async function generateSearchQueries(
  input: QueryGenerationInput,
  apiKey: string,
): Promise<QueryGenerationResult> {
  const intent = normalizeWhitespace(input.intent);
  if (!intent) {
    return {
      queries: [],
      modelUsed: null,
      fallbackUsed: false,
      fallbackReason: "empty_intent",
    };
  }

  const max = Math.max(1, Math.min(input.maxQueries || DEFAULT_MAX_QUERIES, 8));
  const userPrompt = buildUserPrompt(input, max);

  let modelUsed: string | null = null;
  let generated: GeneratedQuery[] = [];
  let fallbackUsed = false;
  let fallbackReason: string | null = null;

  try {
    const result = await callGeminiStructured<GeneratedQuery[]>({
      apiKey,
      route: "query_generation",
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      schema: RESPONSE_SCHEMA,
      temperature: 0.7,
      parse: (payload) => {
        const queries = (payload as { queries?: unknown })?.queries;
        if (!Array.isArray(queries)) return [];
        return queries
          .map((entry) => {
            const obj = entry as {
              query?: unknown;
              surface?: unknown;
              lens?: unknown;
              rationale?: unknown;
            };
            const query = normalizeWhitespace(safeString(obj?.query));
            if (!query) return null;
            return {
              query,
              surface: nullableTag(obj?.surface),
              lens: nullableTag(obj?.lens),
              rationale:
                normalizeWhitespace(safeString(obj?.rationale)) || "unspecified",
            } satisfies GeneratedQuery;
          })
          .filter((value): value is GeneratedQuery => value !== null);
      },
    });
    modelUsed = result.modelUsed;
    generated = result.data;
    if (generated.length === 0) {
      fallbackUsed = true;
      fallbackReason = "empty_generation";
    }
  } catch (error) {
    fallbackUsed = true;
    fallbackReason = error instanceof Error ? error.message : String(error);
  }

  if (fallbackUsed) {
    generated = [buildFallback(input)];
  }

  const seen = new Set<string>();
  const deduped: GeneratedQuery[] = [];
  for (const entry of generated) {
    const key = entry.query.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(entry);
    if (deduped.length >= max) break;
  }

  return {
    queries: deduped,
    modelUsed,
    fallbackUsed,
    fallbackReason,
  };
}
