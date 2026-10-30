import { createHash } from 'node:crypto'
import type { Context, MiddlewareHandler } from 'hono'
import { z } from 'zod'
import { tx, type Db, type DbContext } from './db'
import { AppError, forbidden } from './errors'
import { can, type Permission, type Role } from './permissions'
import { verifyToken } from './supabase'

export interface Actor {
  userId: string
  membershipId: string
  tenantId: string
  role: Role
  displayName: string
  branchIds: string[]
}

export type Env = { Variables: { actor: Actor; rawBody?: string } }

export const dbContext = (actor: Actor): DbContext => ({
  tenantId: actor.tenantId,
  branchIds: actor.branchIds,
  membershipId: actor.membershipId,
  userId: actor.userId,
})

/**
 * Establishes who is calling. Business and branch always come from the database.
 * Headers can only narrow access to something the user already has.
 */
export const session: MiddlewareHandler<Env> = async (c, next) => {
  const token = c.req.header('authorization')?.replace(/^Bearer /, '')
  if (!token) throw new AppError(401, 'invalid_session', 'Please sign in.')
  const userId = await verifyToken(token)

  const memberships = await tx({ userId }, async (db) => {
    const { rows } = await db.query(
      `select id, tenant_id, role, display_name from app.memberships where user_id = $1 and status = 'active'`,
      [userId],
    )
    return rows
  })
  if (memberships.length === 0) throw forbidden()

  const wanted = c.req.header('x-tenant-id')
  const membership = wanted ? memberships.find((m) => m.tenant_id === wanted) : memberships.length === 1 ? memberships[0] : null
  if (wanted && !membership) throw forbidden()
  if (!membership) throw new AppError(400, 'tenant_required', 'Choose a business.')

  const { status, branchIds } = await tx({ tenantId: membership.tenant_id, userId }, async (db) => {
    const tenant = await db.query(`select status from app.tenants where id = $1`, [membership.tenant_id])
    const branches =
      membership.role === 'owner'
        ? await db.query(`select id from app.branches where is_active`)
        : await db.query(
            `select b.id from app.branch_memberships bm join app.branches b on b.id = bm.branch_id
              where bm.membership_id = $1 and b.is_active`,
            [membership.id],
          )
    return { status: tenant.rows[0]?.status, branchIds: branches.rows.map((b) => b.id as string) }
  })
  if (status !== 'active') throw new AppError(403, 'business_inactive', 'This business account is not active.')

  const branch = c.req.header('x-branch-id')
  if (branch && !branchIds.includes(branch)) throw forbidden()

  c.set('actor', {
    userId,
    membershipId: membership.id,
    tenantId: membership.tenant_id,
    role: membership.role,
    displayName: membership.display_name,
    branchIds: branch ? [branch] : branchIds,
  })
  await next()
}

export const requires = (permission: Permission): MiddlewareHandler<Env> => async (c, next) => {
  if (!can(c.get('actor').role, permission)) throw forbidden()
  await next()
}

export async function audit(db: Db, actor: Actor, action: string, entityType: string, entityId: string, after?: unknown, before?: unknown) {
  await db.query(
    `insert into app.audit_log (tenant_id, actor_membership_id, action, entity_type, entity_id, before_data, after_data)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [actor.tenantId, actor.membershipId, action, entityType, entityId, before ?? null, after ?? null],
  )
}

export async function readBody<T extends z.ZodType>(c: Context<Env>, schema: T): Promise<z.infer<T>> {
  const raw = await c.req.text()
  c.set('rawBody', raw)
  let parsed: unknown
  try {
    parsed = raw ? JSON.parse(raw) : {}
  } catch {
    throw new AppError(400, 'invalid_json', 'The request could not be read.')
  }
  const result = schema.safeParse(parsed)
  if (!result.success) throw new AppError(422, 'invalid', 'Please check the details.', z.flattenError(result.error).fieldErrors)
  return result.data
}

/**
 * Runs a write once. Replaying the same Idempotency-Key returns the first response
 * instead of doing the work again, and both are saved in one transaction.
 */
export async function command<T>(c: Context<Env>, status: 200 | 201, run: (db: Db, actor: Actor) => Promise<T>) {
  const key = c.req.header('idempotency-key')
  if (!key || key.length > 200) throw new AppError(400, 'idempotency_key_required', 'This request needs an Idempotency-Key.')
  const actor = c.get('actor')
  const hash = createHash('sha256').update(`${c.req.method} ${c.req.path} ${c.get('rawBody') ?? ''}`).digest('hex')

  const stored = async () =>
    tx(dbContext(actor), async (db) => {
      const { rows } = await db.query(
        `select request_hash, response_status, response_body from app.idempotency_keys where key = $1`,
        [key],
      )
      if (!rows[0]) return null
      if (rows[0].request_hash !== hash) throw new AppError(409, 'idempotency_key_reused', 'This key was used for a different request.')
      return rows[0]
    })

  const previous = await stored()
  if (previous) return c.json(previous.response_body, previous.response_status)

  try {
    const body = await tx(dbContext(actor), async (db) => {
      const result = await run(db, actor)
      await db.query(
        `insert into app.idempotency_keys (tenant_id, key, request_hash, response_status, response_body)
         values ($1, $2, $3, $4, $5)`,
        [actor.tenantId, key, hash, status, JSON.stringify(result ?? {})],
      )
      return result
    })
    return c.json((body ?? {}) as object, status)
  } catch (error) {
    if ((error as { constraint?: string }).constraint === 'idempotency_keys_pkey') {
      const winner = await stored()
      if (winner) return c.json(winner.response_body, winner.response_status)
    }
    throw error
  }
}
