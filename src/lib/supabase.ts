import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export interface Person {
  id: string;
  name: string;
  title?: string;
  first_name?: string;
  last_name?: string;
  current_position?: string;
  organization_id?: string;
  location_city?: string;
  location_state?: string;
  latitude?: number;
  longitude?: number;
  occupation?: string;
  bio?: string;
  profile_photo_url?: string;
  flemish_connection?: string;
  linkedin_url?: string;
  website_url?: string;
  twitter_url?: string;
  phone?: string;
  email?: string;
  email_verified?: boolean;
  preferred_contact?: string;
  created_at: string;
  updated_at: string;
}

const TITLE_PATTERN = /^\s*(dr\.?|prof\.?|professor|ms\.?|mrs\.?|mr\.?|miss)\s+/i;

export function displayName(person: Pick<Person, 'name' | 'title' | 'first_name' | 'last_name'>): string {
  const first = person.first_name?.trim() || '';
  const last = person.last_name?.trim() || '';
  if (first || last) {
    const base = [first, last].filter(Boolean).join(' ');
    return person.title?.trim() ? `${person.title.trim()} ${base}` : base;
  }
  return person.name || '';
}

export function personInitials(person: Pick<Person, 'first_name' | 'last_name' | 'name'>): string {
  const first = person.first_name?.trim();
  const last = person.last_name?.trim();
  if (first || last) {
    return [(first || '')[0], (last || '')[0]].filter(Boolean).join('').toUpperCase();
  }
  return person.name?.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase() || '';
}

export function parseTitleFromName(fullName: string): { title: string; firstName: string; lastName: string } {
  let title = '';
  let rest = fullName.trim();
  const m = rest.match(TITLE_PATTERN);
  if (m) {
    title = m[1].replace(/\.$/, '');
    rest = rest.slice(m[0].length).trim();
  }
  const parts = rest.split(/\s+/);
  const firstName = parts[0] || '';
  const lastName = parts.slice(1).join(' ');
  return { title, firstName, lastName };
}

export interface Organization {
  id: string;
  name: string;
  type: string;
  description?: string;
  logo_url?: string;
  location_city?: string;
  location_state?: string;
  latitude?: number;
  longitude?: number;
  flemish_link?: string;
  created_at: string;
  updated_at: string;
}

export interface Sector {
  id: string;
  name: string;
  created_at: string;
}

export interface ExpertiseTag {
  id: string;
  name: string;
  created_at: string;
}

export interface Connection {
  id: string;
  from_person_id?: string;
  to_person_id?: string;
  from_organization_id?: string;
  to_organization_id?: string;
  relationship_type?: string;
  strength: number;
  created_at: string;
}

export interface MapFilters {
  showPeople: boolean;
  showOrganizations: boolean;
  sector: string;
  occupation: string;
  flemishConnections: string[];
  availableForLectures: boolean;
}

export const OCCUPATION_OPTIONS = [
  'Student',
  'Academic / Researcher',
  'Professional',
  'Executive / Leadership',
] as const;

export const OCCUPATION_CATEGORY_KEYWORDS: Record<string, string[]> = {
  'Student': ['student', 'graduate', 'intern', 'phd candidate'],
  'Academic / Researcher': ['professor', 'researcher', 'scientist', 'academic', 'postdoc', 'lecturer'],
  'Professional': ['engineer', 'consultant', 'manager', 'developer', 'creative', 'finance', 'healthcare'],
  'Executive / Leadership': ['executive', 'director', 'entrepreneur', 'government', 'ceo', 'cto', 'president'],
};

export const FLEMISH_OPTIONS = [
  'KU Leuven',
  'UGent',
  'VUB',
  'UAntwerp',
  'BAEF',
  'imec',
  'Fayat',
  'Oostende',
  'Antwerpen',
  'Brugge',
  'Gent',
  'Hasselt',
  'Mechelen',
];

export interface FilterPreset {
  sector?: string;
  occupation?: string;
  flemishConnections?: string[];
  focusCity?: { city: string; state: string };
}

export interface SavedFlemishFilter {
  id: string;
  original_query: string;
  keywords: Record<string, string[]>;
  target_fields: string[];
  usage_count: number;
  filter_type: string;
  created_at: string;
}

export interface ActiveAiFilter {
  id: string;
  query: string;
  keywords: Record<string, string[]>;
  fields: string[];
}

export interface SearchCommand {
  query: string;
  timestamp: number;
}

export const PREDEFINED_FILTERS = [
  'KU Leuven',
  'UGent',
  'VUB',
  'UAntwerp',
  'UHasselt',
  'Fayat',
] as const;

export const PREDEFINED_FILTER_FIELDS = ['bio', 'current_position', 'flemish_connection'] as const;

export function fuzzyMatch(needle: string, haystack: string): boolean {
  if (!needle || !haystack) return false;
  const n = needle.toLowerCase().trim();
  const h = haystack.toLowerCase().trim();
  if (h.includes(n) || n.includes(h)) return true;
  const nWords = n.split(/\s+/);
  return nWords.every((w) => h.includes(w));
}

export interface MapCluster {
  city: string;
  state: string;
  lat: number;
  lng: number;
  people: Person[];
  organizations: Organization[];
}

export interface DirectoryFilters {
  city?: string;
  state?: string;
  personIds?: string[];
  sector?: string;
  flemishConnection?: string;
}

export const DEFAULT_MAP_FILTERS: MapFilters = {
  showPeople: true,
  showOrganizations: true,
  sector: '',
  occupation: '',
  flemishConnections: [],
  availableForLectures: false,
};
