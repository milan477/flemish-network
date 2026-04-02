export type DerivedLabelType =
  | 'sector'
  | 'occupation'
  | 'flemish_entity'
  | 'us_location'
  | 'source_quality'
  | 'profile_confidence';

export interface DerivedLabelSuggestion {
  id: string;
  person_id?: string | null;
  discovered_contact_id?: string | null;
  label_type: DerivedLabelType;
  label_value: string;
  normalized_value?: string | null;
  raw_value?: string | null;
  confidence?: number | null;
  source?: string | null;
  method?: string | null;
  evidence_url?: string | null;
  evidence_excerpt?: string | null;
  metadata?: Record<string, unknown> | null;
  agent_run_id?: string | null;
  dedupe_key?: string | null;
  status?: string;
  created_at?: string;
  updated_at?: string;
  reviewed_at?: string | null;
  promoted_at?: string | null;
  person_name?: string;
}

export const DERIVED_LABEL_TYPE_LABELS: Record<DerivedLabelType, string> = {
  sector: 'Sector',
  occupation: 'Career Stage',
  flemish_entity: 'Flemish Entity',
  us_location: 'US Location',
  source_quality: 'Source Quality',
  profile_confidence: 'Profile Confidence',
};

export function normalizeDerivedLabelSuggestions(raw: unknown): DerivedLabelSuggestion[] {
  if (!Array.isArray(raw)) return [];

  return raw.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    const labelType = typeof row.label_type === 'string' ? row.label_type : '';
    const labelValue = typeof row.label_value === 'string' ? row.label_value : '';

    if (!labelType || !labelValue) return [];

    return [{
      id: typeof row.id === 'string' ? row.id : '',
      person_id: typeof row.person_id === 'string' ? row.person_id : null,
      discovered_contact_id:
        typeof row.discovered_contact_id === 'string' ? row.discovered_contact_id : null,
      label_type: labelType as DerivedLabelType,
      label_value: labelValue,
      normalized_value:
        typeof row.normalized_value === 'string' ? row.normalized_value : null,
      raw_value: typeof row.raw_value === 'string' ? row.raw_value : null,
      confidence:
        typeof row.confidence === 'number'
          ? row.confidence
          : typeof row.confidence === 'string' && row.confidence.trim() !== ''
            ? Number(row.confidence)
            : null,
      source: typeof row.source === 'string' ? row.source : null,
      method: typeof row.method === 'string' ? row.method : null,
      evidence_url: typeof row.evidence_url === 'string' ? row.evidence_url : null,
      evidence_excerpt:
        typeof row.evidence_excerpt === 'string' ? row.evidence_excerpt : null,
      metadata:
        row.metadata && typeof row.metadata === 'object'
          ? (row.metadata as Record<string, unknown>)
          : null,
      agent_run_id: typeof row.agent_run_id === 'string' ? row.agent_run_id : null,
      dedupe_key: typeof row.dedupe_key === 'string' ? row.dedupe_key : null,
      status: typeof row.status === 'string' ? row.status : 'pending',
      created_at: typeof row.created_at === 'string' ? row.created_at : undefined,
      updated_at: typeof row.updated_at === 'string' ? row.updated_at : undefined,
      reviewed_at: typeof row.reviewed_at === 'string' ? row.reviewed_at : null,
      promoted_at: typeof row.promoted_at === 'string' ? row.promoted_at : null,
      person_name: typeof row.person_name === 'string' ? row.person_name : undefined,
    }];
  });
}

export function formatDerivedLabelConfidence(confidence?: number | null): string | null {
  if (typeof confidence !== 'number' || Number.isNaN(confidence)) return null;
  return `${Math.round(confidence * 100)}% confidence`;
}

export function isCanonicalDerivedLabel(labelType: DerivedLabelType): boolean {
  return (
    labelType === 'sector' ||
    labelType === 'occupation' ||
    labelType === 'flemish_entity' ||
    labelType === 'us_location'
  );
}

export function getDerivedLabelMetadata(
  suggestion: Pick<DerivedLabelSuggestion, 'metadata'>
): Record<string, unknown> {
  return suggestion.metadata || {};
}

export function getDerivedLocationSummary(suggestion: DerivedLabelSuggestion): string {
  const metadata = getDerivedLabelMetadata(suggestion);
  const city =
    typeof metadata.parsed_city === 'string' ? metadata.parsed_city.trim() : '';
  const state =
    typeof metadata.parsed_state === 'string' ? metadata.parsed_state.trim() : '';
  const raw =
    typeof metadata.raw_location_text === 'string'
      ? metadata.raw_location_text.trim()
      : '';

  const pieces = [city, state].filter(Boolean);
  if (pieces.length > 0) return pieces.join(', ');
  return raw || suggestion.label_value;
}

export function getDerivedLabelBadgeClasses(labelType: DerivedLabelType): string {
  if (labelType === 'sector') return 'bg-blue-50 text-blue-700';
  if (labelType === 'occupation') return 'bg-teal-50 text-teal-700';
  if (labelType === 'flemish_entity') return 'bg-amber-50 text-amber-700';
  if (labelType === 'us_location') return 'bg-emerald-50 text-emerald-700';
  if (labelType === 'source_quality') return 'bg-slate-100 text-slate-700';
  return 'bg-purple-50 text-purple-700';
}
