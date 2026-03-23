Validate Supabase database migration files in `supabase/migrations/`.

If a specific file is provided as an argument, validate only that file. Otherwise, validate the most recently modified migration file.

Check the following for each migration file:

**Naming:**
- [ ] File follows the timestamp prefix convention: `YYYYMMDDHHMMSS_description.sql`
- [ ] Description is lowercase snake_case

**Schema conventions:**
- [ ] Tables use snake_case plural names (e.g., `people`, `plan_actions`)
- [ ] All tables have `id uuid DEFAULT gen_random_uuid() PRIMARY KEY`
- [ ] All tables have `created_at timestamptz DEFAULT now()`
- [ ] Foreign keys reference the correct parent tables
- [ ] Junction/join tables use composite primary keys

**RLS (Row-Level Security):**
- [ ] `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` is present for every new table
- [ ] At least a SELECT policy exists for every new table
- [ ] INSERT/UPDATE/DELETE policies are defined as appropriate
- [ ] Policies use `anon` role (current pattern) or `authenticated` role if auth has been implemented

**Data integrity:**
- [ ] TEXT columns that should be constrained use CHECK constraints or enums (e.g., status fields)
- [ ] NOT NULL is used where appropriate
- [ ] DEFAULT values make sense

**Comparison with existing migrations:**
- Read `supabase/migrations/` to understand existing patterns
- Flag any deviation from established conventions

Report findings as a checklist. Do NOT modify the migration file — just report issues.
