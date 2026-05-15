# Human-labeled eval sets

These YAML files are the ground-truth datasets the project will use to measure
AI quality regressions and to seed few-shot examples for prompt iteration.

See `docs/EVALUATION.md` §Human-labeled eval sets for context on which tasks
benefit from few-shot and which metric each set is scored against.

## How to fill these in

1. Pick one file (start with `suggest-people.yaml` — highest-leverage task).
2. For each `- id:` entry, run the deployed agent with the listed prompt and
   paste the returned candidates into `candidate_pool` (or the equivalent
   auto-populated field).
3. Fill in the **human_*** fields with your judgment. The keys are:
   - `human_top5`: ordered list of IDs you think *should* be at the top.
   - `human_reject`: IDs that should never appear in results.
   - `human_correct` / `human_should_be`: for extraction tasks, what the
     correct field value is (or `null` to mean "model should have abstained").
   - `human_label`: for classification tasks, the correct label.
   - `notes`: free-text rationale. These notes become the candidate few-shot
     examples later, so write them like you would write a hint to a careful
     reviewer.
4. Aim for 10–20 entries per file before treating the set as "useful enough to
   measure changes against."

## Files

| File | Task | Status |
|---|---|---|
| `suggest-people.yaml` | Collection rerank | **Claude first-pass** (3 prompts) — review and flip `claude_pass: true` → `human_reviewed: true` |
| `search-people.yaml` | Search Stage-2 rerank | **Claude first-pass** (3 queries) — review and flip the flag |
| `check-profile.yaml` | Verification field suggestions | empty scaffold — needs your domain knowledge |
| `page-classification.yaml` | Discovery page classifier | empty scaffold — needs you to open source URLs |
| `contact-extraction.yaml` | Discovery contact extractor | empty scaffold — needs you to read pages |

The eval runner (`run.mjs`) does not exist yet — build it once any one of
these files has ≥ 10 filled entries.
