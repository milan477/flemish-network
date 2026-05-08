// agent-discovery-reflect — Phase 4 Reflection Loop
//
// Inspects the approved network population, identifies systematically missing
// buckets, and writes exploration suggestions to discovery_reflection_suggestions
// for the bandit allocator to consume.
//
// Runs once per day via agent-scheduler. Can also be triggered manually by
// staff from the admin Reflection panel.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  createAdminClient,
  requireStaffRole,
} from "../_shared/auth.ts";
import { errorToResponse, jsonError, wrapHandler } from "../_shared/httpError.ts";
import { callGeminiStructured } from "../_shared/gemini.ts";
import { createLogger } from "../_shared/log.ts";

const log = createLogger("agent-discovery-reflect");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, apikey, x-client-info",
};

// ── Types ────────────────────────────────────────────────────────────────────

interface ReflectionSuggestion {
  surface: string | null;
  lens: string | null;
  context_key: string;
  rationale: string;
}

interface PopulationSummary {
  total_approved: number;
  by_sector: Array<{ sector: string; count: number }>;
  by_state: Array<{ state: string; count: number }>;
  by_employer: Array<{ employer: string; count: number }>;
  career_stage_distribution: Array<{ stage: string; count: number }>;
  recent_rejections_by_reason: Array<{ reason: string; count: number }>;
  generated_at: string;
}

// ── Gemini schema for structured output ──────────────────────────────────────

const REFLECTION_SCHEMA = {
  type: "object",
  properties: {
    suggestions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          surface: { type: "string", nullable: true },
          lens: { type: "string", nullable: true },
          context_key: { type: "string" },
          rationale: { type: "string" },
        },
        required: ["context_key", "rationale"],
      },
    },
  },
  required: ["suggestions"],
};

const REFLECTION_SYSTEM_PROMPT = `You are an analyst helping a discovery agent find more diverse Flemish-American professionals.

You receive a POPULATION SUMMARY of approved people in a network that maps Flemish professionals with US ties. You must identify GAPS — underrepresented sectors, geographies, career stages, or surface types that would yield new and different people if explored.

Available SURFACES (page types the agent can search):
- linkedin_profile: LinkedIn user profiles
- faculty_page: University faculty directory pages
- lab_roster: Research lab team pages
- company_team: Company about/team pages
- board_of_directors: Board member listings
- news_article: News coverage mentioning individuals
- press_release: Institutional press releases
- podcast_transcript: Podcast guest appearances
- conference_speakers: Conference/event speaker lists
- alumni_magazine: University alumni publications
- op_ed: Opinion pieces/columns
- crunchbase_profile: Startup/investor profiles
- university_news: University news items
- fellowship_announcement: Fellowship award announcements
- embassy_event: Embassy/consulate event listings
- substack_post: Substack author pages
- wikipedia: Wikipedia articles
- chamber_directory: Business chamber member directories
- trade_mission_roster: Trade mission participant lists
- sec_filing: SEC filings mentioning executives
- awards_page: Industry award recipient pages
- patent_filing: Patent inventor listings
- nonprofit_filing: Nonprofit IRS/990 filings
- obituary_wedding: Social announcement pages

Available LENSES (discovery angles):
- named_entity: Search by specific person or org name
- surface_phrase: Search by characteristic phrases on that page type
- nationality_role: Search combining nationality + professional role
- sector_geo: Search combining industry sector + geography
- alumni_network: Search via alumni networks
- company_affiliation: Search via company/employer affiliation
- event_participation: Search via events or conferences

For CONTEXT_KEY use a short descriptor like "sector:finance", "geo:midwest", "stage:executive", "domain:nonprofit", or "" for global.

Return 3 to 10 suggestions. Each MUST:
1. Target a gap that is UNDERREPRESENTED in the current population (not a strength).
2. Have a clear RATIONALE explaining what's missing and why this surface/lens combination would help find it.
3. Be actionable — choose a surface and lens combination that the agent can concretely search.

Think specifically about:
- Business professionals (finance, law, consulting) vs. heavy academic bias
- Geography: which US states/metros are barely covered?
- Career stage: are executives, board members, investors underrepresented?
- Sector gaps: which industries appear less than expected?
- Surface gaps: are some page types never tried (chamber directories, SEC filings, nonprofit filings)?`;

// ── Population summary builder ────────────────────────────────────────────────

async function buildPopulationSummary(
  supabase: ReturnType<typeof createAdminClient>,
): Promise<PopulationSummary> {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // Run all aggregations in parallel.
  const [
    totalRes,
    sectorsRes,
    statesRes,
    employersRes,
    careerStagesRes,
    rejectionsRes,
  ] = await Promise.all([
    // Total approved people
    supabase
      .from("people")
      .select("id", { count: "exact", head: true }),

    // Sector distribution (via person_sectors join)
    supabase
      .from("person_sectors")
      .select("sector_id, sectors!inner(name)")
      .limit(500),

    // State distribution (via people.state)
    supabase
      .from("people")
      .select("state")
      .not("state", "is", null)
      .limit(500),

    // Current employer distribution
    supabase
      .from("people")
      .select("current_employer")
      .not("current_employer", "is", null)
      .limit(500),

    // Career stage / occupation distribution
    supabase
      .from("people")
      .select("occupation")
      .not("occupation", "is", null)
      .limit(500),

    // Recent rejections by reason
    supabase
      .from("discovered_contacts")
      .select("reject_reason")
      .eq("status", "rejected")
      .not("reject_reason", "is", null)
      .gte("updated_at", thirtyDaysAgo)
      .limit(500),
  ]);

  // Count by sector
  const sectorCounts = new Map<string, number>();
  for (const row of sectorsRes.data || []) {
    const sectors = row.sectors as { name?: string } | { name?: string }[] | null;
    const name = Array.isArray(sectors) ? sectors[0]?.name : sectors?.name;
    if (name) {
      sectorCounts.set(name, (sectorCounts.get(name) || 0) + 1);
    }
  }
  const bySector = Array.from(sectorCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([sector, count]) => ({ sector, count }));

  // Count by state
  const stateCounts = new Map<string, number>();
  for (const row of statesRes.data || []) {
    const state = (row.state as string | null)?.trim();
    if (state) {
      stateCounts.set(state, (stateCounts.get(state) || 0) + 1);
    }
  }
  const byState = Array.from(stateCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([state, count]) => ({ state, count }));

  // Count by employer
  const employerCounts = new Map<string, number>();
  for (const row of employersRes.data || []) {
    const employer = (row.current_employer as string | null)?.trim();
    if (employer) {
      employerCounts.set(employer, (employerCounts.get(employer) || 0) + 1);
    }
  }
  const byEmployer = Array.from(employerCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([employer, count]) => ({ employer, count }));

  // Career stage distribution: bucket by occupation keywords
  const stageBuckets: Record<string, number> = {
    executive: 0,
    academic: 0,
    researcher: 0,
    engineer: 0,
    investor: 0,
    consultant: 0,
    other: 0,
  };
  const executiveKeywords = /\b(ceo|cto|cfo|coo|president|founder|vp|vice president|director|managing partner|partner)\b/i;
  const academicKeywords = /\b(professor|faculty|lecturer|dean|provost|chair|postdoc|postdoctoral)\b/i;
  const researcherKeywords = /\b(researcher|scientist|research|phd|fellow|principal investigator|pi)\b/i;
  const engineerKeywords = /\b(engineer|developer|architect|programmer|analyst|data)\b/i;
  const investorKeywords = /\b(investor|venture|vc|angel|fund|capital|partner)\b/i;
  const consultantKeywords = /\b(consultant|advisor|counsel|attorney|lawyer|associate)\b/i;

  for (const row of careerStagesRes.data || []) {
    const occ = (row.occupation as string | null) || "";
    if (executiveKeywords.test(occ)) stageBuckets.executive++;
    else if (academicKeywords.test(occ)) stageBuckets.academic++;
    else if (researcherKeywords.test(occ)) stageBuckets.researcher++;
    else if (engineerKeywords.test(occ)) stageBuckets.engineer++;
    else if (investorKeywords.test(occ)) stageBuckets.investor++;
    else if (consultantKeywords.test(occ)) stageBuckets.consultant++;
    else stageBuckets.other++;
  }
  const careerStageDistribution = Object.entries(stageBuckets)
    .sort((a, b) => b[1] - a[1])
    .map(([stage, count]) => ({ stage, count }));

  // Recent rejections by reason
  const rejectReasonCounts = new Map<string, number>();
  for (const row of rejectionsRes.data || []) {
    const reason = (row.reject_reason as string | null) || "other";
    rejectReasonCounts.set(reason, (rejectReasonCounts.get(reason) || 0) + 1);
  }
  const recentRejectionsByReason = Array.from(rejectReasonCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => ({ reason, count }));

  return {
    total_approved: totalRes.count ?? 0,
    by_sector: bySector,
    by_state: byState,
    by_employer: byEmployer,
    career_stage_distribution: careerStageDistribution,
    recent_rejections_by_reason: recentRejectionsByReason,
    generated_at: now.toISOString(),
  };
}

// ── Gemini reflection call ────────────────────────────────────────────────────

async function generateReflectionSuggestions(
  summary: PopulationSummary,
  apiKey: string,
): Promise<ReflectionSuggestion[]> {
  const userPrompt = buildReflectionPrompt(summary);

  try {
    const result = await callGeminiStructured<ReflectionSuggestion[]>({
      apiKey,
      route: "query_generation", // Uses gemini-2.5-flash-lite per model routing
      systemPrompt: REFLECTION_SYSTEM_PROMPT,
      userPrompt,
      schema: REFLECTION_SCHEMA,
      temperature: 0.4,
      parse: (payload) => {
        const suggestions = (payload as { suggestions?: unknown })?.suggestions;
        if (!Array.isArray(suggestions)) return [];
        return suggestions
          .map((entry) => {
            const obj = entry as {
              surface?: unknown;
              lens?: unknown;
              context_key?: unknown;
              rationale?: unknown;
            };
            const contextKey = String(obj?.context_key || "").trim();
            const rationale = String(obj?.rationale || "").trim();
            if (!rationale) return null;
            const surface = obj?.surface && String(obj.surface) !== "null"
              ? String(obj.surface).trim() || null
              : null;
            const lens = obj?.lens && String(obj.lens) !== "null"
              ? String(obj.lens).trim() || null
              : null;
            return {
              surface,
              lens,
              context_key: contextKey,
              rationale,
            } satisfies ReflectionSuggestion;
          })
          .filter((s): s is ReflectionSuggestion => s !== null);
      },
      emptyResponseFallback: [],
    });

    const suggestions = result.data;

    // Clamp to 3–10 suggestions.
    if (suggestions.length < 3) {
      log.warn("reflection_too_few_suggestions", `Got ${suggestions.length}, expected 3-10`);
    }
    return suggestions.slice(0, 10);
  } catch (err) {
    log.warn("reflection_gemini_failed", err instanceof Error ? err.message : String(err));
    return [];
  }
}

function buildReflectionPrompt(summary: PopulationSummary): string {
  const lines: string[] = [];

  lines.push("NETWORK POPULATION SUMMARY");
  lines.push(`Total approved people: ${summary.total_approved}`);
  lines.push("");

  lines.push("Top sectors (most to least common):");
  if (summary.by_sector.length === 0) {
    lines.push("  (no sector data yet)");
  } else {
    for (const { sector, count } of summary.by_sector) {
      lines.push(`  ${sector}: ${count} people`);
    }
  }
  lines.push("");

  lines.push("Top US states:");
  if (summary.by_state.length === 0) {
    lines.push("  (no state data yet)");
  } else {
    for (const { state, count } of summary.by_state) {
      lines.push(`  ${state}: ${count} people`);
    }
  }
  lines.push("");

  lines.push("Top current employers:");
  if (summary.by_employer.length === 0) {
    lines.push("  (no employer data yet)");
  } else {
    for (const { employer, count } of summary.by_employer) {
      lines.push(`  ${employer}: ${count} people`);
    }
  }
  lines.push("");

  lines.push("Career stage distribution:");
  for (const { stage, count } of summary.career_stage_distribution) {
    lines.push(`  ${stage}: ${count} people`);
  }
  lines.push("");

  lines.push("Recent rejection reasons (last 30 days):");
  if (summary.recent_rejections_by_reason.length === 0) {
    lines.push("  (no recent rejections)");
  } else {
    for (const { reason, count } of summary.recent_rejections_by_reason) {
      lines.push(`  ${reason}: ${count}`);
    }
  }
  lines.push("");

  lines.push(
    "Based on this population, what surfaces and lenses are MOST underexplored? " +
    "Which sectors, geographies, or career stages are systematically missing? " +
    "Return 3-10 suggestions, each targeting a specific gap with a concrete surface+lens combination.",
  );

  return lines.join("\n");
}

// ── Validate surface/lens keys against the DB ─────────────────────────────────

async function validateSuggestions(
  supabase: ReturnType<typeof createAdminClient>,
  suggestions: ReflectionSuggestion[],
): Promise<ReflectionSuggestion[]> {
  if (suggestions.length === 0) return [];

  const [surfacesRes, lensesRes] = await Promise.all([
    supabase.from("discovery_surfaces").select("key").eq("active", true),
    supabase.from("discovery_lenses").select("key").eq("active", true),
  ]);

  const validSurfaces = new Set((surfacesRes.data || []).map((r) => r.key as string));
  const validLenses = new Set((lensesRes.data || []).map((r) => r.key as string));

  return suggestions.map((s) => ({
    ...s,
    surface: s.surface && validSurfaces.has(s.surface) ? s.surface : null,
    lens: s.lens && validLenses.has(s.lens) ? s.lens : null,
  }));
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(wrapHandler(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabase = createAdminClient();
    await requireStaffRole(req, supabase, "editor");

    const apiKey = Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GOOGLE_AI_API_KEY") || "";
    if (!apiKey) {
      return jsonError(500, "agent_failure", "Missing Gemini API key");
    }

    log.info("reflection_start");

    // 1. Build population summary.
    let summary: PopulationSummary;
    try {
      summary = await buildPopulationSummary(supabase);
    } catch (err) {
      log.warn("population_summary_failed", err instanceof Error ? err.message : String(err));
      return jsonError(500, "agent_failure", "Failed to build population summary");
    }

    log.info("population_summary_built", `total=${summary.total_approved}`);

    // 2. Generate suggestions via Gemini.
    const rawSuggestions = await generateReflectionSuggestions(summary, apiKey);

    if (rawSuggestions.length === 0) {
      log.warn("reflection_no_suggestions", "Gemini returned no suggestions");
      return new Response(
        JSON.stringify({
          status: "ok",
          suggestions_written: 0,
          population_summary: summary,
          message: "Gemini returned no suggestions — check logs",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 3. Validate surface/lens keys.
    const validatedSuggestions = await validateSuggestions(supabase, rawSuggestions);

    // 4. Write to discovery_reflection_suggestions.
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();

    const rows = validatedSuggestions.map((s) => ({
      surface: s.surface,
      lens: s.lens,
      context_key: s.context_key || "",
      rationale: s.rationale,
      population_summary: summary as unknown as Record<string, unknown>,
      generated_at: now.toISOString(),
      consumed_attempt_count: 0,
      expires_at: expiresAt,
    }));

    const { error: insertError } = await supabase
      .from("discovery_reflection_suggestions")
      .insert(rows);

    if (insertError) {
      log.warn("reflection_insert_failed", insertError.message);
      return jsonError(500, "agent_failure", `Failed to write suggestions: ${insertError.message}`);
    }

    log.info("reflection_complete", `suggestions_written=${rows.length}`);

    return new Response(
      JSON.stringify({
        status: "ok",
        suggestions_written: rows.length,
        population_summary: summary,
        suggestions: validatedSuggestions,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return errorToResponse(err);
  }
}));
