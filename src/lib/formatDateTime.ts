/**
 * Canonical staff-facing date/time formatter.
 *
 * Use this helper anywhere the UI renders a date or timestamp so the format
 * stays consistent. The canonical shape is `MMM d, h:mm a` (e.g. `May 7, 2:30 PM`).
 * Pick `formatDate` when only the calendar day matters.
 */

const DATE_TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
};

const DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
};

function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Format a date+time as `MMM d, h:mm a` (e.g. `May 7, 2:30 PM`).
 * Returns the supplied fallback when the input is missing or invalid.
 */
export function formatDateTime(
  value: string | number | Date | null | undefined,
  fallback = '—'
): string {
  const d = toDate(value);
  if (!d) return fallback;
  return d.toLocaleString('en-US', DATE_TIME_OPTIONS);
}

/**
 * Format a date as `MMM d, yyyy` (e.g. `May 7, 2026`). Use when the time is
 * not meaningful for the surface (e.g. created-at on a collection card).
 */
export function formatDate(
  value: string | number | Date | null | undefined,
  fallback = '—'
): string {
  const d = toDate(value);
  if (!d) return fallback;
  return d.toLocaleDateString('en-US', DATE_OPTIONS);
}
