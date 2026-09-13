import 'server-only'
import { env } from '../env'
import { UpstreamError } from '../errors'
import { z } from 'zod'
import { mapErrorEnvelope } from '../errors'
import { start } from 'repl'
import { logger } from '../logger/logger'

type BackendRequest<T> = {
  method: 'POST'
  path: `/${string}`
  body: unknown
  requestId: string
  idempotencyKey?: string
  schema: z.ZodType<T>
}

const ErrorEnvelopeSchema = z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string().optional(),
    fields: z.record(z.string(), z.array(z.string())).optional()
})

export async function backendRequest<T>(req: BackendRequest<T>): Promise<T> {
  const url = new URL(req.path, env.BACKEND_API_URL)

  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    accept: 'application/json',
    'x-request-id': req.requestId,
  })

  if (env.BACKEND_API_KEY)
    headers.set('authorization', `Bearer ${env.BACKEND_API_KEY}`)
  if (req.idempotencyKey) headers.set('idempotency-key', req.idempotencyKey)

  const startedAt = performance.now()
  try {
    const res = await fetch(url, {
      method: req.method,
      body: JSON.stringify(req.body),
      headers: headers,
      cache: 'no-store',
      signal: AbortSignal.timeout(env.REQUEST_TIMEOUT_MS),
    })

    const text = await res.text()
    const json = text ? JSON.parse(text) : undefined

    if (!res.ok) {
        const envelope = ErrorEnvelopeSchema.safeParse(json)
        if (envelope.success) throw mapErrorEnvelope(res.status, envelope.data)
        throw new UpstreamError(`backend responded ${res.status} without an error envelope`, {requestId: req.requestId})
    }


    const durationMs = Math.round(performance.now() - startedAt)
    logger.info('backend_response', { requestId: req.requestId, path: req.path, status: res.status, durationMs })

    const parsed = req.schema.safeParse(json)
    if (!parsed.success) {
        logger.error('backend_response_shape', { requestId: req.requestId, path: req.path, issues: parsed.error.issues })
        throw new UpstreamError('backend response did not match schema', { requestId: req.requestId})
    }

    return parsed.data


  } catch (cause) {
    throw new UpstreamError('Cannot access the server or something', { cause })
  }
}
