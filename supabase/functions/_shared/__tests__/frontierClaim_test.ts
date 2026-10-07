import { assert, assertEquals } from "jsr:@std/assert@^1.0.0";
import type { SupabaseAdminClient } from "../database.types.ts";
import {
  claimFrontierForRun,
  HARD_STOP_REQUEUE_PRIORITY,
  hardStopRequeuePatch,
} from "../frontierClaim.ts";

type Row = Record<string, unknown>;

const NOW = "2026-10-07T18:54:27.000Z";
const PAST = "2026-10-07T15:00:00.000Z";
const FUTURE = "2026-10-20T09:00:00.000Z";

function frontierRow(
  id: string,
  canonicalUrl: string,
  priority: number,
  overrides: Row = {},
): Row {
  return {
    id,
    canonical_url: canonicalUrl,
    domain: new URL(canonicalUrl).hostname,
    priority_score: priority,
    status: "queued",
    next_fetch_at: PAST,
    created_at: "2026-10-01T00:00:00.000Z",
    claimed_at: null,
    claimed_run_id: null,
    fetch_error_count: 0,
    ...overrides,
  };
}

// In-memory stand-in for the PostgREST calls the claim makes. Filters chained on
// a builder are applied to the rows, so a missing condition on the conditional
// update shows up as a wrongly claimed row.
function fakeDb(options: {
  frontier: Row[];
  domains?: Row[];
  rpcRows?: (limit: number) => Row[];
  beforeUpdate?: (frontier: Row[]) => void;
}) {
  const rpcCalls: Array<Record<string, unknown>> = [];
  const client = {
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      let patch: Row | null = null;
      const builder = {
        select() {
          return builder;
        },
        update(next: Row) {
          patch = next;
          return builder;
        },
        in(column: string, values: unknown[]) {
          filters.push((row) => values.includes(row[column]));
          return builder;
        },
        eq(column: string, value: unknown) {
          filters.push((row) => row[column] === value);
          return builder;
        },
        lte(column: string, value: string) {
          filters.push((row) => String(row[column]) <= value);
          return builder;
        },
        then(resolve: (value: { data: Row[]; error: null }) => unknown) {
          const source = table === "ops_discovery_domain_yield"
            ? options.domains || []
            : options.frontier;
          if (patch) options.beforeUpdate?.(options.frontier);
          const matched = source.filter((row) => filters.every((f) => f(row)));
          if (patch) matched.forEach((row) => Object.assign(row, patch));
          return Promise.resolve({
            data: matched.map((row) => ({ ...row })),
            error: null,
          }).then(resolve);
        },
      };
      return builder;
    },
    rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, ...args });
      return Promise.resolve({
        data: options.rpcRows?.(Number(args.p_limit)) || [],
        error: null,
      });
    },
  } as unknown as SupabaseAdminClient;
  return { client, rpcCalls };
}

Deno.test("claimFrontierForRun: a prompted run claims its own seed results before higher-priority leftovers", async () => {
  const fayat = frontierRow("fayat", "https://www.vlaanderen.be/fayat-laureaten", 100000);
  const oldBaef = frontierRow("old-baef", "https://baef.be/2025/12/19/baef-fellows-2025-2026", 113.1);
  const ownA = frontierRow("own-a", "https://www.bu.edu/belgian-researchers", 110);
  const ownB = frontierRow("own-b", "https://news.mit.edu/baef-fellow", 109);
  const { client, rpcCalls } = fakeDb({
    frontier: [fayat, oldBaef, ownA, ownB],
    rpcRows: (limit) => [oldBaef].slice(0, limit),
  });

  const claim = await claimFrontierForRun(client, {
    runId: "run-prompted",
    batchSize: 3,
    perDomainLimit: 3,
    ownSeedUrls: [ownB.canonical_url as string, ownA.canonical_url as string],
    nowIso: NOW,
  });

  assertEquals(claim.rows.map((row) => row.id), ["own-a", "own-b", "old-baef"]);
  assertEquals(claim.ownClaimed, 2);
  assertEquals(ownA.status, "fetching");
  assertEquals(ownA.claimed_run_id, "run-prompted");
  assertEquals(ownA.claimed_at, NOW);
  // Only the slot the run's own seeds left open goes to the shared queue.
  assertEquals(rpcCalls, [{
    name: "claim_discovery_frontier",
    p_run_id: "run-prompted",
    p_limit: 1,
    p_per_domain_limit: 3,
  }]);
  assertEquals(fayat.status, "queued");
});

Deno.test("claimFrontierForRun: own seeds honor next_fetch_at, status, domain policy, and the per-domain limit", async () => {
  const rows = [
    frontierRow("due-1", "https://baef.be/a", 110),
    frontierRow("due-2", "https://baef.be/b", 109),
    frontierRow("due-3", "https://baef.be/c", 108),
    frontierRow("over-domain-limit", "https://baef.be/d", 107),
    frontierRow("recently-fetched", "https://www.harvard.edu/x", 110, { next_fetch_at: FUTURE }),
    frontierRow("failed", "https://www.mit.edu/y", 110, { status: "failed" }),
    frontierRow("claimed-elsewhere", "https://www.tufts.edu/z", 110, {
      status: "fetching",
      claimed_run_id: "other-run",
    }),
    frontierRow("blocked", "https://spam.example/p", 110),
    frontierRow("over-budget", "https://busy.example/q", 110),
    frontierRow("done-and-due", "https://www.bu.edu/r", 101, { status: "done" }),
  ];
  const { client, rpcCalls } = fakeDb({
    frontier: rows,
    domains: [
      { domain: "spam.example", status: "blocked", weekly_fetch_budget: 20, recent_fetches_7d: 0 },
      { domain: "busy.example", status: "active", weekly_fetch_budget: 20, recent_fetches_7d: 20 },
    ],
  });

  const claim = await claimFrontierForRun(client, {
    runId: "run-prompted",
    batchSize: 10,
    perDomainLimit: 3,
    ownSeedUrls: rows.map((row) => row.canonical_url as string),
    nowIso: NOW,
  });

  assertEquals(claim.rows.map((row) => row.id), ["due-1", "due-2", "due-3", "done-and-due"]);
  assertEquals(rows.find((row) => row.id === "claimed-elsewhere")?.claimed_run_id, "other-run");
  assertEquals(rpcCalls.length, 1);
  assertEquals(rpcCalls[0].p_limit, 6);
});

Deno.test("claimFrontierForRun: a seed another run claims mid-flight is not double-claimed", async () => {
  const ownA = frontierRow("own-a", "https://www.bu.edu/a", 110);
  const ownB = frontierRow("own-b", "https://news.mit.edu/b", 109);
  const filler = frontierRow("filler", "https://flandersintheusa.org/n", 15);
  const { client, rpcCalls } = fakeDb({
    frontier: [ownA, ownB, filler],
    // A concurrent run wins own-b between the candidate read and the claim.
    beforeUpdate: () => {
      Object.assign(ownB, { status: "fetching", claimed_run_id: "other-run" });
    },
    rpcRows: () => [filler],
  });

  const claim = await claimFrontierForRun(client, {
    runId: "run-prompted",
    batchSize: 2,
    perDomainLimit: 3,
    ownSeedUrls: [ownA.canonical_url as string, ownB.canonical_url as string],
    nowIso: NOW,
  });

  assertEquals(claim.rows.map((row) => row.id), ["own-a", "filler"]);
  assertEquals(ownB.claimed_run_id, "other-run");
  assertEquals(rpcCalls[0].p_limit, 1);
});

Deno.test("claimFrontierForRun: a full batch of own seeds skips the shared queue; no seeds uses it alone", async () => {
  const own = [
    frontierRow("own-a", "https://www.bu.edu/a", 110),
    frontierRow("own-b", "https://news.mit.edu/b", 109),
  ];
  const full = fakeDb({ frontier: own });
  const fullClaim = await claimFrontierForRun(full.client, {
    runId: "run-prompted",
    batchSize: 2,
    perDomainLimit: 3,
    ownSeedUrls: own.map((row) => row.canonical_url as string),
    nowIso: NOW,
  });
  assertEquals(fullClaim.rows.length, 2);
  assertEquals(full.rpcCalls.length, 0);

  const scheduled = fakeDb({
    frontier: [],
    rpcRows: (limit) => [frontierRow("bg", "https://baef.be/news", 15)].slice(0, limit),
  });
  const scheduledClaim = await claimFrontierForRun(scheduled.client, {
    runId: "run-scheduled",
    batchSize: 10,
    perDomainLimit: 3,
    ownSeedUrls: [],
    nowIso: NOW,
  });
  assertEquals(scheduledClaim.rows.map((row) => row.id), ["bg"]);
  assertEquals(scheduledClaim.ownClaimed, 0);
  assertEquals(scheduled.rpcCalls[0].p_limit, 10);
});

Deno.test("hardStopRequeuePatch: a page that hit the hard stop loses its priority and backs off", () => {
  const nowMs = Date.parse(NOW);
  const patch = hardStopRequeuePatch({ priority_score: 100000, fetch_error_count: 0 }, nowMs);
  assertEquals(patch.status, "queued");
  assertEquals(patch.claimed_at, null);
  assertEquals(patch.claimed_run_id, null);
  assertEquals(patch.priority_score, HARD_STOP_REQUEUE_PRIORITY);
  assertEquals(patch.fetch_error_count, 1);
  assertEquals(patch.last_extraction_outcome, "hard_stop");
  assertEquals(Date.parse(String(patch.next_fetch_at)) - nowMs, 6 * 3_600_000);

  // Repeated hard stops back off further, capped at a week; low priorities are kept.
  const repeated = hardStopRequeuePatch({ priority_score: "4", fetch_error_count: 40 }, nowMs);
  assertEquals(repeated.priority_score, 4);
  assertEquals(Date.parse(String(repeated.next_fetch_at)) - nowMs, 7 * 24 * 3_600_000);
  assert(HARD_STOP_REQUEUE_PRIORITY < 100);
});
