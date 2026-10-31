import { Hono } from 'hono'
import { z } from 'zod'
import { audit, command, dbContext, readBody, requires, session, type Env } from '../../platform/context.js'
import { tx } from '../../platform/db.js'
import { notFound } from '../../platform/errors.js'

export const customers = new Hono<Env>()
customers.use(session)

const uuidParam = (value: string | undefined) => z.uuid().parse(value)
const name = z.string().trim().min(2).max(100)
const phone = z.string().regex(/^[0-9]{10}$/, 'Enter a 10-digit number.')
const email = z.union([z.literal(''), z.email().max(120)])
const address = z.string().trim().max(300)
const notes = z.string().trim().max(300)

const newCustomer = z.strictObject({ name, phone, email: email.optional(), address: address.optional(), notes: notes.optional() })
const customerUpdate = z.strictObject({ name: name.optional(), phone: phone.optional(), email: email.optional(), address: address.optional(), notes: notes.optional() })

const SORTS: Record<string, string> = {
  spend: 's.spent desc nulls last, c.name',
  recent: 's.last_visit desc nulls last, c.name',
  orders: 's.orders desc nulls last, c.name',
  newest: 'c.created_at desc',
  name: 'c.name',
}

// Bills only count once issued, and credit notes come off, so spend matches the books.
const CUSTOMER_STATS = `
  select count(distinct o.id)::int as orders, sum(n.grand_total - b.credited) as spent, max(o.created_at) as last_visit
    from app.orders o
    join app.invoices n on n.order_id = o.id
    join app.invoice_balances b on b.invoice_id = n.id
   where o.customer_id = c.id and o.status = 'finalized' and o.branch_id = any($1::uuid[])`

customers.get('/customers', requires('customers.read'), async (c) => {
  const actor = c.get('actor')
  const search = z.string().trim().max(60).default('').parse(c.req.query('search'))
  const sort = z.enum(['spend', 'recent', 'orders', 'newest', 'name']).default('name').parse(c.req.query('sort'))
  const offset = z.coerce.number().int().min(0).default(0).parse(c.req.query('offset'))
  const items = await tx(dbContext(actor), async (db) => {
    const { rows } = await db.query(
      `select c.id, c.name, c.phone, c.email, c.notes, c.created_at, coalesce(s.orders, 0) as orders,
              coalesce(s.spent, 0)::numeric(14,2)::text as spent, s.last_visit
         from app.customers c
         left join lateral (${CUSTOMER_STATS}) s on true
        where c.name ilike $2 or c.phone like $2 or c.email ilike $2
        order by ${SORTS[sort]} limit 50 offset $3`,
      [actor.branchIds, `%${search.replace(/[%_\\]/g, '\\$&')}%`, offset],
    )
    return rows
  })
  return c.json({ items, nextOffset: items.length === 50 ? offset + 50 : null })
})

customers.get('/customers/summary', requires('customers.read'), async (c) => {
  const actor = c.get('actor')
  const summary = await tx(dbContext(actor), async (db) => {
    const { rows: [row] } = await db.query(
      `select count(*)::int as total,
              count(*) filter (where s.last_visit > now() - interval '30 days')::int as recent,
              count(*) filter (where s.orders > 1)::int as repeat,
              coalesce(sum(s.spent), 0)::numeric(14,2)::text as lifetime
         from app.customers c
         left join lateral (${CUSTOMER_STATS}) s on true`,
      [actor.branchIds],
    )
    return row
  })
  return c.json(summary)
})

customers.get('/customers/:id', requires('customers.read'), async (c) => {
  const id = uuidParam(c.req.param('id'))
  const actor = c.get('actor')
  const profile = await tx(dbContext(actor), async (db) => {
    const { rows: [customer] } = await db.query(
      `select c.id, c.name, c.phone, c.email, c.address, c.notes, c.created_at, coalesce(s.orders, 0) as orders,
              coalesce(s.spent, 0)::numeric(14,2)::text as spent, s.last_visit
         from app.customers c
         left join lateral (${CUSTOMER_STATS}) s on true
        where c.id = $2`,
      [actor.branchIds, id],
    )
    if (!customer) throw notFound('Customer')
    const { rows: history } = await db.query(
      `select o.id, o.display_number, o.order_type, o.status, o.created_at, b.total::text as amount
         from app.orders o
         left join lateral (select sum(n.grand_total) as total from app.invoices n where n.order_id = o.id) b on true
        where o.customer_id = $1 and o.branch_id = any($2::uuid[])
        order by o.created_at desc limit 20`,
      [id, actor.branchIds],
    )
    const { rows: usual } = await db.query(
      `select i.product_name as name, sum(i.quantity)::text as quantity
         from app.order_items i join app.orders o on o.id = i.order_id
        where o.customer_id = $1 and o.status = 'finalized' and i.status = 'active' and o.branch_id = any($2::uuid[])
        group by i.product_name order by sum(i.quantity) desc limit 5`,
      [id, actor.branchIds],
    )
    return { ...customer, history, usual }
  })
  return c.json(profile)
})

customers.post('/customers', requires('customers.write'), async (c) => {
  const input = await readBody(c, newCustomer)
  return command(c, 201, async (db, actor) => {
    const { rows: [row] } = await db.query(
      `insert into app.customers (tenant_id, name, phone, email, address, notes) values ($1, $2, $3, nullif($4, ''), nullif($5, ''), nullif($6, ''))
       on conflict (tenant_id, phone) do update set name = excluded.name returning id, name, phone`,
      [actor.tenantId, input.name, input.phone, input.email ?? '', input.address ?? '', input.notes ?? ''],
    )
    return row
  })
})

customers.patch('/customers/:id', requires('customers.write'), async (c) => {
  const id = uuidParam(c.req.param('id'))
  const input = await readBody(c, customerUpdate)
  return command(c, 200, async (db, actor) => {
    const { rows: [row] } = await db.query(
      `update app.customers set name = coalesce($2, name), phone = coalesce($3, phone),
         email = case when $4::text is null then email else nullif($4, '') end,
         address = case when $5::text is null then address else nullif($5, '') end,
         notes = case when $6::text is null then notes else nullif($6, '') end
       where id = $1 returning id, name, phone, email, address, notes`,
      [id, input.name, input.phone, input.email, input.address, input.notes],
    )
    if (!row) throw notFound('Customer')
    await audit(db, actor, 'customer.updated', 'customer', id, { fields: Object.keys(input) })
    return row
  })
})
