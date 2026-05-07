import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260504000000_us_network_scope.sql'),
  'utf8'
);

const rlsLockdownSql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260507008000_lock_down_remaining_public_write_policies.sql'),
  'utf8'
);

describe('US network scope migration', () => {
  it('adds constrained people and organization scope statuses', () => {
    expect(sql).toContain('people_us_network_status_check');
    expect(sql).toContain("'us_based'");
    expect(sql).toContain("'us_connected_abroad'");
    expect(sql).toContain('organizations_us_network_status_check');
    expect(sql).toContain("'belgian_organization_with_us_presence'");
    expect(sql).toContain("'institutional_connector'");
  });

  it('creates FK-backed multi-location tables', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS person_us_connections');
    expect(sql).toContain('person_id uuid NOT NULL REFERENCES people(id)');
    expect(sql).toContain('location_id uuid NOT NULL REFERENCES locations(id)');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS organization_us_locations');
    expect(sql).toContain('organization_id uuid NOT NULL REFERENCES organizations(id)');
    expect(sql).toContain('idx_organization_us_locations_one_primary');
  });

  it('stages organization discovery separately from person discovery', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS discovered_organizations');
    expect(sql).toContain('approved_organization_id uuid REFERENCES organizations(id)');
    expect(sql).toContain('us_locations jsonb');
  });

  it('locks US connection and organization location writes to editor staff', () => {
    expect(rlsLockdownSql).toContain('DROP POLICY IF EXISTS "Public insert person_us_connections"');
    expect(rlsLockdownSql).toContain('DROP POLICY IF EXISTS "Public insert organization_us_locations"');
    expect(rlsLockdownSql).toContain('CREATE POLICY "Staff can read person_us_connections"');
    expect(rlsLockdownSql).toContain('CREATE POLICY "Editors can insert person_us_connections"');
    expect(rlsLockdownSql).toContain('CREATE POLICY "Editors can update person_us_connections"');
    expect(rlsLockdownSql).toContain('CREATE POLICY "Editors can delete person_us_connections"');
    expect(rlsLockdownSql).toContain('CREATE POLICY "Staff can read organization_us_locations"');
    expect(rlsLockdownSql).toContain('CREATE POLICY "Editors can insert organization_us_locations"');
    expect(rlsLockdownSql).toContain('CREATE POLICY "Editors can update organization_us_locations"');
    expect(rlsLockdownSql).toContain('CREATE POLICY "Editors can delete organization_us_locations"');
  });
});
