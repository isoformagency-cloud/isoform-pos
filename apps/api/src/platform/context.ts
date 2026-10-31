import { createHash } from 'node:crypto'
import type { Context, MiddlewareHandler } from 'hono'
import { z } from 'zod'
import { tx, type Db, type DbContext } from './db.js'
import { AppError, forbidden } from './errors.js'
import { can, type Permission, type Role } from './permissions.js'
import { verifyToken } from './supabase.js'

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
  // Every module adds this check, and a request passes through them all on its way, so it only runs once.
  if (c.get('actor')) return next()
  const token = c.req.header('authorization')?.replace(/^Bearer /, '')
  if (!token) throw new AppError(401, 'invalid_session', 'Please sign in.')
  const userId = await verifyToken(token)

  const wanted = c.req.header('x-tenant-id')
  // One transaction, so a request costs as few database trips as possible.
  const { membership, status, branchIds } = await tx({ userId }, async (db) => {
    const { rows: memberships } = await db.query(
      `select id, tenant_id, role, display_name from app.memberships where user_id = $1 and status = 'active'`,
      [userId],
    )
    if (memberships.length === 0) throw forbidden()
    const chosen = wanted ? memberships.find((m) => m.tenant_id === wanted) : memberships.length === 1 ? memberships[0] : null
    if (wanted && !chosen) throw forbidden()
    if (!chosen) throw new AppError(400, 'tenant_required', 'Choose a business.')

    // Two statements in one message: the tenant must be set before RLS is evaluated.
    const tenant = db.escapeLiteral(chosen.tenant_id)
    const results = (await db.query(
      `select set_config('app.tenant_id', ${tenant}, true);
       select (select status from app.tenants where id = ${tenant}::uuid) as status,
         array(select b.id from app.branches b
                where b.is_active and (${chosen.role === 'owner'} or exists (
                  select 1 from app.branch_memberships bm
                   where bm.membership_id = ${db.escapeLiteral(chosen.id)} and bm.branch_id = b.id))
         )::text[] as branch_ids`,
    )) as unknown as { rows: { status: string; branch_ids: string[] }[] }[]
    const access = results[1].rows[0]
    return { membership: chosen, status: access.status, branchIds: access.branch_ids }
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

export const requiresAny = (...permissions: Permission[]): MiddlewareHandler<Env> => async (c, next) => {
  if (!permissions.some((permission) => can(c.get('actor').role, permission))) throw forbidden()
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

  const outcome = await tx(dbContext(actor), async (db) => {
    // Same-key requests wait here, so a replay sees the first request's saved answer.
    await db.query(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [`idempotency:${actor.tenantId}:${key}`])
    const { rows: [previous] } = await db.query(
      `select request_hash, response_status, response_body from app.idempotency_keys where key = $1`,
      [key],
    )
    if (previous) {
      if (previous.request_hash !== hash) throw new AppError(409, 'idempotency_key_reused', 'This key was used for a different request.')
      return { status: previous.response_status as 200 | 201, body: previous.response_body }
    }
    const body = (await run(db, actor)) ?? {}
    await db.query(
      `insert into app.idempotency_keys (tenant_id, key, request_hash, response_status, response_body)
       values ($1, $2, $3, $4, $5)`,
      [actor.tenantId, key, hash, status, JSON.stringify(body)],
    )
    return { status, body }
  })
  return c.json(outcome.body as object, outcome.status)
}
