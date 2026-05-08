import type { Json, SupabaseAdminClient } from "./database.types.ts";
import {
  buildLocationLabelValue,
  findExistingUsLocation,
  normalizeLocationKey,
  parseLocationCandidate,
  safeString,
} from "./locationPipeline.ts";

export type DerivedLabelType =
  | "sector"
  | "occupation"
  | "flemish_entity"
  | "us_location"
  | "source_quality"
  | "profile_confidence";

export interface DerivedLabelSeed {
  person_id?: string | null;
  discovered_contact_id?: string | null;
  label_type: DerivedLabelType;
  label_value: string;
  normalized_value: string;
  raw_value?: string | null;
  confidence: number;
  source: string;
  method?: string | null;
  evidence_url?: string | null;
  evidence_excerpt?: string | null;
  metadata?: Json | null;
  agent_run_id?: string | null;
  dedupe_key: string;
}

interface DiscoveryEvidenceLabelInput {
  pageUrl: string;
  pageType: string;
  evidenceExcerpt: string;
  rawLocationText: string;
  rawFlemishText: string;
  extractionConfidence: number;
}

export interface FlemishFactCandidateInput {
  canonical_name: string;
  candidate_alias?: string | null;
  role?: string | null;
  source_url?: string | null;
  evidence_excerpt?: string | null;
  confidence?: number | null;
  raw_evidence?: string | null;
}

interface DiscoveryLabelContext {
  discoveredContactId: string;
  agentRunId?: string | null;
  source: string;
  currentPosition: string;
  occupation: string;
  bio: string;
  locationCity: string;
  locationState: string;
  rawLocationText: string;
  flemishConnection: string;
  flemishFactCandidates?: FlemishFactCandidateInput[];
  sectors: string[];
  evidence: DiscoveryEvidenceLabelInput[];
}

interface VerificationLabelContext {
  personId: string;
  agentRunId?: string | null;
  source: string;
  currentPosition: string;
  occupation: string;
  bio: string;
  locationCity: string;
  locationState: string;
  rawLocationText: string;
  flemishTexts: string[];
  evidenceUrl: string;
  evidenceExcerpt: string;
  method?: string | null;
  suggestionConfidence?: number | null;
}

const SECTOR_KEYWORDS: Record<string, string[]> = {
  "Artificial Intelligence": [
    "artificial intelligence",
    "machine learning",
    "ml",
    "ai ",
    " ai",
    "data science",
    "computer vision",
    "nlp",
    "robotics",
  ],
  Biotechnology: [
    "biotech",
    "biotechnology",
    "life sciences",
    "genomics",
    "therapeutics",
    "pharma",
    "biomedical",
  ],
  Finance: ["finance", "fintech", "bank", "banking", "investment", "venture capital"],
  "Culture & Arts": ["arts", "culture", "creative", "museum", "design", "music", "theater"],
  Education: ["education", "teaching", "curriculum", "faculty", "school", "learning"],
  Research: ["research", "scientist", "laboratory", "lab", "postdoc", "professor"],
};

const OCCUPATION_KEYWORDS: Record<string, string[]> = {
  Student: ["student", "phd candidate", "doctoral candidate", "graduate student", "undergraduate"],
  "Academic/Researcher": [
    "professor",
    "researcher",
    "scientist",
    "postdoc",
    "lecturer",
    "faculty",
    "academic",
  ],
  Professional: [
    "engineer",
    "manager",
    "consultant",
    "developer",
    "designer",
    "producer",
    "professional",
  ],
  "Executive/Leadership": [
    "founder",
    "director",
    "executive",
    "ceo",
    "cto",
    "president",
    "vice president",
    "dean",
  ],
};

const FLEMISH_ENTITY_PATTERNS: Array<{ canonical: string; type: string; patterns: RegExp[] }> = [
  {
    canonical: "KU Leuven",
    type: "university",
    patterns: [/\bku\s*leuven\b/i, /\bkatholieke\s+universiteit\s+leuven\b/i],
  },
  {
    canonical: "UGent",
    type: "university",
    patterns: [/\bugent\b/i, /\bghent\s+university\b/i, /\buniversity\s+of\s+ghent\b/i],
  },
  {
    canonical: "VUB",
    type: "university",
    patterns: [/\bvub\b/i, /\bvrije\s+universiteit\s+brussel\b/i],
  },
  {
    canonical: "UAntwerp",
    type: "university",
    patterns: [/\buantwerp\b/i, /\buniversity\s+of\s+antwerp\b/i, /\buniversiteit\s+antwerpen\b/i],
  },
  {
    canonical: "UHasselt",
    type: "university",
    patterns: [/\buhasselt\b/i, /\bhasselt\s+university\b/i],
  },
  {
    canonical: "imec",
    type: "company",
    patterns: [/\bimec\b/i],
  },
  {
    canonical: "BAEF",
    type: "program",
    patterns: [/\bbaef\b/i, /\bbelgian\s+american\s+educational\s+foundation\b/i],
  },
  {
    canonical: "Fayat Fellowship",
    type: "program",
    patterns: [/\bfayat\b/i, /\bfayat\s+fellow(?:ship)?\b/i],
  },
  {
    canonical: "Flemish Government",
    type: "government",
    patterns: [/\bflemish\s+government\b/i, /\bgovernment\s+of\s+flanders\b/i],
  },
];

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, Number(value.toFixed(2))));
}

function normalizeText(value: string): string {
  return safeString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateText(value: string, maxLength = 240): string {
  const normalized = safeString(value);
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 3)}...`;
}

function buildDedupeKey(
  subjectKey: string,
  labelType: DerivedLabelType,
  normalizedValue: string,
): string {
  return `${subjectKey}|${labelType}|${normalizedValue}`;
}

function buildSubjectKey(personId?: string | null, discoveredContactId?: string | null): string {
  if (personId) return `person:${personId}`;
  return `discovered:${discoveredContactId || "unknown"}`;
}

function pushSeed(
  seeds: DerivedLabelSeed[],
  seed: Omit<DerivedLabelSeed, "dedupe_key">,
) {
  const normalizedValue = normalizeText(seed.normalized_value || seed.label_value);
  if (!normalizedValue) return;

  seeds.push({
    ...seed,
    normalized_value: normalizedValue,
    confidence: clampConfidence(seed.confidence),
    evidence_excerpt: truncateText(seed.evidence_excerpt || ""),
    dedupe_key: buildDedupeKey(
      buildSubjectKey(seed.person_id, seed.discovered_contact_id),
      seed.label_type,
      normalizedValue,
    ),
  });
}

function inferSectorsFromTexts(texts: string[]): Array<{ sector: string; confidence: number }> {
  const combined = normalizeText(texts.filter(Boolean).join(" "));
  if (!combined) return [];

  return Object.entries(SECTOR_KEYWORDS)
    .map(([sector, keywords]) => {
      const matches = keywords.filter((keyword) => combined.includes(normalizeText(keyword))).length;
      if (matches === 0) return null;
      return {
        sector,
        confidence: clampConfidence(0.62 + matches * 0.1),
      };
    })
    .filter((value): value is { sector: string; confidence: number } => Boolean(value))
    .sort((a, b) => b.confidence - a.confidence);
}

function inferOccupation(explicitOccupation: string, texts: string[]): {
  occupation: string;
  confidence: number;
} | null {
  const explicit = safeString(explicitOccupation);
  if (explicit) {
    return {
      occupation: explicit,
      confidence: 0.9,
    };
  }

  const combined = normalizeText(texts.filter(Boolean).join(" "));
  if (!combined) return null;

  const matches = Object.entries(OCCUPATION_KEYWORDS)
    .map(([occupation, keywords]) => ({
      occupation,
      score: keywords.filter((keyword) => combined.includes(normalizeText(keyword))).length,
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  if (matches.length === 0) return null;

  return {
    occupation: matches[0].occupation,
    confidence: clampConfidence(0.64 + matches[0].score * 0.1),
  };
}

function inferFlemishEntities(texts: string[]): Array<{ value: string; entityType: string; confidence: number }> {
  const joined = texts.filter(Boolean).join(" ");
  if (!joined) return [];

  const found = new Map<string, { value: string; entityType: string; confidence: number }>();
  for (const entity of FLEMISH_ENTITY_PATTERNS) {
    if (entity.patterns.some((pattern) => pattern.test(joined))) {
      found.set(entity.canonical.toLowerCase(), {
        value: entity.canonical,
        entityType: entity.type,
        confidence: 0.86,
      });
    }
  }

  return Array.from(found.values());
}

function deriveSourceQuality(
  source: string,
  pageTypes: string[],
  averageConfidence: number,
): { value: string; confidence: number } {
  const normalizedSource = normalizeText(source);
  if (normalizedSource.includes("linkedin")) {
    return { value: "high", confidence: 0.94 };
  }

  if (pageTypes.some((pageType) => pageType === "person_profile")) {
    return { value: "high", confidence: 0.88 };
  }

  if (averageConfidence >= 0.8 || pageTypes.some((pageType) =>
    pageType === "team_or_roster" || pageType === "lab_or_group_page"
  )) {
    return { value: "medium", confidence: 0.8 };
  }

  return { value: "low", confidence: 0.72 };
}

function deriveProfileConfidence(
  evidenceCount: number,
  averageConfidence: number,
  hasStrongLink: boolean,
): { value: string; confidence: number } {
  if ((evidenceCount >= 2 && averageConfidence >= 0.78) || hasStrongLink) {
    return { value: "high", confidence: 0.86 };
  }

  if (averageConfidence >= 0.62 || evidenceCount >= 1) {
    return { value: "medium", confidence: 0.78 };
  }

  return { value: "low", confidence: 0.7 };
}

async function buildLocationSeed(
  supabase: SupabaseAdminClient,
  subject: { person_id?: string | null; discovered_contact_id?: string | null; agent_run_id?: string | null },
  input: {
    source: string;
    method?: string | null;
    evidence_url?: string | null;
    evidence_excerpt?: string | null;
    raw_location_text: string;
    location_city: string;
    location_state: string;
    confidence: number;
  },
): Promise<DerivedLabelSeed | null> {
  const parsed = parseLocationCandidate(
    input.raw_location_text,
    input.location_city,
    input.location_state,
  );

  if (!parsed.label_value) return null;

  const existingLocation = parsed.is_us_candidate && parsed.city && parsed.state
    ? await findExistingUsLocation(supabase, parsed.city, parsed.state)
    : null;

  const normalizedValue = normalizeText(parsed.label_value);
  if (!normalizedValue) return null;

  return {
    ...subject,
    label_type: "us_location",
    label_value: buildLocationLabelValue(parsed.city, parsed.state, parsed.raw_text),
    normalized_value: normalizedValue,
    raw_value: parsed.raw_text || null,
    confidence: clampConfidence(
      Math.min(0.98, parsed.parser_confidence * 0.75 + input.confidence * 0.25),
    ),
    source: input.source,
    method: input.method || null,
    evidence_url: input.evidence_url || null,
    evidence_excerpt: input.evidence_excerpt || null,
    metadata: {
      raw_location_text: parsed.raw_text,
      parsed_city: parsed.city,
      parsed_state: parsed.state,
      parsed_country: parsed.country,
      is_us_candidate: parsed.is_us_candidate,
      parser_confidence: parsed.parser_confidence,
      review_required: parsed.review_required || !existingLocation?.id,
      location_id: existingLocation?.id || null,
      latitude: existingLocation?.latitude ?? null,
      longitude: existingLocation?.longitude ?? null,
    },
    agent_run_id: subject.agent_run_id || null,
    dedupe_key: buildDedupeKey(
      buildSubjectKey(subject.person_id, subject.discovered_contact_id),
      "us_location",
      normalizedValue,
    ),
  };
}

export async function buildDiscoveryDerivedLabels(
  supabase: SupabaseAdminClient,
  context: DiscoveryLabelContext,
): Promise<DerivedLabelSeed[]> {
  const seeds: DerivedLabelSeed[] = [];
  const subject = {
    discovered_contact_id: context.discoveredContactId,
    agent_run_id: context.agentRunId || null,
  };
  const evidenceCount = context.evidence.length;
  const averageConfidence = evidenceCount > 0
    ? context.evidence.reduce((sum, item) => sum + item.extractionConfidence, 0) / evidenceCount
    : 0.6;
  const bestEvidence = context.evidence[0];

  const sectorCandidates = new Map<string, number>();
  for (const sector of context.sectors) {
    sectorCandidates.set(sector, 0.9);
  }
  for (const inferred of inferSectorsFromTexts([context.currentPosition, context.bio])) {
    const current = sectorCandidates.get(inferred.sector) || 0;
    sectorCandidates.set(inferred.sector, Math.max(current, inferred.confidence));
  }

  sectorCandidates.forEach((confidence, sector) => {
    pushSeed(seeds, {
      ...subject,
      label_type: "sector",
      label_value: sector,
      normalized_value: sector,
      raw_value: sector,
      confidence,
      source: context.source,
      evidence_url: bestEvidence?.pageUrl || null,
      evidence_excerpt: bestEvidence?.evidenceExcerpt || context.bio,
      metadata: {
        evidence_count: evidenceCount,
      },
      agent_run_id: subject.agent_run_id || null,
    });
  });

  const occupation = inferOccupation(context.occupation, [
    context.currentPosition,
    context.bio,
  ]);
  if (occupation) {
    pushSeed(seeds, {
      ...subject,
      label_type: "occupation",
      label_value: occupation.occupation,
      normalized_value: occupation.occupation,
      raw_value: context.occupation || context.currentPosition,
      confidence: occupation.confidence,
      source: context.source,
      evidence_url: bestEvidence?.pageUrl || null,
      evidence_excerpt: bestEvidence?.evidenceExcerpt || context.currentPosition,
      metadata: {
        derived_from: context.occupation ? "explicit" : "heuristic",
      },
      agent_run_id: subject.agent_run_id || null,
    });
  }

  for (const entity of inferFlemishEntities([
    context.flemishConnection,
    ...context.evidence.map((item) => item.rawFlemishText),
    context.bio,
  ])) {
    pushSeed(seeds, {
      ...subject,
      label_type: "flemish_entity",
      label_value: entity.value,
      normalized_value: entity.value,
      raw_value: context.flemishConnection,
      confidence: entity.confidence,
      source: context.source,
      evidence_url: bestEvidence?.pageUrl || null,
      evidence_excerpt: bestEvidence?.rawFlemishText || context.flemishConnection,
      metadata: {
        entity_type: entity.entityType,
      },
      agent_run_id: subject.agent_run_id || null,
    });
  }

  for (const candidate of context.flemishFactCandidates || []) {
    const canonicalName = safeString(candidate.canonical_name);
    if (!canonicalName) continue;
    const rawEvidence = safeString(candidate.raw_evidence) ||
      safeString(candidate.evidence_excerpt) ||
      safeString(candidate.candidate_alias) ||
      canonicalName;

    pushSeed(seeds, {
      ...subject,
      label_type: "flemish_entity",
      label_value: canonicalName,
      normalized_value: canonicalName,
      raw_value: rawEvidence,
      confidence: clampConfidence(candidate.confidence ?? averageConfidence),
      source: context.source,
      evidence_url: safeString(candidate.source_url) || bestEvidence?.pageUrl || null,
      evidence_excerpt: safeString(candidate.evidence_excerpt) || rawEvidence,
      metadata: {
        candidate_alias: safeString(candidate.candidate_alias) || null,
        role: safeString(candidate.role) || "discovery",
        raw_value: rawEvidence,
      },
      agent_run_id: subject.agent_run_id || null,
    });
  }

  const locationSeed = await buildLocationSeed(supabase, subject, {
    source: context.source,
    raw_location_text: context.rawLocationText || bestEvidence?.rawLocationText || "",
    location_city: context.locationCity,
    location_state: context.locationState,
    evidence_url: bestEvidence?.pageUrl || null,
    evidence_excerpt: bestEvidence?.evidenceExcerpt || context.rawLocationText,
    confidence: clampConfidence(Math.max(averageConfidence, 0.72)),
  });
  if (locationSeed) seeds.push(locationSeed);

  const sourceQuality = deriveSourceQuality(
    context.source,
    context.evidence.map((item) => item.pageType),
    averageConfidence,
  );
  pushSeed(seeds, {
    ...subject,
    label_type: "source_quality",
    label_value: sourceQuality.value,
    normalized_value: sourceQuality.value,
    raw_value: context.source,
    confidence: sourceQuality.confidence,
    source: context.source,
    evidence_url: bestEvidence?.pageUrl || null,
    evidence_excerpt: bestEvidence?.evidenceExcerpt || null,
    metadata: {
      page_types: context.evidence.map((item) => item.pageType),
      evidence_count: evidenceCount,
    },
    agent_run_id: subject.agent_run_id || null,
  });

  const profileConfidence = deriveProfileConfidence(
    evidenceCount,
    averageConfidence,
    Boolean(context.currentPosition || context.bio || context.flemishConnection),
  );
  pushSeed(seeds, {
    ...subject,
    label_type: "profile_confidence",
    label_value: profileConfidence.value,
    normalized_value: profileConfidence.value,
    raw_value: context.source,
    confidence: profileConfidence.confidence,
    source: context.source,
    evidence_url: bestEvidence?.pageUrl || null,
    evidence_excerpt: bestEvidence?.evidenceExcerpt || null,
    metadata: {
      evidence_count: evidenceCount,
      average_confidence: clampConfidence(averageConfidence),
    },
    agent_run_id: subject.agent_run_id || null,
  });

  return seeds;
}

export async function buildVerificationDerivedLabels(
  supabase: SupabaseAdminClient,
  context: VerificationLabelContext,
): Promise<DerivedLabelSeed[]> {
  const seeds: DerivedLabelSeed[] = [];
  const subject = {
    person_id: context.personId,
    agent_run_id: context.agentRunId || null,
  };
  const sourceConfidence = clampConfidence(context.suggestionConfidence ?? 0.82);

  for (const inferred of inferSectorsFromTexts([context.currentPosition, context.bio])) {
    pushSeed(seeds, {
      ...subject,
      label_type: "sector",
      label_value: inferred.sector,
      normalized_value: inferred.sector,
      raw_value: context.currentPosition || context.bio,
      confidence: inferred.confidence,
      source: context.source,
      method: context.method || null,
      evidence_url: context.evidenceUrl || null,
      evidence_excerpt: context.evidenceExcerpt || context.bio,
      metadata: {
        derived_from: "verification_profile_text",
      },
      agent_run_id: subject.agent_run_id || null,
    });
  }

  const occupation = inferOccupation(context.occupation, [
    context.currentPosition,
    context.bio,
  ]);
  if (occupation) {
    pushSeed(seeds, {
      ...subject,
      label_type: "occupation",
      label_value: occupation.occupation,
      normalized_value: occupation.occupation,
      raw_value: context.occupation || context.currentPosition,
      confidence: occupation.confidence,
      source: context.source,
      method: context.method || null,
      evidence_url: context.evidenceUrl || null,
      evidence_excerpt: context.evidenceExcerpt || context.currentPosition,
      metadata: {
        derived_from: context.occupation ? "explicit" : "heuristic",
      },
      agent_run_id: subject.agent_run_id || null,
    });
  }

  for (const entity of inferFlemishEntities([
    ...context.flemishTexts,
    context.bio,
    context.currentPosition,
  ])) {
    pushSeed(seeds, {
      ...subject,
      label_type: "flemish_entity",
      label_value: entity.value,
      normalized_value: entity.value,
      raw_value: context.flemishTexts.join(" | "),
      confidence: entity.confidence,
      source: context.source,
      method: context.method || null,
      evidence_url: context.evidenceUrl || null,
      evidence_excerpt: context.evidenceExcerpt || context.flemishTexts[0],
      metadata: {
        entity_type: entity.entityType,
      },
      agent_run_id: subject.agent_run_id || null,
    });
  }

  const locationSeed = await buildLocationSeed(supabase, subject, {
    source: context.source,
    method: context.method || null,
    evidence_url: context.evidenceUrl || null,
    evidence_excerpt: context.evidenceExcerpt || context.rawLocationText,
    raw_location_text: context.rawLocationText,
    location_city: context.locationCity,
    location_state: context.locationState,
    confidence: sourceConfidence,
  });
  if (locationSeed) seeds.push(locationSeed);

  const sourceQuality = context.method === "linkedin_scrape"
    ? { value: "high", confidence: 0.95 }
    : deriveSourceQuality(context.source, [], sourceConfidence);
  pushSeed(seeds, {
    ...subject,
    label_type: "source_quality",
    label_value: sourceQuality.value,
    normalized_value: sourceQuality.value,
    raw_value: context.source,
    confidence: sourceQuality.confidence,
    source: context.source,
    method: context.method || null,
    evidence_url: context.evidenceUrl || null,
    evidence_excerpt: context.evidenceExcerpt || null,
    metadata: {
      method: context.method || null,
    },
    agent_run_id: subject.agent_run_id || null,
  });

  const profileConfidence = deriveProfileConfidence(
    context.evidenceExcerpt ? 1 : 0,
    sourceConfidence,
    context.method === "linkedin_scrape",
  );
  pushSeed(seeds, {
    ...subject,
    label_type: "profile_confidence",
    label_value: profileConfidence.value,
    normalized_value: profileConfidence.value,
    raw_value: context.source,
    confidence: profileConfidence.confidence,
    source: context.source,
    method: context.method || null,
    evidence_url: context.evidenceUrl || null,
    evidence_excerpt: context.evidenceExcerpt || null,
    metadata: {
      method: context.method || null,
      suggestion_confidence: sourceConfidence,
    },
    agent_run_id: subject.agent_run_id || null,
  });

  return seeds;
}

export async function upsertDerivedLabelSuggestions(
  supabase: SupabaseAdminClient,
  seeds: DerivedLabelSeed[],
): Promise<number> {
  if (seeds.length === 0) return 0;

  const rows = seeds.map((seed) => ({
    person_id: seed.person_id || null,
    discovered_contact_id: seed.discovered_contact_id || null,
    label_type: seed.label_type,
    label_value: seed.label_value,
    normalized_value: normalizeText(seed.normalized_value),
    raw_value: seed.raw_value || null,
    confidence: clampConfidence(seed.confidence),
    source: seed.source,
    method: seed.method || null,
    evidence_url: seed.evidence_url || null,
    evidence_excerpt: truncateText(seed.evidence_excerpt || ""),
    metadata: seed.metadata || {},
    agent_run_id: seed.agent_run_id || null,
    dedupe_key: seed.dedupe_key,
    status: "pending",
    reviewed_at: null,
  }));

  const { data, error } = await supabase
    .from("derived_label_suggestions")
    .upsert(rows, { onConflict: "dedupe_key" })
    .select("id");

  if (error) {
    throw new Error(`Failed to upsert derived labels: ${error.message}`);
  }

  return data?.length || 0;
}

export function getLocationReviewRequired(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object") return true;
  return Boolean((metadata as Record<string, unknown>).review_required);
}

export function normalizeLabelMetadata(metadata: unknown): Record<string, unknown> {
  if (!metadata || typeof metadata !== "object") return {};
  return metadata as Record<string, unknown>;
}

export function getLocationLabelSummary(metadata: unknown): string {
  const record = normalizeLabelMetadata(metadata);
  const city = safeString(record.parsed_city);
  const state = safeString(record.parsed_state);
  const raw = safeString(record.raw_location_text);
  return buildLocationLabelValue(city, state, raw);
}

export function getNormalizedLabelValue(value: string): string {
  return normalizeLocationKey(value);
}
