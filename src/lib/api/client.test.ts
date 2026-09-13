import { beforeEach, afterEach, vi, test, expect } from 'vitest'
import { UpstreamError } from '../errors'
import { backendRequest } from './client'

beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
afterEach(() => vi.unstubAllGlobals())

test('return parsed json on success', async () => {
  vi.mocked(fetch).mockResolvedValue(
    new Response(
      JSON.stringify({
        ok: true,
      }),
      {
        status: 200,
      },
    ),
  )
  await expect(
    backendRequest({
      method: 'POST',
      path: '/sample',
      body: {},
      requestId: '1',
    }),
  ).resolves.toEqual({ ok: true })
})

test('rejected request is an Upstream error', async () => {
  vi.mocked(fetch).mockRejectedValue(new Error('boom'))
  await expect(
    backendRequest({
      method: 'POST',
      path: '/sample',
      body: {},
      requestId: '1',
    }),
  ).rejects.toBeInstanceOf(UpstreamError)
})

test('sends x-request-id and idempotency-key', async () => {
  vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 200 }))
  await backendRequest({
    method: 'POST',
    path: '/x',
    body: {},
    requestId: 'req_1',
    idempotencyKey: 'idem_1',
  })
  const sentHeaders = vi.mocked(fetch).mock.calls[0]?.[1]?.headers as Headers
  expect(sentHeaders.get('x-request-id')).toBe('req_1')
  expect(sentHeaders.get('idempotency-key')).toBe('idem_1')
})

test('a non-2xx without an envelope becomes UpstreamError', async () => {
  vi.mocked(fetch).mockResolvedValue(new Response('<html>502</html>', { status: 502 }))
  await expect(
    backendRequest({ method: 'POST', path: '/x', body: {}, requestId: 'req_1' }),
  ).rejects.toBeInstanceOf(UpstreamError)
})

