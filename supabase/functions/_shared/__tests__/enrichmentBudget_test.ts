import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { createEnrichmentBudget } from "../enrichmentBudget.ts";

function fakeClock(startMs: number) {
  let current = startMs;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

Deno.test("createEnrichmentBudget: stops starting searches once the run's enrichment time is spent", () => {
  const clock = fakeClock(1_000_000);
  const budget = createEnrichmentBudget({
    runStartedAtMs: 1_000_000,
    latestFinishMs: 90_000,
    runBudgetMs: 10_000,
    worstCaseSearchMs: 17_000,
    now: clock.now,
  });

  // A page with many contacts: each search takes the typical ~3.4 s.
  let started = 0;
  for (let index = 0; index < 20; index += 1) {
    if (!budget.canStart()) break;
    started += 1;
    clock.advance(3_400);
    budget.record(3_400);
  }

  assertEquals(started, 3);
  assertEquals(budget.spentMs, 10_200);
  assertEquals(budget.canStart(), false);
});

Deno.test("createEnrichmentBudget: no search starts unless its worst case finishes before the page-start cutoff", () => {
  const clock = fakeClock(1_000_000);
  const budget = createEnrichmentBudget({
    runStartedAtMs: 1_000_000,
    latestFinishMs: 90_000,
    runBudgetMs: 15_000,
    worstCaseSearchMs: 17_000,
    now: clock.now,
  });

  clock.advance(73_000);
  assertEquals(budget.canStart(), true);
  clock.advance(1);
  assertEquals(budget.canStart(), false);
});
