# 04 — Register flow

## Goal

`/register` — a form that creates an account through the backend and lands on `/register/check-email`, with every state handled and the visual language from `06`.

## Read first

- `06-design-system.md` (components, tokens, copy rules)
- `02-backend-contract.md` (`POST /auth/register`, `POST /auth/resend-confirmation`)
- `node_modules/next/dist/docs/01-app/02-guides/forms.md`
- `node_modules/next/dist/docs/01-app/01-getting-started/07-mutating-data.md`
- `node_modules/next/dist/docs/01-app/02-guides/server-actions.md` ("Security")
- `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/cookies.md`, `connection.md`

## Flow

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
                                                   │
                                                   ▼
                                     "Check your email" + resend form
```

## Do

### 1. Validation — `src/features/auth/validation.ts`

Shared by client and server. No `'server-only'` here.

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

### 2. Actions — `src/features/auth/actions.ts`

```ts
'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { env } from '@/lib/env'
import { registerUser, resendConfirmation } from '@/lib/api/auth'
import { ConflictError, RateLimitedError, ValidationError } from '@/lib/errors'
import { logger } from '@/lib/logger'
import { getClientIp, rateLimiter } from '@/lib/rate-limit'
import { EmailSchema, RegisterSchema, type RegisterField } from './validation'

export const PENDING_EMAIL_COOKIE = 'lively_pending_email'

export type RegisterState = {
  fieldErrors?: Partial<Record<RegisterField, string[]>>
  formError?: string
  referenceId?: string
  values?: { displayName: string; email: string }
}

const RATE_LIMIT_MESSAGE = 'Too many attempts. Wait a minute, then try again.'

export async function registerAction(_prev: RegisterState, formData: FormData): Promise<RegisterState> {
  const raw = {
    displayName: formData.get('displayName'),
    email: formData.get('email'),
    password: formData.get('password'),
  }
  const values = {
    displayName: typeof raw.displayName === 'string' ? raw.displayName : '',
    email: typeof raw.email === 'string' ? raw.email : '',
  }

  if (formData.get('website')) redirect('/register/check-email')

  const ip = await getClientIp()
  const limit = await rateLimiter.check(`register:${ip}`, { limit: 5, windowMs: 60_000 })
  if (!limit.ok) return { formError: RATE_LIMIT_MESSAGE, values }

  const parsed = RegisterSchema.safeParse(raw)
  if (!parsed.success) return { fieldErrors: z.flattenError(parsed.error).fieldErrors, values }

  const submissionId = formData.get('submissionId')
  const idempotencyKey =
    typeof submissionId === 'string' && z.uuid().safeParse(submissionId).success
      ? submissionId
      : crypto.randomUUID()
  const requestId = crypto.randomUUID()

  try {
    await registerUser(parsed.data, { requestId, idempotencyKey })
  } catch (err) {
    if (err instanceof ConflictError) {
      return { fieldErrors: { email: ['EMAIL_TAKEN'] }, values }
    }
    if (err instanceof ValidationError) {
      return err.fields
        ? { fieldErrors: err.fields as RegisterState['fieldErrors'], values }
        : { formError: 'Check the details and try again.', values }
    }
    if (err instanceof RateLimitedError) return { formError: RATE_LIMIT_MESSAGE, values }
    logger.error('register_failed', { requestId, err })
    return {
      formError: "We couldn't create your account right now. Try again in a moment.",
      referenceId: requestId,
      values,
    }
  }

  const cookieStore = await cookies()
  cookieStore.set(PENDING_EMAIL_COOKIE, parsed.data.email, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 15,
  })
  redirect('/register/check-email')
}

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

Notes that matter:

- `redirect()` throws; it is outside `try/catch` so the catch does not swallow it.
- The email-taken case returns the marker `'EMAIL_TAKEN'` instead of copy so the form can render a *link* ("Sign in instead"), which a plain string cannot carry.
- Resend returns `sent` even when the backend errors (except rate limit): the contract says the response must not reveal whether the email exists, and the user's next step is the same either way.
- The pending-email cookie lets `/register/check-email` and `/confirm-email` prefill the resend form without putting an email address in a URL (URLs end up in logs and browser history).
- `secure` is off in development so the cookie works on `http://localhost`.

### 3. Page — `src/app/(auth)/register/page.tsx`

```tsx
import type { Metadata } from 'next'
import { connection } from 'next/server'
import { RegisterForm } from '@/features/auth/components/register-form'

export const metadata: Metadata = { title: 'Create your account' }

export default async function RegisterPage() {
  await connection()
  const submissionId = crypto.randomUUID()
  return <RegisterForm submissionId={submissionId} />
}
```

`await connection()` opts the page into request-time rendering so each visitor gets a fresh `submissionId` (the idempotency key). Without it the page would be prerendered once at build with a single UUID for everyone.

The `(auth)/layout.tsx` (AuthShell, defined in `06`) supplies the two-column frame, the brand panel with "Come as you are." and the step indicator. The page only renders the form.

### 4. Form — `src/features/auth/components/register-form.tsx`

```tsx
'use client'

import Link from 'next/link'
import { useActionState, useId } from 'react'
import { Button } from '@/components/ui/button'
import { FormMessage } from '@/components/ui/form-message'
import { PasswordField } from '@/components/ui/password-field'
import { TextField } from '@/components/ui/text-field'
import { registerAction, type RegisterState } from '@/features/auth/actions'

const initialState: RegisterState = {}

export function RegisterForm({ submissionId }: { submissionId: string }) {
  const [state, formAction, pending] = useActionState(registerAction, initialState)
  const headingId = useId()

  const emailErrors = state.fieldErrors?.email
  const emailTaken = emailErrors?.includes('EMAIL_TAKEN')

  return (
    <form action={formAction} aria-labelledby={headingId} noValidate className="flex flex-col gap-6">
      <h2 id={headingId} className="text-display-sm font-semibold">
        Create your account
      </h2>

      <input type="hidden" name="submissionId" value={submissionId} />
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <TextField
        label="Display name"
        name="displayName"
        autoComplete="nickname"
        required
        maxLength={40}
        defaultValue={state.values?.displayName}
        errors={state.fieldErrors?.displayName}
      />

      <TextField
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        required
        defaultValue={state.values?.email}
        errors={
          emailTaken
            ? [
                <>
                  This email already has an account.{' '}
                  <Link href="/login" className="underline">
                    Sign in instead
                  </Link>
                  .
                </>,
              ]
            : emailErrors
        }
      />

      <PasswordField
        label="Password"
        name="password"
        autoComplete="new-password"
        required
        minLength={10}
        maxLength={128}
        hint="At least 10 characters. Long beats complicated."
        errors={state.fieldErrors?.password}
      />

      {state.formError ? (
        <FormMessage tone="error" referenceId={state.referenceId}>
          {state.formError}
        </FormMessage>
      ) : null}

      <Button type="submit" pending={pending} pendingLabel="Creating account…">
        Create account
      </Button>

      <p className="text-sm">
        Already have an account?{' '}
        <Link href="/login" className="underline">
          Sign in
        </Link>
      </p>
    </form>
  )
}
```

Behavioral requirements the UI components must satisfy (their markup is specified in `06`):

- `noValidate` on the form: browser bubbles are replaced by the app's own inline errors, but the `type`, `required`, `minLength` attributes stay for assistive tech and mobile keyboards.
- `TextField`/`PasswordField` render a visible `<label>`, set `aria-invalid` when `errors` is non-empty, and link the error list with `aria-describedby`. The hint is also in `aria-describedby`.
- `FormMessage` has `role="alert"` for errors and `role="status"` for success; it renders "Reference: {referenceId}" in a smaller line when given one.
- `Button` with `pending` sets `disabled`, `aria-disabled`, and swaps its label to `pendingLabel` — no spinner-only state.
- `/login` does not exist yet. Create `src/app/(auth)/login/page.tsx` as a one-line stub ("Sign-in is coming soon.") so the links are not dead. Do not build login.

### 5. Check-email page — `src/app/(auth)/register/check-email/page.tsx`

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
        {email ? (
          <>
            We sent a confirmation link to <strong>{email}</strong>. It expires in 24 hours.
          </>
        ) : (
          <>We sent you a confirmation link. It expires in 24 hours.</>
        )}
      </p>
      <p className="max-w-prose">Didn't get it? Check your spam folder, or send a new one.</p>
      <ResendForm defaultEmail={email} />
      <p className="text-sm">
        Wrong address?{' '}
        <Link href="/register" className="underline">
          Create your account again
        </Link>
        .
      </p>
    </section>
  )
}
```

### 6. Resend form — `src/features/auth/components/resend-form.tsx`

Used here and in `05`. Client component with `useActionState(resendConfirmationAction, { status: 'idle' })`.

- Shows an email `TextField` (prefilled with `defaultEmail`, editable) and a secondary `Button` "Send a new link" (pending label "Sending…").
- On `status === 'sent'`: replace the form with `<FormMessage tone="success">If an account exists for that email, a new link is on its way.</FormMessage>`.
- On `status === 'error'`: `FormMessage tone="error"` with `message`, form stays.

### 7. UI states

| State | Where | What the user sees |
|---|---|---|
| Idle | form | Empty fields, enabled button |
| Pending | form | Button disabled, label "Creating account…", fields stay editable |
| Field errors | form | Inline red text under each field, first invalid field focused (`autoFocus` via `useEffect` on the first field with errors — allowed here because it is a real browser effect) |
| Email taken | form | Inline error with "Sign in instead" link |
| Rate limited / upstream | form | `FormMessage` above the button, reference id shown for upstream |
| Success | `/register/check-email` | Confirmation copy, resend form |
| Resend sent | check-email | Success message replaces resend form |

### 8. Copy (use exactly)

| Element | Text |
|---|---|
| Brand panel H1 (AuthShell) | Come as you are. |
| Brand panel sub | Make a Lively account to post, follow, and find your people. |
| Step indicator | Create account / Confirm email |
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
- Do not use `useEffect` to submit or fetch. The only effect allowed in this form is focusing the first invalid field.
- Do not show backend `message` strings to the user.

## Done when

- Happy path: submit valid data → backend receives `Idempotency-Key`, `X-Request-Id` → user lands on `/register/check-email` with their email shown.
- Submitting twice quickly with the same form reuses the same idempotency key (check backend logs or the mock in `07`).
- Each error row in the UI-states table is reachable and reads as specified.
- Keyboard only: Tab order is display name → email → password → show/hide → submit → sign-in link; Enter submits; errors are announced (screen reader or `aria-live` inspection).
- Tests in `07` for this doc pass.
