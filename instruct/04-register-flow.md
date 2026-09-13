# 04 — Register flow

## Goal

`/register` — a form that creates an account through the backend and lands on `/register/check-email`, with every state handled and the visual language from `06`.

`src/features/auth/actions.ts` is a wiring file: it pulls together rate limiting, validation, the API layer, cookies and redirects. It is built in small additions in this doc, and `05` adds one more function to it later — never reprint the whole file at that point, only the diff.

## Read first

- `06-design-system.md` (components, tokens, copy rules)
- `02-backend-contract.md` (`POST /auth/register`, `POST /auth/resend-confirmation`)
- `node_modules/next/dist/docs/01-app/02-guides/forms.md`
- `node_modules/next/dist/docs/01-app/01-getting-started/07-mutating-data.md`
- `node_modules/next/dist/docs/01-app/02-guides/server-actions.md` ("Security")
- `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/cookies.md`, `connection.md`

## Overall flow (reference — build it in the steps below)

```text
GET /register ──► form (idle)
                    │ submit
                    ▼
        registerAction (Server Action)
          honeypot? ──yes──► redirect /register/check-email (silent)
          rate-check ──fail──► formError
          Zod ──fail──► fieldErrors (+ keep typed values)
          registerUser()
            409 ──► fieldErrors.email + sign-in link
            422 ──► fieldErrors from backend or formError
            429 ──► formError
            UPSTREAM ──► formError + reference id
            201 ──► set pending-email cookie ──► redirect /register/check-email
```

## Step 1 — Validation schema

Single concern, shared by client and server. No `'server-only'` here.

`src/features/auth/validation.ts`:

```ts
import { z } from 'zod'

export const RegisterSchema = z.object({
  displayName: z
    .string({ error: 'Enter a display name.' })
    .trim()
    .min(2, { error: 'Use 2 to 40 characters.' })
    .max(40, { error: 'Use 2 to 40 characters.' }),
  email: z
    .email({ error: 'Enter a valid email address.' })
    .max(254, { error: 'Enter a valid email address.' })
    .transform((v) => v.toLowerCase()),
  password: z
    .string({ error: 'Enter a password.' })
    .min(10, { error: 'Use at least 10 characters.' })
    .max(128, { error: 'Use 128 characters or fewer.' }),
})

export type RegisterInput = z.infer<typeof RegisterSchema>
export type RegisterField = keyof RegisterInput

export const EmailSchema = RegisterSchema.shape.email

export const TokenSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43,256}$/, { error: 'This link is not valid.' })
```

`TokenSchema` is used by `05`, not this doc — defined here because it lives in the same shared file.

`src/features/auth/validation.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { RegisterSchema, TokenSchema } from './validation'

describe('RegisterSchema', () => {
  test('trims display name and lowercases email', () => {
    const result = RegisterSchema.parse({ displayName: '  Ren  ', email: 'REN@Example.com', password: 'x'.repeat(10) })
    expect(result.displayName).toBe('Ren')
    expect(result.email).toBe('ren@example.com')
  })
  test('rejects a 9-character password, accepts 10', () => {
    expect(RegisterSchema.safeParse({ displayName: 'Ren', email: 'a@b.com', password: 'x'.repeat(9) }).success).toBe(false)
    expect(RegisterSchema.safeParse({ displayName: 'Ren', email: 'a@b.com', password: 'x'.repeat(10) }).success).toBe(true)
  })
  test('rejects a malformed email', () => {
    expect(RegisterSchema.safeParse({ displayName: 'Ren', email: 'not-an-email', password: 'x'.repeat(10) }).success).toBe(false)
  })
})

describe('TokenSchema', () => {
  test('accepts 43 base64url characters, rejects 42', () => {
    expect(TokenSchema.safeParse('a'.repeat(43)).success).toBe(true)
    expect(TokenSchema.safeParse('a'.repeat(42)).success).toBe(false)
  })
  test('rejects characters outside base64url', () => {
    expect(TokenSchema.safeParse('a'.repeat(42) + '+').success).toBe(false)
  })
})
```

**Verify:** `pnpm test src/features/auth/validation` — 5 pass.

## Step 2 — `registerAction`, addition 1: honeypot + shape

Start `src/features/auth/actions.ts`. At this point it does nothing with the backend yet — just the spam trap and reading the form.

```ts
'use server'

import { redirect } from 'next/navigation'
import { RegisterSchema } from './validation'

export type RegisterState = {
  fieldErrors?: Partial<Record<keyof import('./validation').RegisterInput, string[]>>
  formError?: string
  referenceId?: string
  values?: { displayName: string; email: string }
}

export async function registerAction(_prev: RegisterState, formData: FormData): Promise<RegisterState> {
  if (formData.get('website')) redirect('/register/check-email')

  const values = {
    displayName: String(formData.get('displayName') ?? ''),
    email: String(formData.get('email') ?? ''),
  }
  return { values }
}
```

`src/features/auth/actions.test.ts`:

```ts
import { expect, test } from 'vitest'
import { registerAction } from './actions'

function form(fields: Record<string, string>) {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

test('a filled honeypot redirects silently without validating anything', async () => {
  await expect(
    registerAction({}, form({ website: 'http://spam.example', email: 'not-an-email' })),
  ).rejects.toThrow('NEXT_REDIRECT')
})

test('a real submission returns the typed values so far', async () => {
  const result = await registerAction({}, form({ displayName: 'Ren', email: 'REN@x.com' }))
  expect(result.values).toEqual({ displayName: 'Ren', email: 'REN@x.com' })
})
```

`redirect()` throws a special `NEXT_REDIRECT` error by design — asserting on that is the correct way to test it here.

**Verify:** `pnpm test src/features/auth/actions` — 2 pass.

## Step 3 — addition 2: rate limiting

Add the rate check right after the honeypot, before anything else runs.

```ts
import { getClientIp, rateLimiter } from '@/lib/rate-limit'

const RATE_LIMIT_MESSAGE = 'Too many attempts. Wait a minute, then try again.'

// inside registerAction, after the honeypot check and before `const values = ...`:
const ip = await getClientIp()
const limit = await rateLimiter.check(`register:${ip}`, { limit: 5, windowMs: 60_000 })
if (!limit.ok) return { formError: RATE_LIMIT_MESSAGE }
```

Add a test that exhausts the limiter. `getClientIp` reads `next/headers`, which needs a request context Vitest doesn't provide by default — mock it:

```ts
vi.mock('@/lib/rate-limit', async () => {
  const actual = await vi.importActual<typeof import('@/lib/rate-limit')>('@/lib/rate-limit')
  return { ...actual, getClientIp: vi.fn().mockResolvedValue('1.2.3.4') }
})

test('the 6th rapid submission is rate limited', async () => {
  for (let i = 0; i < 5; i++) await registerAction({}, form({ displayName: 'Ren', email: 'ren@x.com' }))
  const sixth = await registerAction({}, form({ displayName: 'Ren', email: 'ren@x.com' }))
  expect(sixth.formError).toBe('Too many attempts. Wait a minute, then try again.')
})
```

(Add the `vi.mock` and the `vi` import at the top of `actions.test.ts`, alongside the existing imports.)

**Verify:** `pnpm test src/features/auth/actions` — 3 pass.

## Step 4 — addition 3: Zod validation

```ts
import { z } from 'zod'

// after the rate-limit check:
const parsed = RegisterSchema.safeParse({
  displayName: formData.get('displayName'),
  email: formData.get('email'),
  password: formData.get('password'),
})
if (!parsed.success) return { fieldErrors: z.flattenError(parsed.error).fieldErrors, values }
```

```ts
test('an invalid email returns a field error and keeps the typed values', async () => {
  const result = await registerAction({}, form({ displayName: 'Ren', email: 'nope', password: 'x'.repeat(10) }))
  expect(result.fieldErrors?.email).toContain('Enter a valid email address.')
  expect(result.values).toEqual({ displayName: 'Ren', email: 'nope' })
})
```

**Verify:** `pnpm test src/features/auth/actions` — 4 pass. (Valid input still returns only `{ values }` for now — the backend call is the next step.)

## Step 5 — addition 4: call the backend and map errors

```ts
import { registerUser } from '@/lib/api/auth'
import { ConflictError, RateLimitedError, ValidationError } from '@/lib/errors'
import { logger } from '@/lib/logger'

// after the Zod check succeeds:
const submissionId = formData.get('submissionId')
const idempotencyKey =
  typeof submissionId === 'string' && z.uuid().safeParse(submissionId).success ? submissionId : crypto.randomUUID()
const requestId = crypto.randomUUID()

try {
  await registerUser(parsed.data, { requestId, idempotencyKey })
} catch (err) {
  if (err instanceof ConflictError) return { fieldErrors: { email: ['EMAIL_TAKEN'] }, values }
  if (err instanceof ValidationError) {
    return err.fields
      ? { fieldErrors: err.fields as RegisterState['fieldErrors'], values }
      : { formError: 'Check the details and try again.', values }
  }
  if (err instanceof RateLimitedError) return { formError: RATE_LIMIT_MESSAGE, values }
  logger.error('register_failed', { requestId, err })
  return { formError: "We couldn't create your account right now. Try again in a moment.", referenceId: requestId, values }
}

return { values } // redirect + cookie land in the next step
```

The email-taken case returns the marker string `'EMAIL_TAKEN'` rather than copy, so the form (built in Step 8) can render a link instead of plain text.

Mock the API layer to test every branch without a network call:

```ts
vi.mock('@/lib/api/auth', () => ({ registerUser: vi.fn() }))
import { registerUser } from '@/lib/api/auth'
import { ConflictError, UpstreamError, ValidationError } from '@/lib/errors'

test('a conflicting email comes back as a field-error marker', async () => {
  vi.mocked(registerUser).mockRejectedValueOnce(new ConflictError())
  const result = await registerAction({}, form({ displayName: 'Ren', email: 'ren@x.com', password: 'x'.repeat(10) }))
  expect(result.fieldErrors?.email).toEqual(['EMAIL_TAKEN'])
})

test('an upstream failure returns a safe message and a reference id', async () => {
  vi.mocked(registerUser).mockRejectedValueOnce(new UpstreamError('boom'))
  const result = await registerAction({}, form({ displayName: 'Ren', email: 'ren@x.com', password: 'x'.repeat(10) }))
  expect(result.formError).toContain("couldn't create your account")
  expect(result.referenceId).toBeTruthy()
})
```

**Verify:** `pnpm test src/features/auth/actions` — 6 pass.

## Step 6 — addition 5: cookie and redirect on success

Final piece of `registerAction`.

```ts
import { cookies } from 'next/headers'
import { env } from '@/lib/env'

export const PENDING_EMAIL_COOKIE = 'lively_pending_email'

// replace the final `return { values }` with:
const cookieStore = await cookies()
cookieStore.set(PENDING_EMAIL_COOKIE, parsed.data.email, {
  httpOnly: true,
  sameSite: 'lax',
  secure: env.NODE_ENV === 'production',
  path: '/',
  maxAge: 60 * 15,
})
redirect('/register/check-email')
```

`secure` is off outside production so the cookie still works on plain `http://localhost`. `redirect()` throws, so it must stay outside the `try/catch` from Step 5 — check the block boundaries.

```ts
test('a successful registration sets the pending-email cookie and redirects', async () => {
  vi.mocked(registerUser).mockResolvedValueOnce({ userId: 'usr_1' })
  await expect(
    registerAction({}, form({ displayName: 'Ren', email: 'REN@x.com', password: 'x'.repeat(10) })),
  ).rejects.toThrow('NEXT_REDIRECT')
})
```

(Asserting the cookie's exact value needs `next/headers`' request-scoped store, which is exercised properly in the E2E test in `07` — this unit test only proves the redirect fires.)

**Verify:** `pnpm test src/features/auth/actions` — 7 pass. `registerAction` is now complete; do not touch it again until `05` adds a second, unrelated function to the same file.

## Step 7 — `resendConfirmationAction`

A second, independent export in the same file. Small enough for one pass.

```ts
import { resendConfirmation } from '@/lib/api/auth'
import { EmailSchema } from './validation'

export type ResendState = { status: 'idle' | 'sent' | 'error'; message?: string }

export async function resendConfirmationAction(_prev: ResendState, formData: FormData): Promise<ResendState> {
  const parsed = EmailSchema.safeParse(formData.get('email'))
  if (!parsed.success) return { status: 'error', message: 'Enter a valid email address.' }

  const ip = await getClientIp()
  const limit = await rateLimiter.check(`resend:${ip}:${parsed.data}`, { limit: 3, windowMs: 15 * 60_000 })
  if (!limit.ok) return { status: 'error', message: 'Too many attempts. Wait a few minutes, then try again.' }

  const requestId = crypto.randomUUID()
  try {
    await resendConfirmation(parsed.data, { requestId })
  } catch (err) {
    if (err instanceof RateLimitedError) {
      return { status: 'error', message: 'Too many attempts. Wait a few minutes, then try again.' }
    }
    logger.error('resend_failed', { requestId, err })
  }
  return { status: 'sent' }
}
```

Returning `sent` even when the backend errors (except rate limit) is deliberate: `02` requires the response to never reveal whether the email exists, and the user's next step is identical either way.

```ts
import { resendConfirmation } from '@/lib/api/auth'
// add to the existing vi.mock('@/lib/api/auth', ...) block:
vi.mock('@/lib/api/auth', () => ({ registerUser: vi.fn(), resendConfirmation: vi.fn() }))

test('an invalid email is rejected before touching the backend', async () => {
  const result = await resendConfirmationAction({ status: 'idle' }, form({ email: 'nope' }))
  expect(result).toEqual({ status: 'error', message: 'Enter a valid email address.' })
  expect(resendConfirmation).not.toHaveBeenCalled()
})

test('a backend error still reports sent, to avoid revealing whether the email exists', async () => {
  vi.mocked(resendConfirmation).mockRejectedValueOnce(new Error('boom'))
  const result = await resendConfirmationAction({ status: 'idle' }, form({ email: 'ren@x.com' }))
  expect(result).toEqual({ status: 'sent' })
})
```

**Verify:** `pnpm test src/features/auth/actions` — 9 pass. `actions.ts` is done for this doc; `05` adds one more function to it as a diff.

## Step 8 — Register form, part 1: static markup

Build the client component before the page that renders it. First pass: labelled fields, no action wired yet, submit always enabled.

`src/features/auth/components/register-form.tsx`:

```tsx
'use client'

import { TextField } from '@/components/ui/text-field'
import { PasswordField } from '@/components/ui/password-field'
import { Button } from '@/components/ui/button'

export function RegisterForm({ submissionId }: { submissionId: string }) {
  return (
    <form className="flex flex-col gap-6" noValidate>
      <h2 className="text-display-sm font-semibold">Create your account</h2>
      <input type="hidden" name="submissionId" value={submissionId} />
      <TextField label="Display name" name="displayName" autoComplete="nickname" required maxLength={40} />
      <TextField label="Email" name="email" type="email" autoComplete="email" required />
      <PasswordField label="Password" name="password" autoComplete="new-password" required minLength={10} maxLength={128} />
      <Button type="submit">Create account</Button>
    </form>
  )
}
```

`TextField`, `PasswordField` and `Button` are specified in `06` — build those first if you have not yet (the README lists `06` before `04` for this reason).

`src/features/auth/components/register-form.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { RegisterForm } from './register-form'

test('renders the three labelled fields and the submit button', () => {
  render(<RegisterForm submissionId="sub_1" />)
  expect(screen.getByLabelText('Display name')).toBeInTheDocument()
  expect(screen.getByLabelText('Email')).toBeInTheDocument()
  expect(screen.getByLabelText('Password')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Create account' })).toBeEnabled()
})
```

**Verify:** `pnpm test src/features/auth/components/register-form` — passes.

## Step 9 — part 2: wire the Server Action and pending state

```tsx
import { useActionState } from 'react'
import { registerAction, type RegisterState } from '@/features/auth/actions'

const initialState: RegisterState = {}

export function RegisterForm({ submissionId }: { submissionId: string }) {
  const [state, formAction, pending] = useActionState(registerAction, initialState)

  return (
    <form action={formAction} className="flex flex-col gap-6" noValidate>
      {/* ...unchanged fields, using state.values as defaultValue... */}
      <Button type="submit" pending={pending} pendingLabel="Creating account…">
        Create account
      </Button>
    </form>
  )
}
```

```tsx
import { act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
vi.mock('@/features/auth/actions', () => ({ registerAction: vi.fn() }))
import { registerAction } from '@/features/auth/actions'

test('the button shows the pending label while the action runs', async () => {
  let resolveAction: (v: RegisterState) => void
  vi.mocked(registerAction).mockReturnValue(new Promise((r) => (resolveAction = r)))
  render(<RegisterForm submissionId="sub_1" />)
  await userEvent.click(screen.getByRole('button', { name: 'Create account' }))
  expect(screen.getByRole('button')).toBeDisabled()
  expect(screen.getByRole('button')).toHaveTextContent('Creating account…')
  await act(async () => resolveAction({}))
})
```

**Verify:** `pnpm test src/features/auth/components/register-form` — 2 pass.

## Step 10 — part 3: field errors and the email-taken link

```tsx
import Link from 'next/link'

const emailErrors = state.fieldErrors?.email
const emailTaken = emailErrors?.includes('EMAIL_TAKEN')

// TextField for email becomes:
<TextField
  label="Email"
  name="email"
  type="email"
  autoComplete="email"
  required
  defaultValue={state.values?.email}
  errors={
    emailTaken
      ? [<>This email already has an account. <Link href="/login" className="underline">Sign in instead</Link>.</>]
      : emailErrors
  }
/>
```

Apply the same `errors={state.fieldErrors?.X}` + `defaultValue` pattern to the other two fields, and render `state.formError` in a `FormMessage` above the button when present.

```tsx
test('an EMAIL_TAKEN field error renders a sign-in link', async () => {
  vi.mocked(registerAction).mockResolvedValueOnce({ fieldErrors: { email: ['EMAIL_TAKEN'] } })
  render(<RegisterForm submissionId="sub_1" />)
  await userEvent.click(screen.getByRole('button', { name: 'Create account' }))
  expect(await screen.findByRole('link', { name: 'Sign in instead' })).toBeInTheDocument()
})

test('a plain field error is announced next to its input', async () => {
  vi.mocked(registerAction).mockResolvedValueOnce({ fieldErrors: { displayName: ['Use 2 to 40 characters.'] } })
  render(<RegisterForm submissionId="sub_1" />)
  await userEvent.click(screen.getByRole('button', { name: 'Create account' }))
  const input = await screen.findByLabelText('Display name')
  expect(input).toHaveAttribute('aria-invalid', 'true')
})
```

`/login` does not exist yet — add a one-line stub page (`src/app/(auth)/login/page.tsx`, "Sign-in is coming soon.") now so the link is not dead. Do not build login itself.

**Verify:** `pnpm test src/features/auth/components/register-form` — 4 pass.

## Step 11 — part 4: the honeypot field

Final addition: the hidden trap field the Server Action already checks (Step 2).

```tsx
<div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
  <label htmlFor="website">Website</label>
  <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
</div>
```

```tsx
test('the honeypot field is not reachable by keyboard', () => {
  render(<RegisterForm submissionId="sub_1" />)
  expect(screen.getByLabelText('Website')).toHaveAttribute('tabindex', '-1')
})
```

**Verify:** `pnpm test src/features/auth/components/register-form` — 5 pass. `RegisterForm` is complete.

## Step 12 — Register page

Small wiring step: connects `connection()` (so each request gets a fresh idempotency key) to the now-complete form.

`src/app/(auth)/register/page.tsx`:

```tsx
import type { Metadata } from 'next'
import { connection } from 'next/server'
import { RegisterForm } from '@/features/auth/components/register-form'

export const metadata: Metadata = { title: 'Create your account' }

export default async function RegisterPage() {
  await connection()
  return <RegisterForm submissionId={crypto.randomUUID()} />
}
```

Async Server Components are not unit-testable in Vitest (see `07`); the check here is manual, and full proof comes from the E2E suite in `07`.

**Verify:** `pnpm dev`, open `/register`, confirm the form renders. View source on two separate loads and confirm the hidden `submissionId` input has a different value each time — that proves `connection()` is forcing per-request rendering instead of a single build-time value shared by every visitor.

## Step 13 — Resend form

A small, self-contained component reused by `/register/check-email` (this doc) and `/confirm-email` (`05`). Build the error path first, then add the success path.

`src/features/auth/components/resend-form.tsx`:

```tsx
'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { FormMessage } from '@/components/ui/form-message'
import { TextField } from '@/components/ui/text-field'
import { resendConfirmationAction, type ResendState } from '@/features/auth/actions'

export function ResendForm({ defaultEmail }: { defaultEmail: string | null }) {
  const [state, formAction, pending] = useActionState(resendConfirmationAction, { status: 'idle' } satisfies ResendState)

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <TextField label="Email" name="email" type="email" defaultValue={defaultEmail ?? ''} required />
      {state.status === 'error' ? <FormMessage tone="error">{state.message}</FormMessage> : null}
      <Button type="submit" variant="secondary" pending={pending} pendingLabel="Sending…">
        Send a new link
      </Button>
    </form>
  )
}
```

```tsx
vi.mock('@/features/auth/actions', () => ({ resendConfirmationAction: vi.fn() }))
import { resendConfirmationAction } from '@/features/auth/actions'

test('shows the backend error message', async () => {
  vi.mocked(resendConfirmationAction).mockResolvedValueOnce({ status: 'error', message: 'Enter a valid email address.' })
  render(<ResendForm defaultEmail="ren@x.com" />)
  await userEvent.click(screen.getByRole('button', { name: 'Send a new link' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Enter a valid email address.')
})
```

**Verify:** `pnpm test src/features/auth/components/resend-form` — passes.

Now add the success state, replacing the form:

```tsx
if (state.status === 'sent') {
  return <FormMessage tone="success">If an account exists for that email, a new link is on its way.</FormMessage>
}
```

```tsx
test('a sent status replaces the form with a success message', async () => {
  vi.mocked(resendConfirmationAction).mockResolvedValueOnce({ status: 'sent' })
  render(<ResendForm defaultEmail="ren@x.com" />)
  await userEvent.click(screen.getByRole('button', { name: 'Send a new link' }))
  expect(await screen.findByRole('status')).toHaveTextContent('a new link is on its way')
  expect(screen.queryByRole('button', { name: 'Send a new link' })).not.toBeInTheDocument()
})
```

**Verify:** `pnpm test src/features/auth/components/resend-form` — 2 pass.

## Step 14 — Check-email page

`src/app/(auth)/register/check-email/page.tsx`:

```tsx
import type { Metadata } from 'next'
import Link from 'next/link'
import { cookies } from 'next/headers'
import { PENDING_EMAIL_COOKIE } from '@/features/auth/actions'
import { ResendForm } from '@/features/auth/components/resend-form'

export const metadata: Metadata = { title: 'Check your email', robots: { index: false } }

export default async function CheckEmailPage() {
  const email = (await cookies()).get(PENDING_EMAIL_COOKIE)?.value ?? null

  return (
    <section className="flex flex-col gap-6">
      <h2 className="text-display-sm font-semibold">Check your email</h2>
      <p className="max-w-prose">
        {email ? <>We sent a confirmation link to <strong>{email}</strong>. It expires in 24 hours.</> : <>We sent you a confirmation link. It expires in 24 hours.</>}
      </p>
      <p className="max-w-prose">Didn't get it? Check your spam folder, or send a new one.</p>
      <ResendForm defaultEmail={email} />
      <p className="text-sm">
        Wrong address? <Link href="/register" className="underline">Create your account again</Link>.
      </p>
    </section>
  )
}
```

**Verify:** complete a real submission via `pnpm dev` (Step 12's manual check plus a real backend or a temporary stub) and confirm `/register/check-email` shows the email from the cookie. Full automated proof, including the cookie itself, is the E2E test in `07`.

## UI states (reference)

| State | Where | What the user sees |
|---|---|---|
| Idle | form | Empty fields, enabled button |
| Pending | form | Button disabled, label "Creating account…" |
| Field errors | form | Inline red text under each field |
| Email taken | form | Inline error with "Sign in instead" link |
| Rate limited / upstream | form | `FormMessage` above the button, reference id shown for upstream |
| Success | `/register/check-email` | Confirmation copy, resend form |
| Resend sent | check-email | Success message replaces resend form |

## Copy (use exactly)

| Element | Text |
|---|---|
| Form heading | Create your account |
| Labels | Display name · Email · Password |
| Password hint | At least 10 characters. Long beats complicated. |
| Submit | Create account → pending: Creating account… |
| displayName error | Use 2 to 40 characters. |
| email error | Enter a valid email address. |
| email taken | This email already has an account. Sign in instead. |
| password errors | Use at least 10 characters. / Use 128 characters or fewer. |
| Rate limited | Too many attempts. Wait a minute, then try again. |
| Upstream | We couldn't create your account right now. Try again in a moment. + Reference: … |
| Check-email H2 | Check your email |
| Check-email body | We sent a confirmation link to {email}. It expires in 24 hours. |
| Resend prompt | Didn't get it? Check your spam folder, or send a new one. |
| Resend button | Send a new link → pending: Sending… |
| Resend done | If an account exists for that email, a new link is on its way. |

## Do not

- Do not add a confirm-password field, a strength meter, or composition rules.
- Do not call `registerUser` from anywhere but `registerAction`.
- Do not put the email in the redirect URL.
- Do not `try/catch` around `redirect()`.
- Do not use `useEffect` to submit or fetch.
- Do not show backend `message` strings to the user.

## Done when

- Every step above has been run and passed, in order.
- Keyboard only: Tab order is display name → email → password → show/hide → submit → sign-in link; Enter submits.
- The full happy-path and error-path proof (real HTTP requests against a mock backend) is `07`'s job, not this doc's.
