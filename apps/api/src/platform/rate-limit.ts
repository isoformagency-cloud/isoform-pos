import { createHash } from 'node:crypto'
import type { MiddlewareHandler } from 'hono'
import { tx } from './db.js'
import { AppError } from './errors.js'

/**
 * Limits public endpoints per visitor. Vercel sets x-real-ip itself, so a caller cannot
 * fake it there. Addresses are hashed, so none are stored.
 */
export const limit = (name: string, maxHits: number, windowSeconds: number): MiddlewareHandler => async (c, next) => {
  const ip = c.req.header('x-real-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
  if (ip) {
    const visitor = createHash('sha256').update(ip).digest('hex').slice(0, 32)
    const allowed = await tx({}, async (db) => {
      const { rows } = await db.query(`select app.allow_request($1, $2, $3) as ok`, [`${name}:${visitor}`, maxHits, windowSeconds])
      return rows[0].ok as boolean
    })
    if (!allowed) throw new AppError(429, 'too_many_requests', 'Too many attempts. Please wait a moment and try again.')
  }
  await next()
}
