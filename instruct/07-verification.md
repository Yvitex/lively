# 07 — Verification

## Goal

By this point, every unit and component test already lives next to the step in `03`–`06` that introduced its behavior — `pnpm test` should already be green. What's left is what those tests cannot cover: the real HTTP round trip a Server Action makes to a backend, and the things only a browser can show you. This doc builds a mock backend one endpoint at a time, then Playwright specs one scenario at a time, then CI, then a manual pass.

Items marked **(optional)** can be deferred until the flow is stable without weakening the core guarantee.

## Read first

- `node_modules/next/dist/docs/01-app/02-guides/testing/playwright.md`
- `node_modules/next/dist/docs/01-app/02-guides/production-checklist.md`

## Why a mock backend and not `page.route`

The browser never talks to the backend — the Server Action does, from the Node process running the app. Playwright's `page.route` only intercepts requests the *browser* makes, so it cannot fake the backend. Instead, a small standalone HTTP server implements `02-backend-contract.md`, and the app under test is started with `BACKEND_API_URL` pointed at it.

## Step 1 — Mock backend: health and reset only

Start with the scaffolding every later endpoint will use — no auth logic yet.

`e2e/mock-backend.mjs`:

```js
import { createServer } from 'node:http'

const PORT = Number(process.env.MOCK_BACKEND_PORT ?? 4010)
const requests = []

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(body === undefined ? '' : JSON.stringify(body))
}

createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/__health') return json(res, 200, { ok: true })
  if (req.method === 'GET' && req.url === '/__requests') return json(res, 200, requests)
  if (req.method === 'POST' && req.url === '/__reset') {
    requests.length = 0
    return json(res, 204)
  }
  return json(res, 404, { code: 'NOT_FOUND', message: 'no route' })
}).listen(PORT, () => console.log(`mock backend on http://localhost:${PORT}`))
```

**Verify:** run `node e2e/mock-backend.mjs` in one terminal, then in another: `curl http://localhost:4010/__health` → `{"ok":true}`. Stop the server (Ctrl+C) before continuing.

## Step 2 — Mock backend: request logging

Add the body/header capture every endpoint below depends on.

```js
createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/__health') return json(res, 200, { ok: true })
  if (req.method === 'GET' && req.url === '/__requests') return json(res, 200, requests)
  if (req.method === 'POST' && req.url === '/__reset') {
    requests.length = 0
    return json(res, 204)
  }

  let body = ''
  for await (const chunk of req) body += chunk
  const data = body ? JSON.parse(body) : {}
  requests.push({ method: req.method, url: req.url, headers: req.headers, body: data })

  return json(res, 404, { code: 'NOT_FOUND', message: 'no route' })
}).listen(PORT, () => console.log(`mock backend on http://localhost:${PORT}`))
```

**Verify:** `node e2e/mock-backend.mjs` &, then `curl -X POST http://localhost:4010/whatever -d '{"a":1}' -H 'content-type: application/json'`, then `curl http://localhost:4010/__requests` — confirm the posted body and path show up in the array. Stop the server.

## Step 3 — Mock backend: `/auth/register`

```js
const idempotent = new Map()
const error = (res, status, code, extra = {}) => json(res, status, { code, message: `mock ${code}`, requestId: 'mock-req', ...extra })

// replace the fallback 404 with a route check before it:
if (req.method === 'POST' && req.url === '/auth/register') {
  if (!req.headers['x-request-id']) return error(res, 400, 'VALIDATION')
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
      body: { code: 'VALIDATION', message: 'weak', requestId: 'mock-req', fields: { password: ['This password appeared in a data breach. Choose another.'] } },
    }
  } else {
    response = { status: 201, body: { userId: `usr_${requests.length}` } }
  }
  if (key) idempotent.set(key, response)
  return json(res, response.status, response.body)
}
```

**Verify:** `node e2e/mock-backend.mjs` &. `curl -X POST http://localhost:4010/auth/register -H 'x-request-id: t1' -H 'content-type: application/json' -d '{"email":"new@x.test"}'` → `201`. `curl ... -d '{"email":"taken@lively.test"}'` → `409` with `EMAIL_TAKEN`. Repeat the first call with `-H 'idempotency-key: k1'` twice — confirm the second returns the exact same `userId` instead of incrementing. Stop the server.

## Step 4 — Mock backend: `/auth/confirm-email`

```js
if (req.method === 'POST' && req.url === '/auth/confirm-email') {
  const t = String(data.token ?? '')
  if (t.startsWith('expired_')) return error(res, 410, 'TOKEN_EXPIRED')
  if (t.startsWith('invalid_')) return error(res, 400, 'TOKEN_INVALID')
  if (t.startsWith('used_')) return json(res, 200, { status: 'already_confirmed' })
  return json(res, 200, { status: 'confirmed' })
}
```

Token fixtures for later use (all match the 43+ char shape): `'expired_' + 'a'.repeat(40)`, `'invalid_' + 'a'.repeat(40)`, `'used_' + 'a'.repeat(40)`, `'ok_' + 'a'.repeat(41)`.

**Verify:** `curl -X POST http://localhost:4010/auth/confirm-email -H 'x-request-id: t1' -H 'content-type: application/json' -d '{"token":"expired_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}'` → `410`. Swap `expired_` for `used_` → `200` `already_confirmed`. Swap for anything else → `200` `confirmed`.

## Step 5 — Mock backend: `/auth/resend-confirmation`

```js
if (req.method === 'POST' && req.url === '/auth/resend-confirmation') return json(res, 202)
```

**Verify:** `curl -X POST http://localhost:4010/auth/resend-confirmation -H 'x-request-id: t1' -H 'content-type: application/json' -d '{"email":"anyone@x.test"}'` → `202`. The mock backend now implements all of `02`.

## Step 6 — Playwright config

`playwright.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test'

const APP = 'http://localhost:3000'
const MOCK = 'http://localhost:4010'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: APP, trace: 'on-first-retry' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    { command: 'node e2e/mock-backend.mjs', url: `${MOCK}/__health`, reuseExistingServer: !process.env.CI },
    {
      command: 'pnpm build && pnpm start',
      url: APP,
      timeout: 180_000,
      reuseExistingServer: !process.env.CI,
      env: { BACKEND_API_URL: MOCK, APP_URL: APP, REQUEST_TIMEOUT_MS: '2000', NODE_ENV: 'production' },
    },
  ],
})
```

`fullyParallel: false` because the mock keeps shared state between tests. `REQUEST_TIMEOUT_MS=2000` against the mock's 4s `slow@` response is how Step 9 exercises the timeout path.

**Verify:** `pnpm exec playwright test --list` — it should start both `webServer` processes, print the (currently empty) test list, and exit cleanly. This proves the config and both servers boot together before any spec exists.

## Step 7 — First E2E spec: register happy path

`e2e/register.spec.ts`:

```ts
import { expect, test } from '@playwright/test'

const MOCK = 'http://localhost:4010'

test.beforeEach(async ({ request }) => {
  await request.post(`${MOCK}/__reset`)
})

test('a valid submission lands on check-email and hits the backend once', async ({ page, request }) => {
  await page.goto('/register')
  await page.getByLabel('Display name').fill('Ren')
  await page.getByLabel('Email').fill('new@x.test')
  await page.getByLabel('Password').fill('correct horse battery')
  await page.getByRole('button', { name: 'Create account' }).click()

  await expect(page).toHaveURL('/register/check-email')
  await expect(page.getByText('new@x.test')).toBeVisible()

  const recorded = await (await request.get(`${MOCK}/__requests`)).json()
  const registerCalls = recorded.filter((r: { url: string }) => r.url === '/auth/register')
  expect(registerCalls).toHaveLength(1)
  expect(registerCalls[0].headers['x-request-id']).toBeTruthy()
  expect(registerCalls[0].body.email).toBe('new@x.test')
})
```

**Verify:** `pnpm test:e2e` — 1 passed. This is the first real proof that the browser, the Server Action, and the mock backend are wired together end to end; every later scenario adds to this file the same way.

## Step 8 — Add: email taken, backend field error

```ts
test('a taken email shows a sign-in link and stays on the page', async ({ page }) => {
  await page.goto('/register')
  await page.getByLabel('Display name').fill('Ren')
  await page.getByLabel('Email').fill('taken@lively.test')
  await page.getByLabel('Password').fill('correct horse battery')
  await page.getByRole('button', { name: 'Create account' }).click()

  await expect(page.getByRole('link', { name: 'Sign in instead' })).toBeVisible()
  await expect(page).toHaveURL('/register')
})

test('a backend field error is shown under the right field', async ({ page }) => {
  await page.goto('/register')
  await page.getByLabel('Display name').fill('Ren')
  await page.getByLabel('Email').fill('weak@lively.test')
  await page.getByLabel('Password').fill('correct horse battery')
  await page.getByRole('button', { name: 'Create account' }).click()

  await expect(page.getByText('This password appeared in a data breach')).toBeVisible()
})
```

**Verify:** `pnpm test:e2e` — 3 passed.

## Step 9 — Add: timeout, client-side validation, idempotency

```ts
test('a slow backend response shows a safe error with a reference id', async ({ page }) => {
  await page.goto('/register')
  await page.getByLabel('Display name').fill('Ren')
  await page.getByLabel('Email').fill('slow@lively.test')
  await page.getByLabel('Password').fill('correct horse battery')
  await page.getByRole('button', { name: 'Create account' }).click()

  const alert = page.getByRole('alert')
  await expect(alert).toContainText("couldn't create your account")
  await expect(alert).toContainText('Reference:')
})

test('empty submission shows inline errors and calls the backend zero times', async ({ page, request }) => {
  await page.goto('/register')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByLabel('Display name')).toHaveAttribute('aria-invalid', 'true')

  const recorded = await (await request.get(`${MOCK}/__requests`)).json()
  expect(recorded).toHaveLength(0)
})

test('two rapid submissions with the slow email carry the same idempotency key', async ({ page, request }) => {
  await page.goto('/register')
  await page.getByLabel('Display name').fill('Ren')
  await page.getByLabel('Email').fill('slow@lively.test')
  await page.getByLabel('Password').fill('correct horse battery')
  const button = page.getByRole('button', { name: 'Create account' })
  await button.click()
  await button.click() // fires while the first request is still in flight (button is disabled but the click confirms it's a no-op)

  const recorded = await (await request.get(`${MOCK}/__requests`)).json()
  const keys = new Set(recorded.map((r: { headers: Record<string, string> }) => r.headers['idempotency-key']))
  expect(keys.size).toBe(1)
})
```

**Verify:** `pnpm test:e2e` — 6 passed.

## Step 10 — Add: resend from check-email

```ts
test('resend from check-email hits the backend and shows the generic success message', async ({ page, request }) => {
  await page.goto('/register')
  await page.getByLabel('Display name').fill('Ren')
  await page.getByLabel('Email').fill('new2@x.test')
  await page.getByLabel('Password').fill('correct horse battery')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL('/register/check-email')

  await page.getByRole('button', { name: 'Send a new link' }).click()
  await expect(page.getByText('a new link is on its way')).toBeVisible()

  const recorded = await (await request.get(`${MOCK}/__requests`)).json()
  expect(recorded.some((r: { url: string }) => r.url === '/auth/resend-confirmation')).toBe(true)
})
```

**Verify:** `pnpm test:e2e` — 7 passed. `register.spec.ts` is complete.

## Step 11 — Second spec file: confirm, one scenario at a time

`e2e/confirm.spec.ts`. Add and run each `test()` below one at a time the same way as Steps 7–10 — write it, run `pnpm test:e2e -g "<its name>"`, confirm it passes, then add the next.

```ts
import { expect, test } from '@playwright/test'

const MOCK = 'http://localhost:4010'
const okToken = 'ok_' + 'a'.repeat(41)
const expiredToken = 'expired_' + 'a'.repeat(40)
const usedToken = 'used_' + 'a'.repeat(40)

test.beforeEach(async ({ request }) => {
  await request.post(`${MOCK}/__reset`)
})

test('visiting the link does not consume the token', async ({ page, request }) => {
  await page.goto(`/confirm-email?token=${okToken}`)
  await expect(page.getByRole('button', { name: 'Confirm email' })).toBeVisible()
  const recorded = await (await request.get(`${MOCK}/__requests`)).json()
  expect(recorded).toHaveLength(0)
})

test('clicking confirm shows the confirmed state', async ({ page }) => {
  await page.goto(`/confirm-email?token=${okToken}`)
  await page.getByRole('button', { name: 'Confirm email' }).click()
  await expect(page.getByRole('heading', { name: 'Email confirmed' })).toBeVisible()
  await expect(page.locator('[data-state="confirmed"]')).toBeVisible()
})

test('an already-used token shows already confirmed', async ({ page }) => {
  await page.goto(`/confirm-email?token=${usedToken}`)
  await page.getByRole('button', { name: 'Confirm email' }).click()
  await expect(page.getByRole('heading', { name: 'Already confirmed' })).toBeVisible()
})

test('an expired token offers resend, which reaches the backend', async ({ page, request }) => {
  await page.goto(`/confirm-email?token=${expiredToken}`)
  await page.getByRole('button', { name: 'Confirm email' }).click()
  await expect(page.getByRole('heading', { name: 'This link has expired' })).toBeVisible()
  await page.getByLabel('Email').fill('ren@x.test')
  await page.getByRole('button', { name: 'Send a new link' }).click()
  const recorded = await (await request.get(`${MOCK}/__requests`)).json()
  expect(recorded.some((r: { url: string }) => r.url === '/auth/resend-confirmation')).toBe(true)
})

test('a missing or malformed token shows invalid with no confirm button', async ({ page }) => {
  await page.goto('/confirm-email?token=abc')
  await expect(page.getByRole('heading', { name: "This link doesn't work" })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Confirm email' })).toHaveCount(0)
})

test('reduced motion disables the panel transition', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(`/confirm-email?token=${okToken}`)
  const transition = await page.locator('.twin-panel').evaluate((el) => getComputedStyle(el).transitionDuration)
  expect(transition).toBe('0s')
})
```

**Verify:** `pnpm test:e2e` (full suite) — 13 passed (7 from register, 6 from confirm).

## Step 12 — Accessibility spec **(optional)**

```ts
// e2e/a11y.spec.ts
import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

test('register has no serious or critical accessibility violations', async ({ page }) => {
  await page.goto('/register')
  const results = await new AxeBuilder({ page }).analyze()
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(serious).toEqual([])
})
```

Requires `pnpm add -D @axe-core/playwright`. **Verify:** `pnpm test:e2e -g accessibility` — passes. Until this exists, do the keyboard/screen-reader pass manually (Step 15).

## Step 13 — CI

`.github/workflows/ci.yml`:

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
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm format:check
      - run: pnpm test
      - run: pnpm audit
      - run: pnpm exec playwright install --with-deps chromium
      - run: pnpm test:e2e
        env: { CI: true }
      - uses: actions/upload-artifact@v4
        if: failure()
        with: { name: playwright-report, path: playwright-report }
```

No `.env` file is needed in CI: `webServer.env` in the Playwright config supplies everything, and `next build` must succeed without one.

**Verify:** push this on a branch (or run each `run:` line locally in order) and confirm every step passes before merging.

## Step 14 — Package scripts

Confirm `package.json` (from `01`) already has `test`, `test:e2e`, `lint`, `typecheck`, `format:check`, `audit` — if any are missing, add them now; every step above assumed they exist.

**Verify:** `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test && pnpm build && pnpm test:e2e` — all pass in one run, in that order.

## Step 15 — Manual QA (once per screen)

- [ ] Keyboard only, no mouse: complete register → check-email → resend, and confirm-email → confirmed.
- [ ] Screen reader (VoiceOver or NVDA): labels read, errors announced on submit, confirmed heading announced after click.
- [ ] 360px wide and 200% browser zoom: no horizontal scroll.
- [ ] Dark mode: every token pair still legible.
- [ ] `prefers-reduced-motion`: no panel transition; buttons still change shadow on press.
- [ ] Lighthouse on `/register` (mobile): Accessibility ≥ 95, Best Practices ≥ 95, no CSP console violations.
- [ ] Compare the screens with `06`'s "Reviewed against the generic default" — fix anything that drifted toward the rejected column.

## Do not

- Do not mock `fetch` in E2E. Use the mock backend.
- Do not mark a spec `skip` to get CI green. Fix it or delete it.
- Do not test implementation details (class names, internal state). Test roles, names, visible text, and recorded backend requests.

## Done when

- Steps 1–14 have each been run and passed, in order.
- All rows in `04` and `05`'s UI-state tables are covered by a Step 7–11 test.
- Manual QA (Step 15) is ticked.
- `02-backend-contract.md`'s checklist has been handed to the backend team and the mock backend from Steps 1–5 matches it line for line.
- No `NEXT_PUBLIC_` variable exists; `fetch(` appears only in `src/lib/api/client.ts`.
