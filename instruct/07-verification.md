# 07 — Verification

## Goal

Prove the flows work: unit tests for the pure parts, component tests for the forms, end-to-end tests against a mock backend that implements `02-backend-contract.md`, a CI pipeline that blocks on all of it, and a manual checklist for the things tests cannot see.

Items marked **(optional)** can be deferred until the flow is stable without weakening the core guarantee.

## Read first

- `node_modules/next/dist/docs/01-app/02-guides/testing/vitest.md`
- `node_modules/next/dist/docs/01-app/02-guides/testing/playwright.md`
- `node_modules/next/dist/docs/01-app/02-guides/production-checklist.md`

## Why a mock backend and not `page.route`

The browser never talks to the backend — the Server Action does, from the Node process. Playwright's `page.route` only intercepts the browser's requests, so it cannot fake the backend. Instead, E2E runs a tiny HTTP server that speaks the contract, and the app is started with `BACKEND_API_URL` pointed at it. This also gives you a living, executable copy of `02`.

## Do

### 1. Vitest

`vitest.config.mts`:

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
```

`vitest.setup.ts`:

```ts
import '@testing-library/jest-dom/vitest'
import { vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.stubEnv('BACKEND_API_URL', 'http://backend.test')
vi.stubEnv('APP_URL', 'http://localhost:3000')
vi.stubEnv('REQUEST_TIMEOUT_MS', '1000')
```

Unit tests to write (listed in `03` §7): `src/lib/errors/index.test.ts`, `src/lib/api/client.test.ts`, `src/lib/rate-limit.test.ts`. Add:

`src/features/auth/validation.test.ts`
- `RegisterSchema`: trims display name, lowercases email, rejects 9-char password, accepts 10, rejects 129, rejects `not-an-email`, error messages equal the copy in `04`.
- `TokenSchema`: accepts 43 base64url chars, rejects 42, rejects `+`/`=`/spaces, rejects 257 chars.

Component tests (mock the action module with `vi.mock('@/features/auth/actions')`; use `@testing-library/user-event`):

`src/features/auth/components/register-form.test.tsx`
- renders three labelled inputs and a "Create account" button
- when the mocked action resolves `{ fieldErrors: { email: ['Enter a valid email address.'] } }`, the email input has `aria-invalid="true"`, the message is in its `aria-describedby`, and the display-name value survives
- `EMAIL_TAKEN` renders a link named "Sign in instead"
- `formError` with `referenceId` renders `role="alert"` containing "Reference:"
- the honeypot input is not reachable by tab (`tabIndex -1`)

`src/features/auth/components/confirm-email-card.test.tsx`
- `token={null}` renders "This link doesn't work" and no "Confirm email" button
- with a token, renders the button; after the mocked action resolves `{ status: 'confirmed' }`, heading reads "Email confirmed" and the section has `data-state="confirmed"`
- `expired` and `invalid` render the resend form; `failed` shows the reference id

`src/components/ui/password-field.test.tsx`
- toggle switches `type` and `aria-pressed`; the button's accessible name flips Show ↔ Hide

Keep async Server Components (`page.tsx`) out of Vitest — cover them in E2E.

### 2. Mock backend — `e2e/mock-backend.mjs`

Node only, no dependencies. Implements `02` exactly and records requests for assertions.

```js
import { createServer } from 'node:http'

const PORT = Number(process.env.MOCK_BACKEND_PORT ?? 4010)
const requests = []
const idempotent = new Map()

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(body === undefined ? '' : JSON.stringify(body))
}
const error = (res, status, code, extra = {}) =>
  json(res, status, { code, message: `mock ${code}`, requestId: 'mock-req', ...extra })

createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/__health') return json(res, 200, { ok: true })
  if (req.method === 'GET' && req.url === '/__requests') return json(res, 200, requests)
  if (req.method === 'POST' && req.url === '/__reset') {
    requests.length = 0
    idempotent.clear()
    return json(res, 204)
  }

  let body = ''
  for await (const chunk of req) body += chunk
  const data = body ? JSON.parse(body) : {}
  requests.push({ method: req.method, url: req.url, headers: req.headers, body: data })

  if (req.method !== 'POST') return error(res, 404, 'NOT_FOUND')
  if (!req.headers['x-request-id']) return error(res, 400, 'VALIDATION')

  if (req.url === '/auth/register') {
    const key = req.headers['idempotency-key']
    if (key && idempotent.has(key)) {
      const prior = idempotent.get(key)
      return json(res, prior.status, prior.body)
    }
    let response
    if (data.email === 'taken@lively.test') {
      response = { status: 409, body: { code: 'EMAIL_TAKEN', message: 'taken', requestId: 'mock-req' } }
    } else if (data.email === 'slow@lively.test') {
      await new Promise((r) => setTimeout(r, 4000))
      response = { status: 201, body: { userId: 'usr_slow' } }
    } else if (data.email === 'weak@lively.test') {
      response = {
        status: 422,
        body: {
          code: 'VALIDATION',
          message: 'weak',
          requestId: 'mock-req',
          fields: { password: ['This password appeared in a data breach. Choose another.'] },
        },
      }
    } else {
      response = { status: 201, body: { userId: `usr_${requests.length}` } }
    }
    if (key) idempotent.set(key, response)
    return json(res, response.status, response.body)
  }

  if (req.url === '/auth/confirm-email') {
    const t = String(data.token ?? '')
    if (t.startsWith('expired_')) return error(res, 410, 'TOKEN_EXPIRED')
    if (t.startsWith('invalid_')) return error(res, 400, 'TOKEN_INVALID')
    if (t.startsWith('used_')) return json(res, 200, { status: 'already_confirmed' })
    return json(res, 200, { status: 'confirmed' })
  }

  if (req.url === '/auth/resend-confirmation') return json(res, 202)

  return error(res, 404, 'NOT_FOUND')
}).listen(PORT, () => console.log(`mock backend on http://localhost:${PORT}`))
```

Token fixtures for tests (all match the 43+ char regex): `'expired_' + 'a'.repeat(40)`, `'invalid_' + 'a'.repeat(40)`, `'used_' + 'a'.repeat(40)`, `'ok_' + 'a'.repeat(41)`.

### 3. Playwright — `playwright.config.ts`

```ts
import { defineConfig, devices } from '@playwright/test'

const APP = 'http://localhost:3000'
const MOCK = 'http://localhost:4010'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: APP, trace: 'on-first-retry' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // (optional) add once the flow is stable:
    // { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    {
      command: 'node e2e/mock-backend.mjs',
      url: `${MOCK}/__health`,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'pnpm build && pnpm start',
      url: APP,
      timeout: 180_000,
      reuseExistingServer: !process.env.CI,
      env: {
        BACKEND_API_URL: MOCK,
        APP_URL: APP,
        REQUEST_TIMEOUT_MS: '2000',
        NODE_ENV: 'production',
      },
    },
  ],
})
```

`REQUEST_TIMEOUT_MS=2000` with the mock's 4 s `slow@` response is how the timeout path is exercised. `fullyParallel: false` because the mock keeps shared state; reset it in `beforeEach` with `request.post(MOCK + '/__reset')`.

### 4. E2E specs — `e2e/*.spec.ts`

`register.spec.ts`
- **happy path**: fill valid data → URL is `/register/check-email` → page shows the email → mock recorded one `/auth/register` with `x-request-id` and `idempotency-key` headers and lowercased email.
- **email taken**: `taken@lively.test` → inline error with link "Sign in instead"; still on `/register`.
- **backend field error**: `weak@lively.test` → password field shows the backend message.
- **timeout**: `slow@lively.test` → `role=alert` contains "couldn't create your account" and "Reference:".
- **client validation**: submit empty → three inline errors, focus on the first invalid field, **zero** requests recorded.
- **idempotency**: submit twice quickly (the `slow@` email keeps the first request in flight) → both recorded requests carry the same `idempotency-key`.
- **resend from check-email**: click "Send a new link" → success status text; mock recorded `/auth/resend-confirmation`.

`confirm.spec.ts`
- **no consumption on load**: visit `/confirm-email?token=ok_…` → recorded requests are empty; button "Confirm email" visible.
- **confirmed**: click → heading "Email confirmed"; `section[data-state="confirmed"]`; link "Continue to Lively".
- **already confirmed**: `used_` token → heading "Already confirmed".
- **expired**: `expired_` token → heading "This link has expired" and a "Send a new link" button; submitting it records `/auth/resend-confirmation`.
- **invalid shape**: `?token=abc` and no token → heading "This link doesn't work", no confirm button, no requests.
- **reduced motion**: `page.emulateMedia({ reducedMotion: 'reduce' })` → computed `transition-duration` of the panel is `0s`.

`a11y.spec.ts` **(optional)** — install `@axe-core/playwright`; run axe on `/register`, `/register/check-email`, `/confirm-email?token=ok_…`; fail on `serious`/`critical`. Also assert the Tab order listed in `04` "Done when". Until this exists, do the keyboard pass manually (section 6).

### 5. CI — `.github/workflows/ci.yml`

```yaml
name: ci
on:
  pull_request:
  push:
    branches: [main]
jobs:
  verify:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm format:check
      - run: pnpm test
      - run: pnpm audit
      - run: pnpm exec playwright install --with-deps chromium
      - run: pnpm test:e2e
        env:
          CI: true
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: playwright-report
```

No `.env` file is needed in CI: the Playwright `webServer.env` supplies everything, and `next build` must succeed without one. If the build fails on missing env, `src/lib/env.ts` is being imported at build time from a static page — fix the import, not the pipeline.

### 6. Manual QA (once per screen before calling it done)

- [ ] Keyboard only, no mouse: complete register → check-email → resend, and confirm-email → confirmed.
- [ ] Screen reader (VoiceOver or NVDA): labels read, errors announced on submit, confirmed heading announced after click.
- [ ] 360px wide and 200% browser zoom: no horizontal scroll, buttons full width, shadow offset 6px.
- [ ] Dark mode: every token pair still legible; the violet shadow still visible against dark paper.
- [ ] `prefers-reduced-motion`: no panel transition; buttons still change shadow on press.
- [ ] `curl -I "http://localhost:3000/confirm-email?token=ok_…"` against the mock: `/__requests` stays empty — nothing is confirmed by a bare GET.
- [ ] Lighthouse on `/register` (mobile): Accessibility ≥ 95, Best Practices ≥ 95, no CSP console violations.
- [ ] Compare the screens with `06` "Reviewed against the generic default". If anything drifted toward the rejected column, fix it.

## Do not

- Do not mock `fetch` in E2E. Use the mock backend.
- Do not mark E2E tests `skip` to get CI green. Fix or delete.
- Do not test implementation details (class names, internal state). Test roles, names, text and recorded backend requests.

## Done when — definition of done for this whole phase

- `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test && pnpm build && pnpm test:e2e` pass locally and in CI.
- All rows in the UI-state tables of `04` and `05` are covered by an E2E or component test.
- Manual QA checklist above is ticked.
- `02-backend-contract.md` checklist has been handed to the backend team and the mock backend matches it line for line.
- No `NEXT_PUBLIC_` variable exists; `fetch(` appears only in `src/lib/api/client.ts`.
