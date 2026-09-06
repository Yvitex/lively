# 01 — Foundation

## Goal

Turn the bare `create-next-app` scaffold into a strict, `src/`-based project with validated env, security headers, the brand font, and the scripts CI will run. Nothing feature-specific yet.

## Read first

- `node_modules/next/dist/docs/01-app/01-getting-started/02-project-structure.md` (top-level files, `src/`, route groups)
- `node_modules/next/dist/docs/01-app/01-getting-started/13-fonts.md` and `03-api-reference/02-components/font.md` (`axes`)
- `node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md` ("Without Nonces" section)
- `node_modules/next/dist/docs/01-app/02-guides/environment-variables.md`

## Do

### 1. Package manager and dependencies

Switch to pnpm while the project is empty (matches `ARCHITECTURE.md` §1). Delete `package-lock.json` after `pnpm install` succeeds.

```bash
corepack enable
pnpm install
pnpm add zod server-only
pnpm add -D vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/dom @testing-library/user-event @testing-library/jest-dom vite-tsconfig-paths @playwright/test prettier prettier-plugin-tailwindcss
pnpm exec playwright install --with-deps chromium
```

`zod` installs v4. Use v4 APIs throughout (`z.email()`, `z.flattenError()`, `{ error: '…' }` for messages). Do not copy v3 snippets.

### 2. Scripts

Replace the `scripts` block in `package.json`:

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "typecheck": "tsc --noEmit",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "audit": "pnpm audit --audit-level=high"
  }
}
```

Add `.prettierrc`:

```json
{ "semi": false, "singleQuote": true, "plugins": ["prettier-plugin-tailwindcss"] }
```

and `.prettierignore` with `.next`, `node_modules`, `pnpm-lock.yaml`, `instruct`.

### 3. TypeScript

In `tsconfig.json` add to `compilerOptions`:

```json
"noUncheckedIndexedAccess": true,
"noImplicitOverride": true,
"paths": { "@/*": ["./src/*"] }
```

Keep `"strict": true`. `forceConsistentCasingInFileNames` is already implied by the Next preset; add it explicitly if the typecheck script does not complain.

### 4. Move to `src/`

```text
src/
├── app/
│   ├── (auth)/
│   │   ├── layout.tsx              # AuthShell — see 06
│   │   ├── register/
│   │   │   ├── page.tsx
│   │   │   └── check-email/page.tsx
│   │   ├── confirm-email/page.tsx
│   │   └── login/page.tsx          # one-line stub so links resolve; not built in this phase
│   ├── error.tsx
│   ├── global-error.tsx
│   ├── not-found.tsx
│   ├── layout.tsx
│   ├── page.tsx
│   └── globals.css
├── components/
│   └── ui/                         # Button, TextField, PasswordField, FormMessage, StepIndicator, TwinMark
├── features/
│   └── auth/
│       ├── actions.ts              # Server Actions
│       ├── validation.ts           # Zod schemas shared by client + server
│       └── components/
│           ├── register-form.tsx
│           ├── confirm-email-card.tsx
│           └── resend-form.tsx
├── lib/
│   ├── api/
│   │   ├── client.ts
│   │   └── auth.ts
│   ├── errors/index.ts
│   ├── env.ts
│   ├── logger.ts
│   └── rate-limit.ts
└── config/
    └── site.ts                     # name, description, APP_URL-derived helpers
```

Move `app/` into `src/app/`. Update `tsconfig.json` `include` (it already uses globs) and confirm `pnpm dev` still serves `/`. Replace the placeholder text in `src/app/page.tsx` with a plain heading and a link to `/register`; the home page is not designed in this phase.

Add `src/app/error.tsx`, `global-error.tsx`, `not-found.tsx` now — minimal, using the tokens from `06`. `error.tsx` must be a client component, show a safe message and a reference id (see `03` logger), and offer "Try again" via `reset()`.

### 5. Environment

`.env.example` (commit this):

```env
# Server-only. Never prefix these with NEXT_PUBLIC_.
BACKEND_API_URL=http://localhost:4000
BACKEND_API_KEY=
APP_URL=http://localhost:3000
REQUEST_TIMEOUT_MS=5000
```

`.env.local` is git-ignored by the scaffold; verify `.gitignore` contains `.env*` and does not ignore `.env.example`.

`src/lib/env.ts`:

```ts
import 'server-only'
import { z } from 'zod'

const EnvSchema = z.object({
  BACKEND_API_URL: z.url(),
  BACKEND_API_KEY: z.string().min(1).optional(),
  APP_URL: z.url(),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
})

const parsed = EnvSchema.safeParse(process.env)

if (!parsed.success) {
  console.error(z.prettifyError(parsed.error))
  throw new Error('Invalid environment variables')
}

export const env = parsed.data
```

`import 'server-only'` makes any accidental client import a build error. That is the whole point of the package; keep it.

### 6. Security headers

`next.config.ts`:

```ts
import type { NextConfig } from 'next'

const isDev = process.env.NODE_ENV === 'development'

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(isDev ? [] : ['upgrade-insecure-requests']),
].join('; ')

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'X-Frame-Options', value: 'DENY' },
  ...(isDev
    ? []
    : [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }]),
]

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }]
  },
}

export default nextConfig
```

`font-src 'self'` works because `next/font` self-hosts. `connect-src 'self'` is enough because the browser only ever talks to this app. Nonce-based CSP would force every page dynamic; it is a deliberate non-goal for now. Revisit when the app has third-party scripts.

### 7. Root layout and font

Replace Geist with Bricolage Grotesque. It is a variable font with optical-size and width axes; one family covers display and text.

`src/app/layout.tsx`:

```tsx
import type { Metadata } from 'next'
import { Bricolage_Grotesque } from 'next/font/google'
import './globals.css'

const bricolage = Bricolage_Grotesque({
  subsets: ['latin'],
  axes: ['opsz', 'wdth'],
  variable: '--font-bricolage',
  display: 'swap',
})

export const metadata: Metadata = {
  title: { default: 'Lively', template: '%s — Lively' },
  description: 'Post, follow, and find your people.',
  metadataBase: new URL(process.env.APP_URL ?? 'http://localhost:3000'),
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${bricolage.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-paper text-ink">{children}</body>
    </html>
  )
}
```

`bg-paper` / `text-ink` come from the `@theme` block defined in `06-design-system.md`; write `globals.css` from that doc at the same time.

### 8. Lint

Keep `eslint-config-next`. Add to `eslint.config.mjs` an ignore for `instruct/**` and the rule `"@next/next/no-img-element": "error"`. Run `pnpm lint` and fix anything the move created.

## Do not

- Do not add a UI kit (shadcn, MUI, Radix themes). Components are specified in `06`.
- Do not create `proxy.ts` yet. Nothing in this phase needs request interception.
- Do not add `NEXT_PUBLIC_*` variables. If you think you need one, you are about to call the backend from the browser — stop.
- Do not enable `experimental.serverActions.allowedOrigins` unless you actually deploy behind a proxy whose `Host` differs from the public origin.
- Do not keep the scaffold's `Arial, Helvetica` body font rule in `globals.css`.

## Done when

- `pnpm typecheck && pnpm lint && pnpm build` all pass.
- `pnpm dev` serves `/`, `/register` (may be a stub), and the security headers appear in the response (`curl -I http://localhost:3000`).
- Removing `BACKEND_API_URL` from `.env.local` makes the server fail fast with the Zod error, not a runtime `undefined`.
- `git status` shows `package-lock.json` deleted and `pnpm-lock.yaml` added.
