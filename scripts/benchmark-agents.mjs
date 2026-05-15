// Benchmark the user-facing AI agents by hitting their deployed edge functions.
// Logs in as the supplied staff account, runs each agent N times across M prompts,
// and prints per-step timing distributions from the new `_timing` payloads.
//
// Usage: node scripts/benchmark-agents.mjs

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
const EMAIL = process.env.BENCH_EMAIL || "collearend@gmail.com";
const PASSWORD = process.env.BENCH_PASSWORD || "FlemishNetwork!8";

if (!SUPABASE_URL || !SUPABASE_ANON) {
  console.error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env");
  process.exit(1);
}

async function login() {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) {
    console.error("Login failed", res.status, await res.text());
    process.exit(1);
  }
  const data = await res.json();
  return data.access_token;
}

async function callFn(token, name, body) {
  const t0 = performance.now();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const wallMs = performance.now() - t0;
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { ok: res.ok, status: res.status, wallMs, body: json };
}

function pct(arr, p) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function summarize(samples) {
  const agg = new Map(); // span name -> durations[]
  const walls = [];
  for (const s of samples) {
    if (!s.body || !s.body._timing) continue;
    walls.push(s.wallMs);
    for (const sp of s.body._timing.spans || []) {
      if (!agg.has(sp.name)) agg.set(sp.name, []);
      agg.get(sp.name).push(sp.duration_ms);
    }
    if (typeof s.body._timing.total_ms === "number") {
      if (!agg.has("__total_ms")) agg.set("__total_ms", []);
      agg.get("__total_ms").push(s.body._timing.total_ms);
    }
  }
  const rows = [];
  for (const [name, arr] of agg.entries()) {
    arr.sort((a, b) => a - b);
    const sum = arr.reduce((a, b) => a + b, 0);
    rows.push({
      span: name,
      n: arr.length,
      avg_ms: +(sum / arr.length).toFixed(1),
      p50_ms: +pct(arr, 50).toFixed(1),
      p95_ms: +pct(arr, 95).toFixed(1),
      max_ms: +arr[arr.length - 1].toFixed(1),
    });
  }
  rows.sort((a, b) => b.avg_ms - a.avg_ms);
  return { walls, rows };
}

const BENCH = {
  "search-people": {
    label: "Search The Network",
    prompts: [
      { query: "Belgian researchers in Boston" },
      { query: "imec alumni in California" },
      { query: "Flemish entrepreneurs in tech" },
      { query: "KU Leuven PhD New York" },
      { query: "professors with ties to Ghent" },
    ],
    runs: 2,
  },
  "suggest-people": {
    label: "Collection suggestions",
    prompts: [
      { query: "Belgian biotech founders in the United States" },
      { query: "Flemish academics at MIT or Harvard" },
      { query: "Vlaams government officials abroad" },
      { query: "investors with Flemish ties on the East Coast" },
    ],
    runs: 2,
  },
  "ai-agent": {
    label: "ai-agent task=smart_search",
    prompts: [
      { task: "smart_search", context: { query: "Belgian engineers in Texas" } },
      { task: "smart_search", context: { query: "professors with KU Leuven background" } },
      { task: "smart_search", context: { query: "Flemish startups in New York" } },
    ],
    runs: 2,
  },
};

async function main() {
  const token = await login();
  console.log("Logged in OK\n");

  // Fetch one approved person id for update-profile / agent-verify preview.
  const peopleRes = await fetch(`${SUPABASE_URL}/rest/v1/people?select=id,name&limit=3`, {
    headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${token}` },
  });
  const peopleSample = peopleRes.ok ? await peopleRes.json() : [];
  const personIds = peopleSample.map((p) => p.id);

  if (personIds.length) {
    BENCH["update-profile"] = {
      label: "update-profile (inline verify)",
      prompts: personIds.map((id) => ({ personId: id })),
      runs: 1,
    };
    BENCH["agent-verify-preview"] = {
      label: "agent-verify mode=preview",
      _name: "agent-verify",
      prompts: personIds.map((id) => ({ mode: "preview", record_type: "person", record_id: id })),
      runs: 1,
    };
  }

  const overall = {};

  for (const [key, cfg] of Object.entries(BENCH)) {
    const fnName = cfg._name || key;
    console.log(`\n=== ${cfg.label} (${fnName}) ===`);
    const samples = [];
    for (const prompt of cfg.prompts) {
      for (let r = 0; r < cfg.runs; r++) {
        const tag = JSON.stringify(prompt).slice(0, 80);
        try {
          const out = await callFn(token, fnName, prompt);
          if (!out.ok) {
            console.log(`  [${tag}] FAIL ${out.status}: ${JSON.stringify(out.body).slice(0, 200)}`);
            continue;
          }
          const t = out.body._timing;
          const totalMs = t?.total_ms ?? out.wallMs;
          console.log(`  [${tag}] wall=${out.wallMs.toFixed(0)}ms server=${totalMs.toFixed?.(0) ?? totalMs}ms`);
          samples.push(out);
        } catch (err) {
          console.log(`  [${tag}] EXC: ${err.message}`);
        }
      }
    }
    const summary = summarize(samples);
    if (!summary.rows.length) {
      console.log(`  (no _timing samples)`);
      continue;
    }
    console.log(`  wall p50=${pct(summary.walls, 50).toFixed(0)}ms p95=${pct(summary.walls, 95).toFixed(0)}ms`);
    console.log("  span                                  n   avg     p50     p95     max");
    for (const row of summary.rows) {
      console.log(
        `  ${row.span.padEnd(36)} ${String(row.n).padStart(3)} ${String(row.avg_ms).padStart(6)} ${String(row.p50_ms).padStart(6)} ${String(row.p95_ms).padStart(6)} ${String(row.max_ms).padStart(6)}`,
      );
    }
    overall[cfg.label] = summary.rows;
  }

  const outPath = path.resolve("scripts/benchmark-agents-results.json");
  fs.writeFileSync(outPath, JSON.stringify(overall, null, 2));
  console.log(`\nResults written to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
