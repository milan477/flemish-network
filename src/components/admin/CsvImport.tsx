import { useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  Columns,
  Download,
  FileSpreadsheet,
  Upload,
  User,
} from 'lucide-react';
import { supabase, type OrganizationUsNetworkStatus } from '../../lib/supabase';
import {
  FULL_NAME_FIELD,
  ORGANIZATION_FIELDS,
  PROFILE_FIELDS,
  applyMappings,
  buildCandidateKeyForMode,
  downloadTemplate,
  normalizePeopleStatus,
  parseCSV,
  parseExcel,
  splitImportMultiValue,
  suggestMappingsForMode,
  validateRowsForMode,
  type CsvParseResult,
  type FieldMapping,
  type ImportEntityMode,
  type MappedRow,
} from '../../lib/csvParser';

type Step = 'upload' | 'map' | 'confirm' | 'done';

interface CsvImportProps {
  onContactAdded: () => void;
}

interface ConflictInfo {
  rowIdx: number;
  kind: 'approved' | 'pending' | 'file';
  label: string;
}

interface ImportSummary {
  created: number;
  skipped: number;
  failed: number;
  conflicts: number;
  warnings: { row: number; name: string; reason: string }[];
  errors: { row: number; name: string; reason: string }[];
}

const ENTITY_OPTIONS: { value: ImportEntityMode; label: string; icon: typeof User }[] = [
  { value: 'people', label: 'People', icon: User },
  { value: 'organizations', label: 'Organizations', icon: Building2 },
];

const ORGANIZATION_STATUS_ALIASES = new Map<string, OrganizationUsNetworkStatus>([
  ['us based', 'us_based_organization'],
  ['us based organization', 'us_based_organization'],
  ['belgian organization with us presence', 'belgian_organization_with_us_presence'],
  ['belgian with us presence', 'belgian_organization_with_us_presence'],
  ['us organization connected to flanders', 'us_organization_connected_to_flanders'],
  ['us connected to flanders', 'us_organization_connected_to_flanders'],
  ['institutional connector', 'institutional_connector'],
]);

const PREVIEW_WORD_LIMIT = 14;

function ensureProtocol(url: string | undefined): string | null {
  const trimmed = (url || '').trim();
  if (!trimmed) return null;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function confidenceLabel(score: number): { text: string; color: string } {
  if (score >= 0.85) return { text: 'Exact', color: 'text-green-600 bg-green-50' };
  if (score >= 0.6) return { text: 'Good', color: 'text-yellow-700 bg-yellow-50' };
  if (score >= 0.4) return { text: 'Possible', color: 'text-amber-600 bg-amber-50' };
  return { text: '', color: '' };
}

function personName(row: MappedRow): string {
  return [row.title, row.first_name, row.last_name].filter(Boolean).join(' ').trim();
}

function normalizeName(value: string | undefined): string {
  return (value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeUrl(value: string | undefined): string {
  return (value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/$/, '');
}

function normalizeOrgStatus(raw: string | undefined): OrganizationUsNetworkStatus | null {
  const key = (raw || '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  if (!key) return null;
  return ORGANIZATION_STATUS_ALIASES.get(key) || 'us_organization_connected_to_flanders';
}

function previewText(fieldKey: string, value: string | undefined): string {
  const normalized = (value || '').trim().replace(/\s+/g, ' ');
  if (!normalized) return '-';
  if (fieldKey !== 'bio') return normalized;

  const words = normalized.split(' ');
  if (words.length <= PREVIEW_WORD_LIMIT) return normalized;
  return `${words.slice(0, PREVIEW_WORD_LIMIT).join(' ')}...`;
}

async function checkConflicts(rows: MappedRow[], mode: ImportEntityMode): Promise<ConflictInfo[]> {
  const conflicts: ConflictInfo[] = [];
  const seen = new Map<string, number>();

  rows.forEach((row, rowIdx) => {
    const key = buildCandidateKeyForMode(row, mode);
    const firstSeen = seen.get(key);
    if (firstSeen !== undefined) {
      conflicts.push({ rowIdx, kind: 'file', label: `Duplicate of row ${firstSeen + 1}` });
    } else {
      seen.set(key, rowIdx);
    }
  });

  if (mode === 'people') {
    const [{ data: approved }, { data: pending }] = await Promise.all([
      supabase.from('people').select('name, first_name, last_name, email, linkedin_url'),
      supabase
        .from('discovered_contacts')
        .select('name, email, linkedin_url, candidate_key')
        .eq('status', 'pending'),
    ]);

    rows.forEach((row, rowIdx) => {
      const rowEmail = normalizeName(row.email);
      const rowLinkedin = normalizeUrl(row.linkedin_url);
      const rowFullName = normalizeName(personName(row));
      const rowKey = buildCandidateKeyForMode(row, mode);

      const approvedMatch = (approved || []).find((person) => {
        const approvedName = normalizeName(person.name || `${person.first_name || ''} ${person.last_name || ''}`);
        return (
          (rowEmail && normalizeName(person.email) === rowEmail) ||
          (rowLinkedin && normalizeUrl(person.linkedin_url) === rowLinkedin) ||
          (rowFullName && approvedName === rowFullName)
        );
      });
      if (approvedMatch) {
        conflicts.push({ rowIdx, kind: 'approved', label: approvedMatch.name || 'Approved person' });
        return;
      }

      const pendingMatch = (pending || []).find((candidate) => {
        return (
          candidate.candidate_key === rowKey ||
          (rowEmail && normalizeName(candidate.email) === rowEmail) ||
          (rowLinkedin && normalizeUrl(candidate.linkedin_url) === rowLinkedin) ||
          (rowFullName && normalizeName(candidate.name) === rowFullName)
        );
      });
      if (pendingMatch) {
        conflicts.push({ rowIdx, kind: 'pending', label: pendingMatch.name || 'Pending person' });
      }
    });
  } else {
    const [{ data: approved }, { data: pending }] = await Promise.all([
      supabase.from('organizations').select('name, website_url'),
      supabase
        .from('discovered_organizations')
        .select('name, website_url, candidate_key')
        .eq('status', 'pending'),
    ]);

    rows.forEach((row, rowIdx) => {
      const rowWebsite = normalizeUrl(row.website_url);
      const rowName = normalizeName(row.name);
      const rowKey = buildCandidateKeyForMode(row, mode);
      const approvedMatch = (approved || []).find(
        (org) =>
          (rowWebsite && normalizeUrl(org.website_url) === rowWebsite) ||
          (rowName && normalizeName(org.name) === rowName)
      );
      if (approvedMatch) {
        conflicts.push({ rowIdx, kind: 'approved', label: approvedMatch.name || 'Approved organization' });
        return;
      }

      const pendingMatch = (pending || []).find(
        (org) =>
          org.candidate_key === rowKey ||
          (rowWebsite && normalizeUrl(org.website_url) === rowWebsite) ||
          (rowName && normalizeName(org.name) === rowName)
      );
      if (pendingMatch) {
        conflicts.push({ rowIdx, kind: 'pending', label: pendingMatch.name || 'Pending organization' });
      }
    });
  }

  return conflicts;
}

export default function CsvImport({ onContactAdded }: CsvImportProps) {
  const [mode, setMode] = useState<ImportEntityMode>('people');
  const [step, setStep] = useState<Step>('upload');
  const [parsed, setParsed] = useState<CsvParseResult | null>(null);
  const [mappings, setMappings] = useState<FieldMapping[]>([]);
  const [validRows, setValidRows] = useState<MappedRow[]>([]);
  const [invalidRows, setInvalidRows] = useState<{ row: MappedRow; reason: string }[]>([]);
  const [conflicts, setConflicts] = useState<ConflictInfo[]>([]);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const fields = useMemo(
    () => (mode === 'people' ? [...PROFILE_FIELDS, FULL_NAME_FIELD] : ORGANIZATION_FIELDS),
    [mode]
  );
  const mappedPreviewFields = useMemo(
    () =>
      mappings
        .filter((mapping) => mapping.csvColumn)
        .map((mapping) => fields.find((field) => field.key === mapping.fieldKey))
        .filter((field): field is typeof fields[number] => Boolean(field)),
    [fields, mappings]
  );
  const requiredMapped = useMemo(() => {
    if (mode === 'people') {
      return Boolean(
        mappings.find((mapping) => mapping.fieldKey === 'first_name' && mapping.csvColumn) ||
          mappings.find((mapping) => mapping.fieldKey === '_full_name' && mapping.csvColumn)
      );
    }
    return Boolean(mappings.find((mapping) => mapping.fieldKey === 'name' && mapping.csvColumn));
  }, [mappings, mode]);

  const conflictIdxSet = new Set(conflicts.map((conflict) => conflict.rowIdx));
  const importableRows = validRows.filter((_, index) => !conflictIdxSet.has(index));

  const handleReset = () => {
    setStep('upload');
    setParsed(null);
    setMappings([]);
    setValidRows([]);
    setInvalidRows([]);
    setConflicts([]);
    setSummary(null);
    setFileName('');
    setError('');
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError('');
    setSummary(null);
    setFileName(file.name);

    const load = (result: CsvParseResult) => {
      if (result.headers.length === 0) {
        setError('No headers found in the file');
        return;
      }
      if (result.rows.length === 0) {
        setError('File has headers but no data rows');
        return;
      }
      setParsed(result);
      setMappings(suggestMappingsForMode(result.headers, mode));
      setStep('map');
    };

    if (/\.xlsx?$/i.test(file.name)) {
      const reader = new FileReader();
      reader.onload = (ev) => load(parseExcel(ev.target?.result as ArrayBuffer));
      reader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
      reader.onload = (ev) => load(parseCSV(String(ev.target?.result || '')));
      reader.readAsText(file);
    }
  };

  const handleConfirm = async () => {
    if (!parsed) return;
    setBusy(true);
    const mapped = applyMappings(parsed.rows, parsed.headers, mappings);
    const { valid, invalid } = validateRowsForMode(mapped, mode);
    const foundConflicts = await checkConflicts(valid, mode);
    setValidRows(valid);
    setInvalidRows(invalid);
    setConflicts(foundConflicts);
    setBusy(false);
    setStep('confirm');
  };

  const insertPersonCandidate = async (row: MappedRow) => {
    const name = personName(row);
    const nowIso = new Date().toISOString();
    const normalizedStatus =
      normalizePeopleStatus(row.us_network_status) ||
      (row.current_location_city || row.us_connection_city ? 'us_connected_abroad' : 'us_based');

    return supabase.from('discovered_contacts').insert({
      name,
      email: row.email || null,
      linkedin_url: ensureProtocol(row.linkedin_url),
      current_position: row.current_position || null,
      occupation: row.occupation || null,
      location_city: row.location_city || null,
      location_state: row.location_state || null,
      bio: row.bio || null,
      flemish_connection: row.flemish_connection || null,
      website_url: ensureProtocol(row.website_url),
      sectors: splitImportMultiValue(row.sectors),
      source: 'import',
      status: 'pending',
      last_seen_at: nowIso,
      source_urls: splitImportMultiValue(row.us_connection_source_url),
      candidate_key: buildCandidateKeyForMode(row, 'people'),
      suggested_us_network_status: normalizedStatus,
      current_location_city: row.current_location_city || null,
      current_location_country: row.current_location_country || null,
      suggested_us_connections:
        row.us_connection_city && row.us_connection_state
          ? [
              {
                location_city: row.us_connection_city,
                location_state: row.us_connection_state,
                connection_label: row.us_connection_label || null,
                source_url: ensureProtocol(row.us_connection_source_url),
                evidence_excerpt: row.us_connection_evidence || null,
                confidence: null,
              },
            ]
          : [],
      discovery_confidence: null,
    });
  };

  const insertOrganizationCandidate = async (row: MappedRow) => {
    const nowIso = new Date().toISOString();
    const sourceUrls = splitImportMultiValue(row.source_url).map((url) => ensureProtocol(url)).filter(Boolean);
    const evidenceExcerpt = (row.evidence_excerpt || '').trim();
    const { data, error: insertError } = await supabase
      .from('discovered_organizations')
      .insert({
        name: row.name.trim(),
        website_url: ensureProtocol(row.website_url),
        description: row.description || null,
        candidate_key: buildCandidateKeyForMode(row, 'organizations'),
        source: 'import',
        status: 'pending',
        last_seen_at: nowIso,
        last_evidence_at: sourceUrls[0] || evidenceExcerpt ? nowIso : null,
        suggested_us_network_status: normalizeOrgStatus(row.us_network_status),
        us_locations:
          row.location_city && row.location_state
            ? [
                {
                  city: row.location_city,
                  state: row.location_state,
                  role: row.location_role || 'other',
                  source_url: sourceUrls[0] || null,
                  evidence_excerpt: evidenceExcerpt || null,
                  confidence: null,
                },
              ]
            : [],
        sectors: splitImportMultiValue(row.sectors),
        flemish_belgian_relevance: row.flemish_belgian_relevance || null,
        source_urls: sourceUrls,
        confidence: null,
      })
      .select('id')
      .maybeSingle();

    if (insertError || !data) return { error: insertError || new Error('Failed to create pending organization') };

    if (sourceUrls[0] || evidenceExcerpt) {
      const { error: evidenceError } = await supabase.from('discovered_organization_evidence').insert({
        discovered_organization_id: data.id,
        evidence_key: `${buildCandidateKeyForMode(row, 'organizations')}:import:${sourceUrls[0] || evidenceExcerpt}`,
        page_url: sourceUrls[0] || row.website_url || 'manual-import',
        source_type: 'import',
        source_url: sourceUrls[0] || null,
        evidence_excerpt: evidenceExcerpt || null,
        raw_relevance_text: row.flemish_belgian_relevance || null,
        raw_location_text: [row.location_city, row.location_state].filter(Boolean).join(', ') || null,
        raw_sector_text: row.sectors || null,
        normalized_location_city: row.location_city || null,
        normalized_location_state: row.location_state || null,
        normalized_location_country: row.location_city ? 'United States' : null,
        confidence: null,
        observed_at: nowIso,
      });
      if (evidenceError) return { error: evidenceError };
    }

    return { error: null };
  };

  const handleImport = async () => {
    setBusy(true);
    const nextSummary: ImportSummary = {
      created: 0,
      skipped: conflicts.length,
      failed: 0,
      conflicts: conflicts.length,
      warnings: [],
      errors: [],
    };

    for (const [index, row] of validRows.entries()) {
      if (conflictIdxSet.has(index)) continue;

      const display = mode === 'people' ? personName(row) : row.name;
      const { error: insertError } =
        mode === 'people'
          ? await insertPersonCandidate(row)
          : await insertOrganizationCandidate(row);

      if (insertError) {
        nextSummary.failed += 1;
        nextSummary.errors.push({
          row: index + 1,
          name: display || '(unnamed)',
          reason: insertError.message,
        });
      } else {
        nextSummary.created += 1;
        if (
          mode === 'people' &&
          !(row.us_connection_source_url || row.us_connection_evidence || row.bio || row.flemish_connection)
        ) {
          nextSummary.warnings.push({
            row: index + 1,
            name: display,
            reason: 'Weak evidence; candidate will need careful review',
          });
        }
      }
    }

    setSummary(nextSummary);
    setBusy(false);
    onContactAdded();
    setStep('done');
  };

  return (
    <div className="space-y-5">
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-600">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {step === 'upload' && (
        <div className="space-y-4">
          <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1">
            {ENTITY_OPTIONS.map((option) => {
              const Icon = option.icon;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    setMode(option.value);
                    handleReset();
                  }}
                  className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium ${
                    mode === option.value
                      ? 'bg-yellow-100 text-yellow-800'
                      : 'text-gray-500 hover:bg-gray-50'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {option.label}
                </button>
              );
            })}
          </div>

          <div
            onClick={() => fileRef.current?.click()}
            className="cursor-pointer rounded-xl border-2 border-dashed border-yellow-200 p-10 text-center transition-all hover:border-yellow-400 hover:bg-yellow-50/40"
          >
            <Upload className="mx-auto mb-3 h-9 w-9 text-yellow-400" />
            <p className="mb-1 text-sm font-medium text-gray-700">Click to upload a file</p>
            <p className="text-xs text-gray-400">
              Accepted formats: .csv, .xlsx, .xls, .tsv, .txt. Imports create pending candidates only.
            </p>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.txt,.tsv,.xlsx,.xls"
            onChange={handleFile}
            className="hidden"
          />

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => downloadTemplate('csv', mode)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-yellow-200 bg-yellow-50 px-3 py-1.5 text-xs text-yellow-700 hover:bg-yellow-100"
            >
              <Download className="h-3.5 w-3.5" />
              Download {mode === 'people' ? 'people' : 'organization'} CSV template
            </button>
            <button
              type="button"
              onClick={() => downloadTemplate('xlsx', mode)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-yellow-200 bg-yellow-50 px-3 py-1.5 text-xs text-yellow-700 hover:bg-yellow-100"
            >
              <Download className="h-3.5 w-3.5" />
              Download {mode === 'people' ? 'people' : 'organization'} Excel template
            </button>
          </div>
        </div>
      )}

      {step === 'map' && parsed && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-yellow-50">
                <FileSpreadsheet className="h-4 w-4 text-yellow-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900">Map Columns</p>
                <p className="text-xs text-gray-500">
                  {fileName} -- {parsed.totalRows} rows, {parsed.headers.length} columns
                </p>
              </div>
            </div>
            <button type="button" onClick={handleReset} className="text-xs text-gray-400 hover:text-gray-600">
              Start over
            </button>
          </div>

          <div className="overflow-hidden rounded-xl border border-yellow-200 bg-yellow-50/40">
            <div className="grid grid-cols-[1fr,auto,1fr,auto] items-center gap-0 border-b border-yellow-200 bg-yellow-100/50 px-4 py-2.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-yellow-700">Field</span>
              <span />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-yellow-700">File Column</span>
              <span className="text-right text-[10px] font-semibold uppercase tracking-wider text-yellow-700">Match</span>
            </div>
            <div className="divide-y divide-yellow-100">
              {fields.map((field) => {
                const mapping = mappings.find((entry) => entry.fieldKey === field.key);
                if (!mapping) return null;
                const selected = mapping.csvColumn || '';
                const confInfo = selected ? confidenceLabel(mapping.confidence || 0) : { text: '', color: '' };
                return (
                  <div key={field.key} className="grid grid-cols-[1fr,auto,1fr,auto] items-center gap-3 px-4 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm text-gray-800">{field.label}</span>
                      {field.required && <span className="text-[10px] font-semibold text-red-500">*</span>}
                    </div>
                    <ArrowRight className="h-3.5 w-3.5 text-yellow-300" />
                    <div className="relative">
                      <select
                        value={selected}
                        onChange={(event) =>
                          setMappings((prev) =>
                            prev.map((entry) =>
                              entry.fieldKey === field.key
                                ? { ...entry, csvColumn: event.target.value, confidence: event.target.value ? 1 : 0 }
                                : entry
                            )
                          )
                        }
                        className="w-full appearance-none rounded-lg border border-gray-200 bg-white py-1.5 pl-3 pr-8 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-yellow-400"
                      >
                        <option value="">-- Skip --</option>
                        {parsed.headers.map((header) => (
                          <option key={header} value={header}>
                            {header}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
                    </div>
                    <div className="w-16 text-right">
                      {confInfo.text && (
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${confInfo.color}`}>
                          {confInfo.text}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {!requiredMapped && (
            <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-600">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />
              <span>{mode === 'people' ? 'First Name or Full Name must be mapped.' : 'Organization Name must be mapped.'}</span>
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleConfirm}
              disabled={!requiredMapped || busy}
              className="inline-flex items-center gap-2 rounded-lg bg-yellow-500 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-yellow-600 disabled:bg-gray-200 disabled:text-gray-400"
            >
              <Columns className="h-4 w-4" />
              Preview Import
            </button>
            <button type="button" onClick={handleReset} className="text-sm text-gray-500 hover:text-gray-700">
              Cancel
            </button>
          </div>
        </div>
      )}

      {step === 'confirm' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-900">Confirm Import</p>
              <p className="text-xs text-gray-500">
                {importableRows.length} pending candidates, {conflicts.length} conflicts, {invalidRows.length} invalid
              </p>
            </div>
            <button type="button" onClick={() => setStep('map')} className="text-xs text-gray-400 hover:text-gray-600">
              Back to mapping
            </button>
          </div>

          {conflicts.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
              <p className="mb-1.5 text-xs font-medium text-amber-700">
                Conflicting rows will be skipped. Imports do not update approved records.
              </p>
              <div className="max-h-24 space-y-0.5 overflow-y-auto">
                {conflicts.map((conflict, index) => (
                  <p key={index} className="text-[11px] text-amber-700">
                    Row {conflict.rowIdx + 1}: {conflict.kind} conflict with {conflict.label}
                  </p>
                ))}
              </div>
            </div>
          )}

          {invalidRows.length > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
              <p className="mb-1.5 text-xs font-medium text-red-700">Invalid rows will be skipped:</p>
              <div className="max-h-24 space-y-0.5 overflow-y-auto">
                {invalidRows.map((row, index) => (
                  <p key={index} className="text-[11px] text-red-600">
                    Row {index + 1}: {row.reason}
                  </p>
                ))}
              </div>
            </div>
          )}

          <div className="max-h-72 overflow-auto rounded-lg border border-yellow-200">
            <table
              className="w-full text-xs"
              style={{ minWidth: `${Math.max(760, mappedPreviewFields.length * 150 + 120)}px` }}
            >
              <thead className="sticky top-0 bg-yellow-50">
                <tr>
                  {mappedPreviewFields.map((field) => (
                    <th key={field.key} className="px-3 py-2 text-left font-medium text-yellow-700">
                      {field.label}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-left font-medium text-yellow-700">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-yellow-100">
                {validRows.map((row, index) => {
                  const conflicted = conflictIdxSet.has(index);
                  return (
                    <tr key={index} className={conflicted ? 'bg-amber-50/60 text-gray-400' : 'text-gray-700'}>
                      {mappedPreviewFields.map((field) => (
                        <td
                          key={field.key}
                          className={`px-3 py-2 align-top ${
                            field.key === 'bio' ? 'max-w-[260px] whitespace-normal' : 'whitespace-nowrap'
                          }`}
                        >
                          {field.key === '_full_name'
                            ? personName(row)
                            : previewText(field.key, row[field.key])}
                        </td>
                      ))}
                      <td className="px-3 py-2">
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${conflicted ? 'bg-amber-100 text-amber-700' : 'bg-green-50 text-green-700'}`}>
                          {conflicted ? 'Skip' : 'Pending'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <button
            type="button"
            onClick={handleImport}
            disabled={importableRows.length === 0 || busy}
            className="inline-flex items-center gap-2 rounded-lg bg-yellow-500 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-yellow-600 disabled:opacity-50"
          >
            <Upload className="h-4 w-4" />
            Create {importableRows.length} Pending Candidate{importableRows.length !== 1 ? 's' : ''}
          </button>
        </div>
      )}

      {step === 'done' && summary && (
        <div className="space-y-4">
          <div className="py-4 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-yellow-100">
              <CheckCircle2 className="h-6 w-6 text-yellow-600" />
            </div>
            <p className="text-sm font-semibold text-gray-900">Import Complete</p>
            <p className="mt-1 text-xs text-gray-500">
              Created {summary.created} pending candidate{summary.created !== 1 ? 's' : ''}; skipped {summary.skipped}.
            </p>
          </div>

          {summary.errors.length > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
              <p className="mb-1.5 text-xs font-medium text-red-700">Failed rows:</p>
              {summary.errors.map((entry, index) => (
                <p key={index} className="text-[11px] text-red-600">
                  Row {entry.row} ({entry.name}): {entry.reason}
                </p>
              ))}
            </div>
          )}

          {summary.warnings.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
              <p className="mb-1.5 text-xs font-medium text-amber-700">Warnings:</p>
              {summary.warnings.map((entry, index) => (
                <p key={index} className="text-[11px] text-amber-700">
                  Row {entry.row} ({entry.name}): {entry.reason}
                </p>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={handleReset}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            <Check className="h-4 w-4" />
            Done
          </button>
        </div>
      )}
    </div>
  );
}
