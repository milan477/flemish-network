Run TypeScript type checking on the project and report results.

1. Run `npm run typecheck` (which runs `tsc --noEmit -p tsconfig.app.json`)
2. If there are errors:
   - List each error with file path, line number, and the error message
   - Group errors by file
   - For each error, briefly explain what's wrong and suggest a fix
   - Report the total error count
3. If there are no errors, confirm "No type errors found."

Do NOT fix the errors automatically — just report them. The user will decide what to fix.
