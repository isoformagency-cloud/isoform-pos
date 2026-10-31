import { Hono } from 'hono'
import { z } from 'zod'
import { command, dbContext, readBody, requires, session, type Actor, type Env } from '../../platform/context.js'
import { tx, type Db } from '../../platform/db.js'
import { AppError, notFound } from '../../platform/errors.js'

export const kitchen = new Hono<Env>()
kitchen.use(session)

const STATUSES = ['new', 'preparing', 'ready', 'completed'] as const
const statusChange = z.strictObject({ from: z.enum(STATUSES), to: z.enum(STATUSES) })
  .refine((value) => Math.abs(STATUSES.indexOf(value.from) - STATUSES.indexOf(value.to)) === 1, { message: 'A ticket moves one step at a time.' })
const tick = z.strictObject({ done: z.boolean() })
const uuidParam = (value: string | undefined) => z.uuid().parse(value)

/** Sends everything not yet sent as one ticket. Returns nothing if there's nothing new. */
export async function sendToKitchen(db: Db, actor: Actor, orderId: string, branchId: string) {
  const { rows: unsent } = await db.query(
    `select i.id from app.order_items i
      where i.order_id = $1 and i.status = 'active'
        and not exists (select 1 from app.kitchen_ticket_items k where k.order_item_id = i.id)
      order by i.created_at`,
    [orderId],
  )
  if (unsent.length === 0) return null
  const { rows: [{ round }] } = await db.query(
    `select coalesce(max(round), 0) + 1 as round from app.kitchen_tickets where order_id = $1`,
    [orderId],
  )
  const { rows: [ticket] } = await db.query(
    `insert into app.kitchen_tickets (tenant_id, branch_id, order_id, round, sent_by) values ($1, $2, $3, $4, $5) returning id`,
    [actor.tenantId, branchId, orderId, round, actor.membershipId],
  )
  for (const item of unsent) {
    await db.query(
      `insert into app.kitchen_ticket_items (tenant_id, branch_id, ticket_id, order_item_id) values ($1, $2, $3, $4)`,
      [actor.tenantId, branchId, ticket.id, item.id],
    )
  }
  return ticket.id as string
}

/** A ticket with nothing left to make leaves the board. */
export async function closeEmptyTickets(db: Db, orderId: string) {
  await db.query(
    `update app.kitchen_tickets t set status = 'cancelled'
      where t.order_id = $1 and t.status <> 'completed' and not exists (
        select 1 from app.kitchen_ticket_items k join app.order_items i on i.id = k.order_item_id
         where k.ticket_id = t.id and i.status = 'active')`,
    [orderId],
  )
}

kitchen.get('/kitchen', requires('kitchen.read'), async (c) => {
  const actor = c.get('actor')
  const board = await tx(dbContext(actor), async (db) => {
    const { rows: tickets } = await db.query(
      `select t.id, t.status, t.round, t.sent_at, t.started_at, t.ready_at, t.completed_at, t.branch_id,
              o.id as order_id, o.display_number, o.order_type, o.aggregator, o.table_label, o.notes, c.name as customer_name,
              coalesce(jsonb_agg(jsonb_build_object(
                'id', k.id, 'name', i.product_name, 'variant', i.variant_name, 'quantity', i.quantity::text, 'notes', i.notes,
                'voided', i.status = 'voided', 'preparedAt', k.prepared_at,
                'addons', (select coalesce(jsonb_agg(a.addon_name), '[]') from app.order_item_addons a where a.order_item_id = i.id)
              ) order by i.created_at), '[]') as items
         from app.kitchen_tickets t
         join app.orders o on o.id = t.order_id
         left join app.customers c on c.id = o.customer_id
         join app.kitchen_ticket_items k on k.ticket_id = t.id
         join app.order_items i on i.id = k.order_item_id
        where t.branch_id = any($1::uuid[])
          and (t.status in ('new', 'preparing', 'ready') or (t.status = 'completed' and t.completed_at > now() - interval '2 hours'))
        group by t.id, o.id, c.name
        order by t.sent_at`,
      [actor.branchIds],
    )
    const { rows: [tenant] } = await db.query(`select kitchen_delay_minutes from app.tenants where id = $1`, [actor.tenantId])
    return { tickets, delayMinutes: tenant.kitchen_delay_minutes, serverTime: new Date().toISOString() }
  })
  return c.json(board)
})

kitchen.post('/kitchen/tickets/:id/status', requires('kitchen.update'), async (c) => {
  const id = uuidParam(c.req.param('id'))
  const input = await readBody(c, statusChange)
  return command(c, 200, async (db) => {
    // Moving back clears the later times, so a timer never claims work that was undone.
    const { rows: [ticket] } = await db.query(
      `update app.kitchen_tickets set status = $3,
         started_at = case when $3 = 'new' then null when $3 = 'preparing' then coalesce(started_at, now()) else started_at end,
         ready_at = case when $3 in ('new', 'preparing') then null when $3 = 'ready' then coalesce(ready_at, now()) else ready_at end,
         completed_at = case when $3 = 'completed' then now() end
       where id = $1 and status = $2 returning id, status`,
      [id, input.from, input.to],
    )
    if (ticket) return ticket
    const { rows: [current] } = await db.query(`select status from app.kitchen_tickets where id = $1`, [id])
    if (!current) throw notFound('Ticket')
    throw new AppError(409, 'stale_ticket', 'Someone else already moved this ticket. It has been refreshed.')
  })
})

kitchen.post('/kitchen/items/:id/tick', requires('kitchen.update'), async (c) => {
  const id = uuidParam(c.req.param('id'))
  const input = await readBody(c, tick)
  return command(c, 200, async (db) => {
    const { rows: [item] } = await db.query(
      `update app.kitchen_ticket_items set prepared_at = case when $2 then coalesce(prepared_at, now()) end where id = $1 returning id, prepared_at`,
      [id, input.done],
    )
    if (!item) throw notFound('Ticket item')
    return item
  })
})
