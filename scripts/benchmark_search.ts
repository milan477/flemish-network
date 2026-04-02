import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

interface BenchmarkQueryRow {
  slug: string;
  query_text: string;
  intent: string;
  priority: number;
}

interface SearchResponse {
  route?: string;
  degraded?: boolean;
  results?: Array<{ name: string; score: number }>;
}

function parseArgs() {
  const args = process.argv.slice(2);
  let slug: string | null = null;
  let limit: number | null = null;

  for (const arg of args) {
    if (arg.startsWith("--slug=")) {
      slug = arg.slice("--slug=".length).trim() || null;
      continue;
    }

    if (arg.startsWith("--limit=")) {
      const parsed = Number(arg.slice("--limit=".length));
      limit = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    }
  }

  return { slug, limit };
}

const { slug, limit } = parseArgs();
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error(
    "Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Export both before running the benchmark."
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

let benchmarkQuery = supabase
  .from("benchmark_search_queries_active")
  .select("slug, query_text, intent, priority")
  .order("priority", { ascending: true });

if (slug) {
  benchmarkQuery = benchmarkQuery.eq("slug", slug);
}

const { data: benchmarkRows, error: benchmarkError } = await benchmarkQuery;

if (benchmarkError) {
  console.error("Failed to load benchmark queries:", benchmarkError.message);
  process.exit(1);
}

const rows = ((benchmarkRows || []) as BenchmarkQueryRow[]).slice(
  0,
  limit ?? benchmarkRows?.length ?? 0
);

if (rows.length === 0) {
  console.error("No benchmark queries matched.");
  process.exit(1);
}

for (const row of rows) {
  const { data, error } = await supabase.functions.invoke("search-people", {
    body: {
      query: row.query_text,
      max_results: 5,
    },
  });

  if (error) {
    console.log(
      `${row.slug} | intent=${row.intent} | ERROR=${error.message}`
    );
    continue;
  }

  const response = (data || {}) as SearchResponse;
  const topNames = (response.results || [])
    .slice(0, 3)
    .map((result) => `${result.name} (${result.score.toFixed(3)})`)
    .join(", ");

  console.log(
    `${row.slug} | intent=${row.intent} | route=${response.route || "unknown"} | degraded=${Boolean(
      response.degraded
    )} | results=${response.results?.length || 0}${topNames ? ` | top=${topNames}` : ""}`
  );
}
