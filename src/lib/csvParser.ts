import * as XLSX from 'xlsx';

export interface ProfileField {
  key: string;
  label: string;
  required: boolean;
  aliases: string[];
}

export const PROFILE_FIELDS: ProfileField[] = [
  {
    key: 'title',
    label: 'Title',
    required: false,
    aliases: [
      'title',
      'honorific',
      'prefix',
      'salutation',
      'dr',
      'prof',
    ],
  },
  {
    key: 'first_name',
    label: 'First Name',
    required: true,
    aliases: [
      'first name',
      'firstname',
      'first',
      'given name',
      'givenname',
      'forename',
      'voornaam',
    ],
  },
  {
    key: 'last_name',
    label: 'Last Name',
    required: false,
    aliases: [
      'last name',
      'lastname',
      'last',
      'surname',
      'family name',
      'familyname',
      'achternaam',
    ],
  },
  {
    key: 'current_position',
    label: 'Position',
    required: false,
    aliases: [
      'position',
      'job title',
      'role',
      'current position',
      'job',
      'company',
      'organization',
      'org',
      'employer',
      'work',
      'affiliation',
    ],
  },
  {
    key: 'occupation',
    label: 'Occupation',
    required: false,
    aliases: [
      'occupation',
      'profession',
      'field',
      'job type',
      'category',
      'type',
    ],
  },
  {
    key: 'location_city',
    label: 'City',
    required: false,
    aliases: ['city', 'location city', 'town', 'location'],
  },
  {
    key: 'location_state',
    label: 'State',
    required: false,
    aliases: ['state', 'location state', 'province', 'region', 'st'],
  },
  {
    key: 'bio',
    label: 'Bio',
    required: false,
    aliases: [
      'bio',
      'biography',
      'about',
      'description',
      'summary',
      'notes',
      'note',
    ],
  },
  {
    key: 'flemish_connection',
    label: 'Flemish Connection',
    required: false,
    aliases: [
      'flemish connection',
      'flemish',
      'connection',
      'belgian connection',
      'belgian',
    ],
  },
  {
    key: 'email',
    label: 'Email',
    required: false,
    aliases: [
      'email',
      'e-mail',
      'email address',
      'mail',
      'contact email',
    ],
  },
  {
    key: 'phone',
    label: 'Phone',
    required: false,
    aliases: [
      'phone',
      'telephone',
      'tel',
      'phone number',
      'mobile',
      'cell',
    ],
  },
  {
    key: 'linkedin_url',
    label: 'LinkedIn',
    required: false,
    aliases: ['linkedin', 'linkedin url', 'linkedin profile', 'li'],
  },
  {
    key: 'website_url',
    label: 'Website',
    required: false,
    aliases: [
      'website',
      'website url',
      'url',
      'web',
      'homepage',
      'site',
    ],
  },
];

export const FULL_NAME_FIELD: ProfileField = {
  key: '_full_name',
  label: 'Full Name (auto-split)',
  required: false,
  aliases: [
    'name',
    'full name',
    'fullname',
    'contact name',
    'person',
    'person name',
    'display name',
  ],
};

export interface CsvParseResult {
  headers: string[];
  rows: string[][];
  totalRows: number;
}

export function parseCSV(text: string): CsvParseResult {
  const lines: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === '\n' || (ch === '\r' && next === '\n')) {
        lines.push(current);
        current = '';
        if (ch === '\r') i++;
      } else if (ch === '\r') {
        lines.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }
  if (current.trim()) {
    lines.push(current);
  }

  if (lines.length < 1) {
    return { headers: [], rows: [], totalRows: 0 };
  }

  const splitRow = (line: string): string[] => {
    const cells: string[] = [];
    let cell = '';
    let quoted = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') {
          cell += '"';
          i++;
        } else if (ch === '"') {
          quoted = false;
        } else {
          cell += ch;
        }
      } else {
        if (ch === '"') {
          quoted = true;
        } else if (ch === ',') {
          cells.push(cell.trim());
          cell = '';
        } else {
          cell += ch;
        }
      }
    }
    cells.push(cell.trim());
    return cells;
  };

  const headers = splitRow(lines[0]);
  const rows = lines
    .slice(1)
    .map(splitRow)
    .filter((r) => r.some((c) => c.length > 0));

  return { headers, rows, totalRows: rows.length };
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill(0)
  );

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }

  return dp[m][n];
}

function similarity(a: string, b: string): number {
  const la = a.toLowerCase().replace(/[^a-z0-9]/g, '');
  const lb = b.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (la === lb) return 1;
  if (la.length === 0 || lb.length === 0) return 0;
  if (la.includes(lb) || lb.includes(la)) return 0.85;
  const maxLen = Math.max(la.length, lb.length);
  const dist = levenshtein(la, lb);
  return Math.max(0, 1 - dist / maxLen);
}

export interface FieldMapping {
  fieldKey: string;
  csvColumn: string;
  confidence: number;
}

function bestMatch(
  field: { key: string; label: string; aliases: string[] },
  csvHeaders: string[],
  threshold: number
): { col: string; score: number } {
  let bestCol = '';
  let bestScore = 0;

  for (const header of csvHeaders) {
    const headerLower = header.toLowerCase().trim();

    for (const alias of field.aliases) {
      const score = similarity(headerLower, alias);
      if (score > bestScore) {
        bestScore = score;
        bestCol = header;
      }
    }

    const directScore = similarity(headerLower, field.key.replace(/_/g, ' '));
    if (directScore > bestScore) {
      bestScore = directScore;
      bestCol = header;
    }

    const labelScore = similarity(headerLower, field.label);
    if (labelScore > bestScore) {
      bestScore = labelScore;
      bestCol = header;
    }
  }

  return { col: bestScore >= threshold ? bestCol : '', score: bestScore };
}

export function suggestMappings(csvHeaders: string[]): FieldMapping[] {
  const mappings: FieldMapping[] = PROFILE_FIELDS.map((field) => {
    const threshold = field.required ? 0.35 : 0.5;
    const { col, score } = bestMatch(field, csvHeaders, threshold);
    return { fieldKey: field.key, csvColumn: col, confidence: score };
  });

  const firstNameMapping = mappings.find((m) => m.fieldKey === 'first_name');
  const fullNameMatch = bestMatch(FULL_NAME_FIELD, csvHeaders, 0.35);

  // If _full_name matches the same column as first_name with higher confidence,
  // prefer _full_name (e.g. a "Full Name" header is closer to "full name" than "first name")
  if (
    fullNameMatch.col &&
    firstNameMapping &&
    fullNameMatch.col === firstNameMapping.csvColumn &&
    fullNameMatch.score > firstNameMapping.confidence
  ) {
    firstNameMapping.csvColumn = '';
    firstNameMapping.confidence = 0;
    mappings.push({
      fieldKey: '_full_name',
      csvColumn: fullNameMatch.col,
      confidence: fullNameMatch.score,
    });
  } else if (!firstNameMapping?.csvColumn && fullNameMatch.col) {
    mappings.push({
      fieldKey: '_full_name',
      csvColumn: fullNameMatch.col,
      confidence: fullNameMatch.score,
    });
  }

  return mappings;
}

export interface MappedRow {
  [key: string]: string;
}

export function applyMappings(
  rows: string[][],
  headers: string[],
  mappings: FieldMapping[]
): MappedRow[] {
  const colIndex = new Map<string, number>();
  headers.forEach((h, i) => colIndex.set(h, i));

  const TITLE_PAT = /^\s*(dr\.?|prof\.?|professor|ms\.?|mrs\.?|mr\.?|miss)\s+/i;

  return rows.map((row) => {
    const mapped: MappedRow = {};
    for (const m of mappings) {
      if (!m.csvColumn) continue;
      const idx = colIndex.get(m.csvColumn);
      if (idx !== undefined && idx < row.length) {
        mapped[m.fieldKey] = row[idx] || '';
      }
    }

    if (mapped._full_name && !mapped.first_name) {
      let fullName = mapped._full_name.trim();
      const titleMatch = fullName.match(TITLE_PAT);
      if (titleMatch) {
        if (!mapped.title) {
          mapped.title = titleMatch[1].replace(/\.$/, '');
        }
        fullName = fullName.slice(titleMatch[0].length).trim();
      }
      const parts = fullName.split(/\s+/);
      mapped.first_name = parts[0] || '';
      mapped.last_name = parts.slice(1).join(' ');
      delete mapped._full_name;
    }

    return mapped;
  });
}

export interface ValidationResult {
  valid: MappedRow[];
  invalid: { row: MappedRow; reason: string }[];
}

export function validateMappedRows(rows: MappedRow[]): ValidationResult {
  const valid: MappedRow[] = [];
  const invalid: { row: MappedRow; reason: string }[] = [];

  for (const row of rows) {
    const firstName = (row.first_name || '').trim();
    if (!firstName) {
      invalid.push({ row, reason: 'Missing required field: First Name' });
    } else {
      valid.push(row);
    }
  }

  return { valid, invalid };
}

export function parseExcel(buffer: ArrayBuffer): CsvParseResult {
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return { headers: [], rows: [], totalRows: 0 };

  const sheet = workbook.Sheets[sheetName];
  const jsonRows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: '' });
  if (jsonRows.length < 1) return { headers: [], rows: [], totalRows: 0 };

  const headers = jsonRows[0].map((h) => String(h).trim());
  const rows = jsonRows
    .slice(1)
    .map((r) => r.map((c) => String(c).trim()))
    .filter((r) => r.some((c) => c.length > 0));

  return { headers, rows, totalRows: rows.length };
}

const TEMPLATE_COLUMNS = PROFILE_FIELDS.map((f) => f.label);
const TEMPLATE_EXAMPLE: Record<string, string> = {
  Title: 'Dr.',
  'First Name': 'Jan',
  'Last Name': 'De Smedt',
  Position: 'Professor of Computer Science at MIT',
  Occupation: 'Academic/Researcher',
  City: 'Boston',
  State: 'Massachusetts',
  Bio: 'Belgian researcher specializing in AI and machine learning.',
  'Flemish Connection': 'KU Leuven',
  Email: 'jan.desmedt@example.com',
  Phone: '+1 617-555-0100',
  LinkedIn: 'https://linkedin.com/in/jandesmedt',
  Website: 'https://jandesmedt.example.com',
};

export function downloadTemplate(format: 'csv' | 'xlsx') {
  const exampleRow = TEMPLATE_COLUMNS.map((col) => TEMPLATE_EXAMPLE[col] || '');

  if (format === 'xlsx') {
    const ws = XLSX.utils.aoa_to_sheet([TEMPLATE_COLUMNS, exampleRow]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Contacts');
    XLSX.writeFile(wb, 'flemish_network_import_template.xlsx');
  } else {
    const escape = (v: string) => (v.includes(',') || v.includes('"') ? `"${v.replace(/"/g, '""')}"` : v);
    const lines = [TEMPLATE_COLUMNS.map(escape).join(','), exampleRow.map(escape).join(',')];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'flemish_network_import_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }
}
