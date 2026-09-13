# 05 — Email confirmation flow

## Goal

`/confirm-email?token=…` — the page the confirmation email links to. It confirms through the backend on an explicit click, handles expired/invalid/already-confirmed cases with a way forward, and carries the one animated moment in the whole flow.

This doc adds one function to `src/features/auth/actions.ts` (already built by `04`) and one new component. Add the function as a diff to the existing file — do not reprint `registerAction` or `resendConfirmationAction`.

## Read first

- `02-backend-contract.md` (`POST /auth/confirm-email`, token spec, email link)
- `06-design-system.md` (motion spec, `ConfirmEmailCard` layout)
- `04-register-flow.md` (`ResendForm`, `PENDING_EMAIL_COOKIE`, `TokenSchema`)
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md` (`searchParams` is a Promise; `PageProps`)

## Why the page does not confirm on load

Email clients, corporate link scanners and chat previews issue `GET` requests to links before or instead of the user. If loading the page consumed the token, a large share of users would arrive at "this link has expired" through no fault of their own. So `GET /confirm-email?token=…` only checks the token's *shape* and renders a button; clicking "Confirm email" runs a Server Action (`POST`) that calls the backend. The cost is one click; the benefit is correctness, plus a natural place for the shadow-alignment animation.

## Overall flow (reference — build it in the steps below)

```text
GET /confirm-email?token=T
  shape invalid / missing ──► invalid state (no button)
  shape ok ──► idle: "Confirm your email" [Confirm email]
                        │ click
                        ▼
              confirmEmailAction
                rate-check fail ──► rate_limited
                200 confirmed ──► confirmed  (shadow aligns)
                200 already_confirmed ──► already_confirmed
                410 ──► expired  + ResendForm
                400 ──► invalid  + ResendForm
                other ──► failed + reference id
```

## Step 1 — `confirmEmailAction`, addition 1: rate limit and token shape

Add to `src/features/auth/actions.ts`:

```ts
import { TokenSchema } from './validation'

export type ConfirmState = {
  status: 'idle' | 'confirmed' | 'already_confirmed' | 'expired' | 'invalid' | 'rate_limited' | 'failed'
  referenceId?: string
}

export async function confirmEmailAction(_prev: ConfirmState, formData: FormData): Promise<ConfirmState> {
  const ip = await getClientIp()
  const limit = await rateLimiter.check(`confirm:${ip}`, { limit: 10, windowMs: 60_000 })
  if (!limit.ok) return { status: 'rate_limited' }

  const token = TokenSchema.safeParse(formData.get('token'))
  if (!token.success) return { status: 'invalid' }

  return { status: 'idle' } // backend call added in Step 2
}
```

`getClientIp` and `rateLimiter` are already imported by the file from `04`; `TokenSchema` is a new import to add to the existing import line from `./validation`.

Add to `src/features/auth/actions.test.ts`:

```ts
import { confirmEmailAction } from './actions'

test('a malformed token is rejected before any rate-limit or backend call', async () => {
  const result = await confirmEmailAction({ status: 'idle' }, form({ token: 'not-a-real-token' }))
  expect(result.status).toBe('invalid')
})
```

**Verify:** `pnpm test src/features/auth/actions` — passes.

## Step 2 — addition 2: call the backend

```ts
import { confirmEmail } from '@/lib/api/auth'
import { TokenExpiredError, TokenInvalidError } from '@/lib/errors'

// replace the placeholder `return { status: 'idle' }` with:
const requestId = crypto.randomUUID()
try {
  const result = await confirmEmail(token.data, { requestId })
  return { status: result.status }
} catch (err) {
  if (err instanceof TokenExpiredError) return { status: 'expired' }
  if (err instanceof TokenInvalidError) return { status: 'invalid' }
  if (err instanceof RateLimitedError) return { status: 'rate_limited' }
  logger.error('confirm_email_failed', { requestId, err })
  return { status: 'failed', referenceId: requestId }
}
```

`confirmEmail`, `RateLimitedError`, and `logger` are already imported elsewhere in the file from `03`/`04` — extend the existing import lines rather than adding new ones. The token itself is never logged.

```ts
import { confirmEmail } from '@/lib/api/auth'
vi.mock('@/lib/api/auth', () => ({ registerUser: vi.fn(), resendConfirmation: vi.fn(), confirmEmail: vi.fn() }))

test('a valid token that the backend confirms returns status confirmed', async () => {
  vi.mocked(confirmEmail).mockResolvedValueOnce({ status: 'confirmed' })
  const result = await confirmEmailAction({ status: 'idle' }, form({ token: 'a'.repeat(43) }))
  expect(result.status).toBe('confirmed')
})

test('an expired token maps to status expired', async () => {
  vi.mocked(confirmEmail).mockRejectedValueOnce(new TokenExpiredError())
  const result = await confirmEmailAction({ status: 'idle' }, form({ token: 'a'.repeat(43) }))
  expect(result.status).toBe('expired')
})
```

**Verify:** `pnpm test src/features/auth/actions` — passes. `confirmEmailAction` is complete; `actions.ts` now has all three exports and is not touched again.

## Step 3 — Confirm card, part 1: idle and invalid

Build the component's simplest branch first: no token → invalid message, no button; valid-shaped token → the confirm button, unwired.

`src/features/auth/components/confirm-email-card.tsx`:

```tsx
'use client'

type Props = { token: string | null; defaultEmail: string | null }

export function ConfirmEmailCard({ token }: Props) {
  if (!token) {
    return (
      <section data-state="invalid">
        <h2 className="text-display-sm font-semibold">This link doesn't work</h2>
        <p className="max-w-prose">It may have been used already, or copied incompletely. Send yourself a new one.</p>
      </section>
    )
  }

  return (
    <section data-state="idle">
      <h2 className="text-display-sm font-semibold">Confirm your email</h2>
      <p className="max-w-prose">Click below to finish setting up your Lively account.</p>
      <button type="button">Confirm email</button>
    </section>
  )
}
```

```tsx
import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { ConfirmEmailCard } from './confirm-email-card'

test('no token shows the invalid message with no confirm button', () => {
  render(<ConfirmEmailCard token={null} defaultEmail={null} />)
  expect(screen.getByRole('heading', { name: "This link doesn't work" })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Confirm email' })).not.toBeInTheDocument()
})

test('a valid-shaped token shows the confirm button', () => {
  render(<ConfirmEmailCard token={'a'.repeat(43)} defaultEmail={null} />)
  expect(screen.getByRole('button', { name: 'Confirm email' })).toBeInTheDocument()
})
```

**Verify:** `pnpm test src/features/auth/components/confirm-email-card` — 2 pass.

## Step 4 — part 2: wire the action and pending state

```tsx
import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { confirmEmailAction, type ConfirmState } from '@/features/auth/actions'

export function ConfirmEmailCard({ token, defaultEmail }: Props) {
  const [state, formAction, pending] = useActionState(confirmEmailAction, {
    status: token ? 'idle' : 'invalid',
  } satisfies ConfirmState)

  if (state.status === 'invalid' && !token) {
    return (/* ...unchanged from Step 3... */)
  }

  return (
    <section data-state={state.status} aria-live="polite">
      <form action={formAction} className="flex flex-col gap-6">
        <h2 className="text-display-sm font-semibold">Confirm your email</h2>
        <p className="max-w-prose">Click below to finish setting up your Lively account.</p>
        <input type="hidden" name="token" value={token ?? ''} />
        <Button type="submit" pending={pending} pendingLabel="Confirming…">
          Confirm email
        </Button>
      </form>
    </section>
  )
}
```

```tsx
vi.mock('@/features/auth/actions', () => ({ confirmEmailAction: vi.fn() }))
import { confirmEmailAction } from '@/features/auth/actions'
import userEvent from '@testing-library/user-event'

test('clicking confirm shows the pending label', async () => {
  let resolveAction: (v: ConfirmState) => void
  vi.mocked(confirmEmailAction).mockReturnValue(new Promise((r) => (resolveAction = r)))
  render(<ConfirmEmailCard token={'a'.repeat(43)} defaultEmail={null} />)
  await userEvent.click(screen.getByRole('button', { name: 'Confirm email' }))
  expect(screen.getByRole('button')).toHaveTextContent('Confirming…')
  resolveAction!({ status: 'idle' })
})
```

**Verify:** `pnpm test src/features/auth/components/confirm-email-card` — 3 pass.

## Step 5 — part 3: confirmed and already_confirmed

```tsx
import Link from 'next/link'

const settled = state.status === 'confirmed' || state.status === 'already_confirmed'

// inside the <section>, alongside the idle/rate_limited/failed form branch:
{state.status === 'confirmed' ? (
  <>
    <h2 className="text-display-sm font-semibold">Email confirmed</h2>
    <p className="max-w-prose">Your account is ready.</p>
    <Button as={Link} href="/">Continue to Lively</Button>
  </>
) : null}

{state.status === 'already_confirmed' ? (
  <>
    <h2 className="text-display-sm font-semibold">Already confirmed</h2>
    <p className="max-w-prose">This email was confirmed earlier. You're all set.</p>
    <Button as={Link} href="/">Continue to Lively</Button>
  </>
) : null}
```

Guard the form branch so it only renders for `idle | rate_limited | failed`, not for every non-invalid status:

```tsx
{state.status === 'idle' || state.status === 'rate_limited' || state.status === 'failed' ? (
  <form action={formAction} className="flex flex-col gap-6">{/* ...from Step 4... */}</form>
) : null}
```

```tsx
test('a confirmed result shows the confirmed heading and marks data-state', async () => {
  vi.mocked(confirmEmailAction).mockResolvedValueOnce({ status: 'confirmed' })
  render(<ConfirmEmailCard token={'a'.repeat(43)} defaultEmail={null} />)
  await userEvent.click(screen.getByRole('button', { name: 'Confirm email' }))
  expect(await screen.findByRole('heading', { name: 'Email confirmed' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Continue to Lively' })).toBeInTheDocument()
})
```

`data-state="confirmed"` on this section is what the CSS in `06` keys the shadow animation on: the surrounding `.twin-panel` (rendered by the auth layout) uses `:has([data-state='confirmed'], [data-state='already_confirmed'])` to collapse its offset shadow into a flush ring.

**Verify:** `pnpm test src/features/auth/components/confirm-email-card` — 4 pass.

## Step 6 — part 4: expired and invalid-after-submit, with resend

```tsx
import { ResendForm } from './resend-form'

{state.status === 'expired' ? (
  <>
    <h2 className="text-display-sm font-semibold">This link has expired</h2>
    <p className="max-w-prose">Confirmation links last 24 hours. Send yourself a new one.</p>
    <ResendForm defaultEmail={defaultEmail} />
  </>
) : null}

{state.status === 'invalid' && token ? (
  <>
    <h2 className="text-display-sm font-semibold">This link doesn't work</h2>
    <p className="max-w-prose">It may have been used already, or copied incompletely. Send yourself a new one.</p>
    <ResendForm defaultEmail={defaultEmail} />
  </>
) : null}
```

`ResendForm` is reused unchanged from `04` — do not rebuild it.

```tsx
test('an expired token offers the resend form', async () => {
  vi.mocked(confirmEmailAction).mockResolvedValueOnce({ status: 'expired' })
  render(<ConfirmEmailCard token={'a'.repeat(43)} defaultEmail="ren@x.com" />)
  await userEvent.click(screen.getByRole('button', { name: 'Confirm email' }))
  expect(await screen.findByRole('heading', { name: 'This link has expired' })).toBeInTheDocument()
  expect(screen.getByLabelText('Email')).toHaveValue('ren@x.com')
})
```

**Verify:** `pnpm test src/features/auth/components/confirm-email-card` — 5 pass.

## Step 7 — part 5: rate limited and failed

```tsx
import { FormMessage } from '@/components/ui/form-message'

// inside the idle/rate_limited/failed form, before the submit button:
{state.status === 'rate_limited' ? (
  <FormMessage tone="error">Too many attempts. Wait a minute, then try again.</FormMessage>
) : null}
{state.status === 'failed' ? (
  <FormMessage tone="error" referenceId={state.referenceId}>
    We couldn't confirm your email right now. Try again in a moment.
  </FormMessage>
) : null}
```

```tsx
test('a failed confirmation shows a reference id for support', async () => {
  vi.mocked(confirmEmailAction).mockResolvedValueOnce({ status: 'failed', referenceId: 'req_9' })
  render(<ConfirmEmailCard token={'a'.repeat(43)} defaultEmail={null} />)
  await userEvent.click(screen.getByRole('button', { name: 'Confirm email' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Reference: req_9')
})
```

**Verify:** `pnpm test src/features/auth/components/confirm-email-card` — 6 pass. `ConfirmEmailCard` covers all seven states.

## Step 8 — Confirm-email page

Small wiring step: reads the token from the URL, validates its shape, reads the pending-email cookie, hands both to the card.

`src/app/(auth)/confirm-email/page.tsx`:

```tsx
import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { PENDING_EMAIL_COOKIE } from '@/features/auth/actions'
import { ConfirmEmailCard } from '@/features/auth/components/confirm-email-card'
import { TokenSchema } from '@/features/auth/validation'

export const metadata: Metadata = { title: 'Confirm your email', robots: { index: false, follow: false } }

export default async function ConfirmEmailPage({ searchParams }: PageProps<'/confirm-email'>) {
  const { token } = await searchParams
  const parsed = TokenSchema.safeParse(typeof token === 'string' ? token : undefined)
  const pendingEmail = (await cookies()).get(PENDING_EMAIL_COOKIE)?.value ?? null

  return <ConfirmEmailCard token={parsed.success ? parsed.data : null} defaultEmail={pendingEmail} />
}
```

Reading `searchParams` and `cookies()` makes this route dynamic and uncached, which is what a token page needs. `PageProps<'/confirm-email'>` is the global helper Next generates; if the typecheck cannot find it, run `pnpm dev` once so `.next/types` is generated, or type `searchParams` as `Promise<Record<string, string | string[] | undefined>>`.

**Verify:** `pnpm dev`, visit `/confirm-email` (no token) and confirm the invalid message with no button. Visit `/confirm-email?token=abc` (too short) and confirm the same. Visit `/confirm-email?token=` + 43 `a` characters and confirm the "Confirm email" button appears. Full proof against a real backend response is `07`'s job.

## States and copy (reference — use exactly)

| `status` | Heading | Body | Action |
|---|---|---|---|
| `idle` | Confirm your email | Click below to finish setting up your Lively account. | Confirm email → pending: Confirming… |
| `confirmed` | Email confirmed | Your account is ready. | Continue to Lively |
| `already_confirmed` | Already confirmed | This email was confirmed earlier. You're all set. | Continue to Lively |
| `expired` | This link has expired | Confirmation links last 24 hours. Send yourself a new one. | ResendForm |
| `invalid` | This link doesn't work | It may have been used already, or copied incompletely. Send yourself a new one. | ResendForm |
| `rate_limited` | (idle heading) | Too many attempts. Wait a minute, then try again. | Confirm email (retry) |
| `failed` | (idle heading) | We couldn't confirm your email right now. Try again in a moment. Reference: … | Confirm email (retry) |

## Do not

- Do not call `confirmEmail` from the page component or from a `useEffect`. Only the action.
- Do not put the token anywhere except the hidden input: not in headings, not in `data-*` attributes, not in logs.
- Do not redirect on success. The confirmed state *is* the destination.
- Do not cache this route or wrap it in `'use cache'`.
- Do not auto-submit the form on mount "to save a click".

## Done when

- Every step above has been run and passed, in order.
- The shadow aligns on `confirmed` and does not animate when `prefers-reduced-motion: reduce` is set (visual check).
- Screen reader (or `aria-live` inspection) announces the new heading after the click.
- The full click → backend → state proof against a mock backend is `07`'s job.
