import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { MemoryRateLimiter as MemoryRateLimiterForTest } from './rate-limit'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

test('allows up to the limit, blocks the next, allows again after the window', async () => {
  const limiter = new MemoryRateLimiterForTest()
  for (let i = 0; i < 3; i++) {
    expect((await limiter.check('k', { limit: 3, windowMs: 1000 })).ok).toBe(
      true,
    )
  }
  const blocked = await limiter.check('k', { limit: 3, windowMs: 1000 })
  expect(blocked.ok).toBe(false)
  expect(blocked.retryAfterMs).toBeGreaterThan(0)

  vi.advanceTimersByTime(1001)
  expect((await limiter.check('k', { limit: 3, windowMs: 1000 })).ok).toBe(true)
})
