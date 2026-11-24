# Project instructions

## Repository overview

- This is a small Next.js App Router dashboard backed by Supabase.
- The authenticated dashboard UI is in `src/app/page.tsx`; login is in `src/app/login/page.tsx`.
- The browser-side Supabase client is in `src/lib/supabase.ts`.
- `worker.js` polls Supabase for scheduled tasks and uses Playwright, stealth browser tooling, cookies, and optional proxies to execute actions.
- The project primarily uses JavaScript and TypeScript/TSX; keep changes consistent with each file's existing style.
- The repository currently has no test suite or package scripts declared in `package.json`.

## Working conventions

- Inspect and update the smallest relevant set of files.
- Preserve existing user-facing text and behavior unless the request explicitly calls for a change.
- Reuse the existing Supabase client from `@/lib/supabase` in browser components.
- Keep browser components under `src/app` and shared client setup in `src/lib`.
- Keep backend/polling automation in `worker.js` unless the request clearly requires a different boundary.
- Use Indonesian UI copy and error messages to match the existing dashboard.
- Validate form data before database writes and preserve loading/error feedback patterns.
- Use Supabase relation and table names exactly as used by the application: `accounts`, `campaigns`, and `tasks`.
- Account cookies are sensitive. Never log, return in API responses, print in chat, or expose cookie values through UI code.
- Never log or persist proxy credentials; redact proxy URLs and secrets in errors and diagnostics.
- Do not replace environment variables or hard-code credentials in source files.
- Treat `NEXT_PUBLIC_*` variables as public: only the anon key belongs in browser code, and the service-role key belongs only in server-side or worker processes.
- `.env*` files are ignored by git. Do not weaken `.gitignore` or remove environment secret protections.

## Security-sensitive changes

- Before editing authentication or authorization, inspect both browser session checks and worker/database access.
- Do not move `SUPABASE_SERVICE_ROLE_KEY` into client-side code or `NEXT_PUBLIC_*` variables.
- If an existing secret is exposed in a prompt, chat, diff, log, or tracked file, stop and flag that it must be revoked and rotated. Do not repeat or copy the secret.
- When handling cookies, proxies, passwords, or service credentials, prefer redaction, validation, and least-privilege database policies over additional logging.
- Be careful with RLS assumptions: the dashboard's `anon` key must not grant unintended access to sensitive account data.

## Supabase and worker behavior

- When changing task or campaign shapes, update both the TSX query/result types and `worker.js` field usage.
- Preserve task lifecycle status transitions: `pending` -> `processing` -> `success` or `failed`.
- Failed operations should update the task status and a redacted `log_message`.
- Keep polling safe: handle Supabase errors, close browser resources in `finally`, and avoid tight or unbounded retry behavior.
- Keep scheduled-task ordering and delay calculations deterministic enough to be testable; avoid unrelated randomness changes.
- Browser automation selectors are platform-specific and often unstable. Prefer existing `aria-label`/role selectors and document why a locator change is needed.

## UI and state

- Use React client components and hooks for interactive pages.
- Preserve controlled form state, submit disabling during async work, and refresh behavior after mutations.
- Use `React.FormEvent` for form handlers and the existing Tailwind utility style unless a request introduces a coherent component framework.
- Check loading, empty, success, and error states for table and form changes.
- Keep scheduled-time display locale behavior consistent with Indonesian (`id-ID`) output.

## Commands and validation

- Install dependencies with `npm install` or `npm ci` as appropriate.
- Before assuming Next.js or test scripts exist, read `package.json`; the current manifest does not declare run scripts or Next.js/React dependencies.
- For worker changes, validate syntax with `node --check worker.js`; test against a disposable Supabase project or mocked data, never production credentials.
- For UI changes, install/restore declared dependencies and run the project's Next.js command once it is present in the package manifest.
- For every behavior change, add or update focused tests if an existing test framework is introduced or already present.
- Do not start an infinite worker process merely to validate a small polling change.
