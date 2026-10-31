import { Hono } from 'hono'
import { z } from 'zod'
import { audit, command, dbContext, readBody, requires, requiresAny, session, type Actor, type Env } from '../../platform/context.js'
import { tx, type Db } from '../../platform/db.js'
import { AppError, forbidden, notFound } from '../../platform/errors.js'
import { can } from '../../platform/permissions.js'
import { closeEmptyTickets, sendToKitchen } from '../kitchen/routes.js'
import { assertDiscountLimit } from './discount-limit.js'

export const orders = new Hono<Env>()
orders.use(session)

const version = z.number().int().positive()
const guests = z.number().int().min(1).max(200)
const address = z.string().trim().max(300)
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
  tableId: z.uuid().optional(),
  guestCount: guests.optional(),
  deliveryAddress: address.optional(),
  notes: z.string().trim().max(300).optional(),
}).refine((value) => (value.orderType === 'aggregator') === Boolean(value.aggregator), {
  message: 'Choose the delivery app for this order.',
}).refine((value) => !value.tableId || value.orderType === 'dine_in', { message: 'Only dine-in orders use a table.' })

const orderUpdate = z.strictObject({
  version,
  orderType: z.enum(['dine_in', 'takeaway', 'delivery', 'aggregator']).optional(),
  aggregator: z.string().trim().min(2).max(40).optional(),
  aggregatorReference: z.string().trim().max(60).optional(),
  tableLabel: z.string().trim().max(30).optional(),
  tableId: z.uuid().nullable().optional(),
  guestCount: guests.nullable().optional(),
  deliveryAddress: address.optional(),
  notes: z.string().trim().max(300).optional(),
  serviceChargePercent: amount.refine((value) => Number(value) <= 100).optional(),
  customerId: z.uuid().nullable().optional(),
}).refine((value) => value.orderType !== 'aggregator' || Boolean(value.aggregator), {
  message: 'Choose the delivery app for this order.',
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
const cancelOrder = z.strictObject({ version, reason: reason.optional() })
const confirmOrder = z.strictObject({ version })
const holdOrder = z.strictObject({ version, held: z.boolean() })
const sendOrder = z.strictObject({ version })
const mergeOrder = z.strictObject({ version, intoId: z.uuid(), intoVersion: version })
const newDiscount = z.strictObject({
  id: z.uuid(),
  kind: z.enum(['percent', 'amount']),
  value: amount.refine((value) => Number(value) > 0),
  reason: reason.optional(),
}).refine((value) => value.kind !== 'percent' || Number(value.value) <= 100, { message: 'A percentage cannot exceed 100.' })

function workingBranch(actor: Actor) {
  if (actor.branchIds.length !== 1) throw new AppError(400, 'branch_required', 'Choose a branch first.')
  return actor.branchIds[0]
}

async function loadOrder(db: Db, id: string) {
  const { rows: [order] } = await db.query(
    `select o.id, o.branch_id, o.display_number, o.order_type, o.aggregator, o.aggregator_reference, o.table_label, o.status,
            o.service_charge_percent::text, o.business_date::text, o.notes, o.version, o.created_at, o.cancel_reason, o.confirmed_at,
            o.held_at, o.guest_count, o.delivery_address, o.table_id,
            o.customer_id, c.name as customer_name, c.phone as customer_phone, c.notes as customer_notes
       from app.orders o left join app.customers c on c.id = o.customer_id where o.id = $1`,
    [id],
  )
  if (!order) throw notFound('Order')
  const { rows: items } = await db.query(
    `select i.id, i.variant_id, i.product_name, i.variant_name, i.unit_price::text, i.quantity::text, i.notes, i.status,
            t.status as kitchen_status, k.id is not null as sent,
            coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.addon_name, 'unitPrice', a.unit_price::text, 'quantity', a.quantity::text))
              filter (where a.id is not null), '[]') as addons,
            round((i.unit_price + coalesce(sum(a.unit_price * a.quantity), 0)) * i.quantity, 2)::text as line_total
       from app.order_items i
       left join app.order_item_addons a on a.order_item_id = i.id
       left join app.kitchen_ticket_items k on k.order_item_id = i.id
       left join app.kitchen_tickets t on t.id = k.ticket_id
      where i.order_id = $1
      group by i.id, k.id, t.status order by i.created_at`,
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

/** Finds a table an order can use. Each table holds one open order. */
async function freeTable(db: Db, tableId: string, orderId: string) {
  const { rows: [table] } = await db.query(`select name from app.dining_tables where id = $1 and is_active`, [tableId])
  if (!table) throw notFound('Table')
  const { rows: taken } = await db.query(`select 1 from app.orders where table_id = $1 and status = 'open' and id <> $2`, [tableId, orderId])
  if (taken.length) throw new AppError(409, 'table_busy', 'This table already has an open order.')
  return table.name as string
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

const listFilters = z.object({
  status: z.enum(['open', 'finalized', 'cancelled', 'all']).optional(),
  held: z.enum(['true', 'false']).optional(),
  type: z.enum(['dine_in', 'takeaway', 'delivery', 'aggregator']).optional(),
  q: z.string().trim().max(60).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  before: z.iso.datetime({ offset: true }).optional(),
})
type ListFilters = z.infer<typeof listFilters>

async function listOrders(db: Db, actor: Actor, filters: ListFilters, limit: number) {
  const status = filters.status === 'all' ? null : filters.status ?? null
  const search = filters.q ? `%${filters.q.replace(/[%_\\]/g, '\\$&')}%` : null
  const number = filters.q && /^#?\d{1,9}$/.test(filters.q) ? Number(filters.q.replace('#', '')) : null
  const { rows } = await db.query(
    `select o.id, o.display_number, o.order_type, o.aggregator, o.table_label, o.status, o.version, o.created_at, o.branch_id,
            o.confirmed_at, o.held_at, o.guest_count, o.business_date::text, o.cancel_reason, o.table_id,
            c.name as customer_name, c.phone as customer_phone,
            line.item_count, coalesce(bill.total, line.subtotal)::numeric(14,2)::text as amount,
            bill.outstanding::text, bill.paid::text, bill.numbers as bill_numbers
       from app.orders o
       left join app.customers c on c.id = o.customer_id
       left join lateral (
         select count(*)::int as item_count, coalesce(sum(round((i.unit_price + coalesce(a.extra, 0)) * i.quantity, 2)), 0) as subtotal
           from app.order_items i
           left join lateral (select sum(unit_price * quantity) extra from app.order_item_addons where order_item_id = i.id) a on true
          where i.order_id = o.id and i.status = 'active'
       ) line on true
       left join lateral (
         select sum(n.grand_total) as total, sum(b.outstanding) as outstanding, sum(b.allocated) as paid, array_agg(n.number) as numbers
           from app.invoices n join app.invoice_balances b on b.invoice_id = n.id where n.order_id = o.id
       ) bill on o.status = 'finalized'
      where o.branch_id = any($1::uuid[])
        and ($2::text is null or o.status = $2)
        and ($3::boolean is null or (o.held_at is not null) = $3)
        and ($4::text is null or o.order_type = $4)
        and ($5::date is null or o.business_date >= $5)
        and ($6::date is null or o.business_date <= $6)
        and ($7::timestamptz is null or o.created_at < $7)
        and ($8::text is null or o.display_number = $9::int or c.name ilike $8 or c.phone like $8 or o.table_label ilike $8
             or exists (select 1 from app.invoices n where n.order_id = o.id and n.number ilike $8))
      order by o.created_at desc limit $10`,
    [actor.branchIds, status, filters.held ? filters.held === 'true' : null, filters.type ?? null,
      filters.from ?? null, filters.to ?? null, filters.before ?? null, search, number, limit],
  )
  return rows
}

orders.get('/orders', requires('orders.read'), async (c) => {
  const actor = c.get('actor')
  const filters = listFilters.parse(c.req.query())
  const items = await tx(dbContext(actor), (db) => listOrders(db, actor, { ...filters, status: filters.status ?? (filters.q ? undefined : 'open') }, 50))
  return c.json({ items, nextBefore: items.length === 50 ? items[49].created_at : null })
})

orders.get('/orders/counts', requires('orders.read'), async (c) => {
  const actor = c.get('actor')
  const counts = await tx(dbContext(actor), async (db) => {
    const { rows: [row] } = await db.query(
      `select count(*) filter (where status = 'open' and held_at is null)::int as running,
              count(*) filter (where status = 'open' and held_at is not null)::int as held,
              count(*) filter (where status = 'finalized')::int as completed,
              count(*) filter (where status = 'cancelled')::int as cancelled
         from app.orders where branch_id = any($1::uuid[])`,
      [actor.branchIds],
    )
    return row
  })
  return c.json(counts)
})

orders.get('/orders/export', requires('reports.read'), async (c) => {
  const actor = c.get('actor')
  const filters = listFilters.parse(c.req.query())
  const items = await tx(dbContext(actor), (db) => listOrders(db, actor, filters, 5000))
  return c.json({ items })
})

orders.get('/orders/:id', requires('orders.read'), async (c) => {
  const id = uuidParam(c.req.param('id'))
  return c.json(await tx(dbContext(c.get('actor')), (db) => loadOrder(db, id)))
})

orders.get('/orders/:id/timeline', requires('orders.read'), async (c) => {
  const id = uuidParam(c.req.param('id'))
  const actor = c.get('actor')
  const events = await tx(dbContext(actor), async (db) => {
    const { rows: [order] } = await db.query(
      `select o.created_at, o.confirmed_at, o.held_at, o.cancel_reason, by_c.display_name as created_by, by_k.display_name as confirmed_by
         from app.orders o
         join app.memberships by_c on by_c.id = o.created_by
         left join app.memberships by_k on by_k.id = o.confirmed_by
        where o.id = $1`,
      [id],
    )
    if (!order) throw notFound('Order')
    const timeline = [{ at: order.created_at, label: 'Order started', by: order.created_by }]
    if (order.confirmed_at) timeline.push({ at: order.confirmed_at, label: 'Order confirmed', by: order.confirmed_by })
    if (order.held_at) timeline.push({ at: order.held_at, label: 'Put on hold', by: null })
    const { rows: changes } = await db.query(
      `select h.changed_at, m.display_name from app.order_status_history h
         left join app.memberships m on m.id = h.changed_by where h.order_id = $1 and h.to_status = 'cancelled'`,
      [id],
    )
    for (const change of changes) timeline.push({ at: change.changed_at, label: `Cancelled: ${order.cancel_reason}`, by: change.display_name })
    const { rows: rounds } = await db.query(
      `select t.round, t.sent_at, t.ready_at, t.completed_at, m.display_name from app.kitchen_tickets t
         join app.memberships m on m.id = t.sent_by where t.order_id = $1`,
      [id],
    )
    for (const round of rounds) {
      const label = rounds.length > 1 ? ` (round ${round.round})` : ''
      timeline.push({ at: round.sent_at, label: `Sent to kitchen${label}`, by: round.display_name })
      if (round.ready_at) timeline.push({ at: round.ready_at, label: `Ready${label}`, by: null })
      if (round.completed_at) timeline.push({ at: round.completed_at, label: `Served${label}`, by: null })
    }
    if (can(actor.role, 'billing.read')) {
      const { rows: bills } = await db.query(
        `select n.number, n.grand_total::text, n.issued_at, m.display_name from app.invoices n
           join app.memberships m on m.id = n.issued_by where n.order_id = $1`,
        [id],
      )
      for (const bill of bills) timeline.push({ at: bill.issued_at, label: `Bill ${bill.number} issued for ₹${bill.grand_total}`, by: bill.display_name })
    }
    if (can(actor.role, 'payments.read')) {
      const { rows: paid } = await db.query(
        `select distinct on (p.id) p.received_at, p.amount::text, k.name as method, m.display_name
           from app.payments p
           join app.payment_allocations a on a.payment_id = p.id
           join app.invoices n on n.id = a.invoice_id
           join app.payment_methods k on k.id = p.method_id
           join app.memberships m on m.id = p.recorded_by
          where n.order_id = $1 and p.status in ('recorded', 'confirmed')`,
        [id],
      )
      for (const payment of paid) timeline.push({ at: payment.received_at, label: `${payment.method} payment of ₹${payment.amount}`, by: payment.display_name })
    }
    return timeline.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
  })
  return c.json({ items: events })
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
    const tableName = input.tableId ? await freeTable(db, input.tableId, input.id) : null
    await db.query(`select app.lock_record('order_number', $1)`, [branchId])
    const { rows: [{ next }] } = await db.query(
      `select coalesce(max(display_number), 0) + 1 as next from app.orders where branch_id = $1 and business_date = $2`,
      [branchId, business_date],
    )
    await db.query(
      `insert into app.orders (id, tenant_id, branch_id, display_number, order_type, aggregator, aggregator_reference,
         table_label, notes, business_date, created_by, guest_count, delivery_address, table_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [input.id, actor.tenantId, branchId, next, input.orderType, input.aggregator, input.aggregatorReference,
        tableName ?? input.tableLabel, input.notes, business_date, actor.membershipId, input.guestCount, input.deliveryAddress, input.tableId],
    )
    if (input.tableId) await db.query(`update app.dining_tables set seated_at = null, seated_guests = null where id = $1`, [input.tableId])
    return loadOrder(db, input.id)
  })
})

orders.patch('/orders/:id', requires('orders.write'), async (c) => {
  const id = uuidParam(c.req.param('id'))
  const input = await readBody(c, orderUpdate)
  return command(c, 200, async (db, actor) => {
    if (input.tableId) {
      const { rows: [current] } = await db.query(`select order_type from app.orders where id = $1`, [id])
      if (!current) throw notFound('Order')
      if ((input.orderType ?? current.order_type) !== 'dine_in') throw new AppError(422, 'not_dine_in', 'Only dine-in orders use a table.')
    }
    const tableName = input.tableId ? await freeTable(db, input.tableId, id) : null
    const leavesTable = input.tableId === null || (input.orderType && input.orderType !== 'dine_in')
    const { rowCount } = await db.query(
      `update app.orders set
         table_label = case when $14 then null else coalesce($3, table_label) end, notes = coalesce($4, notes),
         service_charge_percent = coalesce($5, service_charge_percent),
         customer_id = case when $7 then $6::uuid else customer_id end,
         order_type = coalesce($8, order_type),
         aggregator = case when $8::text is null then aggregator when $8 = 'aggregator' then $9 end,
         aggregator_reference = case when $8::text is null then aggregator_reference when $8 = 'aggregator' then $10 end,
         guest_count = case when $11 then $12::int else guest_count end,
         delivery_address = coalesce($13, delivery_address),
         table_id = case when $14 then null else coalesce($15, table_id) end
       where id = $1 and version = $2`,
      [id, input.version, tableName ?? input.tableLabel, input.notes, input.serviceChargePercent, input.customerId ?? null, input.customerId !== undefined,
        input.orderType, input.aggregator, input.aggregatorReference, input.guestCount !== undefined, input.guestCount ?? null, input.deliveryAddress,
        Boolean(leavesTable), input.tableId ?? null],
    )
    if (!rowCount) await touch(db, id, input.version)
    if (input.tableId) await db.query(`update app.dining_tables set seated_at = null, seated_guests = null where id = $1`, [input.tableId])
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
    const { rows: [before] } = await db.query(
      `select i.quantity::text, exists (select 1 from app.kitchen_ticket_items k where k.order_item_id = i.id) as sent
         from app.order_items i where i.id = $1 and i.order_id = $2 and i.status = 'active'`,
      [itemId, orderId],
    )
    if (!before) throw notFound('Order item')
    if (before.sent) throw new AppError(409, 'item_sent', 'This item has gone to the kitchen. Add a new one instead.')
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
    const { rows: [sent] } = await db.query(`select 1 as yes from app.kitchen_ticket_items where order_item_id = $1`, [itemId])
    if (sent && !can(actor.role, 'orders.cancel')) {
      throw new AppError(403, 'manager_needed', 'This item has gone to the kitchen. Ask a manager to remove it.')
    }
    const { rowCount } = await db.query(
      `update app.order_items set status = 'voided', void_reason = $3, voided_by = $4
        where id = $1 and order_id = $2 and status = 'active'`,
      [itemId, orderId, input.reason, actor.membershipId],
    )
    if (!rowCount) throw notFound('Order item')
    if (sent) await closeEmptyTickets(db, orderId)
    await audit(db, actor, 'order_item.voided', 'order_item', itemId, { reason: input.reason })
    return loadOrder(db, orderId)
  })
})

orders.post('/orders/:id/discounts', requiresAny('orders.discount', 'orders.discount_limited'), async (c) => {
  const orderId = uuidParam(c.req.param('id'))
  const input = await readBody(c, newDiscount)
  return command(c, 201, async (db, actor) => {
    const { rows: [order] } = await db.query(`select branch_id from app.orders where id = $1`, [orderId])
    if (!order) throw notFound('Order')
    await touch(db, orderId)
    await db.query(
      `insert into app.order_discounts (id, tenant_id, branch_id, order_id, kind, value, reason, approved_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [input.id, actor.tenantId, order.branch_id, orderId, input.kind, input.value, input.reason ?? 'No reason given', actor.membershipId],
    )
    const updated = await loadOrder(db, orderId)
    if (Number(updated.after_discount) < 0) throw new AppError(409, 'discount_too_large', 'The discount is more than the order total.')
    await assertDiscountLimit(db, actor.tenantId, orderId)
    await audit(db, actor, 'order.discount_added', 'order', orderId, input)
    return updated
  })
})

orders.delete('/orders/:id/discounts/:discountId', requiresAny('orders.discount', 'orders.discount_limited'), async (c) => {
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
    // Deleting an empty order is routine. Cancelling one with items needs authority and a reason.
    if (active > 0 && !can(actor.role, 'orders.cancel')) throw forbidden()
    if (active > 0 && !input.reason) throw new AppError(422, 'reason_required', 'Give a reason for cancelling this order.')
    const cancelReason = input.reason ?? 'Empty order'
    const { rowCount } = await db.query(
      `update app.orders set status = 'cancelled', cancel_reason = $3 where id = $1 and version = $2`,
      [id, input.version, cancelReason],
    )
    if (!rowCount) await touch(db, id, input.version)
    await db.query(`update app.kitchen_tickets set status = 'cancelled' where order_id = $1 and status <> 'completed'`, [id])
    await audit(db, actor, 'order.cancelled', 'order', id, { reason: cancelReason, activeItems: active })
    return loadOrder(db, id)
  })
})

/** Sends everything new to the kitchen. Each send is a round, so a table can order more later. */
orders.post('/orders/:id/send', requires('orders.write'), async (c) => {
  const id = uuidParam(c.req.param('id'))
  const input = await readBody(c, sendOrder)
  return command(c, 200, async (db, actor) => {
    const { rows: [order] } = await db.query(`select branch_id from app.orders where id = $1`, [id])
    if (!order) throw notFound('Order')
    const { rows: [tenant] } = await db.query(`select uses_kitchen from app.tenants where id = $1`, [actor.tenantId])
    if (!tenant.uses_kitchen) throw new AppError(409, 'kitchen_off', 'The kitchen display is turned off in Settings.')
    await touch(db, id, input.version)
    const ticket = await sendToKitchen(db, actor, id, order.branch_id)
    if (!ticket) throw new AppError(409, 'nothing_to_send', 'Everything on this order is already with the kitchen.')
    await audit(db, actor, 'order.sent_to_kitchen', 'order', id, { ticket })
    return loadOrder(db, id)
  })
})

/** Combines two tables' orders. Bills haven't been issued, so the second order simply closes. */
orders.post('/orders/:id/merge', requires('orders.write'), async (c) => {
  const id = uuidParam(c.req.param('id'))
  const input = await readBody(c, mergeOrder)
  if (id === input.intoId) throw new AppError(422, 'same_order', 'Choose a different table.')
  return command(c, 200, async (db, actor) => {
    // A fixed order means two merges running at once can never deadlock.
    const steps: [string, number][] = [[id, input.version], [input.intoId, input.intoVersion]]
    for (const [orderId, expected] of steps.sort(([a], [b]) => a.localeCompare(b))) await touch(db, orderId, expected)

    const { rows: both } = await db.query(
      `select o.id, o.display_number, o.status, o.confirmed_at, o.guest_count,
              (select count(*)::int from app.order_discounts d where d.order_id = o.id) as discounts
         from app.orders o where o.id = any($1::uuid[])`,
      [[id, input.intoId]],
    )
    const from = both.find((row) => row.id === id)
    const into = both.find((row) => row.id === input.intoId)
    if (!from || !into) throw notFound('Order')
    if (from.status !== 'open' || into.status !== 'open') throw new AppError(409, 'order_closed', 'Both orders must still be open.')
    if (from.confirmed_at || into.confirmed_at) throw new AppError(409, 'order_confirmed', 'Confirmed orders can’t be merged.')
    if (from.discounts > 0) throw new AppError(409, 'has_discount', 'Remove the discount before merging this order.')

    await db.query(`update app.order_items set order_id = $2 where order_id = $1`, [id, input.intoId])
    await db.query(`update app.kitchen_tickets set order_id = $2 where order_id = $1`, [id, input.intoId])
    await db.query(
      `update app.orders set status = 'cancelled', cancel_reason = $2, table_id = null where id = $1`,
      [id, `Merged into order #${into.display_number}`],
    )
    if (from.guest_count) {
      await db.query(`update app.orders set guest_count = coalesce(guest_count, 0) + $2 where id = $1`, [input.intoId, from.guest_count])
    }
    await audit(db, actor, 'order.merged', 'order', id, { into: input.intoId })
    return loadOrder(db, input.intoId)
  })
})

/** Parks an order so it leaves the running list. It can be picked up again at any time. */
orders.post('/orders/:id/hold', requires('orders.write'), async (c) => {
  const id = uuidParam(c.req.param('id'))
  const input = await readBody(c, holdOrder)
  return command(c, 200, async (db, actor) => {
    const { rowCount } = await db.query(
      `update app.orders set held_at = case when $3 then now() end where id = $1 and version = $2`,
      [id, input.version, input.held],
    )
    if (!rowCount) await touch(db, id, input.version)
    await audit(db, actor, input.held ? 'order.held' : 'order.resumed', 'order', id)
    return loadOrder(db, id)
  })
})

/** Locks what was ordered. After this, only a discount can change the bill. */
orders.post('/orders/:id/confirm', requires('orders.write'), async (c) => {
  const id = uuidParam(c.req.param('id'))
  const input = await readBody(c, confirmOrder)
  return command(c, 200, async (db, actor) => {
    const { rows: [{ active }] } = await db.query(
      `select count(*)::int as active from app.order_items where order_id = $1 and status = 'active'`,
      [id],
    )
    if (active === 0) throw new AppError(409, 'empty_order', 'Add at least one item first.')
    const { rows: [order] } = await db.query(`select branch_id from app.orders where id = $1`, [id])
    const { rowCount } = await db.query(
      `update app.orders set confirmed_at = now(), confirmed_by = $3
        where id = $1 and version = $2 and confirmed_at is null`,
      [id, input.version, actor.membershipId],
    )
    if (!rowCount) await touch(db, id, input.version)
    // Nothing confirmed should be forgotten, so anything still unsent goes now.
    const { rows: [tenant] } = await db.query(`select uses_kitchen from app.tenants where id = $1`, [actor.tenantId])
    if (tenant.uses_kitchen) await sendToKitchen(db, actor, id, order.branch_id)
    await audit(db, actor, 'order.confirmed', 'order', id, { activeItems: active })
    return loadOrder(db, id)
  })
})
