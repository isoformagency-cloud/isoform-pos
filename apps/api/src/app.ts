import { Hono } from 'hono'
import { z } from 'zod'
import type { Env } from './platform/context'
import { AppError } from './platform/errors'
import { identity, pinLogin } from './modules/identity/routes'
import { tenancy } from './modules/tenancy/routes'

export const app = new Hono<Env>().basePath('/api/v1')

app.get('/health', (c) => c.json({ ok: true }))
app.route('/', pinLogin)
app.route('/', identity)
app.route('/', tenancy)

app.notFound((c) => c.json({ code: 'not_found', message: 'That route does not exist.' }, 404))

const CONSTRAINT_ERRORS: Record<string, [number, string, string]> = {
  '23505': [409, 'duplicate', 'That already exists.'],
  '23503': [422, 'invalid_reference', 'That refers to something that does not exist.'],
  '42501': [403, 'forbidden', 'You do not have permission to do this.'],
  P0001: [409, 'rule_broken', 'That is not allowed.'],
}

app.onError((error, c) => {
  if (error instanceof AppError) {
    return c.json({ code: error.code, message: error.message, details: error.details }, error.status as 400)
  }
  if (error instanceof z.ZodError) {
    return c.json({ code: 'invalid', message: 'Please check the details.' }, 422)
  }
  const known = CONSTRAINT_ERRORS[(error as { code?: string }).code ?? '']
  if (known) return c.json({ code: known[1], message: known[2] }, known[0] as 400)
  // Log the kind of failure only. Never log request bodies, tokens or PINs.
  console.error('unhandled_error', (error as { code?: string }).code ?? error.name)
  return c.json({ code: 'server_error', message: 'Something went wrong.' }, 500)
})
