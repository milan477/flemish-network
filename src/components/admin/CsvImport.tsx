import { useState, useRef } from 'react';
import {
  Upload,
  AlertCircle,
  CheckCircle2,
  Loader2,
  X,
  ArrowRight,
  FileSpreadsheet,
  Columns,
  Check,
  AlertTriangle,
  ChevronDown,
  Users,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import {
  parseCSV,
  suggestMappings,
  applyMappings,
  validateMappedRows,
  PROFILE_FIELDS,
  FULL_NAME_FIELD,
  type FieldMapping,
  type CsvParseResult,
  type MappedRow,
} from '../../lib/csvParser';

type Step = 'upload' | 'map' | 'confirm' | 'done';

interface CsvImportProps {
  onContactAdded: () => void;
}

interface DupeInfo {
  rowIdx: number;
  existingName: string;
  existingId: string;
}

function confidenceLabel(score: number): {
  text: string;
  color: string;
} {
  if (score >= 0.85) return { text: 'Exact', color: 'text-green-600 bg-green-50' };
  if (score >= 0.6) return { text: 'Good', color: 'text-yellow-700 bg-yellow-50' };
  if (score >= 0.4) return { text: 'Possible', color: 'text-amber-600 bg-amber-50' };
  return { text: '', color: '' };
}

async function checkDuplicates(rows: MappedRow[]): Promise<DupeInfo[]> {
  const { data: allPeople } = await supabase
    .from('people')
    .select('id, first_name, last_name, name, email');

  if (!allPeople || allPeople.length === 0) return [];

  const dupes: DupeInfo[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowFirst = (row.first_name || '').trim().toLowerCase();
    const rowLast = (row.last_name || '').trim().toLowerCase();
    const rowEmail = (row.email || '').trim().toLowerCase();

    for (const person of allPeople) {
      const pFirst = (person.first_name || '').trim().toLowerCase();
      const pLast = (person.last_name || '').trim().toLowerCase();
      const pEmail = (person.email || '').trim().toLowerCase();
      const pName = (person.name || '').trim().toLowerCase();
      const rowFull = `${rowFirst} ${rowLast}`.trim();

      if (rowEmail && pEmail && rowEmail === pEmail) {
        dupes.push({ rowIdx: i, existingName: person.name || `${person.first_name} ${person.last_name}`, existingId: person.id });
        break;
      }

      if (rowFirst && rowLast && pFirst === rowFirst && pLast === rowLast) {
        dupes.push({ rowIdx: i, existingName: person.name || `${person.first_name} ${person.last_name}`, existingId: person.id });
        break;
      }

      if (rowFull && pName === rowFull) {
        dupes.push({ rowIdx: i, existingName: person.name, existingId: person.id });
        break;
      }
    }
  }

  return dupes;
}

const ALL_DISPLAY_FIELDS = [...PROFILE_FIELDS, FULL_NAME_FIELD];

export default function CsvImport({ onContactAdded }: CsvImportProps) {
  const [step, setStep] = useState<Step>('upload');
  const [parsed, setParsed] = useState<CsvParseResult | null>(null);
  const [mappings, setMappings] = useState<FieldMapping[]>([]);
  const [validRows, setValidRows] = useState<MappedRow[]>([]);
  const [invalidRows, setInvalidRows] = useState<
    { row: MappedRow; reason: string }[]
  >([]);
  const [dupes, setDupes] = useState<DupeInfo[]>([]);
  const [importing, setImporting] = useState(false);
  const [checkingDupes, setCheckingDupes] = useState(false);
  const [importResult, setImportResult] = useState('');
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setError('');
    setImportResult('');

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      if (!text) {
        setError('Could not read file');
        return;
      }

      const result = parseCSV(text);
      if (result.headers.length === 0) {
        setError('No headers found in the file');
        return;
      }
      if (result.rows.length === 0) {
        setError('File has headers but no data rows');
        return;
      }

      setParsed(result);
      const suggested = suggestMappings(result.headers);
      setMappings(suggested);
      setStep('map');
    };
    reader.readAsText(file);
  };

  const updateMapping = (fieldKey: string, csvColumn: string) => {
    setMappings((prev) =>
      prev.map((m) =>
        m.fieldKey === fieldKey
          ? { ...m, csvColumn, confidence: csvColumn ? 1 : 0 }
          : m
      )
    );
  };

  const handleConfirm = async () => {
    if (!parsed) return;
    const mapped = applyMappings(parsed.rows, parsed.headers, mappings);
    const { valid, invalid } = validateMappedRows(mapped);
    setValidRows(valid);
    setInvalidRows(invalid);

    setCheckingDupes(true);
    const found = await checkDuplicates(valid);
    setDupes(found);
    setCheckingDupes(false);

    setStep('confirm');
  };

  const handleImport = async () => {
    setImporting(true);
    let added = 0;
    let failed = 0;
    const dupeIdxSet = new Set(dupes.map((d) => d.rowIdx));

    for (let i = 0; i < validRows.length; i++) {
      if (dupeIdxSet.has(i)) continue;
      const row = validRows[i];
      const first = (row.first_name || '').trim();
      const last = (row.last_name || '').trim();
      const fullName = [row.title, first, last].filter(Boolean).join(' ');

      const { data: person } = await supabase
        .from('people')
        .insert({
          name: fullName,
          title: row.title || null,
          first_name: first,
          last_name: last || null,
          current_position: row.current_position || null,
          occupation: row.occupation || null,
          location_city: row.location_city || null,
          location_state: row.location_state || null,
          bio: row.bio || null,
          flemish_connection: row.flemish_connection || null,
          email: row.email || null,
          phone: row.phone || null,
          linkedin_url: row.linkedin_url || null,
          website_url: row.website_url || null,
          data_source: 'csv_import',
        })
        .select('id')
        .maybeSingle();

      if (person) {
        added++;
      } else {
        failed++;
      }
    }

    setImporting(false);
    const skipped = dupes.length;
    let msg = `Imported ${added} contact${added !== 1 ? 's' : ''}`;
    if (skipped > 0) msg += `, ${skipped} duplicate${skipped !== 1 ? 's' : ''} skipped`;
    if (failed > 0) msg += `, ${failed} failed`;
    setImportResult(msg);
    onContactAdded();
    setStep('done');
  };

  const handleReset = () => {
    setStep('upload');
    setParsed(null);
    setMappings([]);
    setValidRows([]);
    setInvalidRows([]);
    setDupes([]);
    setError('');
    setImportResult('');
    setFileName('');
    if (fileRef.current) fileRef.current.value = '';
  };

  const firstNameMapping = mappings.find((m) => m.fieldKey === 'first_name');
  const fullNameMapping = mappings.find((m) => m.fieldKey === '_full_name');
  const hasNameMapped = !!(
    (firstNameMapping && firstNameMapping.csvColumn) ||
    (fullNameMapping && fullNameMapping.csvColumn)
  );

  const dupeIdxSet = new Set(dupes.map((d) => d.rowIdx));
  const nonDupeCount = validRows.filter((_, i) => !dupeIdxSet.has(i)).length;

  return (
    <div className="space-y-5">
      {step === 'upload' && (
        <div>
          <div
            onClick={() => fileRef.current?.click()}
            className="border-2 border-dashed border-yellow-200 rounded-xl p-10 text-center cursor-pointer hover:border-yellow-400 hover:bg-yellow-50/40 transition-all group"
          >
            <Upload className="w-9 h-9 text-yellow-300 group-hover:text-yellow-500 mx-auto mb-3 transition-colors" />
            <p className="text-sm font-medium text-gray-700 mb-1">
              Click to upload a CSV file
            </p>
            <p className="text-xs text-gray-400 leading-relaxed max-w-md mx-auto">
              Upload any CSV and we will guide you through mapping columns to
              contact fields. Supports first name, last name, title, positions,
              locations, emails, phone numbers, and more.
            </p>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.txt,.tsv"
            onChange={handleFile}
            className="hidden"
          />
          {error && (
            <div className="flex items-center gap-2 text-sm text-red-600 mt-3">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}
          {importResult && (
            <div className="flex items-center gap-2 text-sm text-green-600 mt-3">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
              <span>{importResult}</span>
            </div>
          )}
        </div>
      )}

      {step === 'map' && parsed && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-yellow-50 flex items-center justify-center">
                <FileSpreadsheet className="w-4 h-4 text-yellow-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900">
                  Map Columns
                </p>
                <p className="text-xs text-gray-500">
                  {fileName} -- {parsed.totalRows} row
                  {parsed.totalRows !== 1 ? 's' : ''}, {parsed.headers.length}{' '}
                  column{parsed.headers.length !== 1 ? 's' : ''}
                </p>
              </div>
            </div>
            <button
              onClick={handleReset}
              className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
            >
              Start over
            </button>
          </div>

          <div className="bg-yellow-50/40 border border-yellow-200 rounded-xl overflow-hidden">
            <div className="grid grid-cols-[1fr,auto,1fr,auto] items-center gap-0 px-4 py-2.5 border-b border-yellow-200 bg-yellow-100/50">
              <span className="text-[10px] uppercase tracking-wider font-semibold text-yellow-700">
                Profile Field
              </span>
              <span />
              <span className="text-[10px] uppercase tracking-wider font-semibold text-yellow-700">
                CSV Column
              </span>
              <span className="text-[10px] uppercase tracking-wider font-semibold text-yellow-700 text-right">
                Match
              </span>
            </div>

            <div className="divide-y divide-yellow-100">
              {ALL_DISPLAY_FIELDS.map((field) => {
                const mapping = mappings.find(
                  (m) => m.fieldKey === field.key
                );
                if (!mapping) return null;
                const selected = mapping.csvColumn || '';
                const conf = mapping.confidence || 0;
                const confInfo = selected
                  ? confidenceLabel(conf)
                  : { text: '', color: '' };

                return (
                  <div
                    key={field.key}
                    className="grid grid-cols-[1fr,auto,1fr,auto] items-center gap-3 px-4 py-2.5"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm text-gray-800">
                        {field.label}
                      </span>
                      {field.required && (
                        <span className="text-[10px] text-red-500 font-semibold">
                          *
                        </span>
                      )}
                    </div>

                    <ArrowRight className="w-3.5 h-3.5 text-yellow-300" />

                    <div className="relative">
                      <select
                        value={selected}
                        onChange={(e) =>
                          updateMapping(field.key, e.target.value)
                        }
                        className={`w-full text-sm border rounded-lg pl-3 pr-8 py-1.5 appearance-none focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:border-transparent transition-all ${
                          selected
                            ? 'border-yellow-300 bg-yellow-50/60 text-gray-800'
                            : 'border-gray-200 bg-white text-gray-400'
                        }`}
                      >
                        <option value="">-- Skip --</option>
                        {parsed.headers.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
                    </div>

                    <div className="w-16 text-right">
                      {confInfo.text && (
                        <span
                          className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${confInfo.color}`}
                        >
                          {confInfo.text}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {!hasNameMapped && (
            <div className="flex items-center gap-2 text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span>
                Either <strong>First Name</strong> or <strong>Full Name</strong> must be mapped to proceed.
              </span>
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              onClick={handleConfirm}
              disabled={!hasNameMapped}
              className="flex items-center gap-2 px-5 py-2.5 bg-yellow-500 hover:bg-yellow-600 disabled:bg-gray-200 disabled:text-gray-400 text-white text-sm font-medium rounded-lg transition-colors"
            >
              <Columns className="w-4 h-4" />
              <span>Preview Import</span>
            </button>
            <button
              onClick={handleReset}
              className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {step === 'confirm' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-yellow-50 flex items-center justify-center">
                <Check className="w-4 h-4 text-yellow-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900">
                  Confirm Import
                </p>
                <p className="text-xs text-gray-500">
                  {nonDupeCount} to import, {dupes.length} duplicate{dupes.length !== 1 ? 's' : ''}, {invalidRows.length} skipped
                </p>
              </div>
            </div>
            <button
              onClick={() => setStep('map')}
              className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
            >
              Back to mapping
            </button>
          </div>

          {checkingDupes && (
            <div className="flex items-center gap-2 text-sm text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2.5">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Checking for duplicates...</span>
            </div>
          )}

          {dupes.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
              <div className="flex items-center gap-2 mb-1.5">
                <Users className="w-4 h-4 text-amber-600" />
                <p className="text-xs font-medium text-amber-700">
                  {dupes.length} duplicate{dupes.length !== 1 ? 's' : ''} found -- these will be skipped:
                </p>
              </div>
              <div className="space-y-0.5 max-h-20 overflow-y-auto">
                {dupes.map((d, i) => {
                  const row = validRows[d.rowIdx];
                  return (
                    <p key={i} className="text-[11px] text-amber-600">
                      "{row?.first_name} {row?.last_name}" matches existing "{d.existingName}"
                    </p>
                  );
                })}
              </div>
            </div>
          )}

          {invalidRows.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
              <p className="text-xs font-medium text-red-700 mb-1.5">
                {invalidRows.length} row
                {invalidRows.length !== 1 ? 's' : ''} will be skipped:
              </p>
              <div className="space-y-0.5 max-h-20 overflow-y-auto">
                {invalidRows.map((inv, i) => (
                  <p key={i} className="text-[11px] text-red-600">
                    Row {i + 1}: {inv.reason}
                  </p>
                ))}
              </div>
            </div>
          )}

          {validRows.length > 0 && (
            <div className="border border-yellow-200 rounded-lg overflow-hidden max-h-64 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-yellow-50 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left text-yellow-700 font-medium">
                      Title
                    </th>
                    <th className="px-3 py-2 text-left text-yellow-700 font-medium">
                      First Name
                    </th>
                    <th className="px-3 py-2 text-left text-yellow-700 font-medium">
                      Last Name
                    </th>
                    <th className="px-3 py-2 text-left text-yellow-700 font-medium">
                      Position
                    </th>
                    <th className="px-3 py-2 text-left text-yellow-700 font-medium">
                      Email
                    </th>
                    <th className="px-3 py-2 w-16 text-center text-yellow-700 font-medium">
                      Status
                    </th>
                    <th className="px-3 py-2 w-8" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-yellow-100">
                  {validRows.map((row, i) => {
                    const isDupe = dupeIdxSet.has(i);
                    return (
                      <tr
                        key={i}
                        className={isDupe ? 'bg-amber-50/50 opacity-60' : 'hover:bg-yellow-50/30'}
                      >
                        <td className="px-3 py-2 text-gray-500">
                          {row.title || '-'}
                        </td>
                        <td className="px-3 py-2 text-gray-900 font-medium">
                          {row.first_name}
                        </td>
                        <td className="px-3 py-2 text-gray-900">
                          {row.last_name || '-'}
                        </td>
                        <td className="px-3 py-2 text-gray-600">
                          {row.current_position || '-'}
                        </td>
                        <td className="px-3 py-2 text-gray-600">
                          {row.email || '-'}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {isDupe ? (
                            <span className="text-[10px] font-semibold text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded">
                              Dupe
                            </span>
                          ) : (
                            <span className="text-[10px] font-semibold text-green-600 bg-green-50 px-1.5 py-0.5 rounded">
                              New
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-2">
                          {!isDupe && (
                            <button
                              onClick={() =>
                                setValidRows((prev) =>
                                  prev.filter((_, idx) => idx !== i)
                                )
                              }
                              className="p-1 text-gray-300 hover:text-red-500 transition-colors"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              onClick={handleImport}
              disabled={importing || nonDupeCount === 0}
              className="flex items-center gap-2 px-5 py-2.5 bg-yellow-500 hover:bg-yellow-600 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
            >
              {importing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Upload className="w-4 h-4" />
              )}
              <span>
                Import {nonDupeCount} Contact
                {nonDupeCount !== 1 ? 's' : ''}
              </span>
            </button>
            <button
              onClick={handleReset}
              className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {step === 'done' && (
        <div className="text-center py-8">
          <div className="w-12 h-12 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-3">
            <CheckCircle2 className="w-6 h-6 text-yellow-600" />
          </div>
          <p className="text-sm font-semibold text-gray-900 mb-1">
            {importResult}
          </p>
          <button
            onClick={handleReset}
            className="mt-3 text-sm text-yellow-600 hover:text-yellow-700 font-medium transition-colors"
          >
            Import another file
          </button>
        </div>
      )}
    </div>
  );
}
