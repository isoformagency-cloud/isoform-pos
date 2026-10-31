import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { dbContext, requires, session, type Env } from '../../platform/context.js'
import { tx, type Db } from '../../platform/db.js'
import { AppError, forbidden } from '../../platform/errors.js'
import { can } from '../../platform/permissions.js'

export const reports = new Hono<Env>()
reports.use(session)

const MAX_DAYS = 92
const DAY = 86400000
const text = (expression: string) => `coalesce(${expression}, 0)::numeric(14,2)::text`
const hourLabel = (hour: number) => `${hour % 12 || 12} ${hour < 12 ? 'AM' : 'PM'}`

/**
 * Every figure has one meaning, listed in docs/02-system-architecture.md section 12.
 * Days are trading days, so a bill at 12:30 AM counts towards the previous day.
 * Sales exclude tax. Recorded, confirmed and outstanding are never merged.
 */
reports.get('/reports/daily', requires('reports.read'), async (c) => {
  const actor = c.get('actor')
  const from = z.iso.date().parse(c.req.query('from'))
  const to = z.iso.date().parse(c.req.query('to') ?? from)
  const days = (Date.parse(to) - Date.parse(from)) / 86400000
  if (days < 0 || days > MAX_DAYS) throw new AppError(422, 'invalid_range', `Choose a range of up to ${MAX_DAYS} days.`)
  const branchId = z.uuid().optional().parse(c.req.query('branchId'))
  if (branchId && !actor.branchIds.includes(branchId)) throw forbidden()
  const branches = branchId ? [branchId] : actor.branchIds

  const report = await tx(dbContext(actor), async (db) => {
    const scope = [branches, from, to]
    const { rows: [sales] } = await db.query(
      `with billed as (
         select count(*)::int as bills, sum(taxable_total) as taxable, sum(cgst_total) as cgst, sum(sgst_total) as sgst,
                sum(igst_total) as igst, sum(cess_total) as cess, sum(round_off) as round_off, sum(grand_total) as grand
           from app.invoices where branch_id = any($1::uuid[]) and business_date between $2 and $3
       ), credited as (
         select count(*)::int as notes, sum(taxable_total) as taxable, sum(cgst_total) as cgst, sum(sgst_total) as sgst,
                sum(igst_total) as igst, sum(cess_total) as cess, sum(round_off) as round_off, sum(grand_total) as grand
           from app.credit_notes where branch_id = any($1::uuid[]) and business_date between $2 and $3
       )
       select b.bills, c.notes as credit_notes,
              ${text('b.taxable')} as billed_sales,
              ${text('c.taxable')} as credited_sales,
              ${text('coalesce(b.taxable, 0) - coalesce(c.taxable, 0)')} as net_sales,
              ${text('coalesce(b.cgst, 0) - coalesce(c.cgst, 0)')} as cgst,
              ${text('coalesce(b.sgst, 0) - coalesce(c.sgst, 0)')} as sgst,
              ${text('coalesce(b.igst, 0) - coalesce(c.igst, 0)')} as igst,
              ${text('coalesce(b.cess, 0) - coalesce(c.cess, 0)')} as cess,
              ${text('coalesce(b.round_off, 0) - coalesce(c.round_off, 0)')} as round_off,
              ${text('coalesce(b.grand, 0) - coalesce(c.grand, 0)')} as net_total
         from billed b, credited c`,
      scope,
    )

    const { rows: [orders] } = await db.query(
      `select count(*) filter (where status = 'finalized')::int as billed,
              count(*) filter (where status = 'cancelled')::int as cancelled,
              count(*) filter (where status = 'open')::int as still_open
         from app.orders where branch_id = any($1::uuid[]) and business_date between $2 and $3`,
      scope,
    )

    const { rows: payments } = await db.query(
      `select m.name as method, p.method_kind as kind,
              ${text(`sum(p.amount) filter (where p.status in ('recorded', 'confirmed'))`)} as recorded,
              ${text(`sum(p.amount) filter (where p.status = 'confirmed')`)} as confirmed,
              ${text(`sum(p.tip_amount) filter (where p.status in ('recorded', 'confirmed'))`)} as tips
         from app.payments p join app.payment_methods m on m.id = p.method_id
        where p.branch_id = any($1::uuid[]) and p.business_date between $2 and $3
        group by m.name, p.method_kind order by m.name`,
      scope,
    )

    const { rows: [paymentTotals] } = await db.query(
      `select ${text(`sum(amount) filter (where status in ('recorded', 'confirmed'))`)} as recorded,
              ${text(`sum(amount) filter (where status = 'confirmed')`)} as confirmed,
              ${text(`sum(amount) filter (where status = 'recorded')`)} as awaiting_check,
              count(*) filter (where status = 'recorded')::int as awaiting_count,
              ${text(`sum(tip_amount) filter (where status in ('recorded', 'confirmed'))`)} as tips
         from app.payments where branch_id = any($1::uuid[]) and business_date between $2 and $3`,
      scope,
    )

    const { rows: [refunds] } = await db.query(
      `select count(*)::int as count, ${text('sum(amount)')} as total
         from app.refunds where branch_id = any($1::uuid[]) and business_date between $2 and $3 and status not in ('failed', 'voided')`,
      scope,
    )

    const { rows: [outstanding] } = await db.query(
      `select count(*) filter (where b.outstanding > 0)::int as bills, ${text('sum(greatest(b.outstanding, 0))')} as total
         from app.invoices i join app.invoice_balances b on b.invoice_id = i.id
        where i.branch_id = any($1::uuid[]) and i.business_date between $2 and $3`,
      scope,
    )

    const { rows: cash } = await db.query(
      `select s.id, r.name as register, s.business_date::text, s.status, s.opening_amount::text, s.expected_amount::text,
              s.counted_amount::text, s.variance::text, b.name as branch
         from app.cash_sessions s
         join app.registers r on r.id = s.register_id
         join app.branches b on b.id = s.branch_id
        where s.branch_id = any($1::uuid[]) and s.business_date between $2 and $3
        order by s.opened_at desc`,
      scope,
    )

    const { rows: items } = await db.query(
      `select l.description, sum(l.quantity)::numeric(14,3)::text as quantity, ${text('sum(l.taxable_value)')} as sales
         from app.invoice_lines l join app.invoices i on i.id = l.invoice_id
        where i.branch_id = any($1::uuid[]) and i.business_date between $2 and $3 and l.order_item_id is not null
        group by l.description order by sum(l.taxable_value) desc limit 10`,
      scope,
    )

    const { rows: taxRates } = await db.query(
      `select (l.cgst_rate + l.sgst_rate + l.igst_rate + l.cess_rate)::numeric(6,3)::text as rate,
              ${text('sum(l.taxable_value)')} as taxable, ${text('sum(l.cgst + l.sgst + l.igst + l.cess)')} as tax
         from app.invoice_lines l join app.invoices i on i.id = l.invoice_id
        where i.branch_id = any($1::uuid[]) and i.business_date between $2 and $3
        group by 1 order by 1`,
      scope,
    )

    const { rows: byBranch } = await db.query(
      `select b.id, b.name,
              ${text('(select sum(taxable_total) from app.invoices i where i.branch_id = b.id and i.business_date between $2 and $3)')} as billed_sales,
              ${text('(select sum(taxable_total) from app.credit_notes n where n.branch_id = b.id and n.business_date between $2 and $3)')} as credited_sales
         from app.branches b where b.id = any($1::uuid[]) order by b.name`,
      scope,
    )

    return { from, to, sales, orders, paymentTotals, payments, refunds, outstanding, cash, items, taxRates, byBranch }
  })
  return c.json(report)
})

function scope(c: Context<Env>) {
  const actor = c.get('actor')
  const from = z.iso.date().parse(c.req.query('from'))
  const to = z.iso.date().parse(c.req.query('to') ?? from)
  const days = (Date.parse(to) - Date.parse(from)) / DAY
  if (days < 0 || days > MAX_DAYS) throw new AppError(422, 'invalid_range', `Choose a range of up to ${MAX_DAYS} days.`)
  const branchId = z.uuid().optional().parse(c.req.query('branchId'))
  if (branchId && !actor.branchIds.includes(branchId)) throw forbidden()
  return { actor, from, to, branches: branchId ? [branchId] : actor.branchIds }
}

const shift = (date: string, days: number) => new Date(Date.parse(date) + days * DAY).toISOString().slice(0, 10)

/** The same number of days straight before a range, so a comparison is always like for like. */
const periodBefore = (from: string, to: string) => {
  const length = (Date.parse(to) - Date.parse(from)) / DAY
  return { from: shift(from, -length - 1), to: shift(from, -1) }
}

async function totals(db: Db, branches: string[], from: string, to: string) {
  const { rows: [row] } = await db.query(
    `select (select count(*)::int from app.invoices where branch_id = any($1::uuid[]) and business_date between $2 and $3) as bills,
            (select count(*) filter (where status = 'finalized')::int from app.orders where branch_id = any($1::uuid[]) and business_date between $2 and $3) as orders,
            (select count(*) filter (where status = 'cancelled')::int from app.orders where branch_id = any($1::uuid[]) and business_date between $2 and $3) as cancelled,
            ${text(`(select sum(taxable_total) from app.invoices where branch_id = any($1::uuid[]) and business_date between $2 and $3)
              - coalesce((select sum(taxable_total) from app.credit_notes where branch_id = any($1::uuid[]) and business_date between $2 and $3), 0)`)} as net_sales`,
    [branches, from, to],
  )
  return { ...row, average_order: row.orders ? (Number(row.net_sales) / row.orders).toFixed(2) : '0.00' }
}

async function salesView(db: Db, branches: string[], from: string, to: string) {
  const before = periodBefore(from, to)
  const range = [branches, from, to]
  const movements = `select branch_id, issued_at, business_date, taxable_total as value from app.invoices
                      where branch_id = any($1::uuid[]) and business_date between $2 and $3
                     union all
                     select branch_id, issued_at, business_date, -taxable_total from app.credit_notes
                      where branch_id = any($1::uuid[]) and business_date between $2 and $3`

  let trend: { label: string; sales: string }[]
  if (from === to) {
    const { rows } = await db.query(
      `select extract(hour from d.issued_at at time zone b.timezone)::int as hour, ${text('sum(d.value)')} as sales
         from (${movements}) d join app.branches b on b.id = d.branch_id group by 1 order by 1`,
      range,
    )
    const hours = rows.map((row) => row.hour as number)
    const first = Math.min(9, ...hours)
    const last = Math.max(21, ...hours)
    trend = Array.from({ length: last - first + 1 }, (_, index) => ({
      label: hourLabel(first + index),
      sales: rows.find((row) => row.hour === first + index)?.sales ?? '0.00',
    }))
  } else {
    const { rows } = await db.query(
      `select day::date::text as label, ${text('sum(d.value)')} as sales
         from generate_series($2::date, $3::date, interval '1 day') day
         left join (${movements}) d on d.business_date = day::date
        group by day order by day`,
      range,
    )
    trend = rows
  }

  const { rows: orderTypes } = await db.query(
    `select o.order_type, count(distinct o.id)::int as orders, ${text('sum(i.taxable_total - coalesce(n.credited, 0))')} as sales
       from app.invoices i
       join app.orders o on o.id = i.order_id
       left join lateral (select sum(taxable_total) as credited from app.credit_notes where invoice_id = i.id) n on true
      where i.branch_id = any($1::uuid[]) and i.business_date between $2 and $3
      group by o.order_type order by sum(i.taxable_total - coalesce(n.credited, 0)) desc`,
    range,
  )
  const { rows: payments } = await db.query(
    `select m.name as method, ${text('sum(p.amount)')} as amount, count(*)::int as count
       from app.payments p join app.payment_methods m on m.id = p.method_id
      where p.branch_id = any($1::uuid[]) and p.business_date between $2 and $3 and p.status in ('recorded', 'confirmed')
      group by m.name order by sum(p.amount) desc`,
    range,
  )
  const { rows: hours } = await db.query(
    `select extract(hour from o.created_at at time zone b.timezone)::int as hour, count(*)::int as orders
       from app.orders o join app.branches b on b.id = o.branch_id
      where o.branch_id = any($1::uuid[]) and o.business_date between $2 and $3 and o.status = 'finalized'
      group by 1 order by 1`,
    range,
  )

  return {
    from, to,
    period: await totals(db, branches, from, to),
    previous: { ...before, ...(await totals(db, branches, before.from, before.to)) },
    trend,
    orderTypes,
    payments,
    hours: hours.map((row) => ({ label: hourLabel(row.hour), orders: row.orders })),
  }
}

/** The owner's first screen. Periods come from the branch's own calendar and trading day. */
reports.get('/dashboard', requires('reports.read'), async (c) => {
  const actor = c.get('actor')
  const range = z.enum(['today', 'week', 'month']).default('today').parse(c.req.query('range'))
  const branchId = z.uuid().optional().parse(c.req.query('branchId'))
  if (branchId && !actor.branchIds.includes(branchId)) throw forbidden()
  const branches = branchId ? [branchId] : actor.branchIds

  const data = await tx(dbContext(actor), async (db) => {
    const { rows: [day] } = await db.query(
      `select to_char(t.today, 'YYYY-MM-DD') as today,
              to_char(date_trunc('week', t.today), 'YYYY-MM-DD') as week,
              to_char(date_trunc('month', t.today), 'YYYY-MM-DD') as month
         from (select ((now() at time zone timezone) - day_cutoff::interval)::date as today from app.branches where id = $1) t`,
      [branches[0]],
    )
    const from = range === 'today' ? day.today : day[range]
    const view = await salesView(db, branches, from, day.today)
    const extras: Record<string, unknown> = {}

    if (can(actor, 'orders.read')) {
      const { rows } = await db.query(
        `select o.id, o.display_number, o.order_type, o.status, o.created_at, o.table_label,
                (select sum(i.grand_total)::numeric(14,2)::text from app.invoices i where i.order_id = o.id) as amount
           from app.orders o where o.branch_id = any($1::uuid[]) order by o.created_at desc limit 6`,
        [branches],
      )
      extras.recentOrders = rows
    }
    if (can(actor, 'kitchen.read')) {
      const { rows } = await db.query(
        `select status, count(*)::int as count from app.kitchen_tickets
          where branch_id = any($1::uuid[]) and status in ('new', 'preparing', 'ready') group by status`,
        [branches],
      )
      extras.kitchen = Object.fromEntries(rows.map((row) => [row.status, row.count]))
    }
    if (can(actor, 'inventory.read')) {
      const { rows } = await db.query(
        `select s.id, s.name, s.unit, coalesce(l.quantity, 0)::text as quantity, s.min_stock::text
           from app.stock_items s cross join unnest($1::uuid[]) as b(id)
           left join app.stock_levels l on l.stock_item_id = s.id and l.branch_id = b.id
          where s.is_active and coalesce(l.quantity, 0) <= s.min_stock
          order by coalesce(l.quantity, 0) - s.min_stock limit 5`,
        [branches],
      )
      extras.lowStock = rows
    }
    if (can(actor, 'expenses.read')) {
      const { rows: [row] } = await db.query(
        `select ${text('sum(amount)')} as total, count(*)::int as entries from app.expenses
          where branch_id = any($1::uuid[]) and expense_date between $2 and $3 and status = 'active'`,
        [branches, from, day.today],
      )
      extras.expenses = row
    }
    return { range, ...view, ...extras }
  })
  return c.json(data)
})

reports.get('/reports/sales', requires('reports.read'), async (c) => {
  const { actor, from, to, branches } = scope(c)
  return c.json(await tx(dbContext(actor), (db) => salesView(db, branches, from, to)))
})

reports.get('/reports/products', requires('reports.read'), async (c) => {
  const { actor, from, to, branches } = scope(c)
  const sold = `
    select p.id, p.name, c.name as category, sum(l.quantity - coalesce(n.quantity, 0)) as quantity, sum(l.taxable_value - coalesce(n.value, 0)) as sales
      from app.invoice_lines l
      join app.invoices i on i.id = l.invoice_id
      join app.order_items oi on oi.id = l.order_item_id
      join app.product_variants v on v.id = oi.variant_id
      join app.products p on p.id = v.product_id
      join app.categories c on c.id = p.category_id
      left join lateral (select sum(quantity) as quantity, sum(taxable_value) as value from app.credit_note_lines where invoice_line_id = l.id) n on true
     where i.branch_id = any($1::uuid[]) and i.business_date between $2 and $3
     group by p.id, p.name, c.name`
  const data = await tx(dbContext(actor), async (db) => {
    const { rows: best } = await db.query(
      `select s.id, s.name, s.category, s.quantity::numeric(14,3)::text as quantity, ${text('s.sales')} as sales from (${sold}) s order by s.sales desc`,
      [branches, from, to],
    )
    const { rows: slow } = await db.query(
      `select p.id, p.name, c.name as category, coalesce(s.quantity, 0)::numeric(14,3)::text as quantity, ${text('s.sales')} as sales
         from app.products p join app.categories c on c.id = p.category_id
         left join (${sold}) s on s.id = p.id
        where p.is_active order by coalesce(s.quantity, 0), p.name limit 10`,
      [branches, from, to],
    )
    const groups = new Map<string, { category: string; quantity: number; sales: number }>()
    for (const row of best) {
      const group = groups.get(row.category) ?? { category: row.category, quantity: 0, sales: 0 }
      group.quantity += Number(row.quantity)
      group.sales += Number(row.sales)
      groups.set(row.category, group)
    }
    const byCategory = [...groups.values()].sort((a, b) => b.sales - a.sales).map((row) => ({ ...row, sales: row.sales.toFixed(2) }))
    return { best, slow, byCategory }
  })
  return c.json(data)
})

/** Sales less recorded expenses. Stock bought and not yet used counts in full, so this isn't accounting profit. */
reports.get('/reports/profit', requires('reports.read'), async (c) => {
  const { actor, from, to, branches } = scope(c)
  if (!can(actor, 'expenses.read')) throw forbidden()
  const data = await tx(dbContext(actor), async (db) => {
    const sales = await totals(db, branches, from, to)
    const { rows: expenses } = await db.query(
      `select category, ${text('sum(amount)')} as total, count(*)::int as entries from app.expenses
        where branch_id = any($1::uuid[]) and expense_date between $2 and $3 and status = 'active'
        group by category order by sum(amount) desc`,
      [branches, from, to],
    )
    const spent = expenses.reduce((sum, row) => sum + Number(row.total), 0)
    return {
      netSales: sales.net_sales,
      expenses: spent.toFixed(2),
      salesLessExpenses: (Number(sales.net_sales) - spent).toFixed(2),
      byCategory: expenses,
    }
  })
  return c.json(data)
})

reports.get('/reports/staff', requires('reports.read'), async (c) => {
  const { actor, from, to, branches } = scope(c)
  const items = await tx(dbContext(actor), async (db) => {
    const { rows } = await db.query(
      `with taken as (
         select created_by as id, count(*) filter (where status = 'finalized')::int as orders from app.orders
          where branch_id = any($1::uuid[]) and business_date between $2 and $3 group by 1
       ), billed as (
         select issued_by as id, count(*)::int as bills, sum(taxable_total) as sales from app.invoices
          where branch_id = any($1::uuid[]) and business_date between $2 and $3 group by 1
       ), discounted as (
         select d.approved_by as id, count(*)::int as discounts from app.order_discounts d join app.orders o on o.id = d.order_id
          where d.branch_id = any($1::uuid[]) and o.business_date between $2 and $3 group by 1
       ), cancelled as (
         select h.changed_by as id, count(*)::int as cancelled from app.order_status_history h join app.orders o on o.id = h.order_id
          where h.branch_id = any($1::uuid[]) and o.business_date between $2 and $3 and h.to_status = 'cancelled' group by 1
       )
       select m.id, m.display_name, m.role, coalesce(t.orders, 0) as orders, coalesce(b.bills, 0) as bills, ${text('b.sales')} as sales,
              coalesce(d.discounts, 0) as discounts, coalesce(x.cancelled, 0) as cancelled
         from app.memberships m
         left join taken t on t.id = m.id left join billed b on b.id = m.id
         left join discounted d on d.id = m.id left join cancelled x on x.id = m.id
        where m.tenant_id = app.tenant_id() and (t.id is not null or b.id is not null or d.id is not null or x.id is not null)
        order by coalesce(b.sales, 0) desc, m.display_name`,
      [branches, from, to],
    )
    return rows
  })
  return c.json({ items })
})
