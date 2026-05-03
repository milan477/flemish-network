import { createClient } from '@supabase/supabase-js';
import type { FlemishConnection, PersonFlemishConnectionLink } from './flemishConnections';
import { DEFAULT_FLEMISH_CONNECTIONS } from './flemishConnections';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'placeholder-key';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export type AppRole = 'viewer' | 'editor' | 'admin';

export interface StaffUser {
  id: string;
  user_id?: string | null;
  email: string;
  full_name?: string | null;
  avatar_url?: string | null;
  role: AppRole;
  status: 'invited' | 'active' | 'disabled';
  last_sign_in_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Person {
  id: string;
  name: string;
  title?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  current_position?: string;
  organization_id?: string;
  location_id?: string;
  locations?: { id: string; city: string; state: string; latitude: number | null; longitude: number | null; };
  occupation?: string;
  bio?: string;
  profile_photo_url?: string;
  flemish_connection?: string;
  person_flemish_connections?: PersonFlemishConnectionLink[];
  linkedin_url?: string;
  website_url?: string;
  twitter_url?: string;
  phone?: string;
  email?: string;
  email_verified?: boolean;
  preferred_contact?: string;
  available_for_lectures?: boolean;
  open_to_mentorship?: boolean;
  welcomes_visits?: boolean;
  data_source?: string;
  last_verified_at?: string;
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

export function personNamePartsForInsert(parts: {
  title?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}): { title?: string; first_name?: string; last_name?: string } {
  const result: { title?: string; first_name?: string; last_name?: string } = {};
  const title = parts.title?.trim();
  const firstName = parts.firstName?.trim();
  const lastName = parts.lastName?.trim();

  if (title) result.title = title;
  if (firstName) result.first_name = firstName;
  if (lastName) result.last_name = lastName;

  return result;
}

export interface Organization {
  id: string;
  name: string;
  type: string;
  description?: string;
  logo_url?: string;
  website_url?: string;
  location_id?: string;
  locations?: { id: string; city: string; state: string; latitude: number | null; longitude: number | null; };
  flemish_link?: string;
  created_at: string;
  updated_at: string;
}

export interface Sector {
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

export interface Collection {
  id: string;
  name: string;
  description?: string;
  created_at: string;
  updated_at: string;
  member_count?: number;
}

export interface CollectionMember {
  id: string;
  collection_id: string;
  person_id: string;
  notes?: string;
  added_at: string;
  person?: Person;
}

export interface MapFilters {
  showPeople: boolean;
  showOrganizations: boolean;
  sector: string;
  occupation: string;
  city: string;
  state: string;
  flemishConnections: string[];
  availableForLectures: boolean;
}

export const OCCUPATION_OPTIONS = [
  'Student',
  'Academic/Researcher',
  'Professional',
  'Executive/Leadership',
] as const;

export const OCCUPATION_CATEGORY_KEYWORDS: Record<string, string[]> = {
  'Student': ['student', 'graduate', 'intern', 'phd candidate'],
  'Academic/Researcher': ['professor', 'researcher', 'scientist', 'academic', 'postdoc', 'lecturer'],
  'Professional': ['engineer', 'consultant', 'manager', 'developer', 'creative', 'finance', 'healthcare'],
  'Executive/Leadership': ['executive', 'director', 'entrepreneur', 'government', 'ceo', 'cto', 'president'],
};

export const FLEMISH_OPTIONS = [
  ...DEFAULT_FLEMISH_CONNECTIONS.map((connection) => connection.name),
];

export type { FlemishConnection };

export const US_STATES = [
  { code: 'AL', name: 'Alabama' },
  { code: 'AK', name: 'Alaska' },
  { code: 'AZ', name: 'Arizona' },
  { code: 'AR', name: 'Arkansas' },
  { code: 'CA', name: 'California' },
  { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' },
  { code: 'DE', name: 'Delaware' },
  { code: 'FL', name: 'Florida' },
  { code: 'GA', name: 'Georgia' },
  { code: 'HI', name: 'Hawaii' },
  { code: 'ID', name: 'Idaho' },
  { code: 'IL', name: 'Illinois' },
  { code: 'IN', name: 'Indiana' },
  { code: 'IA', name: 'Iowa' },
  { code: 'KS', name: 'Kansas' },
  { code: 'KY', name: 'Kentucky' },
  { code: 'LA', name: 'Louisiana' },
  { code: 'ME', name: 'Maine' },
  { code: 'MD', name: 'Maryland' },
  { code: 'MA', name: 'Massachusetts' },
  { code: 'MI', name: 'Michigan' },
  { code: 'MN', name: 'Minnesota' },
  { code: 'MS', name: 'Mississippi' },
  { code: 'MO', name: 'Missouri' },
  { code: 'MT', name: 'Montana' },
  { code: 'NE', name: 'Nebraska' },
  { code: 'NV', name: 'Nevada' },
  { code: 'NH', name: 'New Hampshire' },
  { code: 'NJ', name: 'New Jersey' },
  { code: 'NM', name: 'New Mexico' },
  { code: 'NY', name: 'New York' },
  { code: 'NC', name: 'North Carolina' },
  { code: 'ND', name: 'North Dakota' },
  { code: 'OH', name: 'Ohio' },
  { code: 'OK', name: 'Oklahoma' },
  { code: 'OR', name: 'Oregon' },
  { code: 'PA', name: 'Pennsylvania' },
  { code: 'RI', name: 'Rhode Island' },
  { code: 'SC', name: 'South Carolina' },
  { code: 'SD', name: 'South Dakota' },
  { code: 'TN', name: 'Tennessee' },
  { code: 'TX', name: 'Texas' },
  { code: 'UT', name: 'Utah' },
  { code: 'VT', name: 'Vermont' },
  { code: 'VA', name: 'Virginia' },
  { code: 'WA', name: 'Washington' },
  { code: 'WV', name: 'West Virginia' },
  { code: 'WI', name: 'Wisconsin' },
  { code: 'WY', name: 'Wyoming' },
  { code: 'DC', name: 'District of Columbia' },
];

export const MAJOR_CITIES = [
  { name: 'New York', state: 'NY' },
  { name: 'Los Angeles', state: 'CA' },
  { name: 'Chicago', state: 'IL' },
  { name: 'Houston', state: 'TX' },
  { name: 'Phoenix', state: 'AZ' },
  { name: 'Philadelphia', state: 'PA' },
  { name: 'San Antonio', state: 'TX' },
  { name: 'San Diego', state: 'CA' },
  { name: 'Dallas', state: 'TX' },
  { name: 'San Jose', state: 'CA' },
  { name: 'Austin', state: 'TX' },
  { name: 'Jacksonville', state: 'FL' },
  { name: 'San Francisco', state: 'CA' },
  { name: 'Columbus', state: 'OH' },
  { name: 'Fort Worth', state: 'TX' },
  { name: 'Indianapolis', state: 'IN' },
  { name: 'Charlotte', state: 'NC' },
  { name: 'Seattle', state: 'WA' },
  { name: 'Denver', state: 'CO' },
  { name: 'Washington', state: 'DC' },
  { name: 'Boston', state: 'MA' },
  { name: 'El Paso', state: 'TX' },
  { name: 'Detroit', state: 'MI' },
  { name: 'Nashville', state: 'TN' },
  { name: 'Portland', state: 'OR' },
  { name: 'Memphis', state: 'TN' },
  { name: 'Oklahoma City', state: 'OK' },
  { name: 'Las Vegas', state: 'NV' },
  { name: 'Louisville', state: 'KY' },
  { name: 'Baltimore', state: 'MD' },
  { name: 'Milwaukee', state: 'WI' },
  { name: 'Albuquerque', state: 'NM' },
  { name: 'Tucson', state: 'AZ' },
  { name: 'Fresno', state: 'CA' },
  { name: 'Sacramento', state: 'CA' },
  { name: 'Mesa', state: 'AZ' },
  { name: 'Kansas City', state: 'MO' },
  { name: 'Atlanta', state: 'GA' },
  { name: 'Long Beach', state: 'CA' },
  { name: 'Colorado Springs', state: 'CO' },
  { name: 'Raleigh', state: 'NC' },
  { name: 'Miami', state: 'FL' },
  { name: 'Virginia Beach', state: 'VA' },
  { name: 'Omaha', state: 'NE' },
  { name: 'Oakland', state: 'CA' },
  { name: 'Minneapolis', state: 'MN' },
  { name: 'Tulsa', state: 'OK' },
  { name: 'Arlington', state: 'TX' },
  { name: 'Arlington', state: 'VA' },
  { name: 'New Orleans', state: 'LA' },
  { name: 'Wichita', state: 'KS' },
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
  return nWords.some((w) => h.includes(w));
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
  city: '',
  state: '',
  flemishConnections: [],
  availableForLectures: false,
};
