# 03 — API layer

## Goal

One server-only module boundary through which every backend call passes: typed errors, a `fetch` wrapper with timeout + request id + Zod-parsed responses, the three auth calls, a structured logger that redacts secrets, and a rate limiter behind an interface.

## Read first

- `02-backend-contract.md` (codes, envelopes, headers — this doc implements them)
- `node_modules/next/dist/docs/01-app/02-guides/backend-for-frontend.md` ("Security → Rate limiting", "Verify payloads")
- `node_modules/next/dist/docs/01-app/02-guides/data-security.md`

## Do

### 1. Errors — `src/lib/errors/index.ts`

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

No `'server-only'` here on purpose: error *classes* are safe to import from client components for `instanceof` checks in tests. Anything that constructs a network call is server-only.

### 2. Logger — `src/lib/logger.ts`

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

One JSON object per line. Swap `write` for a Sentry/OTel transport later without touching callers. Always pass `requestId` in `fields`.

### 3. Backend client — `src/lib/api/client.ts`

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
  let json: unknown = undefined
  if (text) {
    try {
      json = JSON.parse(text)
    } catch {
      json = undefined
    }
  }

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

Properties this guarantees, in order: timeout, no retry, request id on the wire, secrets never logged (the body is never logged), every response validated, every failure is an `AppError` subclass.

### 4. Auth calls — `src/lib/api/auth.ts`

```ts
import 'server-only'
import { z } from 'zod'
import { backendRequest } from './client'

const RegisterResponse = z.object({ userId: z.string() })
const ConfirmResponse = z.object({ status: z.enum(['confirmed', 'already_confirmed']) })

export type RegisterInput = { email: string; password: string; displayName: string }
type Meta = { requestId: string }

export function registerUser(input: RegisterInput, meta: Meta & { idempotencyKey: string }) {
  return backendRequest({
    method: 'POST',
    path: '/auth/register',
    body: input,
    schema: RegisterResponse,
    ...meta,
  })
}

export function confirmEmail(token: string, meta: Meta) {
  return backendRequest({
    method: 'POST',
    path: '/auth/confirm-email',
    body: { token },
    schema: ConfirmResponse,
    ...meta,
  })
}

export async function resendConfirmation(email: string, meta: Meta): Promise<void> {
  await backendRequest({
    method: 'POST',
    path: '/auth/resend-confirmation',
    body: { email },
    schema: z.unknown(),
    ...meta,
  })
}
```

These are the only three functions the rest of the app may call to reach the backend.

### 5. Rate limiter — `src/lib/rate-limit.ts`

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

The `globalThis` assignment keeps one instance across dev hot reloads. This limiter is per-process: on serverless or multi-instance hosting each instance counts separately. That is acceptable because the **backend is the real limit** (`02`). When you have Redis/Upstash, implement `RateLimiter` against it and swap the export; callers do not change.

### 6. Site config — `src/config/site.ts`

```ts
export const site = {
  name: 'Lively',
  description: 'Post, follow, and find your people.',
} as const
```

### 7. Unit tests (write them now, run them in `07`)

`src/lib/errors/index.test.ts`
- each `code` maps to its class and status; unknown code → `UpstreamError` with `requestId` preserved.

`src/lib/api/client.test.ts` (stub `globalThis.fetch` with `vi.fn`; set env via `vi.stubEnv`)
- sends `x-request-id`, `idempotency-key`, `authorization` when key set, none when unset
- `fetch` rejects (simulate `AbortSignal.timeout`) → `UpstreamError`
- 409 with envelope → `ConflictError`; 500 with HTML body → `UpstreamError`
- 200 with wrong shape → `UpstreamError`; 200 with right shape → typed data
- never calls `fetch` twice for one request (no retry)

`src/lib/rate-limit.test.ts`
- allows `limit` calls, blocks the next, `retryAfterMs` > 0, allows again after `windowMs` (use `vi.useFakeTimers`)

`vi.mock('server-only', () => ({}))` in `vitest.setup.ts` so these modules import under jsdom/node.

## Do not

- Do not add retries to `backendRequest`. If a GET-only caller ever needs them, add a separate opt-in, never for POST.
- Do not log request or response bodies. Log status, path, duration, request id.
- Do not `throw` plain `Error` from this layer. Every failure is an `AppError` so Server Actions can `instanceof` it.
- Do not read `process.env` anywhere except `src/lib/env.ts`.

## Done when

- `pnpm typecheck` passes with the new modules and no `any`.
- The unit tests above pass.
- Grep confirms `fetch(` appears in exactly one file under `src/` (`lib/api/client.ts`).
