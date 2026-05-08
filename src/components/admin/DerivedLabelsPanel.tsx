import { useState } from 'react';
import {
  CheckCircle,
  ExternalLink,
  Inbox,
  Loader2,
  MapPin,
  Tag,
  XCircle,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { kickEmbeddingWorker } from '../../lib/embeddingRefresh';
import {
  DERIVED_LABEL_TYPE_LABELS,
  formatDerivedLabelConfidence,
  getDerivedLabelBadgeClasses,
  getDerivedLabelMetadata,
  getDerivedLocationSummary,
  isCanonicalDerivedLabel,
  type DerivedLabelSuggestion,
} from '../../lib/derivedLabels';
import { canonicalizeFlemishConnection } from '../../lib/flemishConnections';
import { resolveLocationId } from '../../lib/locations';

interface DerivedLabelsPanelProps {
  labels: DerivedLabelSuggestion[];
  onRefresh: () => void;
}

export default function DerivedLabelsPanel({
  labels,
  onRefresh,
}: DerivedLabelsPanelProps) {
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const pending = labels.filter((label) => label.status === 'pending');

  const approveLabel = async (label: DerivedLabelSuggestion) => {
    setProcessingIds((prev) => new Set([...prev, label.id]));
    setErrorMsg(null);

    try {
      const now = new Date().toISOString();
      let promotedAt: string | null = null;
      let shouldKickEmbeddings = false;

      if (label.person_id && isCanonicalDerivedLabel(label.label_type)) {
        if (label.label_type === 'occupation') {
          const { error } = await supabase
            .from('people')
            .update({ occupation: label.label_value, updated_at: now })
            .eq('id', label.person_id);
          if (error) throw new Error(error.message);
          promotedAt = now;
          shouldKickEmbeddings = true;
        }

        if (label.label_type === 'sector') {
          const { data: sectorRow, error: sectorError } = await supabase
            .from('sectors')
            .select('id')
            .eq('name', label.label_value)
            .limit(1)
            .maybeSingle();

          if (sectorError || !sectorRow?.id) {
            throw new Error(sectorError?.message || `Unknown sector "${label.label_value}"`);
          }

          const { error } = await supabase
            .from('person_sectors')
            .upsert(
              [{ person_id: label.person_id, sector_id: sectorRow.id }],
              {
                onConflict: 'person_id,sector_id',
                ignoreDuplicates: true,
              }
            );
          if (error) throw new Error(error.message);
          promotedAt = now;
          shouldKickEmbeddings = true;
        }

        if (label.label_type === 'flemish_entity') {
          const metadata = getDerivedLabelMetadata(label);
          const rawValue =
            (typeof metadata.raw_value === 'string' && metadata.raw_value) ||
            label.raw_value ||
            label.label_value;
          const canonical = canonicalizeFlemishConnection(rawValue) ||
            canonicalizeFlemishConnection(label.label_value) || {
              name: label.label_value,
              type: 'other' as const,
            };

          const { data: lookupRows, error: lookupError } = await supabase.rpc(
            'lookup_flemish_connection',
            { raw_name: rawValue }
          );
          if (lookupError) throw new Error(lookupError.message);

          let connectionId = Array.isArray(lookupRows) && lookupRows[0]?.id
            ? String(lookupRows[0].id)
            : null;

          if (!connectionId) {
            const { data: ensuredId, error: ensureError } = await supabase.rpc(
              'ensure_flemish_connection',
              {
                p_name: canonical.name,
                p_type: canonical.type,
                p_is_filterable: false,
                p_connection_group: 'derived_label',
              }
            );
            if (ensureError || !ensuredId) {
              throw new Error(ensureError?.message || 'Failed to create Flemish entity');
            }
            connectionId = String(ensuredId);
          }

          const { error } = await supabase
            .from('person_flemish_connections')
            .upsert(
              [{
                person_id: label.person_id,
                flemish_connection_id: connectionId,
                role: typeof metadata.role === 'string' && metadata.role
                  ? metadata.role
                  : 'derived_label',
                confidence: label.confidence ?? null,
                source_url: label.evidence_url || null,
                evidence_excerpt: label.evidence_excerpt || rawValue,
              }],
              {
                onConflict: 'person_id,flemish_connection_id',
                ignoreDuplicates: false,
              }
            );
          if (error) throw new Error(error.message);

          const alias = typeof metadata.candidate_alias === 'string'
            ? metadata.candidate_alias.trim()
            : '';
          if (alias && alias.toLowerCase() !== canonical.name.toLowerCase()) {
            await supabase.rpc('add_flemish_connection_alias', {
              p_connection_name: canonical.name,
              p_alias: alias,
              p_source: 'model',
              p_status: 'pending',
              p_confidence: label.confidence ?? null,
              p_source_url: label.evidence_url || null,
              p_evidence_excerpt: label.evidence_excerpt || rawValue,
            });
          }

          promotedAt = now;
          shouldKickEmbeddings = true;
        }

        if (label.label_type === 'us_location') {
          const metadata = getDerivedLabelMetadata(label);
          const city =
            typeof metadata.parsed_city === 'string' ? metadata.parsed_city : '';
          const state =
            typeof metadata.parsed_state === 'string' ? metadata.parsed_state : '';
          const locationId =
            (typeof metadata.location_id === 'string' && metadata.location_id) ||
            (await resolveLocationId(city, state, { createIfMissing: true }));

          if (!locationId) {
            throw new Error('Could not resolve the suggested US location.');
          }

          const { error } = await supabase
            .from('people')
            .update({ location_id: locationId, updated_at: now })
            .eq('id', label.person_id);
          if (error) throw new Error(error.message);
          promotedAt = now;
          shouldKickEmbeddings = true;
        }
      }

      const { error: approvalError } = await supabase
        .from('derived_label_suggestions')
        .update({
          status: 'approved',
          reviewed_at: now,
          promoted_at: promotedAt,
        })
        .eq('id', label.id);

      if (approvalError) {
        throw new Error(approvalError.message);
      }

      if (shouldKickEmbeddings) {
        kickEmbeddingWorker();
      }

      onRefresh();
    } catch (err) {
      setErrorMsg((err as Error).message || 'Failed to approve derived label');
    } finally {
      setProcessingIds((prev) => {
        const next = new Set(prev);
        next.delete(label.id);
        return next;
      });
    }
  };

  const rejectLabel = async (labelId: string) => {
    setProcessingIds((prev) => new Set([...prev, labelId]));
    setErrorMsg(null);

    await supabase
      .from('derived_label_suggestions')
      .update({
        status: 'rejected',
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', labelId);

    setProcessingIds((prev) => {
      const next = new Set(prev);
      next.delete(labelId);
      return next;
    });
    onRefresh();
  };

  if (pending.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-gray-400">
        <Inbox className="mb-2 h-8 w-8" />
        <p className="text-sm">No pending derived labels</p>
        <p className="mt-1 text-xs">
          Discovery and verification now populate this queue when they infer filterable labels.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {errorMsg && (
        <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">
          {errorMsg}
        </div>
      )}

      {pending.map((label) => {
        const metadata = getDerivedLabelMetadata(label);
        const isProcessing = processingIds.has(label.id);
        const displayValue =
          label.label_type === 'us_location' ? getDerivedLocationSummary(label) : label.label_value;
        const confidence = formatDerivedLabelConfidence(label.confidence);
        const reviewRequired = Boolean(metadata.review_required);
        const isCanonical = isCanonicalDerivedLabel(label.label_type);

        return (
          <div key={label.id} className="rounded-xl border border-gray-100 bg-white px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${getDerivedLabelBadgeClasses(label.label_type)}`}
                  >
                    {DERIVED_LABEL_TYPE_LABELS[label.label_type]}
                  </span>
                  {label.person_name && (
                    <span className="text-xs font-medium text-gray-700">{label.person_name}</span>
                  )}
                  {confidence && (
                    <span className="text-[10px] text-gray-500">{confidence}</span>
                  )}
                  {!isCanonical && (
                    <span className="text-[10px] rounded-full bg-gray-100 px-2 py-0.5 text-gray-600">
                      Review-only
                    </span>
                  )}
                  {reviewRequired && label.label_type === 'us_location' && (
                    <span className="text-[10px] rounded-full bg-amber-50 px-2 py-0.5 text-amber-700">
                      Review required
                    </span>
                  )}
                </div>

                <div className="mt-2 flex items-start gap-2">
                  {label.label_type === 'us_location' ? (
                    <MapPin className="mt-0.5 h-3.5 w-3.5 text-emerald-600" />
                  ) : (
                    <Tag className="mt-0.5 h-3.5 w-3.5 text-gray-400" />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900">{displayValue}</p>
                    {label.source && (
                      <p className="text-[11px] text-gray-500">{label.source}</p>
                    )}
                  </div>
                </div>

                {label.evidence_excerpt && (
                  <p className="mt-2 text-xs leading-relaxed text-gray-600">
                    {label.evidence_excerpt}
                  </p>
                )}

                {label.evidence_url && (
                  <a
                    href={label.evidence_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-700"
                  >
                    Evidence
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => approveLabel(label)}
                  disabled={isProcessing}
                  className="inline-flex items-center gap-1 rounded-lg bg-green-50 px-2.5 py-1.5 text-xs font-medium text-green-700 hover:bg-green-100 disabled:opacity-50"
                >
                  {isProcessing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CheckCircle className="h-3.5 w-3.5" />
                  )}
                  Approve
                </button>
                <button
                  onClick={() => rejectLabel(label.id)}
                  disabled={isProcessing}
                  className="inline-flex items-center gap-1 rounded-lg bg-gray-100 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-200 disabled:opacity-50"
                >
                  <XCircle className="h-3.5 w-3.5" />
                  Reject
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
