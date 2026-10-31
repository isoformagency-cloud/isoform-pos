import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { hash, verify } from '@node-rs/argon2'
import { Hono } from 'hono'
import { z } from 'zod'
import { audit, command, dbContext, readBody, requires, session, type Actor, type Env } from '../../platform/context.js'
import { tx, type Db } from '../../platform/db.js'
import { AppError, forbidden, notFound } from '../../platform/errors.js'
import { can, defaultLevel, EDITABLE_ROLES, MODULES, PIN_ROLES, type Level, type Role } from '../../platform/permissions.js'
import { limit } from '../../platform/rate-limit.js'
import { createSession, supabaseAdmin } from '../../platform/supabase.js'

const MAX_PIN_ATTEMPTS = 5
const pinFormat = z.string().regex(/^\d{4,6}$/)
const roles = z.enum(['owner', 'admin', 'manager', 'cashier', 'waiter', 'kitchen', 'accountant'])
const sha256 = (text: string) => createHash('sha256').update(text).digest()

// ---------------------------------------------------------------------------
// Public: PIN login, which is only valid with a registered device credential.
// ---------------------------------------------------------------------------

export const pinLogin = new Hono<Env>()

const pinRequest = z.strictObject({
  deviceCredential: z.string().max(300),
  membershipId: z.uuid(),
  pin: pinFormat,
})

/** Names for the PIN screen. Without a valid device credential it reveals nothing. */
pinLogin.post('/auth/device-staff', limit('device-staff', 30, 60), async (c) => {
  const { deviceCredential } = await readBody(c, z.strictObject({ deviceCredential: z.string().max(300) }))
  const refused = new AppError(401, 'device_refused', 'This device is not registered.')
  const [tenantId, branchId, deviceId, secret] = deviceCredential.split('.')
  if (!z.uuid().safeParse(tenantId).success || !z.uuid().safeParse(branchId).success || !z.uuid().safeParse(deviceId).success || !secret) {
    throw refused
  }
  const items = await tx({ tenantId, branchIds: [branchId] }, async (db) => {
    const { rows: [device] } = await db.query(`select credential_hash from app.devices where id = $1 and status = 'active'`, [deviceId])
    if (!device || !timingSafeEqual(Buffer.from(device.credential_hash, 'hex'), sha256(secret))) throw refused
    const { rows } = await db.query(
      `select m.id, m.display_name from app.memberships m
         join app.branch_memberships bm on bm.membership_id = m.id and bm.branch_id = $1
        where m.status = 'active' and m.pin_hash is not null and m.tenant_id = $2 order by m.display_name`,
      [branchId, tenantId],
    )
    return rows
  })
  return c.json({ items })
})

pinLogin.post('/auth/pin-login', limit('pin-login', 30, 60), async (c) => {
  const input = await readBody(c, pinRequest)
  const refused = new AppError(401, 'pin_refused', 'That PIN was not accepted.')

  const [tenantId, branchId, deviceId, secret] = input.deviceCredential.split('.')
  if (!z.uuid().safeParse(tenantId).success || !z.uuid().safeParse(branchId).success || !z.uuid().safeParse(deviceId).success || !secret) {
    throw refused
  }

  const context = { tenantId, branchIds: [branchId] }
  const email = await tx(context, async (db) => {
    const { rows: [device] } = await db.query(
      `select d.credential_hash from app.devices d
         join app.tenants t on t.id = d.tenant_id
        where d.id = $1 and d.status = 'active' and t.status = 'active'`,
      [deviceId],
    )
    if (!device || !timingSafeEqual(Buffer.from(device.credential_hash, 'hex'), sha256(secret))) throw refused

    const { rows: [member] } = await db.query(
      `select m.pin_hash, m.user_id from app.memberships m
         join app.branch_memberships bm on bm.membership_id = m.id and bm.branch_id = $2
        where m.id = $1 and m.status = 'active'`,
      [input.membershipId, branchId],
    )
    if (!member?.pin_hash) throw refused

    await db.query(
      `insert into app.device_pin_attempts (tenant_id, device_id, membership_id) values ($1, $2, $3)
       on conflict do nothing`,
      [tenantId, deviceId, input.membershipId],
    )
    const { rows: [attempts] } = await db.query(
      `select failed_count, locked_until from app.device_pin_attempts
        where device_id = $1 and membership_id = $2 for update`,
      [deviceId, input.membershipId],
    )
    if (attempts.locked_until) return { locked: true as const }

    if (!(await verify(member.pin_hash, input.pin))) {
      const lock = attempts.failed_count + 1 >= MAX_PIN_ATTEMPTS
      await db.query(
        `update app.device_pin_attempts set failed_count = failed_count + 1, locked_until = $3
          where device_id = $1 and membership_id = $2`,
        [deviceId, input.membershipId, lock ? 'infinity' : null],
      )
      return { locked: lock }
    }

    await db.query(
      `update app.device_pin_attempts set failed_count = 0 where device_id = $1 and membership_id = $2`,
      [deviceId, input.membershipId],
    )
    await db.query(`update app.devices set last_seen_at = now() where id = $1`, [deviceId])
    const { data } = await supabaseAdmin.auth.admin.getUserById(member.user_id)
    return { email: data.user?.email }
  })

  if ('locked' in email) {
    if (email.locked) throw new AppError(423, 'pin_locked', 'This login is locked. Ask a manager to unlock it.')
    throw refused
  }
  if (!email.email) throw refused

  const created = await createSession(email.email)
  return c.json({
    accessToken: created.access_token,
    refreshToken: created.refresh_token,
    expiresAt: created.expires_at,
  })
})

// ---------------------------------------------------------------------------
// Signed in
// ---------------------------------------------------------------------------

export const identity = new Hono<Env>()
identity.use(session)

identity.get('/me', async (c) => {
  const actor = c.get('actor')
  return c.json({
    membershipId: actor.membershipId,
    tenantId: actor.tenantId,
    displayName: actor.displayName,
    role: actor.role,
    branchIds: actor.branchIds,
    permissions: actor.permissions,
  })
})

async function loadTarget(db: Db, id: string) {
  const { rows: [target] } = await db.query(`select id, role, status from app.memberships where id = $1 and tenant_id = app.tenant_id()`, [id])
  if (!target) throw notFound('Staff member')
  return target as { id: string; role: Role; status: string }
}

/** Managers look after frontline staff, admins look after everyone below them, and owners look after all. */
const assertCanManage = (actor: Actor, role: Role) => {
  if (actor.role === 'owner') return
  if (actor.role === 'admin' && role !== 'owner' && role !== 'admin') return
  if (!PIN_ROLES.includes(role)) throw forbidden()
}

async function assertNotLastOwner(db: Db, target: { id: string; role: Role }) {
  if (target.role !== 'owner') return
  const { rows: [{ count }] } = await db.query(
    `select count(*)::int as count from app.memberships where role = 'owner' and status = 'active' and id <> $1 and tenant_id = app.tenant_id()`,
    [target.id],
  )
  if (count === 0) throw new AppError(409, 'last_owner', 'A business must keep at least one owner.')
}

const assertOwnBranches = (actor: Actor, branchIds: string[]) => {
  if (branchIds.some((id) => !actor.branchIds.includes(id))) throw forbidden()
}

const newStaff = z.strictObject({
  displayName: z.string().trim().min(2).max(100),
  role: roles,
  email: z.email().optional(),
  pin: pinFormat.optional(),
  branchIds: z.array(z.uuid()).max(100).default([]),
}).refine((value) => (PIN_ROLES.includes(value.role) ? Boolean(value.pin) : Boolean(value.email)), {
  message: 'Frontline staff need a PIN, and other roles need an email.',
})

const staffUpdate = z.strictObject({
  displayName: z.string().trim().min(2).max(100).optional(),
  role: roles.optional(),
  status: z.enum(['active', 'suspended', 'removed']).optional(),
  pin: pinFormat.optional(),
  branchIds: z.array(z.uuid()).max(100).optional(),
})

identity.get('/staff', requires('staff.read'), async (c) => {
  const actor = c.get('actor')
  const items = await tx(dbContext(actor), async (db) => {
    const { rows } = await db.query(
      `select m.id, m.display_name, m.role, m.status, m.pin_hash is not null as has_pin,
              coalesce(array_agg(bm.branch_id) filter (where bm.branch_id is not null), '{}') as branch_ids,
              coalesce(o.today, 0) as orders_today,
              greatest(o.latest, (select max(a.created_at) from app.audit_log a
                                   where a.tenant_id = m.tenant_id and a.actor_membership_id = m.id)) as last_active
         from app.memberships m
         left join app.branch_memberships bm on bm.membership_id = m.id
         left join lateral (
           select max(x.created_at) as latest,
                  count(*) filter (where x.business_date = ((now() at time zone b.timezone) - b.day_cutoff::interval)::date)::int as today
             from app.orders x join app.branches b on b.id = x.branch_id
            where x.tenant_id = m.tenant_id and x.created_by = m.id
         ) o on true
        where m.tenant_id = app.tenant_id() and m.status <> 'removed'
        group by m.id, o.today, o.latest order by m.created_at`,
    )
    return rows
  })
  return c.json({ items })
})

// ---------------------------------------------------------------------------
// What each role can do, which an owner can change
// ---------------------------------------------------------------------------

const roleLevels = z.strictObject({ levels: z.record(z.string().max(30), z.enum(['none', 'view', 'manage'])) })

identity.get('/permissions', requires('permissions.manage'), async (c) => {
  const saved = await tx(dbContext(c.get('actor')), async (db) => {
    const { rows } = await db.query(`select role, module, level from app.role_permissions`)
    return rows as { role: Role; module: string; level: Level }[]
  })
  const grid = EDITABLE_ROLES.map((role) => ({
    role,
    levels: Object.fromEntries(MODULES.map((module) => [
      module.key,
      saved.find((row) => row.role === role && row.module === module.key)?.level ?? defaultLevel(role, module),
    ])),
    defaults: Object.fromEntries(MODULES.map((module) => [module.key, defaultLevel(role, module)])),
  }))
  return c.json({ modules: MODULES.map(({ key, label, levels }) => ({ key, label, levels })), grid })
})

identity.put('/permissions/:role', requires('permissions.manage'), async (c) => {
  const role = z.enum(EDITABLE_ROLES as [Role, ...Role[]]).parse(c.req.param('role'))
  const input = await readBody(c, roleLevels)
  for (const [key, level] of Object.entries(input.levels)) {
    if (!MODULES.find((module) => module.key === key)?.levels.includes(level)) {
      throw new AppError(422, 'invalid_level', 'That access level isn’t available for this section.')
    }
  }
  return command(c, 200, async (db, actor) => {
    await db.query(`delete from app.role_permissions where role = $1`, [role])
    for (const module of MODULES) {
      const level = input.levels[module.key]
      if (!level || level === defaultLevel(role, module)) continue
      await db.query(`insert into app.role_permissions (tenant_id, role, module, level) values ($1, $2, $3, $4)`, [actor.tenantId, role, module.key, level])
    }
    await audit(db, actor, 'permissions.updated', 'tenant', actor.tenantId, { role, levels: input.levels })
    return { role, levels: input.levels }
  })
})

// ---------------------------------------------------------------------------
// Activity log
// ---------------------------------------------------------------------------

const ACTIVITY_GROUPS: Record<string, string> = {
  discounts: `a.action like 'order.discount%'`,
  cancellations: `a.action in ('order.cancelled', 'order_item.voided', 'credit_note.issued', 'expense.voided', 'refund.recorded', 'refund.voided')`,
  stock: `a.action like 'stock_item.%' or a.action = 'recipe.updated'`,
  menu: `a.action like 'product.%' or a.action like 'variant.%' or a.action like 'addon.%' or a.action like 'category.%' or a.action like 'tax_rate.%'`,
  staff: `a.action like 'staff.%' or a.action like 'device.%' or a.action = 'permissions.updated'`,
}

identity.get('/activity', requires('activity.read'), async (c) => {
  const group = z.enum(['all', ...Object.keys(ACTIVITY_GROUPS)]).default('all').parse(c.req.query('group'))
  const offset = z.coerce.number().int().min(0).default(0).parse(c.req.query('offset'))
  const items = await tx(dbContext(c.get('actor')), async (db) => {
    const { rows } = await db.query(
      `select a.id, a.action, a.entity_type, a.entity_id, a.after_data, a.created_at, m.display_name as actor_name
         from app.audit_log a left join app.memberships m on m.id = a.actor_membership_id
        where ${group === 'all' ? 'true' : `(${ACTIVITY_GROUPS[group]})`}
        order by a.created_at desc limit 50 offset $1`,
      [offset],
    )
    return rows
  })
  return c.json({ items, nextOffset: items.length === 50 ? offset + 50 : null })
})

identity.post('/staff', requires('staff.write'), async (c) => {
  const input = await readBody(c, newStaff)
  const actor = c.get('actor')
  assertCanManage(actor, input.role)
  assertOwnBranches(actor, input.branchIds)

  const pinHash = input.pin ? await hash(input.pin) : null
  const email = input.email ?? `staff-${crypto.randomUUID()}@staff.isoform.invalid`
  let userId: string | undefined

  try {
    return await command(c, 201, async (db) => {
      // Inside the command, so a replayed request never creates a second account.
      const created = input.email
        ? await supabaseAdmin.auth.admin.inviteUserByEmail(email)
        : await supabaseAdmin.auth.admin.createUser({ email, email_confirm: true })
      if (created.error || !created.data.user) {
        console.error('staff_auth_failed', created.error?.status, created.error?.code)
        // Status 0 or 5xx means Supabase could not be reached. That is temporary, so the POS may retry.
        const status = created.error?.status ?? 0
        if (status === 0 || status >= 500) throw new AppError(503, 'auth_unavailable', 'Could not reach the login service. Please try again.')
        throw new AppError(409, 'staff_not_created', 'That person could not be added.')
      }
      userId = created.data.user.id

      const { rows: [member] } = await db.query(
        `insert into app.memberships (tenant_id, user_id, display_name, role, pin_hash)
         values ($1, $2, $3, $4, $5) returning id, display_name, role`,
        [actor.tenantId, userId, input.displayName, input.role, pinHash],
      )
      for (const branchId of input.branchIds) {
        await db.query(
          `insert into app.branch_memberships (tenant_id, membership_id, branch_id) values ($1, $2, $3)`,
          [actor.tenantId, member.id, branchId],
        )
      }
      await audit(db, actor, 'staff.created', 'membership', member.id, { role: input.role, branchIds: input.branchIds })
      return member
    })
  } catch (error) {
    if (userId) await supabaseAdmin.auth.admin.deleteUser(userId)
    throw error
  }
})

identity.patch('/staff/:id', requires('staff.write'), async (c) => {
  const id = z.uuid().parse(c.req.param('id'))
  const input = await readBody(c, staffUpdate)
  const pinHash = input.pin ? await hash(input.pin) : undefined
  return command(c, 200, async (db, actor) => {
    const target = await loadTarget(db, id)
    assertCanManage(actor, target.role)
    if (input.role) assertCanManage(actor, input.role)
    if ((input.role && input.role !== 'owner') || (input.status && input.status !== 'active')) await assertNotLastOwner(db, target)

    const { rows: [member] } = await db.query(
      `update app.memberships set
         display_name = coalesce($2, display_name), role = coalesce($3, role),
         status = coalesce($4, status), pin_hash = coalesce($5, pin_hash)
       where id = $1 returning id, display_name, role, status`,
      [id, input.displayName, input.role, input.status, pinHash],
    )
    if (input.branchIds) {
      assertOwnBranches(actor, input.branchIds)
      await db.query(`delete from app.branch_memberships where membership_id = $1 and branch_id = any($2::uuid[])`, [id, actor.branchIds])
      for (const branchId of input.branchIds) {
        await db.query(
          `insert into app.branch_memberships (tenant_id, membership_id, branch_id) values ($1, $2, $3)`,
          [actor.tenantId, id, branchId],
        )
      }
    }
    await audit(db, actor, 'staff.updated', 'membership', id, {
      role: input.role, status: input.status, branchIds: input.branchIds, pinChanged: Boolean(input.pin),
    })
    return member
  })
})

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------

const newDevice = z.strictObject({ branchId: z.uuid(), name: z.string().trim().min(2).max(80) })

identity.get('/devices', requires('devices.manage'), async (c) => {
  const items = await tx(dbContext(c.get('actor')), async (db) => {
    const { rows } = await db.query(`select id, branch_id, name, status, last_seen_at from app.devices order by created_at`)
    return rows
  })
  return c.json({ items })
})

identity.post('/devices', requires('devices.manage'), async (c) => {
  const input = await readBody(c, newDevice)
  const actor = c.get('actor')
  assertOwnBranches(actor, [input.branchId])
  const secret = randomBytes(32).toString('base64url')
  const id = crypto.randomUUID()
  // Shown once. Only its hash is stored, and replaying this request returns the same credential.
  const credential = `${actor.tenantId}.${input.branchId}.${id}.${secret}`
  return command(c, 201, async (db) => {
    await db.query(
      `insert into app.devices (id, tenant_id, branch_id, name, credential_hash, registered_by)
       values ($1, $2, $3, $4, $5, $6)`,
      [id, actor.tenantId, input.branchId, input.name, sha256(secret).toString('hex'), actor.membershipId],
    )
    await audit(db, actor, 'device.registered', 'device', id, { name: input.name, branchId: input.branchId })
    return { id, credential }
  })
})

identity.post('/devices/:id/revoke', requires('devices.manage'), async (c) => {
  const id = z.uuid().parse(c.req.param('id'))
  await readBody(c, z.strictObject({}))
  return command(c, 200, async (db, actor) => {
    const { rowCount } = await db.query(`update app.devices set status = 'revoked' where id = $1`, [id])
    if (!rowCount) throw notFound('Device')
    await audit(db, actor, 'device.revoked', 'device', id)
    return { id, status: 'revoked' }
  })
})

identity.post('/staff/:id/unlock', requires('staff.write'), async (c) => {
  const id = z.uuid().parse(c.req.param('id'))
  await readBody(c, z.strictObject({}))
  return command(c, 200, async (db, actor) => {
    const target = await loadTarget(db, id)
    if (!can(actor, 'staff.write')) throw forbidden()
    assertCanManage(actor, target.role)
    await db.query(`update app.device_pin_attempts set failed_count = 0, locked_until = null where membership_id = $1`, [id])
    await audit(db, actor, 'staff.unlocked', 'membership', id)
    return { id }
  })
})
