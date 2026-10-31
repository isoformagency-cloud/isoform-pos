import { Hono } from 'hono'
import { z } from 'zod'
import { audit, command, dbContext, readBody, requires, session, type Actor, type Env } from '../../platform/context.js'
import { tx, type Db } from '../../platform/db.js'
import { AppError, notFound } from '../../platform/errors.js'
import { can } from '../../platform/permissions.js'
import { supabaseAdmin } from '../../platform/supabase.js'

export const expenses = new Hono<Env>()
expenses.use(session)

const RECEIPTS = 'receipts'
const uuidParam = (value: string | undefined) => z.uuid().parse(value)
const amount = z.string().regex(/^\d{1,12}(\.\d{1,2})?$/).refine((value) => Number(value) > 0, 'Enter an amount above zero.')
const category = z.enum(['ingredients', 'rent', 'electricity', 'salaries', 'maintenance', 'packaging', 'marketing', 'other'])
const method = z.enum(['cash', 'upi', 'card', 'bank_transfer', 'cheque', 'other'])

export const expenseFields = z.strictObject({
  id: z.uuid(),
  name: z.string().trim().min(2).max(120),
  category,
  amount,
  expenseDate: z.iso.date(),
  method,
  reference: z.string().trim().max(80).optional(),
  notes: z.string().trim().max(300).optional(),
  fromDrawer: z.boolean().default(false),
})
const expenseUpdate = z.strictObject({
  name: z.string().trim().min(2).max(120).optional(),
  category: category.optional(),
  expenseDate: z.iso.date().optional(),
  reference: z.string().trim().max(80).optional(),
  notes: z.string().trim().max(300).optional(),
  receiptPath: z.string().max(200).optional(),
})
const voidExpense = z.strictObject({ reason: z.string().trim().min(2).max(300) })
const period = z.object({ from: z.iso.date().optional(), to: z.iso.date().optional(), category: category.optional(), q: z.string().trim().max(60).optional() })

function workingBranch(actor: Actor) {
  if (actor.branchIds.length !== 1) throw new AppError(400, 'branch_required', 'Choose a branch first.')
  return actor.branchIds[0]
}

async function openDrawer(db: Db, branchId: string) {
  const { rows } = await db.query(`select id from app.cash_sessions where branch_id = $1 and status = 'open'`, [branchId])
  if (rows.length === 0) throw new AppError(409, 'no_open_session', 'Open a cash session first.')
  if (rows.length > 1) throw new AppError(400, 'register_required', 'More than one drawer is open. Record this from the Cash page.')
  return rows[0].id as string
}

/** Cash taken from the drawer must leave the session too, or the day's count comes up short. */
export async function recordExpense(db: Db, actor: Actor, branchId: string, input: z.infer<typeof expenseFields>) {
  if (input.fromDrawer && input.method !== 'cash') throw new AppError(422, 'not_cash', 'Only cash can come from the drawer.')
  if (input.fromDrawer && !can(actor, 'cash.move')) throw new AppError(403, 'forbidden', 'You do not have permission to do this.')
  let movementId: string | null = null
  if (input.fromDrawer) {
    const sessionId = await openDrawer(db, branchId)
    const { rows: [movement] } = await db.query(
      `insert into app.cash_movements (tenant_id, branch_id, cash_session_id, movement_type, direction, amount, reason, recorded_by)
       values ($1, $2, $3, 'expense', -1, $4, $5, $6) returning id`,
      [actor.tenantId, branchId, sessionId, input.amount, input.name, actor.membershipId],
    )
    movementId = movement.id
  }
  await db.query(
    `insert into app.expenses (id, tenant_id, branch_id, name, category, amount, expense_date, method, reference, notes, cash_movement_id, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [input.id, actor.tenantId, branchId, input.name, input.category, input.amount, input.expenseDate, input.method,
      input.reference || null, input.notes || null, movementId, actor.membershipId],
  )
  await audit(db, actor, 'expense.created', 'expense', input.id, { name: input.name, amount: input.amount })
}

async function loadExpense(db: Db, id: string) {
  const { rows: [row] } = await db.query(
    `select e.id, e.name, e.category, e.amount::text, e.expense_date::text, e.method, e.reference, e.notes, e.status, e.void_reason,
            e.receipt_path is not null as has_receipt, e.cash_movement_id is not null as from_drawer, e.branch_id, e.created_at,
            m.display_name as created_by_name
       from app.expenses e join app.memberships m on m.id = e.created_by where e.id = $1`,
    [id],
  )
  if (!row) throw notFound('Expense')
  return row
}

expenses.get('/expenses', requires('expenses.read'), async (c) => {
  const actor = c.get('actor')
  const filters = period.parse(c.req.query())
  const items = await tx(dbContext(actor), async (db) => {
    const { rows } = await db.query(
      `select e.id, e.name, e.category, e.amount::text, e.expense_date::text, e.method, e.reference, e.notes, e.status,
              e.receipt_path is not null as has_receipt, e.cash_movement_id is not null as from_drawer
         from app.expenses e
        where e.branch_id = any($1::uuid[])
          and ($2::date is null or e.expense_date >= $2) and ($3::date is null or e.expense_date <= $3)
          and ($4::text is null or e.category = $4)
          and ($5::text is null or e.name ilike $5 or e.reference ilike $5)
        order by e.expense_date desc, e.created_at desc limit 500`,
      [actor.branchIds, filters.from ?? null, filters.to ?? null, filters.category ?? null,
        filters.q ? `%${filters.q.replace(/[%_\\]/g, '\\$&')}%` : null],
    )
    return rows
  })
  return c.json({ items })
})

expenses.get('/expenses/summary', requires('expenses.read'), async (c) => {
  const actor = c.get('actor')
  const filters = period.parse(c.req.query())
  const summary = await tx(dbContext(actor), async (db) => {
    const scope = [actor.branchIds, filters.from ?? null, filters.to ?? null]
    const { rows: byCategory } = await db.query(
      `select category, sum(amount)::text as total, count(*)::int as entries from app.expenses
        where status = 'active' and branch_id = any($1::uuid[])
          and ($2::date is null or expense_date >= $2) and ($3::date is null or expense_date <= $3)
        group by category order by sum(amount) desc`,
      scope,
    )
    // Net sales leave tax out and take credit notes off, the same way the Reports page does.
    const { rows: [sales] } = await db.query(
      `select coalesce((select sum(n.taxable_total) from app.invoices n
                         where n.branch_id = any($1::uuid[])
                           and ($2::date is null or n.business_date >= $2) and ($3::date is null or n.business_date <= $3)), 0)
            - coalesce((select sum(k.taxable_total) from app.credit_notes k
                         where k.branch_id = any($1::uuid[])
                           and ($2::date is null or k.business_date >= $2) and ($3::date is null or k.business_date <= $3)), 0) as net_sales`,
      scope,
    )
    const total = byCategory.reduce((sum, row) => sum + Number(row.total), 0)
    return { total: total.toFixed(2), entries: byCategory.reduce((sum, row) => sum + row.entries, 0), byCategory, netSales: Number(sales.net_sales).toFixed(2) }
  })
  return c.json(summary)
})

expenses.post('/expenses', requires('expenses.write'), async (c) => {
  const input = await readBody(c, expenseFields)
  const branchId = workingBranch(c.get('actor'))
  return command(c, 201, async (db, actor) => {
    await recordExpense(db, actor, branchId, input)
    return loadExpense(db, input.id)
  })
})

expenses.patch('/expenses/:id', requires('expenses.write'), async (c) => {
  const id = uuidParam(c.req.param('id'))
  const input = await readBody(c, expenseUpdate)
  return command(c, 200, async (db, actor) => {
    if (input.receiptPath && !input.receiptPath.startsWith(`${actor.tenantId}/${id}/`)) {
      throw new AppError(422, 'invalid_receipt', 'That receipt doesn’t belong to this expense.')
    }
    const { rows: [row] } = await db.query(
      `update app.expenses set name = coalesce($2, name), category = coalesce($3, category), expense_date = coalesce($4, expense_date),
         reference = coalesce($5, reference), notes = coalesce($6, notes), receipt_path = coalesce($7, receipt_path)
       where id = $1 and status = 'active' returning id`,
      [id, input.name, input.category, input.expenseDate, input.reference, input.notes, input.receiptPath],
    )
    if (!row) throw notFound('Expense')
    await audit(db, actor, 'expense.updated', 'expense', id, input)
    return loadExpense(db, id)
  })
})

/** Nothing is deleted. A mistake is voided with a reason, and drawer cash goes back into the session. */
expenses.post('/expenses/:id/void', requires('expenses.write'), async (c) => {
  const id = uuidParam(c.req.param('id'))
  const input = await readBody(c, voidExpense)
  return command(c, 200, async (db, actor) => {
    const { rows: [expense] } = await db.query(
      `select branch_id, amount, name, cash_movement_id, status from app.expenses where id = $1`,
      [id],
    )
    if (!expense) throw notFound('Expense')
    if (expense.status !== 'active') throw new AppError(409, 'already_voided', 'This expense has already been voided.')
    if (expense.cash_movement_id) {
      const sessionId = await openDrawer(db, expense.branch_id)
      await db.query(
        `insert into app.cash_movements (tenant_id, branch_id, cash_session_id, movement_type, direction, amount, corrects_movement_id, reason, recorded_by)
         values ($1, $2, $3, 'correction', 1, $4, $5, 'Expense voided', $6)`,
        [actor.tenantId, expense.branch_id, sessionId, expense.amount, expense.cash_movement_id, actor.membershipId],
      )
    }
    await db.query(
      `update app.expenses set status = 'voided', void_reason = $2, voided_by = $3, voided_at = now() where id = $1`,
      [id, input.reason, actor.membershipId],
    )
    await audit(db, actor, 'expense.voided', 'expense', id, { reason: input.reason })
    return loadExpense(db, id)
  })
})

/** The photo goes straight to private storage, so it skips the API's 64 KB request limit. */
expenses.post('/expenses/:id/receipt', requires('expenses.write'), async (c) => {
  const id = uuidParam(c.req.param('id'))
  const actor = c.get('actor')
  await tx(dbContext(actor), (db) => loadExpense(db, id))
  const path = `${actor.tenantId}/${id}/${crypto.randomUUID()}.jpg`
  const { data, error } = await supabaseAdmin.storage.from(RECEIPTS).createSignedUploadUrl(path)
  if (error) throw new AppError(503, 'storage_unavailable', 'Could not reach photo storage. Please try again.')
  return c.json({ path, token: data.token })
})

expenses.get('/expenses/:id/receipt', requires('expenses.read'), async (c) => {
  const id = uuidParam(c.req.param('id'))
  const path = await tx(dbContext(c.get('actor')), async (db) => {
    const { rows: [row] } = await db.query(`select receipt_path from app.expenses where id = $1`, [id])
    if (!row) throw notFound('Expense')
    return row.receipt_path as string | null
  })
  if (!path) throw notFound('Receipt')
  const { data, error } = await supabaseAdmin.storage.from(RECEIPTS).createSignedUrl(path, 300)
  if (error) throw new AppError(503, 'storage_unavailable', 'Could not reach photo storage. Please try again.')
  return c.json({ url: data.signedUrl })
})
