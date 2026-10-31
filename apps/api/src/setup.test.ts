// Dashboard, report, menu, permission, settings, sample data and backup tests against the real Supabase project.
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { provisionBusiness } from './modules/tenancy/provision.js'
import { closeDb } from './platform/db.js'
import { createSession, supabaseAdmin } from './platform/supabase.js'
import { request } from './testing.js'

const run = crypto.randomUUID().slice(0, 8)
const emailFor = (label: string) => `setup-${label}-${run}@staff.isoform.invalid`
const business = (label: string) => ({
  displayName: `Setup ${label}`, legalName: 'Legal', scheme: 'unregistered' as const, stateCode: '33', address: 'A',
  branchName: 'Main', branchCode: 'MN', ownerName: 'Owner', ownerEmail: emailFor(label),
})

let a: Awaited<ReturnType<typeof provisionBusiness>>
let b: Awaited<ReturnType<typeof provisionBusiness>>
let fresh: Awaited<ReturnType<typeof provisionBusiness>>
let owner: string
let ownerB: string
let ownerFresh: string
let cashier: string
let waiter: string
let manager: string
let admin: string
let product: string
let slowProduct: string
let variant: string
let category: string
let rate: string
const users: string[] = []
let db: pg.Client

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

/** Email roles send a real invitation, so this makes a PIN account and changes its role directly. */
async function staff(role: string, makeRole?: string) {
  const made = await call('POST', '/staff', owner, { displayName: `Staff ${makeRole ?? role}`, role, pin: '4821', branchIds: [a.branchId] })
  const { rows: [row] } = await db.query(`select user_id from app.memberships where id = $1`, [made.body.id])
  users.push(row.user_id)
  if (makeRole) await db.query(`update app.memberships set role = $2 where id = $1`, [made.body.id, makeRole])
  const { data } = await supabaseAdmin.auth.admin.getUserById(row.user_id)
  return (await createSession(data.user!.email!)).access_token
}

const today = () => new Date().toISOString().slice(0, 10)

async function sale() {
  const order = (await call('POST', '/orders', cashier, { id: crypto.randomUUID(), orderType: 'takeaway' })).body
  const added = (await call('POST', `/orders/${order.id}/items`, cashier, { id: crypto.randomUUID(), variantId: variant, quantity: '2' })).body
  await call('POST', `/orders/${order.id}/finalize`, cashier, { version: added.version, invoices: [{ id: crypto.randomUUID() }] })
  return order.id as string
}

beforeAll(async () => {
  db = new pg.Client({ connectionString: process.env.DATABASE_URL_DIRECT, ssl: { rejectUnauthorized: false } })
  await db.connect()
  a = await provisionBusiness(business('a'))
  b = await provisionBusiness(business('b'))
  fresh = await provisionBusiness(business('c'))
  users.push(a.userId, b.userId, fresh.userId)
  owner = (await createSession(emailFor('a'))).access_token
  ownerB = (await createSession(emailFor('b'))).access_token
  ownerFresh = (await createSession(emailFor('c'))).access_token
  cashier = await staff('cashier')
  waiter = await staff('waiter')
  manager = await staff('cashier', 'manager')
  admin = await staff('cashier', 'admin')

  rate = (await call('POST', '/tax-rates', owner, { name: 'None', cgstRate: '0', sgstRate: '0' })).body.id
  category = (await call('POST', '/categories', owner, { name: 'Food' })).body.id
  product = (await call('POST', '/products', owner, { name: 'Dosa', categoryId: category, taxRateId: rate, variants: [{ name: 'Regular', price: '100' }] })).body.id
  slowProduct = (await call('POST', '/products', owner, { name: 'Upma', categoryId: category, taxRateId: rate, variants: [{ name: 'Regular', price: '60' }] })).body.id
  const menu = (await call('GET', '/menu', owner)).body.products
  variant = menu.find((row: any) => row.id === product).variants[0].id
  await sale()
})

afterAll(async () => {
  for (const tenant of [a.tenantId, b.tenantId, fresh.tenantId]) {
    for (const table of ['audit_log', 'idempotency_keys', 'role_permissions', 'stock_moves', 'stock_levels', 'recipe_lines', 'stock_items', 'suppliers', 'expenses', 'cash_movements',
      'financial_status_history', 'refunds', 'payment_allocations', 'payments', 'credit_note_lines', 'credit_notes', 'invoice_lines', 'invoices', 'invoice_series',
      'order_discounts', 'order_item_addons', 'order_status_history', 'kitchen_ticket_items', 'order_items', 'kitchen_tickets', 'orders', 'dining_tables', 'floor_areas', 'customers',
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

describe('dashboard and reports', () => {
  it('shows today against yesterday, with the running extras', async () => {
    const { status, body } = await call('GET', '/dashboard?range=today', owner)
    expect(status).toBe(200)
    expect(body.period).toMatchObject({ orders: 1, net_sales: '200.00', average_order: '200.00' })
    expect(body.previous).toMatchObject({ orders: 0, net_sales: '0.00' })
    expect(body.trend.reduce((sum: number, row: any) => sum + Number(row.sales), 0)).toBe(200)
    expect(body.orderTypes).toMatchObject([{ order_type: 'takeaway', orders: 1, sales: '200.00' }])
    expect(body.recentOrders.length).toBeGreaterThan(0)
    expect(body.kitchen).toBeDefined()
    expect(body.expenses).toMatchObject({ total: '0.00' })
  })
  it('covers this week and this month', async () => {
    for (const range of ['week', 'month']) {
      const { status, body } = await call('GET', `/dashboard?range=${range}`, owner)
      expect(status).toBe(200)
      expect(body.period.net_sales).toBe('200.00')
      expect(body.trend.length).toBeGreaterThan(0)
    }
  })
  it('keeps the dashboard from cashiers', async () => {
    expect((await call('GET', '/dashboard', cashier)).status).toBe(403)
  })
  it('compares a range with the same length before it', async () => {
    const { body } = await call('GET', `/reports/sales?from=${today()}&to=${today()}`, owner)
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
    expect(body.previous).toMatchObject({ from: yesterday, to: yesterday })
    expect(body.hours.reduce((sum: number, row: any) => sum + row.orders, 0)).toBe(1)
  })
  it('lists best sellers, slow movers and categories', async () => {
    const { body } = await call('GET', `/reports/products?from=${today()}`, owner)
    expect(body.best[0]).toMatchObject({ name: 'Dosa', sales: '200.00' })
    expect(Number(body.best[0].quantity)).toBe(2)
    expect(body.slow[0]).toMatchObject({ name: 'Upma', sales: '0.00' })
    expect(body.byCategory).toMatchObject([{ category: 'Food', sales: '200.00' }])
  })
  it('takes expenses off sales and leaves voided ones out', async () => {
    const added = await call('POST', '/expenses', owner, { id: crypto.randomUUID(), name: 'Rent', category: 'rent', amount: '50', expenseDate: today(), method: 'upi' })
    const voided = await call('POST', '/expenses', owner, { id: crypto.randomUUID(), name: 'Oops', category: 'other', amount: '30', expenseDate: today(), method: 'upi' })
    await call('POST', `/expenses/${voided.body.id}/void`, owner, { reason: 'Typed twice' })
    const { body } = await call('GET', `/reports/profit?from=${today()}`, owner)
    expect(added.status).toBe(201)
    expect(body).toMatchObject({ netSales: '200.00', expenses: '50.00', salesLessExpenses: '150.00' })
    expect(body.byCategory).toMatchObject([{ category: 'rent', total: '50.00' }])
  })
  it('shows what each person did', async () => {
    const { body } = await call('GET', `/reports/staff?from=${today()}`, owner)
    expect(body.items).toMatchObject([{ display_name: 'Staff cashier', orders: 1, bills: 1, sales: '200.00', discounts: 0, cancelled: 0 }])
  })
  it('refuses a range that is too long', async () => {
    expect((await call('GET', '/reports/products?from=2026-01-01&to=2026-12-31', owner)).status).toBe(422)
  })
  it('keeps reports inside a business', async () => {
    expect((await call('GET', `/reports/products?from=${today()}`, ownerB)).body.best).toEqual([])
  })
})

describe('menu', () => {
  it('copies sizes, add-ons and the recipe when duplicating', async () => {
    const addon = (await call('POST', '/addons', owner, { name: 'Ghee', price: '20' })).body.id
    await call('PUT', `/products/${product}/addons`, owner, { addonIds: [addon] })
    const stock = (await call('POST', '/inventory/items', owner, { name: 'Rice', unit: 'kg', cost: '50', minStock: '1' })).body.id
    await call('PUT', `/products/${product}/recipe`, owner, { lines: [{ stockItemId: stock, quantity: '0.2' }] })
    const copy = await call('POST', `/products/${product}/duplicate`, owner)
    expect(copy.status).toBe(201)
    expect(copy.body.name).toBe('Dosa (copy)')
    const row = (await call('GET', '/menu', owner)).body.products.find((item: any) => item.id === copy.body.id)
    expect(row.variants).toMatchObject([{ name: 'Regular', price: '100.00' }])
    expect(row.addon_ids).toEqual([addon])
    expect((await call('GET', `/products/${copy.body.id}/recipe`, owner)).body.lines).toHaveLength(1)
  })
  it('saves a description', async () => {
    await call('PATCH', `/products/${slowProduct}`, owner, { description: 'Soft and warm' })
    expect((await call('GET', '/menu', owner)).body.products.find((row: any) => row.id === slowProduct).description).toBe('Soft and warm')
  })
  it('reorders categories and sets an icon', async () => {
    const second = (await call('POST', '/categories', owner, { name: 'Drinks', icon: 'coffee' })).body
    expect(second.icon).toBe('coffee')
    expect((await call('PUT', '/categories/order', owner, { ids: [second.id, category] })).status).toBe(200)
    expect((await call('GET', '/menu', owner)).body.categories.map((row: any) => row.name).slice(0, 2)).toEqual(['Drinks', 'Food'])
  })
  it('links one add-on to many items', async () => {
    const addon = (await call('POST', '/addons', owner, { name: 'Chutney', price: '10' })).body.id
    expect((await call('PUT', `/addons/${addon}/products`, owner, { productIds: [product, slowProduct] })).status).toBe(200)
    const menu = (await call('GET', '/menu', owner)).body.products
    expect(menu.find((row: any) => row.id === slowProduct).addon_ids).toContain(addon)
  })
  it('gives a photo its own upload link and refuses another item’s path', async () => {
    const link = await call('POST', `/products/${product}/photo`, owner)
    expect(link.status).toBe(200)
    expect(link.body.path.startsWith(`${a.tenantId}/${product}/`)).toBe(true)
    expect((await call('PATCH', `/products/${product}`, owner, { imagePath: `${b.tenantId}/${product}/x.jpg` })).status).toBe(422)
    expect((await call('PATCH', `/products/${product}`, owner, { imagePath: link.body.path })).body.image_path).toBe(link.body.path)
    expect((await call('PATCH', `/products/${product}`, owner, { imagePath: '' })).body.image_path).toBeNull()
  })
  it('refuses another business’s item', async () => {
    expect((await call('POST', `/products/${product}/duplicate`, ownerB)).status).toBe(404)
    expect((await call('POST', `/products/${product}/photo`, ownerB)).status).toBe(404)
  })
})

describe('roles and permissions', () => {
  afterAll(async () => {
    await db.query(`delete from app.role_permissions where tenant_id = $1`, [a.tenantId])
  })

  it('lets only owners see or change the grid', async () => {
    expect((await call('GET', '/permissions', owner)).status).toBe(200)
    expect((await call('GET', '/permissions', admin)).status).toBe(403)
    expect((await call('GET', '/permissions', manager)).status).toBe(403)
    expect((await call('PUT', '/permissions/cashier', manager, { levels: { reports: 'view' } })).status).toBe(403)
  })
  it('shows each role’s starting access', async () => {
    const { body } = await call('GET', '/permissions', owner)
    const cashierRow = body.grid.find((row: any) => row.role === 'cashier')
    expect(cashierRow.levels).toMatchObject({ orders: 'manage', billing: 'manage', reports: 'none', expenses: 'none' })
    expect(body.grid.find((row: any) => row.role === 'accountant').levels).toMatchObject({ billing: 'view', reports: 'view' })
  })
  it('gives a role a section straight away', async () => {
    expect((await call('GET', `/reports/products?from=${today()}`, cashier)).status).toBe(403)
    await call('PUT', '/permissions/cashier', owner, { levels: { reports: 'view' } })
    expect((await call('GET', `/reports/products?from=${today()}`, cashier)).status).toBe(200)
    expect((await call('GET', '/me', cashier)).body.permissions).toContain('reports.read')
  })
  it('takes a section away', async () => {
    await call('PUT', '/permissions/cashier', owner, { levels: { customers: 'none' } })
    expect((await call('GET', '/customers', cashier)).status).toBe(403)
    await call('PUT', '/permissions/cashier', owner, { levels: {} })
    expect((await call('GET', '/customers', cashier)).status).toBe(200)
  })
  it('makes View read-only', async () => {
    await call('PUT', '/permissions/cashier', owner, { levels: { customers: 'view' } })
    expect((await call('GET', '/customers', cashier)).status).toBe(200)
    expect((await call('POST', '/customers', cashier, { name: 'Asha', phone: '9800000011' })).status).toBe(403)
    await call('PUT', '/permissions/cashier', owner, { levels: {} })
  })
  it('never hands out sensitive actions with Manage', async () => {
    await call('PUT', '/permissions/waiter', owner, { levels: { billing: 'manage', orders: 'manage' } })
    const { permissions } = (await call('GET', '/me', waiter)).body
    expect(permissions).toContain('billing.write')
    for (const blocked of ['payments.refund', 'billing.correct', 'payments.verify', 'orders.cancel', 'orders.discount']) expect(permissions).not.toContain(blocked)
    await call('PUT', '/permissions/waiter', owner, { levels: {} })
  })
  it('can’t reach staff or settings, or hide the menu', async () => {
    expect((await call('PUT', '/permissions/cashier', owner, { levels: { staff: 'manage' } })).status).toBe(422)
    expect((await call('PUT', '/permissions/cashier', owner, { levels: { settings: 'manage' } })).status).toBe(422)
    expect((await call('PUT', '/permissions/cashier', owner, { levels: { menu: 'none' } })).status).toBe(422)
    expect((await call('PUT', '/permissions/cashier', owner, { levels: { reports: 'manage' } })).status).toBe(422)
  })
  it('can’t change owners', async () => {
    expect((await call('PUT', '/permissions/owner', owner, { levels: { reports: 'none' } })).status).toBe(422)
  })
  it('stops at the business', async () => {
    await call('PUT', '/permissions/manager', ownerB, { levels: { reports: 'none' } })
    expect((await call('GET', `/reports/products?from=${today()}`, manager)).status).toBe(200)
  })
  it('lets an admin run the business but not the top of it', async () => {
    expect((await call('PATCH', '/business', admin, { billFooter: 'Thank you' })).status).toBe(200)
    expect((await call('GET', '/backup', admin)).status).toBe(403)
    expect((await call('POST', '/staff', admin, { displayName: 'New owner', role: 'owner', email: 'x@example.com' })).status).toBe(403)
    expect((await call('POST', '/staff', admin, { displayName: 'New admin', role: 'admin', email: 'x@example.com' })).status).toBe(403)
  })
  it('keeps managers from changing settings', async () => {
    expect((await call('PATCH', '/business', manager, { billFooter: 'Hi' })).status).toBe(403)
  })
})

describe('staff and activity', () => {
  it('shows orders today and last active', async () => {
    const { body } = await call('GET', '/staff', owner)
    const row = body.items.find((item: any) => item.display_name === 'Staff cashier')
    expect(row.orders_today).toBeGreaterThan(0)
    expect(row.last_active).toBeTruthy()
  })
  it('filters the activity log', async () => {
    const order = (await call('POST', '/orders', cashier, { id: crypto.randomUUID(), orderType: 'takeaway' })).body
    await call('POST', `/orders/${order.id}/items`, cashier, { id: crypto.randomUUID(), variantId: variant })
    await call('POST', `/orders/${order.id}/discounts`, owner, { id: crypto.randomUUID(), kind: 'percent', value: '10', reason: 'Regular guest' })
    const { body } = await call('GET', '/activity?group=discounts', owner)
    expect(body.items[0]).toMatchObject({ action: 'order.discount_added', actor_name: 'Owner' })
    expect(body.items.every((row: any) => row.action.startsWith('order.discount'))).toBe(true)
  })
  it('keeps the log from frontline staff and other businesses', async () => {
    expect((await call('GET', '/activity', cashier)).status).toBe(403)
    expect((await call('GET', '/activity?group=discounts', ownerB)).body.items).toEqual([])
  })
})

describe('settings', () => {
  it('refuses an order type that is turned off', async () => {
    expect((await call('PATCH', '/business', owner, { orderTypes: ['dine_in', 'takeaway'] })).status).toBe(200)
    expect((await call('POST', '/orders', cashier, { id: crypto.randomUUID(), orderType: 'delivery', deliveryAddress: 'A' })).status).toBe(409)
    expect((await call('GET', '/pos-settings', cashier)).body.order_types).toEqual(['dine_in', 'takeaway'])
    await call('PATCH', '/business', owner, { orderTypes: ['dine_in', 'takeaway', 'delivery', 'aggregator'] })
  })
  it('keeps at least one order type', async () => {
    expect((await call('PATCH', '/business', owner, { orderTypes: [] })).status).toBe(422)
  })
  it('turns payment methods off, but never the last one', async () => {
    const items = (await call('GET', '/payment-methods/all', owner)).body.items
    const card = items.find((row: any) => row.kind === 'card')
    expect((await call('PATCH', `/payment-methods/${card.id}`, owner, { isActive: false })).status).toBe(200)
    expect((await call('GET', '/payment-methods', cashier)).body.items.map((row: any) => row.kind)).not.toContain('card')
    for (const row of items.filter((item: any) => item.id !== items[0].id && item.id !== card.id)) {
      await call('PATCH', `/payment-methods/${row.id}`, owner, { isActive: false })
    }
    expect((await call('PATCH', `/payment-methods/${items[0].id}`, owner, { isActive: false })).status).toBe(409)
    for (const row of items) await call('PATCH', `/payment-methods/${row.id}`, owner, { isActive: true })
  })
  it('saves display and notification choices', async () => {
    const saved = await call('PATCH', '/business', owner, { defaultSeats: 6, showItemPhotos: false, showFoodMarks: false, mutedAlerts: ['heldOrders'] })
    expect(saved.body).toMatchObject({ default_seats: 6, show_item_photos: false, show_food_marks: false, muted_alerts: ['heldOrders'] })
    expect((await call('GET', '/pos-settings', cashier)).body).toMatchObject({ default_seats: 6, show_item_photos: false })
  })
  it('counts a failed payment as an issue', async () => {
    expect((await call('GET', '/alerts', owner)).body.paymentIssues).toBe(0)
    const order = (await call('POST', '/orders', cashier, { id: crypto.randomUUID(), orderType: 'takeaway' })).body
    const added = (await call('POST', `/orders/${order.id}/items`, cashier, { id: crypto.randomUUID(), variantId: variant })).body
    const invoice = crypto.randomUUID()
    await call('POST', `/orders/${order.id}/finalize`, cashier, { version: added.version, invoices: [{ id: invoice }] })
    const upi = (await call('GET', '/payment-methods', cashier)).body.items.find((row: any) => row.kind === 'upi').id
    const paid = await call('POST', '/payments', cashier, { id: crypto.randomUUID(), methodId: upi, amount: '100.00', allocations: [{ invoiceId: invoice, amount: '100.00' }] })
    await call('POST', `/payments/${paid.body.id}/fail`, owner, { reason: 'Not in the bank' })
    expect((await call('GET', '/alerts', owner)).body.paymentIssues).toBe(1)
    expect((await call('GET', '/alerts', ownerB)).body.paymentIssues).toBe(0)
  })
})

describe('setup and sample data', () => {
  it('tracks the steps', async () => {
    expect((await call('GET', '/setup', ownerFresh)).body).toMatchObject({ menu: false, tables: false, staff: false, sample: false, dismissed: false })
  })
  it('adds a menu and tables but no bills', async () => {
    expect((await call('POST', '/setup/sample', ownerFresh)).status).toBe(201)
    expect((await call('GET', '/setup', ownerFresh)).body).toMatchObject({ menu: true, tables: true, sample: true })
    const menu = (await call('GET', '/menu', ownerFresh)).body
    expect(menu.products.length).toBeGreaterThan(5)
    expect(menu.categories[0]).toMatchObject({ name: 'Coffee', icon: 'coffee' })
    const { rows: [{ count }] } = await db.query(`select count(*)::int as count from app.invoices where tenant_id = $1`, [fresh.tenantId])
    expect(count).toBe(0)
  })
  it('won’t add samples over a real menu', async () => {
    expect((await call('POST', '/setup/sample', owner)).status).toBe(409)
  })
  it('clears the samples from every list', async () => {
    expect((await call('POST', '/setup/sample/clear', ownerFresh)).status).toBe(200)
    expect((await call('GET', '/menu', ownerFresh)).body).toMatchObject({ products: [], categories: [] })
    expect((await call('GET', '/setup', ownerFresh)).body).toMatchObject({ menu: false, tables: false, sample: false })
  })
  it('can add them again after clearing', async () => {
    expect((await call('POST', '/setup/sample', ownerFresh)).status).toBe(201)
    await call('POST', '/setup/sample/clear', ownerFresh)
  })
  it('hides the guide on request', async () => {
    await call('POST', '/setup/dismiss', ownerFresh, { dismissed: true })
    expect((await call('GET', '/setup', ownerFresh)).body.dismissed).toBe(true)
  })
  it('keeps samples from cashiers', async () => {
    expect((await call('POST', '/setup/sample', cashier)).status).toBe(403)
  })
})

describe('backup', () => {
  it('gives owners every section', async () => {
    const { body } = await call('GET', '/backup', owner)
    expect(body.sections).toContain('bills')
    for (const section of body.sections) expect((await call('GET', `/backup/${section}`, owner)).status).toBe(200)
  })
  it('leaves PINs and device secrets out', async () => {
    const { body } = await call('GET', '/backup/staff', owner)
    expect(body.rows.length).toBeGreaterThan(1)
    expect(JSON.stringify(body)).not.toMatch(/pin_hash|argon2|credential/)
    expect((await call('GET', '/backup', owner)).body.sections).not.toContain('devices')
  })
  it('holds only this business', async () => {
    expect((await call('GET', '/backup/products', ownerB)).body.rows).toEqual([])
  })
  it('keeps it from everyone but owners', async () => {
    expect((await call('GET', '/backup/customers', manager)).status).toBe(403)
    expect((await call('GET', '/backup/customers', cashier)).status).toBe(403)
  })
  it('refuses a section that doesn’t exist', async () => {
    expect((await call('GET', '/backup/constructor', owner)).status).toBe(404)
  })
  it('logs each download', async () => {
    await call('GET', '/backup/business', owner)
    expect((await call('GET', '/activity?group=all', owner)).body.items.some((row: any) => row.action === 'backup.downloaded')).toBe(true)
  })
})
