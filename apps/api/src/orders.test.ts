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
    for (const table of ['audit_log', 'idempotency_keys', 'order_discounts', 'order_item_addons', 'order_status_history', 'order_items', 'orders',
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
  it('stops a cashier giving a discount', async () => {
    const order = await open()
    await addItem(order.body.id)
    const body = { id: crypto.randomUUID(), kind: 'percent', value: '10', reason: 'Regular customer' }
    expect((await call('POST', `/orders/${order.body.id}/discounts`, cashierA, body)).status).toBe(403)
    const owner = await call('POST', `/orders/${order.body.id}/discounts`, ownerA, body, { 'x-branch-id': a.branchId })
    expect(owner.body.discount).toBe('15.00')
    expect(owner.body.after_discount).toBe('135.00')
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
