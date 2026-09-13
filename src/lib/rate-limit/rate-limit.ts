import 'server-only'
import { headers } from 'next/headers'

export type RateLimitOptions = {
  limit: number
  windowMs: number
}

export type RateLimitResponse = {
  ok: boolean
  retryAfterMs: number
}

export interface RateLimiter {
  check(key: string, options: RateLimitOptions): Promise<RateLimitResponse>
}

export class MemoryRateLimiter implements RateLimiter {
  private hits = new Map<string, number[]>()

  async check(
    key: string,
    options: RateLimitOptions,
  ): Promise<RateLimitResponse> {
    const now = Date.now()

    const recent = (this.hits.get(key) ?? []).filter(
      (t) => now - t < options.windowMs,
    )
    if (recent.length >= options.limit) {
      const oldest = recent[0] ?? now
      return { ok: false, retryAfterMs: options.windowMs - (now - oldest) }
    }

    recent.push(now)

    this.hits.set(key, recent)
    if (this.hits.size > 10_000) {
      this.sweep(now, options.windowMs)
    }
    return { ok: true, retryAfterMs: 0 }
  }

  private sweep(now: number, windowMs: number) {
    for (const [k, t] of this.hits) {
      const latest = t[t.length - 1] ?? 0
      if (now - latest >= windowMs) {
        this.hits.delete(k)
      }
    }
  }
}

declare global {
  var __appRateLimiter: RateLimiter | undefined
}

export const rateLimiter: RateLimiter = (globalThis.__appRateLimiter ??=
  new MemoryRateLimiter())

export async function getClientIp(): Promise<string> {
  const h = await headers()
  return (
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    h.get('x-real-ip') ||
    'unknown'
  )
}
