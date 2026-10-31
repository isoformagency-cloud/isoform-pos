// Table and kitchen tests against the real Supabase project. Removes everything it creates.
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { provisionBusiness } from './modules/tenancy/provision.js'
import { closeDb } from './platform/db.js'
import { createSession, supabaseAdmin } from './platform/supabase.js'
import { request } from './testing.js'

const run = crypto.randomUUID().slice(0, 8)
const emailFor = (label: string) => `floor-${label}-${run}@staff.isoform.invalid`
const business = (label: string) => ({
  displayName: `Floor ${label}`, legalName: 'Legal', scheme: 'unregistered' as const, stateCode: '33', address: 'A',
  branchName: 'Main', branchCode: 'MN', ownerName: 'Owner', ownerEmail: emailFor(label),
})

let a: Awaited<ReturnType<typeof provisionBusiness>>
let b: Awaited<ReturnType<typeof provisionBusiness>>
let owner: string
let ownerB: string
let cashier: string
let kitchenStaff: string
let variant: string
let area: string
const users: string[] = []
let db: pg.Client
let tableCount = 0

async function call(method: string, path: string, token: string, body?: unknown) {
  const write = method !== 'GET'
  const response = await request(`/api/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(write ? { 'idempotency-key': crypto.randomUUID(), 'content-type': 'application/json' } : {}),
    },
    body: write ? JSON.stringify(body ?? {}) : undefined,
  })
  return { status: response.status, body: (await response.json()) as any }
}

async function staff(role: string) {
  const made = await call('POST', '/staff', owner, { displayName: `Staff ${role}`, role, pin: '4821', branchIds: [a.branchId] })
  const { rows: [row] } = await db.query(`select user_id from app.memberships where id = $1`, [made.body.id])
  users.push(row.user_id)
  const { data } = await supabaseAdmin.auth.admin.getUserById(row.user_id)
  return (await createSession(data.user!.email!)).access_token
}

const newTable = async () => {
  tableCount += 1
  return (await call('POST', '/tables', owner, { name: `T${tableCount}`, seats: 4, areaId: area })).body.id as string
}
const open = async (extra: object = {}) =>
  (await call('POST', '/orders', cashier, { id: crypto.randomUUID(), orderType: 'dine_in', ...extra })).body
const addItem = async (orderId: string) =>
  (await call('POST', `/orders/${orderId}/items`, cashier, { id: crypto.randomUUID(), variantId: variant })).body
const floorTable = async (id: string) => (await call('GET', '/floor', owner)).body.tables.find((table: any) => table.id === id)
const board = async (token = cashier) => (await call('GET', '/kitchen', token)).body.tickets as any[]
const ticketFor = async (orderId: string) => (await board()).filter((ticket) => ticket.order_id === orderId)
const inAnHour = () => new Date(Date.now() + 3600000).toISOString()

beforeAll(async () => {
  db = new pg.Client({ connectionString: process.env.DATABASE_URL_DIRECT, ssl: { rejectUnauthorized: false } })
  await db.connect()
  a = await provisionBusiness(business('a'))
  b = await provisionBusiness(business('b'))
  users.push(a.userId, b.userId)
  owner = (await createSession(emailFor('a'))).access_token
  ownerB = (await createSession(emailFor('b'))).access_token
  cashier = await staff('cashier')
  kitchenStaff = await staff('kitchen')

  const rate = (await call('POST', '/tax-rates', owner, { name: 'GST 5%', cgstRate: '2.5', sgstRate: '2.5' })).body.id
  const category = (await call('POST', '/categories', owner, { name: 'Food' })).body.id
  await call('POST', '/products', owner, { name: 'Dosa', categoryId: category, taxRateId: rate, variants: [{ name: 'Regular', price: '150' }] })
  variant = (await call('GET', '/menu', owner)).body.products[0].variants[0].id
  area = (await call('POST', '/areas', owner, { name: 'Indoor' })).body.id
})

afterAll(async () => {
  for (const tenant of [a.tenantId, b.tenantId]) {
    for (const table of ['audit_log', 'idempotency_keys', 'invoice_lines', 'invoices', 'invoice_series', 'order_discounts', 'order_item_addons', 'order_status_history', 'kitchen_ticket_items', 'order_items',
      'kitchen_tickets', 'table_reservations', 'orders', 'dining_tables', 'floor_areas', 'customers', 'branch_variant_overrides', 'product_addons', 'addons',
      'product_variants', 'products', 'categories', 'tax_rates', 'branch_memberships', 'registers', 'payment_methods', 'memberships', 'branches', 'tax_registrations']) {
      await db.query(`delete from app.${table} where tenant_id = $1`, [tenant])
    }
    await db.query(`delete from app.tenants where id = $1`, [tenant])
  }
  for (const id of users) await supabaseAdmin.auth.admin.deleteUser(id)
  await db.end()
  await closeDb()
})

describe('setting up the floor', () => {
  it('lets owners add tables, and not cashiers', async () => {
    expect((await call('POST', '/tables', cashier, { name: 'X', areaId: area })).status).toBe(403)
    expect((await call('POST', '/areas', cashier, { name: 'Roof' })).status).toBe(403)
    const id = await newTable()
    expect((await floorTable(id)).state).toBe('available')
  })
  it('refuses a duplicate table name', async () => {
    await call('POST', '/tables', owner, { name: 'Twin', areaId: area })
    expect((await call('POST', '/tables', owner, { name: 'twin', areaId: area })).status).toBe(409)
  })
  it('saves dragged positions', async () => {
    const id = await newTable()
    await call('PUT', '/tables/layout', owner, { positions: [{ id, x: 500, y: 420 }] })
    expect(await floorTable(id)).toMatchObject({ pos_x: 500, pos_y: 420 })
  })
  it('keeps the kitchen login off the floor plan', async () => {
    expect((await call('GET', '/floor', kitchenStaff)).status).toBe(403)
  })
  it('hides one business’s tables from another', async () => {
    const id = await newTable()
    expect((await call('GET', '/floor', ownerB)).body.tables).toHaveLength(0)
    expect((await call('PATCH', `/tables/${id}`, ownerB, { name: 'Taken' })).status).toBe(404)
    expect((await call('POST', `/tables/${id}/seat`, ownerB, {})).status).toBe(404)
    expect((await call('POST', '/orders', ownerB, { id: crypto.randomUUID(), orderType: 'dine_in', tableId: id })).status).toBe(404)
  })
  it('won’t remove an area with tables, or a table in use', async () => {
    expect((await call('PATCH', `/areas/${area}`, owner, { isActive: false })).status).toBe(409)
    const id = await newTable()
    await open({ tableId: id })
    expect((await call('PATCH', `/tables/${id}`, owner, { isActive: false })).status).toBe(409)
  })
})

describe('table states', () => {
  it('follows the order from occupied to billing to free', async () => {
    const id = await newTable()
    const order = await open({ tableId: id, guestCount: 3 })
    expect(order.table_id).toBe(id)
    expect(order.table_label).toBe(`T${tableCount}`)
    const added = await addItem(order.id)
    const busy = await floorTable(id)
    expect(busy).toMatchObject({ state: 'occupied', amount: '150.00', display_number: order.display_number })
    const done = (await call('POST', `/orders/${order.id}/confirm`, cashier, { version: added.version })).body
    expect((await floorTable(id)).state).toBe('billing')
    await call('POST', `/orders/${order.id}/finalize`, cashier, { version: done.version, invoices: [{ id: crypto.randomUUID() }] })
    expect((await floorTable(id)).state).toBe('available')
  })
  it('allows one open order per table', async () => {
    const id = await newTable()
    await open({ tableId: id })
    const second = await call('POST', '/orders', cashier, { id: crypto.randomUUID(), orderType: 'dine_in', tableId: id })
    expect(second.status).toBe(409)
    expect(second.body.code).toBe('table_busy')
  })
  it('refuses a table on a takeaway order', async () => {
    const id = await newTable()
    expect((await call('POST', '/orders', cashier, { id: crypto.randomUUID(), orderType: 'takeaway', tableId: id })).status).toBe(422)
  })
  it('frees the table when an order leaves dine-in', async () => {
    const id = await newTable()
    const order = await open({ tableId: id })
    const changed = await call('PATCH', `/orders/${order.id}`, cashier, { version: order.version, orderType: 'takeaway' })
    expect(changed.body.table_id).toBeNull()
    expect(changed.body.table_label).toBeNull()
    expect((await floorTable(id)).state).toBe('available')
  })
  it('shows waiting guests until an order starts', async () => {
    const id = await newTable()
    await call('POST', `/tables/${id}/seat`, cashier, { guests: 2 })
    expect(await floorTable(id)).toMatchObject({ state: 'waiting', seated_guests: 2 })
    await open({ tableId: id })
    expect(await floorTable(id)).toMatchObject({ state: 'occupied', seated_at: null })
  })
  it('clears waiting guests', async () => {
    const id = await newTable()
    await call('POST', `/tables/${id}/seat`, cashier, {})
    await call('POST', `/tables/${id}/clear`, cashier, {})
    expect((await floorTable(id)).state).toBe('available')
  })
})

describe('reservations', () => {
  it('reserves a table and refuses a clash', async () => {
    const id = await newTable()
    const made = await call('POST', '/reservations', cashier, { tableId: id, guestName: 'Meera', phone: '9812345670', guests: 4, reservedAt: inAnHour() })
    expect(made.status).toBe(201)
    expect(await floorTable(id)).toMatchObject({ state: 'reserved' })
    expect((await floorTable(id)).reservation.guestName).toBe('Meera')
    const clash = await call('POST', '/reservations', cashier, { tableId: id, guestName: 'Ravi', reservedAt: inAnHour() })
    expect(clash.body.code).toBe('table_booked')
  })
  it('allows a booking far enough away, without showing as reserved yet', async () => {
    const id = await newTable()
    const later = new Date(Date.now() + 86400000).toISOString()
    expect((await call('POST', '/reservations', cashier, { tableId: id, guestName: 'Later', reservedAt: later })).status).toBe(201)
    expect((await floorTable(id)).state).toBe('available')
    const list = (await call('GET', '/reservations', cashier)).body.items
    expect(list.some((row: any) => row.guest_name === 'Later')).toBe(true)
  })
  it('refuses a time in the past', async () => {
    const id = await newTable()
    const past = new Date(Date.now() - 3600000).toISOString()
    expect((await call('POST', '/reservations', cashier, { tableId: id, guestName: 'Old', reservedAt: past })).status).toBe(422)
  })
  it('seats a reservation', async () => {
    const id = await newTable()
    const made = (await call('POST', '/reservations', cashier, { tableId: id, guestName: 'Seat', guests: 3, reservedAt: inAnHour() })).body
    await call('PATCH', `/reservations/${made.id}`, cashier, { status: 'seated' })
    expect(await floorTable(id)).toMatchObject({ state: 'waiting', seated_guests: 3 })
    expect((await call('PATCH', `/reservations/${made.id}`, cashier, { status: 'cancelled' })).status).toBe(409)
  })
  it('cancels a reservation', async () => {
    const id = await newTable()
    const made = (await call('POST', '/reservations', cashier, { tableId: id, guestName: 'Gone', reservedAt: inAnHour() })).body
    await call('PATCH', `/reservations/${made.id}`, cashier, { status: 'cancelled' })
    expect((await floorTable(id)).state).toBe('available')
  })
})

describe('moving and merging', () => {
  it('moves an order to a free table', async () => {
    const from = await newTable()
    const to = await newTable()
    const order = await open({ tableId: from })
    const moved = await call('PATCH', `/orders/${order.id}`, cashier, { version: order.version, tableId: to })
    expect(moved.body.table_id).toBe(to)
    expect((await floorTable(from)).state).toBe('available')
    expect((await floorTable(to)).state).toBe('occupied')
  })
  it('won’t move onto a busy table', async () => {
    const first = await newTable()
    const second = await newTable()
    const order = await open({ tableId: first })
    await open({ tableId: second })
    const moved = await call('PATCH', `/orders/${order.id}`, cashier, { version: order.version, tableId: second })
    expect(moved.body.code).toBe('table_busy')
  })
  it('merges two tables, keeping every item and kitchen ticket', async () => {
    const first = await newTable()
    const second = await newTable()
    const from = await addItem((await open({ tableId: first, guestCount: 2 })).id)
    const sent = (await call('POST', `/orders/${from.id}/send`, cashier, { version: from.version })).body
    const into = await addItem((await open({ tableId: second, guestCount: 3 })).id)
    const merged = await call('POST', `/orders/${sent.id}/merge`, cashier, { version: sent.version, intoId: into.id, intoVersion: into.version })
    expect(merged.status).toBe(200)
    expect(merged.body.items.filter((item: any) => item.status === 'active')).toHaveLength(2)
    expect(merged.body.subtotal).toBe('300.00')
    expect(merged.body.guest_count).toBe(5)
    expect((await floorTable(first)).state).toBe('available')
    expect((await call('GET', `/orders/${from.id}`, cashier)).body.cancel_reason).toContain('Merged into')
    expect(await ticketFor(into.id)).toHaveLength(1)
  })
  it('won’t merge a confirmed order', async () => {
    const added = await addItem((await open({ tableId: await newTable() })).id)
    const done = (await call('POST', `/orders/${added.id}/confirm`, cashier, { version: added.version })).body
    const other = await open({ tableId: await newTable() })
    const merged = await call('POST', `/orders/${done.id}/merge`, cashier, { version: done.version, intoId: other.id, intoVersion: other.version })
    expect(merged.body.code).toBe('order_confirmed')
  })
  it('won’t lose a discount by merging', async () => {
    const added = await addItem((await open({ tableId: await newTable() })).id)
    const discounted = (await call('POST', `/orders/${added.id}/discounts`, owner, { id: crypto.randomUUID(), kind: 'percent', value: '10' })).body
    const other = await open({ tableId: await newTable() })
    const merged = await call('POST', `/orders/${added.id}/merge`, cashier, { version: discounted.version, intoId: other.id, intoVersion: other.version })
    expect(merged.body.code).toBe('has_discount')
  })
})

describe('sending to the kitchen', () => {
  it('sends rounds, so a table can order more', async () => {
    const added = await addItem((await open()).id)
    const first = await call('POST', `/orders/${added.id}/send`, cashier, { version: added.version })
    expect(first.body.items[0].sent).toBe(true)
    expect(first.body.items[0].kitchen_status).toBe('new')
    const again = await call('POST', `/orders/${added.id}/send`, cashier, { version: first.body.version })
    expect(again.body.code).toBe('nothing_to_send')
    const more = await addItem(added.id)
    await call('POST', `/orders/${added.id}/send`, cashier, { version: more.version })
    expect((await ticketFor(added.id)).map((ticket) => ticket.round)).toEqual([1, 2])
  })
  it('locks what the kitchen already has', async () => {
    const added = await addItem((await open()).id)
    const sent = (await call('POST', `/orders/${added.id}/send`, cashier, { version: added.version })).body
    const line = sent.items[0].id
    const changed = await call('PATCH', `/orders/${added.id}/items/${line}`, cashier, { version: sent.version, quantity: '3' })
    expect(changed.body.code).toBe('item_sent')
    await expect(db.query(`update app.order_items set quantity = 9 where id = $1`, [line])).rejects.toThrow(/gone to the kitchen/)
  })
  it('needs a manager to remove a sent item, and clears an empty ticket', async () => {
    const added = await addItem((await open()).id)
    const sent = (await call('POST', `/orders/${added.id}/send`, cashier, { version: added.version })).body
    const line = sent.items[0].id
    const refused = await call('POST', `/orders/${added.id}/items/${line}/void`, cashier, { version: sent.version, reason: 'Wrong' })
    expect(refused.body.code).toBe('manager_needed')
    const latest = (await call('GET', `/orders/${added.id}`, owner)).body
    expect((await call('POST', `/orders/${added.id}/items/${line}/void`, owner, { version: latest.version, reason: 'Wrong' })).status).toBe(200)
    expect(await ticketFor(added.id)).toHaveLength(0)
  })
  it('lets a cashier fix an unsent item as before', async () => {
    const added = await addItem((await open()).id)
    const changed = await call('PATCH', `/orders/${added.id}/items/${added.items[0].id}`, cashier, { version: added.version, quantity: '2' })
    expect(changed.status).toBe(200)
  })
  it('sends anything left when the order is confirmed', async () => {
    const added = await addItem((await open()).id)
    await call('POST', `/orders/${added.id}/confirm`, cashier, { version: added.version })
    expect(await ticketFor(added.id)).toHaveLength(1)
  })
  it('removes a cancelled order from the board', async () => {
    const added = await addItem((await open()).id)
    const sent = (await call('POST', `/orders/${added.id}/send`, cashier, { version: added.version })).body
    await call('POST', `/orders/${added.id}/cancel`, owner, { version: sent.version, reason: 'Left' })
    expect(await ticketFor(added.id)).toHaveLength(0)
  })
  it('stops when the kitchen display is off', async () => {
    await call('PATCH', '/business', owner, { usesKitchen: false })
    const added = await addItem((await open()).id)
    expect((await call('POST', `/orders/${added.id}/send`, cashier, { version: added.version })).body.code).toBe('kitchen_off')
    await call('POST', `/orders/${added.id}/confirm`, cashier, { version: added.version })
    expect(await ticketFor(added.id)).toHaveLength(0)
    await call('PATCH', '/business', owner, { usesKitchen: true })
  })
})

describe('the kitchen board', () => {
  const ticket = async () => {
    const added = await addItem((await open()).id)
    await call('POST', `/orders/${added.id}/send`, cashier, { version: added.version })
    return (await ticketFor(added.id))[0]
  }
  const move = (id: string, from: string, to: string, token = kitchenStaff) => call('POST', `/kitchen/tickets/${id}/status`, token, { from, to })

  it('walks a ticket through to completed, and back', async () => {
    const { id, order_id: orderId } = await ticket()
    expect((await move(id, 'new', 'preparing')).body.status).toBe('preparing')
    expect((await ticketFor(orderId))[0].started_at).toBeTruthy()
    await move(id, 'preparing', 'ready')
    await move(id, 'ready', 'preparing')
    expect((await ticketFor(orderId))[0].ready_at).toBeNull()
    await move(id, 'preparing', 'ready')
    await move(id, 'ready', 'completed')
    expect((await ticketFor(orderId))[0].completed_at).toBeTruthy()
  })
  it('refuses to skip a step', async () => {
    const { id } = await ticket()
    expect((await move(id, 'new', 'ready')).status).toBe(422)
  })
  it('refuses a stale move from a second screen', async () => {
    const { id } = await ticket()
    await move(id, 'new', 'preparing')
    expect((await move(id, 'new', 'preparing')).body.code).toBe('stale_ticket')
  })
  it('ticks and unticks items', async () => {
    const { items, order_id: orderId } = await ticket()
    await call('POST', `/kitchen/items/${items[0].id}/tick`, kitchenStaff, { done: true })
    expect((await ticketFor(orderId))[0].items[0].preparedAt).toBeTruthy()
    await call('POST', `/kitchen/items/${items[0].id}/tick`, kitchenStaff, { done: false })
    expect((await ticketFor(orderId))[0].items[0].preparedAt).toBeNull()
  })
  it('keeps the kitchen login out of orders and money', async () => {
    expect((await call('POST', '/orders', kitchenStaff, { id: crypto.randomUUID(), orderType: 'takeaway' })).status).toBe(403)
    const { items } = (await board(kitchenStaff))[0]
    expect(items[0].unit_price).toBeUndefined()
  })
  it('hides the board from another business', async () => {
    const { id } = await ticket()
    expect(await board(ownerB)).toHaveLength(0)
    expect((await move(id, 'new', 'preparing', ownerB)).status).toBe(404)
  })
  it('counts active and delayed tickets', async () => {
    await ticket()
    const alerts = (await call('GET', '/alerts', cashier)).body
    expect(alerts.kitchenActive).toBeGreaterThan(0)
    await call('PATCH', '/business', owner, { kitchenDelayMinutes: 1 })
    await db.query(`update app.kitchen_tickets set sent_at = now() - interval '5 minutes' where tenant_id = $1 and status = 'new'`, [a.tenantId])
    expect((await call('GET', '/alerts', cashier)).body.kitchenDelayed).toBeGreaterThan(0)
  })
  it('adds kitchen steps to the order timeline', async () => {
    const { order_id: orderId, id } = await ticket()
    await move(id, 'new', 'preparing')
    await move(id, 'preparing', 'ready')
    const labels = (await call('GET', `/orders/${orderId}/timeline`, cashier)).body.items.map((item: any) => item.label)
    expect(labels).toContain('Sent to kitchen')
    expect(labels).toContain('Ready')
  })
})
