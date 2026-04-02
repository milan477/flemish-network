import type { SupabaseAdminClient } from "./database.types.ts";

export interface WebSearchResult {
  title: string;
  content: string;
  url: string;
  raw_content?: string;
}

export interface WebSearchResponse {
  results: WebSearchResult[];
  provider: string;
  cached: boolean;
  quota_exhausted: boolean;
}

function coerceCachedResults(value: unknown): WebSearchResult[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];

    const record = item as Record<string, unknown>;
    if (
      typeof record.title !== "string" ||
      typeof record.content !== "string" ||
      typeof record.url !== "string"
    ) {
      return [];
    }

    return [{
      title: record.title,
      content: record.content,
      url: record.url,
      raw_content: typeof record.raw_content === "string" ? record.raw_content : undefined,
    }];
  });
}

/**
 * Shared web search module with Tavily/Brave cascading, quota tracking, and 30-day caching.
 */
export async function searchWeb(
  query: string,
  supabase: SupabaseAdminClient,
  options?: { skipCache?: boolean }
): Promise<WebSearchResponse> {
  const tavilyKey = Deno.env.get("TAVILY_API_KEY");
  const braveKey = Deno.env.get("BRAVE_API_KEY");

  // 1. Normalize query and compute hash
  const normalized = query.trim().toLowerCase();
  const hashBuffer = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(normalized)
  );
  const queryHash = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // 2. Check cache (30-day TTL)
  if (!options?.skipCache) {
    const { data: cached } = await supabase
      .from("web_search_cache")
      .select("results, provider")
      .eq("query_hash", queryHash)
      .gte("searched_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
      .limit(1)
      .maybeSingle();

    if (cached) {
      return {
        results: coerceCachedResults(cached.results),
        provider: cached.provider,
        cached: true,
        quota_exhausted: false,
      };
    }
  }

  const currentMonth = new Date().toISOString().slice(0, 7); // 'YYYY-MM'

  // 3. Try Tavily first
  if (tavilyKey) {
    const quota = await getOrCreateQuota(supabase, "tavily", currentMonth, 1000);
    if (quota.calls_used < quota.calls_limit) {
      try {
        const results = await callTavily(query, tavilyKey);
        await incrementQuota(supabase, "tavily", currentMonth);
        if (results.length > 0) {
          await cacheResults(supabase, queryHash, query, "tavily", results);
        }
        return { results, provider: "tavily", cached: false, quota_exhausted: false };
      } catch {
        // Tavily failed, try Brave
      }
    }
  }

  // 4. Try Brave as fallback
  if (braveKey) {
    const quota = await getOrCreateQuota(supabase, "brave", currentMonth, 2000);
    if (quota.calls_used < quota.calls_limit) {
      try {
        const results = await callBrave(query, braveKey);
        await incrementQuota(supabase, "brave", currentMonth);
        if (results.length > 0) {
          await cacheResults(supabase, queryHash, query, "brave", results);
        }
        return { results, provider: "brave", cached: false, quota_exhausted: false };
      } catch {
        // Brave also failed
      }
    }
  }

  // 5. All providers exhausted or failed
  const tavilyQuota = tavilyKey
    ? await getOrCreateQuota(supabase, "tavily", currentMonth, 1000)
    : null;
  const braveQuota = braveKey
    ? await getOrCreateQuota(supabase, "brave", currentMonth, 2000)
    : null;
  const allExhausted =
    (!tavilyKey || (tavilyQuota && tavilyQuota.calls_used >= tavilyQuota.calls_limit)) &&
    (!braveKey || (braveQuota && braveQuota.calls_used >= braveQuota.calls_limit));

  return {
    results: [],
    provider: "none",
    cached: false,
    quota_exhausted: allExhausted ?? false,
  };
}

async function callTavily(
  query: string,
  apiKey: string
): Promise<WebSearchResult[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const resp = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: "advanced",
        max_results: 10,
        include_raw_content: true,
      }),
      signal: controller.signal,
    });

    if (!resp.ok) throw new Error(`Tavily ${resp.status}`);

    const data = await resp.json();
    if (!data.results || !Array.isArray(data.results)) return [];

    return data.results.map(
      (r: { title?: string; content?: string; url?: string; raw_content?: string }) => ({
        title: r.title || "",
        content: r.content || "",
        url: r.url || "",
        raw_content: r.raw_content || "",
      })
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function callBrave(
  query: string,
  apiKey: string
): Promise<WebSearchResult[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10`;
    const resp = await fetch(url, {
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": apiKey,
      },
      signal: controller.signal,
    });

    if (!resp.ok) throw new Error(`Brave ${resp.status}`);

    const data = await resp.json();
    const webResults = data.web?.results;
    if (!Array.isArray(webResults)) return [];

    return webResults.map(
      (r: { title?: string; description?: string; url?: string }) => ({
        title: r.title || "",
        content: r.description || "",
        url: r.url || "",
      })
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function getOrCreateQuota(
  supabase: SupabaseAdminClient,
  provider: string,
  month: string,
  defaultLimit: number
): Promise<{ calls_used: number; calls_limit: number }> {
  const { data } = await supabase
    .from("api_quotas")
    .select("calls_used, calls_limit")
    .eq("provider", provider)
    .eq("month", month)
    .maybeSingle();

  if (data) return data;

  // Create quota row for this month
  const { data: created } = await supabase
    .from("api_quotas")
    .upsert(
      { provider, month, calls_used: 0, calls_limit: defaultLimit },
      { onConflict: "provider,month" }
    )
    .select("calls_used, calls_limit")
    .single();

  return created || { calls_used: 0, calls_limit: defaultLimit };
}

async function incrementQuota(
  supabase: SupabaseAdminClient,
  provider: string,
  month: string
): Promise<void> {
  // Use rpc or raw update with row-level lock to prevent double-counting
  await supabase.rpc("increment_api_quota", { p_provider: provider, p_month: month });
}

async function cacheResults(
  supabase: SupabaseAdminClient,
  queryHash: string,
  queryText: string,
  provider: string,
  results: WebSearchResult[]
): Promise<void> {
  await supabase
    .from("web_search_cache")
    .upsert(
      {
        query_hash: queryHash,
        query_text: queryText,
        provider,
        results,
        searched_at: new Date().toISOString(),
      },
      { onConflict: "query_hash,provider" }
    );
}

/**
 * Format search results as a text string for LLM consumption.
 */
export function formatResultsForLLM(results: WebSearchResult[]): string {
  return results
    .map((r, index) => {
      // Prefer raw_content (full page text) over snippet, truncate to keep the prompt bounded.
      const body = r.raw_content && r.raw_content.length > r.content.length
        ? r.raw_content.slice(0, 1600)
        : r.content;
      return [
        `Result ${index + 1}`,
        `URL: ${r.url}`,
        `Title: ${r.title}`,
        `Content: ${body}`,
      ].join("\n");
    })
    .join("\n\n---\n\n");
}
