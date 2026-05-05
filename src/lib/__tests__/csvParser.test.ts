import { describe, expect, it } from 'vitest';
import {
  PROFILE_FIELDS,
  applyMappings,
  parseCSV,
  suggestMappings,
  validateMappedRows,
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
