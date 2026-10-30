// Billing tests against the real Supabase project. Removes everything it creates.
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { app } from './app'
import { provisionBusiness } from './modules/tenancy/provision'
import { closeDb } from './platform/db'
import { createSession, supabaseAdmin } from './platform/supabase'

const run = crypto.randomUUID().slice(0, 8)
const emailFor = (label: string) => `billing-${label}-${run}@staff.isoform.invalid`

let reg: Awaited<ReturnType<typeof provisionBusiness>>
let comp: Awaited<ReturnType<typeof provisionBusiness>>
let ownerReg: string
let ownerComp: string
let cashier: string
let waiter: string
let variant: string
let variantComp: string
const users: string[] = []
let db: pg.Client

async function call(method: string, path: string, token: string, body?: unknown, headers: Record<string, string> = {}) {
  const write = method !== 'GET'
  const response = await app.request(`/api/v1${path}`, {
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
  const made = await call('POST', '/staff', ownerReg, { displayName: `Staff ${role}`, role, pin: '4821', branchIds: [reg.branchId] })
  const { rows: [row] } = await db.query(`select user_id from app.memberships where id = $1`, [made.body.id])
  users.push(row.user_id)
  const { data } = await supabaseAdmin.auth.admin.getUserById(row.user_id)
  return (await createSession(data.user!.email!)).access_token
}

async function menu(token: string, price: string) {
  const rate = (await call('POST', '/tax-rates', token, { name: 'GST 5%', cgstRate: '2.5', sgstRate: '2.5' })).body.id
  const category = (await call('POST', '/categories', token, { name: 'Food' })).body.id
  await call('POST', '/products', token, { name: 'Thali', categoryId: category, taxRateId: rate, hsnSac: '996331', variants: [{ name: 'Regular', price }] })
  return (await call('GET', '/menu', token)).body.products[0].variants[0].id as string
}

async function order(token = cashier, id = variant, quantity = '1') {
  const created = await call('POST', '/orders', token, { id: crypto.randomUUID(), orderType: 'takeaway' })
  const added = await call('POST', `/orders/${created.body.id}/items`, token, { id: crypto.randomUUID(), variantId: id, quantity })
  return added.body
}

const bill = (current: any, token = cashier, headers = {}) =>
  call('POST', `/orders/${current.id}/finalize`, token, { version: current.version, invoices: [{ id: crypto.randomUUID() }] }, headers)

const number = (invoice: string) => Number(invoice.split('-')[2])

beforeAll(async () => {
  db = new pg.Client({ connectionString: process.env.DATABASE_URL_DIRECT, ssl: { rejectUnauthorized: false } })
  await db.connect()
  const base = { legalName: 'Legal Pvt Ltd', stateCode: '33', address: '1 Main Road', branchName: 'Main', branchCode: 'MN', ownerName: 'Owner' }
  reg = await provisionBusiness({ ...base, displayName: 'Regular', scheme: 'regular', gstin: '33ABCDE1234F1Z5', ownerEmail: emailFor('reg') })
  comp = await provisionBusiness({ ...base, displayName: 'Small', scheme: 'composition', gstin: '33ABCDE1234F2Z4', ownerEmail: emailFor('comp') })
  users.push(reg.userId, comp.userId)
  ownerReg = (await createSession(emailFor('reg'))).access_token
  ownerComp = (await createSession(emailFor('comp'))).access_token
  cashier = await staff('cashier')
  waiter = await staff('waiter')
  variant = await menu(ownerReg, '952')
  variantComp = await menu(ownerComp, '952')
})

afterAll(async () => {
  for (const tenant of [reg.tenantId, comp.tenantId]) {
    for (const table of ['audit_log', 'idempotency_keys', 'credit_note_lines', 'credit_notes', 'invoice_lines', 'invoices', 'invoice_series',
      'order_discounts', 'order_item_addons', 'order_status_history', 'order_items', 'orders', 'branch_variant_overrides', 'product_addons',
      'addons', 'product_variants', 'products', 'categories', 'tax_rates', 'branch_memberships', 'registers', 'payment_methods',
      'memberships', 'branches', 'tax_registrations']) {
      await db.query(`delete from app.${table} where tenant_id = $1`, [tenant])
    }
    await db.query(`delete from app.tenants where id = $1`, [tenant])
  }
  for (const id of users) await supabaseAdmin.auth.admin.deleteUser(id)
  await db.end()
  await closeDb()
})

describe('issuing a bill', () => {
  it('shows the same total in the quote and the invoice', async () => {
    const current = await order()
    const quote = await call('GET', `/orders/${current.id}/quote`, cashier)
    expect(quote.body.bill.grandTotal).toBe('1000.00')
    const issued = await bill(current)
    expect(issued.status).toBe(201)
    expect(issued.body.invoices[0].grandTotal).toBe('1000.00')
    expect(issued.body.invoices[0].number).toMatch(/^MN-\d{4}-\d{6}$/)
    const invoice = await call('GET', `/invoices/${issued.body.invoices[0].id}`, cashier)
    expect(invoice.body).toMatchObject({ taxable_total: '952.00', cgst_total: '23.80', sgst_total: '23.80', round_off: '0.40', outstanding: '1000.00' })
    expect(invoice.body.lines[0].hsn_sac).toBe('996331')
    expect(invoice.body.seller_snapshot.gstin).toBe('33ABCDE1234F1Z5')
  })
  it('keeps the invoice unchanged when the menu and tax change later', async () => {
    const issued = await bill(await order())
    await call('PATCH', `/variants/${variant}`, ownerReg, { price: '2000' })
    const invoice = await call('GET', `/invoices/${issued.body.invoices[0].id}`, cashier)
    expect(invoice.body.grand_total).toBe('1000.00')
    await call('PATCH', `/variants/${variant}`, ownerReg, { price: '952' })
  })
  it('locks the order', async () => {
    const current = await order()
    await bill(current)
    expect((await call('POST', `/orders/${current.id}/items`, cashier, { id: crypto.randomUUID(), variantId: variant })).status).toBe(409)
  })
  it('refuses an empty order and leaves it open', async () => {
    const created = await call('POST', '/orders', cashier, { id: crypto.randomUUID(), orderType: 'takeaway' })
    expect((await bill(created.body)).status).toBe(409)
    expect((await call('GET', `/orders/${created.body.id}`, cashier)).body.status).toBe('open')
  })
  it('refuses a stale order', async () => {
    const current = await order()
    await call('PATCH', `/orders/${current.id}/items/${current.items[0].id}`, cashier, { version: current.version, quantity: '2' })
    expect((await bill(current)).status).toBe(409)
  })
})

describe('at the same moment', () => {
  it('bills an order only once when 5 tills try', async () => {
    const current = await order()
    const replies = await Promise.all(Array.from({ length: 5 }, () => bill(current)))
    expect(replies.filter((r) => r.status === 201)).toHaveLength(1)
    const { rows } = await db.query(`select count(*)::int as n from app.invoices where order_id = $1`, [current.id])
    expect(rows[0].n).toBe(1)
  })
  it('returns the first bill when a request is replayed', async () => {
    const current = await order()
    const headers = { 'idempotency-key': crypto.randomUUID() }
    const body = { version: current.version, invoices: [{ id: crypto.randomUUID() }] }
    const replies = await Promise.all(Array.from({ length: 4 }, () => call('POST', `/orders/${current.id}/finalize`, cashier, body, headers)))
    expect(replies.every((r) => r.status === 201)).toBe(true)
    expect(new Set(replies.map((r) => r.body.invoices[0].number)).size).toBe(1)
  })
  it('numbers 8 simultaneous bills with no duplicates or gaps', async () => {
    const orders = []
    for (let i = 0; i < 8; i += 1) orders.push(await order())
    const replies = await Promise.all(orders.map((current) => bill(current)))
    expect(replies.every((r) => r.status === 201)).toBe(true)
    const numbers = replies.map((r) => number(r.body.invoices[0].number)).sort((a, b) => a - b)
    expect(numbers).toEqual(numbers.map((_, index) => numbers[0] + index))
  })
})

describe('split bills', () => {
  it('splits one order into two numbered invoices', async () => {
    const current = await order(cashier, variant, '2')
    const item = current.items[0].id
    const split = await call('POST', `/orders/${current.id}/finalize`, cashier, {
      version: current.version,
      invoices: [
        { id: crypto.randomUUID(), items: [{ orderItemId: item, quantity: '1' }] },
        { id: crypto.randomUUID(), items: [{ orderItemId: item, quantity: '1' }] },
      ],
    })
    expect(split.status).toBe(201)
    expect(split.body.invoices.map((i: any) => i.grandTotal)).toEqual(['1000.00', '1000.00'])
    expect(number(split.body.invoices[1].number)).toBe(number(split.body.invoices[0].number) + 1)
  })
  it('refuses a split that leaves something unbilled, and rolls back', async () => {
    const current = await order(cashier, variant, '2')
    const result = await call('POST', `/orders/${current.id}/finalize`, cashier, {
      version: current.version,
      invoices: [{ id: crypto.randomUUID(), items: [{ orderItemId: current.items[0].id, quantity: '1' }] }],
    })
    expect(result.status).toBe(422)
    expect((await call('GET', `/orders/${current.id}`, cashier)).body.status).toBe('open')
  })
})

describe('composition business', () => {
  it('issues a bill of supply with no GST', async () => {
    const issued = await bill(await order(ownerComp, variantComp), ownerComp)
    const invoice = await call('GET', `/invoices/${issued.body.invoices[0].id}`, ownerComp)
    expect(invoice.body.document_type).toBe('bill_of_supply')
    expect(invoice.body.cgst_total).toBe('0.00')
    expect(invoice.body.grand_total).toBe('952.00')
  })
})

describe('service charge', () => {
  it('is only on the bill when someone added it', async () => {
    const current = await order()
    const without = await call('GET', `/orders/${current.id}/quote`, cashier)
    expect(without.body.bill.lines).toHaveLength(1)
    await call('PATCH', `/orders/${current.id}`, cashier, { version: current.version, serviceChargePercent: '5' })
    const withCharge = await call('GET', `/orders/${current.id}/quote`, cashier)
    expect(withCharge.body.bill.lines[1].description).toBe('Service charge (voluntary)')
  })
})

describe('credit notes', () => {
  it('cancels a whole invoice and keeps the original', async () => {
    const issued = await bill(await order())
    const id = issued.body.invoices[0].id
    const note = await call('POST', `/invoices/${id}/credit-notes`, ownerReg, { id: crypto.randomUUID(), kind: 'cancellation', reason: 'Wrong table' })
    expect(note.status).toBe(201)
    expect(note.body.outstanding).toBe('0.00')
    expect(note.body.grand_total).toBe('1000.00')
    expect(note.body.creditNotes[0].number).toMatch(/^CMN-\d{4}-\d{6}$/)
  })
  it('refuses to credit the same invoice twice', async () => {
    const issued = await bill(await order())
    const path = `/invoices/${issued.body.invoices[0].id}/credit-notes`
    await call('POST', path, ownerReg, { id: crypto.randomUUID(), kind: 'cancellation', reason: 'First' })
    expect((await call('POST', path, ownerReg, { id: crypto.randomUUID(), kind: 'cancellation', reason: 'Second' })).status).toBe(409)
  })
  it('corrects part of an invoice, then the rest clears exactly', async () => {
    const issued = await bill(await order(cashier, variant, '3'))
    const id = issued.body.invoices[0].id
    const invoice = (await call('GET', `/invoices/${id}`, cashier)).body
    const line = invoice.lines[0].id
    const path = `/invoices/${id}/credit-notes`
    const part = await call('POST', path, ownerReg, { id: crypto.randomUUID(), kind: 'correction', reason: 'One returned', lines: [{ invoiceLineId: line, quantity: '1' }] })
    expect(part.status).toBe(201)
    expect((await call('POST', path, ownerReg, { id: crypto.randomUUID(), kind: 'correction', reason: 'Too many', lines: [{ invoiceLineId: line, quantity: '3' }] })).status).toBe(422)
    const rest = await call('POST', path, ownerReg, { id: crypto.randomUUID(), kind: 'cancellation', reason: 'Rest returned' })
    expect(rest.body.outstanding).toBe('0.00')
  })
  it('credits an invoice only once when 5 people try', async () => {
    const issued = await bill(await order())
    const path = `/invoices/${issued.body.invoices[0].id}/credit-notes`
    const replies = await Promise.all(Array.from({ length: 5 }, () => call('POST', path, ownerReg, { id: crypto.randomUUID(), kind: 'cancellation', reason: 'Race' })))
    expect(replies.filter((r) => r.status === 201)).toHaveLength(1)
  })
})

describe('permissions and isolation', () => {
  it('lets a cashier bill but not issue credit notes', async () => {
    const issued = await bill(await order())
    const path = `/invoices/${issued.body.invoices[0].id}/credit-notes`
    expect((await call('POST', path, cashier, { id: crypto.randomUUID(), kind: 'cancellation', reason: 'Mine' })).status).toBe(403)
  })
  it('stops a waiter billing', async () => {
    expect((await bill(await order(waiter), waiter)).status).toBe(403)
  })
  it('hides invoices from another business', async () => {
    const issued = await bill(await order())
    const id = issued.body.invoices[0].id
    expect((await call('GET', `/invoices/${id}`, ownerComp)).status).toBe(404)
    expect((await call('POST', `/invoices/${id}/credit-notes`, ownerComp, { id: crypto.randomUUID(), kind: 'cancellation', reason: 'Hacked' })).status).toBe(404)
    const list = await call('GET', '/invoices', ownerComp)
    expect(list.body.items.every((item: any) => item.branch_id === comp.branchId)).toBe(true)
  })
  it('cannot bill another business’s order', async () => {
    const current = await order()
    expect((await bill(current, ownerComp)).status).toBe(404)
    expect((await call('GET', `/orders/${current.id}/quote`, ownerComp)).status).toBe(404)
  })
  it('records who issued each bill', async () => {
    const issued = await bill(await order())
    const { rows } = await db.query(`select action, after_data from app.audit_log where entity_id = $1`, [issued.body.invoices[0].id])
    expect(rows.some((row) => row.action === 'invoice.issued')).toBe(true)
  })
})
