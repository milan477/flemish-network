# Repository Guidelines

## Project Structure & Module Organization
`src/` contains the Vite React frontend. Keep page-level views in `src/pages/`, shared UI in `src/components/`, and data/helpers in `src/lib/`. Static assets live in `public/` and `src/assets/`. Supabase backend work is split between SQL migrations in `supabase/migrations/` and Edge Functions in `supabase/functions/`. Use `test-csvs/` for CSV import fixtures and `scripts/` for small maintenance utilities.

## Build, Test, and Development Commands
- `npm install`: install dependencies from `package-lock.json`.
- `npm run dev`: start the local Vite dev server.
- `npm run build`: produce the production bundle in `dist/`.
- `npm run preview`: serve the built app locally for a quick smoke test.
- `npm run lint`: run ESLint across the repo; treat existing findings as baseline and avoid adding new ones.
- `npm run typecheck`: run strict TypeScript checks with `tsc --noEmit`.

## Coding Style & Naming Conventions
Use TypeScript for app code and keep 2-space indentation, matching the existing files in `src/`. Prefer functional React components and colocate imports by dependency, then local modules. Name components and pages in `PascalCase` (`ProfileUpdateModal.tsx`), utilities in `camelCase` (`csvParser.ts`), and SQL migrations with timestamp prefixes (`20260328000000_agent_infrastructure.sql`). Tailwind is available for styling; keep shared layout patterns in components instead of duplicating page markup. Run `npm run lint` before opening a PR.

## Testing Guidelines
There is no dedicated automated test runner configured yet. Treat `npm run typecheck` and `npm run build` as the minimum required validation, and run `npm run lint` to avoid adding to the current lint backlog. For CSV import work, verify against fixtures in `test-csvs/` such as `01_standard_import.csv` and `03_messy_headers.csv`. For Supabase changes, test the affected migration or Edge Function with the matching frontend flow before merging.

## Commit & Pull Request Guidelines
Recent history uses short, lowercase, descriptive commit messages like `csv imports` and `agent infrastructure`. Follow that style: brief subject, focused scope, one concern per commit when practical. Pull requests should explain user-visible behavior, note any schema or environment changes, link the relevant issue, and include screenshots for UI changes.

## Security & Configuration Tips
Frontend code reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`; server-side functions also require `SUPABASE_SERVICE_ROLE_KEY`. Keep secrets out of client code, avoid logging credentials, and document any new environment variables in the PR.

## Environment Variables
Frontend (in `.env`):
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Edge functions (set in Supabase dashboard):
- `GEMINI_API_KEY` (required for all AI features)
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (required for DB access in edge functions)
- `TAVILY_API_KEY` (required for web search in search-contacts and update-profile)
- `BRAVE_API_KEY` (configured but not yet used in code)
- `APIFY_TOKEN` (configured in `.env`, not yet used in code — planned for LinkedIn scraping in Discovery/Verification agents, $5/mo free tier)

## Deploying Edge Functions
```bash
# Deploy a single function
supabase functions deploy ai-agent --project-ref <your-project-ref>

# Deploy all functions
supabase functions deploy --project-ref <your-project-ref>

# Set secrets (required per function)
supabase secrets set GEMINI_API_KEY=... TAVILY_API_KEY=... BRAVE_API_KEY=... APIFY_TOKEN=... --project-ref <your-project-ref>
```
Edge functions require the Supabase CLI (`npm i -g supabase`). The project ref is in the Supabase dashboard URL.

## Key Domain Concepts
- **Flemish Connection:** A person's tie to Flanders — could be a university (KU Leuven, UGent, VUB, UAntwerp), fellowship (BAEF, Fayat), organization (imec), or city. Stored as single text field on `people`.
- **Sectors:** Broad fields (Artificial Intelligence, Biotechnology, Finance, Culture & Arts, Education, Research). Stored in `sectors` table, linked via `person_sectors` junction.
- **Occupation:** Career stage category (Student, Academic/Researcher, Professional, Executive/Leadership). Single text field on `people`.
- **Collections:** Named groups of contacts for a specific purpose (e.g., "Contacts for LA Trade Mission"). Replaced the old Missions/Planner system.
- **Profile Suggestions:** AI-generated field update proposals stored in `profile_suggestions`, reviewed via admin panel (approve/reject).

## Database Conventions
- Migrations are in `supabase/migrations/` with timestamp prefixes (format: `YYYYMMDDHHMMSS_description.sql`).
- Table names are snake_case plural (e.g., `people`, `collections`).
- All tables have `id uuid DEFAULT gen_random_uuid() PRIMARY KEY`.
- All tables have `created_at timestamptz DEFAULT now()`.
- Junction tables use composite primary keys (e.g., `person_sectors(person_id, sector_id)`).
- RLS is enabled on all tables. Add policies in migrations.
- Location data is stored in the `locations` table, referenced via `location_id` FK.

## Workflow Expectations
- **Always deploy and verify changes end-to-end.** After writing code, run all necessary deployment steps yourself (push migrations with `supabase db push --linked`, deploy edge functions with `supabase functions deploy <name> --project-ref ofzuhajxwxggybkuzefq`, run `npm run typecheck`, `npm run build`, etc.). Do not leave deployment as instructions for the user.
- **Smoke-test after deploying.** After deploying edge functions or migrations, make a quick curl/API call to verify things work. Fix issues immediately if they don't.
- **Run the full loop:** code → typecheck → build → deploy → test. The user expects changes to be live and verified, not just written to disk.
- **Provide manual testing steps for the UI.** After deploying, tell the user exactly how to verify the changes in the browser: which page to go to, which button to click, what they should see. Be specific (e.g., "Go to Admin → scroll to Embedding Search Index → click Generate Embeddings → you should see a progress bar fill up").
- **Document any new environment variables or secrets.** If your code relies on a new env var (e.g., `GEMINI_FLASH_MODEL`), set a default in the code and also tell the user to add it to their `.env` file.
- **Update documentation.** Update this CLAUDE.md file with any new architectural decisions, conventions, or important notes related to your changes. Update a todo item in `todo.md` if the change is related to an existing task, and mark it as done.
