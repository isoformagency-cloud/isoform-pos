import { Hono } from 'hono'
import { z } from 'zod'
import { audit, command, dbContext, readBody, requires, session, type Actor, type Env } from '../../platform/context.js'
import { tx, type Db } from '../../platform/db.js'
import { AppError, notFound } from '../../platform/errors.js'

export const tables = new Hono<Env>()
tables.use(session)

const name = z.string().trim().min(1).max(30)
const shape = z.enum(['square', 'round', 'long'])
const coordinate = z.number().int().min(0).max(1000)
const uuidParam = (value: string | undefined) => z.uuid().parse(value)

const newArea = z.strictObject({ name: z.string().trim().min(1).max(40) })
const areaUpdate = z.strictObject({ name: z.string().trim().min(1).max(40).optional(), isActive: z.boolean().optional() })
const newTable = z.strictObject({ name, seats: z.number().int().min(1).max(100).default(4), shape: shape.default('square'), areaId: z.uuid() })
const tableUpdate = z.strictObject({
  name: name.optional(),
  seats: z.number().int().min(1).max(100).optional(),
  shape: shape.optional(),
  areaId: z.uuid().optional(),
  isActive: z.boolean().optional(),
})
const layout = z.strictObject({ positions: z.array(z.strictObject({ id: z.uuid(), x: coordinate, y: coordinate })).min(1).max(200) })
const seat = z.strictObject({ guests: z.number().int().min(1).max(200).optional() })
const reservation = z.strictObject({
  tableId: z.uuid(),
  guestName: z.string().trim().min(1).max(80),
  phone: z.string().regex(/^\d{10}$/).optional(),
  guests: z.number().int().min(1).max(200).default(2),
  reservedAt: z.iso.datetime({ offset: true }),
  notes: z.string().trim().max(300).optional(),
})
const reservationUpdate = z.strictObject({
  status: z.enum(['seated', 'cancelled']).optional(),
  guestName: z.string().trim().min(1).max(80).optional(),
  phone: z.string().regex(/^\d{10}$/).optional(),
  guests: z.number().int().min(1).max(200).optional(),
  reservedAt: z.iso.datetime({ offset: true }).optional(),
})

const BOOKING_GAP = '2 hours'

function workingBranch(actor: Actor) {
  if (actor.branchIds.length !== 1) throw new AppError(400, 'branch_required', 'Choose a branch first.')
  return actor.branchIds[0]
}

/** Nothing about a table's state is stored twice, so it can never disagree with its order. */
const stateOf = (table: any) => {
  if (table.order_id) return table.confirmed_at ? 'billing' : 'occupied'
  if (table.seated_at) return 'waiting'
  if (table.reservation) return 'reserved'
  return 'available'
}

async function assertNoClash(db: Db, tableId: string, reservedAt: string, exceptId?: string) {
  await db.query(`select app.lock_record('table', $1)`, [tableId])
  const { rows } = await db.query(
    `select 1 from app.table_reservations
      where table_id = $1 and status = 'booked' and ($3::uuid is null or id <> $3)
        and reserved_at > $2::timestamptz - interval '${BOOKING_GAP}' and reserved_at < $2::timestamptz + interval '${BOOKING_GAP}'`,
    [tableId, reservedAt, exceptId ?? null],
  )
  if (rows.length) throw new AppError(409, 'table_booked', 'This table is already booked around that time.')
}

async function assertFree(db: Db, tableId: string) {
  const { rows } = await db.query(`select 1 from app.orders where table_id = $1 and status = 'open'`, [tableId])
  if (rows.length) throw new AppError(409, 'table_busy', 'This table already has an open order.')
}

tables.get('/floor', requires('tables.read'), async (c) => {
  const actor = c.get('actor')
  const branchId = workingBranch(actor)
  const floor = await tx(dbContext(actor), async (db) => {
    const { rows: areas } = await db.query(
      `select id, name, sort_order from app.floor_areas where branch_id = $1 and is_active order by sort_order, created_at`,
      [branchId],
    )
    const { rows } = await db.query(
      `select t.id, t.name, t.seats, t.shape, t.area_id, t.pos_x, t.pos_y, t.seated_at, t.seated_guests,
              o.id as order_id, o.display_number, o.confirmed_at, o.created_at as order_started, o.version as order_version,
              o.guest_count, o.held_at, line.item_count, line.subtotal::numeric(14,2)::text as amount,
              coalesce(discounted.total, 0)::numeric(14,2)::text as discount,
              (select jsonb_build_object('id', r.id, 'guestName', r.guest_name, 'phone', r.phone, 'guests', r.guests, 'reservedAt', r.reserved_at)
                 from app.table_reservations r
                where r.table_id = t.id and r.status = 'booked'
                  and r.reserved_at between now() - interval '30 minutes' and now() + interval '${BOOKING_GAP}'
                order by r.reserved_at limit 1) as reservation
         from app.dining_tables t
         left join app.orders o on o.table_id = t.id and o.status = 'open'
         left join lateral (
           select count(*)::int as item_count, coalesce(sum(round((i.unit_price + coalesce(a.extra, 0)) * i.quantity, 2)), 0) as subtotal
             from app.order_items i
             left join lateral (select sum(unit_price * quantity) extra from app.order_item_addons where order_item_id = i.id) a on true
            where i.order_id = o.id and i.status = 'active'
         ) line on true
         left join lateral (
           select sum(case when d.kind = 'amount' then d.value else round(line.subtotal * d.value / 100, 2) end) as total
             from app.order_discounts d where d.order_id = o.id
         ) discounted on true
        where t.branch_id = $1 and t.is_active
        order by t.created_at`,
      [branchId],
    )
    return {
      areas,
      tables: rows.map((table) => ({
        ...table,
        amount: table.order_id ? (Number(table.amount) - Number(table.discount)).toFixed(2) : null,
        state: stateOf(table),
      })),
    }
  })
  return c.json(floor)
})

tables.post('/areas', requires('tables.manage'), async (c) => {
  const input = await readBody(c, newArea)
  const branchId = workingBranch(c.get('actor'))
  return command(c, 201, async (db, actor) => {
    const { rows: [area] } = await db.query(
      `insert into app.floor_areas (tenant_id, branch_id, name, sort_order)
       values ($1, $2, $3, (select coalesce(max(sort_order), 0) + 1 from app.floor_areas where branch_id = $2)) returning id, name`,
      [actor.tenantId, branchId, input.name],
    )
    return area
  })
})

tables.patch('/areas/:id', requires('tables.manage'), async (c) => {
  const id = uuidParam(c.req.param('id'))
  const input = await readBody(c, areaUpdate)
  return command(c, 200, async (db) => {
    if (input.isActive === false) {
      const { rows } = await db.query(`select 1 from app.dining_tables where area_id = $1 and is_active limit 1`, [id])
      if (rows.length) throw new AppError(409, 'area_in_use', 'Move or remove the tables in this area first.')
    }
    const { rows: [area] } = await db.query(
      `update app.floor_areas set name = coalesce($2, name), is_active = coalesce($3, is_active) where id = $1 returning id, name, is_active`,
      [id, input.name, input.isActive],
    )
    if (!area) throw notFound('Area')
    return area
  })
})

tables.post('/tables', requires('tables.manage'), async (c) => {
  const input = await readBody(c, newTable)
  const branchId = workingBranch(c.get('actor'))
  return command(c, 201, async (db, actor) => {
    const { rows: [{ count }] } = await db.query(
      `select count(*)::int as count from app.dining_tables where area_id = $1 and is_active`,
      [input.areaId],
    )
    // New tables start in a tidy grid, ready to be dragged into place.
    const x = 30 + (count % 5) * 195
    const y = 30 + (Math.floor(count / 5) % 6) * 150
    const { rows: [table] } = await db.query(
      `insert into app.dining_tables (tenant_id, branch_id, area_id, name, seats, shape, pos_x, pos_y)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning id, name`,
      [actor.tenantId, branchId, input.areaId, input.name, input.seats, input.shape, x, y],
    )
    await audit(db, actor, 'table.created', 'table', table.id, input)
    return table
  })
})

tables.put('/tables/layout', requires('tables.manage'), async (c) => {
  const input = await readBody(c, layout)
  return command(c, 200, async (db) => {
    for (const position of input.positions) {
      await db.query(`update app.dining_tables set pos_x = $2, pos_y = $3 where id = $1`, [position.id, position.x, position.y])
    }
    return { saved: input.positions.length }
  })
})

tables.patch('/tables/:id', requires('tables.manage'), async (c) => {
  const id = uuidParam(c.req.param('id'))
  const input = await readBody(c, tableUpdate)
  return command(c, 200, async (db, actor) => {
    if (input.isActive === false) await assertFree(db, id)
    const { rows: [table] } = await db.query(
      `update app.dining_tables set name = coalesce($2, name), seats = coalesce($3, seats), shape = coalesce($4, shape),
         area_id = coalesce($5, area_id), is_active = coalesce($6, is_active)
       where id = $1 returning id, name, seats, shape, area_id, is_active`,
      [id, input.name, input.seats, input.shape, input.areaId, input.isActive],
    )
    if (!table) throw notFound('Table')
    if (input.isActive === false) {
      await db.query(`update app.table_reservations set status = 'cancelled' where table_id = $1 and status = 'booked'`, [id])
    }
    await audit(db, actor, 'table.updated', 'table', id, input)
    return table
  })
})

tables.post('/tables/:id/seat', requires('tables.use'), async (c) => {
  const id = uuidParam(c.req.param('id'))
  const input = await readBody(c, seat)
  return command(c, 200, async (db) => {
    await assertFree(db, id)
    const { rows: [table] } = await db.query(
      `update app.dining_tables set seated_at = now(), seated_guests = $2 where id = $1 and is_active returning id`,
      [id, input.guests ?? null],
    )
    if (!table) throw notFound('Table')
    return table
  })
})

tables.post('/tables/:id/clear', requires('tables.use'), async (c) => {
  const id = uuidParam(c.req.param('id'))
  await readBody(c, z.strictObject({}))
  return command(c, 200, async (db) => {
    const { rows: [table] } = await db.query(`update app.dining_tables set seated_at = null, seated_guests = null where id = $1 returning id`, [id])
    if (!table) throw notFound('Table')
    return table
  })
})

tables.get('/reservations', requires('tables.read'), async (c) => {
  const actor = c.get('actor')
  const items = await tx(dbContext(actor), async (db) => {
    const { rows } = await db.query(
      `select r.id, r.table_id, t.name as table_name, r.guest_name, r.phone, r.guests, r.reserved_at, r.notes, r.status
         from app.table_reservations r join app.dining_tables t on t.id = r.table_id
        where r.branch_id = any($1::uuid[]) and r.status = 'booked' and r.reserved_at > now() - interval '30 minutes'
        order by r.reserved_at limit 100`,
      [actor.branchIds],
    )
    return rows
  })
  return c.json({ items })
})

tables.post('/reservations', requires('tables.use'), async (c) => {
  const input = await readBody(c, reservation)
  const branchId = workingBranch(c.get('actor'))
  if (new Date(input.reservedAt).getTime() < Date.now() - 300000) throw new AppError(422, 'in_the_past', 'Choose a time that hasn’t passed.')
  return command(c, 201, async (db, actor) => {
    const { rows: [table] } = await db.query(`select id from app.dining_tables where id = $1 and is_active`, [input.tableId])
    if (!table) throw notFound('Table')
    await assertNoClash(db, input.tableId, input.reservedAt)
    const { rows: [row] } = await db.query(
      `insert into app.table_reservations (tenant_id, branch_id, table_id, guest_name, phone, guests, reserved_at, notes, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id, table_id, guest_name, guests, reserved_at, status`,
      [actor.tenantId, branchId, input.tableId, input.guestName, input.phone, input.guests, input.reservedAt, input.notes, actor.membershipId],
    )
    return row
  })
})

tables.patch('/reservations/:id', requires('tables.use'), async (c) => {
  const id = uuidParam(c.req.param('id'))
  const input = await readBody(c, reservationUpdate)
  return command(c, 200, async (db) => {
    const { rows: [current] } = await db.query(`select table_id, guests, status from app.table_reservations where id = $1`, [id])
    if (!current) throw notFound('Reservation')
    if (current.status !== 'booked') throw new AppError(409, 'reservation_closed', 'This reservation has already been used or cancelled.')
    if (input.reservedAt) await assertNoClash(db, current.table_id, input.reservedAt, id)
    if (input.status === 'seated') {
      await assertFree(db, current.table_id)
      await db.query(`update app.dining_tables set seated_at = now(), seated_guests = $2 where id = $1`, [current.table_id, input.guests ?? current.guests])
    }
    const { rows: [row] } = await db.query(
      `update app.table_reservations set status = coalesce($2, status), guest_name = coalesce($3, guest_name), phone = coalesce($4, phone),
         guests = coalesce($5, guests), reserved_at = coalesce($6, reserved_at)
       where id = $1 returning id, table_id, guest_name, guests, reserved_at, status`,
      [id, input.status, input.guestName, input.phone, input.guests, input.reservedAt],
    )
    return row
  })
})
