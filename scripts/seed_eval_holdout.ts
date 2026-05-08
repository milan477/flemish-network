// Loads held-out evaluation people from a local CSV/JSON into
// `discovery_eval_holdout`. The file is NOT checked in — it contains contact
// info that should not live in the repo. Pass the path via HOLDOUT_FILE.
//
// Usage:
//   HOLDOUT_FILE=/path/to/holdout.json \
//     VITE_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     npx tsx scripts/seed_eval_holdout.ts
//
// Expected JSON shape (one row per object):
// [
//   {
//     "full_name": "Jane Doe",
//     "known_aliases": ["Jane M. Doe"],
//     "known_employer": "MIT",
//     "known_city": "Cambridge",
//     "known_state": "MA",
//     "flemish_signal": "KU Leuven PhD 2014",
//     "source_note": "Delegation contact list"
//   }
// ]
//
// Existing rows (matched by full_name, case-insensitive) are skipped.

import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const holdoutFile = process.env.HOLDOUT_FILE;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
}
if (!holdoutFile) {
  throw new Error('HOLDOUT_FILE is required (path to JSON file with holdout rows).');
}

interface HoldoutSeed {
  full_name: string;
  known_aliases?: string[];
  known_employer?: string | null;
  known_city?: string | null;
  known_state?: string | null;
  flemish_signal: string;
  source_note?: string | null;
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

async function main() {
  const raw = readFileSync(holdoutFile!, 'utf8');
  const rows = JSON.parse(raw) as HoldoutSeed[];
  if (!Array.isArray(rows)) throw new Error('Holdout file must be a JSON array.');

  const { data: existing, error: existingError } = await supabase
    .from('discovery_eval_holdout')
    .select('full_name');
  if (existingError) throw existingError;
  const existingNames = new Set(
    (existing || []).map((row) => (row.full_name || '').trim().toLowerCase()),
  );

  const toInsert = rows
    .filter((row) => row.full_name && row.flemish_signal)
    .filter((row) => !existingNames.has(row.full_name.trim().toLowerCase()))
    .map((row) => ({
      full_name: row.full_name.trim(),
      known_aliases: row.known_aliases ?? [],
      known_employer: row.known_employer ?? null,
      known_city: row.known_city ?? null,
      known_state: row.known_state ?? null,
      flemish_signal: row.flemish_signal.trim(),
      source_note: row.source_note ?? null,
    }));

  if (toInsert.length === 0) {
    console.log(`Nothing to insert. ${rows.length} rows in file, ${existingNames.size} already in DB.`);
    return;
  }

  const { error: insertError } = await supabase
    .from('discovery_eval_holdout')
    .insert(toInsert);
  if (insertError) throw insertError;

  console.log(`Inserted ${toInsert.length} holdout rows (skipped ${rows.length - toInsert.length}).`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
