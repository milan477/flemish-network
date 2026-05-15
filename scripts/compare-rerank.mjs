// Compare suggest-people rerank quality across the currently-deployed model.
// Run this once after deploying flash, then redeploy with pro and run again.
// Output is appended to scripts/compare-rerank-<label>.json so you can diff.

import fs from "node:fs";
import path from "node:path";

function loadDotenv(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const env = { ...loadDotenv(path.resolve(".env")), ...process.env };
const SUPABASE_URL = env.VITE_SUPABASE_URL;
const SUPABASE_ANON = env.VITE_SUPABASE_ANON_KEY;
const EMAIL = "collearend@gmail.com";
const PASSWORD = "FlemishNetwork!8";
const LABEL = process.argv[2] || "current";

const PROMPTS = [
  "Belgian biotech founders in the United States",
  "Flemish academics at MIT or Harvard",
  "Vlaams government officials abroad",
  "investors with Flemish ties on the East Coast",
];

async function login() {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const data = await res.json();
  return data.access_token;
}

async function suggest(token, query) {
  const t0 = performance.now();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/suggest-people`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, max_results: 10 }),
  });
  const wall = performance.now() - t0;
  const json = await res.json();
  return { wall, json };
}

const token = await login();
const out = {};

for (const query of PROMPTS) {
  const { wall, json } = await suggest(token, query);
  const top = (json.candidates || []).slice(0, 5).map((c) => ({
    type: c.entity_type,
    name: c.name,
    score: c.score,
    reason: c.reason,
  }));
  out[query] = {
    wall_ms: Math.round(wall),
    server_ms: json._timing?.total_ms,
    rerank_ms: json._timing?.spans?.find((s) => s.name === "gemini_rerank")?.duration_ms,
    candidates_count: (json.candidates || []).length,
    top5: top,
  };
  console.log(`\n=== ${query} ===`);
  console.log(`wall=${Math.round(wall)}ms rerank=${out[query].rerank_ms}ms`);
  for (const [i, c] of top.entries()) {
    console.log(`  ${i + 1}. [${c.type}] ${c.name} (score=${c.score})`);
    console.log(`     ${c.reason?.slice(0, 140) || ""}`);
  }
}

const outPath = path.resolve(`scripts/compare-rerank-${LABEL}.json`);
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(`\nWrote ${outPath}`);
