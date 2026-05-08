// Bandit Allocator for the Discovery Agent — Phase 3
//
// Allocates query-budget slots across (surface, lens) arms using Thompson
// sampling over Beta priors on approval rate, with a hard 25% exploration
// reserve for untried or oldest-attempted arms.
//
// Reference: Thompson sampling for Bernoulli bandits.
//   prior: Beta(alpha, beta) where alpha = approved+1, beta = extracted-approved+1
//   penalty: if not_flemish_rate > 0.5 we reduce the effective alpha.
//   saturation: arms with cooldown_until > now() are skipped entirely.

import type { SupabaseAdminClient } from "./database.types.ts";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AllocationSlot {
  surface: string;
  lens: string;
  contextKey: string;
  isExploration: boolean;
  /** Set when this slot was seeded from a reflection suggestion. */
  reflectionSuggestionId?: string;
}

interface ArmStats {
  surface: string;
  lens: string;
  context_key: string;
  attempts: number;
  candidates_extracted: number;
  new_pending_contacts: number;
  contacts_approved: number;
  contacts_rejected: number;
  not_flemish_rejections: number;
  last_attempt_at: string | null;
  last_yielding_attempt_at: string | null;
  cooldown_until: string | null;
}

// ── Thompson sampling helpers ─────────────────────────────────────────────────

/**
 * Draw a sample from a Beta(alpha, beta) distribution using the Johnk method.
 * Pure deterministic-ish numeric approximation sufficient for arm ordering.
 */
function sampleBeta(alpha: number, beta: number, entropy: number): number {
  // Use a simple deterministic approximation: mean ± scaled noise.
  // This is not a true random draw but good enough for ranking in a
  // server-side edge function where crypto.getRandomValues is available.
  const u1 = Math.abs(Math.sin(entropy * 12.9898 + alpha * 78.233)) % 1;
  const u2 = Math.abs(Math.sin(entropy * 43.233 + beta * 17.769)) % 1;

  // Use the ratio method: if X ~ Gamma(alpha) and Y ~ Gamma(beta),
  // then X/(X+Y) ~ Beta(alpha, beta).
  // Approximate Gamma with the log-transformed uniform trick.
  const x = alpha > 0 ? -Math.log(Math.max(u1, 1e-10)) / alpha : 0;
  const y = beta > 0 ? -Math.log(Math.max(u2, 1e-10)) / beta : 0;
  if (x + y === 0) return 0.5;
  return x / (x + y);
}

/**
 * Thompson-sample score for one arm.
 * @param arm - arm stats row (may be a synthetic "no-data" arm)
 * @param entropy - caller-supplied entropy value (varies per arm per run)
 */
function thompsonScore(arm: ArmStats, entropy: number): number {
  const approved = arm.contacts_approved;
  const extracted = arm.candidates_extracted;
  const rejected = arm.contacts_rejected;
  const notFlemish = arm.not_flemish_rejections;

  // Beta prior on approval rate.
  // alpha = successes + 1 (Laplace smoothing)
  // beta  = failures  + 1
  let alpha = approved + 1;
  const betaParam = Math.max(extracted - approved, 0) + 1;

  // Penalize arms with high not_flemish rejection rate.
  // If > 50% of rejections are not_flemish, halve effective alpha.
  if (rejected > 0 && notFlemish / rejected > 0.5) {
    alpha = Math.max(alpha * 0.5, 0.5);
  }

  return sampleBeta(alpha, betaParam, entropy);
}

// ── Key helpers ───────────────────────────────────────────────────────────────

function armKey(surface: string, lens: string, contextKey = ""): string {
  return `${surface}|${lens}|${contextKey}`;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Allocate `budget` query slots across active (surface, lens) arms.
 *
 * - 25% of slots (at least 1) are reserved for exploration:
 *     first checks discovery_reflection_suggestions for unconsumed suggestions,
 *     then falls back to arms where last_attempt_at IS NULL (untried),
 *     then falls back to arm with oldest last_attempt_at.
 * - Remaining slots go to Thompson-sampled exploitation.
 * - Arms with cooldown_until > now() are excluded entirely.
 * - Arms with no data are treated as neutral Beta(1,1) priors.
 */
export async function allocateBudget(
  supabase: SupabaseAdminClient,
  budget: number,
  runId: string,
): Promise<AllocationSlot[]> {
  if (budget <= 0) return [];

  const explorationCount = Math.max(1, Math.ceil(budget * 0.25));
  const exploitationCount = budget - explorationCount;

  // 1. Load existing arm stats.
  const { data: statsRows, error: statsError } = await supabase
    .from("discovery_arm_stats")
    .select(
      "surface,lens,context_key,attempts,candidates_extracted,new_pending_contacts,contacts_approved,contacts_rejected,not_flemish_rejections,last_attempt_at,last_yielding_attempt_at,cooldown_until",
    );

  if (statsError) {
    throw new Error(`Failed to load arm stats: ${statsError.message}`);
  }

  // 2. Load all active (surface, lens) combinations.
  const [surfacesRes, lensesRes] = await Promise.all([
    supabase.from("discovery_surfaces").select("key").eq("active", true),
    supabase.from("discovery_lenses").select("key").eq("active", true),
  ]);

  if (surfacesRes.error) {
    throw new Error(`Failed to load surfaces: ${surfacesRes.error.message}`);
  }
  if (lensesRes.error) {
    throw new Error(`Failed to load lenses: ${lensesRes.error.message}`);
  }

  const surfaces = (surfacesRes.data || []).map((r) => r.key as string);
  const lenses = (lensesRes.data || []).map((r) => r.key as string);

  if (surfaces.length === 0 || lenses.length === 0) {
    return [];
  }

  // 3. Build a map of known stats keyed by (surface, lens, context_key).
  const statsMap = new Map<string, ArmStats>();
  const now = new Date().toISOString();

  for (const row of statsRows || []) {
    const key = armKey(row.surface, row.lens, row.context_key || "");
    statsMap.set(key, row as ArmStats);
  }

  // 4. Expand to all (surface, lens, '') global arm combinations, synthesising
  //    zero-data records for arms not yet in the stats table.
  const allArms: ArmStats[] = [];
  for (const surface of surfaces) {
    for (const lens of lenses) {
      const key = armKey(surface, lens, "");
      const existing = statsMap.get(key);
      if (existing) {
        allArms.push(existing);
      } else {
        allArms.push({
          surface,
          lens,
          context_key: "",
          attempts: 0,
          candidates_extracted: 0,
          new_pending_contacts: 0,
          contacts_approved: 0,
          contacts_rejected: 0,
          not_flemish_rejections: 0,
          last_attempt_at: null,
          last_yielding_attempt_at: null,
          cooldown_until: null,
        });
      }
    }
  }

  // 5. Filter out saturated arms (cooldown_until > now()).
  const eligibleArms = allArms.filter((arm) => {
    if (!arm.cooldown_until) return true;
    return arm.cooldown_until <= now;
  });

  if (eligibleArms.length === 0) {
    // All arms are cooling down — pick a random global arm as fallback.
    const fallback = allArms[0];
    return fallback
      ? [{ surface: fallback.surface, lens: fallback.lens, contextKey: "", isExploration: true }]
      : [];
  }

  // 6. Separate untried arms for exploration reserve.
  const untriedArms = eligibleArms.filter((arm) => arm.last_attempt_at === null);

  // Derive a stable numeric entropy value from the runId so sampling is
  // deterministic for the same run but varies across runs.
  let runEntropy = 1.0;
  for (let i = 0; i < runId.length; i++) {
    runEntropy = (runEntropy * 1000003 + runId.charCodeAt(i)) % 1e9;
  }
  runEntropy = (runEntropy % 1e6) / 1e6;

  // 7. Pick exploration slots.
  //    Priority: (a) reflection suggestions, (b) untried arms, (c) oldest-attempted.
  const explorationSlots: AllocationSlot[] = [];
  const usedKeys = new Set<string>();

  // 7a. First: check discovery_reflection_suggestions for unconsumed suggestions.
  const nowIsoForReflection = new Date().toISOString();
  const { data: reflectionRows } = await supabase
    .from("discovery_reflection_suggestions")
    .select("id,surface,lens,context_key")
    .gt("expires_at", nowIsoForReflection)
    .order("generated_at", { ascending: true })
    .limit(explorationCount * 2); // fetch a few extras to allow dedup

  const consumedReflectionIds: string[] = [];

  for (const row of reflectionRows || []) {
    if (explorationSlots.length >= explorationCount) break;
    // Require at least a surface or lens to be useful; pure context-only suggestions still work.
    const surface = (row.surface as string | null) || "";
    const lens = (row.lens as string | null) || "";
    const contextKey = (row.context_key as string) || "";
    // Pick a valid surface/lens — fall back to first eligible arm's surface/lens if Gemini
    // returned a key that's not in the active taxonomy.
    const resolvedSurface = surface && surfaces.includes(surface)
      ? surface
      : (eligibleArms[0]?.surface || surfaces[0] || "");
    const resolvedLens = lens && lenses.includes(lens)
      ? lens
      : (eligibleArms[0]?.lens || lenses[0] || "");
    if (!resolvedSurface || !resolvedLens) continue;

    const key = armKey(resolvedSurface, resolvedLens, contextKey);
    if (usedKeys.has(key)) continue;
    usedKeys.add(key);
    consumedReflectionIds.push(row.id as string);
    explorationSlots.push({
      surface: resolvedSurface,
      lens: resolvedLens,
      contextKey,
      isExploration: true,
      reflectionSuggestionId: row.id as string,
    });
  }

  // Increment consumed_attempt_count for all used reflection suggestions.
  if (consumedReflectionIds.length > 0) {
    // Non-fatal: fetch current counts then increment.
    const { data: existingRows } = await supabase
      .from("discovery_reflection_suggestions")
      .select("id,consumed_attempt_count")
      .in("id", consumedReflectionIds);

    await Promise.all(
      (existingRows || []).map((row) =>
        supabase
          .from("discovery_reflection_suggestions")
          .update({ consumed_attempt_count: ((row.consumed_attempt_count as number) || 0) + 1 })
          .eq("id", row.id)
      ),
    );
  }

  // 7b. Fallback: untried arms.
  if (explorationSlots.length < explorationCount && untriedArms.length > 0) {
    // Shuffle untried arms deterministically using runEntropy.
    const shuffled = [...untriedArms].sort((a, b) => {
      const ka = armKey(a.surface, a.lens, a.context_key);
      const kb = armKey(b.surface, b.lens, b.context_key);
      const ha = Math.abs(Math.sin(runEntropy + ka.length * 13.7)) % 1;
      const hb = Math.abs(Math.sin(runEntropy + kb.length * 13.7)) % 1;
      return ha - hb;
    });
    for (const arm of shuffled) {
      if (explorationSlots.length >= explorationCount) break;
      const key = armKey(arm.surface, arm.lens, arm.context_key);
      if (usedKeys.has(key)) continue;
      usedKeys.add(key);
      explorationSlots.push({
        surface: arm.surface,
        lens: arm.lens,
        contextKey: arm.context_key,
        isExploration: true,
      });
    }
  }

  // If we still need more exploration slots, pick oldest-attempted arms.
  if (explorationSlots.length < explorationCount) {
    const oldestFirst = [...eligibleArms]
      .filter((arm) => !usedKeys.has(armKey(arm.surface, arm.lens, arm.context_key)))
      .sort((a, b) => {
        const ta = a.last_attempt_at || "";
        const tb = b.last_attempt_at || "";
        return ta < tb ? -1 : ta > tb ? 1 : 0;
      });

    for (const arm of oldestFirst) {
      if (explorationSlots.length >= explorationCount) break;
      const key = armKey(arm.surface, arm.lens, arm.context_key);
      if (usedKeys.has(key)) continue;
      usedKeys.add(key);
      explorationSlots.push({
        surface: arm.surface,
        lens: arm.lens,
        contextKey: arm.context_key,
        isExploration: true,
      });
    }
  }

  // 8. Thompson-sample exploitation slots from remaining eligible arms.
  const exploitationCandidates = eligibleArms.filter(
    (arm) => !usedKeys.has(armKey(arm.surface, arm.lens, arm.context_key)),
  );

  // Score each arm.
  const scored = exploitationCandidates.map((arm, idx) => ({
    arm,
    score: thompsonScore(arm, runEntropy + idx * 0.137),
  }));

  // Sort descending by score.
  scored.sort((a, b) => b.score - a.score);

  const exploitationSlots: AllocationSlot[] = [];
  for (const { arm } of scored) {
    if (exploitationSlots.length >= exploitationCount) break;
    const key = armKey(arm.surface, arm.lens, arm.context_key);
    if (usedKeys.has(key)) continue;
    usedKeys.add(key);
    exploitationSlots.push({
      surface: arm.surface,
      lens: arm.lens,
      contextKey: arm.context_key,
      isExploration: false,
    });
  }

  // 9. Return exploration slots first, then exploitation.
  return [...explorationSlots, ...exploitationSlots];
}

// ── Arm stats update ──────────────────────────────────────────────────────────

export interface ArmUpdateInput {
  surface: string;
  lens: string;
  contextKey?: string;
  candidatesExtracted: number;
  newPendingContacts: number;
  costUsd?: number;
}

/**
 * Upsert arm stats after a run completes. Increments attempts, adds
 * candidates_extracted and new_pending_contacts, sets last_attempt_at,
 * and sets last_yielding_attempt_at when new_pending_contacts > 0.
 *
 * If new_pending_contacts == 0 AND the arm's last_yielding_attempt_at is
 * older than 7 days (or null), set cooldown_until = now() + 7 days.
 */
export async function updateArmStats(
  supabase: SupabaseAdminClient,
  updates: ArmUpdateInput[],
): Promise<void> {
  if (updates.length === 0) return;

  const now = new Date();
  const nowIso = now.toISOString();
  const cooldownUntil = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  for (const update of updates) {
    const contextKey = update.contextKey ?? "";
    const surfaceKey = update.surface;
    const lensKey = update.lens;

    // Load existing row.
    const { data: existing } = await supabase
      .from("discovery_arm_stats")
      .select("*")
      .eq("surface", surfaceKey)
      .eq("lens", lensKey)
      .eq("context_key", contextKey)
      .maybeSingle();

    const prevAttempts = existing?.attempts ?? 0;
    const prevExtracted = existing?.candidates_extracted ?? 0;
    const prevPending = existing?.new_pending_contacts ?? 0;
    const prevCost = Number(existing?.total_cost_usd ?? 0);

    const newAttempts = prevAttempts + 1;
    const newExtracted = prevExtracted + update.candidatesExtracted;
    const newPending = prevPending + update.newPendingContacts;
    const newCost = prevCost + (update.costUsd ?? 0);

    const lastYielding = update.newPendingContacts > 0
      ? nowIso
      : (existing?.last_yielding_attempt_at ?? null);

    // Saturation check: if this attempt yielded nothing AND last_yielding
    // was more than 7 days ago (or never), set cooldown.
    let newCooldown = existing?.cooldown_until ?? null;
    if (update.newPendingContacts === 0) {
      const lastYieldTime = existing?.last_yielding_attempt_at;
      const isStale = !lastYieldTime || lastYieldTime < sevenDaysAgo;
      if (isStale && newAttempts >= 3) {
        newCooldown = cooldownUntil;
      }
    } else {
      // Clear cooldown when we yield contacts.
      newCooldown = null;
    }

    if (existing) {
      await supabase
        .from("discovery_arm_stats")
        .update({
          attempts: newAttempts,
          candidates_extracted: newExtracted,
          new_pending_contacts: newPending,
          total_cost_usd: newCost,
          last_attempt_at: nowIso,
          last_yielding_attempt_at: lastYielding,
          cooldown_until: newCooldown,
        })
        .eq("surface", surfaceKey)
        .eq("lens", lensKey)
        .eq("context_key", contextKey);
    } else {
      await supabase
        .from("discovery_arm_stats")
        .insert({
          surface: surfaceKey,
          lens: lensKey,
          context_key: contextKey,
          attempts: newAttempts,
          candidates_extracted: update.candidatesExtracted,
          new_pending_contacts: update.newPendingContacts,
          contacts_approved: 0,
          contacts_rejected: 0,
          not_flemish_rejections: 0,
          total_cost_usd: newCost,
          last_attempt_at: nowIso,
          last_yielding_attempt_at: lastYielding,
          cooldown_until: newCooldown,
        });
    }
  }
}

// ── Nightly arm stats refresh ─────────────────────────────────────────────────

/**
 * Refresh aggregate arm stats from discovery_query_attempts for the last 30 days.
 * Groups by (surface, lens, '') global context key.
 * Upserts into discovery_arm_stats (only the derived-aggregate columns; preserves
 * manually-set cooldown_until so the saturation logic is not overwritten).
 *
 * Called by agent-scheduler housekeeping at end of each discovery run and nightly.
 */
export async function refreshArmStats(
  supabase: SupabaseAdminClient,
): Promise<{ arms_refreshed: number }> {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // Aggregate from query attempts.
  const { data: rows, error } = await supabase
    .from("discovery_query_attempts")
    .select(
      "surface,lens,candidates_extracted,new_pending_contacts,contacts_later_approved,contacts_later_rejected,rejected_reason_breakdown",
    )
    .gte("created_at", cutoff)
    .not("surface", "is", null)
    .not("lens", "is", null);

  if (error) {
    throw new Error(`Failed to load query attempts for arm stats refresh: ${error.message}`);
  }

  // Group by (surface, lens).
  type AggKey = string;
  const agg = new Map<
    AggKey,
    {
      surface: string;
      lens: string;
      attempts: number;
      candidates_extracted: number;
      new_pending_contacts: number;
      contacts_approved: number;
      contacts_rejected: number;
      not_flemish_rejections: number;
    }
  >();

  for (const row of rows || []) {
    if (!row.surface || !row.lens) continue;
    const key = `${row.surface}|${row.lens}`;
    const existing = agg.get(key) ?? {
      surface: row.surface,
      lens: row.lens,
      attempts: 0,
      candidates_extracted: 0,
      new_pending_contacts: 0,
      contacts_approved: 0,
      contacts_rejected: 0,
      not_flemish_rejections: 0,
    };

    existing.attempts += 1;
    existing.candidates_extracted += row.candidates_extracted ?? 0;
    existing.new_pending_contacts += row.new_pending_contacts ?? 0;
    existing.contacts_approved += row.contacts_later_approved ?? 0;
    existing.contacts_rejected += row.contacts_later_rejected ?? 0;

    // Count not_flemish rejections from the breakdown JSON.
    const breakdown = row.rejected_reason_breakdown as Record<string, number> | null;
    if (breakdown && typeof breakdown === "object") {
      existing.not_flemish_rejections += breakdown.not_flemish ?? 0;
    }

    agg.set(key, existing);
  }

  let armsRefreshed = 0;

  for (const stats of agg.values()) {
    // Load existing row to preserve cooldown_until and timestamps.
    const { data: existing } = await supabase
      .from("discovery_arm_stats")
      .select("last_attempt_at, last_yielding_attempt_at, cooldown_until")
      .eq("surface", stats.surface)
      .eq("lens", stats.lens)
      .eq("context_key", "")
      .maybeSingle();

    const { error: upsertError } = await supabase
      .from("discovery_arm_stats")
      .upsert(
        {
          surface: stats.surface,
          lens: stats.lens,
          context_key: "",
          attempts: stats.attempts,
          candidates_extracted: stats.candidates_extracted,
          new_pending_contacts: stats.new_pending_contacts,
          contacts_approved: stats.contacts_approved,
          contacts_rejected: stats.contacts_rejected,
          not_flemish_rejections: stats.not_flemish_rejections,
          // Preserve total_cost_usd as it's not tracked in query_attempts directly
          // (keep existing value).
          last_attempt_at: existing?.last_attempt_at ?? null,
          last_yielding_attempt_at: existing?.last_yielding_attempt_at ?? null,
          cooldown_until: existing?.cooldown_until ?? null,
        },
        { onConflict: "surface,lens,context_key" },
      );

    if (upsertError) {
      // Non-fatal — log and continue.
      console.warn(
        `arm_stats_refresh_upsert_failed surface=${stats.surface} lens=${stats.lens}: ${upsertError.message}`,
      );
    } else {
      armsRefreshed++;
    }
  }

  return { arms_refreshed: armsRefreshed };
}
