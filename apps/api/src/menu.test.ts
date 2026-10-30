// Menu tests against the real Supabase project. Removes everything it creates.
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { request } from './testing'
import { provisionBusiness } from './modules/tenancy/provision'
import { closeDb } from './platform/db'
import { createSession, supabaseAdmin } from './platform/supabase'

const run = crypto.randomUUID().slice(0, 8)
const emailFor = (label: string) => `menu-${label}-${run}@staff.isoform.invalid`
const business = (label: string) => ({
  displayName: `Menu ${label}`, legalName: 'Legal', scheme: 'unregistered' as const, stateCode: '33', address: 'A',
  branchName: 'Main', branchCode: 'MN', ownerName: 'Owner', ownerEmail: emailFor(label),
})

let a: Awaited<ReturnType<typeof provisionBusiness>>
let b: Awaited<ReturnType<typeof provisionBusiness>>
let ownerA: string
let ownerB: string
let cashierA: string
let secondBranch: string
let rate: string
let category: string
let product: string
let variant: string
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

const coffee = (categoryId: string, taxRateId: string, name = 'Filter coffee') => ({
  name, categoryId, taxRateId, foodType: 'veg',
  variants: [{ name: 'Regular', price: '84' }, { name: 'Large', price: '110.50' }],
})

const tokenFor = async (email: string) => (await createSession(email)).access_token
const getMenu = async (token: string, query = '') => (await call('GET', `/menu${query}`, token)).body
const findVariant = (menu: any, variantName = 'Regular') =>
  menu.products.find((p: any) => p.id === product).variants.find((v: any) => v.name === variantName)

beforeAll(async () => {
  db = new pg.Client({ connectionString: process.env.DATABASE_URL_DIRECT, ssl: { rejectUnauthorized: false } })
  await db.connect()
  a = await provisionBusiness(business('a'))
  b = await provisionBusiness(business('b'))
  users.push(a.userId, b.userId)
  ownerA = await tokenFor(emailFor('a'))
  ownerB = await tokenFor(emailFor('b'))

  const cashier = await call('POST', '/staff', ownerA, { displayName: 'Cashier', role: 'cashier', pin: '4821', branchIds: [a.branchId] })
  const { rows: [row] } = await db.query(`select user_id from app.memberships where id = $1`, [cashier.body.id])
  users.push(row.user_id)
  const { data } = await supabaseAdmin.auth.admin.getUserById(row.user_id)
  cashierA = await tokenFor(data.user!.email!)

  const tax = (await call('GET', '/tax-registrations', ownerA)).body.items[0].id
  secondBranch = (await call('POST', '/branches', ownerA, { name: 'Second', code: 'SC', taxRegistrationId: tax })).body.id
  rate = (await call('POST', '/tax-rates', ownerA, { name: 'GST 5%', cgstRate: '2.5', sgstRate: '2.5' })).body.id
  category = (await call('POST', '/categories', ownerA, { name: 'Coffee' })).body.id
  product = (await call('POST', '/products', ownerA, coffee(category, rate))).body.id
  variant = findVariant(await getMenu(ownerA)).id
})

afterAll(async () => {
  for (const tenant of [a.tenantId, b.tenantId]) {
    for (const table of ['audit_log', 'idempotency_keys', 'branch_variant_overrides', 'product_addons', 'addons', 'product_variants',
      'products', 'categories', 'tax_rates', 'branch_memberships', 'registers', 'payment_methods', 'memberships', 'branches', 'tax_registrations']) {
      await db.query(`delete from app.${table} where tenant_id = $1`, [tenant])
    }
    await db.query(`delete from app.tenants where id = $1`, [tenant])
  }
  for (const id of users) await supabaseAdmin.auth.admin.deleteUser(id)
  await db.end()
  await closeDb()
})

describe('menu rules', () => {
  it('keeps prices exact as decimal text', async () => {
    expect(findVariant(await getMenu(ownerA), 'Large').price).toBe('110.50')
  })
  it('needs at least one variant', async () => {
    const response = await call('POST', '/products', ownerA, { ...coffee(category, rate), variants: [] })
    expect(response.status).toBe(422)
  })
  it('rejects invalid prices', async () => {
    for (const price of ['-5', 'free', '1.234', 12]) {
      const response = await call('PATCH', `/variants/${variant}`, ownerA, { price })
      expect(response.status).toBe(422)
    }
  })
  it('rejects a duplicate category name', async () => {
    expect((await call('POST', '/categories', ownerA, { name: 'Coffee' })).status).toBe(409)
  })
  it('rejects a tax rate above 100', async () => {
    expect((await call('POST', '/tax-rates', ownerA, { name: 'Bad', cgstRate: '101' })).status).toBe(422)
  })
  it('has no route for changing a rate’s percentages', async () => {
    expect((await call('PATCH', `/tax-rates/${rate}`, ownerA, { cgstRate: '9' })).status).toBe(422)
  })
  it('has no delete route for products', async () => {
    expect((await call('DELETE', `/products/${product}`, ownerA)).status).toBe(404)
  })
  it('deactivates instead of deleting', async () => {
    await call('PATCH', `/products/${product}`, ownerA, { isActive: false })
    const menu = await getMenu(ownerA)
    expect(menu.products.find((p: any) => p.id === product).is_active).toBe(false)
    await call('PATCH', `/products/${product}`, ownerA, { isActive: true })
  })
  it('records price changes with before and after', async () => {
    await call('PATCH', `/variants/${variant}`, ownerA, { price: '90' })
    const { rows } = await db.query(
      `select before_data, after_data from app.audit_log where action = 'variant.updated' and entity_id = $1`, [variant],
    )
    expect(rows[0].before_data.price).toBe('84.00')
    expect(rows[0].after_data.price).toBe('90.00')
    await call('PATCH', `/variants/${variant}`, ownerA, { price: '84' })
  })
  it('replays a create only once', async () => {
    const headers = { 'idempotency-key': crypto.randomUUID() }
    const body = { name: 'Extra shot', price: '40' }
    const replies = await Promise.all(Array.from({ length: 5 }, () => call('POST', '/addons', ownerA, body, headers)))
    expect(new Set(replies.map((r) => r.body.id)).size).toBe(1)
    await call('PUT', `/products/${product}/addons`, ownerA, { addonIds: [replies[0].body.id] })
    expect((await getMenu(ownerA)).products.find((p: any) => p.id === product).addon_ids).toEqual([replies[0].body.id])
  })
})

describe('branch prices', () => {
  it('changes one branch only, and can be undone', async () => {
    await call('PUT', `/branches/${a.branchId}/variants/${variant}`, ownerA, { price: '95', isAvailable: true })
    expect(findVariant(await getMenu(ownerA, `?branchId=${a.branchId}`)).price).toBe('95.00')
    expect(findVariant(await getMenu(ownerA, `?branchId=${secondBranch}`)).price).toBe('84.00')
    await call('PUT', `/branches/${a.branchId}/variants/${variant}`, ownerA, { price: null, isAvailable: true })
    expect(findVariant(await getMenu(ownerA, `?branchId=${a.branchId}`)).price).toBe('84.00')
  })
  it('marks an item sold out at one branch', async () => {
    await call('PUT', `/branches/${a.branchId}/variants/${variant}`, ownerA, { price: null, isAvailable: false })
    expect(findVariant(await getMenu(ownerA, `?branchId=${a.branchId}`)).isAvailable).toBe(false)
    expect(findVariant(await getMenu(ownerA, `?branchId=${secondBranch}`)).isAvailable).toBe(true)
    await call('PUT', `/branches/${a.branchId}/variants/${variant}`, ownerA, { price: null, isAvailable: true })
  })
  it('shows a cashier their own branch’s prices automatically', async () => {
    await call('PUT', `/branches/${a.branchId}/variants/${variant}`, ownerA, { price: '99', isAvailable: true })
    expect(findVariant(await getMenu(cashierA)).price).toBe('99.00')
    await call('PUT', `/branches/${a.branchId}/variants/${variant}`, ownerA, { price: null, isAvailable: true })
  })
  it('stops a cashier reading another branch', async () => {
    expect((await call('GET', `/menu?branchId=${secondBranch}`, cashierA)).status).toBe(403)
  })
})

describe('permissions and isolation', () => {
  it('lets a cashier read but not change the menu', async () => {
    expect((await call('GET', '/menu', cashierA)).status).toBe(200)
    expect((await call('POST', '/categories', cashierA, { name: 'Mine' })).status).toBe(403)
    expect((await call('PATCH', `/variants/${variant}`, cashierA, { price: '1' })).status).toBe(403)
    expect((await call('POST', '/products', cashierA, coffee(category, rate, 'Free'))).status).toBe(403)
  })
  it('shows a business nothing from another', async () => {
    const menu = await getMenu(ownerB)
    expect(menu.products).toEqual([])
    expect(menu.categories).toEqual([])
  })
  it('cannot edit another business’s menu', async () => {
    expect((await call('PATCH', `/products/${product}`, ownerB, { name: 'Hacked' })).status).toBe(404)
    expect((await call('PATCH', `/variants/${variant}`, ownerB, { price: '1' })).status).toBe(404)
    expect((await call('PATCH', `/categories/${category}`, ownerB, { name: 'Hacked' })).status).toBe(404)
    expect((await call('PUT', `/products/${product}/addons`, ownerB, { addonIds: [] })).status).toBe(404)
    expect((await call('POST', `/products/${product}/variants`, ownerB, { name: 'X', price: '1' })).status).toBe(422)
  })
  it('cannot use another business’s category, rate or add-on', async () => {
    const rateB = (await call('POST', '/tax-rates', ownerB, { name: 'GST 5%', cgstRate: '2.5', sgstRate: '2.5' })).body.id
    const categoryB = (await call('POST', '/categories', ownerB, { name: 'Food' })).body.id
    expect((await call('POST', '/products', ownerB, coffee(category, rateB))).status).toBe(422)
    expect((await call('POST', '/products', ownerB, coffee(categoryB, rate))).status).toBe(422)
    const addon = (await call('POST', '/addons', ownerA, { name: 'Private', price: '1' })).body.id
    const productB = (await call('POST', '/products', ownerB, coffee(categoryB, rateB))).body.id
    expect((await call('PUT', `/products/${productB}/addons`, ownerB, { addonIds: [addon] })).status).toBe(422)
  })
  it('cannot set a price at another business’s branch', async () => {
    expect((await call('PUT', `/branches/${a.branchId}/variants/${variant}`, ownerB, { price: '1', isAvailable: true })).status).toBe(403)
  })
})
