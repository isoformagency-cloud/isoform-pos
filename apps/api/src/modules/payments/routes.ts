import { Hono } from 'hono'
import { z } from 'zod'
import { audit, command, dbContext, readBody, requires, session, type Actor, type Env } from '../../platform/context.js'
import { tx, type Db } from '../../platform/db.js'
import { AppError, notFound } from '../../platform/errors.js'
import { paise } from '../billing/calculate.js'

export const payments = new Hono<Env>()
payments.use(session)

const amount = z.string().regex(/^\d{1,12}(\.\d{1,2})?$/).refine((value) => paise(value) > 0n, 'Enter an amount above zero.')
const reason = z.string().trim().min(2).max(300)
const reference = z.string().trim().min(1).max(80)
const uuidParam = (value: string | undefined) => z.uuid().parse(value)

const newPayment = z.strictObject({
  id: z.uuid(),
  methodId: z.uuid(),
  amount,
  tipAmount: z.string().regex(/^\d{1,12}(\.\d{1,2})?$/).default('0'),
  reference: reference.optional(),
  notes: z.string().trim().max(300).optional(),
  registerId: z.uuid().optional(),
  allocations: z.array(z.strictObject({ invoiceId: z.uuid(), amount })).max(50).default([]),
})

const newRefund = z.strictObject({
  id: z.uuid(),
  invoiceId: z.uuid(),
  amount,
  methodId: z.uuid(),
  reference: reference.optional(),
  reason,
  creditNoteId: z.uuid().optional(),
  registerId: z.uuid().optional(),
})

const withReason = z.strictObject({ reason })
const nothing = z.strictObject({})

function workingBranch(actor: Actor) {
  if (actor.branchIds.length !== 1) throw new AppError(400, 'branch_required', 'Choose a branch first.')
  return actor.branchIds[0]
}

/** Cash must belong to an open drawer session, so no money sits outside the record. */
async function openSession(db: Db, branchId: string, registerId?: string) {
  const { rows } = await db.query(
    `select id from app.cash_sessions where branch_id = $1 and status = 'open' and ($2::uuid is null or register_id = $2)`,
    [branchId, registerId ?? null],
  )
  if (rows.length === 0) throw new AppError(409, 'no_open_session', 'Open a cash session first.')
  if (rows.length > 1) throw new AppError(400, 'register_required', 'Choose a register.')
  return rows[0].id as string
}

const businessDate = async (db: Db, branchId: string) => {
  const { rows: [{ date }] } = await db.query(
    `select ((now() at time zone timezone) - day_cutoff::interval)::date::text as date from app.branches where id = $1`,
    [branchId],
  )
  return date as string
}

async function loadMethod(db: Db, id: string) {
  const { rows: [method] } = await db.query(`select id, name, kind, requires_reference, is_active from app.payment_methods where id = $1`, [id])
  if (!method || !method.is_active) throw new AppError(422, 'invalid_method', 'Choose a valid payment method.')
  return method
}

async function allocate(db: Db, actor: Actor, branchId: string, paymentId: string, allocations: { invoiceId: string; amount: string }[]) {
  // A fixed order means two payments covering the same bills can never deadlock.
  for (const item of [...allocations].sort((a, b) => a.invoiceId.localeCompare(b.invoiceId))) {
    await db.query(
      `insert into app.payment_allocations (tenant_id, branch_id, payment_id, invoice_id, amount, created_by)
       values ($1, $2, $3, $4, $5, $6)`,
      [actor.tenantId, branchId, paymentId, item.invoiceId, item.amount, actor.membershipId],
    )
  }
}

async function loadPayment(db: Db, id: string) {
  const { rows: [payment] } = await db.query(
    `select p.id, p.branch_id, p.method_kind, m.name as method_name, p.amount::text, p.tip_amount::text, p.reference, p.received_at,
            p.business_date::text, p.status, p.status_reason, p.notes, p.recorded_by, rec.display_name as recorded_by_name,
            s.refund_state, s.refunded::text
       from app.payments p
       join app.payment_methods m on m.id = p.method_id
       join app.memberships rec on rec.id = p.recorded_by
       join app.payment_refund_state s on s.payment_id = p.id
      where p.id = $1`,
    [id],
  )
  if (!payment) throw notFound('Payment')
  const { rows: allocations } = await db.query(
    `select a.invoice_id, i.number, sum(a.amount)::text as amount
       from app.payment_allocations a join app.invoices i on i.id = a.invoice_id
      where a.payment_id = $1 group by a.invoice_id, i.number having sum(a.amount) <> 0`,
    [id],
  )
  const { rows: refunds } = await db.query(
    `select r.id, r.amount::text, r.status, r.reason, r.reference, r.refunded_at, m.name as method_name
       from app.refunds r join app.payment_methods m on m.id = r.method_id where r.payment_id = $1 order by r.created_at`,
    [id],
  )
  const { rows: history } = await db.query(
    `select h.from_status, h.to_status, h.reason, h.changed_at, m.display_name as changed_by
       from app.financial_status_history h join app.memberships m on m.id = h.changed_by
      where h.entity_id = $1 order by h.changed_at`,
    [id],
  )
  return { ...payment, allocations, refunds, history }
}

/** Failed or voided money stops counting: its bills reopen and any cash leaves the drawer. */
async function undoPayment(db: Db, actor: Actor, payment: any) {
  const { rows: live } = await db.query(
    `select a.id, a.invoice_id, a.amount from app.payment_allocations a
      where a.payment_id = $1 and a.amount > 0
        and not exists (select 1 from app.payment_allocations r where r.reverses_allocation_id = a.id)
      order by a.invoice_id`,
    [payment.id],
  )
  for (const allocation of live) {
    await db.query(
      `insert into app.payment_allocations (tenant_id, branch_id, payment_id, invoice_id, amount, reverses_allocation_id, created_by)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [actor.tenantId, payment.branch_id, payment.id, allocation.invoice_id, `-${allocation.amount}`, allocation.id, actor.membershipId],
    )
  }
  if (payment.method_kind !== 'cash') return
  const sessionId = await openSession(db, payment.branch_id)
  const { rows: movements } = await db.query(
    `select id, movement_type, amount from app.cash_movements m
      where m.payment_id = $1 and m.movement_type in ('sale', 'tip_in')
        and not exists (select 1 from app.cash_movements c where c.corrects_movement_id = m.id or (c.payment_id = m.payment_id and c.movement_type = 'tip_out'))`,
    [payment.id],
  )
  for (const movement of movements) {
    if (movement.movement_type === 'sale') {
      await db.query(
        `insert into app.cash_movements (tenant_id, branch_id, cash_session_id, movement_type, direction, amount, payment_id,
           corrects_movement_id, reason, recorded_by)
         values ($1, $2, $3, 'correction', -1, $4, $5, $6, 'Payment reversed', $7)`,
        [actor.tenantId, payment.branch_id, sessionId, movement.amount, payment.id, movement.id, actor.membershipId],
      )
    } else {
      await db.query(
        `insert into app.cash_movements (tenant_id, branch_id, cash_session_id, movement_type, direction, amount, payment_id, reason, recorded_by)
         values ($1, $2, $3, 'tip_out', -1, $4, $5, 'Payment reversed', $6)`,
        [actor.tenantId, payment.branch_id, sessionId, movement.amount, payment.id, actor.membershipId],
      )
    }
  }
}

async function changeStatus(db: Db, actor: Actor, id: string, status: 'failed' | 'voided' | 'confirmed' | 'recorded', statusReason?: string) {
  const payment = await loadPayment(db, id)
  await db.query(`select app.lock_record('payment', $1)`, [id])
  if (status === 'confirmed' && payment.recorded_by === actor.membershipId) {
    const { rows: [tenant] } = await db.query(`select allow_self_verification from app.tenants where id = $1`, [actor.tenantId])
    if (!tenant.allow_self_verification) {
      throw new AppError(403, 'needs_second_person', 'Someone else must confirm a payment you recorded.')
    }
  }
  if (status === 'failed' || status === 'voided') await undoPayment(db, actor, payment)
  await db.query(`update app.payments set status = $2, status_reason = $3 where id = $1`, [id, status, statusReason ?? null])
  await audit(db, actor, `payment.${status}`, 'payment', id, { reason: statusReason, amount: payment.amount })
  return loadPayment(db, id)
}

payments.get('/payment-methods', requires('payments.read'), async (c) => {
  const items = await tx(dbContext(c.get('actor')), async (db) => {
    const { rows } = await db.query(`select id, name, kind, requires_reference from app.payment_methods where is_active
        order by array_position(array['cash', 'upi', 'card', 'bank_transfer', 'other'], kind), name`)
    return rows
  })
  return c.json({ items })
})

payments.get('/payment-methods/all', requires('business.read'), async (c) => {
  const items = await tx(dbContext(c.get('actor')), async (db) => {
    const { rows } = await db.query(`select id, name, kind, is_active from app.payment_methods
        order by array_position(array['cash', 'upi', 'card', 'bank_transfer', 'other'], kind), name`)
    return rows
  })
  return c.json({ items })
})

payments.patch('/payment-methods/:id', requires('business.write'), async (c) => {
  const id = z.uuid().parse(c.req.param('id'))
  const input = await readBody(c, z.strictObject({ isActive: z.boolean() }))
  return command(c, 200, async (db, actor) => {
    const { rows: [row] } = await db.query(`update app.payment_methods set is_active = $2 where id = $1 returning id, name, is_active`, [id, input.isActive])
    if (!row) throw notFound('Payment method')
    const { rows: [{ left }] } = await db.query(`select count(*)::int as left from app.payment_methods where is_active`)
    if (left === 0) throw new AppError(409, 'last_payment_method', 'Keep at least one payment method turned on.')
    await audit(db, actor, 'payment_method.updated', 'payment_method', id, input)
    return row
  })
})

payments.get('/payments', requires('payments.read'), async (c) => {
  const actor = c.get('actor')
  const status = z.enum(['pending', 'recorded', 'confirmed', 'failed', 'voided']).optional().parse(c.req.query('status'))
  const invoiceId = z.uuid().optional().parse(c.req.query('invoiceId'))
  const before = z.iso.datetime({ offset: true }).optional().parse(c.req.query('before'))
  const items = await tx(dbContext(actor), async (db) => {
    const { rows } = await db.query(
      `select p.id, p.method_kind, m.name as method_name, p.amount::text, p.reference, p.received_at, p.status,
              rec.display_name as recorded_by_name, s.refund_state
         from app.payments p
         join app.payment_methods m on m.id = p.method_id
         join app.memberships rec on rec.id = p.recorded_by
         join app.payment_refund_state s on s.payment_id = p.id
        where p.branch_id = any($1::uuid[]) and ($2::text is null or p.status = $2)
          and ($3::timestamptz is null or p.received_at < $3)
          and ($4::uuid is null or exists (select 1 from app.payment_allocations a where a.payment_id = p.id and a.invoice_id = $4))
        order by p.received_at desc limit 50`,
      [actor.branchIds, status ?? null, before ?? null, invoiceId ?? null],
    )
    return rows
  })
  return c.json({ items, nextBefore: items.length === 50 ? items[49].received_at : null })
})

payments.get('/payments/:id', requires('payments.read'), async (c) => {
  const id = uuidParam(c.req.param('id'))
  return c.json(await tx(dbContext(c.get('actor')), (db) => loadPayment(db, id)))
})

payments.post('/payments', requires('payments.record'), async (c) => {
  const input = await readBody(c, newPayment)
  const branchId = workingBranch(c.get('actor'))
  return command(c, 201, async (db, actor) => {
    const method = await loadMethod(db, input.methodId)
    if (method.requires_reference && !input.reference) {
      throw new AppError(422, 'reference_required', `${method.name} needs a transaction reference.`)
    }
    const allocated = input.allocations.reduce((sum, item) => sum + paise(item.amount), 0n)
    if (allocated > paise(input.amount)) throw new AppError(422, 'over_allocated', 'That is more than this payment.')

    const sessionId = method.kind === 'cash' ? await openSession(db, branchId, input.registerId) : null
    const date = await businessDate(db, branchId)
    await db.query(
      `insert into app.payments (id, tenant_id, branch_id, method_id, method_kind, amount, tip_amount, reference, received_at,
         business_date, cash_session_id, notes, recorded_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, now(), $9, $10, $11, $12)`,
      [input.id, actor.tenantId, branchId, method.id, method.kind, input.amount, input.tipAmount, input.reference, date, sessionId, input.notes, actor.membershipId],
    )
    if (sessionId) {
      await db.query(
        `insert into app.cash_movements (tenant_id, branch_id, cash_session_id, movement_type, direction, amount, payment_id, recorded_by)
         values ($1, $2, $3, 'sale', 1, $4, $5, $6)`,
        [actor.tenantId, branchId, sessionId, input.amount, input.id, actor.membershipId],
      )
      if (paise(input.tipAmount) > 0n) {
        await db.query(
          `insert into app.cash_movements (tenant_id, branch_id, cash_session_id, movement_type, direction, amount, payment_id, recorded_by)
           values ($1, $2, $3, 'tip_in', 1, $4, $5, $6)`,
          [actor.tenantId, branchId, sessionId, input.tipAmount, input.id, actor.membershipId],
        )
      }
    }
    await allocate(db, actor, branchId, input.id, input.allocations)
    await audit(db, actor, 'payment.recorded', 'payment', input.id, { amount: input.amount, method: method.name, reference: input.reference })
    return loadPayment(db, input.id)
  })
})

payments.post('/payments/:id/confirm', requires('payments.verify'), async (c) => {
  const id = uuidParam(c.req.param('id'))
  await readBody(c, nothing)
  return command(c, 200, (db, actor) => changeStatus(db, actor, id, 'confirmed'))
})

const confirmAll = z.strictObject({ ids: z.array(z.uuid()).min(1).max(200) })

/** Clears the day's list in one step. Payments already handled are skipped, not failed. */
payments.post('/payments/confirm-all', requires('payments.verify'), async (c) => {
  const input = await readBody(c, confirmAll)
  return command(c, 200, async (db, actor) => {
    const { rows: [tenant] } = await db.query(`select allow_self_verification from app.tenants where id = $1`, [actor.tenantId])
    let confirmed = 0
    let skipped = 0
    for (const id of [...new Set(input.ids)].sort()) {
      const { rows: [payment] } = await db.query(`select status, recorded_by from app.payments where id = $1`, [id])
      const ownBlocked = payment?.recorded_by === actor.membershipId && !tenant.allow_self_verification
      if (payment?.status !== 'recorded' || ownBlocked) {
        skipped += 1
        continue
      }
      await changeStatus(db, actor, id, 'confirmed')
      confirmed += 1
    }
    return { confirmed, skipped }
  })
})

payments.post('/payments/:id/fail', requires('payments.verify'), async (c) => {
  const id = uuidParam(c.req.param('id'))
  const input = await readBody(c, withReason)
  return command(c, 200, (db, actor) => changeStatus(db, actor, id, 'failed', input.reason))
})

payments.post('/payments/:id/void', requires('payments.verify'), async (c) => {
  const id = uuidParam(c.req.param('id'))
  const input = await readBody(c, withReason)
  return command(c, 200, (db, actor) => changeStatus(db, actor, id, 'voided', input.reason))
})

payments.post('/payments/:id/refunds', requires('payments.refund'), async (c) => {
  const paymentId = uuidParam(c.req.param('id'))
  const input = await readBody(c, newRefund)
  return command(c, 201, async (db, actor) => {
    const payment = await loadPayment(db, paymentId)
    const method = await loadMethod(db, input.methodId)
    const sessionId = method.kind === 'cash' ? await openSession(db, payment.branch_id, input.registerId) : null
    const date = await businessDate(db, payment.branch_id)
    await db.query(
      `insert into app.refunds (id, tenant_id, branch_id, payment_id, invoice_id, credit_note_id, method_id, method_kind, amount,
         reference, reason, refunded_at, business_date, cash_session_id, recorded_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now(), $12, $13, $14)`,
      [input.id, actor.tenantId, payment.branch_id, paymentId, input.invoiceId, input.creditNoteId, method.id, method.kind, input.amount,
        input.reference, input.reason, date, sessionId, actor.membershipId],
    )
    if (sessionId) {
      await db.query(
        `insert into app.cash_movements (tenant_id, branch_id, cash_session_id, movement_type, direction, amount, refund_id, recorded_by)
         values ($1, $2, $3, 'refund', -1, $4, $5, $6)`,
        [actor.tenantId, payment.branch_id, sessionId, input.amount, input.id, actor.membershipId],
      )
    }
    await audit(db, actor, 'refund.recorded', 'refund', input.id, { paymentId, amount: input.amount, reason: input.reason })
    return loadPayment(db, paymentId)
  })
})

payments.post('/refunds/:id/confirm', requires('payments.verify'), async (c) => {
  const id = uuidParam(c.req.param('id'))
  await readBody(c, nothing)
  return command(c, 200, async (db, actor) => {
    const { rows: [refund] } = await db.query(`select payment_id, recorded_by from app.refunds where id = $1`, [id])
    if (!refund) throw notFound('Refund')
    if (refund.recorded_by === actor.membershipId) {
      const { rows: [tenant] } = await db.query(`select allow_self_verification from app.tenants where id = $1`, [actor.tenantId])
      if (!tenant.allow_self_verification) throw new AppError(403, 'needs_second_person', 'Someone else must confirm a refund you recorded.')
    }
    await db.query(`update app.refunds set status = 'confirmed' where id = $1`, [id])
    await audit(db, actor, 'refund.confirmed', 'refund', id)
    return loadPayment(db, refund.payment_id)
  })
})

payments.post('/refunds/:id/void', requires('payments.verify'), async (c) => {
  const id = uuidParam(c.req.param('id'))
  const input = await readBody(c, withReason)
  return command(c, 200, async (db, actor) => {
    const { rows: [refund] } = await db.query(`select payment_id, branch_id, method_kind, amount from app.refunds where id = $1`, [id])
    if (!refund) throw notFound('Refund')
    if (refund.method_kind === 'cash') {
      const sessionId = await openSession(db, refund.branch_id)
      const { rows: [movement] } = await db.query(`select id from app.cash_movements where refund_id = $1 and movement_type = 'refund'`, [id])
      await db.query(
        `insert into app.cash_movements (tenant_id, branch_id, cash_session_id, movement_type, direction, amount, refund_id,
           corrects_movement_id, reason, recorded_by)
         values ($1, $2, $3, 'correction', 1, $4, $5, $6, 'Refund reversed', $7)`,
        [actor.tenantId, refund.branch_id, sessionId, refund.amount, id, movement.id, actor.membershipId],
      )
    }
    await db.query(`update app.refunds set status = 'voided', status_reason = $2 where id = $1`, [id, input.reason])
    await audit(db, actor, 'refund.voided', 'refund', id, { reason: input.reason })
    return loadPayment(db, refund.payment_id)
  })
})
