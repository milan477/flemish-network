Run all quality checks before considering work on this branch complete.

Execute the following checks in order and report results:

1. **Lint** — Run `npm run lint`. Report any ESLint errors or warnings.
2. **Typecheck** — Run `npm run typecheck`. Report any TypeScript errors.
3. **Build** — Run `npm run build`. Report any build failures.
4. **Migration validation** — If any files in `supabase/migrations/` were modified or added on this branch (check with `git diff --name-only main`), validate them against project conventions:
   - RLS enabled + policies present
   - Naming conventions followed
   - Proper PKs, timestamps, constraints
5. **Git status** — Show uncommitted changes and untracked files.

Report a summary at the end:
- ✓ or ✗ for each check
- Total issues found
- Whether this branch is ready for PR

Do NOT fix anything automatically.
