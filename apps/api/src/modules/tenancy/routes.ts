import { Hono } from 'hono'
import { z } from 'zod'
import { audit, command, dbContext, readBody, requires, session, type Env } from '../../platform/context.js'
import { tx } from '../../platform/db.js'
import { forbidden, notFound } from '../../platform/errors.js'

export const tenancy = new Hono<Env>()
tenancy.use(session)

const settings = z.strictObject({
  displayName: z.string().trim().min(2).max(120).optional(),
  roundingRule: z.enum(['none', 'nearest_rupee']).optional(),
  pricesIncludeTax: z.boolean().optional(),
  allowSelfVerification: z.boolean().optional(),
})

const newBranch = z.strictObject({
  name: z.string().trim().min(2).max(120),
  code: z.string().regex(/^[A-Z0-9]{2,4}$/),
  taxRegistrationId: z.uuid(),
  address: z.string().trim().max(300).optional(),
  phone: z.string().trim().max(20).optional(),
})

const branchUpdate = z.strictObject({
  name: z.string().trim().min(2).max(120).optional(),
  address: z.string().trim().max(300).optional(),
  phone: z.string().trim().max(20).optional(),
  dayCutoff: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  isActive: z.boolean().optional(),
})

tenancy.get('/business', requires('business.read'), async (c) => {
  const actor = c.get('actor')
  const business = await tx(dbContext(actor), async (db) => {
    const { rows } = await db.query(
      `select id, display_name, logo_path, currency, rounding_rule, prices_include_tax, allow_self_verification
         from app.tenants where id = $1`,
      [actor.tenantId],
    )
    return rows[0]
  })
  return c.json(business)
})

tenancy.patch('/business', requires('business.write'), async (c) => {
  const input = await readBody(c, settings)
  return command(c, 200, async (db, actor) => {
    const { rows } = await db.query(
      `update app.tenants set
         display_name = coalesce($2, display_name),
         rounding_rule = coalesce($3, rounding_rule),
         prices_include_tax = coalesce($4, prices_include_tax),
         allow_self_verification = coalesce($5, allow_self_verification)
       where id = $1 returning id, display_name, rounding_rule, prices_include_tax, allow_self_verification`,
      [actor.tenantId, input.displayName, input.roundingRule, input.pricesIncludeTax, input.allowSelfVerification],
    )
    await audit(db, actor, 'business.updated', 'tenant', actor.tenantId, input)
    return rows[0]
  })
})

tenancy.get('/tax-registrations', requires('business.read'), async (c) => {
  const rows = await tx(dbContext(c.get('actor')), async (db) => {
    const result = await db.query(
      `select id, legal_name, trade_name, gstin, state_code, scheme, is_active from app.tax_registrations order by created_at`,
    )
    return result.rows
  })
  return c.json({ items: rows })
})

tenancy.get('/branches', requires('branches.read'), async (c) => {
  const actor = c.get('actor')
  const rows = await tx(dbContext(actor), async (db) => {
    const result = await db.query(
      `select id, name, code, address, phone, timezone, day_cutoff, is_active, tax_registration_id
         from app.branches where id = any($1::uuid[]) order by created_at`,
      [actor.branchIds],
    )
    return result.rows
  })
  return c.json({ items: rows })
})

tenancy.post('/branches', requires('branches.write'), async (c) => {
  const input = await readBody(c, newBranch)
  return command(c, 201, async (db, actor) => {
    const { rows: [branch] } = await db.query(
      `insert into app.branches (tenant_id, tax_registration_id, name, code, address, phone)
       values ($1, $2, $3, $4, $5, $6) returning id, name, code`,
      [actor.tenantId, input.taxRegistrationId, input.name, input.code, input.address, input.phone],
    )
    // The session's branch list predates this branch, so widen it for this transaction.
    await db.query(
      `select set_config('app.branch_ids', $1, true)`,
      [`{${[...actor.branchIds, branch.id].join(',')}}`],
    )
    await db.query(`insert into app.registers (tenant_id, branch_id, name) values ($1, $2, 'Main')`, [actor.tenantId, branch.id])
    await audit(db, actor, 'branch.created', 'branch', branch.id, input)
    return branch
  })
})

tenancy.patch('/branches/:id', requires('branches.write'), async (c) => {
  const id = z.uuid().parse(c.req.param('id'))
  if (!c.get('actor').branchIds.includes(id)) throw forbidden()
  const input = await readBody(c, branchUpdate)
  return command(c, 200, async (db, actor) => {
    const { rows } = await db.query(
      `update app.branches set
         name = coalesce($2, name), address = coalesce($3, address), phone = coalesce($4, phone),
         day_cutoff = coalesce($5::time, day_cutoff), is_active = coalesce($6, is_active)
       where id = $1 returning id, name, code, is_active`,
      [id, input.name, input.address, input.phone, input.dayCutoff, input.isActive],
    )
    if (!rows[0]) throw notFound('Branch')
    await audit(db, actor, 'branch.updated', 'branch', id, input)
    return rows[0]
  })
})
