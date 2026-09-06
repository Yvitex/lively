# Lively — build instructions: register + email confirmation

These documents tell you exactly how to build the account-creation and email-confirmation experience in this Next.js 16 app. They are written to be executed top to bottom by a developer or an agent. Nothing in `instruct/` is code; it describes code.

## What you are building

Lively is a social app (post, follow, interact). Beneath the surface is a larger app for otaku audiences: a Lively profile can later create a *shadow profile* that reaches k-pop, anime, manga, music and hobby services. The register and confirm screens are the front door of the mainstream surface. They must feel friendly and alive, and they may *hint* at the second self — they must never explain it.

The backend that stores users and sends confirmation emails already exists as a **separate service**. This app never exposes it to the browser. The backend will adapt to the contract in `02-backend-contract.md`.

## Execution order

| Step | Document | Produces |
|---|---|---|
| 1 | `01-foundation.md` | `src/` layout, dependencies, strict TS, env parsing, security headers, font, scripts |
| 2 | `02-backend-contract.md` | The HTTP contract every other doc reads from (share with the backend team) |
| 3 | `03-api-layer.md` | `lib/errors`, `lib/api/client.ts`, `lib/api/auth.ts`, `lib/rate-limit.ts`, `lib/logger.ts` |
| 4 | `06-design-system.md` | Tokens, type, layout, components — read before touching any `.tsx` |
| 5 | `04-register-flow.md` | `/register` and `/register/check-email` |
| 6 | `05-confirm-flow.md` | `/confirm-email` |
| 7 | `07-verification.md` | Unit, component and E2E tests, CI, manual QA, definition of done |

Read `06` before `04`/`05` even though it is numbered later: the components in `04`/`05` are specified there.

Each document has the same shape: **Goal → Read first → Do → Do not → Done when.** "Read first" points at the Next.js docs bundled in `node_modules/next/dist/docs/` — this Next.js version differs from what you remember, so read those pages before writing code.

## Non-negotiables

These come from `../ARCHITECTURE.md`; the section numbers are cited so you can read the reasoning.

1. **Browser → Next.js server → backend.** The browser never calls the backend. Backend URL and any service key are server-only env vars. No `NEXT_PUBLIC_` secret, ever. (§6, §12)
2. **Server Components by default.** A file gets `'use client'` only when it needs state, effects, event handlers or browser APIs. Keep client components small. (§3)
3. **One API layer.** All backend calls go through `src/lib/api/`. No stray `fetch` in components or actions. Every call has a timeout, a request id, and Zod-parsed responses. (§12, §13)
4. **Validate on both sides.** One Zod schema in `src/features/auth/validation.ts`. The client uses it for UX; the Server Action uses it as the authority. (§2, §7)
5. **Treat every Server Action as a public endpoint.** Rate-check, validate, call the API layer, map errors, return safe messages. (§8, §34)
6. **Never show internal errors.** Users see plain language plus a reference id; the real error goes to the structured logger. (§16, §17)
7. **Every async UI has all its states:** idle, pending, success, empty (where it applies), error, and the specific failures the contract defines. (§15)
8. **No retries on POST.** Register and confirm are mutations; use the idempotency key instead. (§14)
9. **Accessibility is a requirement,** not a polish pass: visible labels, visible focus, `aria-describedby` for errors, `aria-live` for async messages, keyboard-only pass before done, reduced motion respected. (§23, §24)
10. **Aesthetic decisions are made in `06-design-system.md`.** Do not substitute a generic auth template, a UI kit, or default fonts.

## Out of scope for this phase

Login, sessions, cookies for auth, password reset, OAuth/social sign-in, shadow-profile creation, CAPTCHA. Where a doc mentions one of these, it is only to leave a clean seam for later.

## Conventions used in the docs

- Paths are relative to the repo root unless shown otherwise; application code lives under `src/`.
- Commands are shown for `pnpm`. `npm run <script>` works if you keep `package-lock.json`, but do not keep both lockfiles.
- Code blocks are complete enough to paste, then adjust. Where a snippet says `// …` the surrounding doc tells you what goes there.
- Copy (user-facing text) is quoted exactly. Use it as written; the words were chosen deliberately.
