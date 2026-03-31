# Phase 0 Benchmarks

This directory documents the fixed benchmark contract that must stay stable while Phase 1+ search and discovery work lands.

## Search benchmark set

Canonical storage: `benchmark_search_queries` and `benchmark_search_queries_active`

The seeded set covers three query shapes:
- `direct_lookup`
- `faceted_search`
- `exploratory_semantic`

Use the active view as the only source of truth when comparing search changes before and after a phase.

## Discovery benchmark set

Canonical storage: `benchmark_discovery_sources` and `benchmark_discovery_sources_active`

Each record locks in:
- the source family being measured
- the seed query to use
- the expected evidence signal
- the priority metro the source is meant to improve

Use this set when testing discovery recall or source-pack/frontier changes. Do not replace rows casually; add new rows only when the benchmark contract itself is intentionally revised.

## Saved ops views

Use these saved views for baseline measurement:
- `ops_search_benchmark_clicks`
- `ops_discovery_review_metrics`
- `ops_benchmark_discovery_source_coverage`
- `ops_phase_success_metrics`

These datasets and views are internal-only. After the Phase 0 lockdown migration they are no longer readable from the anon/authenticated client roles; inspect them through privileged SQL, the dashboard, or a future admin-only server path.

## Review telemetry

`discovered_contacts` now keeps reviewed rows instead of deleting approvals immediately. The review contract is:
- `status = 'pending' | 'approved' | 'rejected'`
- `review_outcome = 'approved_new' | 'approved_merge' | 'rejected'`
- `reviewed_at` is populated automatically on first non-pending status

`profile_suggestions.reviewed_at` is also populated automatically on approval or rejection so approval-rate and latency metrics use durable timestamps.
