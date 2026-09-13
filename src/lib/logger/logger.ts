import 'server-only'

type Level = 'info' | 'warn' | 'error'
type Fields = Record<string, unknown>

const REDACTED_KEYS = new Set([
  'password',
  'token',
  'authorization',
  'idempotencykey',
  'cookie',
])

// password will be [redacted]
function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== 'object') return value
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      cause: redact(value.cause, depth + 1),
    }
  }

  if (Array.isArray(value)) {
    return value.map((v) => redact(v, depth + 1))
  }

  return Object.fromEntries(
    Object.entries(value as Fields).map(([k, v]) => [
      k,
      REDACTED_KEYS.has(k) ? '[redacted]' : redact(v, depth + 1),
    ]),
  )
}

function write(level: Level, message: string, fields: Fields = {}) {
  const line = JSON.stringify({
    level: level,
    message: message,
    tp: new Date().toISOString(),
    ...(redact(fields) as Fields),
  })
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export const logger = {
  error: (msg: string, fields: Fields) => write('error', msg, fields),
  warn: (msg: string, fields: Fields) => write('warn', msg, fields),
  info: (msg: string, fields: Fields) => write('info', msg, fields),
}
