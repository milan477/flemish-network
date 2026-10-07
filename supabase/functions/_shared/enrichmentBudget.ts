// Run-level time budget for blocking enrichment calls (LinkedIn search via
// Apify) made while a page is processed. A search may start only while the
// run has enrichment time left and its worst case still finishes before
// latestFinishMs (measured from the run start), so a page with many contacts
// cannot push the run past the point where pages stop starting.
export interface EnrichmentBudget {
  canStart(): boolean;
  record(durationMs: number): void;
  readonly spentMs: number;
}

export function createEnrichmentBudget(options: {
  runStartedAtMs: number;
  latestFinishMs: number;
  runBudgetMs: number;
  worstCaseSearchMs: number;
  now?: () => number;
}): EnrichmentBudget {
  const now = options.now ?? Date.now;
  let spentMs = 0;

  return {
    canStart: () =>
      spentMs < options.runBudgetMs &&
      now() - options.runStartedAtMs + options.worstCaseSearchMs <=
        options.latestFinishMs,
    record: (durationMs: number) => {
      spentMs += Math.max(0, durationMs);
    },
    get spentMs() {
      return spentMs;
    },
  };
}
