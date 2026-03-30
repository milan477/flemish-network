export type FlemishConnectionType =
  | 'university'
  | 'government'
  | 'company'
  | 'other';

export interface FlemishConnection {
  id: string;
  name: string;
  type: FlemishConnectionType;
  created_at?: string;
  updated_at?: string;
}

export interface PersonFlemishConnectionLink {
  person_id?: string;
  flemish_connection_id?: string;
  flemish_connections?: FlemishConnection | FlemishConnection[] | null;
}

export interface HasFlemishConnections {
  flemish_connection?: string | null;
  person_flemish_connections?: PersonFlemishConnectionLink[] | null;
}

const KNOWN_CONNECTIONS: Array<{
  name: string;
  type: FlemishConnectionType;
  patterns: RegExp[];
}> = [
  {
    name: 'KU Leuven',
    type: 'university',
    patterns: [
      /\bku\s*leuven\b/i,
      /\bkatholieke\s+universiteit\s+leuven\b/i,
      /\bcatholic\s+university\s+of\s+leuven\b/i,
    ],
  },
  {
    name: 'UGent',
    type: 'university',
    patterns: [
      /\bugent\b/i,
      /\bghent\s+university\b/i,
      /\buniversity\s+of\s+ghent\b/i,
      /\buniversiteit\s+gent\b/i,
    ],
  },
  {
    name: 'VUB',
    type: 'university',
    patterns: [
      /\bvub\b/i,
      /\bvrije\s+universiteit\s+brussel\b/i,
    ],
  },
  {
    name: 'UAntwerp',
    type: 'university',
    patterns: [
      /\buantwerp\b/i,
      /\buniversity\s+of\s+antwerp\b/i,
      /\buniversiteit\s+antwerpen\b/i,
      /\buniversiteit\s+van\s+antwerpen\b/i,
    ],
  },
  {
    name: 'UHasselt',
    type: 'university',
    patterns: [
      /\buhasselt\b/i,
      /\bhasselt\s+university\b/i,
      /\buniversiteit\s+hasselt\b/i,
    ],
  },
  {
    name: 'imec',
    type: 'company',
    patterns: [
      /\bimec\b/i,
      /\binteruniversity\s+microelectronics\s+centre\b/i,
    ],
  },
  {
    name: 'BAEF',
    type: 'other',
    patterns: [
      /\bbaef\b/i,
      /\bbelgian\s+american\s+educational\s+foundation\b/i,
    ],
  },
  {
    name: 'Fayat Fellowship',
    type: 'other',
    patterns: [
      /\bfayat\b/i,
      /\bfayat\s+fellow(?:ship)?\b/i,
    ],
  },
  {
    name: 'Flemish Government',
    type: 'government',
    patterns: [
      /\bflemish\s+government\b/i,
      /\bgovernment\s+of\s+flanders\b/i,
      /\bflanders\s+government\b/i,
    ],
  },
  {
    name: 'Flanders Investment & Trade',
    type: 'government',
    patterns: [
      /\bflanders\s+investment\s*&\s*trade\b/i,
      /\bflanders\s+investment\s+and\s+trade\b/i,
      /\bfit\b/i,
    ],
  },
];

export const DEFAULT_FLEMISH_CONNECTIONS: Array<{
  name: string;
  type: FlemishConnectionType;
}> = KNOWN_CONNECTIONS.map(({ name, type }) => ({ name, type }));

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      if (word === '&') return word;
      if (/^[A-Z0-9]{2,}$/.test(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

function sanitizeToken(token: string): string {
  let cleaned = normalizeWhitespace(
    token
      .replace(/[\n\r]+/g, ' ')
      .replace(/[()[\]]/g, ' ')
      .replace(/^[,;:. -]+|[,;:. -]+$/g, '')
  );

  cleaned = cleaned
    .replace(
      /^(?:researcher|professor|director|scientist|engineer|founder|ceo|cto|president|student|recipient|fellow(?:ship)?|alumn(?:us|a|i)?|member|visiting|former|current)\s+(?:at|of|with)?\s*/i,
      ''
    )
    .replace(/\s+(?:fellow(?:ship)?|program(?:me)?|programme)$/i, '')
    .trim();

  return normalizeWhitespace(cleaned);
}

function countWords(value: string): number {
  return value.split(/\s+/).filter(Boolean).length;
}

export function inferFlemishConnectionType(rawName: string): FlemishConnectionType {
  const name = rawName.trim();

  if (
    /\b(university|universiteit|college|school of|campus)\b/i.test(name)
  ) {
    return 'university';
  }

  if (
    /\b(government|ministry|department|delegation|consulate|embassy|agency|public)\b/i.test(name)
  ) {
    return 'government';
  }

  if (
    /\b(inc|llc|ltd|corp|corporation|company|technologies|labs|lab|group|ventures|industries)\b/i.test(name)
  ) {
    return 'company';
  }

  if (/^imec$/i.test(name)) {
    return 'company';
  }

  return 'other';
}

export function canonicalizeFlemishConnection(rawValue: string): {
  name: string;
  type: FlemishConnectionType;
} | null {
  const value = sanitizeToken(rawValue);
  if (!value) return null;

  for (const known of KNOWN_CONNECTIONS) {
    if (known.patterns.some((pattern) => pattern.test(value))) {
      return { name: known.name, type: known.type };
    }
  }

  if (!/[A-Za-z]/.test(value)) return null;

  if (countWords(value) > 6) return null;

  if (
    /\b(authored|report|detailed|ecosystem|innovation|chapter|article|paper|study)\b/i.test(
      value
    )
  ) {
    return null;
  }

  if (
    !/\b(flem|belg|leuven|ghent|gent|brussel|brussels|antwerp|antwerpen|hasselt|imec|baef|flanders|vlaanderen|fayat)\b/i.test(
      value
    ) &&
    !/\b(university|universiteit|government|ministry|company|foundation|association|institute|centre|center|agency|fellow(?:ship)?)\b/i.test(
      value
    )
  ) {
    return null;
  }

  return {
    name: titleCase(value),
    type: inferFlemishConnectionType(value),
  };
}

export function extractFlemishConnectionsFromText(text: string): Array<{
  name: string;
  type: FlemishConnectionType;
}> {
  const normalized = normalizeWhitespace(text);
  if (!normalized) return [];

  const seen = new Map<string, { name: string; type: FlemishConnectionType }>();

  const addCandidate = (candidate: { name: string; type: FlemishConnectionType } | null) => {
    if (!candidate) return;
    const key = candidate.name.toLowerCase();
    if (!seen.has(key)) {
      seen.set(key, candidate);
    }
  };

  KNOWN_CONNECTIONS.forEach((known) => {
    if (known.patterns.some((pattern) => pattern.test(normalized))) {
      addCandidate({ name: known.name, type: known.type });
    }
  });

  const genericTokens = normalized
    .replace(/\band\b/gi, ',')
    .replace(/[;/|]+/g, ',')
    .split(',');

  genericTokens.forEach((token) => {
    addCandidate(canonicalizeFlemishConnection(token));
  });

  return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function flattenPersonFlemishConnections(
  links?: PersonFlemishConnectionLink[] | null
): FlemishConnection[] {
  if (!links?.length) return [];

  const seen = new Map<string, FlemishConnection>();

  links.forEach((link) => {
    const raw = link.flemish_connections;
    const rows = Array.isArray(raw) ? raw : raw ? [raw] : [];
    rows.forEach((row) => {
      if (!row?.id || !row.name) return;
      if (!seen.has(row.id)) {
        seen.set(row.id, row);
      }
    });
  });

  return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function getPersonFlemishConnections(person: HasFlemishConnections | null | undefined): FlemishConnection[] {
  if (!person) return [];

  const nested = flattenPersonFlemishConnections(person.person_flemish_connections);
  if (nested.length > 0) return nested;

  if (!person.flemish_connection) return [];

  return extractFlemishConnectionsFromText(person.flemish_connection).map((candidate) => ({
    id: candidate.name.toLowerCase(),
    name: candidate.name,
    type: candidate.type,
  }));
}

export function getPersonFlemishConnectionNames(person: HasFlemishConnections | null | undefined): string[] {
  return getPersonFlemishConnections(person).map((connection) => connection.name);
}

export function personHasFlemishConnection(
  person: HasFlemishConnections | null | undefined,
  connectionName: string
): boolean {
  const target = connectionName.trim().toLowerCase();
  if (!target) return false;

  return getPersonFlemishConnections(person).some(
    (connection) => connection.name.trim().toLowerCase() === target
  );
}
