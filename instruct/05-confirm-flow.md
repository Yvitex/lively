# 05 — Email confirmation flow

## Goal

`/confirm-email?token=…` — the page the confirmation email links to. It confirms through the backend on an explicit click, handles expired/invalid/already-confirmed cases with a way forward, and carries the one animated moment in the whole flow.

## Read first

- `02-backend-contract.md` (`POST /auth/confirm-email`, token spec, email link)
- `06-design-system.md` (motion spec, `ConfirmEmailCard` layout)
- `04-register-flow.md` (`ResendForm`, `PENDING_EMAIL_COOKIE`, action patterns)
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md` (`searchParams` is a Promise; `PageProps`)

## Why the page does not confirm on load

Email clients, corporate link scanners and chat previews issue `GET` requests to links before or instead of the user. If loading the page consumed the token, a large share of users would arrive at "this link has expired" through no fault of their own. So:

1. `GET /confirm-email?token=…` only checks the token's *shape* and renders a button.
2. Clicking "Confirm email" runs a Server Action (`POST`) that calls the backend.

The cost is one click. The benefit is correctness, plus a natural place for the shadow-alignment animation.

## Flow

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

## Do

### 1. Action — add to `src/features/auth/actions.ts`

```ts
import { confirmEmail } from '@/lib/api/auth'
import { TokenExpiredError, TokenInvalidError } from '@/lib/errors'
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
}
```

Merge the imports with the ones already in the file. The token is never logged — the logger redacts a `token` key anyway, but do not pass it.

### 2. Page — `src/app/(auth)/confirm-email/page.tsx`

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

### 3. Card — `src/features/auth/components/confirm-email-card.tsx`

```tsx
'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { FormMessage } from '@/components/ui/form-message'
import { confirmEmailAction, type ConfirmState } from '@/features/auth/actions'
import { ResendForm } from './resend-form'

type Props = { token: string | null; defaultEmail: string | null }

export function ConfirmEmailCard({ token, defaultEmail }: Props) {
  const [state, formAction, pending] = useActionState(confirmEmailAction, {
    status: token ? 'idle' : 'invalid',
  } satisfies ConfirmState)

  const settled = state.status === 'confirmed' || state.status === 'already_confirmed'

  return (
    <section data-state={state.status} className="flex flex-col gap-6" aria-live="polite">
      {state.status === 'idle' || state.status === 'rate_limited' || state.status === 'failed' ? (
        <form action={formAction} className="flex flex-col gap-6">
          <h2 className="text-display-sm font-semibold">Confirm your email</h2>
          <p className="max-w-prose">Click below to finish setting up your Lively account.</p>
          <input type="hidden" name="token" value={token ?? ''} />
          {state.status === 'rate_limited' ? (
            <FormMessage tone="error">Too many attempts. Wait a minute, then try again.</FormMessage>
          ) : null}
          {state.status === 'failed' ? (
            <FormMessage tone="error" referenceId={state.referenceId}>
              We couldn't confirm your email right now. Try again in a moment.
            </FormMessage>
          ) : null}
          <Button type="submit" pending={pending} pendingLabel="Confirming…">
            Confirm email
          </Button>
        </form>
      ) : null}

      {state.status === 'confirmed' ? (
        <>
          <h2 className="text-display-sm font-semibold">Email confirmed</h2>
          <p className="max-w-prose">Your account is ready.</p>
          <Button as={Link} href="/">
            Continue to Lively
          </Button>
        </>
      ) : null}

      {state.status === 'already_confirmed' ? (
        <>
          <h2 className="text-display-sm font-semibold">Already confirmed</h2>
          <p className="max-w-prose">This email was confirmed earlier. You're all set.</p>
          <Button as={Link} href="/">
            Continue to Lively
          </Button>
        </>
      ) : null}

      {state.status === 'expired' ? (
        <>
          <h2 className="text-display-sm font-semibold">This link has expired</h2>
          <p className="max-w-prose">Confirmation links last 24 hours. Send yourself a new one.</p>
          <ResendForm defaultEmail={defaultEmail} />
        </>
      ) : null}

      {state.status === 'invalid' ? (
        <>
          <h2 className="text-display-sm font-semibold">This link doesn't work</h2>
          <p className="max-w-prose">
            It may have been used already, or copied incompletely. Send yourself a new one.
          </p>
          <ResendForm defaultEmail={defaultEmail} />
        </>
      ) : null}

      {settled ? <span className="sr-only">Done.</span> : null}
    </section>
  )
}
```

`data-state` on this section is what the CSS in `06` keys the shadow animation on: the surrounding `.twin-panel` (rendered by the auth layout) uses `:has([data-state='confirmed'], [data-state='already_confirmed'])` to collapse its offset shadow into a flush ring. `aria-live="polite"` on the section means each state change is announced once.

`Button` must support rendering as a `Link` (`as` prop) so "Continue to Lively" is a real anchor. That prop is specified in `06`.

"Continue to Lively" goes to `/` for now. When login exists, the confirmed state should either auto-sign-in (if the backend returns a session on confirm) or link to `/login` — leave a comment-free seam: the href is the only thing to change.

### 4. States and copy (use exactly)

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
- Do not redirect on success. The confirmed state *is* the destination; it carries the animation and the next-step link.
- Do not cache this route or wrap it in `'use cache'`.
- Do not auto-submit the form on mount "to save a click".

## Done when

- Visiting `/confirm-email` without a token, or with `token=abc`, shows the invalid state with the resend form and no confirm button.
- With a valid-shaped token, clicking "Confirm email" hits the backend once; the mock in `07` proves no request happens on page load.
- Each row of the states table is reachable via the mock backend.
- The shadow aligns on `confirmed` and does not animate when `prefers-reduced-motion: reduce` is set.
- Screen reader (or `aria-live` inspection) announces the new heading after the click.
