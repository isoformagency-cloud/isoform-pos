import { Hono } from 'hono'
import { z } from 'zod'
import { dbContext, session, type Env } from '../../platform/context.js'
import { tx } from '../../platform/db.js'
import { can } from '../../platform/permissions.js'

export const workspace = new Hono<Env>()
workspace.use(session)

/** The few settings every screen needs, safe for any staff member to read. */
workspace.get('/pos-settings', async (c) => {
  const actor = c.get('actor')
  const settings = await tx(dbContext(actor), async (db) => {
    const { rows: [row] } = await db.query(
      `select display_name, upi_id, fssai_number, bill_footer, bill_format, discount_presets, cashier_discount_limit::text,
              uses_kitchen, kitchen_delay_minutes
         from app.tenants where id = $1`,
      [actor.tenantId],
    )
    return row
  })
  return c.json(settings)
})

/** Searches only what this person may already see. */
workspace.get('/search', async (c) => {
  const actor = c.get('actor')
  const q = z.string().trim().min(2).max(60).parse(c.req.query('q'))
  const like = `%${q.replace(/[%_\\]/g, '\\$&')}%`
  const number = /^#?\d{1,9}$/.test(q) ? Number(q.replace('#', '')) : null

  const results = await tx(dbContext(actor), async (db) => {
    const found: Record<string, unknown[]> = {}
    if (can(actor.role, 'orders.read')) {
      const { rows } = await db.query(
        `select o.id, o.display_number, o.order_type, o.status, o.table_label, o.business_date::text, c.name as customer_name
           from app.orders o left join app.customers c on c.id = o.customer_id
          where o.branch_id = any($1::uuid[])
            and (o.display_number = $2 or c.name ilike $3 or c.phone like $3 or o.table_label ilike $3)
          order by o.created_at desc limit 6`,
        [actor.branchIds, number, like],
      )
      found.orders = rows
    }
    if (can(actor.role, 'billing.read')) {
      const { rows } = await db.query(
        `select n.id, n.number, n.grand_total::text, n.invoice_date::text from app.invoices n
          where n.branch_id = any($1::uuid[]) and n.number ilike $2 order by n.issued_at desc limit 6`,
        [actor.branchIds, like],
      )
      found.bills = rows
    }
    if (can(actor.role, 'customers.read')) {
      const { rows } = await db.query(
        `select id, name, phone from app.customers where name ilike $1 or phone like $1 order by name limit 6`,
        [like],
      )
      found.customers = rows
    }
    if (can(actor.role, 'menu.read')) {
      const { rows } = await db.query(
        `select p.id, p.name, c.name as category from app.products p join app.categories c on c.id = p.category_id
          where p.name ilike $1 and p.is_active order by p.name limit 6`,
        [like],
      )
      found.menu = rows
    }
    if (can(actor.role, 'inventory.read')) {
      const { rows } = await db.query(
        `select id, name, category from app.stock_items where name ilike $1 and is_active order by name limit 6`,
        [like],
      )
      found.stock = rows
    }
    if (can(actor.role, 'staff.read')) {
      const { rows } = await db.query(
        `select id, display_name, role from app.memberships where display_name ilike $1 and status = 'active' order by display_name limit 6`,
        [like],
      )
      found.staff = rows
    }
    return found
  })
  return c.json(results)
})

/** Live counts for the sidebar and the bell. Only what this person can act on. */
workspace.get('/alerts', async (c) => {
  const actor = c.get('actor')
  const data = await tx(dbContext(actor), async (db) => {
    const { rows: [orders] } = await db.query(
      `select count(*) filter (where o.held_at is null)::int as running,
              count(*) filter (where o.held_at is not null)::int as held,
              count(*) filter (where o.business_date < ((now() at time zone b.timezone) - b.day_cutoff::interval)::date)::int as leftover
         from app.orders o join app.branches b on b.id = o.branch_id
        where o.status = 'open' and o.branch_id = any($1::uuid[])`,
      [actor.branchIds],
    )
    const counts = { runningOrders: 0, heldOrders: 0, leftoverOrders: 0, unpaidBills: 0, paymentsToVerify: 0, kitchenActive: 0, kitchenDelayed: 0, lowStock: 0 }
    if (can(actor.role, 'orders.read')) {
      counts.runningOrders = orders.running
      counts.heldOrders = orders.held
      counts.leftoverOrders = orders.leftover
    }
    if (can(actor.role, 'inventory.read')) {
      // Low or out in any branch this person works in.
      const { rows: [row] } = await db.query(
        `select count(*)::int as low from app.stock_items s
           cross join unnest($1::uuid[]) as b(id)
           left join app.stock_levels l on l.stock_item_id = s.id and l.branch_id = b.id
          where s.is_active and coalesce(l.quantity, 0) <= s.min_stock`,
        [actor.branchIds],
      )
      counts.lowStock = row.low
    }
    if (can(actor.role, 'kitchen.read')) {
      const { rows: [row] } = await db.query(
        `select count(*)::int as active,
                count(*) filter (where k.status in ('new', 'preparing')
                  and k.sent_at < now() - make_interval(mins => t.kitchen_delay_minutes))::int as delayed
           from app.kitchen_tickets k join app.tenants t on t.id = k.tenant_id
          where k.branch_id = any($1::uuid[]) and k.status in ('new', 'preparing', 'ready')`,
        [actor.branchIds],
      )
      counts.kitchenActive = row.active
      counts.kitchenDelayed = row.delayed
    }
    if (can(actor.role, 'billing.read')) {
      const { rows: [row] } = await db.query(
        `select count(*)::int as unpaid from app.invoices n join app.invoice_balances b on b.invoice_id = n.id
          where n.branch_id = any($1::uuid[]) and b.outstanding > 0`,
        [actor.branchIds],
      )
      counts.unpaidBills = row.unpaid
    }
    if (can(actor.role, 'payments.verify')) {
      const { rows: [row] } = await db.query(
        `select count(*)::int as waiting from app.payments where branch_id = any($1::uuid[]) and status = 'recorded'`,
        [actor.branchIds],
      )
      counts.paymentsToVerify = row.waiting
    }
    return counts
  })
  return c.json(data)
})
