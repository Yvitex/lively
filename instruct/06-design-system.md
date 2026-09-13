# 06 — Design system for the auth surface

## Goal

Give the register and confirm screens a look that belongs to Lively and to nothing else: one idea, a small token set, one typeface, and components that `04`/`05` can drop in.

Read the whole "The idea" and "Reference material" sections before writing anything — they are the reasoning, not steps. Then follow the numbered steps: build the tokens, then the CSS utilities that depend on them, then each primitive component, each with something you can look at or run before moving to the next. `AuthShell` at the end is the one wiring step here — it assembles primitives that must already exist.

## Read first

- `node_modules/next/dist/docs/01-app/01-getting-started/11-css.md` (Tailwind 4 in this Next version)
- `node_modules/next/dist/docs/03-architecture/accessibility.md`
- Tailwind 4 `@theme` and `@utility` docs (tailwindcss.com/docs/theme, /docs/adding-custom-utilities)

## The idea: two selves

Lively has a public face and, underneath, a second self. The auth screens do not say that. They *show* it: every primary surface casts a **hard, solid violet copy of itself, offset down-right** — a second identity standing just behind the first. That is the single memorable element. On the confirmation screen, when the email is confirmed, the offset collapses and the two shapes align into one outlined form. Nothing else on these screens moves on its own.

## Step 1 — Color tokens

Contrast was checked for every text pairing below (ink/paper 14:1, violet/paper 6.2:1, paper-on-violet 6.6:1, leaf/paper 5.0:1, rose/paper 5.1:1, dark violet/dark paper 4.6:1). If you change a value, re-check with a contrast tool before committing.

| Token | Light | Dark | Use |
|---|---|---|---|
| `paper` | `#F7F6FB` | `#14122A` | Page ground. Cool lavender-white — deliberately not cream. |
| `field` | `#FFFFFF` | `#1B1838` | Input backgrounds, panel background. |
| `ink` | `#1E1B3A` | `#EEEBFF` | Text, borders. Indigo-black, not neutral near-black. |
| `violet` | `#4B3DEB` | `#8F80FF` | The shadow, primary emphasis, focus ring, links. |
| `mist` | `#DCD9EA` | `#2C2850` | Hairline dividers only. |
| `leaf` | `#0F7A4C` | `#3DD68C` | Success text and marks only. |
| `rose` | `#C42D48` | `#FF7A93` | Error text, invalid borders only. |

In `src/app/globals.css`, replace the scaffold's `--background`/`--foreground` variables with:

```css
@theme {
  --color-paper: #f7f6fb;
  --color-field: #ffffff;
  --color-ink: #1e1b3a;
  --color-violet: #4b3deb;
  --color-mist: #dcd9ea;
  --color-leaf: #0f7a4c;
  --color-rose: #c42d48;
}

@layer base {
  @media (prefers-color-scheme: dark) {
    :root {
      --color-paper: #14122a;
      --color-field: #1b1838;
      --color-ink: #eeebff;
      --color-violet: #8f80ff;
      --color-mist: #2c2850;
      --color-leaf: #3dd68c;
      --color-rose: #ff7a93;
    }
  }

  body {
    background: var(--color-paper);
    color: var(--color-ink);
  }
}
```

Also remove the scaffold's `Arial, Helvetica` body font rule — it is replaced in Step 3.

**Verify:** `pnpm dev`, add `<div className="bg-violet text-paper p-4">test</div>` anywhere temporarily, confirm it renders solid violet with paper-colored text. Toggle OS dark mode and confirm the page background switches. Delete the test div.

## Step 2 — Base layer: focus ring and line height

```css
@layer base {
  body {
    line-height: 1.55;
  }
  :focus-visible {
    outline: 2px solid var(--color-violet);
    outline-offset: 2px;
  }
  ::selection {
    background: var(--color-violet);
    color: var(--color-paper);
  }
}
```

**Verify:** Tab to any link on the page (even the default Next.js scaffold link) and confirm a 2px violet ring with a visible gap appears — this is the one focus style every interactive element in `04`/`05` relies on.

## Step 3 — Type scale and font

One family: **Bricolage Grotesque**, loaded in `01` via `next/font/google` with `axes: ['opsz', 'wdth']`. `font-optical-sizing: auto` makes display sizes pick up the wide, characterful cut and body sizes the sturdier one — no second typeface, no monospace on these screens.

```css
@theme {
  --font-sans: var(--font-bricolage), ui-sans-serif, system-ui, sans-serif;
  --text-display-lg: 3.8125rem;
  --text-display-lg--line-height: 1.02;
  --text-display-lg--letter-spacing: -0.02em;
  --text-display-md: 2.4375rem;
  --text-display-md--line-height: 1.05;
  --text-display-sm: 1.5625rem;
  --text-display-sm--line-height: 1.15;
}

@layer base {
  html {
    font-family: var(--font-sans);
    font-optical-sizing: auto;
  }
}
```

| Role | Size | Weight | Utility |
|---|---|---|---|
| Display large (brand H1, desktop) | 61px | 700 | `text-display-lg font-bold` |
| Display medium (brand H1, mobile) | 39px | 700 | `text-display-md font-bold` |
| Display small (form/section H2) | 25px | 600 | `text-display-sm font-semibold` |
| Lead (brand sub) | 20px | 400 | `text-xl` |
| Body | 16px | 400 | default |
| Small (hints, footers, steps) | 14px | 400 | `text-sm` |

Body and lead text are capped at `max-w-prose` (65ch). Headings are sentence case; never accent a single word with color or italics.

**Verify:** add a temporary `<h1 className="text-display-lg font-bold">Come as you are.</h1>`, confirm the font is visibly Bricolage Grotesque (distinct wide character shapes), not the browser default. Delete it once confirmed — Step 10 renders the real one.

## Step 4 — The twin-shadow utilities

The one animated moment lives here: a `.twin-panel` collapses its offset shadow into a flush ring when a descendant carries `data-state="confirmed"` or `"already_confirmed"` (set by `05`'s `ConfirmEmailCard`).

```css
@theme {
  --radius-control: 4px;
  --radius-panel: 8px;
  --shadow-offset: 12px;
  --ease-settle: cubic-bezier(0.2, 0.8, 0.2, 1);
}

@layer base {
  @media (max-width: 1023px) {
    :root { --shadow-offset: 6px; }
  }
}

@utility twin-shadow {
  box-shadow: var(--shadow-offset) var(--shadow-offset) 0 0 var(--color-violet);
}

@utility twin-panel {
  background: var(--color-field);
  border: 1px solid var(--color-ink);
  border-radius: var(--radius-panel);
  box-shadow: var(--shadow-offset) var(--shadow-offset) 0 0 var(--color-violet);
  transition: box-shadow 400ms var(--ease-settle);
}

.twin-panel:has([data-state='confirmed'], [data-state='already_confirmed']) {
  box-shadow: 0 0 0 4px var(--color-violet);
}

@media (prefers-reduced-motion: reduce) {
  .twin-panel { transition: none; }
}
```

**Verify:** temporarily render `<div className="twin-panel p-6"><span data-state="idle">idle</span></div>` — confirm the offset violet shadow appears. Change `data-state` to `"confirmed"` in the browser devtools and confirm the shadow collapses into a flush ring. Toggle "emulate prefers-reduced-motion: reduce" in devtools and confirm the change is instant, not animated. Delete the test div — `05` wires the real one.

## Step 5 — `TwinMark`

The logo mark: two profile silhouettes, the back one violet and offset, the front one ink. A single small, self-contained component.

`src/components/ui/twin-mark.tsx`:

```tsx
export function TwinMark({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" focusable="false">
      <g fill="var(--color-violet)" transform="translate(6 6)">
        <circle cx="14" cy="9" r="7" />
        <path d="M1 30c0-7 6-12 13-12s13 5 13 12H1Z" />
      </g>
      <g fill="var(--color-ink)">
        <circle cx="14" cy="9" r="7" />
        <path d="M1 30c0-7 6-12 13-12s13 5 13 12H1Z" />
      </g>
    </svg>
  )
}
```

`src/components/ui/twin-mark.test.tsx`:

```tsx
import { render } from '@testing-library/react'
import { expect, test } from 'vitest'
import { TwinMark } from './twin-mark'

test('is decorative and hidden from the accessibility tree', () => {
  const { container } = render(<TwinMark />)
  expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
})
```

**Verify:** `pnpm test src/components/ui/twin-mark` — passes.

## Step 6 — `Button`, part 1: variants

```tsx
import Link from 'next/link'

type ButtonProps = {
  children: React.ReactNode
  variant?: 'primary' | 'secondary'
  pending?: boolean
  pendingLabel?: string
} & (
  | ({ as?: 'button' } & React.ButtonHTMLAttributes<HTMLButtonElement>)
  | ({ as: typeof Link } & React.ComponentProps<typeof Link>)
)

const base = 'rounded-control px-5 py-3 font-semibold border w-full sm:w-auto'
const primary = 'bg-ink text-paper border-ink twin-shadow [--shadow-offset:4px]'
const secondary = 'bg-field text-ink border-ink hover:bg-paper'

export function Button({ variant = 'primary', children, ...props }: ButtonProps) {
  const className = `${base} ${variant === 'primary' ? primary : secondary}`
  if (props.as === Link) {
    const { as: _as, ...linkProps } = props
    return <Link className={className} {...linkProps}>{children}</Link>
  }
  const { as: _as, pending, pendingLabel, ...buttonProps } = props
  return <button className={className} {...buttonProps}>{children}</button>
}
```

`src/components/ui/button.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import Link from 'next/link'
import { Button } from './button'

test('renders as a button by default', () => {
  render(<Button>Create account</Button>)
  expect(screen.getByRole('button', { name: 'Create account' })).toBeInTheDocument()
})

test('renders as a link when as={Link} is given', () => {
  render(<Button as={Link} href="/">Continue to Lively</Button>)
  expect(screen.getByRole('link', { name: 'Continue to Lively' })).toHaveAttribute('href', '/')
})
```

**Verify:** `pnpm test src/components/ui/button` — 2 pass.

## Step 7 — `Button`, part 2: pending state

```tsx
export function Button({ variant = 'primary', children, pending, pendingLabel, ...props }: ButtonProps) {
  const className = `${base} ${variant === 'primary' ? primary : secondary} ${pending ? 'opacity-60 cursor-not-allowed' : ''}`
  const label = pending && pendingLabel ? pendingLabel : children

  if (props.as === Link) {
    const { as: _as, ...linkProps } = props
    return <Link className={className} {...linkProps}>{label}</Link>
  }
  const { as: _as, ...buttonProps } = props
  return (
    <button className={className} disabled={pending} aria-disabled={pending} {...buttonProps}>
      {label}
    </button>
  )
}
```

```tsx
test('pending swaps the label and disables the button', () => {
  render(<Button pending pendingLabel="Creating account…">Create account</Button>)
  const btn = screen.getByRole('button')
  expect(btn).toBeDisabled()
  expect(btn).toHaveTextContent('Creating account…')
})
```

**Verify:** `pnpm test src/components/ui/button` — 3 pass. `Button` is complete.

## Step 8 — `TextField`

One concern: a labelled input with hint and error wiring via `useId()`.

`src/components/ui/text-field.tsx`:

```tsx
'use client'

import { useId } from 'react'

type TextFieldProps = {
  label: string
  name: string
  hint?: string
  errors?: React.ReactNode[]
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'name'>

export function TextField({ label, name, hint, errors, ...props }: TextFieldProps) {
  const id = useId()
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = errors?.length ? `${id}-error` : undefined

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-base font-semibold">{label}</label>
      <input
        id={id}
        name={name}
        aria-invalid={errors?.length ? 'true' : undefined}
        aria-describedby={[hintId, errorId].filter(Boolean).join(' ') || undefined}
        className={`bg-field border rounded-control px-3.5 py-3 text-base ${errors?.length ? 'border-2 border-rose' : 'border-ink'}`}
        {...props}
      />
      {hint ? <p id={hintId} className="text-sm">{hint}</p> : null}
      {errors?.length ? (
        <ul id={errorId} className="text-sm text-rose">
          {errors.map((e, i) => <li key={i}>{e}</li>)}
        </ul>
      ) : null}
    </div>
  )
}
```

`src/components/ui/text-field.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { TextField } from './text-field'

test('links the error list via aria-describedby and sets aria-invalid', () => {
  render(<TextField label="Email" name="email" errors={['Enter a valid email address.']} />)
  const input = screen.getByLabelText('Email')
  expect(input).toHaveAttribute('aria-invalid', 'true')
  const describedBy = input.getAttribute('aria-describedby')
  expect(document.getElementById(describedBy!)).toHaveTextContent('Enter a valid email address.')
})
```

**Verify:** `pnpm test src/components/ui/text-field` — passes.

## Step 9 — `PasswordField`

Builds on `TextField` — adds only the show/hide toggle.

`src/components/ui/password-field.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { TextField, type TextFieldProps } from './text-field'

export function PasswordField(props: Omit<TextFieldProps, 'type'>) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="relative">
      <TextField {...props} type={visible ? 'text' : 'password'} />
      <button
        type="button"
        aria-pressed={visible}
        onClick={() => setVisible((v) => !v)}
        className="absolute right-0 top-0 text-sm underline"
      >
        {visible ? 'Hide' : 'Show'}
      </button>
    </div>
  )
}
```

(`TextField` needs `export type TextFieldProps` added to its declaration for this import to work — a one-word change to Step 8's file.)

```tsx
import userEvent from '@testing-library/user-event'
import { PasswordField } from './password-field'

test('the toggle switches type and its own accessible name', async () => {
  render(<PasswordField label="Password" name="password" />)
  const input = screen.getByLabelText('Password')
  expect(input).toHaveAttribute('type', 'password')
  await userEvent.click(screen.getByRole('button', { name: 'Show' }))
  expect(input).toHaveAttribute('type', 'text')
  expect(screen.getByRole('button', { name: 'Hide' })).toHaveAttribute('aria-pressed', 'true')
})
```

**Verify:** `pnpm test src/components/ui/password-field` — passes.

## Step 10 — `FormMessage`

```tsx
type FormMessageProps = { tone: 'error' | 'success'; referenceId?: string; children: React.ReactNode }

export function FormMessage({ tone, referenceId, children }: FormMessageProps) {
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`border-l-[3px] pl-3 ${tone === 'error' ? 'border-rose' : 'border-leaf'}`}>
      <p>{children}</p>
      {referenceId ? <p className="text-sm">Reference: {referenceId}</p> : null}
    </div>
  )
}
```

```tsx
test('an error message with a reference id renders both lines under role alert', () => {
  render(<FormMessage tone="error" referenceId="req_1">Something failed.</FormMessage>)
  const alert = screen.getByRole('alert')
  expect(alert).toHaveTextContent('Something failed.')
  expect(alert).toHaveTextContent('Reference: req_1')
})
```

**Verify:** `pnpm test src/components/ui/form-message` — passes. All five primitives (`Button`, `TextField`, `PasswordField`, `FormMessage`, `TwinMark`) are done.

## Step 11 — `StepIndicator`

A client component (`usePathname`) — the one piece left before `AuthShell` can be assembled.

```tsx
'use client'

import { usePathname } from 'next/navigation'

type Step = { label: string; href: string }

export function StepIndicator({ steps }: { steps: Step[] }) {
  const pathname = usePathname()
  return (
    <ol className="flex flex-col gap-2 text-sm">
      {steps.map((step) => {
        const current = pathname.startsWith(step.href)
        return (
          <li key={step.href} aria-current={current ? 'step' : undefined} className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${current ? 'bg-ink' : 'border border-ink'}`} />
            {step.label}
          </li>
        )
      })}
    </ol>
  )
}
```

```tsx
import { vi } from 'vitest'
vi.mock('next/navigation', () => ({ usePathname: () => '/register/check-email' }))
import { StepIndicator } from './step-indicator'

test('marks the step matching the current path as current', () => {
  render(
    <StepIndicator steps={[{ label: 'Create account', href: '/register' }, { label: 'Confirm email', href: '/confirm-email' }]} />,
  )
  expect(screen.getByText('Create account').closest('li')).toHaveAttribute('aria-current', 'step')
  expect(screen.getByText('Confirm email').closest('li')).not.toHaveAttribute('aria-current')
})
```

**Verify:** `pnpm test src/components/ui/step-indicator` — passes.

## Step 12 — `AuthShell` (wiring: assembles Steps 5, 11 and children)

This is the one integration point in this doc — it only exists once `TwinMark` and `StepIndicator` are built, which is why it is the last step.

`src/app/(auth)/layout.tsx`:

```tsx
import Link from 'next/link'
import { StepIndicator } from '@/components/ui/step-indicator'
import { TwinMark } from '@/components/ui/twin-mark'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-dvh lg:grid-cols-12">
      <aside className="flex flex-col gap-10 px-6 pt-8 pb-4 lg:col-span-5 lg:justify-between lg:px-12 lg:py-14">
        <Link href="/" className="inline-flex w-fit items-center gap-3">
          <TwinMark />
          <span className="text-xl font-semibold">Lively</span>
        </Link>
        <div className="flex flex-col gap-4">
          <h1 className="text-display-md font-bold lg:text-display-lg">Come as you are.</h1>
          <p className="hidden max-w-[40ch] text-xl lg:block">Make a Lively account to post, follow, and find your people.</p>
        </div>
        <StepIndicator steps={[{ label: 'Create account', href: '/register' }, { label: 'Confirm email', href: '/confirm-email' }]} />
      </aside>
      <section className="flex items-start px-6 py-8 lg:col-span-7 lg:items-center lg:px-16">
        <div className="twin-panel w-full max-w-md p-6 sm:p-8 lg:p-10">{children}</div>
      </section>
    </main>
  )
}
```

**Verify:** this layout has no page yet — `04` Step 12 is what fills `children`. For now, add a temporary `src/app/(auth)/register/page.tsx` returning `<p>test</p>`, run `pnpm dev`, open `/register`, and confirm: two columns on desktop (single column on a narrow viewport), the brand panel with headline and step dots on the left, a bordered panel with an offset violet shadow on the right containing "test". Leave the layout in place; `04` replaces the temporary page content, not this file.

## Reference material (not steps — read before Steps 1–12, keep nearby while building)

### Layout wireframes

Register, desktop:

```text
┌────────────────────────────────┬──────────────────────────────────────────────┐
│ ◐ Lively                       │                                              │
│                                │        ┌───────────────────────────┐         │
│                                │        │ Create your account       │         │
│ Come as                        │        │ Display name              │         │
│ you are.                       │        │ [                        ]│         │
│                                │        │ Email                     │         │
│ Make a Lively account to post, │        │ [                        ]│         │
│ follow, and find your people.  │        │ Password            Show  │         │
│                                │        │ [                        ]│         │
│                                │        │ [ Create account       ]▄ │         │
│ ● Create account               │        │                           │         │
│ ○ Confirm email                │        └───────────────────────────┘▄▄▄▄     │
│                                │           ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀      │
└────────────────────────────────┴──────────────────────────────────────────────┘
   ▄ / ▀ = the solid violet offset copy
```

Confirm email — idle → confirmed. The offset shadow (left) becomes a flush 4px ring (right):

```text
┌─────────────────────────┐          ╔═════════════════════════╗
│ Confirm your email      │          ║ Email confirmed         ║
│ Click below to finish   │   ──►    ║ Your account is ready.  ║
│ setting up your Lively  │          ║ [ Continue to Lively ]  ║
│ account.                │          ╚═════════════════════════╝
│ [ Confirm email ]       │
└─────────────────────────┘▄
  ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀
```

### Motion

- The only unprompted motion is `.twin-panel`'s shadow transition on confirm (Step 4).
- Button hover/active states may add small transform shifts (under 150ms) — that is motion answering the pointer, not unprompted.
- Nothing fades or slides in on load.

### Accessibility floor

- Every input has a visible `<label>` — no placeholder-as-label.
- Focus ring 2px violet, 2px offset (Step 2), on every interactive element.
- Errors: `aria-invalid` + `aria-describedby` (Step 8) + a form-level `role="alert"` (Step 10).
- Async state changes announced via `aria-live="polite"` on the confirm card's section, or `role="status"` on success.
- Touch targets ≥ 44px tall on mobile.
- Test at 360px width and 200% zoom — nothing may overflow horizontally.

### Copy rules

- Sentence case everywhere, no ALL-CAPS labels.
- Buttons name the outcome: "Create account", "Confirm email", "Send a new link".
- Errors state what happened and what to do next; never apologize, never expose internals.
- No "→" glued to link/button text, no middle-dot metadata strings.
- Exact strings live in `04` and `05` — do not paraphrase them.

### Reviewed against the generic default

Before settling, this plan was compared with the default an unguided pass would produce:

- **Geist / Inter body font** → Bricolage Grotesque, one family, optical sizing doing the display/text split.
- **Centred white card floating on grey with a soft `rgba(0,0,0,.1)` shadow** → left-aligned two-column shell; the shadow is a hard violet copy, the brand idea itself, not decoration.
- **Cream + terracotta, or black + acid green** → cool lavender paper with indigo ink; violet used as a shape, not a gradient or glow.
- **All-caps eyebrow, "01 / 02" numerals** → an `<ol>` step indicator with dots, because the flow really is a sequence.
- **Anime/k-pop neon or mascot imagery** → none. The hidden layer is a hint (the second silhouette), never a reveal.
- **Fade-and-slide-up entrances** → a single state-change animation with meaning (alignment on confirmation).
- **Uniform 12px radius everywhere** → 4px on controls, 8px on the panel, 0 elsewhere.

If something built later starts to look like the rejected column, change it and note why here.

## Done when

- Steps 1–12 have each been run and verified in order.
- `pnpm test src/components/ui` passes end to end.
- `AuthShell` renders correctly at 360px, 1024px, and with OS dark mode on, per Step 12's manual check.
