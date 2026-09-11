type AppErrorOptions = {
    cause?: unknown,
    requestId?: string
}


export class AppError extends Error {
    readonly code: string
    readonly status: number
    readonly requestId: string | undefined

    constructor(code: string, status: number, message: string, options: AppErrorOptions = {}) {
        super(message, {cause: options.cause})
        this.name = new.target.name
        this.code = code
        this.status = status
        this.requestId = options.requestId
    }
}

export class TokenInvalidError extends AppError {
    constructor(requestId?: string) {
        super('TOKEN_INVALID', 400, 'Token confirmation invalid', {requestId} )
    }
}

export class TokenExpiredError extends AppError {
  constructor(requestId?: string) {
    super('TOKEN_EXPIRED', 410, 'confirmation token expired', { requestId })
  }
}

export class ValidationError extends AppError {
    readonly fields?: Record<string, string[]> | undefined
    constructor(requestId?: string, fields?: Record<string, string[]>) {
        super('VALIDATION_ERROR', 422, 'Validation failed', {requestId})
        this.fields = fields
    }
}

export class RateLimitedError extends AppError {
    constructor(requestId?: string) {
        super("RATE_LIMITED", 429, "rate limiting error", {requestId})
    }
}

export class UpstreamError extends AppError {
    constructor(message: string, options?: AppErrorOptions) {
        super("UPSTREAM_ERROR", 502, message, options)
    }
}

export type ErrorEnvelope = {
    code: string,
    message: string,
    requestId?: string,
    fields?: Record<string, string[]>
}


export function mapErrorEnvelope(status: number, envelope: ErrorEnvelope) : AppError {
    switch(envelope.code) {
        case 'TOKEN_INVALID':
            return new TokenInvalidError(envelope.requestId)
        case 'TOKEN_EXPIRED':
            return new TokenExpiredError(envelope.requestId)
        case 'VALIDATION_ERROR':
            return new ValidationError(envelope.requestId, envelope.fields)
        case 'RATE_LIMITED':
            return new RateLimitedError(envelope.requestId)
        default:
            return new UpstreamError(`backend responded ${status} ${envelope.code}`, {requestId: envelope.requestId})
    }
}
