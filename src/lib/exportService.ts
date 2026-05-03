import * as XLSX from 'xlsx';
import { supabase, displayName, type Person } from './supabase';
import { getPersonFlemishConnectionText } from './flemishConnections';

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
  'Phone',
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
    person.phone || '',
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

function setWorksheetColumnWidths(ws: XLSX.WorkSheet, rows: string[][]): void {
  ws['!cols'] = PEOPLE_EXPORT_HEADERS.map((_, index) => {
    const maxLength = rows.reduce((max, row) => Math.max(max, row[index]?.length || 0), 0);
    return { wch: Math.min(Math.max(maxLength + 2, 10), 42) };
  });
}

const CSV_HEADER = PEOPLE_EXPORT_HEADERS.join(',');

export function buildPeopleCsv(people: PersonWithSectors[]): string {
  return [CSV_HEADER, ...people.map(personToCsvRow)].join('\n');
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
  setWorksheetColumnWidths(worksheet, worksheetData.slice(1));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'People');
  XLSX.writeFile(workbook, filenameWithExtension(filename, 'flemish-network-export.xlsx', '.xlsx'));
}

// ---------- Collection Briefing (print) ----------

export function printCollectionBriefing(
  collectionName: string,
  collectionDescription: string | undefined,
  members: { person: Person; notes?: string }[]
): void {
  const NOTE_LINES = 4;
  const noteLineHtml = Array(NOTE_LINES).fill('<div class="note-line"></div>').join('');

  const memberHtml = members.map((m, i) => {
    const p = m.person;
    const initials = [p.first_name?.[0], p.last_name?.[0]].filter(Boolean).join('').toUpperCase()
      || p.name?.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase() || '';
    const location = [p.locations?.city, p.locations?.state].filter(Boolean).join(', ');

    const details: string[] = [];
    if (p.current_position) details.push(escapeHtml(p.current_position));
    if (location) details.push(escapeHtml(location));
    const flemishText = getPersonFlemishConnectionText(p);
    if (flemishText) details.push(`<span class="fc">FC:</span> ${escapeHtml(flemishText)}`);

    const contactParts: string[] = [];
    if (p.email) contactParts.push(escapeHtml(p.email));
    if (p.phone) contactParts.push(escapeHtml(p.phone));

    return `
      <div class="row">
        <div class="person">
          <div class="person-top">
            <div class="avatar">${p.profile_photo_url ? `<img src="${escapeHtml(p.profile_photo_url)}" alt="">` : initials}</div>
            <div class="person-id">
              <span class="name">${escapeHtml(displayName(p))}</span>
              <span class="details">${details.join(' &middot; ')}</span>
            </div>
          </div>
          ${p.bio ? `<p class="bio">${escapeHtml(p.bio)}</p>` : ''}
          ${contactParts.length > 0 ? `<p class="contact">${contactParts.join(' &middot; ')}</p>` : ''}
          ${m.notes ? `<p class="existing-notes">${escapeHtml(m.notes)}</p>` : ''}
        </div>
        <div class="notes-area">
          <span class="notes-label">Notes</span>
          ${noteLineHtml}
        </div>
      </div>${i < members.length - 1 ? '' : ''}`;
  }).join('');

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<title>${escapeHtml(collectionName)} - Briefing</title>
<style>
  @page { margin: 0.5in 0.5in; size: letter; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #222; line-height: 1.35; padding: 0; font-size: 11px; }
  .header { padding: 0 0 6px; margin-bottom: 8px; border-bottom: 2px solid #222; }
  .header h1 { font-size: 16px; font-weight: 700; }
  .header .sub { color: #666; font-size: 10px; margin-top: 1px; }

  .row { display: flex; gap: 0; border-bottom: 1px solid #ddd; padding: 7px 0; page-break-inside: avoid; }
  .row:last-child { border-bottom: none; }

  .person { flex: 1; min-width: 0; padding-right: 10px; }
  .person-top { display: flex; align-items: flex-start; gap: 6px; }
  .avatar { width: 26px; height: 26px; border-radius: 50%; background: #dbeafe; color: #1d4ed8; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 8px; flex-shrink: 0; margin-top: 1px; overflow: hidden; }
  .avatar img { width: 100%; height: 100%; object-fit: cover; }
  .person-id { min-width: 0; }
  .name { font-weight: 700; font-size: 12px; display: block; line-height: 1.2; }
  .details { font-size: 10px; color: #555; display: block; line-height: 1.3; margin-top: 1px; }
  .fc { font-weight: 600; color: #444; }
  .bio { font-size: 10px; color: #444; margin-top: 3px; line-height: 1.3; }
  .contact { font-size: 9px; color: #777; margin-top: 2px; }
  .existing-notes { font-size: 9px; color: #666; margin-top: 2px; font-style: italic; }

  .notes-area { width: 330px; flex-shrink: 0; border-left: 1px solid #ddd; padding-left: 10px; display: flex; flex-direction: column; }
  .notes-label { font-size: 8px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #aaa; margin-bottom: 4px; }
  .note-line { border-bottom: 1px solid #e0e0e0; height: 15px; }
</style></head><body>
<div class="header">
  <h1>${escapeHtml(collectionName)}</h1>
  <div class="sub">${members.length} member${members.length !== 1 ? 's' : ''}${collectionDescription ? ` &mdash; ${escapeHtml(collectionDescription)}` : ''} &middot; ${new Date().toLocaleDateString()}</div>
</div>
${memberHtml}
</body></html>`;

  const printWindow = window.open('', '_blank');
  if (!printWindow) return;
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.addEventListener('load', () => {
    printWindow.print();
  });
}

// ---------- Helpers ----------

function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
