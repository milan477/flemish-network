# Runbook

This runbook is the staff reference for the structured `error_kind` values returned by edge functions and surfaced through `StructuredErrorBanner`. Each section is anchored on the lowercase `error_kind` so links from failure UI strings (`docs/RUNBOOK.md [<kind>]`) jump to the matching entry.

When a failure card mentions one of these codes, follow the section below before retrying.

---

## db_timeout

**What it means.** A database query exceeded the configured statement timeout before returning. Typical for slow joins, missing indexes, or transient Supabase load.

**Likely causes.**
- A discovery or verification batch hit a long-running query under load.
- Supabase Postgres is under temporary pressure (noisy neighbour, autovacuum spike).
- A new query landed without a supporting index.

**What staff should do.**
1. Wait 1–2 minutes and retry the action once. Most `db_timeout` errors clear on retry.
2. If it repeats, open `/admin/system` and confirm no other run is currently `running`. Cancel a stuck run if needed.
3. If the same query keeps timing out, escalate to engineering with the panel where it occurred and the approximate time, so they can check the slow-query log and `pg_stat_statements`.

---

## network

**What it means.** The edge function could not reach an upstream service (Supabase Postgres, an AI provider, or an external enrichment endpoint) due to a transport-layer failure.

**Likely causes.**
- Transient internet hiccup between the edge function and the upstream.
- Upstream provider (Anthropic, Gemini, Apify, Supabase) is degraded.
- DNS or TLS issue inside the edge runtime.

**What staff should do.**
1. Retry once. Most network errors are transient.
2. If the failure mentions a specific provider (Anthropic, Gemini, Apify), check that provider's status page before retrying further.
3. If retries keep failing across providers, escalate to engineering — the edge runtime itself may be the problem.

---

## auth_failed

**What it means.** The edge function rejected the request because the staff session token was missing, expired, or did not carry the required role.

**Likely causes.**
- Staff session expired in the browser tab.
- Staff role was changed (e.g. demoted from `editor` to `viewer`) since this tab loaded.
- A bug in how the panel attached the token.

**What staff should do.**
1. Reload the page. The browser will refresh the Supabase session.
2. If reload does not help, sign out from `/account` and sign back in.
3. If the action still fails after a fresh sign-in, confirm with an admin that your role on `/admin/access` is high enough for the action (e.g. admin-only deletions).
4. If your role is correct and the error persists, escalate — this is a bug, not a permissions problem.

---

## quota_exhausted

**What it means.** The action was rejected because a rate-limit or quota guard fired. This is the canonical response for the `agent-scheduler` manual-interval guard ("you just ran this; wait before running again") and for AI provider daily quotas.

**Likely causes.**
- A discovery or verification run was triggered too soon after the previous run.
- A daily AI provider budget (Anthropic, Gemini) is fully consumed.
- A per-user action throttle fired.

**What staff should do.**
1. Read the message — it usually states when the next run is allowed (e.g. "next allowed at 14:32 UTC").
2. Wait for the cooldown and retry; do not bypass by clicking faster.
3. If the quota is a daily AI budget, coordinate with engineering before raising the cap.

---

## agent_failure

**What it means.** A discovery, verification, or reflection agent run reached a terminal failure state inside the edge function. The error is a wrapped exception from inside the agent pipeline rather than a transport or auth problem.

**Likely causes.**
- An AI provider returned an unparseable response (schema drift).
- A downstream tool (search provider, enrichment API) returned an unexpected payload.
- An assertion inside the agent pipeline tripped.

**What staff should do.**
1. Open the failed run in `/admin/discovery` (or the matching panel) and read the structured error message — it usually names the failing step.
2. Retry the action once. If the failure was a transient model error, the retry will succeed.
3. If the same step fails twice, do not keep retrying — escalate to engineering with the run ID and the failing step name. Repeated agent failures consume budget without producing results.
