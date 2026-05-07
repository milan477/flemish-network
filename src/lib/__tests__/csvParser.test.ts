import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  PROFILE_FIELDS,
  ORGANIZATION_FIELDS,
  applyMappings,
  buildCandidateKeyForMode,
  getImportTemplateData,
  normalizePeopleStatus,
  parseCSV,
  suggestMappingsForMode,
  suggestMappings,
  validateOrganizationRows,
  validateMappedRows,
  validateRowsForMode,
} from '../csvParser';

describe('csvParser US scope fields', () => {
  it('includes manual/import columns for connected-abroad people', () => {
    const keys = PROFILE_FIELDS.map((field) => field.key);
    expect(keys).toContain('us_network_status');
    expect(keys).toContain('current_location_city');
    expect(keys).toContain('current_location_country');
    expect(keys).toContain('us_connection_city');
    expect(keys).toContain('us_connection_state');
    expect(keys).toContain('us_connection_label');
  });

  it('maps connected-abroad CSV columns and validates required connection fields', () => {
    const parsed = parseCSV(
      [
        'First Name,Last Name,People Scope,Current City Abroad,Current Country Abroad,US Connection City,US Connection State,US Connection Label',
        'Jan,Peeters,US-connected abroad,Leuven,Belgium,New Haven,CT,Yale alumnus',
      ].join('\n')
    );
    const mappings = suggestMappings(parsed.headers);
    const rows = applyMappings(parsed.rows, parsed.headers, mappings);
    const result = validateMappedRows(rows);

    expect(result.invalid).toEqual([]);
    expect(result.valid[0].us_network_status).toBe('US-connected abroad');
    expect(result.valid[0].current_location_city).toBe('Leuven');
    expect(result.valid[0].us_connection_label).toBe('Yale alumnus');
  });

  it('normalizes staff-facing people scope values to the database contract', () => {
    expect(normalizePeopleStatus('US-based')).toBe('us_based');
    expect(normalizePeopleStatus('US-connected abroad')).toBe('us_connected_abroad');
    expect(normalizePeopleStatus('needs review')).toBe('needs_review');
  });

  it('rejects connected-abroad rows without a US connection location', () => {
    const rows = [
      {
        first_name: 'Jan',
        us_network_status: 'US-connected abroad',
        current_location_city: 'Leuven',
        current_location_country: 'Belgium',
      },
    ];
    const result = validateMappedRows(rows);

    expect(result.valid).toEqual([]);
    expect(result.invalid[0].reason).toContain('US Connection City');
  });
});

describe('csvParser Phase 5C pending import modes', () => {
  it('maps and validates people fixture as pending candidate input', () => {
    const fixture = readFileSync(
      resolve(__dirname, '../__fixtures__/phase5-discovery-import/people_pending_candidates.csv'),
      'utf8'
    );
    const parsed = parseCSV(fixture);
    const mappings = suggestMappingsForMode(parsed.headers, 'people');
    const rows = applyMappings(parsed.rows, parsed.headers, mappings);
    const result = validateRowsForMode(rows, 'people');

    expect(result.invalid).toEqual([]);
    expect(result.valid[0].first_name).toBe('Jan');
    expect(result.valid[0].last_name).toBe('De Smedt');
    expect(buildCandidateKeyForMode(result.valid[0], 'people')).toBe('person:email:jan example com');
  });

  it('maps and validates organization fixture with evidence and multi-value sectors', () => {
    const fixture = readFileSync(
      resolve(__dirname, '../__fixtures__/phase5-discovery-import/organizations_pending_candidates.csv'),
      'utf8'
    );
    const parsed = parseCSV(fixture);
    const mappings = suggestMappingsForMode(parsed.headers, 'organizations');
    const rows = applyMappings(parsed.rows, parsed.headers, mappings);
    const result = validateRowsForMode(rows, 'organizations');

    expect(result.invalid).toEqual([]);
    expect(result.valid[0].name).toBe('Flanders Tech Hub');
    expect(result.valid[0].sectors).toBe('Artificial Intelligence; Research');
    expect(buildCandidateKeyForMode(result.valid[0], 'organizations')).toBe(
      'org:website:flanderstech example'
    );
  });

  it('exposes current people and organization import templates', () => {
    const peopleTemplate = getImportTemplateData('people');
    const organizationTemplate = getImportTemplateData('organizations');

    expect(peopleTemplate.columns).toContain('People Scope');
    expect(peopleTemplate.columns).toContain('US Connection Source URL');
    expect(peopleTemplate.columns).not.toContain('US Connection Confidence');
    expect(peopleTemplate.columns).not.toContain('Phone');
    expect(peopleTemplate.examples[0]['People Scope']).toBe('US-based');

    expect(organizationTemplate.columns).toEqual(ORGANIZATION_FIELDS.map((field) => field.label));
    expect(organizationTemplate.columns).toContain('Evidence URL');
    expect(organizationTemplate.columns).not.toContain('Confidence');
    expect(organizationTemplate.examples[0]['Organization Scope']).toBe('US organization connected to Flanders');
  });

  it('rejects malformed people email and URL values before import', () => {
    const result = validateMappedRows([
      {
        first_name: 'Jan',
        email: 'not-an-email',
        website_url: 'https://example.com',
      },
      {
        first_name: 'Sofie',
        email: 'sofie@example.com',
        website_url: 'bad url',
      },
    ]);

    expect(result.valid).toEqual([]);
    expect(result.invalid.map((entry) => entry.reason)).toEqual([
      'Malformed email address',
      'Malformed URL',
    ]);
  });

  it('rejects organization rows with weak evidence or partial US location', () => {
    const result = validateOrganizationRows([
      {
        name: 'No Evidence Org',
        website_url: 'https://example.com',
      },
      {
        name: 'Partial Location Org',
        source_url: 'https://example.com/source',
        location_city: 'Boston',
      },
    ]);

    expect(result.valid).toEqual([]);
    expect(result.invalid.map((entry) => entry.reason)).toEqual([
      'Missing evidence URL or excerpt',
      'US locations need both city and state',
    ]);
  });
});
