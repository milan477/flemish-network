# Flemish Network Platform — TODO

Tasks are scoped for parallel development on feature branches. Each section is one branch.
Dependencies between branches are noted where they exist.

---

## P0 — Core UX & Must-Haves

### 1. Unified Search Bar — `feature/unified-search`
**Files touched:** `Navigation.tsx`, `Dashboard.tsx`, `FilterPanel.tsx`, `App.tsx`, `aiService.ts`, `supabase.ts`
**Does NOT touch:** Map, Admin, Planner, profiles, edge functions, database
**AI model used:** Gemini Flash (via existing `smart_search` task in `ai-agent` edge function)

Consolidate three search experiences (nav search bar, Smart Search chat, filter panel search) into one.

- [x] Remove the large search bar from `Navigation.tsx` top ribbon
- [x] Remove the "Smart Search" chat section from `FilterPanel.tsx`
- [x] Add a new search bar to the right of Map/List toggle buttons in `Dashboard.tsx`
- [x] **Name/org search mode:** Autocomplete dropdown (1+ characters)
- [x] **Natural language search mode:** AI-Enhanced keyword extraction and scoring
- [x] Show active search context as removable chips/tags
- [x] Keep search bar accessible via Navigation search icon (with auto-focus)
- [x] **Profile Data Decomposition (Refactor):** 
  - Ensure all records correctly split `name` into `title`, `first_name`, and `last_name` columns (fix existing "Dr." prefixes in names)
  - Update UI to display titles/names consistently
  - (Linked to migration `20260214030710_add_title_first_name_last_name.sql`)

### 2. Auto-Apply Filters & Deterministic Filter Parser — `feature/filter-simplify`
**Files touched:** `FilterPanel.tsx`, `Dashboard.tsx`, `supabase.ts` (types), new `src/lib/filterParser.ts`, `aiService.ts` (remove `interpretFilters`), `supabase/functions/ai-agent/index.ts` (remove `interpret_filters` task)
**Does NOT touch:** Navigation, Map, Admin, profiles

- [x] Remove the "Apply Filters" button from `FilterPanel.tsx`
- [x] Make all filters auto-apply: on any change (toggle, select, deselect), immediately re-filter and update map/list
- [x] Show a brief loading spinner during re-filter if needed
- [x] Simplify Occupation dropdown to four career-stage categories only:
  - Student, Academic/Researcher, Professional, Executive/Leadership
- [x] Change Flemish Connection from single text input to multi-select dropdown/tag input
  - List all available Flemish connections from the database as options
  - Allow selecting MULTIPLE connections (OR logic — show people matching ANY selected)
- [x] Keep "Available for lectures" checkbox, also auto-applying
- [ ] Update live stats at bottom of filter sidebar (People, Organizations, Cities count) on every filter change
- [x] **Replace `interpret_filters` LLM task with deterministic filter parser:**
  - Create `src/lib/filterParser.ts` exporting `parseFiltersFromQuery(query: string, currentFilters: object): FilterResult`
  - Return type is identical to the current `FilterResult` in `aiService.ts` (has `message` string and `filters` object)
  - Keyword matching logic — scan the query string (case-insensitive) for:
    - **Sector aliases:** "AI", "artificial intelligence", "machine learning" → `sector: "Artificial Intelligence"`; "biotech", "biotechnology", "life sciences" → `"Biotechnology"`; "finance", "fintech", "banking" → `"Finance"`; "arts", "culture", "creative" → `"Culture & Arts"`; "education", "teaching" → `"Education"`; "research" → `"Research"`
    - **US states:** map both full names ("Massachusetts") and 2-letter codes ("MA") to the abbreviation. Include all 50 states + DC
    - **Major US cities:** hardcoded list of ~50 major cities (New York, Los Angeles, Chicago, Boston, San Francisco, Houston, etc.) plus abbreviations ("NYC" → "New York", "SF" → "San Francisco", "LA" → "Los Angeles", "DC" → "Washington")
    - **Occupation:** "student" → `"Student"`; "researcher", "academic", "professor", "scientist" → `"Academic/Researcher"`; "professional", "engineer", "developer" → `"Professional"`; "executive", "CEO", "CTO", "director", "leadership", "VP" → `"Executive/Leadership"`
    - **Flemish connections:** exact substring match for: "KU Leuven", "UGent", "VUB", "UAntwerp", "BAEF", "imec", "Fayat"
    - **Lectures:** "speaker", "speakers", "lecturer", "lecturers", "available for lectures", "talks" → `availableForLectures: true`
    - **Reset:** "reset", "clear", "show all" → return all defaults (empty strings, both types shown, lectures false)
  - Generate a `message` string summarizing applied filters (e.g., "Filtering by Biotechnology sector in Boston, MA")
  - If no keywords match, return `currentFilters` unchanged with message "No specific filters detected"
  - Remove `interpretFilters()` function and `FilterResult` type from `aiService.ts` (move `FilterResult` type to `filterParser.ts`)
  - Remove `interpret_filters` entry from `supabase/functions/ai-agent/index.ts`: delete from `SYSTEM_PROMPTS`, `SCHEMAS`, the `case "interpret_filters"` in `buildUserPrompt()`, and the `case "interpret_filters"` in `validateResponse()`
  - Update all callers of `interpretFilters()` to import and use `parseFiltersFromQuery()` from `filterParser.ts`

### 23. Profile Form UX Enhancements — `feature/form-ux`
**Files touched:** `PersonProfile.tsx`, `AddContactPanel.tsx`, `supabase.ts`
**Does NOT touch:** Map, Search, Admin (except `AddContactPanel`), edge functions

Improve the manual data entry and edit experience for people profiles.

- [x] **Occupation Dropdown:**
  - Replace `input` + `datalist` with a proper `select` (dropdown) in `PersonProfile.tsx` and `AddContactPanel.tsx`
  - Use `OCCUPATION_OPTIONS` from `supabase.ts` as the only allowed values
- [x] **Location Enhancements:**
  - Increase city text box size in `PersonProfile.tsx` and `AddContactPanel.tsx`
  - Replace state text input with a `select` dropdown containing all 50 US states (full names)
  - Integrate a city selector/autocomplete (e.g., using `MAJOR_CITIES` from `filterParser.ts` or a new library)
- [x] **Flemish Connection Selector:**
  - Change "Flemish Connection" from a text input to a tag-based selector (multi-select similar to Sectors)
  - Use `FLEMISH_OPTIONS` from `supabase.ts`
  - **Auto-inference:** When "About" (bio) text changes, automatically scan for Flemish Connection keywords and pre-select matching tags
- [x] **Data Model Alignment:**
  - Update `people` table or `supabase.ts` types if Flemish Connection needs to be a multi-select field (array of strings) instead of a single string

### 3. Collections (Replace Missions/Planner) — `feature/collections`
**Files touched:** New `pages/Collections.tsx`, new `components/CollectionDetail.tsx`, new `components/CollectionModal.tsx`, `App.tsx`, `Navigation.tsx`, `DirectoryGrid.tsx`, `PersonProfile.tsx`, `supabase.ts` (types)
**Database:** New migration for `collections` and `collection_members` tables
**Removes:** `pages/Planner.tsx`, `components/PlanForm.tsx`, `components/PlanDetail.tsx`, `components/PlannerChatbot.tsx`, `lib/plannerUtils.ts`
**Does NOT touch:** Map, Admin, FilterPanel, edge functions
**Note:** AI-powered features (suggest people, search similar) are built in `feature/embeddings` (task 6). This task builds the CRUD, manual add/remove, and UI only.

- [x] Create new migration:
  ```sql
  collections (id uuid PK, name TEXT NOT NULL, description TEXT, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now())
  collection_members (id uuid PK, collection_id uuid FK REFERENCES collections(id) ON DELETE CASCADE, person_id uuid FK REFERENCES people(id) ON DELETE CASCADE, notes TEXT, added_at TIMESTAMPTZ DEFAULT now())
  ```
  With RLS policies for public read/write (same pattern as existing tables).
- [x] Remove "Missions" tab from `Navigation.tsx`, replace with "Collections"
- [x] Remove all Planner-related components and `plannerUtils.ts`:
  - Delete `pages/Planner.tsx`, `components/PlanForm.tsx`, `components/PlanDetail.tsx`, `components/PlannerChatbot.tsx`, `lib/plannerUtils.ts`
  - Remove their imports and route handling from `App.tsx`
- [x] Build `Collections.tsx` page:
  - Header: "Collections" with subtitle "Save and organize groups of contacts"
  - "+ New Collection" button (opens `CollectionModal.tsx`: name input + optional description textarea + Save/Cancel)
  - Grid of collection cards showing: name, description (truncated), member count, created date, up to 3 member avatar circles
  - Click card → navigates to collection detail view (either inline or via page state)
- [x] Build `CollectionDetail.tsx`:
  - Collection name (editable inline) and description
  - Member list: each row shows person name, position, location, and a remove button (X icon)
  - Per-member notes field (editable text, saved to `collection_members.notes`)
  - "Back to Collections" link
  - Placeholder area for future "Find similar people" button (added in task 6)
- [x] Add bookmark/folder icon on person cards in `DirectoryGrid.tsx` and `PersonProfile.tsx`
  - Click opens dropdown: list of all collections with checkboxes to add/remove this person
  - "Create new collection" option at bottom of dropdown
- [x] Update `App.tsx` routing: add `'collections'` and `'collection-detail'` to `Page` union, render appropriate component
- [x] Clean up: remove `plan_suggested_people`, `plan_actions`, `plans` references from any remaining frontend code (but do NOT drop DB tables in migration — just stop using them)

### 4. Export & Briefing Documents — `feature/export`
**Files touched:** New `lib/exportService.ts`, `DirectoryGrid.tsx`, `CollectionDetail.tsx` (if collections branch merged), `PersonProfile.tsx`
**Does NOT touch:** Map, Admin, Navigation, filters, edge functions, database

- [ ] Create `lib/exportService.ts` with export utilities
- [ ] **Export filtered results as CSV/Excel:**
  - Add "Export" button to `DirectoryGrid.tsx` header
  - Export all currently visible/filtered people with columns: Name, Position, Organization, Location, Sector(s), Flemish Connection, Email, Phone, LinkedIn
- [ ] **Export collection as PDF briefing document:**
  - Add "Export Briefing" button to collection detail view
  - Generate a formatted document with:
    - Collection name and description as header
    - For each person: photo placeholder, name, title, position, location, bio summary, contact info, Flemish connection
  - Use browser print/PDF (`window.print()` with print-specific CSS) or a client-side PDF library (jsPDF)
- [ ] **Print-friendly profile pages:**
  - Add print stylesheet to `PersonProfile.tsx` (hide nav, sidebar, action buttons)
  - Add "Print" button to profile page

### 5. Data Quality & Privacy Fields — `feature/data-quality`
**Files touched:** New migration, `PersonProfile.tsx`, `Admin.tsx`, `supabase.ts` (types), `DirectoryGrid.tsx`
**Does NOT touch:** Map, Navigation, filters, edge functions, search

- [ ] Create migration adding fields to `people`:
  ```sql
  data_source TEXT DEFAULT 'manual'        -- 'manual', 'csv_import', 'ai_agent', 'self_reported'
  last_verified_at TIMESTAMPTZ
  ```
- [ ] Add `data_source` and `last_verified_at` tracking:
  - Set `data_source` on creation (manual form → 'manual', CSV import → 'csv_import', AI agent → 'ai_agent')
  - Set `last_verified_at` when a human reviews/edits a profile or approves a suggestion. Clearly document how this works in code comments because this is going to be used later on when making the agents that search for people online.
- [ ] Show verification badge on profiles: "Verified [date]" or "Unverified" based on `last_verified_at`
- [ ] Show data source on profile pages (small logo: "Added via CSV import", "AI-discovered", "Manual")

---

## P0 — AI Infrastructure

### 6. Embeddings & Vector Search — `feature/embeddings`
**Depends on:** `feature/collections` (task 3) should be merged first so the "search similar" UI can be added to `CollectionDetail.tsx`. The core embedding infrastructure (migration, edge functions) has no dependencies and can be built in parallel.
**Files touched:** New migration, new `supabase/functions/generate-embeddings/index.ts`, new `supabase/functions/suggest-people/index.ts`, `components/CollectionDetail.tsx`, `aiService.ts`, `supabase.ts` (types), `supabase/functions/ai-agent/index.ts` (remove `suggest_people` task), `Admin.tsx`
**Database:** pgvector extension, new `embedding` column on `people`, new `match_people` SQL function
**AI models used:** text-embedding-004 (embeddings), Gemini Pro (suggest-people ranking)

This task sets up embedding infrastructure and replaces the old `suggest_people` flow (which sent ALL contacts to the LLM) with embedding pre-filtering + Gemini Pro.

- [ ] **Database migration:**
  ```sql
  -- Enable pgvector extension
  CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

  -- Add embedding column
  ALTER TABLE people ADD COLUMN embedding vector(768);

  -- Index for fast similarity search (use ivfflat; for <1000 rows, lists=50 is fine)
  CREATE INDEX people_embedding_idx ON people USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50);

  -- Similarity search function
  CREATE OR REPLACE FUNCTION match_people(
    query_embedding vector(768),
    match_count int DEFAULT 50,
    similarity_threshold float DEFAULT 0.3
  )
  RETURNS TABLE (
    id uuid,
    name text,
    current_position text,
    location_city text,
    location_state text,
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
      p.id, p.name, p.current_position, p.location_city, p.location_state,
      p.flemish_connection, p.bio, p.occupation, p.available_for_lectures,
      1 - (p.embedding <=> query_embedding) AS similarity
    FROM people p
    WHERE p.embedding IS NOT NULL
      AND 1 - (p.embedding <=> query_embedding) > similarity_threshold
    ORDER BY p.embedding <=> query_embedding
    LIMIT match_count;
  END;
  $$;
  ```
  Add RLS policy allowing the function to be called by anon/authenticated (same as `people` read policy).

- [ ] **Create `supabase/functions/generate-embeddings/index.ts`:**
  - Accepts JSON body: `{ personId?: string, personIds?: string[], backfill?: boolean }`
  - Requires env vars: `GEMINI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
  - For each person ID: fetch profile from `people` table, build embedding input text:
    ```
    "{name} | {current_position} | {bio} | {sectors comma-joined} | {flemish_connection} | {location_city}, {location_state}"
    ```
    (Fetch sectors by joining `person_sectors` → `sectors` table, or from the person's sectors field if denormalized)
  - Call Google embedding API:
    ```
    POST https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key={GEMINI_API_KEY}
    Body: { "content": { "parts": [{ "text": embeddingInput }] } }
    ```
  - Extract `embedding.values` (array of 768 floats) from the response
  - Update `people` row: `UPDATE people SET embedding = $1 WHERE id = $2`
  - For `backfill: true`: query `SELECT id FROM people WHERE embedding IS NULL`, process in batches of 20 with 500ms delay between batches
  - Return `{ processed: number, failed: number, errors: string[] }`
  - CORS headers same pattern as other edge functions

- [ ] **Create `supabase/functions/suggest-people/index.ts`:**
  - Accepts JSON body: `{ query: string, collection_id?: string, exclude_ids?: string[], max_results?: number }`
  - Requires env vars: `GEMINI_API_KEY`, `GEMINI_PRO_MODEL` (default `gemini-2.5-pro-preview-05-06`), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
  - Step 1: Embed the `query` using text-embedding-004 (same API call as generate-embeddings)
  - Step 2: Call `match_people(query_embedding, 50)` via Supabase client `.rpc('match_people', { query_embedding, match_count: 50 })`
  - Step 3: Remove any IDs in `exclude_ids` from results (e.g., people already in a collection)
  - Step 4: Build a prompt for Gemini Pro listing the remaining candidates (ID, name, position, location, flemish_connection, bio truncated to 200 chars, similarity score) and the user's query. Ask the model to rank by relevance and provide a 1-sentence reason for each suggestion. System prompt should instruct: only return IDs from the provided list, max 15 results, order by relevance.
  - Step 5: Call Gemini Pro (`GEMINI_PRO_MODEL` env var) with structured output schema:
    ```json
    { "message": "string", "suggestions": [{ "id": "string", "reason": "string" }] }
    ```
  - Step 6: Merge similarity scores from step 2 into the response
  - Return: `{ message: string, suggestions: Array<{ id: string, name: string, reason: string, similarity: number }> }`
  - CORS headers same pattern as other edge functions

- [ ] **Remove `suggest_people` task from `ai-agent` edge function:**
  - In `supabase/functions/ai-agent/index.ts`: delete `suggest_people` from `SYSTEM_PROMPTS`, `SCHEMAS`, the `case "suggest_people"` in `buildUserPrompt()`, and `case "suggest_people"` in `validateResponse()`
  - In `src/lib/aiService.ts`: delete the `suggestPeople()` function, `SuggestPeopleResult` interface, and `SuggestedPersonEntry` interface

- [ ] **Add new `suggestPeople()` in `aiService.ts`:**
  - New function that calls the `suggest-people` edge function:
    ```typescript
    export async function suggestPeople(
      query: string,
      options?: { collectionId?: string; excludeIds?: string[]; maxResults?: number }
    ): Promise<SuggestPeopleResult> {
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/suggest-people`;
      // POST with Authorization header (anon key), return parsed response
    }
    ```
  - New `SuggestPeopleResult` interface matching the edge function response

- [ ] **Add "Find similar people" to `CollectionDetail.tsx`:**
  - Button labeled "Find similar people" in the collection header area
  - On click: build a query from the collection description (if present) or concatenate top 3 member positions/bios
  - Call `suggestPeople(query, { collectionId, excludeIds: currentMemberIds })`
  - Show results in a slide-out panel or modal: each result shows name, position, reason, similarity percentage, and an "Add to collection" button
  - Adding a person dismisses them from the suggestion list and adds them to the collection

- [ ] **Trigger embedding generation on profile create/update:**
  - In the frontend code that saves a person to the `people` table (in `PersonProfile.tsx` and `AddContact.tsx`), after the Supabase insert/update succeeds, fire a background call to `generate-embeddings` with that person's ID
  - Use `fetch(...).catch(() => {})` — fire-and-forget, don't block the UI or show errors if it fails

- [ ] **Admin: backfill button:**
  - In `Admin.tsx`, add a "Generate Embeddings" button (only show if there are people without embeddings)
  - On click: call `generate-embeddings` with `{ backfill: true }`, show a toast/spinner while running
  - Show count of people with/without embeddings

- [ ] **Update `ai-agent/index.ts` to use model env vars:**
  - Change `const GEMINI_MODEL = "gemini-2.0-flash"` to `const GEMINI_MODEL = Deno.env.get("GEMINI_FLASH_MODEL") || "gemini-2.0-flash"`
  - This makes the model configurable without code changes

---

## P1 — Agent System & Enrichment

### 7. Agent Orchestration Infrastructure — `feature/agent-infra`
**Files touched:** New `supabase/functions/agent-scheduler/`, new migration for `agent_runs` and `api_quotas` tables, `Admin.tsx`, new `components/admin/AgentDashboard.tsx`
**Does NOT touch:** Frontend search, filters, map, profiles, collections
**Depends on:** No code dependencies, but should be built after P0 tasks are stable

- [ ] Create migration with two tables:
  ```sql
  -- Agent run log
  CREATE TABLE agent_runs (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    agent_type TEXT NOT NULL,           -- 'discovery', 'verification', 'connection'
    status TEXT NOT NULL DEFAULT 'running', -- 'running', 'completed', 'failed'
    started_at TIMESTAMPTZ DEFAULT now(),
    completed_at TIMESTAMPTZ,
    results JSONB,                      -- { profiles_found: 3, suggestions_created: 5, errors: [] }
    error_message TEXT,
    llm_calls_made INTEGER DEFAULT 0,
    llm_model_used TEXT,                -- 'gemini-2.0-flash' or pro model ID
    web_searches_made INTEGER DEFAULT 0,
    web_search_provider TEXT,           -- 'tavily', 'brave', or 'mixed'
    cost_estimate_usd NUMERIC(10,4) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now()
  );

  -- Web search API quota tracking
  CREATE TABLE api_quotas (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    provider TEXT NOT NULL,             -- 'tavily' or 'brave'
    month TEXT NOT NULL,                -- '2026-03' format (YYYY-MM)
    calls_used INTEGER DEFAULT 0,
    calls_limit INTEGER NOT NULL,       -- 1000 for tavily, 2000 for brave
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(provider, month)
  );

  -- Seed initial quota rows for current month
  INSERT INTO api_quotas (provider, month, calls_limit) VALUES
    ('tavily', to_char(now(), 'YYYY-MM'), 1000),
    ('brave', to_char(now(), 'YYYY-MM'), 2000);
  ```
  With RLS: read for anon/authenticated, write for service_role only.

- [ ] **Create shared web search utility** (as a module used by agent edge functions):
  - Create `supabase/functions/_shared/webSearch.ts` (Supabase supports shared modules with `_` prefix):
    - `async function searchWeb(query: string, supabase: SupabaseClient): Promise<SearchResult[]>`
    - Checks `api_quotas` for current month (`to_char(now(), 'YYYY-MM')`)
    - If Tavily `calls_used < calls_limit`: use Tavily, increment counter
    - Else if Brave `calls_used < calls_limit`: use Brave Search API (`GET https://api.search.brave.com/res/v1/web/search?q={query}` with `X-Subscription-Token: {BRAVE_API_KEY}` header), increment counter
    - Else: return empty results with a warning
    - Normalize response to common format: `{ title: string, content: string, url: string }[]`
    - Cache results: before searching, check if the same query was searched in the last 30 days (add a `web_search_cache` table with `query_hash TEXT, results JSONB, searched_at TIMESTAMPTZ`)

- [ ] **Create `supabase/functions/agent-scheduler/index.ts`:**
  - Accepts: `{ agent_type: string, params?: object }`
  - Creates an `agent_runs` row with `status: 'running'`
  - Dispatches to the appropriate agent edge function via internal fetch (`${SUPABASE_URL}/functions/v1/agent-{type}`)
  - On completion: updates `agent_runs` with results, status, timestamps, and cost estimate
  - On failure: updates `agent_runs` with error_message and `status: 'failed'`
  - Can be called manually (POST) or via Supabase pg_cron

- [ ] **Cost estimation helper** in `_shared/costEstimate.ts`:
  - `estimateCost(llmCalls: number, model: string, avgInputTokens: number, avgOutputTokens: number, webSearches: number): number`
  - Flash: $0.10/1M input, $0.40/1M output
  - Pro: $1.25/1M input, $5.00/1M output
  - Web searches: $0 (free tier, but tracked for quota)

- [ ] **Build `AgentDashboard.tsx` admin component:**
  - Table of recent agent runs: type, status (color-coded), started/completed times, result summary, cost estimate
  - "Run Now" buttons for each agent type (discovery, verification, connection)
  - Discovery button opens a small form for search query input
  - **API quota section:** two progress bars showing Tavily and Brave usage for current month (calls_used / calls_limit)
  - Monthly cost summary: total estimated cost from `agent_runs` this month
  - Pending actions count: number of `profile_suggestions` with `status = 'pending'`

- [ ] Add "Agents" tab to `Admin.tsx` that renders `AgentDashboard.tsx`

### 8. Discovery Agent — `feature/agent-discovery`
**Depends on:** `feature/agent-infra` (task 7) for `agent_runs` table, `api_quotas` table, and shared web search utility
**Files touched:** New `supabase/functions/agent-discovery/index.ts`
**Does NOT touch:** Frontend (results appear as `profile_suggestions` for admin review)
**AI model:** Gemini Flash (extraction from search results)
**Web search:** Uses shared web search utility (Tavily/Brave with quota tracking)

- [ ] Create `supabase/functions/agent-discovery/index.ts`:
  - Accepts: `{ query: string, max_results?: number }` (default max_results: 10)
  - Example queries: "Flemish researchers at Stanford", "BAEF alumni in New York", "Belgian biotech executives in Boston"
  - Step 1: Call shared `searchWeb()` with the query + " flemish belgian professional" appended
  - Step 2: Call Gemini Flash (via `ai-agent` edge function, task `parse_contacts` or the existing `search-contacts` extraction logic) to extract structured person data from search results
  - Step 3: Dedup check against `people` table — match by: email (exact), LinkedIn URL (normalized), name (case-insensitive exact match against `people.name`)
  - Step 4: For non-duplicate contacts, insert into `profile_suggestions` table with `status: 'pending'` and `source: 'discovery_agent'`
  - Step 5: Return `{ profiles_found: number, duplicates_skipped: number, suggestions_created: number }`
  - Log run to `agent_runs` via the scheduler (or self-log if called directly)
- [ ] Predefined discovery searches (stored as constants in the function, callable individually):
  - "BAEF fellowship alumni currently in the United States"
  - "KU Leuven alumni working in the United States"
  - "UGent alumni professionals in the United States"
  - "VUB alumni in the United States"
  - "UAntwerp alumni working in the United States"
  - "Flemish entrepreneurs in US technology sector"
  - "Belgian researchers at American universities"
- [ ] Respect web search quota: if `searchWeb()` returns empty due to quota exhaustion, log a warning and stop

### 9. Verification Agent — `feature/agent-verification`
**Depends on:** `feature/agent-infra` (task 7), `feature/data-quality` (task 5) for `last_verified_at` column
**Files touched:** New `supabase/functions/agent-verify/index.ts`
**Does NOT touch:** Frontend (results appear as `profile_suggestions` for admin review)
**AI model:** Gemini Flash (via `ai-agent` task `check_profile`)
**Web search:** Uses shared web search utility (Tavily/Brave with quota tracking)

- [ ] Create `supabase/functions/agent-verify/index.ts`:
  - Accepts: `{ batch_size?: number, max_age_months?: number }` (defaults: batch_size=10, max_age_months=6)
  - Step 1: Query `people` where `last_verified_at IS NULL OR last_verified_at < now() - interval '{max_age_months} months'`, ordered by `profile_completeness DESC NULLS LAST` (verify most complete profiles first — they're most valuable to keep current), limit to `batch_size`
  - Step 2: For each person:
    - Build search query: `"{name} {current_position} {location_city}"` — do NOT append "flemish belgian" (we're verifying existing info, not discovering new connections)
    - Call shared `searchWeb()` — if quota exhausted, stop processing and return partial results
    - If web search returns results: call `ai-agent` edge function with task `check_profile`, passing person data and search results
    - If `check_profile` returns suggestions: insert into `profile_suggestions` with `status: 'pending'`
    - If `check_profile` returns empty suggestions (profile matches web data): update `last_verified_at = now()` on the person
    - If web search returns no results: skip this person (don't mark as verified since we couldn't confirm)
  - Step 3: Return `{ profiles_checked: number, suggestions_created: number, profiles_verified: number, skipped_no_results: number, quota_exhausted: boolean }`
  - Log run to `agent_runs`
- [ ] Handle edge cases:
  - If person appears to have moved (location changed significantly) or changed careers: create suggestion but flag with a note in the suggestion
  - If person appears to have left the US: create a special suggestion with `field_name: '_status'` and `suggested_value: 'may_have_left_us'` for manual review

### 10. Connection Discovery Agent — `feature/agent-connections`
**Depends on:** `feature/agent-infra` (task 7)
**Files touched:** New `supabase/functions/agent-connections/index.ts`, `connections` table (existing)
**Does NOT touch:** Frontend (connections surfaced later in network visualization, task 19)
**AI model:** None for deterministic connections. Optional Gemini Flash for "associated" type (future).
**Web search:** None needed.

Most connection types are discovered via deterministic SQL queries — no LLM or web search needed.

- [ ] Create `supabase/functions/agent-connections/index.ts`:
  - Accepts: `{ types?: string[] }` (defaults to all types: `['colleague', 'alumni', 'local_peer']`)
  - **Type "colleague"** (deterministic SQL):
    - Find pairs of people whose `current_position` contains the same organization name
    - Implementation: extract the organization part from `current_position` (text after " at " or " @ "), group people by organization, create connections between all pairs in the same org
    - `strength = 8`
  - **Type "alumni"** (deterministic SQL):
    - Find pairs of people with the same `flemish_connection` value (case-insensitive)
    - Group by flemish_connection, create connections between all pairs in each group
    - `strength = 6`
  - **Type "local_peer"** (deterministic SQL):
    - Find pairs of people in the same `location_city` AND sharing at least one sector (join via `person_sectors`)
    - `strength = 4`
  - For each connection: check if it already exists in `connections` table (by both person IDs, regardless of order) before inserting
  - Insert new connections with appropriate `connection_type` and `strength`
  - Return `{ connections_found: number, new_connections_created: number, already_existed: number, by_type: { colleague: number, alumni: number, local_peer: number } }`
  - Log run to `agent_runs`
- [ ] **Future (not in this task):** "associated" connection type that uses Gemini Flash to analyze pairs of bios. This is expensive (O(n²) comparisons) and should only be done for a targeted subset. Defer until network graph visualization (task 19) is built and there's a clear need.

---

## P1 — User Experience Improvements

### 11. Interactive Stats Dashboard — `feature/interactive-stats`
**Files touched:** `Admin.tsx`, `components/admin/StatsOverview.tsx` (or equivalent admin components)
**Does NOT touch:** Navigation, Map, profiles, filters, edge functions, database

- [ ] Make every data bar/label/count in the admin stats dashboard clickable
- [ ] Cross-filtering behavior:
  - Click "Finance" in Profiles by Sector → Occupation and Location charts update to show only Finance people
  - Click "Boston, MA" in Top Locations → Sector and Occupation update for Boston only
  - Click "Researchers" in Occupations → other charts filter accordingly
- [ ] Show active cross-filter as a chip/tag at top of dashboard with X to clear
- [ ] Toggle behavior: clicking an already-active filter deselects it
- [ ] Add hover effects (cursor pointer, subtle highlight) on all clickable data elements
- [ ] Optional: "View in Network" link on each filter that navigates to Dashboard with filter pre-applied

### 12. Profile Page Clickable Tags — `feature/profile-clickable-tags`
**Files touched:** `PersonProfile.tsx`, `OrganizationProfile.tsx`
**Does NOT touch:** Dashboard, Map, Admin, filters, edge functions, database

- [ ] Make sector/expertise tags clickable → navigate to Dashboard with sector filter pre-applied
- [ ] Make Flemish Connection entries clickable → navigate to Dashboard with that connection selected
- [ ] Make location clickable → navigate to Dashboard with map centered on that city
- [ ] Style with subtle underline or hover effect, keep current tag/badge visual style
- [ ] Use existing `onNavigate` with `FilterPreset` to pass pre-set filters

### 13. Search Result Relevance Snippets — `feature/search-snippets`
**Files touched:** `DirectoryGrid.tsx`, `aiService.ts`, `supabase.ts` (types)
**Does NOT touch:** Map, Admin, Navigation, profiles, edge functions, database

- [ ] After natural language search, show a snippet below each person card explaining WHY they matched
  - 1 sentence max, extracted/summarized from their bio that's most relevant to query
  - Example: Query "AI safety researcher" → Snippet "Works on machine learning and AI at Lawrence Berkeley National Laboratory"
- [ ] If match was filter-only (no bio match): show matching filter values instead (e.g., "Matched: Sector = AI, Location = Boston")
- [ ] Style: smaller font, gray color, italic — informative but not distracting
- [ ] Only show snippets for NL search results, not for name searches or filter-only browsing

### 14. Map Improvements — `feature/map-clustering`
**Files touched:** `MapVisualization.tsx`, `ClusterPopover.tsx`
**Does NOT touch:** Dashboard logic, filters, Admin, profiles, edge functions, database
**Consider:** Switching from custom SVG map to Leaflet or Mapbox for proper clustering

- [ ] Zoom-based cluster behavior:
  - Zoom in → clusters break apart into smaller clusters or individual markers
  - Zoom out → nearby markers merge back into clusters with counts
- [ ] Cluster circles scale proportionally (cluster of 10 larger than cluster of 2)
- [ ] Click cluster → zoom into that area to see sub-clusters/individual markers
- [ ] Click individual marker → popup with person's name, occupation, organization, link to profile
- [ ] Evaluate using Leaflet + Leaflet.markercluster or Mapbox GL JS for this (built-in clustering) vs extending the custom SVG implementation

---

## P1 — Operational Readiness

### 15. Interaction Tracking / Notes — `feature/interaction-log`
**Files touched:** New migration, `PersonProfile.tsx`, new `components/InteractionLog.tsx`, `supabase.ts` (types)
**Does NOT touch:** Map, Admin, Navigation, filters, edge functions

- [ ] Create migration:
  ```sql
  CREATE TABLE interactions (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    person_id uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    interaction_type TEXT NOT NULL,    -- 'email', 'call', 'meeting', 'note', 'event'
    summary TEXT,
    interaction_date DATE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
  );
  ```
  With RLS policies for public read/write.
- [ ] Build `InteractionLog.tsx` component for profile pages:
  - Chronological list of interactions (newest first)
  - "+ Add Note" button with simple form (type dropdown, date picker, summary text area)
  - Show "Last contacted: [date]" at top of profile
- [ ] Show "Last contacted" date in `DirectoryGrid.tsx` person cards (if available)

### 16. Onboarding Documentation — `feature/docs`
**Files touched:** New `docs/` directory
**Does NOT touch:** Any source code

- [ ] `docs/SETUP.md` — How to deploy from scratch:
  - Create Supabase project, run migrations, set env vars
  - Deploy edge functions (`supabase functions deploy`)
  - Set up API keys (Gemini, Tavily, Brave)
  - Docker deployment option (see task 17)
  - Initial data import from Excel/CSV
- [ ] `docs/USER_GUIDE.md` — How to use the platform:
  - Searching and filtering contacts
  - Managing collections
  - Reviewing AI suggestions
  - Exporting data
  - Understanding the admin dashboard
- [ ] `docs/AGENTS.md` — How the AI agent system works:
  - What each agent does and which model tier it uses
  - How to trigger agents manually from the admin panel
  - How to set up scheduled runs (pg_cron or external cron)
  - How to monitor costs and API quota usage
  - How to adjust agent parameters (batch size, max age)
  - Web search quota management (Tavily vs Brave limits)
- [ ] `docs/DATA_IMPORT.md` — How to import existing data:
  - Expected CSV format with column descriptions
  - How to handle duplicates
  - Post-import: run embedding backfill from admin panel
  - How to assign sectors and Flemish connections in bulk

### 17. Docker Deployment — `feature/docker`
**Files touched:** New `Dockerfile`, `docker-compose.yml`, `nginx.conf`, `.env.example`
**Does NOT touch:** Any source code
**Note:** The backend stays on Supabase (hosted). Docker is only for the frontend static site.

- [ ] **Create `Dockerfile`** (multi-stage build):
  ```dockerfile
  # Stage 1: Build the Vite app
  FROM node:20-alpine AS builder
  WORKDIR /app
  COPY package*.json ./
  RUN npm ci
  COPY . .
  # Vite bakes VITE_* env vars at build time
  ARG VITE_SUPABASE_URL
  ARG VITE_SUPABASE_ANON_KEY
  RUN npm run build

  # Stage 2: Serve with nginx
  FROM nginx:alpine
  COPY --from=builder /app/dist /usr/share/nginx/html
  COPY nginx.conf /etc/nginx/conf.d/default.conf
  EXPOSE 80
  CMD ["nginx", "-g", "daemon off;"]
  ```
- [ ] **Create `nginx.conf`:**
  - SPA routing: `try_files $uri $uri/ /index.html` (all unknown routes → index.html)
  - Gzip on for text/html, application/javascript, text/css, application/json
  - Cache `assets/` directory with `Cache-Control: public, max-age=31536000, immutable` (Vite hashes filenames)
  - No cache on `index.html`: `Cache-Control: no-cache, no-store, must-revalidate`
- [ ] **Create `docker-compose.yml`:**
  ```yaml
  version: "3.8"
  services:
    frontend:
      build:
        context: .
        args:
          VITE_SUPABASE_URL: ${VITE_SUPABASE_URL}
          VITE_SUPABASE_ANON_KEY: ${VITE_SUPABASE_ANON_KEY}
      ports:
        - "${PORT:-80}:80"
      restart: unless-stopped
  ```
- [ ] **Create `.env.example`:**
  ```bash
  # === Frontend (required) ===
  # Get these from: Supabase Dashboard → Settings → API
  VITE_SUPABASE_URL=https://your-project-id.supabase.co
  VITE_SUPABASE_ANON_KEY=eyJ...your-anon-key

  # Port to expose the frontend (default: 80)
  PORT=80
  ```
- [ ] **Add `.dockerignore`:**
  ```
  node_modules
  dist
  .git
  .env
  .claude
  ```
- [ ] Document in `docs/SETUP.md` (task 16):
  - Prerequisites: Docker and Docker Compose installed
  - Steps: `cp .env.example .env` → fill in values → `docker compose up -d --build`
  - To update: `git pull && docker compose up -d --build`
  - Alternative without Docker: `npm run build` → copy `dist/` to any static file server (Apache, nginx, Caddy, S3+CloudFront)

### 18. Authentication & Multi-User — `feature/auth`
**Files touched:** New migration, `App.tsx`, `Navigation.tsx`, new `pages/Login.tsx`, `supabase.ts`, all RLS policies
**Impacts:** Every page and component that writes data (broad scope — do last)

- [ ] Enable Supabase Auth (email/password for staff, magic link for professionals)
- [ ] Create `user_profiles` table linking auth users to roles:
  ```sql
  CREATE TABLE user_profiles (
    id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'viewer',  -- 'admin', 'staff', 'viewer', 'network_member'
    display_name TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
  );
  ```
- [ ] Add login/logout to `Navigation.tsx`
- [ ] Update all RLS policies:
  - Read: all authenticated users (or even anon for network members viewing their own profile)
  - Write (profiles, suggestions): staff + admin only
  - Admin operations (approve suggestions, manage agents): admin only
  - Network members: can edit only their own claimed profile
- [ ] Add `created_by` and `updated_by` columns to key tables for audit trail
- [ ] Profile claiming: allow a network member to link their auth account to a `people` record

---

## P2 — Future Enhancements

### 19. Network Analysis & Visualization — `feature/network-graph`
**Depends on:** `feature/agent-connections` (task 10) to have connection data
**Files touched:** New `components/NetworkGraph.tsx`, `PersonProfile.tsx`, `Dashboard.tsx`

- [ ] Build interactive network graph component (D3 force-directed or vis.js)
- [ ] Show on profile pages: person's immediate connections
- [ ] Full network view option on Dashboard (toggle alongside Map/List)
- [ ] Filter graph by sector, location, Flemish connection
- [ ] Identify bridge nodes (people connecting different clusters)
- [ ] Sector overlap analysis: "who bridges AI and Policy?"

### 20. Geographic Coverage Analysis — `feature/coverage-gaps`
**Files touched:** `Admin.tsx`, new `components/admin/CoverageMap.tsx`

- [ ] Heatmap or choropleth of US showing contact density by state/city
- [ ] Highlight coverage gaps: "15 contacts in Boston, 0 in Houston"
- [ ] Suggest discovery agent searches for underrepresented areas
- [ ] Compare sector distribution across regions

### 21. Notification System — `feature/notifications`
**Depends on:** `feature/auth` (task 18), `feature/agent-infra` (task 7)
**Files touched:** New migration, new edge function, `Navigation.tsx`, `Admin.tsx`

- [ ] In-app notification bell in `Navigation.tsx`
- [ ] Notification types:
  - New profile suggestions awaiting review
  - Agent run completed with summary
  - Stale profiles needing attention
  - Collection member profile updates
- [ ] Optional email digest (weekly summary of agent activity + pending actions)

### 22. Multi-Language Support — `feature/i18n`
**Files touched:** All components with user-facing text

- [ ] Extract all UI strings to translation files (Dutch + English)
- [ ] Language toggle in Navigation
- [ ] Consider: is the data itself bilingual? (Probably English-only since it's about the US network)

---

## Task Dependency Graph

```
(no deps)          feature/unified-search          [task 1]
(no deps)          feature/filter-simplify          [task 2]
(no deps)          feature/collections              [task 3]
(no deps)          feature/export                   [task 4]
(no deps)          feature/data-quality             [task 5]
(no deps)          feature/embeddings (core infra)  [task 6]
(no deps)          feature/interactive-stats        [task 11]
(no deps)          feature/profile-clickable-tags   [task 12]
(no deps)          feature/search-snippets          [task 13]
(no deps)          feature/map-clustering           [task 14]
(no deps)          feature/interaction-log          [task 15]
(no deps)          feature/docs                     [task 16]
(no deps)          feature/docker                   [task 17]

feature/collections ──┐
feature/embeddings ───┤ → Collection "find similar" & "suggest people" UI
                      │   (embeddings core infra can be built in parallel with collections,
                      │    but the CollectionDetail.tsx integration requires both)

feature/agent-infra [task 7] ──────────────┐
  ├── feature/agent-discovery    [task 8]  │
  ├── feature/agent-verification [task 9]  │ (also needs feature/data-quality [task 5])
  └── feature/agent-connections  [task 10] │
                                           │
feature/auth [task 18] ────────────────────┘ (do last, touches everything)
  └── feature/notifications [task 21]

feature/agent-connections [task 10]
  └── feature/network-graph [task 19]
```

**Can run in parallel (no dependencies between them):**
- `unified-search` + `filter-simplify` + `collections` + `export` + `data-quality` + `embeddings` (core) + `interactive-stats` + `profile-clickable-tags` + `search-snippets` + `map-clustering` + `interaction-log` + `docs` + `docker`

**Sequential chains:**
- `collections` + `embeddings` → collection AI features (find similar, suggest people)
- `agent-infra` → then in parallel: `agent-discovery`, `agent-verification`, `agent-connections`
- `data-quality` + `agent-infra` → `agent-verification`
- `agent-connections` → `network-graph`
- `auth` → `notifications`
