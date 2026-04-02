export type VerificationRisk = 'low' | 'medium' | 'high';

export interface VerificationSuggestion {
  id?: string;
  person_id?: string;
  field_name: string;
  current_value?: string | null;
  suggested_value: string;
  source?: string | null;
  status?: string;
  created_at?: string;
  person_name?: string;
  evidence_url?: string | null;
  evidence_excerpt?: string | null;
  confidence?: number | null;
  method?: string | null;
  agent_run_id?: string | null;
  dedupe_key?: string | null;
}

export const VERIFICATION_FIELD_LABELS: Record<string, string> = {
  title: 'Title',
  first_name: 'First Name',
  last_name: 'Last Name',
  name: 'Full Name',
  current_position: 'Position',
  occupation: 'Occupation',
  email: 'Email',
  linkedin_url: 'LinkedIn',
  profile_photo_url: 'Profile Photo',
  bio: 'Bio',
  phone: 'Phone',
  website_url: 'Website',
  twitter_url: 'Twitter (X)',
  location_city: 'City',
  location_state: 'State',
  _status: 'Advisory Flag',
};

export function getSuggestionRisk(fieldName: string): VerificationRisk {
  if (fieldName === 'bio' || fieldName === '_status') return 'high';
  if (
    fieldName === 'current_position' ||
    fieldName === 'occupation' ||
    fieldName === 'email' ||
    fieldName === 'phone' ||
    fieldName === 'title' ||
    fieldName === 'first_name' ||
    fieldName === 'last_name' ||
    fieldName === 'name'
  ) {
    return 'medium';
  }

  return 'low';
}

export function isActionableSuggestion(fieldName: string): boolean {
  return !fieldName.startsWith('_');
}

export function getSuggestionRiskLabel(fieldName: string): string {
  const risk = getSuggestionRisk(fieldName);
  return `${risk[0].toUpperCase()}${risk.slice(1)} Risk`;
}

export function getSuggestionGuidance(fieldName: string): string {
  const risk = getSuggestionRisk(fieldName);
  if (risk === 'low') {
    return 'Low-risk field. Confirm the cited evidence matches before approving.';
  }
  if (risk === 'medium') {
    return 'Medium-risk field. Check that the evidence reflects a real profile change, not stale context.';
  }
  if (fieldName === '_status') {
    return 'High-risk advisory. Treat this as a review flag, not a direct profile write.';
  }

  return 'High-risk field. Only approve when the evidence is explicit and current.';
}

export function getMethodLabel(method?: string | null): string {
  if (method === 'linkedin_scrape') return 'LinkedIn';
  if (method === 'web_search_llm') return 'Web + LLM';
  if (!method) return 'Unknown';
  return method.replace(/_/g, ' ');
}

export function formatConfidence(confidence?: number | null): string | null {
  if (typeof confidence !== 'number' || Number.isNaN(confidence)) return null;
  return `${Math.round(confidence * 100)}% confidence`;
}

export function getSuggestionKey(
  suggestion: VerificationSuggestion,
  index: number
): string {
  return (
    suggestion.id ||
    suggestion.dedupe_key ||
    `${suggestion.field_name}:${suggestion.suggested_value}:${index}`
  );
}

export function normalizeVerificationSuggestions(raw: unknown): VerificationSuggestion[] {
  if (!Array.isArray(raw)) return [];

  return raw.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const suggestion = item as Record<string, unknown>;
    const fieldName = typeof suggestion.field_name === 'string' ? suggestion.field_name : '';
    const suggestedValue =
      typeof suggestion.suggested_value === 'string' ? suggestion.suggested_value : '';

    if (!fieldName || !suggestedValue) return [];

    return [{
      id: typeof suggestion.id === 'string' ? suggestion.id : undefined,
      person_id: typeof suggestion.person_id === 'string' ? suggestion.person_id : undefined,
      field_name: fieldName,
      current_value:
        typeof suggestion.current_value === 'string' ? suggestion.current_value : null,
      suggested_value: suggestedValue,
      source: typeof suggestion.source === 'string' ? suggestion.source : null,
      status: typeof suggestion.status === 'string' ? suggestion.status : undefined,
      created_at: typeof suggestion.created_at === 'string' ? suggestion.created_at : undefined,
      person_name:
        typeof suggestion.person_name === 'string' ? suggestion.person_name : undefined,
      evidence_url:
        typeof suggestion.evidence_url === 'string' ? suggestion.evidence_url : null,
      evidence_excerpt:
        typeof suggestion.evidence_excerpt === 'string'
          ? suggestion.evidence_excerpt
          : null,
      confidence:
        typeof suggestion.confidence === 'number'
          ? suggestion.confidence
          : typeof suggestion.confidence === 'string' &&
              suggestion.confidence.trim() !== '' &&
              !Number.isNaN(Number(suggestion.confidence))
            ? Number(suggestion.confidence)
            : null,
      method: typeof suggestion.method === 'string' ? suggestion.method : null,
      agent_run_id:
        typeof suggestion.agent_run_id === 'string' ? suggestion.agent_run_id : null,
      dedupe_key:
        typeof suggestion.dedupe_key === 'string' ? suggestion.dedupe_key : null,
    }];
  });
}
