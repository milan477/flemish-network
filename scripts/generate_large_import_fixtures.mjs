import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputDir = resolve(__dirname, '../test-csvs');

const HEADERS = [
  'First Name',
  'Last Name',
  'Title',
  'Position',
  'Occupation',
  'City',
  'State',
  'Email',
  'Phone',
  'LinkedIn',
  'Website',
  'Bio',
  'Flemish Connection',
  'Sector',
];

const COUNT_PER_SECTOR = 84;
const OCCUPATION_SEQUENCE = [
  'Professional',
  'Professional',
  'Academic/Researcher',
  'Professional',
  'Executive/Leadership',
  'Professional',
  'Student',
  'Professional',
  'Academic/Researcher',
  'Executive/Leadership',
  'Professional',
  'Student',
];

const FIRST_NAMES = [
  'Aline', 'Amber', 'Annelies', 'Arne', 'Astrid', 'Bram', 'Celine', 'Daan',
  'Eline', 'Elise', 'Emma', 'Femke', 'Flore', 'Glenn', 'Hanne', 'Hugo',
  'Ines', 'Isa', 'Jana', 'Jasper', 'Jef', 'Jolien', 'Jonas', 'Julie',
  'Karel', 'Katrien', 'Lander', 'Laura', 'Lena', 'Lies', 'Lieselot', 'Linde',
  'Lotte', 'Louis', 'Lucas', 'Maarten', 'Manon', 'Margot', 'Marie', 'Mathias',
  'Mats', 'Michiel', 'Nathalie', 'Niels', 'Noor', 'Pieter', 'Ruben', 'Saar',
  'Sarah', 'Seppe', 'Sien', 'Silke', 'Simon', 'Sofie', 'Stijn', 'Thomas',
  'Tijs', 'Tine', 'Wim', 'Yana', 'Yasmine', 'Yorben', 'Zoë', 'Axelle',
  'Benoit', 'Chloe', 'Dries', 'Ewout', 'Fleur', 'Gilles', 'Helena', 'Ilse',
  'Jelle', 'Karen', 'Leen', 'Mila', 'Nina', 'Olivier', 'Paulien', 'Quinten',
  'Roos', 'Siebe', 'Tomas', 'Uma', 'Valerie', 'Wouter', 'Xander', 'Yentl',
];

const LAST_NAMES = [
  'Aerts', 'Baert', 'Bogaert', 'Claes', 'Coene', 'Cools', 'Coppens', 'De Backer',
  'De Bock', 'De Bruyn', 'De Clercq', 'De Coster', 'De Meyer', 'De Ridder',
  'De Roeck', 'De Smet', 'De Vos', 'De Wilde', 'Declercq', 'Desmet',
  'Desmyter', 'Dierickx', 'Goossens', 'Jacobs', 'Janssens', 'Keersmaecker',
  'Lambrechts', 'Leclercq', 'Lenaerts', 'Maes', 'Martens', 'Michiels',
  'Pauwels', 'Peeters', 'Raes', 'Reynaert', 'Roels', 'Somers', 'Thys',
  'Van Acker', 'Van Camp', 'Van Damme', 'Van den Berg', 'Van den Broeck',
  'Van de Velde', 'Van Gorp', 'Van Hecke', 'Van Hoof', 'Van Humbeeck',
  'Van Lerberghe', 'Van den Eynde', 'Van Overstraeten', 'Vandermeulen',
  'Vanderstraeten', 'Vandenberghe', 'Vandenbroucke', 'Vandersmissen',
  'Vandeputte', 'Vandewalle', 'Vanhove', 'Vanthienen', 'Verbist', 'Verbeke',
  'Verbruggen', 'Verdoodt', 'Verhaegen', 'Verhelst', 'Vermeersch',
  'Vermeulen', 'Verschueren', 'Verstraete', 'Wauters', 'Willems', 'Wouters',
  'Aelbrecht', 'Briers', 'Callebaut', 'Dewachter', 'Engels', 'Feyaerts',
  'Ghys', 'Hermans', 'Lemmens', 'Noppe', 'Puttemans', 'Saelens',
];

const LOCATIONS = [
  { city: 'Boston', state: 'Massachusetts', areaCode: '617' },
  { city: 'Cambridge', state: 'Massachusetts', areaCode: '857' },
  { city: 'New York', state: 'New York', areaCode: '212' },
  { city: 'Brooklyn', state: 'New York', areaCode: '718' },
  { city: 'Washington', state: 'District of Columbia', areaCode: '202' },
  { city: 'San Francisco', state: 'California', areaCode: '415' },
  { city: 'Palo Alto', state: 'California', areaCode: '650' },
  { city: 'Mountain View', state: 'California', areaCode: '650' },
  { city: 'San Diego', state: 'California', areaCode: '619' },
  { city: 'Los Angeles', state: 'California', areaCode: '213' },
  { city: 'Seattle', state: 'Washington', areaCode: '206' },
  { city: 'Austin', state: 'Texas', areaCode: '512' },
  { city: 'Houston', state: 'Texas', areaCode: '713' },
  { city: 'Chicago', state: 'Illinois', areaCode: '312' },
  { city: 'Philadelphia', state: 'Pennsylvania', areaCode: '215' },
  { city: 'Pittsburgh', state: 'Pennsylvania', areaCode: '412' },
  { city: 'Atlanta', state: 'Georgia', areaCode: '404' },
  { city: 'Raleigh', state: 'North Carolina', areaCode: '919' },
  { city: 'Research Triangle Park', state: 'North Carolina', areaCode: '919' },
  { city: 'Bethesda', state: 'Maryland', areaCode: '301' },
  { city: 'Baltimore', state: 'Maryland', areaCode: '410' },
  { city: 'Cleveland', state: 'Ohio', areaCode: '216' },
  { city: 'Detroit', state: 'Michigan', areaCode: '313' },
  { city: 'Ann Arbor', state: 'Michigan', areaCode: '734' },
  { city: 'Madison', state: 'Wisconsin', areaCode: '608' },
  { city: 'Minneapolis', state: 'Minnesota', areaCode: '612' },
  { city: 'Denver', state: 'Colorado', areaCode: '303' },
  { city: 'Boulder', state: 'Colorado', areaCode: '303' },
  { city: 'Phoenix', state: 'Arizona', areaCode: '602' },
  { city: 'Tempe', state: 'Arizona', areaCode: '480' },
  { city: 'Portland', state: 'Oregon', areaCode: '503' },
  { city: 'Miami', state: 'Florida', areaCode: '305' },
  { city: 'Nashville', state: 'Tennessee', areaCode: '615' },
  { city: 'St. Louis', state: 'Missouri', areaCode: '314' },
  { city: 'Kansas City', state: 'Missouri', areaCode: '816' },
  { city: 'New Haven', state: 'Connecticut', areaCode: '203' },
  { city: 'Providence', state: 'Rhode Island', areaCode: '401' },
  { city: 'Burlington', state: 'Vermont', areaCode: '802' },
  { city: 'Charlottesville', state: 'Virginia', areaCode: '434' },
  { city: 'Salt Lake City', state: 'Utah', areaCode: '385' },
];

const SECTORS = [
  {
    slug: 'artificial_intelligence',
    fileName: '09_sector_artificial_intelligence.csv',
    sector: 'Artificial Intelligence',
    connections: ['KU Leuven', 'UGent', 'VUB', 'imec'],
    locationOffsets: [0, 1, 5, 6, 7, 10, 11, 13, 26, 27, 28, 39],
    emailDomain: 'ai-fixture.example.org',
    websiteDomain: 'ai-fixture.example.org',
    themes: ['applied machine learning', 'computer vision', 'language systems', 'AI safety', 'robotics', 'data infrastructure'],
    impactAreas: ['healthcare workflows', 'industrial automation', 'public-service tools', 'advanced manufacturing', 'climate analytics', 'research operations'],
    roles: {
      'Student': [
        { template: 'PhD Candidate in Machine Learning at {org}', orgs: ['MIT', 'Stanford', 'Carnegie Mellon University', 'UC Berkeley', 'Georgia Tech'] },
        { template: 'Graduate Researcher in Robotics at {org}', orgs: ['University of Washington', 'UT Austin', 'Johns Hopkins University', 'Northwestern University', 'University of Michigan'] },
      ],
      'Academic/Researcher': [
        { template: 'Assistant Professor of Computer Science at {org}', orgs: ['MIT', 'Stanford', 'Carnegie Mellon University', 'Columbia University', 'University of Washington'] },
        { template: 'Research Scientist at {org}', orgs: ['Allen Institute for AI', 'OpenAI', 'NVIDIA Research', 'Google DeepMind', 'IBM Research'] },
        { template: 'Postdoctoral Fellow in Responsible AI at {org}', orgs: ['Princeton University', 'Harvard University', 'NYU', 'Cornell Tech', 'UC San Diego'] },
      ],
      'Professional': [
        { template: 'Senior Machine Learning Engineer at {org}', orgs: ['OpenAI', 'Google', 'Microsoft', 'Anthropic', 'Databricks', 'Scale AI'] },
        { template: 'Applied Scientist at {org}', orgs: ['Amazon Web Services', 'Meta', 'NVIDIA', 'ServiceNow', 'Salesforce'] },
        { template: 'Product Manager for AI Platforms at {org}', orgs: ['Adobe', 'Figma', 'HubSpot', 'MongoDB', 'Palantir'] },
      ],
      'Executive/Leadership': [
        { template: 'Founder & CEO of {org}', orgs: ['Signal Harbor AI', 'Northline Vision Systems', 'Atlas Reasoning Labs', 'Cobalt Edge Intelligence', 'Bluefield Robotics'] },
        { template: 'VP of AI Products at {org}', orgs: ['Snowflake', 'Microsoft', 'Autodesk', 'UiPath', 'Twilio'] },
      ],
    },
  },
  {
    slug: 'biotechnology',
    fileName: '10_sector_biotechnology.csv',
    sector: 'Biotechnology',
    connections: ['KU Leuven', 'UGent', 'UAntwerp', 'BAEF'],
    locationOffsets: [0, 1, 8, 18, 19, 20, 23, 24, 25, 35, 38],
    emailDomain: 'biotech-fixture.example.org',
    websiteDomain: 'biotech-fixture.example.org',
    themes: ['cell therapy', 'drug delivery', 'genomics', 'bioprocess engineering', 'diagnostics', 'translational medicine'],
    impactAreas: ['rare disease programs', 'clinical trials', 'manufacturing scale-up', 'precision medicine', 'public health labs', 'medical devices'],
    roles: {
      'Student': [
        { template: 'PhD Student in Biomedical Engineering at {org}', orgs: ['Johns Hopkins University', 'Duke University', 'UC San Diego', 'University of Pennsylvania', 'Northwestern University'] },
        { template: 'Graduate Researcher in Genomics at {org}', orgs: ['Broad Institute', 'Harvard University', 'University of Michigan', 'Yale University', 'Dartmouth College'] },
      ],
      'Academic/Researcher': [
        { template: 'Assistant Professor of Bioengineering at {org}', orgs: ['Johns Hopkins University', 'Duke University', 'University of Pennsylvania', 'UC San Diego', 'University of Michigan'] },
        { template: 'Research Scientist at {org}', orgs: ['Broad Institute', 'Scripps Research', 'Mayo Clinic', 'NIH', 'Cleveland Clinic'] },
        { template: 'Postdoctoral Fellow in Immunology at {org}', orgs: ['MIT', 'Harvard Medical School', 'Emory University', 'Yale University', 'University of Wisconsin-Madison'] },
      ],
      'Professional': [
        { template: 'Senior Scientist at {org}', orgs: ['Moderna', 'Pfizer', 'Genentech', 'Illumina', 'Ginkgo Bioworks', 'Amgen'] },
        { template: 'Clinical Program Manager at {org}', orgs: ['Vertex Pharmaceuticals', 'Bristol Myers Squibb', 'AbbVie', 'Novartis', 'Thermo Fisher Scientific'] },
        { template: 'Bioprocess Engineer at {org}', orgs: ['Regeneron', 'Biogen', 'Danaher', 'Sarepta Therapeutics', 'Merck'] },
      ],
      'Executive/Leadership': [
        { template: 'Founder & CEO of {org}', orgs: ['Harbor Cell Therapeutics', 'Northlake BioSystems', 'Flanders Bridge Diagnostics', 'Peregrine Genomics', 'Beacon Tissue Labs'] },
        { template: 'VP of R&D at {org}', orgs: ['Moderna', 'Genentech', 'Illumina', 'Amgen', 'Ginkgo Bioworks'] },
      ],
    },
  },
  {
    slug: 'finance',
    fileName: '11_sector_finance.csv',
    sector: 'Finance',
    connections: ['KU Leuven', 'UGent', 'BAEF', 'Flanders Investment & Trade'],
    locationOffsets: [2, 3, 4, 13, 14, 15, 25, 31, 34],
    emailDomain: 'finance-fixture.example.org',
    websiteDomain: 'finance-fixture.example.org',
    themes: ['capital markets', 'fintech infrastructure', 'private equity', 'portfolio strategy', 'risk analytics', 'cross-border investment'],
    impactAreas: ['growth-stage companies', 'institutional portfolios', 'founder financing', 'trade missions', 'economic diplomacy', 'market-entry work'],
    roles: {
      'Student': [
        { template: 'MBA Candidate focused on Finance at {org}', orgs: ['Columbia Business School', 'University of Chicago Booth', 'MIT Sloan', 'Wharton', 'NYU Stern'] },
        { template: 'Graduate Student in Financial Engineering at {org}', orgs: ['NYU', 'Columbia University', 'Carnegie Mellon University', 'Princeton University', 'Boston University'] },
      ],
      'Academic/Researcher': [
        { template: 'Assistant Professor of Finance at {org}', orgs: ['Columbia University', 'University of Chicago', 'NYU', 'Princeton University', 'Boston University'] },
        { template: 'Research Fellow in Financial Economics at {org}', orgs: ['Brookings Institution', 'Federal Reserve Bank of New York', 'MIT Sloan', 'Wharton', 'University of Virginia'] },
      ],
      'Professional': [
        { template: 'Investment Analyst at {org}', orgs: ['Goldman Sachs', 'J.P. Morgan', 'BlackRock', 'Morgan Stanley', 'Citadel'] },
        { template: 'Vice President at {org}', orgs: ['Goldman Sachs', 'Blackstone', 'KKR', 'Citi', 'Bank of America'] },
        { template: 'Product Lead for Payments at {org}', orgs: ['Stripe', 'Plaid', 'Adyen', 'Brex', 'Block'] },
      ],
      'Executive/Leadership': [
        { template: 'Managing Director at {org}', orgs: ['BlackRock', 'Goldman Sachs', 'J.P. Morgan', 'KKR', 'Lazard'] },
        { template: 'Founder & CEO of {org}', orgs: ['Blue Harbor Capital', 'Canal Street Fintech', 'Atlas Trade Advisory', 'Northwave Ventures', 'Flanders Bridge Partners'] },
      ],
    },
  },
  {
    slug: 'culture_arts',
    fileName: '12_sector_culture_arts.csv',
    sector: 'Culture & Arts',
    connections: ['VUB', 'UGent', 'Flemish Government', 'Flanders Investment & Trade'],
    locationOffsets: [2, 3, 4, 9, 13, 16, 26, 30, 31, 32, 33],
    emailDomain: 'culture-fixture.example.org',
    websiteDomain: 'culture-fixture.example.org',
    themes: ['curatorial practice', 'arts programming', 'design strategy', 'film production', 'cultural diplomacy', 'public storytelling'],
    impactAreas: ['museum partnerships', 'festival circuits', 'cross-border residencies', 'creative entrepreneurship', 'public engagement', 'city branding'],
    roles: {
      'Student': [
        { template: 'MFA Candidate in Design at {org}', orgs: ['Parsons School of Design', 'RISD', 'School of the Art Institute of Chicago', 'UCLA', 'NYU Tisch'] },
        { template: 'Graduate Fellow in Arts Administration at {org}', orgs: ['Columbia University', 'Georgetown University', 'UCLA', 'The New School', 'Northwestern University'] },
      ],
      'Academic/Researcher': [
        { template: 'Assistant Professor of Media Studies at {org}', orgs: ['NYU', 'UCLA', 'Northwestern University', 'Georgetown University', 'University of Texas at Austin'] },
        { template: 'Curatorial Researcher at {org}', orgs: ['The Met', 'MoMA', 'Smithsonian Institution', 'Art Institute of Chicago', 'LACMA'] },
      ],
      'Professional': [
        { template: 'Creative Director at {org}', orgs: ['IDEO', 'Pentagram', 'The New York Times', 'Spotify', 'Netflix'] },
        { template: 'Producer at {org}', orgs: ['A24', 'Netflix', 'NPR', 'PBS', 'SXSW'] },
        { template: 'Program Manager for Cultural Partnerships at {org}', orgs: ['Smithsonian Institution', 'The Met', 'MoMA', 'Creative Time', 'Lincoln Center'] },
      ],
      'Executive/Leadership': [
        { template: 'Founder & Director of {org}', orgs: ['Canal House Studio', 'Blue Hour Arts Lab', 'Harborline Media Works', 'Flanders Story House', 'North Star Residency'] },
        { template: 'Executive Director at {org}', orgs: ['MoMA PS1', 'Lincoln Center', 'SXSW', 'Art Institute of Chicago', 'Smithsonian Institution'] },
      ],
    },
  },
  {
    slug: 'education',
    fileName: '13_sector_education.csv',
    sector: 'Education',
    connections: ['KU Leuven', 'UGent', 'VUB', 'Flemish Government'],
    locationOffsets: [0, 1, 2, 4, 14, 17, 20, 23, 24, 35, 36, 37, 38],
    emailDomain: 'education-fixture.example.org',
    websiteDomain: 'education-fixture.example.org',
    themes: ['curriculum design', 'student mobility', 'education policy', 'learning science', 'teacher development', 'international programming'],
    impactAreas: ['K-12 systems', 'higher-ed partnerships', 'professional learning', 'study-abroad programs', 'digital classrooms', 'equity initiatives'],
    roles: {
      'Student': [
        { template: 'Graduate Student in Education Policy at {org}', orgs: ['Harvard University', 'Teachers College Columbia', 'University of Michigan', 'Georgetown University', 'University of Virginia'] },
        { template: 'Doctoral Researcher in Learning Sciences at {org}', orgs: ['Northwestern University', 'University of Wisconsin-Madison', 'Boston College', 'Vanderbilt University', 'University of Pennsylvania'] },
      ],
      'Academic/Researcher': [
        { template: 'Assistant Professor of Education at {org}', orgs: ['Harvard University', 'University of Michigan', 'Northwestern University', 'University of Pennsylvania', 'Georgetown University'] },
        { template: 'Research Director at {org}', orgs: ['Digital Promise', 'Brookings Institution', 'RAND Education', 'Harvard Graduate School of Education', 'EdResearch for Recovery'] },
      ],
      'Professional': [
        { template: 'Director of Academic Programs at {org}', orgs: ['Fulbright Commission', 'Teach For America', 'Common App', 'ETS', 'Georgetown University'] },
        { template: 'Learning Experience Designer at {org}', orgs: ['Coursera', 'Khan Academy', 'Duolingo', 'Pearson', '2U'] },
        { template: 'Policy Advisor on Higher Education at {org}', orgs: ['Georgetown University', 'New America', 'State Higher Education Executive Officers', 'Council on Foreign Relations', 'UNESCO Institute for Lifelong Learning'] },
      ],
      'Executive/Leadership': [
        { template: 'Dean of Global Education at {org}', orgs: ['Boston University', 'Georgetown University', 'University of Michigan', 'NYU', 'University of Pennsylvania'] },
        { template: 'Founder & CEO of {org}', orgs: ['Bridge Classroom Partners', 'Northline Learning Labs', 'Atlas Education Works', 'Flanders Scholars Exchange', 'Harbor Path Education'] },
      ],
    },
  },
  {
    slug: 'research',
    fileName: '14_sector_research.csv',
    sector: 'Research',
    connections: ['KU Leuven', 'UGent', 'UAntwerp', 'UHasselt', 'BAEF'],
    locationOffsets: [0, 1, 10, 14, 15, 18, 19, 21, 24, 26, 27, 35, 38, 39],
    emailDomain: 'research-fixture.example.org',
    websiteDomain: 'research-fixture.example.org',
    themes: ['materials science', 'quantitative methods', 'climate modeling', 'neuroscience', 'public-interest research', 'interdisciplinary collaboration'],
    impactAreas: ['federal labs', 'university centers', 'industrial R&D', 'open-science platforms', 'science policy', 'cross-sector partnerships'],
    roles: {
      'Student': [
        { template: 'Doctoral Researcher at {org}', orgs: ['MIT', 'Princeton University', 'University of Washington', 'University of Colorado Boulder', 'Yale University'] },
        { template: 'Graduate Fellow in Computational Science at {org}', orgs: ['Carnegie Mellon University', 'University of Michigan', 'University of Wisconsin-Madison', 'Harvard University', 'Johns Hopkins University'] },
      ],
      'Academic/Researcher': [
        { template: 'Associate Research Scientist at {org}', orgs: ['MIT', 'Princeton University', 'Brookhaven National Laboratory', 'Johns Hopkins University', 'University of Washington'] },
        { template: 'Assistant Professor of Interdisciplinary Studies at {org}', orgs: ['Yale University', 'Northwestern University', 'University of Colorado Boulder', 'University of Michigan', 'Boston University'] },
        { template: 'Postdoctoral Fellow at {org}', orgs: ['NIH', 'Argonne National Laboratory', 'MIT', 'Princeton University', 'Johns Hopkins University'] },
      ],
      'Professional': [
        { template: 'Research Program Manager at {org}', orgs: ['MITRE', 'Battelle', 'RAND Corporation', 'Brookings Institution', 'MIT Lincoln Laboratory'] },
        { template: 'Scientific Software Engineer at {org}', orgs: ['Chan Zuckerberg Initiative', 'Allen Institute', 'SLAC National Accelerator Laboratory', 'The Jackson Laboratory', 'NASA JPL'] },
        { template: 'Policy Research Analyst at {org}', orgs: ['Brookings Institution', 'RAND Corporation', 'Pew Research Center', 'Urban Institute', 'Aspen Institute'] },
      ],
      'Executive/Leadership': [
        { template: 'Director of Research Partnerships at {org}', orgs: ['MITRE', 'Battelle', 'Allen Institute', 'Brookings Institution', 'Chan Zuckerberg Initiative'] },
        { template: 'Founder & CEO of {org}', orgs: ['Blue Current Research Labs', 'Northbridge Science Studio', 'Harborline Analytics', 'Open Field Research Group', 'Atlas Evidence Partners'] },
      ],
    },
  },
];

function slugify(value) {
  return value
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-');
}

function csvEscape(value) {
  const stringValue = String(value ?? '');
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

function pick(list, seed) {
  return list[seed % list.length];
}

function occupationFor(index, sectorIndex) {
  return OCCUPATION_SEQUENCE[(index + sectorIndex * 2) % OCCUPATION_SEQUENCE.length];
}

function titleFor(occupation, position, index) {
  if (occupation === 'Academic/Researcher') {
    return /Professor/.test(position) ? (index % 2 === 0 ? 'Prof.' : 'Dr.') : (index % 3 === 0 ? 'Dr.' : '');
  }
  if (occupation === 'Student') {
    if (index % 17 === 0) return 'Ms.';
    if (index % 19 === 0) return 'Mr.';
    return '';
  }
  if (occupation === 'Executive/Leadership') {
    return index % 8 === 0 ? (index % 16 === 0 ? 'Ms.' : 'Mr.') : '';
  }
  return index % 13 === 0 ? (index % 26 === 0 ? 'Ms.' : 'Mr.') : '';
}

function buildBio({ firstName, sector, connection, location, theme, impactArea, occupation, index }) {
  if (index % 11 === 0) return '';

  const openers = [
    `${firstName} works on ${theme} with a focus on ${impactArea}.`,
    `Focuses on ${theme} and how it supports ${impactArea}.`,
    `Builds cross-border collaborations around ${theme}, especially for ${impactArea}.`,
  ];
  const closers = [
    `Maintains active ties to ${connection} while based in ${location.city}.`,
    `Connects partners in ${location.city} with Flemish peers through ${connection}.`,
    `Often collaborates with alumni and institutional partners linked to ${connection}.`,
  ];
  const extras = [
    `Sector focus: ${sector}.`,
    `Often contributes to transatlantic programming between the US and Flanders.`,
    `Profile created for importer load testing with intentionally varied completeness.`,
  ];

  return [
    pick(openers, index),
    pick(closers, index + 1),
    pick(extras, index + 2),
    occupation === 'Student' ? 'Early-career profile.' : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function generateName(globalIndex, used) {
  for (let attempt = 0; attempt < FIRST_NAMES.length * LAST_NAMES.length; attempt += 1) {
    const firstName = FIRST_NAMES[(globalIndex + attempt * 11) % FIRST_NAMES.length];
    const lastName = LAST_NAMES[(globalIndex * 7 + attempt * 13) % LAST_NAMES.length];
    const key = `${firstName}|${lastName}`;
    if (!used.has(key)) {
      used.add(key);
      return { firstName, lastName };
    }
  }
  throw new Error(`Could not generate a unique name for index ${globalIndex}`);
}

function rowFor(sectorConfig, sectorIndex, index, usedNames) {
  const globalIndex = sectorIndex * COUNT_PER_SECTOR + index;
  const { firstName, lastName } = generateName(globalIndex, usedNames);
  const occupation = occupationFor(index, sectorIndex);
  const role = pick(sectorConfig.roles[occupation], globalIndex);
  const organization = pick(role.orgs, globalIndex + sectorIndex);
  const position = role.template.replace('{org}', organization);
  const location = pick(
    sectorConfig.locationOffsets.map((offset) => LOCATIONS[offset]),
    globalIndex + 3
  );
  const connection = pick(sectorConfig.connections, globalIndex + 5);
  const title = titleFor(occupation, position, globalIndex);
  const slug = `${slugify(firstName)}-${slugify(lastName)}-${String(globalIndex + 1).padStart(3, '0')}`;
  const phone = globalIndex % 6 === 0
    ? ''
    : `+1 ${location.areaCode}-555-${String(1000 + ((globalIndex * 37) % 9000)).padStart(4, '0')}`;
  const linkedin = globalIndex % 5 === 0 ? '' : `https://linkedin.com/in/${slug}`;
  const website = globalIndex % 3 === 0 ? '' : `https://${sectorConfig.websiteDomain}/profiles/${slug}`;
  const email = `${slug}@${sectorConfig.emailDomain}`;
  const theme = pick(sectorConfig.themes, globalIndex + 7);
  const impactArea = pick(sectorConfig.impactAreas, globalIndex + 9);
  const bio = buildBio({
    firstName,
    sector: sectorConfig.sector,
    connection,
    location,
    theme,
    impactArea,
    occupation,
    index: globalIndex,
  });

  return {
    'First Name': firstName,
    'Last Name': lastName,
    'Title': title,
    'Position': position,
    'Occupation': occupation,
    'City': location.city,
    'State': location.state,
    'Email': email,
    'Phone': phone,
    'LinkedIn': linkedin,
    'Website': website,
    'Bio': bio,
    'Flemish Connection': connection,
    'Sector': sectorConfig.sector,
  };
}

function toCsv(rows) {
  const lines = [HEADERS.join(',')];
  for (const row of rows) {
    lines.push(HEADERS.map((header) => csvEscape(row[header] || '')).join(','));
  }
  return `${lines.join('\n')}\n`;
}

mkdirSync(outputDir, { recursive: true });

const usedNames = new Set();
const allRows = [];

for (let sectorIndex = 0; sectorIndex < SECTORS.length; sectorIndex += 1) {
  const sectorConfig = SECTORS[sectorIndex];
  const sectorRows = [];
  for (let index = 0; index < COUNT_PER_SECTOR; index += 1) {
    const row = rowFor(sectorConfig, sectorIndex, index, usedNames);
    sectorRows.push(row);
    allRows.push(row);
  }
  writeFileSync(resolve(outputDir, sectorConfig.fileName), toCsv(sectorRows), 'utf8');
}

writeFileSync(resolve(outputDir, '08_large_people_dataset.csv'), toCsv(allRows), 'utf8');

console.log(`Wrote ${allRows.length} total rows across ${SECTORS.length + 1} CSV files to ${outputDir}`);
