export interface ApifyOptions {
  sync?: boolean;       // true = wait for results (up to timeoutSecs), false = start and return runId
  timeoutSecs?: number; // max wait time for sync mode (default 120)
}

export interface ApifyResult<T> {
  items: T[];
  runId: string;
  status: "SUCCEEDED" | "FAILED" | "RUNNING";
}

/**
 * Shared Apify client module for running actors.
 * Used by Discovery Agent (LinkedIn search) and Verification Agent (LinkedIn profile scrape).
 */
export async function runApifyActor<T = Record<string, unknown>>(
  actorId: string,
  input: Record<string, unknown>,
  options?: ApifyOptions
): Promise<ApifyResult<T>> {
  const token = Deno.env.get("APIFY_TOKEN");
  if (!token) {
    throw new ApifyError("APIFY_TOKEN not configured", "no_token");
  }

  const sync = options?.sync ?? true;
  const timeoutSecs = options?.timeoutSecs ?? 120;

  if (sync) {
    return runSync<T>(actorId, input, token, timeoutSecs);
  } else {
    return runAsync<T>(actorId, input, token, timeoutSecs);
  }
}

async function runSync<T>(
  actorId: string,
  input: Record<string, unknown>,
  token: string,
  timeoutSecs: number
): Promise<ApifyResult<T>> {
  const encodedActorId = actorId.replace("/", "~");
  const url = `https://api.apify.com/v2/acts/${encodedActorId}/run-sync-get-dataset-items?token=${token}&timeout=${timeoutSecs}`;

  const controller = new AbortController();
  const fetchTimeout = setTimeout(() => controller.abort(), (timeoutSecs + 5) * 1000);

  let resp: Response;
  try {
    resp = await fetchWithRetry(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(fetchTimeout);
    if ((err as Error).name === "AbortError") {
      throw new ApifyError(`Apify sync timed out after ${timeoutSecs}s`, "actor_timeout");
    }
    throw err;
  }
  clearTimeout(fetchTimeout);

  if (resp.status === 402) {
    throw new ApifyError("Apify credits exhausted", "apify_quota_exhausted");
  }

  if (!resp.ok) {
    const text = await resp.text();
    throw new ApifyError(`Apify actor failed: ${resp.status} ${text}`, "actor_failed");
  }

  const items = (await resp.json()) as T[];

  return {
    items,
    runId: resp.headers.get("x-apify-run-id") || "unknown",
    status: "SUCCEEDED",
  };
}

async function runAsync<T>(
  actorId: string,
  input: Record<string, unknown>,
  token: string,
  timeoutSecs: number
): Promise<ApifyResult<T>> {
  // Start the run
  const encodedActorId = actorId.replace("/", "~");
  const startUrl = `https://api.apify.com/v2/acts/${encodedActorId}/runs?token=${token}`;
  const startResp = await fetchWithRetry(startUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (startResp.status === 402) {
    throw new ApifyError("Apify credits exhausted", "apify_quota_exhausted");
  }

  if (!startResp.ok) {
    throw new ApifyError(`Apify start failed: ${startResp.status}`, "actor_failed");
  }

  const startData = await startResp.json();
  const runId = startData.data?.id;
  const datasetId = startData.data?.defaultDatasetId;

  if (!runId || !datasetId) {
    throw new ApifyError("Missing runId or datasetId", "actor_failed");
  }

  // Poll for completion
  const deadline = Date.now() + timeoutSecs * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5000));

    const statusResp = await fetch(
      `https://api.apify.com/v2/actor-runs/${runId}?token=${token}`
    );
    const statusData = await statusResp.json();
    const status = statusData.data?.status;

    if (status === "SUCCEEDED") {
      const itemsResp = await fetch(
        `https://api.apify.com/v2/datasets/${datasetId}/items?token=${token}&format=json`
      );
      const items = (await itemsResp.json()) as T[];
      return { items, runId, status: "SUCCEEDED" };
    }

    if (status === "FAILED" || status === "ABORTED" || status === "TIMED-OUT") {
      throw new ApifyError(`Actor run ${status}`, "actor_failed");
    }
  }

  // Timed out waiting
  return { items: [], runId, status: "RUNNING" };
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  retries = 1
): Promise<Response> {
  let lastResp: Response | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    lastResp = await fetch(url, init);
    if (lastResp.status !== 429) return lastResp;
    // Rate limited: back off 5s, retry once
    if (attempt < retries) {
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  return lastResp!;
}

export class ApifyError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

/**
 * Check remaining Apify credits via the user API.
 */
export async function getApifyUsage(): Promise<{
  available: boolean;
  error?: string;
}> {
  const token = Deno.env.get("APIFY_TOKEN");
  if (!token) return { available: false, error: "APIFY_TOKEN not configured" };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const resp = await fetch(`https://api.apify.com/v2/users/me?token=${token}`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!resp.ok) return { available: false, error: `API ${resp.status}` };
    // If user endpoint responds, token is valid and account is accessible
    return { available: true };
  } catch (err) {
    return { available: false, error: (err as Error).message };
  }
}

/**
 * Key Apify actor IDs used by the agent system.
 */
export const APIFY_ACTORS = {
  LINKEDIN_PROFILE_SCRAPER: "supreme_coder/linkedin-profile-scraper",
  LINKEDIN_PROFILE_SEARCH: "harvestapi/linkedin-profile-search",
  GOOGLE_SEARCH: "apify/google-search-scraper",
} as const;
