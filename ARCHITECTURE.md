AS AN AGENT, YOU ARE RESPONSIBLE FOR MAKING SURE THAT THE CODEBASE ADHERE TO BEST PRACTICES

## 1. Start with a solid baseline

For a new app, I’d generally use:

```text
Next.js App Router
TypeScript
ESLint
Prettier
pnpm
React Server Components
Zod for validation
Vitest/Jest for unit tests
Playwright for E2E
Sentry or equivalent for monitoring
CI/CD through GitHub Actions / GitLab CI
```

The App Router is the modern direction for Next.js, and the official learning material emphasizes Server Components, streaming, server-side validation, authentication, metadata, and cache revalidation. ([Next.js][2])

A reasonable project layout:

```text
src/
├── app/
│   ├── (auth)/
│   ├── (dashboard)/
│   ├── api/
│   ├── error.tsx
│   ├── global-error.tsx
│   ├── loading.tsx
│   ├── not-found.tsx
│   ├── layout.tsx
│   └── page.tsx
│
├── components/
│   ├── ui/
│   ├── forms/
│   └── features/
│
├── features/
│   ├── users/
│   ├── billing/
│   └── orders/
│
├── lib/
│   ├── api/
│   ├── auth/
│   ├── validation/
│   ├── errors/
│   └── utils/
│
├── hooks/
├── types/
└── config/
```

Try to organize large applications **by feature/domain**, rather than creating gigantic folders containing hundreds of unrelated components.

---

# 2. Use TypeScript strictly

For production, avoid treating TypeScript as optional documentation.

Consider:

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

Avoid:

```ts
const data: any = ...
```

Prefer:

```ts
interface User {
  id: string
  email: string
}
```

But there's an important distinction:

> **TypeScript does not validate external data at runtime.**

Anything coming from:

* an API
* URL parameters
* cookies
* forms
* local storage
* third-party services

should still be validated.

For example with Zod:

```ts
import { z } from "zod"

export const UserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
})

export type User = z.infer<typeof UserSchema>
```

Next.js itself teaches validating submitted data before processing mutations. ([Next.js][3])

---

# 3. Default to Server Components

This is one of the biggest architectural choices in modern Next.js.

A good rule is:

```text
Server Component by default
      ↓
Need browser APIs/state/interactivity?
      ↓
Client Component
```

Don't begin every component with:

```ts
"use client"
```

Use Client Components when you need things like:

```text
useState
useEffect
onClick
window
document
localStorage
browser-only libraries
```

For example:

```tsx
export default async function ProductsPage() {
  const products = await getProducts()

  return <ProductList products={products} />
}
```

This can remain server-rendered.

Then isolate interactivity:

```tsx
"use client"

export function AddToCartButton() {
  // interactive logic
}
```

Keeping the client boundary small usually means:

* less JavaScript shipped
* faster hydration
* better initial performance
* less exposure of sensitive logic

---

# 4. Be deliberate about rendering

Don't make everything SSR.

And don't make everything static either.

Use the rendering model that matches the data.

### Static

Great for:

```text
Marketing pages
Documentation
Blog posts
Landing pages
Public product information
```

Static rendering can be cached and globally distributed, giving very fast responses. ([Next.js][4])

### Dynamic/server rendered

Good for:

```text
Account dashboards
Personalized pages
Permission-dependent pages
Real-time user information
```

### Revalidated/cached

Great for things like:

```text
Product catalogs
CMS content
Public dashboards
Frequently read data
```

Think in terms of:

```text
How fresh must this data be?

1 year?
1 hour?
1 minute?
Every request?
```

Then choose caching accordingly.

---

# 5. Understand Next.js caching before production

This one causes a surprising number of production bugs.

Understand at minimum:

```text
Request memoization
Data caching
Route caching
Client router caching
revalidatePath()
revalidateTag()
use cache
```

For mutations, invalidate the relevant cached data rather than globally refreshing everything.

For example:

```ts
revalidateTag("products")
```

or:

```ts
revalidatePath("/products")
```

Next.js explicitly integrates Server Actions with cache invalidation through APIs such as `revalidatePath` and `revalidateTag`. ([Next.js][3])

---

# 6. Keep secrets on the server

Never expose secrets through environment variables prefixed with:

```text
NEXT_PUBLIC_
```

Anything like:

```text
NEXT_PUBLIC_API_KEY
```

should be assumed readable by the browser.

Good:

```env
DATABASE_URL=
STRIPE_SECRET_KEY=
AUTH_SECRET=
```

Public:

```env
NEXT_PUBLIC_APP_URL=
NEXT_PUBLIC_GOOGLE_MAPS_ID=
```

Your frontend architecture should preferably look like:

```text
Browser
   ↓
Next.js server
   ↓
Backend/API
```

rather than:

```text
Browser
   ↓
Private internal backend
```

when credentials or privileged operations are involved.

---

# 7. Validate everything server-side

Never trust:

```text
Form data
Query strings
Request bodies
Route params
Cookies
Headers
Client state
```

For example:

```ts
const schema = z.object({
  email: z.string().email(),
  age: z.number().int().min(18).max(120),
})
```

Then:

```ts
const result = schema.safeParse(payload)

if (!result.success) {
  return {
    error: "Invalid request",
  }
}
```

Client-side validation is for **UX**.

Server-side validation is for **security and correctness**.

---

# 8. Authentication is not authorization

A logged-in user isn't automatically allowed to perform an action.

Don't rely solely on:

```ts
if (!session) redirect("/login")
```

For sensitive operations, check authorization at the point where the operation happens.

For example:

```ts
const session = await auth()

if (!session?.user) {
  throw new UnauthorizedError()
}

const project = await getProject(projectId)

if (project.ownerId !== session.user.id) {
  throw new ForbiddenError()
}
```

The same rule applies to Server Actions.

Treat Server Actions like public endpoints—they must authenticate, authorize, and validate input.

Next.js' own examples demonstrate protecting authenticated routes and using authentication configuration on the server side. ([Next.js][5])

---

# 9. Don't hide authorization only in middleware

Middleware/proxy logic is useful for things like:

```text
Basic route gating
Redirects
Locale detection
Header manipulation
Authentication shortcuts
```

But don't make it your **only** security layer.

Authorization should also occur inside:

```text
Server Actions
Route handlers
Backend/API
Database access layer
```

Think:

```text
Middleware = early gate
Server code = actual enforcement
```

---

# 10. Add proper security headers

At a minimum, investigate:

```text
Content-Security-Policy
Strict-Transport-Security
X-Content-Type-Options
Referrer-Policy
Permissions-Policy
```

For example:

```ts
const securityHeaders = [
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
]
```

A proper **Content Security Policy** is particularly valuable for mitigating XSS.

Don't blindly copy a CSP from Stack Overflow, though—it should match your actual script, image, font, analytics, CDN, and API requirements.

---

# 11. Treat dependencies as an attack surface

Especially after the RSC-related vulnerabilities disclosed in late 2025, keeping Next.js and React patched isn't housekeeping; it's security work. Next.js published critical and high-severity advisories affecting multiple major versions and instructed users to upgrade. ([Next.js][6])

Have CI run:

```bash
pnpm audit
```

and use something like:

```text
Dependabot
Renovate
Snyk
Socket
```

Don't automatically merge every major dependency update, but don't let dependencies sit untouched for years either.

Commit your lockfile:

```text
pnpm-lock.yaml
```

---

# 12. Create one API layer

Avoid random fetch calls scattered through components:

```tsx
fetch("/api/users")
```

here, another:

```tsx
axios.get("/api/orders")
```

somewhere else, and another entirely different abstraction later.

Create a consistent client:

```text
lib/
└── api/
    ├── client.ts
    ├── users.ts
    ├── orders.ts
    └── products.ts
```

For example:

```ts
export async function getUsers() {
  const response = await fetch(`${API_URL}/users`)

  if (!response.ok) {
    throw new ApiError(response.status)
  }

  return UserListSchema.parse(await response.json())
}
```

That gives you one place for:

```text
Authentication
Error handling
Timeouts
Headers
Logging
Validation
Retry behavior
```

---

# 13. Always implement request timeouts

This gets overlooked constantly.

Don't allow an upstream API to hang indefinitely.

For example:

```ts
const controller = new AbortController()

const timeout = setTimeout(() => {
  controller.abort()
}, 5000)

try {
  return await fetch(url, {
    signal: controller.signal,
  })
} finally {
  clearTimeout(timeout)
}
```

Use appropriate limits depending on the operation.

---

# 14. Be conservative with retries

Retries are useful for:

```text
GET requests
Temporary network failures
Occasional 502/503 responses
```

Be extremely careful retrying:

```text
POST
payments
orders
email sending
account creation
```

because:

```text
retry → duplicate operation
```

For important mutations, use **idempotency keys**.

---

# 15. Handle all UI states

Every async UI should generally have:

```text
Loading
Success
Empty
Error
Permission denied
```

For example:

```text
app/
├── loading.tsx
├── error.tsx
├── not-found.tsx
└── page.tsx
```

Avoid screens that simply become blank if the backend responds unexpectedly.

---

# 16. Don't expose internal errors to users

Bad:

```text
Database connection timeout to postgres://prod-db-2.internal...
```

Good:

```text
Something went wrong while loading this page.
Please try again.
```

Log the actual error server-side:

```ts
logger.error(error)
```

Show the user a safe error ID:

```text
Something went wrong.

Reference: ERR-F93A21
```

That makes production debugging much easier.

---

# 17. Build structured logging

Avoid depending on:

```ts
console.log("hello")
```

for production diagnostics.

Use structured logs:

```json
{
  "level": "error",
  "requestId": "req_18372",
  "userId": "usr_123",
  "route": "/checkout",
  "durationMs": 583,
  "error": "Payment API timeout"
}
```

Tools could include:

```text
Sentry
Datadog
New Relic
OpenTelemetry
Grafana
Better Stack
```

---

# 18. Use request/correlation IDs

Ideally:

```text
Browser
 ↓
Next.js
 ↓
API
 ↓
Service
 ↓
Database
```

shares something like:

```text
x-request-id: 7fb26a...
```

Then when something breaks, you can follow one request throughout the system.

This becomes incredibly valuable once you have more than one service.

---

# 19. Monitor Web Vitals

Track at least:

```text
LCP
Largest Contentful Paint

INP
Interaction to Next Paint

CLS
Cumulative Layout Shift
```

Also watch:

```text
TTFB
JS bundle size
API response time
error rate
server action latency
```

Your app shouldn't merely be "up"; it should remain fast.

---

# 20. Keep client JavaScript small

One of Next.js's biggest benefits disappears if you ship a massive JavaScript bundle.

Be suspicious of:

```text
Huge chart libraries
Entire icon packages
Moment.js-sized date packages
Large rich-text editors
Heavy animation frameworks
Whole utility libraries
```

Use dynamic imports where appropriate:

```tsx
const Editor = dynamic(() => import("./Editor"), {
  ssr: false,
})
```

But don't dynamically import everything either.

Use bundle analysis periodically.

---

# 21. Optimize images properly

Prefer:

```tsx
import Image from "next/image"
```

over:

```html
<img>
```

when appropriate.

Specify dimensions:

```tsx
<Image
  src="/product.jpg"
  alt="Product"
  width={800}
  height={600}
/>
```

This helps avoid layout shifts and lets Next.js optimize delivery.

Next.js' App Router materials specifically include optimized image/font handling as part of its production-oriented optimization model. ([Next.js][2])

---

# 22. Optimize fonts

Prefer Next.js font optimization:

```ts
import { Inter } from "next/font/google"

const inter = Inter({
  subsets: ["latin"],
})
```

instead of external `<link>` tags where possible.

It helps with:

```text
Performance
Privacy
Layout stability
Caching
```

---

# 23. Accessibility is a production requirement

Check at minimum:

```text
Keyboard navigation
Visible focus states
ARIA where necessary
Semantic HTML
Form labels
Alt text
Color contrast
Screen-reader behavior
Reduced-motion support
```

Prefer:

```tsx
<button>
```

rather than:

```tsx
<div onClick={...}>
```

No amount of Tailwind can redeem a clickable `<div>` pretending to be a button. 😄

---

# 24. Build forms defensively

A good form usually needs:

```text
Client validation
Server validation
Disabled/loading state
Double-submit protection
Clear error messages
Success feedback
Accessibility
```

For sensitive operations:

```text
Disable duplicate submissions
+
use server-side idempotency
```

---

# 25. Use URL state where appropriate

For:

```text
Search
Filters
Sorting
Pagination
Tabs
```

prefer:

```text
/products?q=laptop&page=2&sort=price
```

over burying everything in React state.

Benefits:

```text
Shareable URLs
Browser Back works
Refresh works
Deep linking works
SSR-friendly
```

Next.js' current App Router course explicitly demonstrates search and pagination using URL search parameters. ([Next.js][2])

---

# 26. Separate UI state from server state

UI state:

```text
Modal open?
Sidebar expanded?
Selected tab?
```

Server state:

```text
User profile
Products
Orders
Permissions
```

Don't dump everything into:

```text
Redux
Zustand
Context
```

just because you can.

With Server Components, URL state, and server-side fetching, many modern Next.js apps need considerably less global state than older React SPAs.

---

# 27. Don't overuse `useEffect`

This pattern should make you pause:

```tsx
useEffect(() => {
  fetchData()
}, [])
```

If the data can be loaded server-side:

```tsx
export default async function Page() {
  const data = await getData()
}
```

that's usually preferable.

Use `useEffect` for genuine browser-side effects—not as your universal data-fetching system.

---

# 28. Control concurrency and data waterfalls

Bad:

```text
Fetch A
wait

Fetch B
wait

Fetch C
wait
```

Total:

```text
200 ms
+ 300 ms
+ 400 ms
= 900 ms
```

When independent:

```ts
const [user, products, permissions] = await Promise.all([
  getUser(),
  getProducts(),
  getPermissions(),
])
```

Potentially:

```text
~400 ms
```

The official Next.js material explicitly calls out accidental request waterfalls as something to avoid. ([Next.js][4])

---

# 29. Use streaming strategically

For dashboards:

```text
┌───────────────────────────┐
│ Navigation                │
├───────────────────────────┤
│ User profile              │
├─────────────┬─────────────┤
│ Stats       │ Activity    │
│ loading...  │ loaded      │
└─────────────┴─────────────┘
```

You don't necessarily want the entire page blocked by one slow API.

Use:

```tsx
<Suspense fallback={<Skeleton />}>
  <DashboardStats />
</Suspense>
```

to stream independent UI boundaries.

---

# 30. Have environment separation

At minimum:

```text
local
development
preview/staging
production
```

Prefer:

```text
dev API
staging API
production API
```

not:

```text
local app → production database
```

Your future self will thank you profusely.

---

# 31. Preview every pull request

A strong workflow is:

```text
Feature branch
      ↓
Pull Request
      ↓
CI
      ↓
Preview deployment
      ↓
Review
      ↓
Merge
      ↓
Production
```

Next.js/Vercel's own recommended deployment approach centers around develop → preview → ship workflows. ([Next.js][7])

If using Vercel, PR preview environments fit naturally.

Other hosting platforms are perfectly valid too; Next.js supports standard Node.js-based production deployments through `next build` / `next start`. ([Next.js][8])

---

# 32. Your CI pipeline should block bad code

Something roughly like:

```text
Install dependencies
      ↓
Lint
      ↓
Type check
      ↓
Unit tests
      ↓
Build Next.js
      ↓
E2E tests
      ↓
Security/dependency scan
      ↓
Deploy
```

Typical commands:

```bash
pnpm install --frozen-lockfile

pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm playwright test
```

Production should never be the first place you discover:

```text
next build
```

fails.

---

# 33. Write three levels of tests

### Unit tests

Test things such as:

```text
Formatters
Validators
Business logic
Utility functions
```

### Integration tests

Test:

```text
Forms
Authentication logic
API interactions
Component behavior
```

### E2E tests

Test critical user journeys:

```text
Login
Sign up
Create project
Checkout
Payment
Password reset
Admin permissions
Logout
```

With something like Playwright:

```ts
test("user can log in", async ({ page }) => {
  await page.goto("/login")

  await page.getByLabel("Email").fill("user@example.com")
  await page.getByLabel("Password").fill("password")

  await page.getByRole("button", {
    name: "Sign in",
  }).click()

  await expect(page).toHaveURL("/dashboard")
})
```

Don't try to achieve 100% coverage.

Protect the workflows whose failure would ruin someone's morning.

---

# 34. Add rate limiting

Especially for:

```text
Login
Registration
Password reset
Contact forms
Search APIs
AI endpoints
Uploads
Expensive server actions
```

For example conceptually:

```text
/login

5 attempts
per minute
per IP/user
```

Rate limits should ideally exist at more than one layer for important services.

---

# 35. Handle bots and abuse

Public production apps eventually get bots.

Assume:

```text
Forms will be spammed
Endpoints will be crawled
Login will be brute-forced
Expensive endpoints will be hammered
```

Consider:

```text
Rate limiting
CAPTCHA/Turnstile for suspicious requests
WAF
Bot management
IP reputation
Email verification
```

---

# 36. Be careful with file uploads

Never trust:

```text
filename
extension
Content-Type
file size
```

Validate server-side.

Consider uploading directly to object storage:

```text
Browser
   ↓
Signed upload URL
   ↓
S3 / R2 / Blob Storage
```

rather than routing huge files through your Next.js server.

Also enforce:

```text
Size limits
Allowed MIME types
Authentication
Virus/malware scanning where appropriate
```

---

# 37. Use CSP and safe rendering against XSS

Avoid:

```tsx
dangerouslySetInnerHTML
```

unless you control or sanitize the input.

If you're rendering CMS HTML, Markdown, comments, etc., use a trusted sanitizer.

Never assume:

```text
"The backend already cleaned it."
```

Layer defenses.

---

# 38. Protect against CSRF where relevant

Especially if authentication relies on cookies and operations mutate server-side state.

Use:

```text
SameSite cookies
Origin checking
CSRF tokens where necessary
Framework protections
```

Don't blindly invent your own authentication protocol.

---

# 39. Use secure cookies

Auth cookies should generally be configured appropriately with:

```text
HttpOnly
Secure
SameSite
```

Example conceptually:

```text
HttpOnly=true
Secure=true
SameSite=Lax
```

Never put sensitive access tokens into readable browser storage unless the architecture explicitly calls for it and you've evaluated the consequences.

---

# 40. Avoid sensitive data in `localStorage`

Don't store things like:

```text
Long-lived access tokens
Passwords
Payment information
Sensitive user records
```

in:

```js
localStorage
```

JavaScript running in the page can read it.

---

# 41. Add observability before launch

At minimum monitor:

```text
Frontend exceptions
Server exceptions
API errors
HTTP status rates
Deployment failures
Web Vitals
API latency
Availability
Authentication failures
```

Set alerts for things like:

```text
5xx > threshold
error rate spike
latency spike
login failures spike
payment failures
deployment regression
```

You don't want your users to be your monitoring system.

---

# 42. Implement health checks

Something like:

```text
/api/health
```

returning:

```json
{
  "status": "ok"
}
```

Potentially separate:

```text
/health/live
/health/ready
```

if you're using Kubernetes or container orchestration.

But don't expose unnecessary infrastructure details.

---

# 43. Define feature flags

For risky features:

```text
ENABLE_NEW_CHECKOUT
ENABLE_AI_SEARCH
ENABLE_NEW_DASHBOARD
```

This lets you deploy code independently from releasing it.

Better still, use controlled rollout:

```text
5%
↓
25%
↓
50%
↓
100%
```

---

# 44. Plan rollback before deployment

You should know the answer to:

> "Production is broken. How do we get yesterday's version back?"

before production is broken.

You want:

```text
Immutable deployments
Previous versions
Fast rollback
Database backward compatibility
```

The database part is particularly important.

---

# 45. Make database changes backward-compatible

Even if Next.js is only your frontend/backend-for-frontend, deployments can overlap.

Don't do:

```text
Deploy DB:
rename user.email → user.email_address

Immediately deploy frontend expecting only email_address
```

Prefer migration phases:

```text
1. Add new field
2. Support both
3. Migrate existing data
4. Switch reads
5. Stop old writes
6. Remove old field later
```

This makes zero-downtime deployments much easier.

---

# 46. Don't mix business logic into UI components

Bad:

```tsx
function CheckoutButton() {
  // 300 lines of payment,
  // discounts,
  // taxation,
  // permissions,
  // analytics...
}
```

Better:

```text
features/
└── checkout/
    ├── actions.ts
    ├── validation.ts
    ├── service.ts
    ├── types.ts
    └── components/
```

Your components should mostly answer:

```text
What should the UI display?
```

rather than:

```text
How does our entire company work?
```

---

# 47. Establish consistent error types

For example:

```ts
class ApiError extends Error {}
class ValidationError extends Error {}
class UnauthorizedError extends Error {}
class ForbiddenError extends Error {}
class NotFoundError extends Error {}
```

Then map them consistently:

```text
ValidationError → 400
Unauthorized → 401
Forbidden → 403
NotFound → 404
Unhandled → 500
```

It makes both UI handling and telemetry much cleaner.

---

# 48. Have a production `.env` strategy

Never commit:

```text
.env
.env.production
service-account.json
private keys
```

Commit something like:

```text
.env.example
```

containing:

```env
API_URL=
AUTH_SECRET=
DATABASE_URL=
SENTRY_DSN=
```

Use your hosting provider's secret manager for actual values.

Vercel, for example, has dedicated environment variable management integrated into deployments. ([Next.js][9])

---

# 49. Use consistent code-quality tooling

I'd put these into the repository immediately:

```text
ESLint
Prettier
TypeScript strict mode
Husky — optional
lint-staged — optional
commitlint — optional
```

Example:

```text
git commit
    ↓
lint-staged
    ↓
ESLint
    ↓
Prettier
```

And let CI be the final authority.

---

# 50. Write a production checklist

Before launching, I would literally have this in the repository:

```text
docs/
└── production-checklist.md
```

Something like:

```text
[ ] Production build passes
[ ] TypeScript passes
[ ] ESLint passes
[ ] Unit tests pass
[ ] E2E tests pass

[ ] Environment variables configured
[ ] Secrets not exposed
[ ] Authentication configured
[ ] Authorization tested
[ ] Rate limiting enabled
[ ] Security headers configured

[ ] Error tracking working
[ ] Logs working
[ ] Alerts configured
[ ] Analytics working

[ ] robots.txt configured
[ ] sitemap.xml configured
[ ] Metadata configured
[ ] OpenGraph images configured

[ ] Accessibility checked
[ ] Mobile layouts tested
[ ] Major browsers tested

[ ] Performance tested
[ ] Images optimized
[ ] Bundle size reviewed

[ ] Domain configured
[ ] HTTPS working
[ ] Redirects configured

[ ] Backups configured
[ ] Rollback tested
[ ] Incident owner defined
```

## A production architecture I'd be comfortable starting with

For a fairly typical SaaS application:

```text
                      ┌─────────────────┐
                      │     Browser     │
                      └────────┬────────┘
                               │
                              HTTPS
                               │
                               ▼
                ┌──────────────────────────┐
                │         Next.js          │
                │                          │
                │  Server Components       │
                │  Client Components       │
                │  Server Actions          │
                │  Route Handlers          │
                └────────────┬─────────────┘
                             │
                ┌────────────┼──────────────┐
                │            │              │
                ▼            ▼              ▼
             Auth        Backend API     Storage
                               │
                               ▼
                           Database

                ┌─────────────────────────┐
                │ Observability           │
                │                         │
                │ Sentry                  │
                │ Logs                    │
                │ Metrics                 │
                │ Tracing                 │
                └─────────────────────────┘
```

And the flow I'd aim for is:

```text
Feature branch
      │
      ▼
Pull Request
      │
      ├── lint
      ├── typecheck
      ├── tests
      ├── security checks
      └── next build
      │
      ▼
Preview Environment
      │
      ▼
Code Review
      │
      ▼
Merge
      │
      ▼
Production
      │
      ├── monitoring
      ├── logging
      ├── metrics
      └── rollback
```

### My highest-priority 15

If the full list feels like a lot, get **these** right from day one:

1. **Use App Router + TypeScript strict mode.**
2. **Keep Next.js/React on supported patched releases.**
3. **Use Server Components by default.**
4. **Keep Client Components small.**
5. **Never expose secrets to the browser.**
6. **Validate every external input server-side.**
7. **Authenticate AND authorize Server Actions/API calls.**
8. **Understand caching and revalidation.**
9. **Centralize API access/error handling.**
10. **Add security headers and rate limiting.**
11. **Have error boundaries/loading/empty states.**
12. **Set up CI with lint + typecheck + test + build.**
13. **Have preview/staging before production.**
14. **Set up Sentry/logging/metrics before launch.**
15. **Know how to roll back a broken deployment.**

