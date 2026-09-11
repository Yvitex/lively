import 'server-only'
import { z } from 'zod'

const EnvSchema = z.object({
  BACKEND_API_URL: z.url(),
  BACKEND_API_KEY: z.string().min(1).optional(),
  APP_URL: z.url(),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
})

const parsed = EnvSchema.safeParse(process.env)

if (!parsed.success) {
  console.error(z.prettifyError(parsed.error))
  throw new Error('Invalid environment variable')
}

export const env = parsed.data
