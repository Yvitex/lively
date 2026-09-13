# 03 — API layer

## Goal

One server-only module boundary through which every backend call passes: typed errors, a `fetch` wrapper with timeout + request id + Zod-parsed responses, the three auth calls, a structured logger that redacts secrets, and a rate limiter behind an interface.

This doc is organized as small steps. Each step adds one piece and ends with something you run to prove it works before moving to the next. Do not skip a verify — a later step assumes the previous one actually passes.

## Read first

- `02-backend-contract.md` (codes, envelopes, headers — this doc implements them)
- `node_modules/next/dist/docs/01-app/02-guides/backend-for-frontend.md` ("Security → Rate limiting", "Verify payloads")
- `node_modules/next/dist/docs/01-app/02-guides/data-security.md`
- `node_modules/next/dist/docs/01-app/02-guides/testing/vitest.md`

## Step 1 — Test runner

Every later step in this doc (and in `04`, `05`, `06`) ends with a Vitest run. Set that up first so those verifies are real.

`vitest.config.mts`:

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: { environment: 'jsdom', setupFiles: ['./vitest.setup.ts'], include: ['src/**/*.test.{ts,tsx}'] },
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

`vi.mock('server-only', …)` is what lets `import 'server-only'` modules (from `01`) load under Vitest's Node/jsdom environment instead of failing the build-only guard.

**Verify:** create a throwaway `src/lib/sanity.test.ts` with `test('runs', () => expect(1).toBe(1))`, run `pnpm test`. It should report 1 passed. Delete the file once it passes — it was only there to prove the runner works.

## Step 2 — Error taxonomy

One concern: a small class hierarchy every other module throws instead of a plain `Error`, plus the function that maps a backend error envelope onto it.

`src/lib/errors/index.ts`:

```ts
type AppErrorOptions = { cause?: unknown; requestId?: string }

export class AppError extends Error {
  readonly code: string
  readonly status: number
  readonly requestId: string | undefined

  constructor(code: string, status: number, message: string, options: AppErrorOptions = {}) {
    super(message, { cause: options.cause })
    this.name = new.target.name
    this.code = code
    this.status = status
    this.requestId = options.requestId
  }
}

export class ValidationError extends AppError {
  readonly fields: Record<string, string[]> | undefined
  constructor(fields?: Record<string, string[]>, requestId?: string) {
    super('VALIDATION', 422, 'validation failed', { requestId })
    this.fields = fields
  }
}

export class ConflictError extends AppError {
  constructor(requestId?: string) {
    super('EMAIL_TAKEN', 409, 'email already registered', { requestId })
  }
}

export class TokenExpiredError extends AppError {
  constructor(requestId?: string) {
    super('TOKEN_EXPIRED', 410, 'confirmation token expired', { requestId })
  }
}

export class TokenInvalidError extends AppError {
  constructor(requestId?: string) {
    super('TOKEN_INVALID', 400, 'confirmation token invalid', { requestId })
  }
}

export class RateLimitedError extends AppError {
  constructor(requestId?: string) {
    super('RATE_LIMITED', 429, 'rate limited', { requestId })
  }
}

export class UpstreamError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super('UPSTREAM', 502, message, options)
  }
}

export type ErrorEnvelope = {
  code: string
  message: string
  requestId?: string
  fields?: Record<string, string[]>
}

export function mapErrorEnvelope(status: number, envelope: ErrorEnvelope): AppError {
  switch (envelope.code) {
    case 'EMAIL_TAKEN':
      return new ConflictError(envelope.requestId)
    case 'VALIDATION':
      return new ValidationError(envelope.fields, envelope.requestId)
    case 'TOKEN_EXPIRED':
      return new TokenExpiredError(envelope.requestId)
    case 'TOKEN_INVALID':
      return new TokenInvalidError(envelope.requestId)
    case 'RATE_LIMITED':
      return new RateLimitedError(envelope.requestId)
    default:
      return new UpstreamError(`backend responded ${status} ${envelope.code}`, {
        requestId: envelope.requestId,
      })
  }
}
```

No `'server-only'` here on purpose: the error *classes* are safe to import from a client component for an `instanceof` check.

`src/lib/errors/index.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { ConflictError, mapErrorEnvelope, UpstreamError, ValidationError } from './index'

describe('mapErrorEnvelope', () => {
  test('maps EMAIL_TAKEN to ConflictError', () => {
    expect(mapErrorEnvelope(409, { code: 'EMAIL_TAKEN', message: 'x' })).toBeInstanceOf(ConflictError)
  })
  test('maps VALIDATION to ValidationError and keeps fields', () => {
    const err = mapErrorEnvelope(422, { code: 'VALIDATION', message: 'x', fields: { email: ['bad'] } })
    expect(err).toBeInstanceOf(ValidationError)
    expect((err as ValidationError).fields).toEqual({ email: ['bad'] })
  })
  test('unknown code becomes UpstreamError and preserves requestId', () => {
    const err = mapErrorEnvelope(500, { code: 'WEIRD', message: 'x', requestId: 'req_1' })
    expect(err).toBeInstanceOf(UpstreamError)
    expect(err.requestId).toBe('req_1')
  })
})
```

**Verify:** `pnpm test src/lib/errors` — 3 tests pass.

## Step 3 — Structured logger

`src/lib/logger.ts`:

```ts
import 'server-only'

type Level = 'info' | 'warn' | 'error'
type Fields = Record<string, unknown>

const REDACTED_KEYS = new Set(['password', 'token', 'authorization', 'idempotencykey', 'cookie'])

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== 'object') return value
  if (value instanceof Error) {
    return { name: value.name, message: value.message, cause: redact(value.cause, depth + 1) }
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1))
  return Object.fromEntries(
    Object.entries(value as Fields).map(([k, v]) => [
      k,
      REDACTED_KEYS.has(k.toLowerCase()) ? '[redacted]' : redact(v, depth + 1),
    ]),
  )
}

function write(level: Level, msg: string, fields: Fields = {}) {
  const line = JSON.stringify({ level, msg, ts: new Date().toISOString(), ...(redact(fields) as Fields) })
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export const logger = {
  info: (msg: string, fields?: Fields) => write('info', msg, fields),
  warn: (msg: string, fields?: Fields) => write('warn', msg, fields),
  error: (msg: string, fields?: Fields) => write('error', msg, fields),
}
```

`src/lib/logger.test.ts`:

```ts
import { afterEach, expect, test, vi } from 'vitest'
import { logger } from './logger'

afterEach(() => vi.restoreAllMocks())

test('redacts secret fields before logging', () => {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
  logger.error('register_failed', { requestId: 'req_1', password: 'hunter2', nested: { token: 'abc' } })
  const line = spy.mock.calls[0]?.[0] as string
  expect(line).not.toContain('hunter2')
  expect(line).not.toContain('abc')
  expect(JSON.parse(line).nested.token).toBe('[redacted]')
})
```

**Verify:** `pnpm test src/lib/logger` — passes, and manually eyeball the assertion: it fails loudly if a raw secret ever leaks into a log line.

## Step 4 — Rate limiter

`src/lib/rate-limit.ts`:

```ts
import 'server-only'
import { headers } from 'next/headers'

export type RateLimitOptions = { limit: number; windowMs: number }
export type RateLimitResult = { ok: boolean; retryAfterMs: number }

export interface RateLimiter {
  check(key: string, options: RateLimitOptions): Promise<RateLimitResult>
}

class MemoryRateLimiter implements RateLimiter {
  private hits = new Map<string, number[]>()

  async check(key: string, { limit, windowMs }: RateLimitOptions): Promise<RateLimitResult> {
    const now = Date.now()
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < windowMs)
    if (recent.length >= limit) {
      const oldest = recent[0] ?? now
      return { ok: false, retryAfterMs: windowMs - (now - oldest) }
    }
    recent.push(now)
    this.hits.set(key, recent)
    if (this.hits.size > 10_000) this.sweep(now, windowMs)
    return { ok: true, retryAfterMs: 0 }
  }

  private sweep(now: number, windowMs: number) {
    for (const [k, times] of this.hits) {
      if (times.every((t) => now - t >= windowMs)) this.hits.delete(k)
    }
  }
}

declare global {
  var __livelyRateLimiter: RateLimiter | undefined
}

export const rateLimiter: RateLimiter = (globalThis.__livelyRateLimiter ??= new MemoryRateLimiter())

export async function getClientIp(): Promise<string> {
  const h = await headers()
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || 'unknown'
}
```

This limiter is per-process: on serverless or multi-instance hosting each instance counts separately. That is acceptable because the **backend is the real limit** (`02`) — this is defense in depth, not the enforcement point.

`src/lib/rate-limit.test.ts`:

```ts
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { MemoryRateLimiterForTest } from './rate-limit.testutil'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

test('allows up to the limit, blocks the next, allows again after the window', async () => {
  const limiter = new MemoryRateLimiterForTest()
  for (let i = 0; i < 3; i++) {
    expect((await limiter.check('k', { limit: 3, windowMs: 1000 })).ok).toBe(true)
  }
  const blocked = await limiter.check('k', { limit: 3, windowMs: 1000 })
  expect(blocked.ok).toBe(false)
  expect(blocked.retryAfterMs).toBeGreaterThan(0)

  vi.advanceTimersByTime(1001)
  expect((await limiter.check('k', { limit: 3, windowMs: 1000 })).ok).toBe(true)
})
```

The class under test is not exported from `rate-limit.ts` (only the singleton `rateLimiter` is, to keep one shared instance app-wide). Export a second, test-only entry point next to it — `src/lib/rate-limit.testutil.ts`:

```ts
export { MemoryRateLimiter as MemoryRateLimiterForTest } from './rate-limit'
```

which requires changing `class MemoryRateLimiter` in `rate-limit.ts` to `export class MemoryRateLimiter`. Make that one-word change now.

**Verify:** `pnpm test src/lib/rate-limit` — passes, including the fake-timer advance.

## Step 5 — Backend client, part 1: timeout and transport

This is the file every backend call goes through, and it is the one place in this doc that several concerns get wired together (env, headers, error mapping, schema validation, logging). Build it in four small additions rather than all at once — each one adds a capability and gets its own test run before the next.

First cut: send the request, enforce the timeout, surface network failures as `UpstreamError`. No headers beyond content-type yet, no error-envelope parsing, no response validation.

`src/lib/api/client.ts`:

```ts
import 'server-only'
import { env } from '@/lib/env'
import { UpstreamError } from '@/lib/errors'

type BackendRequest = { method: 'POST'; path: `/${string}`; body: unknown }

export async function backendRequest(req: BackendRequest): Promise<unknown> {
  const url = new URL(req.path, env.BACKEND_API_URL)
  try {
    const res = await fetch(url, {
      method: req.method,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(env.REQUEST_TIMEOUT_MS),
      cache: 'no-store',
    })
    return await res.json().catch(() => undefined)
  } catch (cause) {
    throw new UpstreamError('backend unreachable or timed out', { cause })
  }
}
```

`src/lib/api/client.test.ts`:

```ts
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { UpstreamError } from '@/lib/errors'
import { backendRequest } from './client'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => vi.unstubAllGlobals())

test('returns parsed JSON on success', async () => {
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
  await expect(backendRequest({ method: 'POST', path: '/x', body: {} })).resolves.toEqual({ ok: true })
})

test('wraps a network failure as UpstreamError', async () => {
  vi.mocked(fetch).mockRejectedValue(new Error('boom'))
  await expect(backendRequest({ method: 'POST', path: '/x', body: {} })).rejects.toBeInstanceOf(UpstreamError)
})
```

**Verify:** `pnpm test src/lib/api/client` — both pass.

## Step 6 — Backend client, part 2: identifying headers

Add `x-request-id`, `idempotency-key`, and the optional service-key `authorization` header. This is an addition to the same file, not a rewrite — only the header block and the function signature change.

In `src/lib/api/client.ts`, change the `BackendRequest` type and the `fetch` call:

```ts
type BackendRequest = {
  method: 'POST'
  path: `/${string}`
  body: unknown
  requestId: string
  idempotencyKey?: string
}

export async function backendRequest(req: BackendRequest): Promise<unknown> {
  const url = new URL(req.path, env.BACKEND_API_URL)
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    accept: 'application/json',
    'x-request-id': req.requestId,
  })
  if (env.BACKEND_API_KEY) headers.set('authorization', `Bearer ${env.BACKEND_API_KEY}`)
  if (req.idempotencyKey) headers.set('idempotency-key', req.idempotencyKey)

  try {
    const res = await fetch(url, {
      method: req.method,
      headers,
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(env.REQUEST_TIMEOUT_MS),
      cache: 'no-store',
    })
    return await res.json().catch(() => undefined)
  } catch (cause) {
    throw new UpstreamError('backend unreachable or timed out', { cause })
  }
}
```

Update the two existing test calls to pass `requestId: 'req_1'` (now required), and add:

```ts
test('sends x-request-id and idempotency-key', async () => {
  vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 200 }))
  await backendRequest({ method: 'POST', path: '/x', body: {}, requestId: 'req_1', idempotencyKey: 'idem_1' })
  const sentHeaders = vi.mocked(fetch).mock.calls[0]?.[1]?.headers as Headers
  expect(sentHeaders.get('x-request-id')).toBe('req_1')
  expect(sentHeaders.get('idempotency-key')).toBe('idem_1')
})
```

**Verify:** `pnpm test src/lib/api/client` — 3 pass.

## Step 7 — Backend client, part 3: error envelope mapping

Add: on a non-2xx response, parse the `{code, message, requestId, fields}` envelope from `02` and throw the matching `AppError` from Step 2.

```ts
import { z } from 'zod'
import { mapErrorEnvelope, UpstreamError } from '@/lib/errors'

const ErrorEnvelopeSchema = z.object({
  code: z.string(),
  message: z.string(),
  requestId: z.string().optional(),
  fields: z.record(z.string(), z.array(z.string())).optional(),
})

// inside backendRequest, replace the plain `return await res.json()...` line with:
const text = await res.text()
const json = text ? JSON.parse(text) : undefined

if (!res.ok) {
  const envelope = ErrorEnvelopeSchema.safeParse(json)
  if (envelope.success) throw mapErrorEnvelope(res.status, envelope.data)
  throw new UpstreamError(`backend responded ${res.status} without an error envelope`, {
    requestId: req.requestId,
  })
}

return json
```

Add tests:

```ts
test('maps a 409 envelope to ConflictError', async () => {
  vi.mocked(fetch).mockResolvedValue(
    new Response(JSON.stringify({ code: 'EMAIL_TAKEN', message: 'x' }), { status: 409 }),
  )
  await expect(
    backendRequest({ method: 'POST', path: '/x', body: {}, requestId: 'req_1' }),
  ).rejects.toBeInstanceOf(ConflictError)
})

test('a non-2xx without an envelope becomes UpstreamError', async () => {
  vi.mocked(fetch).mockResolvedValue(new Response('<html>502</html>', { status: 502 }))
  await expect(
    backendRequest({ method: 'POST', path: '/x', body: {}, requestId: 'req_1' }),
  ).rejects.toBeInstanceOf(UpstreamError)
})
```

(Add `ConflictError` to the existing `@/lib/errors` import in the test file.)

**Verify:** `pnpm test src/lib/api/client` — 5 pass.

## Step 8 — Backend client, part 4: response schema + logging

Final addition: every caller supplies a Zod schema; a response that doesn't match it is treated as `UpstreamError` rather than handed to the caller unchecked. Also log status and duration (never the body).

```ts
import { logger } from '@/lib/logger'

type BackendRequest<T> = {
  method: 'POST'
  path: `/${string}`
  body: unknown
  schema: z.ZodType<T>
  requestId: string
  idempotencyKey?: string
}

export async function backendRequest<T>(req: BackendRequest<T>): Promise<T> {
  // ...unchanged setup...
  const startedAt = performance.now()
  // ...unchanged fetch + envelope handling from steps 5-7...
  const durationMs = Math.round(performance.now() - startedAt)
  logger.info('backend_response', { requestId: req.requestId, path: req.path, status: res.status, durationMs })

  const parsed = req.schema.safeParse(json)
  if (!parsed.success) {
    logger.error('backend_response_shape', { requestId: req.requestId, path: req.path, issues: parsed.error.issues })
    throw new UpstreamError('backend response did not match schema', { requestId: req.requestId })
  }
  return parsed.data
}
```

Fold this in around the code from steps 5–7 (timing starts before the `fetch`, the schema check replaces the bare `return json`). The full assembled file, for reference once all four parts are in:

```ts
import 'server-only'
import { z } from 'zod'
import { env } from '@/lib/env'
import { logger } from '@/lib/logger'
import { mapErrorEnvelope, UpstreamError } from '@/lib/errors'

const ErrorEnvelopeSchema = z.object({
  code: z.string(),
  message: z.string(),
  requestId: z.string().optional(),
  fields: z.record(z.string(), z.array(z.string())).optional(),
})

type BackendRequest<T> = {
  method: 'POST'
  path: `/${string}`
  body: unknown
  schema: z.ZodType<T>
  requestId: string
  idempotencyKey?: string
}

export async function backendRequest<T>(req: BackendRequest<T>): Promise<T> {
  const url = new URL(req.path, env.BACKEND_API_URL)
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    accept: 'application/json',
    'x-request-id': req.requestId,
  })
  if (env.BACKEND_API_KEY) headers.set('authorization', `Bearer ${env.BACKEND_API_KEY}`)
  if (req.idempotencyKey) headers.set('idempotency-key', req.idempotencyKey)

  const startedAt = performance.now()
  let res: Response
  try {
    res = await fetch(url, {
      method: req.method,
      headers,
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(env.REQUEST_TIMEOUT_MS),
      cache: 'no-store',
    })
  } catch (cause) {
    logger.error('backend_unreachable', { requestId: req.requestId, path: req.path, cause })
    throw new UpstreamError('backend unreachable or timed out', { cause, requestId: req.requestId })
  }

  const durationMs = Math.round(performance.now() - startedAt)
  const text = await res.text()
  const json = text ? JSON.parse(text) : undefined

  logger.info('backend_response', { requestId: req.requestId, path: req.path, status: res.status, durationMs })

  if (!res.ok) {
    const envelope = ErrorEnvelopeSchema.safeParse(json)
    if (envelope.success) throw mapErrorEnvelope(res.status, envelope.data)
    throw new UpstreamError(`backend responded ${res.status} without an error envelope`, {
      requestId: req.requestId,
    })
  }

  const parsed = req.schema.safeParse(json)
  if (!parsed.success) {
    logger.error('backend_response_shape', { requestId: req.requestId, path: req.path, issues: parsed.error.issues })
    throw new UpstreamError('backend response did not match schema', { requestId: req.requestId })
  }
  return parsed.data
}
```

Add the last two tests (update the earlier ones to pass `schema: z.object({ ok: z.boolean() })` / `schema: z.unknown()` as appropriate):

```ts
test('a response that does not match the schema becomes UpstreamError', async () => {
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ nope: true }), { status: 200 }))
  await expect(
    backendRequest({ method: 'POST', path: '/x', body: {}, schema: z.object({ ok: z.boolean() }), requestId: 'req_1' }),
  ).rejects.toBeInstanceOf(UpstreamError)
})
```

**Verify:** `pnpm test src/lib/api/client` — all tests pass. Grep the file: `fetch(` should appear exactly once in `src/`.

## Step 9 — Auth calls: register

Now that the client is complete, add the three typed functions the rest of the app calls. One at a time.

`src/lib/api/auth.ts`:

```ts
import 'server-only'
import { z } from 'zod'
import { backendRequest } from './client'

const RegisterResponse = z.object({ userId: z.string() })

export type RegisterInput = { email: string; password: string; displayName: string }
type Meta = { requestId: string }

export function registerUser(input: RegisterInput, meta: Meta & { idempotencyKey: string }) {
  return backendRequest({ method: 'POST', path: '/auth/register', body: input, schema: RegisterResponse, ...meta })
}
```

`src/lib/api/auth.test.ts`:

```ts
import { expect, test, vi } from 'vitest'
import { backendRequest } from './client'
import { registerUser } from './auth'

vi.mock('./client', () => ({ backendRequest: vi.fn() }))

test('registerUser posts to /auth/register with the given meta', async () => {
  vi.mocked(backendRequest).mockResolvedValue({ userId: 'usr_1' })
  const result = await registerUser(
    { email: 'a@b.com', password: 'x'.repeat(10), displayName: 'A' },
    { requestId: 'req_1', idempotencyKey: 'idem_1' },
  )
  expect(result).toEqual({ userId: 'usr_1' })
  expect(backendRequest).toHaveBeenCalledWith(
    expect.objectContaining({ path: '/auth/register', requestId: 'req_1', idempotencyKey: 'idem_1' }),
  )
})
```

**Verify:** `pnpm test src/lib/api/auth` — passes.

## Step 10 — Auth calls: confirm and resend

Add the remaining two functions and their tests.

```ts
const ConfirmResponse = z.object({ status: z.enum(['confirmed', 'already_confirmed']) })

export function confirmEmail(token: string, meta: Meta) {
  return backendRequest({ method: 'POST', path: '/auth/confirm-email', body: { token }, schema: ConfirmResponse, ...meta })
}

export async function resendConfirmation(email: string, meta: Meta): Promise<void> {
  await backendRequest({ method: 'POST', path: '/auth/resend-confirmation', body: { email }, schema: z.unknown(), ...meta })
}
```

```ts
test('confirmEmail posts the token and returns the typed status', async () => {
  vi.mocked(backendRequest).mockResolvedValue({ status: 'confirmed' })
  await expect(confirmEmail('tok', { requestId: 'req_1' })).resolves.toEqual({ status: 'confirmed' })
  expect(backendRequest).toHaveBeenCalledWith(expect.objectContaining({ path: '/auth/confirm-email' }))
})

test('resendConfirmation resolves to void regardless of body shape', async () => {
  vi.mocked(backendRequest).mockResolvedValue({ anything: true })
  await expect(resendConfirmation('a@b.com', { requestId: 'req_1' })).resolves.toBeUndefined()
})
```

**Verify:** `pnpm test src/lib/api/auth` — 3 pass. These three functions (`registerUser`, `confirmEmail`, `resendConfirmation`) are the only way the rest of the app may reach the backend.

## Step 11 — Site config

One line, no wiring, no test needed beyond `pnpm typecheck`.

`src/config/site.ts`:

```ts
export const site = { name: 'Lively', description: 'Post, follow, and find your people.' } as const
```

## Do not

- Do not add retries to `backendRequest`. If a GET-only caller ever needs them, add a separate opt-in, never for POST.
- Do not log request or response bodies. Log status, path, duration, request id.
- Do not `throw` plain `Error` from this layer. Every failure is an `AppError` so Server Actions can `instanceof` it.
- Do not read `process.env` anywhere except `src/lib/env.ts`.

## Done when

- `pnpm typecheck` passes with no `any`.
- `pnpm test src/lib` passes end to end (errors, logger, rate-limit, client, auth — every step above).
- `fetch(` appears in exactly one file under `src/`.
