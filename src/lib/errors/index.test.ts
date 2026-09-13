import { test, expect, describe } from 'vitest'
import { mapErrorEnvelope, ValidationError, UpstreamError } from './index'

describe('MapErrorEvaluation', () => {
  test('Maps ValidationError to ValidationError class', () => {
    const err = mapErrorEnvelope(422, { code: 'VALIDATION', message: 'x' })
    expect(err).toBeInstanceOf(ValidationError)
  })
  test('Maps UpstreamError to Upstream Error class', () => {
    const err = mapErrorEnvelope(502, {
      code: 'CustomError',
      message: 'x',
      requestId: 'req-1',
    })
    expect(err).toBeInstanceOf(UpstreamError)
    expect(err.requestId).toBe('req-1')
  })
})
