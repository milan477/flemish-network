Run a full production build to catch any build errors.

1. Run `npm run build` (Vite production build)
2. If the build fails:
   - Show the full error output
   - Identify the root cause (missing imports, TypeScript errors, Tailwind issues, etc.)
   - Suggest specific fixes for each error
3. If the build succeeds:
   - Report success with the build output summary (bundle sizes, etc.)
   - Run `npm run preview` in the background so the user can check the result at the local URL

Do NOT fix errors automatically — just report them clearly.
