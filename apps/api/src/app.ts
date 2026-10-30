import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { secureHeaders } from 'hono/secure-headers'
import { z } from 'zod'
import type { Env } from './platform/context.js'
import { isConnectionError } from './platform/db.js'
import { AppError } from './platform/errors.js'
import { billing } from './modules/billing/routes.js'
import { cash } from './modules/cash/routes.js'
import { identity, pinLogin } from './modules/identity/routes.js'
import { menu } from './modules/menu/routes.js'
import { orders } from './modules/orders/routes.js'
import { payments } from './modules/payments/routes.js'
import { reports } from './modules/reports/routes.js'
import { tenancy } from './modules/tenancy/routes.js'

export const app = new Hono<Env>().basePath('/api/v1')

app.use(secureHeaders())
app.use(bodyLimit({
  maxSize: 64 * 1024,
  onError: (c) => c.json({ code: 'too_large', message: 'That request is too large.' }, 413),
}))

app.get('/health', (c) => c.json({ ok: true }))
app.route('/', pinLogin)
app.route('/', identity)
app.route('/', tenancy)
app.route('/', menu)
app.route('/', orders)
app.route('/', billing)
app.route('/', payments)
app.route('/', cash)
app.route('/', reports)

app.notFound((c) => c.json({ code: 'not_found', message: 'That route does not exist.' }, 404))

const CONSTRAINT_ERRORS: Record<string, [number, string, string]> = {
  '55P03': [503, 'busy', 'That record is busy. Please try again.'],
  '57014': [503, 'busy', 'That took too long. Please try again.'],
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
  // Database rules explain themselves. IDs are removed so nothing internal reaches a screen.
  if ((error as { code?: string }).code === 'P0001') {
    const text = error.message.replace(/\s?[0-9a-f]{8}-[0-9a-f-]{27}/g, '')
    return c.json({ code: 'rule_broken', message: text.charAt(0).toUpperCase() + text.slice(1) + '.' }, 409)
  }
  const known = CONSTRAINT_ERRORS[(error as { code?: string }).code ?? '']
  if (known) return c.json({ code: known[1], message: known[2] }, known[0] as 400)
  if (isConnectionError(error)) {
    // Host and code explain a failure without exposing any password or data.
    const { code, hostname, address } = error as { code?: string; hostname?: string; address?: string }
    console.error('database_connection_failed', code ?? error.message.slice(0, 80), hostname ?? address ?? '')
    return c.json({ code: 'database_unavailable', message: 'Could not reach the database. Please try again.' }, 503)
  }
  // Log the kind of failure only. Never log request bodies, tokens or PINs.
  console.error('unhandled_error', (error as { code?: string }).code ?? error.name)
  return c.json({ code: 'server_error', message: 'Something went wrong.' }, 500)
})
