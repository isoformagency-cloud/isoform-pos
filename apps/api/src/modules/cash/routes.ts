import { Hono } from 'hono'
import { z } from 'zod'
import { audit, command, dbContext, readBody, requires, requiresAny, session, type Actor, type Env } from '../../platform/context'
import { tx, type Db } from '../../platform/db'
import { AppError, notFound } from '../../platform/errors'
import { can } from '../../platform/permissions'
import { paise } from '../billing/calculate'

export const cash = new Hono<Env>()
cash.use(session)

const money = z.string().regex(/^\d{1,12}(\.\d{1,2})?$/)
const positive = money.refine((value) => paise(value) > 0n, 'Enter an amount above zero.')
const uuidParam = (value: string | undefined) => z.uuid().parse(value)

const newSession = z.strictObject({ id: z.uuid(), registerId: z.uuid(), openingAmount: money })
const newMovement = z.strictObject({
  type: z.enum(['paid_in', 'paid_out', 'safe_drop']),
  amount: positive,
  reason: z.string().trim().min(2).max(300),
})
const closing = z.strictObject({ countedAmount: money })
const review = z.strictObject({ note: z.string().trim().min(2).max(500).optional() })

function workingBranch(actor: Actor) {
  if (actor.branchIds.length !== 1) throw new AppError(400, 'branch_required', 'Choose a branch first.')
  return actor.branchIds[0]
}

/**
 * Blind counting: whoever counts the drawer must not see the expected figure first,
 * so only reviewers see it while a session is open.
 */
async function loadSession(db: Db, actor: Actor, id: string) {
  const { rows: [row] } = await db.query(
    `select s.id, s.branch_id, s.register_id, r.name as register_name, s.status, s.business_date::text, s.opening_amount::text,
            s.opened_at, o.display_name as opened_by_name, s.closed_at, s.counted_amount::text, s.expected_amount::text,
            s.variance::text, s.reviewed_at, s.review_note, s.opened_by, s.closed_by,
            s.opening_amount + coalesce((select sum(m.direction * m.amount) from app.cash_movements m where m.cash_session_id = s.id), 0) as running
       from app.cash_sessions s
       join app.registers r on r.id = s.register_id
       join app.memberships o on o.id = s.opened_by
      where s.id = $1`,
    [id],
  )
  if (!row) throw notFound('Cash session')
  const { running, ...session } = row
  const reviewer = can(actor.role, 'cash.review')
  if (!reviewer) return { ...session, expected_amount: null, variance: null, movements: [] }
  const { rows: movements } = await db.query(
    `select m.id, m.movement_type, m.direction, m.amount::text, m.reason, m.created_at, b.display_name as recorded_by_name
       from app.cash_movements m join app.memberships b on b.id = m.recorded_by
      where m.cash_session_id = $1 order by m.created_at`,
    [id],
  )
  return { ...session, running_expected: String(running), movements }
}

cash.get('/registers', requires('cash.use'), async (c) => {
  const actor = c.get('actor')
  const items = await tx(dbContext(actor), async (db) => {
    const { rows } = await db.query(
      `select r.id, r.name, r.branch_id, s.id as open_session_id
         from app.registers r
         left join app.cash_sessions s on s.register_id = r.id and s.status = 'open'
        where r.is_active and r.branch_id = any($1::uuid[]) order by r.name`,
      [actor.branchIds],
    )
    return rows
  })
  return c.json({ items })
})

cash.get('/cash-sessions', requiresAny('cash.use', 'cash.review'), async (c) => {
  const actor = c.get('actor')
  const status = z.enum(['open', 'closed', 'reviewed']).optional().parse(c.req.query('status'))
  const reviewer = can(actor.role, 'cash.review')
  const items = await tx(dbContext(actor), async (db) => {
    const { rows } = await db.query(
      `select s.id, r.name as register_name, s.status, s.business_date::text, s.opened_at, s.closed_at,
              ${reviewer ? 's.variance::text' : 'null as variance'}
         from app.cash_sessions s join app.registers r on r.id = s.register_id
        where s.branch_id = any($1::uuid[]) and ($2::text is null or s.status = $2)
        order by s.opened_at desc limit 50`,
      [actor.branchIds, status ?? null],
    )
    return rows
  })
  return c.json({ items })
})

cash.get('/cash-sessions/:id', requiresAny('cash.use', 'cash.review'), async (c) => {
  const id = uuidParam(c.req.param('id'))
  const actor = c.get('actor')
  return c.json(await tx(dbContext(actor), (db) => loadSession(db, actor, id)))
})

cash.post('/cash-sessions', requires('cash.use'), async (c) => {
  const input = await readBody(c, newSession)
  const branchId = workingBranch(c.get('actor'))
  return command(c, 201, async (db, actor) => {
    const { rows: [branch] } = await db.query(
      `select ((now() at time zone timezone) - day_cutoff::interval)::date::text as date from app.branches where id = $1`,
      [branchId],
    )
    await db.query(
      `insert into app.cash_sessions (id, tenant_id, branch_id, register_id, business_date, opening_amount, opened_by)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [input.id, actor.tenantId, branchId, input.registerId, branch.date, input.openingAmount, actor.membershipId],
    )
    await audit(db, actor, 'cash_session.opened', 'cash_session', input.id, { openingAmount: input.openingAmount })
    return loadSession(db, actor, input.id)
  })
})

cash.post('/cash-sessions/:id/movements', requires('cash.move'), async (c) => {
  const id = uuidParam(c.req.param('id'))
  const input = await readBody(c, newMovement)
  return command(c, 201, async (db, actor) => {
    const { rows: [row] } = await db.query(`select branch_id from app.cash_sessions where id = $1`, [id])
    if (!row) throw notFound('Cash session')
    await db.query(
      `insert into app.cash_movements (tenant_id, branch_id, cash_session_id, movement_type, direction, amount, reason, recorded_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [actor.tenantId, row.branch_id, id, input.type, input.type === 'paid_in' ? 1 : -1, input.amount, input.reason, actor.membershipId],
    )
    await audit(db, actor, 'cash.moved', 'cash_session', id, input)
    return loadSession(db, actor, id)
  })
})

cash.post('/cash-sessions/:id/close', requires('cash.use'), async (c) => {
  const id = uuidParam(c.req.param('id'))
  const input = await readBody(c, closing)
  return command(c, 200, async (db, actor) => {
    // The database works out expected cash here, from the movements.
    const { rowCount } = await db.query(
      `update app.cash_sessions set status = 'closed', counted_amount = $2 where id = $1`,
      [id, input.countedAmount],
    )
    if (!rowCount) throw notFound('Cash session')
    await audit(db, actor, 'cash_session.closed', 'cash_session', id, { countedAmount: input.countedAmount })
    return loadSession(db, actor, id)
  })
})

cash.post('/cash-sessions/:id/review', requires('cash.review'), async (c) => {
  const id = uuidParam(c.req.param('id'))
  const input = await readBody(c, review)
  return command(c, 200, async (db, actor) => {
    const { rowCount } = await db.query(
      `update app.cash_sessions set status = 'reviewed', review_note = $2 where id = $1`,
      [id, input.note ?? null],
    )
    if (!rowCount) throw notFound('Cash session')
    await audit(db, actor, 'cash_session.reviewed', 'cash_session', id, { note: input.note })
    return loadSession(db, actor, id)
  })
})
