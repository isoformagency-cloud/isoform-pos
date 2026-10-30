import { Hono } from 'hono'
import { z } from 'zod'
import { dbContext, requires, session, type Env } from '../../platform/context'
import { tx } from '../../platform/db'
import { AppError, forbidden } from '../../platform/errors'

export const reports = new Hono<Env>()
reports.use(session)

const MAX_DAYS = 92
const text = (expression: string) => `coalesce(${expression}, 0)::numeric(14,2)::text`

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
