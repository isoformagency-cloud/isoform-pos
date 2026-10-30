import { app } from './app.js'

/**
 * Sends a request the way the POS does: a temporary 503 is retried with the same
 * idempotency key, so a retry can never repeat the work. Any other failure is real.
 */
export async function request(path: string, init: RequestInit) {
  for (let attempt = 0; ; attempt += 1) {
    const response = await app.request(path, init)
    if (response.status !== 503 || attempt === 2) return response
    await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)))
  }
}
