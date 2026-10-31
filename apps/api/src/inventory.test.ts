// Customer, expense and stock tests against the real Supabase project. Removes everything it creates.
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { provisionBusiness } from './modules/tenancy/provision.js'
import { closeDb } from './platform/db.js'
import { createSession, supabaseAdmin } from './platform/supabase.js'
import { request } from './testing.js'

const run = crypto.randomUUID().slice(0, 8)
const emailFor = (label: string) => `stock-${label}-${run}@staff.isoform.invalid`
const business = (label: string) => ({
  displayName: `Stock ${label}`, legalName: 'Legal', scheme: 'unregistered' as const, stateCode: '33', address: 'A',
  branchName: 'Main', branchCode: 'MN', ownerName: 'Owner', ownerEmail: emailFor(label),
})

let a: Awaited<ReturnType<typeof provisionBusiness>>
let b: Awaited<ReturnType<typeof provisionBusiness>>
let owner: string
let ownerB: string
let cashier: string
let kitchenStaff: string
let waiter: string
let product: string
let variant: string
let session: string
const users: string[] = []
let db: pg.Client
let nameCount = 0

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

async function staff(role: string) {
  const made = await call('POST', '/staff', owner, { displayName: `Staff ${role}`, role, pin: '4821', branchIds: [a.branchId] })
  const { rows: [row] } = await db.query(`select user_id from app.memberships where id = $1`, [made.body.id])
  users.push(row.user_id)
  const { data } = await supabaseAdmin.auth.admin.getUserById(row.user_id)
  return (await createSession(data.user!.email!)).access_token
}

const today = () => new Date().toISOString().slice(0, 10)
const newItem = async (extra: object = {}) => {
  nameCount += 1
  return (await call('POST', '/inventory/items', owner, { name: `Item ${nameCount}`, unit: 'kg', cost: '100', minStock: '2', ...extra })).body.id as string
}
const stockIn = (id: string, quantity: string, extra: object = {}) => call('POST', `/inventory/items/${id}/moves`, owner, { kind: 'in', quantity, ...extra })
const level = async (id: string) => (await call('GET', '/inventory', owner)).body.items.find((row: any) => row.id === id)
const expense = (extra: object = {}) => call('POST', '/expenses', owner, {
  id: crypto.randomUUID(), name: 'Rent', category: 'rent', amount: '1000', expenseDate: today(), method: 'upi', ...extra,
})

/** A billed order, with the given quantity of the test product. */
async function sale(quantity = '1', customerId?: string) {
  const order = (await call('POST', '/orders', cashier, { id: crypto.randomUUID(), orderType: 'takeaway' })).body
  const added = (await call('POST', `/orders/${order.id}/items`, cashier, { id: crypto.randomUUID(), variantId: variant, quantity })).body
  const linked = customerId ? (await call('PATCH', `/orders/${order.id}`, cashier, { version: added.version, customerId })).body : added
  const invoice = crypto.randomUUID()
  await call('POST', `/orders/${order.id}/finalize`, cashier, { version: linked.version, invoices: [{ id: invoice }] })
  return { orderId: order.id as string, invoice }
}

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
  waiter = await staff('waiter')

  const rate = (await call('POST', '/tax-rates', owner, { name: 'None', cgstRate: '0', sgstRate: '0' })).body.id
  const category = (await call('POST', '/categories', owner, { name: 'Food' })).body.id
  product = (await call('POST', '/products', owner, { name: 'Dosa', categoryId: category, taxRateId: rate, variants: [{ name: 'Regular', price: '100' }] })).body.id
  variant = (await call('GET', '/menu', owner)).body.products[0].variants[0].id
  const register = (await call('GET', '/registers', owner)).body.items[0].id
  session = (await call('POST', '/cash-sessions', cashier, { id: crypto.randomUUID(), registerId: register, openingAmount: '1000' })).body.id
})

afterAll(async () => {
  for (const tenant of [a.tenantId, b.tenantId]) {
    for (const table of ['audit_log', 'idempotency_keys', 'stock_moves', 'stock_levels', 'recipe_lines', 'stock_items', 'suppliers', 'expenses', 'cash_movements',
      'financial_status_history', 'refunds', 'payment_allocations', 'payments', 'credit_note_lines', 'credit_notes', 'invoice_lines', 'invoices', 'invoice_series',
      'order_discounts', 'order_item_addons', 'order_status_history', 'kitchen_ticket_items', 'order_items', 'kitchen_tickets', 'orders', 'customers',
      'branch_variant_overrides', 'product_addons', 'addons', 'product_variants', 'products', 'categories', 'tax_rates', 'cash_sessions', 'branch_memberships',
      'registers', 'payment_methods', 'memberships', 'branches', 'tax_registrations']) {
      await db.query(`delete from app.${table} where tenant_id = $1`, [tenant])
    }
    await db.query(`delete from app.tenants where id = $1`, [tenant])
  }
  for (const id of users) await supabaseAdmin.auth.admin.deleteUser(id)
  await db.end()
  await closeDb()
})

describe('customers', () => {
  const add = async (phone: string, name = 'Meera') => (await call('POST', '/customers', cashier, { name, phone })).body.id as string

  it('saves a profile with address and allergy notes', async () => {
    const id = await add('9800000001')
    const saved = await call('PATCH', `/customers/${id}`, cashier, { email: 'meera@example.com', address: '4 Lake Road', notes: 'Allergic to nuts' })
    expect(saved.status).toBe(200)
    expect((await call('GET', `/customers/${id}`, cashier)).body).toMatchObject({ address: '4 Lake Road', notes: 'Allergic to nuts' })
  })
  it('shows the allergy note on the order', async () => {
    const id = await add('9800000002')
    await call('PATCH', `/customers/${id}`, cashier, { notes: 'No onion' })
    const order = (await call('POST', '/orders', cashier, { id: crypto.randomUUID(), orderType: 'takeaway' })).body
    const linked = await call('PATCH', `/orders/${order.id}`, cashier, { version: order.version, customerId: id })
    expect(linked.body.customer_notes).toBe('No onion')
  })
  it('works out spend, visits and usual items from bills', async () => {
    const id = await add('9800000003')
    await sale('2', id)
    await sale('1', id)
    const profile = (await call('GET', `/customers/${id}`, cashier)).body
    expect(profile).toMatchObject({ orders: 2, spent: '300.00' })
    expect(profile.history).toHaveLength(2)
    expect(profile.usual[0].name).toBe('Dosa')
    expect(Number(profile.usual[0].quantity)).toBe(3)
  })
  it('takes credit notes off spend', async () => {
    const id = await add('9800000004')
    const { invoice } = await sale('1', id)
    await call('POST', `/invoices/${invoice}/credit-notes`, owner, { id: crypto.randomUUID(), kind: 'cancellation', reason: 'Wrong order' })
    expect((await call('GET', `/customers/${id}`, cashier)).body.spent).toBe('0.00')
  })
  it('sorts by top spender and searches', async () => {
    const top = await add('9800000005', 'Topspender')
    await sale('9', top)
    const rows = (await call('GET', '/customers?sort=spend', cashier)).body.items
    expect(rows[0].id).toBe(top)
    expect((await call('GET', '/customers?search=topspend', cashier)).body.items).toHaveLength(1)
  })
  it('summarises repeat customers', async () => {
    const summary = (await call('GET', '/customers/summary', cashier)).body
    expect(summary.total).toBeGreaterThan(0)
    expect(summary.repeat).toBeGreaterThan(0)
    expect(Number(summary.lifetime)).toBeGreaterThan(0)
  })
  it('refuses a phone number already in use', async () => {
    const first = await add('9800000006')
    await add('9800000007')
    expect((await call('PATCH', `/customers/${first}`, cashier, { phone: '9800000007' })).status).toBe(409)
  })
  it('keeps customers from other businesses and frontline roles', async () => {
    const id = await add('9800000008')
    expect((await call('GET', `/customers/${id}`, ownerB)).status).toBe(404)
    expect((await call('GET', '/customers', waiter)).status).toBe(403)
  })
})

describe('expenses', () => {
  it('lets managers record expenses, not cashiers', async () => {
    expect((await call('POST', '/expenses', cashier, { id: crypto.randomUUID(), name: 'No', category: 'rent', amount: '5', expenseDate: today(), method: 'cash' })).status).toBe(403)
    expect((await call('GET', '/expenses', cashier)).status).toBe(403)
    const made = await expense({ name: 'Electricity bill', category: 'electricity', reference: 'EB-1' })
    expect(made.status).toBe(201)
    expect(made.body).toMatchObject({ category: 'electricity', amount: '1000.00', status: 'active' })
  })
  it('filters by category and search', async () => {
    await expense({ name: 'Poster printing', category: 'marketing' })
    const rows = (await call('GET', '/expenses?category=marketing', owner)).body.items
    expect(rows.every((row: any) => row.category === 'marketing')).toBe(true)
    expect((await call('GET', '/expenses?q=poster', owner)).body.items).toHaveLength(1)
  })
  it('totals by category and compares with sales', async () => {
    const summary = (await call('GET', `/expenses/summary?from=${today()}&to=${today()}`, owner)).body
    expect(Number(summary.total)).toBeGreaterThan(0)
    expect(summary.byCategory.length).toBeGreaterThan(0)
    expect(Number(summary.netSales)).toBeGreaterThan(0)
  })
  it('takes drawer cash out of the session', async () => {
    const before = Number((await call('GET', `/cash-sessions/${session}`, owner)).body.running_expected)
    const made = await expense({ name: 'Milk', category: 'ingredients', amount: '200', method: 'cash', fromDrawer: true })
    expect(made.body.from_drawer).toBe(true)
    expect(Number((await call('GET', `/cash-sessions/${session}`, owner)).body.running_expected)).toBe(before - 200)
  })
  it('puts drawer cash back when voided, and stops counting it', async () => {
    const made = (await expense({ name: 'Mistake', category: 'other', amount: '50', method: 'cash', fromDrawer: true })).body
    const before = Number((await call('GET', `/cash-sessions/${session}`, owner)).body.running_expected)
    const total = Number((await call('GET', '/expenses/summary', owner)).body.total)
    const voided = await call('POST', `/expenses/${made.id}/void`, owner, { reason: 'Typed twice' })
    expect(voided.body.status).toBe('voided')
    expect(Number((await call('GET', `/cash-sessions/${session}`, owner)).body.running_expected)).toBe(before + 50)
    expect(Number((await call('GET', '/expenses/summary', owner)).body.total)).toBe(total - 50)
    expect((await call('POST', `/expenses/${made.id}/void`, owner, { reason: 'Again' })).status).toBe(409)
  })
  it('refuses a card expense from the drawer', async () => {
    expect((await expense({ method: 'card', fromDrawer: true })).status).toBe(422)
  })
  it('refuses a receipt path from another expense', async () => {
    const made = (await expense()).body
    const wrong = await call('PATCH', `/expenses/${made.id}`, owner, { receiptPath: `${b.tenantId}/${made.id}/x.jpg` })
    expect(wrong.body.code).toBe('invalid_receipt')
  })
  it('gives a private upload slot for a receipt', async () => {
    const made = (await expense()).body
    const slot = await call('POST', `/expenses/${made.id}/receipt`, owner, {})
    expect(slot.status).toBe(200)
    expect(slot.body.path.startsWith(`${a.tenantId}/${made.id}/`)).toBe(true)
    expect((await call('PATCH', `/expenses/${made.id}`, owner, { receiptPath: slot.body.path })).body.has_receipt).toBe(true)
  })
  it('hides expenses from another business', async () => {
    const made = (await expense()).body
    expect((await call('PATCH', `/expenses/${made.id}`, ownerB, { name: 'Taken' })).status).toBe(404)
    expect((await call('GET', '/expenses', ownerB)).body.items).toHaveLength(0)
  })
})

describe('stock', () => {
  it('moves stock in and out, and values it', async () => {
    const id = await newItem()
    await stockIn(id, '10', { unitCost: '150' })
    await call('POST', `/inventory/items/${id}/moves`, owner, { kind: 'out', quantity: '3', reason: 'Spoiled' })
    expect(await level(id)).toMatchObject({ quantity: '7.000', cost: '150.00' })
    expect(Number((await call('GET', '/inventory', owner)).body.totals.value)).toBeGreaterThanOrEqual(1050)
  })
  it('needs a reason to take stock out', async () => {
    const id = await newItem()
    expect((await call('POST', `/inventory/items/${id}/moves`, owner, { kind: 'out', quantity: '1' })).status).toBe(422)
  })
  it('sets the figure from a count', async () => {
    const id = await newItem()
    await stockIn(id, '10')
    const counted = await call('POST', `/inventory/items/${id}/moves`, owner, { kind: 'count', quantity: '8.5' })
    expect(counted.body.quantity).toBe('8.500')
    const same = await call('POST', `/inventory/items/${id}/moves`, owner, { kind: 'count', quantity: '8.5' })
    expect(same.body.unchanged).toBe(true)
  })
  it('keeps a history of every change', async () => {
    const id = await newItem()
    await stockIn(id, '5')
    const moves = (await call('GET', `/inventory/moves?itemId=${id}`, owner)).body.items
    expect(moves[0]).toMatchObject({ kind: 'in', quantity: '5.000' })
    expect(moves[0].created_by_name).toBeTruthy()
  })
  it('refuses to edit the history', async () => {
    const id = await newItem()
    await stockIn(id, '5')
    const { rows } = await db.query(`select has_table_privilege('app_user', 'app.stock_moves', 'update') as can_edit,
      has_table_privilege('app_user', 'app.stock_moves', 'delete') as can_delete`)
    expect(rows[0]).toEqual({ can_edit: false, can_delete: false })
  })
  it('deducts recipes when a bill is issued', async () => {
    const beans = await newItem()
    const milk = await newItem({ unit: 'L' })
    await stockIn(beans, '1')
    await stockIn(milk, '5')
    await call('PUT', `/products/${product}/recipe`, owner, { lines: [{ stockItemId: beans, quantity: '0.018' }, { stockItemId: milk, quantity: '0.2' }] })
    expect((await call('GET', `/products/${product}/recipe`, cashier)).body.lines).toHaveLength(2)
    await sale('2')
    expect((await level(beans)).quantity).toBe('0.964')
    expect((await level(milk)).quantity).toBe('4.600')
    const moves = (await call('GET', `/inventory/moves?itemId=${beans}`, owner)).body.items
    expect(moves[0].kind).toBe('sale')
    await call('PUT', `/products/${product}/recipe`, owner, { lines: [] })
  })
  it('never refuses a sale for low stock', async () => {
    const id = await newItem()
    await call('PUT', `/products/${product}/recipe`, owner, { lines: [{ stockItemId: id, quantity: '1' }] })
    const { invoice } = await sale('3')
    expect((await call('GET', `/invoices/${invoice}`, cashier)).status).toBe(200)
    expect((await level(id)).quantity).toBe('-3.000')
    await call('PUT', `/products/${product}/recipe`, owner, { lines: [] })
  })
  it('records a purchase as an expense', async () => {
    const id = await newItem({ name: 'Coffee beans' })
    const expenseId = crypto.randomUUID()
    await stockIn(id, '4', { unitCost: '500', expense: { id: expenseId, method: 'upi', expenseDate: today() } })
    const rows = (await call('GET', '/expenses?category=ingredients', owner)).body.items
    expect(rows.find((row: any) => row.id === expenseId)).toMatchObject({ name: 'Coffee beans purchase', amount: '2000.00' })
  })
  it('needs a cost before recording a purchase', async () => {
    const id = await newItem({ cost: '0' })
    const made = await stockIn(id, '4', { expense: { id: crypto.randomUUID(), method: 'upi', expenseDate: today() } })
    expect(made.body.code).toBe('cost_required')
    expect((await level(id)).quantity).toBe('0')
  })
  it('keeps each branch’s stock separate', async () => {
    const id = await newItem()
    await stockIn(id, '6')
    const tax = (await call('GET', '/tax-registrations', owner)).body.items[0].id
    const second = (await call('POST', '/branches', owner, { name: 'Second', code: 'SC', taxRegistrationId: tax })).body.id
    const branch = { 'x-branch-id': second }
    const there = (await call('GET', '/inventory', owner, undefined, branch)).body.items.find((row: any) => row.id === id)
    expect(there.quantity).toBe('0')
    await call('POST', `/inventory/items/${id}/moves`, owner, { kind: 'in', quantity: '1' }, branch)
    expect((await call('GET', '/inventory', owner, undefined, { 'x-branch-id': a.branchId })).body.items.find((row: any) => row.id === id).quantity).toBe('6.000')
    await db.query(`update app.branches set is_active = false where id = $1`, [second])
  })
  it('limits who can see and change stock', async () => {
    const id = await newItem()
    expect((await call('GET', '/inventory', cashier)).status).toBe(403)
    expect((await call('GET', '/inventory', kitchenStaff)).status).toBe(200)
    expect((await call('POST', `/inventory/items/${id}/moves`, kitchenStaff, { kind: 'in', quantity: '1' })).status).toBe(403)
    expect((await call('POST', '/inventory/items', cashier, { name: 'Nope', unit: 'kg' })).status).toBe(403)
  })
  it('hides stock from another business', async () => {
    const id = await newItem()
    expect((await call('GET', '/inventory', ownerB)).body.items).toHaveLength(0)
    expect((await call('POST', `/inventory/items/${id}/moves`, ownerB, { kind: 'in', quantity: '1' })).status).toBe(404)
  })
  it('refuses a recipe using another business’s stock', async () => {
    const id = await newItem()
    const rate = (await call('POST', '/tax-rates', ownerB, { name: 'None', cgstRate: '0', sgstRate: '0' })).body.id
    const category = (await call('POST', '/categories', ownerB, { name: 'Food' })).body.id
    const other = (await call('POST', '/products', ownerB, { name: 'Other', categoryId: category, taxRateId: rate, variants: [{ name: 'Regular', price: '1' }] })).body.id
    expect((await call('PUT', `/products/${other}/recipe`, ownerB, { lines: [{ stockItemId: id, quantity: '1' }] })).status).toBe(422)
  })
  it('flags low stock and finds it in search', async () => {
    const id = await newItem({ name: 'Findable beans', minStock: '5' })
    await stockIn(id, '1')
    expect((await call('GET', '/alerts', owner)).body.lowStock).toBeGreaterThan(0)
    expect((await call('GET', '/alerts', cashier)).body.lowStock).toBe(0)
    expect((await call('GET', '/search?q=findable', owner)).body.stock[0].id).toBe(id)
  })
  it('removes a retired ingredient from recipes', async () => {
    const id = await newItem()
    await call('PUT', `/products/${product}/recipe`, owner, { lines: [{ stockItemId: id, quantity: '1' }] })
    await call('PATCH', `/inventory/items/${id}`, owner, { isActive: false })
    expect((await call('GET', `/products/${product}/recipe`, owner)).body.lines).toHaveLength(0)
  })
  it('keeps suppliers', async () => {
    const supplier = (await call('POST', '/suppliers', owner, { name: 'Green Valley', phone: '9876543210' })).body.id
    await newItem({ supplierId: supplier })
    const rows = (await call('GET', '/suppliers', owner)).body.items
    expect(rows.find((row: any) => row.id === supplier).item_count).toBe(1)
  })
})
