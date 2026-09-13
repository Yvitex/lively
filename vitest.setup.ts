import '@testing-library/jest-dom/vitest'
import { vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.stubEnv('BACKEND_API_URL', 'http://backend.test')
vi.stubEnv('APP_URL', 'http://localhost:3000')
vi.stubEnv('REQUEST_TIMEOUT_MS', '1000')
