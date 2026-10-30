import { Hono } from 'hono'
import { z } from 'zod'
import { audit, command, dbContext, readBody, requires, session, type Actor, type Env } from '../../platform/context.js'
import { tx, type Db } from '../../platform/db.js'
import { AppError, forbidden, notFound } from '../../platform/errors.js'
import { can } from '../../platform/permissions.js'

export const orders = new Hono<Env>()
orders.use(session)

const version = z.number().int().positive()
const quantity = z.string().regex(/^\d{1,8}(\.\d{1,3})?$/).refine((value) => Number(value) > 0, 'Quantity must be above zero.')
const amount = z.string().regex(/^\d{1,12}(\.\d{1,2})?$/)
const reason = z.string().trim().min(2).max(300)
const uuidParam = (value: string | undefined) => z.uuid().parse(value)

const newOrder = z.strictObject({
  id: z.uuid(),
  orderType: z.enum(['dine_in', 'takeaway', 'delivery', 'aggregator']),
  aggregator: z.string().trim().min(2).max(40).optional(),
  aggregatorReference: z.string().trim().max(60).optional(),
  tableLabel: z.string().trim().max(30).optional(),
  notes: z.string().trim().max(300).optional(),
}).refine((value) => (value.orderType === 'aggregator') === Boolean(value.aggregator), {
  message: 'Choose the delivery app for this order.',
})

const orderUpdate = z.strictObject({
  version,
  tableLabel: z.string().trim().max(30).optional(),
  notes: z.string().trim().max(300).optional(),
  serviceChargePercent: amount.refine((value) => Number(value) <= 100).optional(),
  customerId: z.uuid().optional(),
})

// Prices are never accepted here. They always come from the menu, and strict parsing rejects them.
const newItem = z.strictObject({
  id: z.uuid(),
  variantId: z.uuid(),
  quantity: quantity.default('1'),
  notes: z.string().trim().max(200).optional(),
  addonIds: z.array(z.uuid()).max(20).default([]),
})
const itemUpdate = z.strictObject({ version, quantity: quantity.optional(), notes: z.string().trim().max(200).optional() })
const voidItem = z.strictObject({ version, reason })
const cancelOrder = z.strictObject({ version, reason })
const newDiscount = z.strictObject({
  id: z.uuid(),
  kind: z.enum(['percent', 'amount']),
  value: amount.refine((value) => Number(value) > 0),
  reason,
}).refine((value) => value.kind !== 'percent' || Number(value.value) <= 100, { message: 'A percentage cannot exceed 100.' })

function workingBranch(actor: Actor) {
  if (actor.branchIds.length !== 1) throw new AppError(400, 'branch_required', 'Choose a branch first.')
  return actor.branchIds[0]
}

async function loadOrder(db: Db, id: string) {
  const { rows: [order] } = await db.query(
    `select o.id, o.branch_id, o.display_number, o.order_type, o.aggregator, o.aggregator_reference, o.table_label, o.status,
            o.service_charge_percent::text, o.business_date::text, o.notes, o.version, o.created_at, o.cancel_reason,
            o.customer_id, c.name as customer_name
       from app.orders o left join app.customers c on c.id = o.customer_id where o.id = $1`,
    [id],
  )
  if (!order) throw notFound('Order')
  const { rows: items } = await db.query(
    `select i.id, i.variant_id, i.product_name, i.variant_name, i.unit_price::text, i.quantity::text, i.notes, i.status,
            coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.addon_name, 'unitPrice', a.unit_price::text, 'quantity', a.quantity::text))
              filter (where a.id is not null), '[]') as addons,
            round((i.unit_price + coalesce(sum(a.unit_price * a.quantity), 0)) * i.quantity, 2)::text as line_total
       from app.order_items i
       left join app.order_item_addons a on a.order_item_id = i.id
      where i.order_id = $1
      group by i.id order by i.created_at`,
    [id],
  )
  const { rows: discounts } = await db.query(
    `select id, kind, value::text, reason from app.order_discounts where order_id = $1 order by created_at`,
    [id],
  )
  // Worked out in the database so money never passes through floating point.
  const { rows: [totals] } = await db.query(
    `with sub as (
       select coalesce(sum(round((i.unit_price + coalesce(a.extra, 0)) * i.quantity, 2)), 0) as subtotal
         from app.order_items i
         left join lateral (select sum(unit_price * quantity) extra from app.order_item_addons where order_item_id = i.id) a on true
        where i.order_id = $1 and i.status = 'active'
     ), off as (
       select coalesce(sum(case when d.kind = 'amount' then d.value else round(s.subtotal * d.value / 100, 2) end), 0) as discount
         from sub s left join app.order_discounts d on d.order_id = $1
     )
     select s.subtotal::numeric(14,2)::text as subtotal, o.discount::numeric(14,2)::text as discount,
            (s.subtotal - o.discount)::numeric(14,2)::text as after_discount
       from sub s, off o`,
    [id],
  )
  return { ...order, items, discounts, ...totals }
}

/** Claims the order for this change. A stale version means someone else got there first. */
async function touch(db: Db, id: string, expected?: number) {
  const { rowCount } = await db.query(
    `update app.orders set updated_at = now() where id = $1 ${expected === undefined ? '' : 'and version = $2'}`,
    expected === undefined ? [id] : [id, expected],
  )
  if (rowCount) return
  const current = await loadOrder(db, id)
  throw new AppError(409, 'stale_order', 'This order was changed on another screen. It has been refreshed.', { order: current })
}

orders.get('/orders', requires('orders.read'), async (c) => {
  const actor = c.get('actor')
  const status = z.enum(['open', 'finalized', 'cancelled']).default('open').parse(c.req.query('status'))
  const before = z.iso.datetime({ offset: true }).optional().parse(c.req.query('before'))
  const items = await tx(dbContext(actor), async (db) => {
    const { rows } = await db.query(
      `select o.id, o.display_number, o.order_type, o.table_label, o.status, o.version, o.created_at, o.branch_id,
              (select count(*)::int from app.order_items i where i.order_id = o.id and i.status = 'active') as item_count
         from app.orders o
        where o.status = $1 and o.branch_id = any($2::uuid[]) and ($3::timestamptz is null or o.created_at < $3)
        order by o.created_at desc limit 50`,
      [status, actor.branchIds, before ?? null],
    )
    return rows
  })
  return c.json({ items, nextBefore: items.length === 50 ? items[49].created_at : null })
})

orders.get('/orders/:id', requires('orders.read'), async (c) => {
  const id = uuidParam(c.req.param('id'))
  return c.json(await tx(dbContext(c.get('actor')), (db) => loadOrder(db, id)))
})

orders.post('/orders', requires('orders.write'), async (c) => {
  const input = await readBody(c, newOrder)
  const branchId = workingBranch(c.get('actor'))
  return command(c, 201, async (db, actor) => {
    const { rows: [{ business_date }] } = await db.query(
      `select ((now() at time zone timezone) - day_cutoff::interval)::date::text as business_date from app.branches where id = $1`,
      [branchId],
    )
    // Held until commit, so two tills can never take the same number.
    await db.query(`select app.lock_record('order_number', $1)`, [branchId])
    const { rows: [{ next }] } = await db.query(
      `select coalesce(max(display_number), 0) + 1 as next from app.orders where branch_id = $1 and business_date = $2`,
      [branchId, business_date],
    )
    await db.query(
      `insert into app.orders (id, tenant_id, branch_id, display_number, order_type, aggregator, aggregator_reference,
         table_label, notes, business_date, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [input.id, actor.tenantId, branchId, next, input.orderType, input.aggregator, input.aggregatorReference,
        input.tableLabel, input.notes, business_date, actor.membershipId],
    )
    return loadOrder(db, input.id)
  })
})

orders.patch('/orders/:id', requires('orders.write'), async (c) => {
  const id = uuidParam(c.req.param('id'))
  const input = await readBody(c, orderUpdate)
  return command(c, 200, async (db, actor) => {
    const { rowCount } = await db.query(
      `update app.orders set
         table_label = coalesce($3, table_label), notes = coalesce($4, notes),
         service_charge_percent = coalesce($5, service_charge_percent),
         customer_id = coalesce($6, customer_id)
       where id = $1 and version = $2`,
      [id, input.version, input.tableLabel, input.notes, input.serviceChargePercent, input.customerId],
    )
    if (!rowCount) await touch(db, id, input.version)
    if (input.serviceChargePercent !== undefined) {
      await audit(db, actor, 'order.service_charge', 'order', id, { percent: input.serviceChargePercent })
    }
    return loadOrder(db, id)
  })
})

orders.post('/orders/:id/items', requires('orders.write'), async (c) => {
  const orderId = uuidParam(c.req.param('id'))
  const input = await readBody(c, newItem)
  return command(c, 201, async (db, actor) => {
    const { rows: [order] } = await db.query(`select branch_id from app.orders where id = $1`, [orderId])
    if (!order) throw notFound('Order')
    await touch(db, orderId)

    const { rows: [variant] } = await db.query(
      `select v.name, p.id as product_id, p.name as product_name, coalesce(o.price, v.price) as price,
              v.is_active and p.is_active and coalesce(o.is_available, true) as available
         from app.product_variants v
         join app.products p on p.id = v.product_id
         left join app.branch_variant_overrides o on o.variant_id = v.id and o.branch_id = $2
        where v.id = $1`,
      [input.variantId, order.branch_id],
    )
    if (!variant) throw notFound('Menu item')
    if (!variant.available) throw new AppError(409, 'item_unavailable', `${variant.product_name} is not available right now.`)

    await db.query(
      `insert into app.order_items (id, tenant_id, branch_id, order_id, variant_id, product_name, variant_name,
         unit_price, quantity, notes, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [input.id, actor.tenantId, order.branch_id, orderId, input.variantId, variant.product_name, variant.name,
        variant.price, input.quantity, input.notes, actor.membershipId],
    )

    const wanted = [...new Set(input.addonIds)]
    if (wanted.length) {
      const { rows: addons } = await db.query(
        `select a.id, a.name, a.price from app.addons a
           join app.product_addons pa on pa.addon_id = a.id and pa.product_id = $1
          where a.id = any($2::uuid[]) and a.is_active`,
        [variant.product_id, wanted],
      )
      if (addons.length !== wanted.length) throw new AppError(422, 'invalid_addon', 'That add-on is not available for this item.')
      for (const addon of addons) {
        await db.query(
          `insert into app.order_item_addons (id, tenant_id, branch_id, order_item_id, addon_id, addon_name, unit_price)
           values ($1, $2, $3, $4, $5, $6, $7)`,
          [crypto.randomUUID(), actor.tenantId, order.branch_id, input.id, addon.id, addon.name, addon.price],
        )
      }
    }
    return loadOrder(db, orderId)
  })
})

orders.patch('/orders/:id/items/:itemId', requires('orders.write'), async (c) => {
  const orderId = uuidParam(c.req.param('id'))
  const itemId = uuidParam(c.req.param('itemId'))
  const input = await readBody(c, itemUpdate)
  return command(c, 200, async (db, actor) => {
    await touch(db, orderId, input.version)
    const { rows: [before] } = await db.query(`select quantity::text from app.order_items where id = $1 and order_id = $2 and status = 'active'`, [itemId, orderId])
    if (!before) throw notFound('Order item')
    await db.query(
      `update app.order_items set quantity = coalesce($2, quantity), notes = coalesce($3, notes) where id = $1`,
      [itemId, input.quantity, input.notes],
    )
    if (input.quantity) await audit(db, actor, 'order_item.quantity', 'order_item', itemId, { quantity: input.quantity }, before)
    return loadOrder(db, orderId)
  })
})

orders.post('/orders/:id/items/:itemId/void', requires('orders.write'), async (c) => {
  const orderId = uuidParam(c.req.param('id'))
  const itemId = uuidParam(c.req.param('itemId'))
  const input = await readBody(c, voidItem)
  return command(c, 200, async (db, actor) => {
    await touch(db, orderId, input.version)
    const { rowCount } = await db.query(
      `update app.order_items set status = 'voided', void_reason = $3, voided_by = $4
        where id = $1 and order_id = $2 and status = 'active'`,
      [itemId, orderId, input.reason, actor.membershipId],
    )
    if (!rowCount) throw notFound('Order item')
    await audit(db, actor, 'order_item.voided', 'order_item', itemId, { reason: input.reason })
    return loadOrder(db, orderId)
  })
})

orders.post('/orders/:id/discounts', requires('orders.discount'), async (c) => {
  const orderId = uuidParam(c.req.param('id'))
  const input = await readBody(c, newDiscount)
  return command(c, 201, async (db, actor) => {
    const { rows: [order] } = await db.query(`select branch_id from app.orders where id = $1`, [orderId])
    if (!order) throw notFound('Order')
    await touch(db, orderId)
    await db.query(
      `insert into app.order_discounts (id, tenant_id, branch_id, order_id, kind, value, reason, approved_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [input.id, actor.tenantId, order.branch_id, orderId, input.kind, input.value, input.reason, actor.membershipId],
    )
    const updated = await loadOrder(db, orderId)
    if (Number(updated.after_discount) < 0) throw new AppError(409, 'discount_too_large', 'The discount is more than the order total.')
    await audit(db, actor, 'order.discount_added', 'order', orderId, input)
    return updated
  })
})

orders.delete('/orders/:id/discounts/:discountId', requires('orders.discount'), async (c) => {
  const orderId = uuidParam(c.req.param('id'))
  const discountId = uuidParam(c.req.param('discountId'))
  return command(c, 200, async (db, actor) => {
    await touch(db, orderId)
    const { rowCount } = await db.query(`delete from app.order_discounts where id = $1 and order_id = $2`, [discountId, orderId])
    if (!rowCount) throw notFound('Discount')
    await audit(db, actor, 'order.discount_removed', 'order', orderId, { discountId })
    return loadOrder(db, orderId)
  })
})

orders.post('/orders/:id/cancel', requires('orders.write'), async (c) => {
  const id = uuidParam(c.req.param('id'))
  const input = await readBody(c, cancelOrder)
  return command(c, 200, async (db, actor) => {
    const { rows: [{ active }] } = await db.query(
      `select count(*)::int as active from app.order_items where order_id = $1 and status = 'active'`,
      [id],
    )
    // Abandoning an empty order is routine. Cancelling one with items needs authority.
    if (active > 0 && !can(actor.role, 'orders.cancel')) throw forbidden()
    const { rowCount } = await db.query(
      `update app.orders set status = 'cancelled', cancel_reason = $3 where id = $1 and version = $2`,
      [id, input.version, input.reason],
    )
    if (!rowCount) await touch(db, id, input.version)
    await audit(db, actor, 'order.cancelled', 'order', id, { reason: input.reason, activeItems: active })
    return loadOrder(db, id)
  })
})
