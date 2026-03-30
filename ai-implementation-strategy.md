# AI Implementation Strategy: Flemish Network Platform

This document is the definitive technical blueprint for all AI and agent features. Every section specifies exact models, schemas, data flows, and error handling. No room for interpretation.

---

## Current State (as of 2026-03-25)

### What Exists and Works
1. **`ai-agent` edge function** — 4 structured tasks (parse_contacts, smart_search, flemish_search, check_profile) using `gemini-3-flash-preview`
2. **`search-contacts` edge function** — Tavily web search + Gemini extraction + dedup against `people` table
3. **`update-profile` edge function** — Per-person web search + profile comparison via `check_profile`
4. **`profile_suggestions` table** — Stores AI-suggested field changes (pending/approved/rejected)
5. **Frontend AI search** — `smartSearch()` extracts keywords via LLM, `scorePersonAgainstKeywords()` ranks client-side
6. **Deterministic filter parser** — `filterParser.ts` maps NL queries to filters without LLM

### Known Bugs in Existing AI Code
1. **`geocode` edge function** references `people.latitude`, `people.longitude`, `people.location_city`, `people.location_state` — all dropped in location refactor. Must be fixed to only cache into `locations` table.
2. **`update-profile` edge function** reads `person.location_city`/`person.location_state` from `people.*` — those columns no longer exist. Must join `locations` table via `location_id`.
3. **All edge functions** hardcode `gemini-3-flash-preview` — no env var fallback.
4. **`search-contacts` dedup loads ALL people names** — `SELECT name, email, linkedin_url FROM people` with no filter. Replace with targeted lookups: `WHERE email = $1 OR linkedin_url = $2 OR LOWER(name) = LOWER($3)` per extracted contact.
5. **`suggestPeople()` in `aiService.ts` loads ALL people** (limit 200) and scores client-side. Will not scale past a few hundred contacts. Must be replaced by server-side embedding search (Phase 1.3).
6. **`profile_suggestions.person_id NOT NULL`** prevents Discovery Agent from storing newly discovered contacts. See Phase 3.1 for `discovered_contacts` staging table solution.

### What Does NOT Exist Yet
- Embeddings (pgvector, embedding column, generate-embeddings function, text-embedding-004 calls)
- suggest-people edge function (embedding pre-filter + Gemini Pro ranking)
- Agent infrastructure (agent_runs, api_quotas, web_search_cache tables)
- Discovery, verification, and connection agents
- Brave Search integration (key exists, no code)
- Apify integration (key exists in .env, no code) — LinkedIn scraping, Google SERP scraping
- Model env vars (all models are hardcoded)
- Agent orchestrator / scheduler

---

## Phase 1: Embedding Infrastructure

### 1.1 Database Changes

**Migration: Enable pgvector + add embedding column**
```sql
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

ALTER TABLE people ADD COLUMN embedding vector(768);
ALTER TABLE people ADD COLUMN embedding_dirty_at timestamptz DEFAULT now();
ALTER TABLE people ADD COLUMN embedding_generated_at timestamptz;

-- HNSW index for fast similarity search (better than IVFFlat for < 10k rows)
CREATE INDEX people_embedding_hnsw_idx
  ON people USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Trigger: mark embedding dirty when relevant fields change
CREATE OR REPLACE FUNCTION mark_embedding_dirty()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.embedding_dirty_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER tr_mark_embedding_dirty
  BEFORE UPDATE OF name, bio, current_position, flemish_connection, occupation, location_id
  ON people
  FOR EACH ROW
  EXECUTE FUNCTION mark_embedding_dirty();

-- Sector changes go through the junction table, not the people row.
-- Mark embedding dirty when person_sectors changes.
CREATE OR REPLACE FUNCTION mark_person_embedding_dirty_from_sector()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE people SET embedding_dirty_at = now()
  WHERE id = COALESCE(NEW.person_id, OLD.person_id);
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER tr_mark_embedding_dirty_sector_insert
  AFTER INSERT ON person_sectors
  FOR EACH ROW
  EXECUTE FUNCTION mark_person_embedding_dirty_from_sector();

CREATE TRIGGER tr_mark_embedding_dirty_sector_delete
  AFTER DELETE ON person_sectors
  FOR EACH ROW
  EXECUTE FUNCTION mark_person_embedding_dirty_from_sector();

-- Similarity search function
CREATE OR REPLACE FUNCTION match_people(
  query_embedding vector(768),
  match_count int DEFAULT 50,
  similarity_threshold float DEFAULT 0.3
)
RETURNS TABLE (
  id uuid,
  name text,
  first_name text,
  last_name text,
  current_position text,
  location_id uuid,
  flemish_connection text,
  bio text,
  occupation text,
  available_for_lectures boolean,
  similarity float
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id, p.name, p.first_name, p.last_name,
    p.current_position, p.location_id,
    p.flemish_connection, p.bio, p.occupation,
    p.available_for_lectures,
    1 - (p.embedding <=> query_embedding) AS similarity
  FROM people p
  WHERE p.embedding IS NOT NULL
    AND 1 - (p.embedding <=> query_embedding) > similarity_threshold
  ORDER BY p.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
```

### 1.2 Edge Function: `generate-embeddings`

**Purpose:** Generate 768-dim embeddings for people profiles using Google text-embedding-004.

**Endpoint:** `POST /functions/v1/generate-embeddings`

**Input:**
```json
{
  "personId": "uuid",           // single person
  "personIds": ["uuid", ...],   // batch of people
  "backfill": true              // process all people with NULL embedding
}
```
Exactly one of `personId`, `personIds`, or `backfill` must be provided.

**Embedding text construction:**
```
"{name} | {current_position} | {bio} | {sectors comma-joined} | {flemish_connection} | {location.city}, {location.state}"
```
- Sectors: join `person_sectors` + `sectors` tables to get sector names
- Location: join `locations` table via `location_id`
- Null/empty fields: omit from the text (don't include "null" or empty segments)

**Google Embedding API call:**
```
POST https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent
Headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY }
Body: { "content": { "parts": [{ "text": embeddingText }] } }
```

**Response parsing:** Extract `embedding.values` (float array, length 768)

**DB update:** `UPDATE people SET embedding = $1, embedding_generated_at = now() WHERE id = $2`

**Backfill mode:** Query `SELECT id FROM people WHERE embedding IS NULL`, process in batches of 20, 500ms delay between batches.

**⚠️ Backfill timeout constraint:** Supabase edge functions have a 60-second hard limit. With 500 people, batch processing in a single invocation will exceed this. Solution: the backfill endpoint processes one batch of 20, returns `{ processed, remaining }`, and the frontend loops — calling the endpoint repeatedly until `remaining === 0`. Each invocation is a fresh 60-second window.

```typescript
// Frontend backfill loop (in Admin.tsx)
let remaining = Infinity;
while (remaining > 0) {
  const res = await supabase.functions.invoke('generate-embeddings', {
    body: { backfill: true, batch_size: 20 }
  });
  remaining = res.data.remaining;
  // update progress bar
}
```

**Error handling:**
- If Google API returns non-200: log error, skip person, continue batch
- If embedding dimensions != 768: log error, skip person
- Record stays "dirty" (embedding_dirty_at > embedding_generated_at) for next cycle
- Return: `{ processed: number, failed: number, errors: string[] }`

**Trigger points (frontend, fire-and-forget):**
- After person INSERT in AddContact.tsx
- After person UPDATE in PersonProfile.tsx
- Admin "Backfill Embeddings" button in Admin.tsx

### 1.3 Edge Function: `suggest-people`

**Purpose:** Find relevant people for a collection using embedding similarity + Gemini Pro ranking.

**Endpoint:** `POST /functions/v1/suggest-people`

**Input:**
```json
{
  "query": "string",              // what kind of people to find
  "collection_id": "uuid",        // optional: exclude existing members
  "exclude_ids": ["uuid", ...],   // optional: additional exclusions
  "max_results": 15               // optional, default 15
}
```

**Pipeline:**
1. Embed `query` using text-embedding-004 (same API as generate-embeddings)
2. Call `match_people(query_embedding, 50)` via Supabase RPC
3. Remove any IDs in `exclude_ids` or already in collection
4. Build Gemini Pro prompt with remaining candidates:
   ```
   Each candidate: ID, name, position, location, flemish_connection, bio (truncated 200 chars), similarity score
   ```
5. Call Gemini Pro with structured output schema:
   ```json
   { "message": "string", "suggestions": [{ "id": "string", "reason": "string" }] }
   ```
6. Merge similarity scores from step 2 into response

**Model:** `gemini-2.5-pro-preview-05-06` (use `GEMINI_PRO_MODEL` env var with this default)

**Output:**
```json
{
  "message": "string",
  "suggestions": [
    { "id": "uuid", "name": "string", "reason": "string", "similarity": 0.85 }
  ]
}
```

**Error handling:**
- If no embeddings exist: return `{ message: "No embeddings. Run backfill first.", suggestions: [] }`
- If Gemini Pro fails: fall back to returning top 15 by similarity score alone, with `reason: "Ranked by profile similarity"`
- If query embedding fails: return 500 with error message

### 1.4 Model Configuration Refactor

All edge functions must read model IDs from env vars with sensible defaults:

| Edge Function | Env Var | Default Value |
|---|---|---|
| `ai-agent` | `GEMINI_FLASH_MODEL` | `gemini-3-flash-preview` |
| `search-contacts` | `GEMINI_FLASH_MODEL` | `gemini-3-flash-preview` |
| `update-profile` | (calls ai-agent, inherits) | — |
| `suggest-people` | `GEMINI_PRO_MODEL` | `gemini-2.5-pro-preview-05-06` |
| `generate-embeddings` | (uses text-embedding-004, no change needed) | — |

Implementation: Replace `const GEMINI_MODEL = "gemini-3-flash-preview"` with:
```typescript
const GEMINI_MODEL = Deno.env.get("GEMINI_FLASH_MODEL") || "gemini-3-flash-preview";
```

### 1.5 Additional Env Vars for External Services

| Env Var | Used by | Purpose |
|---|---|---|
| `APIFY_TOKEN` | Shared Apify module, Discovery Agent, Verification Agent | Apify API authentication ($5/mo free tier) |
| `BRAVE_API_KEY` | Shared web search module | Brave Search fallback (2000/mo free) |

Both keys are already configured in `.env`. Code integration needed.

---

## Phase 2: Agent Infrastructure

> **Architecture note — "Vibe Prospecting" pattern:** The agent system follows the "vibe prospecting" pattern: describe intent in natural language → AI decomposes into search queries → web scrapers + LinkedIn scrapers gather raw data → LLM extracts structured contacts → dedup + enrichment → human review. Apify (LinkedIn data) + Tavily/Brave (web data) + Gemini (extraction/ranking) form the three pillars of this pipeline.

### 2.1 Database: Agent Run Tracking

**Migration: agent_runs + api_quotas + web_search_cache**
```sql
CREATE TABLE agent_runs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_type text NOT NULL,            -- 'discovery', 'verification', 'connection'
  status text NOT NULL DEFAULT 'pending', -- 'pending', 'running', 'completed', 'failed'
  params jsonb,                        -- input parameters for this run
  started_at timestamptz,
  completed_at timestamptz,
  heartbeat_at timestamptz,            -- last heartbeat for zombie detection
  results jsonb,                       -- { profiles_found, suggestions_created, errors, ... }
  error_message text,
  llm_calls_made integer DEFAULT 0,
  llm_model_used text,
  web_searches_made integer DEFAULT 0,
  web_search_provider text,            -- 'tavily', 'brave', 'mixed'
  cost_estimate_usd numeric(10,4) DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE api_quotas (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  provider text NOT NULL,              -- 'tavily' or 'brave'
  month text NOT NULL,                 -- 'YYYY-MM' format
  calls_used integer DEFAULT 0,
  calls_limit integer NOT NULL,        -- 1000 for tavily, 2000 for brave
  created_at timestamptz DEFAULT now(),
  UNIQUE(provider, month)
);

CREATE TABLE web_search_cache (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  query_hash text NOT NULL,            -- SHA-256 of normalized query
  query_text text NOT NULL,
  provider text NOT NULL,              -- 'tavily' or 'brave'
  results jsonb NOT NULL,              -- cached search results
  searched_at timestamptz DEFAULT now(),
  UNIQUE(query_hash, provider)
);

CREATE INDEX idx_agent_runs_status ON agent_runs(status);
CREATE INDEX idx_agent_runs_type ON agent_runs(agent_type);
CREATE INDEX idx_web_search_cache_hash ON web_search_cache(query_hash);
CREATE INDEX idx_web_search_cache_searched ON web_search_cache(searched_at);

-- TTL cleanup: delete cache entries older than 30 days
-- Run periodically from agent-scheduler or manually
-- DELETE FROM web_search_cache WHERE searched_at < now() - interval '30 days';

-- RLS: read for all, write for service_role only
ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_quotas ENABLE ROW LEVEL SECURITY;
ALTER TABLE web_search_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read agent_runs" ON agent_runs FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Public read api_quotas" ON api_quotas FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Public read web_search_cache" ON web_search_cache FOR SELECT TO anon, authenticated USING (true);
```

### 2.2 Shared Web Search Module

**File:** `supabase/functions/_shared/webSearch.ts`

**Logic:**
1. Normalize query (trim, lowercase) → SHA-256 hash
2. Check `web_search_cache` for matching hash where `searched_at > now() - 30 days`
3. If cache hit: return cached results, no API call
4. If cache miss: check `api_quotas` for current month (`to_char(now(), 'YYYY-MM')`)
   - If Tavily `calls_used < calls_limit`: call Tavily, increment counter
   - Else if Brave `calls_used < calls_limit`: call Brave Search, increment counter
   - Else: return empty results with `{ quota_exhausted: true }`
5. Cache results in `web_search_cache`
6. Return normalized format: `Array<{ title: string, content: string, url: string }>`

**Brave Search API call:**
```
GET https://api.search.brave.com/res/v1/web/search?q={query}&count=10
Headers: { "Accept": "application/json", "Accept-Encoding": "gzip", "X-Subscription-Token": BRAVE_API_KEY }
```

**Error handling:**
- API timeout (10s): try fallback provider
- API error: log, try fallback provider
- All providers failed: return empty results

### 2.3 Shared Apify Module

**File:** `supabase/functions/_shared/apifyClient.ts`

**Purpose:** Wrapper for Apify REST API calls. Used by Discovery Agent (LinkedIn search), Verification Agent (LinkedIn profile scrape), and profile enrichment.

**Env var:** `APIFY_TOKEN` (already in `.env`)

**Core function: `runApifyActor(actorId, input, options?)`**
```typescript
interface ApifyOptions {
  sync?: boolean;       // true = wait for results (up to 300s), false = start and return runId
  timeoutSecs?: number; // max wait time for sync mode (default 120)
}

interface ApifyResult<T> {
  items: T[];
  runId: string;
  status: 'SUCCEEDED' | 'FAILED' | 'RUNNING';
}
```

**Sync mode (for fast scrapes, <5 min):**
```
POST https://api.apify.com/v2/acts/{actorId}/run-sync-get-dataset-items?token={APIFY_TOKEN}
Headers: { "Content-Type": "application/json" }
Body: { ...actor input... }
```

**Async mode (for large batches):**
```
POST https://api.apify.com/v2/acts/{actorId}/runs?token={APIFY_TOKEN}
Body: { ...actor input... }
→ Returns { data: { id: runId, defaultDatasetId } }

GET https://api.apify.com/v2/actor-runs/{runId}?token={APIFY_TOKEN}
→ Poll until status === 'SUCCEEDED'

GET https://api.apify.com/v2/datasets/{datasetId}/items?token={APIFY_TOKEN}&format=json
→ Returns result items
```

**Key actors used:**

| Actor ID | Purpose | Cost | Used by |
|---|---|---|---|
| `supreme_coder/linkedin-profile-scraper` | Scrape full LinkedIn profile by URL | ~$3/1k profiles | Verification Agent, profile enrichment |
| `harvestapi/linkedin-profile-search` | Search LinkedIn people by keyword/location/company | ~$0.10/page + $0.004/profile | Discovery Agent |
| `apify/google-search-scraper` | Google SERP results (alternative to Tavily/Brave) | ~$0.005/search | Web search fallback |

**Quota tracking:** Apify uses credit-based billing ($5/mo free). Track spend via Apify API: `GET /v2/users/me/usage` or simply count calls in `api_quotas` table with `provider: 'apify'` and a conservative per-call cost estimate.

**Error handling:**
- Actor not found or insufficient credits: return `{ error: 'apify_quota_exhausted' }`
- Sync timeout (>120s): return partial results if available, or fall back to web search
- Rate limit (429): back off 60s, retry once

### 2.4 Agent Scheduler Edge Function

**File:** `supabase/functions/agent-scheduler/index.ts`

**Endpoint:** `POST /functions/v1/agent-scheduler`

**Input:**
```json
{
  "agent_type": "discovery" | "verification" | "connection",
  "params": { ... }  // agent-specific parameters
}
```

**Logic:**
1. Create `agent_runs` row with `status: 'pending'`
2. Update to `status: 'running'`, set `started_at`
3. Dispatch to appropriate edge function via internal fetch
4. On success: update `status: 'completed'`, set `completed_at`, store `results`
5. On failure: update `status: 'failed'`, store `error_message`
6. Calculate and store `cost_estimate_usd`

**Zombie detection:** Any run with `status: 'running'` and `heartbeat_at < now() - interval '2 minutes'` is considered zombie. The scheduler checks for zombies on every invocation and marks them as `status: 'failed'` with `error_message: 'Zombie: no heartbeat'`.

---

## Phase 3: Autonomous Agents

### 3.1 Discovery Agent

**File:** `supabase/functions/agent-discovery/index.ts`

**Purpose:** Find new Flemish-connected professionals via web search.

**Input:**
```json
{
  "query": "BAEF fellowship alumni in the United States",
  "max_results": 10
}
```

**⚠️ Design constraint:** `profile_suggestions.person_id` is `NOT NULL` with FK to `people(id)`. The Discovery Agent finds NEW people who don't exist in `people` yet. Two options:

**Option A (recommended): Use `discovered_contacts` staging table**
```sql
CREATE TABLE discovered_contacts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  email text,
  linkedin_url text,
  current_position text,
  location_city text,
  location_state text,
  bio text,
  flemish_connection text,
  source text DEFAULT 'discovery_agent',
  source_urls text[],
  status text NOT NULL DEFAULT 'pending',  -- pending, approved (→ creates people row), rejected
  agent_run_id uuid REFERENCES agent_runs(id),
  created_at timestamptz DEFAULT now()
);
ALTER TABLE discovered_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read discovered_contacts" ON discovered_contacts FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Public update discovered_contacts" ON discovered_contacts FOR UPDATE TO anon, authenticated USING (true);
CREATE POLICY "Public delete discovered_contacts" ON discovered_contacts FOR DELETE TO anon, authenticated USING (true);
```
When admin approves: INSERT into `people`, then DELETE from `discovered_contacts`. This keeps `profile_suggestions` clean for updates-to-existing-people only.

**Option B: Make person_id nullable**
`ALTER TABLE profile_suggestions ALTER COLUMN person_id DROP NOT NULL;` — simpler but muddies the table's purpose (updates vs new contacts in same table).

**Pipeline (using Option A) — dual-channel: web search + LinkedIn search:**

**Channel 1: Web search (existing approach)**
1. Call `searchWeb(query)` via shared module
2. Feed results to Gemini Flash (reuse `search-contacts` extraction logic) to extract contacts

**Channel 2: LinkedIn search via Apify (new)**
1. Call `runApifyActor('harvestapi/linkedin-profile-search', { keywords: query, location: 'United States', limit: 20 })` via shared Apify module
2. LinkedIn search returns structured data directly (name, position, company, location, LinkedIn URL, profile photo) — no LLM extraction needed
3. Map LinkedIn fields to `discovered_contacts` schema

**Merge + dedup (both channels):**
3. Dedup against `people` table: email (exact), LinkedIn URL (normalized), name (case-insensitive)
4. Dedup against `discovered_contacts` table (same checks — avoid re-discovering)
5. Cross-dedup between channel 1 and channel 2 results (LinkedIn URL match)
6. For non-duplicates: insert into `discovered_contacts` with `status: 'pending'`
7. Return `{ profiles_found, duplicates_skipped, suggestions_created, sources: { web_search, linkedin } }`

**Channel selection:** If `APIFY_TOKEN` is set and Apify credits available, run both channels. If Apify unavailable, fall back to web search only. LinkedIn channel is preferred for structured data quality (no LLM hallucination risk).

**Predefined queries** (stored as constants, triggered individually or in sequence):
```
"BAEF fellowship alumni currently in the United States"
"KU Leuven alumni working in the United States"
"UGent alumni professionals in the United States"
"VUB alumni in the United States"
"UAntwerp alumni working in the United States"
"Flemish entrepreneurs in US technology sector"
"Belgian researchers at American universities"
"imec alumni working in the United States"
```

**LinkedIn-specific queries** (use Apify LinkedIn search actor with these keywords + location filter "United States"):
```
"KU Leuven" (school filter)
"UGent" OR "Ghent University" (school filter)
"VUB" OR "Vrije Universiteit Brussel" (school filter)
"imec" (company filter)
"Barco" (company filter)
"Umicore" (company filter)
"BAEF fellow" (keyword)
```

**Constraints:**
- Respects web search quota via shared module
- Respects Apify credit budget ($5/mo free tier — ~$0.10/LinkedIn search page)
- If quota exhausted mid-run: stop, return partial results
- Maximum 3 web searches + 2 LinkedIn searches per invocation (to limit cost)

### 3.2 Verification Agent

**File:** `supabase/functions/agent-verify/index.ts`

**Purpose:** Check if existing profiles are still accurate by web searching and comparing.

**Input:**
```json
{
  "batch_size": 10,
  "max_age_months": 6
}
```

**Pipeline (LinkedIn-first, web search fallback):**
1. Query: `SELECT * FROM people WHERE last_verified_at IS NULL OR last_verified_at < now() - interval '{max_age_months} months' ORDER BY last_verified_at ASC NULLS FIRST LIMIT batch_size`
2. For each person:
   **Path A — LinkedIn (preferred, if `linkedin_url` exists and Apify available):**
   a. Call `runApifyActor('supreme_coder/linkedin-profile-scraper', { profileUrls: [person.linkedin_url] })` — sync mode, ~$0.003/profile
   b. Compare scraped fields (current_position, company, location, bio, profile_photo_url) directly against stored `people` data — deterministic diff, no LLM needed
   c. If differences found: insert into `profile_suggestions` with `source: 'linkedin_scrape'`
   d. If profile photo found and `profile_photo_url IS NULL`: add suggestion for photo URL
   e. If no differences: update `last_verified_at = now()`
   **Path B — Web search (fallback, if no LinkedIn URL or Apify unavailable):**
   a. Build query: `"{name} {current_position} {location.city}"` (NO "flemish belgian" — verifying existing info)
   b. Call `searchWeb(query)` — if quota exhausted, stop
   c. If results found: call `ai-agent` with `check_profile` task
   d. If suggestions returned: insert into `profile_suggestions` with `status: 'pending'`
   e. If no suggestions (profile matches): update `last_verified_at = now()`
   f. If no search results: skip (don't mark as verified)
3. Return `{ profiles_checked, suggestions_created, profiles_verified, skipped_no_results, quota_exhausted, by_source: { linkedin, web_search } }`

**Why LinkedIn-first:** LinkedIn profile scraping returns structured fields that map directly to `people` table columns. No LLM extraction needed, no hallucination risk, and the data is more current than general web search results. Cost: ~$3/1000 profiles vs. ~$0 for web search but with LLM extraction costs.

**Edge cases:**
- Person appears to have left US: create suggestion with `field_name: '_status'`, `suggested_value: 'may_have_left_us'`
- Person changed careers significantly: create suggestion with note in `source` field

### 3.3 Connection Discovery Agent

**File:** `supabase/functions/agent-connections/index.ts`

**Purpose:** Find connections between people using deterministic SQL. No LLM, no web search.

**Input:**
```json
{
  "types": ["colleague", "alumni", "local_peer"]
}
```

**Connection types:**
| Type | Logic | Strength |
|---|---|---|
| `colleague` | Same organization in `current_position` (extract text after " at " or " @ ") | 8 |
| `alumni` | Same `flemish_connection` value (case-insensitive) | 6 |
| `local_peer` | Same `location_id` AND at least one shared sector (via `person_sectors`) | 4 |

**Dedup:** Before inserting, check if connection exists (both directions: A→B or B→A).

**Output:** `{ connections_found, new_connections_created, already_existed, by_type: { colleague, alumni, local_peer } }`

---

## Phase 4: Agent Lifecycle & Scheduling

### 4.1 Agent State Machine
```
PENDING → RUNNING → COMPLETED
                  → FAILED
```
- `PENDING`: Created by scheduler or admin trigger
- `RUNNING`: Edge function executing. Heartbeat every 30s via `UPDATE agent_runs SET heartbeat_at = now() WHERE id = $1`
- `COMPLETED`: Results stored, AEML updated
- `FAILED`: Error stored. Zombie detection catches hung runs.

### 4.2 Scheduling
Agents are triggered manually from the admin panel initially. Future: pg_cron or external cron.

**Target schedule (when automated):**
| Agent | Frequency | Time (UTC) | Target |
|---|---|---|---|
| Discovery | Weekly | Sunday 03:00 | One predefined query per run, rotating |
| Verification | Weekly | Sunday 04:00 | Oldest 10 unverified profiles |
| Connection | Weekly | Monday 02:00 | All types |
| Embedding backfill | On-demand | — | Profiles where `embedding IS NULL` or `embedding_dirty_at > embedding_generated_at` |

### 4.3 Cost Estimation

| Resource | Rate | Monthly Estimate |
|---|---|---|
| Gemini Flash | ~$0.10/1M input tokens | ~$1-3 |
| Gemini Pro (suggest-people only) | ~$1.25/1M input tokens | ~$0.50-1 |
| text-embedding-004 | Free tier | $0 |
| Tavily | Free tier (1000/mo) | $0 |
| Brave Search | Free tier (2000/mo) | $0 |
| Apify | Free tier ($5/mo credits) | $0-5 |
| Supabase | Free tier | $0 |
| **Total** | | **$2-10/month** |

**Apify credit breakdown (within $5 free tier):**
| Activity | Volume | Actor | Est. cost |
|---|---|---|---|
| Discovery LinkedIn searches | ~20 searches/mo | `harvestapi/linkedin-profile-search` | ~$2.00 |
| Verification LinkedIn scrapes | ~100 profiles/mo | `supreme_coder/linkedin-profile-scraper` | ~$0.30 |
| Profile photo enrichment | ~50 profiles/mo | (same as verification) | ~$0.15 |
| **Apify subtotal** | | | **~$2.50/mo** |

The $5 free tier comfortably covers this. LinkedIn people search at higher volume would require paid plan ($49/mo).

---

## Phase 5: Admin Dashboard for Agents

### 5.1 Agent Dashboard Component

**File:** `src/components/admin/AgentDashboard.tsx`

**Sections:**
1. **Run History Table:** agent_type, status (color badge), started_at, completed_at, result summary (profiles found / suggestions created), cost estimate
2. **Manual Trigger Buttons:**
   - "Run Discovery" → opens query input modal → calls agent-scheduler
   - "Run Verification" → calls agent-scheduler with default batch_size=10
   - "Run Connection Discovery" → calls agent-scheduler
   - "Backfill Embeddings" → calls generate-embeddings with `{ backfill: true }`
3. **API Quota Bars:** Tavily (calls_used / 1000), Brave (calls_used / 2000), Apify ($spent / $5.00 credits) for current month
4. **Pending Actions Count:** number of `profile_suggestions` with `status = 'pending'`

### 5.2 Integration with Admin.tsx
Add "Agents" tab to existing admin tab bar. Render `AgentDashboard.tsx` when selected.

---

## Success Metrics

| Metric | Target | How to Measure |
|---|---|---|
| Admin approval rate | > 85% of suggestions | `profile_suggestions` approved vs rejected |
| Discovery yield | > 5 new valid contacts per run | `agent_runs.results.suggestions_created` |
| Verification coverage | 100% of profiles checked within 6 months | `people.last_verified_at` distribution |
| Embedding coverage | 100% of profiles have embeddings | `COUNT(*) WHERE embedding IS NOT NULL` |
| Zombie run rate | < 1% | `agent_runs` failed with zombie message |
| Monthly cost | < $20 | Sum of `agent_runs.cost_estimate_usd` |

---

## Failure Mode Recovery

| Failure | Detection | Response |
|---|---|---|
| Gemini API timeout | HTTP timeout after 30s | Retry up to 2 times with exponential backoff. On final failure, mark run as failed. |
| Gemini rate limit (429) | HTTP 429 response | Backoff 60s, retry once. If still 429, mark run as failed. |
| Tavily quota exhausted | `api_quotas.calls_used >= calls_limit` | Auto-switch to Brave. If Brave also exhausted, skip web search, return partial results. |
| Brave API error | Non-200 response | Fall back to Tavily if available. Otherwise skip. |
| Apify credits exhausted | API returns 402 or usage check shows $0 remaining | Skip LinkedIn channel, fall back to web search only. Discovery/verification agents degrade gracefully. |
| Apify actor timeout | Sync call exceeds 120s | Return partial results if available. For large batches, switch to async mode (start run, poll for completion). |
| LinkedIn profile not found | Apify actor returns empty for a URL | Skip person, fall back to web search for that individual. Don't mark as verified. |
| Embedding dimension mismatch | `embedding.values.length !== 768` | Log error, skip person, continue batch. |
| Agent run zombie | `heartbeat_at` older than 2 minutes | Scheduler marks as failed on next invocation. |
| Supabase edge function cold start | First invocation slow | No action needed — subsequent calls are fast. |
| Supabase edge function timeout | Free tier: 60s hard limit | Batch operations (embedding backfill, discovery agent) must stay under 60s per invocation. For large batches, process in chunks and use multiple invocations. |
| Concurrent agent runs | Multiple agents accessing same web search quota | Use Supabase row-level locks on `api_quotas` during increment (`SELECT ... FOR UPDATE`) to prevent double-counting. |
| Duplicate suggestion | Same person_id + field_name + suggested_value already pending | Skip insert (check before inserting). |

---

## Implementation Order

This is the exact sequence. Each phase depends on the previous.

1. **Phase 1A:** Model env var refactor (update ai-agent, search-contacts)
2. **Phase 1B:** Embedding migration + generate-embeddings edge function + admin backfill button
3. **Phase 1C:** suggest-people edge function + collection "Find similar" UI
4. **Phase 2A:** Agent infra migration (agent_runs, api_quotas, web_search_cache) + shared webSearch module + agent-scheduler
5. **Phase 2B:** Shared Apify module (`_shared/apifyClient.ts`) — can be built alongside or after 2A
6. **Phase 3A:** Discovery agent (dual-channel: web search + LinkedIn via Apify)
7. **Phase 3B:** Verification agent (LinkedIn-first via Apify, web search fallback)
8. **Phase 3C:** Connection discovery agent
9. **Phase 5:** Agent dashboard in admin panel (include Apify credit tracking)

Phases 1A, 1B can run in parallel. Phase 2B (Apify module) can be built alongside Phase 2A. Everything else is sequential.
