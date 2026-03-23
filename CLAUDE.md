# Flemish Network Intelligence Platform

## What This Is
A web platform for the Delegation of Flanders to the USA that maps and makes searchable the Flemish professional network across the United States. Replaces fragmented Excel-based tracking with a unified, AI-powered system. Target users: Fayat fellowship coordinators, Flanders Investment & Trade staff, diplomats, and Flemish professionals themselves.

## Tech Stack
- **Frontend:** React 18 + TypeScript, Vite, Tailwind CSS, Lucide React (icons)
- **Backend:** Supabase (PostgreSQL + Edge Functions in Deno/TypeScript)
- **AI:** Google Gemini 2.0 Flash (via edge function `ai-agent`)
- **Web Search:** Tavily API (for profile enrichment)
- **Geocoding:** Nominatim / OpenStreetMap (cached in `locations` table)
- **No router library** — routing is manual via `useState<Page>` in `App.tsx`

## Commands
```bash
npm run dev          # Start dev server
npm run build        # Production build
npm run preview      # Preview production build
npm run lint         # ESLint
npm run typecheck    # TypeScript type checking (tsc --noEmit)
```

## Project Structure
```
src/
├── App.tsx                     # Manual client-side routing via page state
├── main.tsx                    # Entry point
├── pages/                      # Top-level page components
│   ├── Dashboard.tsx           # Main view: map + directory + search
│   ├── Planner.tsx             # Mission/event planner (being replaced by Collections)
│   ├── Admin.tsx               # Stats dashboard + admin tools
│   ├── PersonProfile.tsx       # Individual contact detail/edit
│   ├── OrganizationProfile.tsx # Organization detail
│   └── AddContact.tsx          # Manual contact creation
├── components/                 # Reusable UI components
│   ├── Navigation.tsx          # Top nav bar with search
│   ├── MapVisualization.tsx    # Interactive US map with clusters
│   ├── FilterPanel.tsx         # Right sidebar filters
│   ├── DirectoryGrid.tsx       # Contact list view
│   ├── PlanForm.tsx            # Event creation form
│   ├── PlanDetail.tsx          # Event detail view
│   ├── PlannerChatbot.tsx      # AI chat for planning
│   ├── ClusterPopover.tsx      # Map cluster click popup
│   ├── ProfileUpdateModal.tsx  # AI profile suggestion review
│   └── admin/                  # Admin sub-components
├── lib/                        # Utilities and services
│   ├── supabase.ts             # DB client, types, helpers (Person, Organization, etc.)
│   ├── aiService.ts            # AI API wrapper + scoring functions
│   ├── plannerUtils.ts         # Event type configs, action templates
│   ├── csvParser.ts            # CSV import with field mapping + dedup
│   ├── geocoding.ts            # Batch geocoding via edge function
│   ├── locations.ts            # Location coordinate cache
│   └── usMapData.ts            # US state SVG paths + Mercator projection
supabase/
├── migrations/                 # Sequential SQL migrations (timestamp-prefixed)
└── functions/                  # Deno edge functions
    ├── ai-agent/               # Gemini orchestration (6 task types)
    ├── search-contacts/        # Web search for new contacts
    ├── geocode/                # Nominatim geocoding + DB caching
    └── update-profile/         # AI profile enrichment
```

## Architecture Decisions
- **No React Router:** Pages are switched via `currentPage` state in `App.tsx`. Navigation is handled by `onNavigate` callbacks. When adding new pages, add a new `Page` union member and conditional render in `App.tsx`.
- **No state management library:** All state via React hooks. Props passed down from App.tsx.
- **No auth yet:** Single-tenant with Supabase anon key. RLS allows public read, selective write.
- **AI via edge functions:** All AI calls go through `supabase/functions/ai-agent/` which wraps Gemini. Add new AI tasks there, not client-side.
- **Types in supabase.ts:** All database entity types (Person, Organization, etc.) and shared types live in `src/lib/supabase.ts`.

## Coding Conventions
- TypeScript strict mode. Run `npm run typecheck` before committing.
- Tailwind for all styling. No CSS files, no CSS-in-JS.
- Functional components only. No class components.
- Named exports for components, default export for pages.
- Edge functions use Deno APIs and imports from `https://esm.sh/`.

## Database Conventions
- Migrations are in `supabase/migrations/` with timestamp prefixes.
- Table names are snake_case plural (e.g., `people`, `plan_actions`).
- All tables have `id uuid DEFAULT gen_random_uuid() PRIMARY KEY`.
- All tables have `created_at timestamptz DEFAULT now()`.
- Junction tables use composite primary keys (e.g., `person_sectors(person_id, sector_id)`).
- RLS is enabled on all tables. Add policies in migrations.

## Branch Naming
Use feature branches: `feature/<short-description>` (e.g., `feature/unified-search`, `feature/collections`).

## Environment Variables
Frontend (in `.env`):
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Edge functions (set in Supabase dashboard):
- `GEMINI_API_KEY`
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- `TAVILY_API_KEY`

## Key Domain Concepts
- **Flemish Connection:** A person's tie to Flanders — could be a university (KU Leuven, UGent, VUB, UAntwerp), fellowship (BAEF, Fayat), organization (imec), or city.
- **Sectors:** Broad fields (AI, Biotech, Finance, Culture & Arts, Education, Research). A person can belong to multiple sectors.
- **Occupation:** Career stage category (Student, Academic/Researcher, Professional, Executive/Leadership). Different from sector.
- **Collections (replacing Missions/Plans):** Named groups of contacts for a specific purpose (e.g., "Contacts for LA Trade Mission"). Lightweight — no event types, no action items.
