import { expect, test, vi, afterEach } from 'vitest'
import { logger } from './logger'

afterEach(() => vi.restoreAllMocks())

test('redact secrete fields before logging', () => {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
  logger.error('account creation failed', {
    email: 'trump@gmail.com',
    password: 'okaykakokey',
    others: {
      token: 'wakowako',
    },
  })

  const line = spy.mock.calls[0]?.[0] as string
  expect(line).not.toContain('okaykakokey')
  expect(line).not.toContain('wakowako')
  expect(JSON.parse(line).others.token).toBe('[redacted]')
})
