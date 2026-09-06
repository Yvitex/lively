# 06 — Design system for the auth surface

## Goal

Give the register and confirm screens a look that belongs to Lively and to nothing else: one idea, a small token set, one typeface, and components that the flows in `04`/`05` can drop in. Read this before writing any `.tsx` or `globals.css`.

## Read first

- `node_modules/next/dist/docs/01-app/01-getting-started/11-css.md` (Tailwind 4 in this Next version)
- `node_modules/next/dist/docs/03-architecture/accessibility.md`
- Tailwind 4 `@theme` and `@utility` docs (tailwindcss.com/docs/theme, /docs/adding-custom-utilities)

## The idea: two selves

Lively has a public face and, underneath, a second self. The auth screens do not say that. They *show* it: every primary surface casts a **hard, solid violet copy of itself, offset down-right** — a second identity standing just behind the first. That is the single memorable element. On the confirmation screen, when the email is confirmed, the offset collapses and the two shapes align into one outlined form. Nothing else on these screens moves on its own.

Everything around that device is quiet: a cool paper ground, one typeface, ink borders, small radii, generous whitespace, left alignment.

## Tokens

Define these once in `src/app/globals.css`. Components use only the Tailwind utilities generated from them (`bg-paper`, `text-ink`, `border-ink`, `text-rose`, …) — no raw hex in components.

| Token | Light | Dark | Use |
|---|---|---|---|
| `paper` | `#F7F6FB` | `#14122A` | Page ground. Cool lavender-white — deliberately not cream. |
| `field` | `#FFFFFF` | `#1B1838` | Input backgrounds, the panel background. |
| `ink` | `#1E1B3A` | `#EEEBFF` | Text, borders. Indigo-black, not neutral near-black. |
| `violet` | `#4B3DEB` | `#8F80FF` | The shadow, primary emphasis, focus ring, links. |
| `mist` | `#DCD9EA` | `#2C2850` | Hairline dividers only. Never for input borders (fails 3:1). |
| `leaf` | `#0F7A4C` | `#3DD68C` | Success text and marks only. |
| `rose` | `#C42D48` | `#FF7A93` | Error text, invalid borders only. |

Contrast was checked for every text pairing used below (ink/paper 14:1, violet/paper 6.2:1, paper-on-violet 6.6:1, leaf/paper 5.0:1, rose/paper 5.1:1, dark violet/dark paper 4.6:1). If you change a value, re-check with a contrast tool before committing.

```css
@import 'tailwindcss';

@theme {
  --color-paper: #f7f6fb;
  --color-field: #ffffff;
  --color-ink: #1e1b3a;
  --color-violet: #4b3deb;
  --color-mist: #dcd9ea;
  --color-leaf: #0f7a4c;
  --color-rose: #c42d48;

  --font-sans: var(--font-bricolage), ui-sans-serif, system-ui, sans-serif;

  --text-display-lg: 3.8125rem;
  --text-display-lg--line-height: 1.02;
  --text-display-lg--letter-spacing: -0.02em;
  --text-display-md: 2.4375rem;
  --text-display-md--line-height: 1.05;
  --text-display-md--letter-spacing: -0.015em;
  --text-display-sm: 1.5625rem;
  --text-display-sm--line-height: 1.15;
  --text-display-sm--letter-spacing: -0.01em;

  --radius-control: 4px;
  --radius-panel: 8px;

  --shadow-offset: 12px;
  --ease-settle: cubic-bezier(0.2, 0.8, 0.2, 1);
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

  @media (max-width: 1023px) {
    :root {
      --shadow-offset: 6px;
    }
  }

  html {
    font-family: var(--font-sans);
    font-optical-sizing: auto;
  }

  body {
    background: var(--color-paper);
    color: var(--color-ink);
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
  .twin-panel {
    transition: none;
  }
}
```

Remove the scaffold's `--background`/`--foreground` variables and the `Arial, Helvetica` rule.

## Typography

One family: **Bricolage Grotesque** (variable; axes `wght`, `opsz`, `wdth`), loaded in `01`. `font-optical-sizing: auto` picks the optical size from the font size, so display text automatically gets the wide, characterful cut and body text the sturdier one. No second typeface. No monospace anywhere on these screens.

Scale (×1.25 from 16):

| Role | Size | Weight | Utility |
|---|---|---|---|
| Display large (brand H1, desktop) | 61 / 1.02 / −0.02em | 700 | `text-display-lg font-bold` |
| Display medium (brand H1, mobile) | 39 / 1.05 | 700 | `text-display-md font-bold` |
| Display small (form/section H2) | 25 / 1.15 | 600 | `text-display-sm font-semibold` |
| Lead (brand sub) | 20 / 1.4 | 400 | `text-xl` |
| Body | 16 / 1.55 | 400 | default |
| Small (hints, footers, steps) | 14 / 1.5 | 400 | `text-sm` |
| Label | 16 | 600 | `text-base font-semibold` |

Line length: body and lead capped at `max-w-prose` (65ch); brand sub at 40ch. Headings are sentence case. Do not accent a single word in a headline with colour or italics.

## Layout

Left-aligned throughout. Desktop (≥ 1024px) is a 12-column grid: brand panel 5, form 7. The form sits in a `twin-panel`, max-width 28rem, vertically centred. Mobile stacks; the brand panel shrinks to logo + H1 and the panel gets the 6px offset.

Register, desktop:

```text
┌────────────────────────────────┬──────────────────────────────────────────────┐
│ ◐ Lively                       │                                              │
│                                │        ┌───────────────────────────┐         │
│                                │        │ Create your account       │         │
│                                │        │                           │         │
│ Come as                        │        │ Display name              │         │
│ you are.                       │        │ [                        ]│         │
│                                │        │ Email                     │         │
│ Make a Lively account to post, │        │ [                        ]│         │
│ follow, and find your people.  │        │ Password            Show  │         │
│                                │        │ [                        ]│         │
│                                │        │ At least 10 characters.   │         │
│                                │        │                           │         │
│                                │        │ [ Create account       ]▄ │         │
│ ● Create account               │        │                           │         │
│ ○ Confirm email                │        │ Already have an account?  │         │
│                                │        └───────────────────────────┘▄▄▄▄     │
│                                │           ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀      │
└────────────────────────────────┴──────────────────────────────────────────────┘
   ▄ / ▀ = the solid violet offset copy
```

Register, mobile (≤ 1023px):

```text
┌──────────────────────────┐
│ ◐ Lively                 │
│ Come as you are.         │
│ ● Create account         │
│ ○ Confirm email          │
│ ┌──────────────────────┐ │
│ │ Create your account  │ │
│ │ Display name         │ │
│ │ [                   ]│ │
│ │ Email                │ │
│ │ [                   ]│ │
│ │ Password        Show │ │
│ │ [                   ]│ │
│ │ [ Create account   ] │ │
│ └──────────────────────┘▄│
│   ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀ │
└──────────────────────────┘
```

Check email (same shell, step 2 current):

```text
┌───────────────────────────────┐
│ Check your email              │
│                               │
│ We sent a confirmation link   │
│ to ren@example.com. It        │
│ expires in 24 hours.          │
│                               │
│ Didn't get it? Check your     │
│ spam folder, or send a new    │
│ one.                          │
│ Email                         │
│ [ ren@example.com           ] │
│ [ Send a new link ]           │
│                               │
│ Wrong address? Create your    │
│ account again.                │
└───────────────────────────────┘▄
```

Confirm email — idle → confirmed. The offset shadow (left) becomes a flush 4px ring (right):

```text
┌─────────────────────────┐          ╔═════════════════════════╗
│ Confirm your email      │          ║ Email confirmed         ║
│                         │          ║                         ║
│ Click below to finish   │   ──►    ║ Your account is ready.  ║
│ setting up your Lively  │          ║                         ║
│ account.                │          ║ [ Continue to Lively ]  ║
│                         │          ║                         ║
│ [ Confirm email ]       │          ╚═════════════════════════╝
└─────────────────────────┘▄
  ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀
```

## Components — `src/components/ui/`

All are Server Components unless marked. Props listed are the minimum the flows need; do not add variants nobody uses.

### `AuthShell` — `src/app/(auth)/layout.tsx`

```tsx
import Link from 'next/link'
import { StepIndicator } from '@/components/ui/step-indicator'
import { TwinMark } from '@/components/ui/twin-mark'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-dvh lg:grid-cols-12">
      <aside className="flex flex-col gap-10 px-6 pt-8 pb-4 lg:col-span-5 lg:justify-between lg:px-12 lg:py-14">
        <Link href="/" className="inline-flex w-fit items-center gap-3 rounded-control">
          <TwinMark />
          <span className="text-xl font-semibold">Lively</span>
        </Link>
        <div className="flex flex-col gap-4">
          <h1 className="text-display-md font-bold lg:text-display-lg">Come as you are.</h1>
          <p className="hidden max-w-[40ch] text-xl lg:block">
            Make a Lively account to post, follow, and find your people.
          </p>
        </div>
        <StepIndicator
          steps={[
            { label: 'Create account', href: '/register' },
            { label: 'Confirm email', href: '/confirm-email' },
          ]}
        />
      </aside>
      <section className="flex items-start px-6 py-8 lg:col-span-7 lg:items-center lg:px-16">
        <div className="twin-panel w-full max-w-md p-6 sm:p-8 lg:p-10">{children}</div>
      </section>
    </main>
  )
}
```

### `TwinMark` — the logo mark

Two profile silhouettes, the back one in violet offset (+6, +6), the front one in ink. Pure SVG, 40×40, `aria-hidden` (the wordmark text next to it is the accessible name).

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

### `StepIndicator` (client — uses `usePathname`)

An `<ol>` with two items. The current step (matched by pathname prefix; `/register/check-email` counts as step 2) has a filled ink dot and `aria-current="step"`; others an outlined dot. Text 14px. No numerals: the dots and order already say "sequence". Items are plain text, not links — the user must not jump ahead. The `href` in the props is only used for matching.

### `Button`

```tsx
type ButtonProps = {
  children: React.ReactNode
  variant?: 'primary' | 'secondary'
  pending?: boolean
  pendingLabel?: string
} & (
  | ({ as?: 'button' } & React.ButtonHTMLAttributes<HTMLButtonElement>)
  | ({ as: typeof Link } & React.ComponentProps<typeof Link>)
)
```

Primary: `bg-ink text-paper border border-ink rounded-control px-5 py-3 font-semibold twin-shadow` with `--shadow-offset` overridden to 4px on the element (`[--shadow-offset:4px]`). Hover: `-translate-x-px -translate-y-px [--shadow-offset:5px]`. Active: `translate-x-0.5 translate-y-0.5 [--shadow-offset:2px]`. Transition 120ms on transform and box-shadow. Disabled/pending: `opacity-60 cursor-not-allowed`, no hover movement, label swapped to `pendingLabel`, `aria-disabled="true"` and `disabled`.

Secondary: `bg-field text-ink border border-ink rounded-control px-5 py-3 font-semibold`, no shadow; hover `bg-paper`.

When `as={Link}` render a Next `Link` with the same classes. Full width on mobile (`w-full sm:w-auto`).

### `TextField`

```tsx
type TextFieldProps = {
  label: string
  name: string
  hint?: string
  errors?: React.ReactNode[]
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'name'>
```

Renders, in order: `<label htmlFor>` (16/600), `<input>` (`bg-field border border-ink rounded-control px-3.5 py-3 text-base`, `aria-invalid` and `border-2 border-rose` when errors), hint `<p id=…-hint className="text-sm">`, error list `<ul id=…-error className="text-sm text-rose">`. `aria-describedby` joins hint and error ids that exist. Use `useId()` for ids — this makes it a client component; that is fine, it holds no state.

### `PasswordField` (client)

`TextField` plus a "Show"/"Hide" toggle: a small secondary-style `<button type="button" aria-pressed>` placed at the label row's right edge, toggling `type` between `password` and `text`. Never a bare icon; the word is the label.

### `FormMessage`

```tsx
type FormMessageProps = { tone: 'error' | 'success'; referenceId?: string; children: React.ReactNode }
```

`role="alert"` for error, `role="status"` for success. A 3px left rule in `rose`/`leaf`, padding-left 12px, text ink. When `referenceId` is given, a second line in `text-sm`: `Reference: {referenceId}`. No icons.

## Motion

- The **only** unprompted motion: `.twin-panel` shadow transition on confirm (400ms, `--ease-settle`).
- Button hover/active transforms (120ms) — motion answering the pointer.
- Nothing fades or slides in on load. No skeleton shimmer on these pages; they render instantly.
- `prefers-reduced-motion: reduce` disables the panel transition; button transforms may stay (they are under 150ms and user-initiated) but drop the translate and keep only the shadow change.

## Accessibility floor

- Every input has a visible `<label>`. Placeholders are not labels; do not use them.
- Focus ring: 2px violet, 2px offset, on `:focus-visible`, on every interactive element including links.
- Errors: `aria-invalid`, `aria-describedby`, and the form-level message in `role="alert"`.
- Async state changes announced via `aria-live="polite"` on the containing section (confirm card) or `role="status"` (resend).
- Colour is never the only signal: errors have text, the confirmed state changes the heading, the step indicator uses fill + `aria-current`.
- Touch targets ≥ 44px tall on mobile (`py-3` + line height achieves this).
- Test at 360px width and at 200% zoom; nothing may overflow horizontally.

## Copy rules

- Sentence case everywhere. No ALL-CAPS labels or eyebrows.
- Buttons name the outcome: "Create account", "Confirm email", "Send a new link". Success copy reuses the verb: "Email confirmed" mirrors "Confirm email".
- Errors state what happened and what to do next; they never apologise and never expose internals.
- No "→" or "›" glued to link/button text. No middle-dot metadata strings.
- Exact strings live in `04` and `05`. Do not paraphrase them.

## Reviewed against the generic default

Before settling, the plan was compared with what a default auth page would be. These were rejected:

- **Geist / Inter body font** → Bricolage Grotesque, one family, optical sizing doing the display/text split.
- **Centred white card floating on grey with a soft `rgba(0,0,0,.1)` shadow** → left-aligned two-column shell; the card has an ink border and a hard violet copy. The shadow *is* the brand idea, not decoration.
- **Cream `#F4F1EA` + terracotta accent, or black + acid green** → cool lavender paper with indigo ink; violet is used as a shape, not as a gradient or glow.
- **All-caps eyebrow above the heading, "01 / 02" numerals** → an `<ol>` step indicator with dots, because the flow really is a sequence and dots already encode it.
- **Anime/k-pop neon or mascot imagery** → none. The hidden layer is a hint (the second silhouette), not a reveal.
- **Fade-and-slide-up entrances** → a single state-change animation with meaning (alignment on confirmation).
- **Uniform 12px radius on everything** → 4px on controls, 8px on the panel, 0 elsewhere.

If, while building, something starts to look like the rejected column, change it and note why here.
