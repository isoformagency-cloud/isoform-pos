// Order tests against the real Supabase project. Removes everything it creates.
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { request } from './testing.js'
import { provisionBusiness } from './modules/tenancy/provision.js'
import { closeDb } from './platform/db.js'
import { createSession, supabaseAdmin } from './platform/supabase.js'

const run = crypto.randomUUID().slice(0, 8)
const emailFor = (label: string) => `orders-${label}-${run}@staff.isoform.invalid`
const business = (label: string) => ({
  displayName: `Orders ${label}`, legalName: 'Legal', scheme: 'unregistered' as const, stateCode: '33', address: 'A',
  branchName: 'Main', branchCode: 'MN', ownerName: 'Owner', ownerEmail: emailFor(label),
})

let a: Awaited<ReturnType<typeof provisionBusiness>>
let b: Awaited<ReturnType<typeof provisionBusiness>>
let ownerA: string
let ownerB: string
let cashierA: string
let kitchenA: string
let cashierSecond: string
let second: string
let variant: string
let product: string
let addon: string
const users: string[] = []
let db: pg.Client

async function call(method: string, path: string, token: string, body?: unknown, headers: Record<string, string> = {}) {
  const write = method !== 'GET'
  const response = await request(`/api/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(write ? { 'idempotency-key': crypto.randomUUID(), 'content-type': 'application/json' } : {}),
      ...headers,
    },
    body: write ? JSON.stringify(body ?? {}) : undefined,
  })
  return { status: response.status, body: (await response.json()) as any }
}

async function staff(role: string, branchIds: string[]) {
  const made = await call('POST', '/staff', ownerA, { displayName: `Staff ${role}`, role, pin: '4821', branchIds })
  const { rows: [row] } = await db.query(`select user_id from app.memberships where id = $1`, [made.body.id])
  users.push(row.user_id)
  const { data } = await supabaseAdmin.auth.admin.getUserById(row.user_id)
  return (await createSession(data.user!.email!)).access_token
}

const open = async (token = cashierA, extra: object = {}, headers = {}) =>
  call('POST', '/orders', token, { id: crypto.randomUUID(), orderType: 'dine_in', ...extra }, headers)
const addItem = (orderId: string, token = cashierA, extra: object = {}) =>
  call('POST', `/orders/${orderId}/items`, token, { id: crypto.randomUUID(), variantId: variant, ...extra })

beforeAll(async () => {
  db = new pg.Client({ connectionString: process.env.DATABASE_URL_DIRECT, ssl: { rejectUnauthorized: false } })
  await db.connect()
  a = await provisionBusiness(business('a'))
  b = await provisionBusiness(business('b'))
  users.push(a.userId, b.userId)
  ownerA = (await createSession(emailFor('a'))).access_token
  ownerB = (await createSession(emailFor('b'))).access_token

  const tax = (await call('GET', '/tax-registrations', ownerA)).body.items[0].id
  second = (await call('POST', '/branches', ownerA, { name: 'Second', code: 'SC', taxRegistrationId: tax })).body.id
  cashierA = await staff('cashier', [a.branchId])
  kitchenA = await staff('kitchen', [a.branchId])
  cashierSecond = await staff('cashier', [second])

  const rate = (await call('POST', '/tax-rates', ownerA, { name: 'GST 5%', cgstRate: '2.5', sgstRate: '2.5' })).body.id
  const category = (await call('POST', '/categories', ownerA, { name: 'Food' })).body.id
  product = (await call('POST', '/products', ownerA, {
    name: 'Dosa', categoryId: category, taxRateId: rate, variants: [{ name: 'Regular', price: '150' }],
  })).body.id
  const menu = (await call('GET', `/menu?branchId=${a.branchId}`, ownerA)).body
  variant = menu.products[0].variants[0].id
  addon = (await call('POST', '/addons', ownerA, { name: 'Extra ghee', price: '20.50' })).body.id
})

afterAll(async () => {
  for (const tenant of [a.tenantId, b.tenantId]) {
    for (const table of ['audit_log', 'idempotency_keys', 'invoice_lines', 'invoices', 'invoice_series', 'order_discounts', 'order_item_addons', 'order_status_history', 'kitchen_ticket_items', 'order_items', 'kitchen_tickets', 'orders', 'dining_tables', 'floor_areas', 'customers',
      'branch_variant_overrides', 'product_addons', 'addons', 'product_variants', 'products', 'categories', 'tax_rates',
      'branch_memberships', 'registers', 'payment_methods', 'memberships', 'branches', 'tax_registrations']) {
      await db.query(`delete from app.${table} where tenant_id = $1`, [tenant])
    }
    await db.query(`delete from app.tenants where id = $1`, [tenant])
  }
  for (const id of users) await supabaseAdmin.auth.admin.deleteUser(id)
  await db.end()
  await closeDb()
})

describe('creating orders', () => {
  it('numbers orders per branch and trading day', async () => {
    const first = await open()
    const next = await open()
    expect(next.body.display_number).toBe(first.body.display_number + 1)
    expect(first.body.business_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
  it('gives 10 tills at once 10 different numbers', async () => {
    const replies = await Promise.all(Array.from({ length: 10 }, () => open()))
    expect(replies.every((r) => r.status === 201)).toBe(true)
    expect(new Set(replies.map((r) => r.body.display_number)).size).toBe(10)
  })
  it('saves one order when a request is replayed', async () => {
    const id = crypto.randomUUID()
    const headers = { 'idempotency-key': crypto.randomUUID() }
    const replies = await Promise.all(Array.from({ length: 5 }, () => call('POST', '/orders', cashierA, { id, orderType: 'takeaway' }, headers)))
    expect(replies.every((r) => r.body.id === id)).toBe(true)
    const { rows } = await db.query(`select count(*)::int as n from app.orders where id = $1`, [id])
    expect(rows[0].n).toBe(1)
  })
  it('needs an app name for aggregator orders', async () => {
    expect((await open(cashierA, { orderType: 'aggregator' })).status).toBe(422)
    const order = await open(cashierA, { orderType: 'aggregator', aggregator: 'Swiggy', aggregatorReference: 'SW-1' })
    expect(order.status).toBe(201)
    expect(order.body.aggregator).toBe('Swiggy')
  })
  it('asks an owner with two branches to choose one', async () => {
    expect((await open(ownerA)).status).toBe(400)
    expect((await open(ownerA, {}, { 'x-branch-id': a.branchId })).status).toBe(201)
  })
})

describe('prices', () => {
  it('uses the server’s price and refuses one from the client', async () => {
    const order = await open()
    expect((await addItem(order.body.id, cashierA, { unitPrice: '1' })).status).toBe(422)
    const added = await addItem(order.body.id)
    expect(added.body.items[0].unit_price).toBe('150.00')
  })
  it('keeps the original price when the menu changes', async () => {
    const order = await open()
    await addItem(order.body.id)
    await call('PATCH', `/variants/${variant}`, ownerA, { price: '999' })
    const latest = await call('GET', `/orders/${order.body.id}`, cashierA)
    expect(latest.body.items[0].unit_price).toBe('150.00')
    await call('PATCH', `/variants/${variant}`, ownerA, { price: '150' })
  })
  it('uses the branch price', async () => {
    await call('PUT', `/branches/${a.branchId}/variants/${variant}`, ownerA, { price: '175', isAvailable: true })
    const order = await open()
    expect((await addItem(order.body.id)).body.items[0].unit_price).toBe('175.00')
    await call('PUT', `/branches/${a.branchId}/variants/${variant}`, ownerA, { price: null, isAvailable: true })
  })
  it('refuses sold-out and hidden items', async () => {
    const order = await open()
    await call('PUT', `/branches/${a.branchId}/variants/${variant}`, ownerA, { price: null, isAvailable: false })
    expect((await addItem(order.body.id)).status).toBe(409)
    await call('PUT', `/branches/${a.branchId}/variants/${variant}`, ownerA, { price: null, isAvailable: true })
    await call('PATCH', `/products/${product}`, ownerA, { isActive: false })
    expect((await addItem(order.body.id)).status).toBe(409)
    await call('PATCH', `/products/${product}`, ownerA, { isActive: true })
  })
  it('allows only add-ons linked to the item', async () => {
    const order = await open()
    expect((await addItem(order.body.id, cashierA, { addonIds: [addon] })).status).toBe(422)
    await call('PUT', `/products/${product}/addons`, ownerA, { addonIds: [addon] })
    const added = await addItem(order.body.id, cashierA, { addonIds: [addon], quantity: '2' })
    expect(added.body.items[0].line_total).toBe('341.00')
    expect(added.body.subtotal).toBe('341.00')
  })
  it('adds up exactly without floating-point drift', async () => {
    const order = await open()
    await call('PATCH', `/variants/${variant}`, ownerA, { price: '0.10' })
    for (let i = 0; i < 3; i += 1) await addItem(order.body.id)
    const latest = await call('GET', `/orders/${order.body.id}`, cashierA)
    expect(latest.body.subtotal).toBe('0.30')
    await call('PATCH', `/variants/${variant}`, ownerA, { price: '150' })
  })
})

describe('two people, one order', () => {
  it('rejects a stale save and returns the latest order', async () => {
    const order = await open()
    const item = (await addItem(order.body.id)).body
    const line = item.items[0].id
    const first = await call('PATCH', `/orders/${order.body.id}/items/${line}`, cashierA, { version: item.version, quantity: '2' })
    expect(first.status).toBe(200)
    const late = await call('PATCH', `/orders/${order.body.id}/items/${line}`, cashierA, { version: item.version, quantity: '9' })
    expect(late.status).toBe(409)
    expect(late.body.code).toBe('stale_order')
    expect(late.body.details.order.items[0].quantity).toBe('2.000')
  })
  it('lets exactly one of 5 simultaneous edits win', async () => {
    const order = await open()
    const item = (await addItem(order.body.id)).body
    const line = item.items[0].id
    const replies = await Promise.all(['2', '3', '4', '5', '6'].map((quantity) =>
      call('PATCH', `/orders/${order.body.id}/items/${line}`, cashierA, { version: item.version, quantity })))
    expect(replies.filter((r) => r.status === 200)).toHaveLength(1)
    expect(replies.filter((r) => r.status === 409)).toHaveLength(4)
  })
  it('keeps both when two people add items at once', async () => {
    const order = await open()
    await Promise.all([addItem(order.body.id), addItem(order.body.id)])
    expect((await call('GET', `/orders/${order.body.id}`, cashierA)).body.items).toHaveLength(2)
  })
})

describe('removing and discounting', () => {
  it('needs a reason to remove an item, and keeps the record', async () => {
    const order = await open()
    const item = (await addItem(order.body.id)).body
    const path = `/orders/${order.body.id}/items/${item.items[0].id}/void`
    expect((await call('POST', path, cashierA, { version: item.version })).status).toBe(422)
    const voided = await call('POST', path, cashierA, { version: item.version, reason: 'Wrong item' })
    expect(voided.body.subtotal).toBe('0.00')
    expect(voided.body.items[0].status).toBe('voided')
  })
  it('stops a cashier going over the discount limit', async () => {
    const order = await open()
    await addItem(order.body.id)
    const body = { id: crypto.randomUUID(), kind: 'percent', value: '25', reason: 'Regular customer' }
    const refused = await call('POST', `/orders/${order.body.id}/discounts`, cashierA, body)
    expect(refused.status).toBe(403)
    expect(refused.body.code).toBe('discount_limit')
    expect((await call('GET', `/orders/${order.body.id}`, cashierA)).body.discounts).toHaveLength(0)
    const owner = await call('POST', `/orders/${order.body.id}/discounts`, ownerA, { ...body, value: '10' }, { 'x-branch-id': a.branchId })
    expect(owner.body.discount).toBe('15.00')
    expect(owner.body.after_discount).toBe('135.00')
  })
  it('lets a cashier give a quick discount with no reason, up to the limit', async () => {
    const order = await open()
    await addItem(order.body.id)
    const given = await call('POST', `/orders/${order.body.id}/discounts`, cashierA, { id: crypto.randomUUID(), kind: 'percent', value: '20' })
    expect(given.status).toBe(201)
    expect(given.body.after_discount).toBe('120.00')
    expect(given.body.discounts[0].reason).toBe('No reason given')
  })
  it('stops a kitchen login giving a discount', async () => {
    const order = await open()
    await addItem(order.body.id)
    expect((await call('POST', `/orders/${order.body.id}/discounts`, kitchenA, { id: crypto.randomUUID(), kind: 'percent', value: '5' })).status).toBe(403)
  })
  it('catches a cashier discount pushed over the limit by removing items', async () => {
    const order = await open()
    await addItem(order.body.id)
    const added = (await addItem(order.body.id)).body
    await call('POST', `/orders/${order.body.id}/discounts`, cashierA, { id: crypto.randomUUID(), kind: 'amount', value: '60' })
    const line = added.items[1].id
    const latest = (await call('GET', `/orders/${order.body.id}`, cashierA)).body
    const voided = await call('POST', `/orders/${order.body.id}/items/${line}/void`, cashierA, { version: latest.version, reason: 'Wrong item' })
    const billed = await call('POST', `/orders/${order.body.id}/finalize`, cashierA, { version: voided.body.version, invoices: [{ id: crypto.randomUUID() }] })
    expect(billed.status).toBe(403)
    expect(billed.body.code).toBe('discount_limit')
    expect((await call('GET', `/orders/${order.body.id}`, cashierA)).body.status).toBe('open')
  })
  it('refuses a discount above the total', async () => {
    const order = await open()
    await addItem(order.body.id)
    const body = { id: crypto.randomUUID(), kind: 'amount', value: '500', reason: 'Too much' }
    expect((await call('POST', `/orders/${order.body.id}/discounts`, ownerA, body)).status).toBe(409)
    expect((await call('GET', `/orders/${order.body.id}`, ownerA)).body.discounts).toHaveLength(0)
  })
  it('lets a cashier drop an empty order but not one with items', async () => {
    const empty = await open()
    expect((await call('POST', `/orders/${empty.body.id}/cancel`, cashierA, { version: empty.body.version, reason: 'Left' })).status).toBe(200)
    const full = (await addItem((await open()).body.id)).body
    expect((await call('POST', `/orders/${full.id}/cancel`, cashierA, { version: full.version, reason: 'Left' })).status).toBe(403)
    const done = await call('POST', `/orders/${full.id}/cancel`, ownerA, { version: full.version, reason: 'Customer left' })
    expect(done.body.status).toBe('cancelled')
    expect((await addItem(full.id)).status).toBe(409)
  })
})

describe('confirmed orders', () => {
  const confirmed = async () => {
    const order = await open()
    const added = (await addItem(order.body.id)).body
    const done = await call('POST', `/orders/${order.body.id}/confirm`, cashierA, { version: added.version })
    expect(done.status).toBe(200)
    return done.body
  }

  it('records the confirmation', async () => {
    expect((await confirmed()).confirmed_at).toBeTruthy()
  })
  it('refuses to confirm an empty order', async () => {
    const order = await open()
    expect((await call('POST', `/orders/${order.body.id}/confirm`, cashierA, { version: order.body.version })).status).toBe(409)
  })
  it('blocks new, changed and removed items', async () => {
    const order = await confirmed()
    const line = order.items[0].id
    expect((await addItem(order.id)).status).toBe(409)
    expect((await call('PATCH', `/orders/${order.id}/items/${line}`, cashierA, { version: order.version, quantity: '5' })).status).toBe(409)
    expect((await call('POST', `/orders/${order.id}/items/${line}/void`, ownerA, { version: order.version, reason: 'Try' }, { 'x-branch-id': a.branchId })).status).toBe(409)
    expect((await call('GET', `/orders/${order.id}`, cashierA)).body.items[0].quantity).toBe('1.000')
  })
  it('blocks a service charge added afterwards', async () => {
    const order = await confirmed()
    expect((await call('PATCH', `/orders/${order.id}`, cashierA, { version: order.version, serviceChargePercent: '5' })).status).toBe(409)
  })
  it('still allows a discount, and the bill reflects it', async () => {
    const order = await confirmed()
    const body = { id: crypto.randomUUID(), kind: 'percent', value: '10', reason: 'Regular customer' }
    const discounted = await call('POST', `/orders/${order.id}/discounts`, ownerA, body, { 'x-branch-id': a.branchId })
    expect(discounted.status).toBe(201)
    expect(discounted.body.after_discount).toBe('135.00')
    const quote = await call('GET', `/orders/${order.id}/quote`, cashierA)
    expect(quote.body.bill.taxableTotal).toBe('135.00')
  })
  it('can still be billed', async () => {
    const order = await confirmed()
    const billed = await call('POST', `/orders/${order.id}/finalize`, cashierA, { version: order.version, invoices: [{ id: crypto.randomUUID() }] })
    expect(billed.status).toBe(201)
  })
  it('stops a cashier cancelling a confirmed order', async () => {
    const order = await confirmed()
    expect((await call('POST', `/orders/${order.id}/cancel`, cashierA, { version: order.version, reason: 'Left' })).status).toBe(403)
  })
})

describe('POS order details', () => {
  it('saves guests, delivery address and order type', async () => {
    const order = (await open(cashierA, { orderType: 'delivery', deliveryAddress: '4 Lake Road', guestCount: 2 })).body
    expect(order.delivery_address).toBe('4 Lake Road')
    expect(order.guest_count).toBe(2)
    const changed = await call('PATCH', `/orders/${order.id}`, cashierA, { version: order.version, orderType: 'aggregator', aggregator: 'Swiggy', guestCount: null })
    expect(changed.body.order_type).toBe('aggregator')
    expect(changed.body.aggregator).toBe('Swiggy')
    expect(changed.body.guest_count).toBeNull()
    const back = await call('PATCH', `/orders/${order.id}`, cashierA, { version: changed.body.version, orderType: 'takeaway' })
    expect(back.body.order_type).toBe('takeaway')
    expect(back.body.aggregator).toBeNull()
  })
  it('needs an app name for a delivery app order', async () => {
    const order = (await open()).body
    expect((await call('PATCH', `/orders/${order.id}`, cashierA, { version: order.version, orderType: 'aggregator' })).status).toBe(422)
  })
  it('locks the order type once confirmed', async () => {
    const added = (await addItem((await open()).body.id)).body
    const done = (await call('POST', `/orders/${added.id}/confirm`, cashierA, { version: added.version })).body
    expect((await call('PATCH', `/orders/${done.id}`, cashierA, { version: done.version, orderType: 'takeaway' })).status).toBe(409)
  })
  it('adds and removes a customer', async () => {
    const order = (await open()).body
    const customer = (await call('POST', '/customers', cashierA, { name: 'Meera', phone: '9812345670' })).body
    const added = await call('PATCH', `/orders/${order.id}`, cashierA, { version: order.version, customerId: customer.id })
    expect(added.body.customer_phone).toBe('9812345670')
    const removed = await call('PATCH', `/orders/${order.id}`, cashierA, { version: added.body.version, customerId: null })
    expect(removed.body.customer_id).toBeNull()
  })
})

describe('holding orders', () => {
  it('moves an order off the running list and back', async () => {
    const order = (await open()).body
    const held = await call('POST', `/orders/${order.id}/hold`, cashierA, { version: order.version, held: true })
    expect(held.body.held_at).toBeTruthy()
    const running = (await call('GET', '/orders?status=open&held=false', cashierA)).body.items
    expect(running.some((item: any) => item.id === order.id)).toBe(false)
    const parked = (await call('GET', '/orders?status=open&held=true', cashierA)).body.items
    expect(parked.some((item: any) => item.id === order.id)).toBe(true)
    const resumed = await call('POST', `/orders/${order.id}/hold`, cashierA, { version: held.body.version, held: false })
    expect(resumed.body.held_at).toBeNull()
  })
  it('refuses a stale hold', async () => {
    const order = (await open()).body
    await call('POST', `/orders/${order.id}/hold`, cashierA, { version: order.version, held: true })
    expect((await call('POST', `/orders/${order.id}/hold`, cashierA, { version: order.version, held: false })).status).toBe(409)
  })
})

describe('the orders list', () => {
  it('finds orders by number, customer and bill number', async () => {
    const customer = (await call('POST', '/customers', cashierA, { name: 'Findable Person', phone: '9811122233' })).body
    const added = (await addItem((await open()).body.id)).body
    const linked = (await call('PATCH', `/orders/${added.id}`, cashierA, { version: added.version, customerId: customer.id })).body
    const invoice = crypto.randomUUID()
    await call('POST', `/orders/${linked.id}/finalize`, cashierA, { version: linked.version, invoices: [{ id: invoice }] })
    const number = (await call('GET', `/invoices/${invoice}`, cashierA)).body.number
    for (const q of [`#${linked.display_number}`, 'findable', '9811122233', number]) {
      const found = (await call('GET', `/orders?q=${encodeURIComponent(q)}`, cashierA)).body.items
      expect(found.some((item: any) => item.id === linked.id)).toBe(true)
    }
    const row = (await call('GET', `/orders?q=findable`, cashierA)).body.items.find((item: any) => item.id === linked.id)
    expect(row.amount).toBe('150.00')
    expect(row.outstanding).toBe('150.00')
    expect(row.bill_numbers).toEqual([number])
  })
  it('treats search symbols as plain text', async () => {
    expect((await call('GET', `/orders?q=${encodeURIComponent("%' or 1=1--")}`, cashierA)).body.items).toHaveLength(0)
  })
  it('filters by type', async () => {
    await open(cashierA, { orderType: 'takeaway' })
    const items = (await call('GET', '/orders?status=open&type=takeaway', cashierA)).body.items
    expect(items.length).toBeGreaterThan(0)
    expect(items.every((item: any) => item.order_type === 'takeaway')).toBe(true)
  })
  it('counts orders per tab, and never another business', async () => {
    const counts = (await call('GET', '/orders/counts', cashierA)).body
    expect(counts.running).toBeGreaterThan(0)
    expect((await call('GET', '/orders/counts', ownerB)).body).toEqual({ running: 0, held: 0, completed: 0, cancelled: 0 })
  })
  it('limits exports to people who can read reports', async () => {
    expect((await call('GET', '/orders/export?status=open', cashierA)).status).toBe(403)
    expect((await call('GET', '/orders/export?status=open', ownerA)).body.items.length).toBeGreaterThan(0)
  })
  it('shows a timeline, hiding money from the kitchen', async () => {
    const added = (await addItem((await open()).body.id)).body
    const done = (await call('POST', `/orders/${added.id}/confirm`, cashierA, { version: added.version })).body
    await call('POST', `/orders/${done.id}/finalize`, cashierA, { version: done.version, invoices: [{ id: crypto.randomUUID() }] })
    const cashier = (await call('GET', `/orders/${done.id}/timeline`, cashierA)).body.items.map((item: any) => item.label)
    expect(cashier[0]).toBe('Order started')
    expect(cashier).toContain('Order confirmed')
    expect(cashier.some((label: string) => label.startsWith('Bill '))).toBe(true)
    const kitchen = (await call('GET', `/orders/${done.id}/timeline`, kitchenA)).body.items.map((item: any) => item.label)
    expect(kitchen.some((label: string) => label.startsWith('Bill '))).toBe(false)
  })
  it('hides another business’s timeline', async () => {
    const order = (await open()).body
    expect((await call('GET', `/orders/${order.id}/timeline`, ownerB)).status).toBe(404)
  })
})

describe('search, alerts and POS settings', () => {
  it('searches only within this business and role', async () => {
    const found = (await call('GET', '/search?q=Dosa', ownerA)).body
    expect(found.menu[0].name).toBe('Dosa')
    expect((await call('GET', '/search?q=Dosa', ownerB)).body.menu).toHaveLength(0)
    const kitchen = (await call('GET', '/search?q=Dosa', kitchenA)).body
    expect(kitchen.customers).toBeUndefined()
    expect(kitchen.bills).toBeUndefined()
  })
  it('refuses a one-letter search', async () => {
    expect((await call('GET', '/search?q=a', ownerA)).status).toBe(422)
  })
  it('reports live counts, limited by role', async () => {
    const owner = (await call('GET', '/alerts', ownerA)).body
    expect(owner.runningOrders).toBeGreaterThan(0)
    const kitchen = (await call('GET', '/alerts', kitchenA)).body
    expect(kitchen.unpaidBills).toBe(0)
    expect(kitchen.paymentsToVerify).toBe(0)
  })
  it('gives every role the POS settings, and only owners can change them', async () => {
    const settings = (await call('GET', '/pos-settings', kitchenA)).body
    expect(settings.discount_presets).toEqual([5, 10, 15])
    expect(settings.cashier_discount_limit).toBe('20.00')
    expect((await call('PATCH', '/business', cashierA, { upiId: 'cafe@okbank' })).status).toBe(403)
    expect((await call('PATCH', '/business', ownerA, { upiId: 'not a upi id' })).status).toBe(422)
    expect((await call('PATCH', '/business', ownerA, { fssaiNumber: '123' })).status).toBe(422)
  })
  it('copies bill settings onto the bill, so later changes leave it alone', async () => {
    await call('PATCH', '/business', ownerA, { upiId: 'cafe@okbank', fssaiNumber: '12345678901234', billFooter: 'Thank you', billFormat: 'a4', discountPresets: [10, 20], cashierDiscountLimit: 0 })
    const saved = (await call('GET', '/pos-settings', cashierA)).body
    expect(saved).toMatchObject({ upi_id: 'cafe@okbank', bill_format: 'a4', discount_presets: [10, 20], cashier_discount_limit: '0.00' })

    const added = (await addItem((await open()).body.id)).body
    expect((await call('POST', `/orders/${added.id}/discounts`, cashierA, { id: crypto.randomUUID(), kind: 'percent', value: '5' })).status).toBe(403)
    const invoice = crypto.randomUUID()
    await call('POST', `/orders/${added.id}/finalize`, cashierA, { version: added.version, invoices: [{ id: invoice }] })

    await call('PATCH', '/business', ownerA, { upiId: '', fssaiNumber: '', billFooter: 'Changed', billFormat: 'thermal', discountPresets: [5, 10, 15], cashierDiscountLimit: 20 })
    const bill = (await call('GET', `/invoices/${invoice}`, cashierA)).body
    expect(bill.seller_snapshot.fssai).toBe('12345678901234')
    expect(bill.seller_snapshot.footer).toBe('Thank you')
    expect((await call('GET', '/pos-settings', cashierA)).body.upi_id).toBeNull()
  })
})

describe('deleting empty orders', () => {
  it('needs no reason when nothing was added', async () => {
    const order = await open()
    const deleted = await call('POST', `/orders/${order.body.id}/cancel`, cashierA, { version: order.body.version })
    expect(deleted.status).toBe(200)
    expect(deleted.body.status).toBe('cancelled')
    expect((await call('GET', '/orders', cashierA)).body.items.every((item: any) => item.id !== order.body.id)).toBe(true)
  })
  it('still needs a reason once there are items', async () => {
    const order = (await addItem((await open()).body.id)).body
    const result = await call('POST', `/orders/${order.id}/cancel`, ownerA, { version: order.version }, { 'x-branch-id': a.branchId })
    expect(result.status).toBe(422)
    expect(result.body.code).toBe('reason_required')
  })
})

describe('permissions and isolation', () => {
  it('lets the kitchen read but not change orders', async () => {
    const order = await open()
    expect((await call('GET', `/orders/${order.body.id}`, kitchenA)).status).toBe(200)
    expect((await open(kitchenA)).status).toBe(403)
    expect((await addItem(order.body.id, kitchenA)).status).toBe(403)
  })
  it('hides orders from other branches', async () => {
    const order = await open()
    expect((await call('GET', `/orders/${order.body.id}`, cashierSecond)).status).toBe(404)
    expect((await addItem(order.body.id, cashierSecond)).status).toBe(404)
    const list = await call('GET', '/orders', cashierSecond)
    expect(list.body.items.every((o: any) => o.branch_id === second)).toBe(true)
  })
  it('hides orders from other businesses', async () => {
    const order = await open()
    expect((await call('GET', `/orders/${order.body.id}`, ownerB)).status).toBe(404)
    expect((await addItem(order.body.id, ownerB)).status).toBe(404)
    expect((await call('POST', `/orders/${order.body.id}/cancel`, ownerB, { version: 1, reason: 'Hacked' })).status).toBe(404)
    expect((await call('GET', '/orders', ownerB)).body.items).toEqual([])
  })
  it('cannot add another business’s menu item', async () => {
    const order = await open(ownerB)
    expect((await addItem(order.body.id, ownerB)).status).toBe(404)
  })
})
