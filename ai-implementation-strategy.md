# AI Implementation Strategy: Flemish Network Platform (V4 - Full Lifecycle)

This document serves as the absolute technical blueprint for the AI/Agent integration. 

---

## 1. Phase 1: The Infrastructure Layer ("The Engine")

### Task 1.1: Vector Storage & Asynchronous Embedding
*   **Core Objective:** Enable high-performance semantic search without blocking user transactions.
*   **Database Schema:**
    *   `ALTER TABLE people ADD COLUMN embedding vector(768);`
    *   `ALTER TABLE people ADD COLUMN embedding_dirty_at TIMESTAMPTZ DEFAULT NOW();`
    *   `CREATE INDEX people_embedding_hsnw_idx ON people USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);`
    *   **Trigger:** `CREATE TRIGGER tr_mark_embedding_dirty BEFORE UPDATE OF name, bio, current_position ON people FOR EACH ROW EXECUTE FUNCTION mark_dirty();`
*   **Edge Function (`generate-embeddings`):**
    *   **Logic:** Polls `people` where `embedding_dirty_at > embedding_last_generated_at`. 
    *   **Batching:** Uses `p-limit` for 50 concurrent requests.
*   **Resiliency:** If Google API fails, the record remains "dirty" for the next cron cycle.

### Task 1.2: Agent Experience & Memory Layer (AEML)
*   **Core Objective:** Persist agent knowledge to prevent redundant searches and duplicate hallucinations.
*   **Database Schema:**
    *   `search_query_logs`: `(query_hash TEXT PK, query_text TEXT, yield_score FLOAT, last_run TIMESTAMPTZ)`.
    *   `source_reputation`: `(domain TEXT PK, trust_score FLOAT DEFAULT 1.0, rejection_count INT)`.
    *   `negation_pairs`: `(entity_a_id UUID, entity_b_url TEXT, confirmed_by UUID)`.
    *   `agent_reasoning_cache`: `(task_type TEXT, context_hash TEXT, success_pattern JSONB)`.

### Task 1.3: Resilient SharedSearchService
*   **Core Objective:** Centralized API orchestration with provider cascading.
*   **Logic:**
    1.  Check `web_search_cache` for `SHA-256(query)`.
    2.  Check `api_quotas`. Auto-switch Tavily -> Brave.
    3.  **Token Bucket:** 5 requests/sec limit.
    4.  **Circuit Breaker:** 3 failures = 60s trip.

---

## 2. Phase 2: Autonomous Agents ("The Scouts")

### Task 2.1: The 3-Hop Recursive Discovery Pipeline
*   **Hop 1: The Targeter (Gemini 2.0 Flash):** Generates Hub Queries. Skips low-yield patterns from `search_query_logs`.
*   **Hop 2: The Harvester (Regex + LLM):** Scrapes results. Dedups against `people` and `profile_suggestions`.
*   **Hop 3: The Verifier (Gemini 1.5 Pro):** Targeted research loop. Must check `negation_pairs` before creating suggestions.

### Task 2.2: The Verification Agent ("The Auditor")
*   **Logic:** Targets profiles where `last_verified_at > 6 months`.
*   **Outcome:** If mismatch, creates a `profile_suggestion` flagged as `verification_update` with a `raw_context_snippet`.

### Task 2.3: Connection Discovery
*   **Deterministic:** Alumni/Colleague matching via SQL.
*   **Inference:** Gemini Pro analyzing bio clusters for collaborative links.

---

## 3. Phase 3: The Command Center ("Human-in-the-Loop")

### Task 3.1: Visual Diff & Evidence artifacts
*   **Component:** `SuggestionDiffView.tsx` (Semantic split-screen diff).
*   **Provenance:** Every record includes a `provenance` JSONB field (Source, Agent, Confidence).

---

## 4. Phase 4: Agent Orchestration & Lifecycle Management ("The Brain")

### 6.1 Centralized Orchestrator (`agent-orchestrator` Edge Function)
To prevent agent collisions and manage resource quotas, all agents are managed by a central **Orchestrator**.
*   **Responsibilities:**
    *   **Task Dispatching:** Checks the `agent_task_queue` for pending runs.
    *   **Resource Locking:** Ensures only ONE Discovery Agent runs per sector at a time.
    *   **Quota Guard:** Monitors `api_quotas` across ALL running agents; pauses low-priority agents if credits are < 5%.
    *   **Health Checks:** Kills and restarts zombie agent runs that have exceeded their `max_execution_time`.

### 6.2 Scheduling via `pg_cron`
Agents do not run "at random." They follow a deterministic schedule stored in the DB.
*   **Daily (03:00 UTC):** `agent-discovery` (Scout) - Target: High-priority sectors (AI, Biotech).
*   **Weekly (Sunday 04:00 UTC):** `agent-verification` (Auditor) - Target: Oldest 500 records.
*   **Real-time (Trigger-based):** `generate-embeddings` runs every 5 minutes if "dirty" records exist.

### 6.3 Agent Run Lifecycle (State Machine)
Every agent execution follows this lifecycle in the `agent_runs` table:
1.  **`SCHEDULED`**: Entry created by `pg_cron` or Admin.
2.  **`PROVISIONING`**: Orchestrator verifies quotas and locks resources.
3.  **`RUNNING`**: Edge function executing. Periodic heartbeats sent every 30s.
4.  **`COMPLETING`**: Results extracted; Memory Layer (AEML) updated with yield/success metrics.
5.  **`SUCCESS`** / **`FAILED`**: Terminal states. Failure triggers the **Failure Mode Recovery Matrix**.

---

## 5. Success Metrics & Validation

| Task | KPI | Baseline |
| :--- | :--- | :--- |
| **Orchestration** | Zombie Run Rate | < 1% |
| **Discovery** | New Valid Suggestions / Run | > 5 per sector |
| **Precision** | Admin Approval Rate | > 85% |

---

## 6. Failure Mode Recovery Matrix

| Failure | Response |
| :--- | :--- |
| **Gemini 2.0 Timeout** | Fallback to Gemini 1.5 Flash + Log to `agent_runs.error`. |
| **Orchestrator Crash** | Auto-recovery script checks for `RUNNING` tasks with no heartbeat > 2 mins. |
| **Tavily Quota Hit** | Auto-switch to Brave Search + Update `api_quotas`. |
