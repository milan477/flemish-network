import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { supabase, type Person, type Organization } from './supabase';
import { getPersonFlemishConnectionText, getOrganizationFlemishConnectionText } from './flemishConnections';
import type { CollectionMember } from './supabase';

// ---------- People Export ----------

export interface PersonWithSectors extends Person {
  sectorNames?: string[];
}

const PEOPLE_EXPORT_HEADERS = [
  'Title',
  'First Name',
  'Last Name',
  'Position',
  'Organization',
  'About',
  'City',
  'State',
  'Sector(s)',
  'Flemish Connections',
  'Email',
  'LinkedIn',
  'Website',
  'X URL',
];

function escapeCsvField(value: string): string {
  if (!value) return '';
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function personToExportFields(person: PersonWithSectors): string[] {
  return [
    person.title || '',
    person.first_name || '',
    person.last_name || '',
    person.current_position || '',
    person.current_position?.split(/ at | @ /i)[1]?.trim() || '',
    person.bio || '',
    person.locations?.city || '',
    person.locations?.state || '',
    (person.sectorNames || []).join('; '),
    getPersonFlemishConnectionText(person),
    person.email || '',
    person.linkedin_url || '',
    person.website_url || '',
    person.twitter_url || '',
  ];
}

function personToCsvRow(person: PersonWithSectors): string {
  return personToExportFields(person).map(escapeCsvField).join(',');
}

async function enrichPeopleForExport(people: Person[]): Promise<PersonWithSectors[]> {
  if (people.length === 0) return [];

  const personIds = people.map((p) => p.id);
  const { data: sectorRows } = await supabase
    .from('person_sectors')
    .select('person_id, sectors(name)')
    .in('person_id', personIds);

  const sectorMap = new Map<string, string[]>();
  if (sectorRows) {
    for (const row of sectorRows as unknown as { person_id: string; sectors: { name: string } | null }[]) {
      if (!row.sectors?.name) continue;
      const existing = sectorMap.get(row.person_id) || [];
      existing.push(row.sectors.name);
      sectorMap.set(row.person_id, existing);
    }
  }

  return people.map((p) => ({
    ...p,
    sectorNames: sectorMap.get(p.id) || [],
  }));
}

function filenameWithExtension(filename: string | undefined, defaultFilename: string, extension: string): string {
  const base = filename || defaultFilename;
  return base.replace(/\.[^.]+$/, '') + extension;
}

function setWorksheetColumnWidths(ws: XLSX.WorkSheet, headers: string[], rows: string[][]): void {
  ws['!cols'] = headers.map((_, index) => {
    const maxLength = rows.reduce((max, row) => Math.max(max, row[index]?.length || 0), 0);
    return { wch: Math.min(Math.max(maxLength + 2, 10), 42) };
  });
}

const PEOPLE_CSV_HEADER = PEOPLE_EXPORT_HEADERS.join(',');

export function buildPeopleCsv(people: PersonWithSectors[]): string {
  return [PEOPLE_CSV_HEADER, ...people.map(personToCsvRow)].join('\n');
}

export function buildPeopleWorksheetData(people: PersonWithSectors[]): string[][] {
  return [PEOPLE_EXPORT_HEADERS, ...people.map(personToExportFields)];
}

export async function exportPeopleToCsv(people: Person[], filename?: string): Promise<void> {
  const enriched = await enrichPeopleForExport(people);

  const csv = buildPeopleCsv(enriched);
  downloadFile(csv, filenameWithExtension(filename, 'flemish-network-export.csv', '.csv'), 'text/csv;charset=utf-8;');
}

export async function exportPeopleToExcel(people: Person[], filename?: string): Promise<void> {
  const enriched = await enrichPeopleForExport(people);
  const worksheetData = buildPeopleWorksheetData(enriched);
  const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);
  setWorksheetColumnWidths(worksheet, PEOPLE_EXPORT_HEADERS, worksheetData.slice(1));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'People');
  XLSX.writeFile(workbook, filenameWithExtension(filename, 'flemish-network-export.xlsx', '.xlsx'));
}

// ---------- Organization Export ----------

export interface OrganizationWithSectors extends Organization {
  sectorNames?: string[];
}

const ORG_EXPORT_HEADERS = [
  'Name',
  'Type',
  'Description',
  'City',
  'State',
  'Sector(s)',
  'Flemish Connections',
  'Website',
];

function orgToExportFields(org: OrganizationWithSectors): string[] {
  return [
    org.name || '',
    org.type || '',
    org.description || '',
    org.locations?.city || '',
    org.locations?.state || '',
    (org.sectorNames || []).join('; '),
    getOrganizationFlemishConnectionText(org),
    org.website_url || '',
  ];
}

function orgToCsvRow(org: OrganizationWithSectors): string {
  return orgToExportFields(org).map(escapeCsvField).join(',');
}

async function enrichOrganizationsForExport(organizations: Organization[]): Promise<OrganizationWithSectors[]> {
  if (organizations.length === 0) return [];

  const orgIds = organizations.map((o) => o.id);
  const { data: sectorRows } = await supabase
    .from('organization_sectors')
    .select('organization_id, sectors(name)')
    .in('organization_id', orgIds);

  const sectorMap = new Map<string, string[]>();
  if (sectorRows) {
    for (const row of sectorRows as unknown as { organization_id: string; sectors: { name: string } | null }[]) {
      if (!row.sectors?.name) continue;
      const existing = sectorMap.get(row.organization_id) || [];
      existing.push(row.sectors.name);
      sectorMap.set(row.organization_id, existing);
    }
  }

  return organizations.map((o) => ({
    ...o,
    sectorNames: sectorMap.get(o.id) || [],
  }));
}

export function buildOrgCsv(organizations: OrganizationWithSectors[]): string {
  return [ORG_EXPORT_HEADERS.join(','), ...organizations.map(orgToCsvRow)].join('\n');
}

export function buildOrgWorksheetData(organizations: OrganizationWithSectors[]): string[][] {
  return [ORG_EXPORT_HEADERS, ...organizations.map(orgToExportFields)];
}

export async function exportOrganizationsToCsv(organizations: Organization[], filename?: string): Promise<void> {
  const enriched = await enrichOrganizationsForExport(organizations);
  const csv = buildOrgCsv(enriched);
  downloadFile(csv, filenameWithExtension(filename, 'flemish-network-orgs.csv', '.csv'), 'text/csv;charset=utf-8;');
}

export async function exportOrganizationsToExcel(organizations: Organization[], filename?: string): Promise<void> {
  const enriched = await enrichOrganizationsForExport(organizations);
  const worksheetData = buildOrgWorksheetData(enriched);
  const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);
  setWorksheetColumnWidths(worksheet, ORG_EXPORT_HEADERS, worksheetData.slice(1));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Organizations');
  XLSX.writeFile(workbook, filenameWithExtension(filename, 'flemish-network-orgs.xlsx', '.xlsx'));
}

// ---------- Collection Export (mixed people + organizations) ----------

export async function exportCollectionToExcel(members: CollectionMember[], filename?: string): Promise<void> {
  const people = members.filter((m) => m.person).map((m) => m.person!);
  const organizations = members.filter((m) => m.organization).map((m) => m.organization!);

  const [enrichedPeople, enrichedOrgs] = await Promise.all([
    enrichPeopleForExport(people),
    enrichOrganizationsForExport(organizations),
  ]);

  const workbook = XLSX.utils.book_new();

  if (enrichedPeople.length > 0) {
    const peopleData = buildPeopleWorksheetData(enrichedPeople);
    const peopleSheet = XLSX.utils.aoa_to_sheet(peopleData);
    setWorksheetColumnWidths(peopleSheet, PEOPLE_EXPORT_HEADERS, peopleData.slice(1));
    XLSX.utils.book_append_sheet(workbook, peopleSheet, 'People');
  }

  if (enrichedOrgs.length > 0) {
    const orgData = buildOrgWorksheetData(enrichedOrgs);
    const orgSheet = XLSX.utils.aoa_to_sheet(orgData);
    setWorksheetColumnWidths(orgSheet, ORG_EXPORT_HEADERS, orgData.slice(1));
    XLSX.utils.book_append_sheet(workbook, orgSheet, 'Organizations');
  }

  XLSX.writeFile(workbook, filenameWithExtension(filename, 'collection-export.xlsx', '.xlsx'));
}

export async function exportCollectionToCsv(members: CollectionMember[], filename?: string): Promise<void> {
  const people = members.filter((m) => m.person).map((m) => m.person!);
  const organizations = members.filter((m) => m.organization).map((m) => m.organization!);

  const [enrichedPeople, enrichedOrgs] = await Promise.all([
    enrichPeopleForExport(people),
    enrichOrganizationsForExport(organizations),
  ]);

  const zip = new JSZip();

  if (enrichedPeople.length > 0) {
    zip.file('people.csv', buildPeopleCsv(enrichedPeople));
  }
  if (enrichedOrgs.length > 0) {
    zip.file('organizations.csv', buildOrgCsv(enrichedOrgs));
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  const base = (filename || 'collection-export').replace(/\.[^.]+$/, '');
  downloadBlob(blob, `${base}.zip`);
}

// ---------- Helpers ----------

function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  downloadBlob(blob, filename);
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
