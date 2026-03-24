import { type MapFilters, DEFAULT_MAP_FILTERS } from './supabase';

export interface FilterResult {
  message: string;
  filters: MapFilters;
}

const SECTOR_ALIASES: Record<string, string[]> = {
  'Artificial Intelligence': ['ai', 'artificial intelligence', 'machine learning'],
  'Biotechnology': ['biotech', 'biotechnology', 'life sciences'],
  'Finance': ['finance', 'fintech', 'banking'],
  'Culture & Arts': ['arts', 'culture', 'creative'],
  'Education': ['education', 'teaching'],
  'Research': ['research'],
};

const OCCUPATION_ALIASES: Record<string, string[]> = {
  'Student': ['student'],
  'Academic/Researcher': ['researcher', 'academic', 'professor', 'scientist'],
  'Professional': ['professional', 'engineer', 'developer'],
  'Executive/Leadership': ['executive', 'ceo', 'cto', 'director', 'leadership', 'vp'],
};

const FLEMISH_CONNECTIONS = ['KU Leuven', 'UGent', 'VUB', 'UAntwerp', 'BAEF', 'imec', 'Fayat'];

const US_STATES: Record<string, string[]> = {
  'AL': ['alabama', 'al'],
  'AK': ['alaska', 'ak'],
  'AZ': ['arizona', 'az'],
  'AR': ['arkansas', 'ar'],
  'CA': ['california', 'ca'],
  'CO': ['colorado', 'co'],
  'CT': ['connecticut', 'ct'],
  'DE': ['delaware', 'de'],
  'FL': ['florida', 'fl'],
  'GA': ['georgia', 'ga'],
  'HI': ['hawaii', 'hi'],
  'ID': ['idaho', 'id'],
  'IL': ['illinois', 'il'],
  'IN': ['indiana', 'in'],
  'IA': ['iowa', 'ia'],
  'KS': ['kansas', 'ks'],
  'KY': ['kentucky', 'ky'],
  'LA': ['louisiana', 'la'],
  'ME': ['maine', 'me'],
  'MD': ['maryland', 'md'],
  'MA': ['massachusetts', 'ma'],
  'MI': ['michigan', 'mi'],
  'MN': ['minnesota', 'mn'],
  'MS': ['mississippi', 'ms'],
  'MO': ['missouri', 'mo'],
  'MT': ['montana', 'mt'],
  'NE': ['nebraska', 'ne'],
  'NV': ['nevada', 'nv'],
  'NH': ['new hampshire', 'nh'],
  'NJ': ['new jersey', 'nj'],
  'NM': ['new mexico', 'nm'],
  'NY': ['new york', 'ny'],
  'NC': ['north carolina', 'nc'],
  'ND': ['north dakota', 'nd'],
  'OH': ['ohio', 'oh'],
  'OK': ['oklahoma', 'ok'],
  'OR': ['oregon', 'or'],
  'PA': ['pennsylvania', 'pa'],
  'RI': ['rhode island', 'ri'],
  'SC': ['south carolina', 'sc'],
  'SD': ['south dakota', 'sd'],
  'TN': ['tennessee', 'tn'],
  'TX': ['texas', 'tx'],
  'UT': ['utah', 'ut'],
  'VT': ['vermont', 'vt'],
  'VA': ['virginia', 'va'],
  'WA': ['washington', 'wa'],
  'WV': ['west virginia', 'wv'],
  'WI': ['wisconsin', 'wi'],
  'WY': ['wyoming', 'wy'],
  'DC': ['district of columbia', 'dc'],
};

const MAJOR_CITIES: Record<string, string[]> = {
  'New York': ['new york', 'nyc'],
  'Los Angeles': ['los angeles', 'la'],
  'Chicago': ['chicago'],
  'Houston': ['houston'],
  'Phoenix': ['phoenix'],
  'Philadelphia': ['philadelphia'],
  'San Antonio': ['san antonio'],
  'San Diego': ['san diego'],
  'Dallas': ['dallas'],
  'San Jose': ['san jose'],
  'Austin': ['austin'],
  'Jacksonville': ['jacksonville'],
  'San Francisco': ['san francisco', 'sf'],
  'Columbus': ['columbus'],
  'Fort Worth': ['fort worth'],
  'Indianapolis': ['indianapolis'],
  'Charlotte': ['charlotte'],
  'Seattle': ['seattle'],
  'Denver': ['denver'],
  'Washington': ['washington', 'dc'],
  'Boston': ['boston'],
  'El Paso': ['el paso'],
  'Detroit': ['detroit'],
  'Nashville': ['nashville'],
  'Portland': ['portland'],
  'Memphis': ['memphis'],
  'Oklahoma City': ['oklahoma city'],
  'Las Vegas': ['las vegas'],
  'Louisville': ['louisville'],
  'Baltimore': ['baltimore'],
  'Milwaukee': ['milwaukee'],
  'Albuquerque': ['albuquerque'],
  'Tucson': ['tucson'],
  'Fresno': ['fresno'],
  'Sacramento': ['sacramento'],
  'Mesa': ['mesa'],
  'Kansas City': ['kansas city'],
  'Atlanta': ['atlanta'],
  'Long Beach': ['long beach'],
  'Colorado Springs': ['colorado springs'],
  'Raleigh': ['raleigh'],
  'Miami': ['miami'],
  'Virginia Beach': ['virginia beach'],
  'Omaha': ['omaha'],
  'Oakland': ['oakland'],
  'Minneapolis': ['minneapolis'],
  'Tulsa': ['tulsa'],
  'Arlington': ['arlington'],
  'New Orleans': ['new orleans'],
  'Wichita': ['wichita'],
};

const LECTURE_KEYWORDS = ['speaker', 'speakers', 'lecturer', 'lecturers', 'available for lectures', 'talks'];
const RESET_KEYWORDS = ['reset', 'clear', 'show all'];

export function parseFiltersFromQuery(query: string, currentFilters: MapFilters): FilterResult {
  const q = query.toLowerCase().trim();

  // Check for reset
  if (RESET_KEYWORDS.some(kw => q === kw)) {
    return {
      message: 'Filters cleared.',
      filters: { ...DEFAULT_MAP_FILTERS }
    };
  }

  const nextFilters: MapFilters = { ...currentFilters };
  const detected: string[] = [];

  // Sector
  for (const [sector, aliases] of Object.entries(SECTOR_ALIASES)) {
    if (aliases.some(alias => {
      const regex = new RegExp(`\\b${alias}\\b`, 'i');
      return regex.test(q);
    })) {
      nextFilters.sector = sector;
      detected.push(sector);
      break;
    }
  }

  // Occupation
  for (const [occupation, aliases] of Object.entries(OCCUPATION_ALIASES)) {
    if (aliases.some(alias => {
      const regex = new RegExp(`\\b${alias}\\b`, 'i');
      return regex.test(q);
    })) {
      nextFilters.occupation = occupation;
      detected.push(occupation);
      break;
    }
  }

  // US State
  for (const [state, aliases] of Object.entries(US_STATES)) {
    if (aliases.some(alias => {
      // For 2-letter codes, we want word boundaries to avoid matching "in" or "ma" within words
      const regex = alias.length === 2 
        ? new RegExp(`\\b${alias}\\b`, 'i')
        : new RegExp(`\\b${alias}\\b`, 'i'); // Same for now
      return regex.test(q);
    })) {
      nextFilters.state = state;
      detected.push(state);
      break;
    }
  }

  // Major Cities
  for (const [city, aliases] of Object.entries(MAJOR_CITIES)) {
    if (aliases.some(alias => {
      const regex = new RegExp(`\\b${alias}\\b`, 'i');
      return regex.test(q);
    })) {
      nextFilters.city = city;
      detected.push(city);
      break;
    }
  }

  // Flemish Connections
  const connections: string[] = [];
  for (const conn of FLEMISH_CONNECTIONS) {
    if (q.includes(conn.toLowerCase())) {
      connections.push(conn);
    }
  }
  if (connections.length > 0) {
    nextFilters.flemishConnections = connections;
    detected.push(...connections);
  }

  // Lectures
  if (LECTURE_KEYWORDS.some(kw => q.includes(kw))) {
    nextFilters.availableForLectures = true;
    detected.push('available for lectures');
  }

  if (detected.length === 0) {
    return {
      message: 'No specific filters detected.',
      filters: currentFilters
    };
  }

  // Generate summary message
  let summary = 'Filtering by ';
  const parts: string[] = [];
  if (nextFilters.sector) parts.push(`sector: ${nextFilters.sector}`);
  if (nextFilters.occupation) parts.push(`occupation: ${nextFilters.occupation}`);
  if (nextFilters.city || nextFilters.state) {
    let loc = '';
    if (nextFilters.city) loc += nextFilters.city;
    if (nextFilters.city && nextFilters.state) loc += ', ';
    if (nextFilters.state) loc += nextFilters.state;
    parts.push(`location: ${loc}`);
  }
  if (nextFilters.flemishConnections.length > 0) {
    parts.push(`links: ${nextFilters.flemishConnections.join(', ')}`);
  }
  if (nextFilters.availableForLectures) {
    parts.push('available for lectures');
  }

  summary += parts.join(', ');

  return {
    message: summary,
    filters: nextFilters
  };
}
