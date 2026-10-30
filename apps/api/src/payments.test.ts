// Payment and cash tests against the real Supabase project. Removes everything it creates.
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { request } from './testing.js'
import { provisionBusiness } from './modules/tenancy/provision.js'
import { closeDb } from './platform/db.js'
import { createSession, supabaseAdmin } from './platform/supabase.js'

const run = crypto.randomUUID().slice(0, 8)
const emailFor = (label: string) => `pay-${label}-${run}@staff.isoform.invalid`

let a: Awaited<ReturnType<typeof provisionBusiness>>
let b: Awaited<ReturnType<typeof provisionBusiness>>
let owner: string
let ownerB: string
let cashier: string
let waiter: string
let manager: string
let variant: string
let methods: Record<string, string>
let register: string
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

async function staff(role: string) {
  const made = await call('POST', '/staff', owner, { displayName: `Staff ${role}`, role, pin: '4821', branchIds: [a.branchId] })
  const { rows: [row] } = await db.query(`select user_id from app.memberships where id = $1`, [made.body.id])
  users.push(row.user_id)
  const { data } = await supabaseAdmin.auth.admin.getUserById(row.user_id)
  return (await createSession(data.user!.email!)).access_token
}

async function addManager() {
  const email = emailFor('manager')
  const { data } = await supabaseAdmin.auth.admin.createUser({ email, email_confirm: true })
  users.push(data.user!.id)
  const { rows: [row] } = await db.query(
    `insert into app.memberships (tenant_id, user_id, display_name, role) values ($1, $2, 'Manager', 'manager') returning id`,
    [a.tenantId, data.user!.id],
  )
  await db.query(`insert into app.branch_memberships (tenant_id, membership_id, branch_id) values ($1, $2, $3)`, [a.tenantId, row.id, a.branchId])
  return (await createSession(email)).access_token
}

async function invoice(token = cashier) {
  const created = await call('POST', '/orders', token, { id: crypto.randomUUID(), orderType: 'takeaway' })
  const added = await call('POST', `/orders/${created.body.id}/items`, token, { id: crypto.randomUUID(), variantId: variant })
  const issued = await call('POST', `/orders/${created.body.id}/finalize`, token, { version: added.body.version, invoices: [{ id: crypto.randomUUID() }] })
  return issued.body.invoices[0].id as string
}

const pay = (invoiceId: string, kind: string, amount: string, extra: object = {}, token = cashier, allocate = amount) =>
  call('POST', '/payments', token, {
    id: crypto.randomUUID(), methodId: methods[kind], amount,
    reference: kind === 'cash' ? undefined : crypto.randomUUID().slice(0, 12),
    allocations: [{ invoiceId, amount: allocate }], ...extra,
  })

const balance = async (id: string) => (await call('GET', `/invoices/${id}`, owner)).body.outstanding
const openDrawer = (amount = '1000.00', token = cashier) =>
  call('POST', '/cash-sessions', token, { id: crypto.randomUUID(), registerId: register, openingAmount: amount })
const closeDrawer = (id: string, counted: string, token = cashier) => call('POST', `/cash-sessions/${id}/close`, token, { countedAmount: counted })

beforeAll(async () => {
  db = new pg.Client({ connectionString: process.env.DATABASE_URL_DIRECT, ssl: { rejectUnauthorized: false } })
  await db.connect()
  const base = { legalName: 'Legal', scheme: 'regular' as const, stateCode: '33', address: 'A', branchName: 'Main', branchCode: 'MN', ownerName: 'Owner' }
  a = await provisionBusiness({ ...base, displayName: 'Pay A', gstin: '33ABCDE1234F1Z5', ownerEmail: emailFor('a') })
  b = await provisionBusiness({ ...base, displayName: 'Pay B', gstin: '33ABCDE1234F2Z4', ownerEmail: emailFor('b') })
  users.push(a.userId, b.userId)
  owner = (await createSession(emailFor('a'))).access_token
  ownerB = (await createSession(emailFor('b'))).access_token
  cashier = await staff('cashier')
  waiter = await staff('waiter')
  manager = await addManager()

  const rate = (await call('POST', '/tax-rates', owner, { name: 'GST 5%', cgstRate: '2.5', sgstRate: '2.5' })).body.id
  const category = (await call('POST', '/categories', owner, { name: 'Food' })).body.id
  await call('POST', '/products', owner, { name: 'Thali', categoryId: category, taxRateId: rate, variants: [{ name: 'Regular', price: '952' }] })
  variant = (await call('GET', '/menu', owner)).body.products[0].variants[0].id
  methods = Object.fromEntries((await call('GET', '/payment-methods', owner)).body.items.map((m: any) => [m.kind, m.id]))
  register = (await call('GET', '/registers', owner)).body.items[0].id
})

afterAll(async () => {
  for (const tenant of [a.tenantId, b.tenantId]) {
    for (const table of ['audit_log', 'idempotency_keys', 'cash_movements', 'financial_status_history', 'refunds', 'payment_allocations', 'payments',
      'credit_note_lines', 'credit_notes', 'invoice_lines', 'invoices', 'invoice_series', 'order_discounts', 'order_item_addons',
      'order_status_history', 'order_items', 'orders', 'branch_variant_overrides', 'product_addons', 'addons', 'product_variants', 'products',
      'categories', 'tax_rates', 'customers', 'cash_sessions', 'branch_memberships', 'registers', 'payment_methods', 'memberships', 'branches', 'tax_registrations']) {
      await db.query(`delete from app.${table} where tenant_id = $1`, [tenant])
    }
    await db.query(`delete from app.tenants where id = $1`, [tenant])
  }
  for (const id of users) await supabaseAdmin.auth.admin.deleteUser(id)
  await db.end()
  await closeDb()
})

describe('recording payments', () => {
  it('clears a ₹1,000 bill with UPI and card', async () => {
    const id = await invoice()
    expect((await pay(id, 'upi', '700')).status).toBe(201)
    expect(await balance(id)).toBe('300.00')
    expect((await pay(id, 'card', '300')).status).toBe(201)
    expect(await balance(id)).toBe('0.00')
  })
  it('never treats a recorded payment as confirmed', async () => {
    const paid = await pay(await invoice(), 'upi', '1000')
    expect(paid.body.status).toBe('recorded')
  })
  it('refuses more than the bill owes, and saves nothing', async () => {
    const id = await invoice()
    const payment = crypto.randomUUID()
    const result = await pay(id, 'upi', '1500', { id: payment }, cashier, '1500')
    expect(result.status).toBe(409)
    expect((await db.query(`select 1 from app.payments where id = $1`, [payment])).rowCount).toBe(0)
  })
  it('requires a reference where the method needs one', async () => {
    const id = await invoice()
    expect((await pay(id, 'upi', '100', { reference: undefined })).status).toBe(422)
  })
  it('refuses a transaction reference used twice', async () => {
    const reference = `DUP-${run}`
    expect((await pay(await invoice(), 'upi', '100', { reference })).status).toBe(201)
    expect((await pay(await invoice(), 'upi', '100', { reference })).status).toBe(409)
  })
  it('keeps tips out of the bill', async () => {
    const id = await invoice()
    const paid = await pay(id, 'upi', '1000', { tipAmount: '50' })
    expect(paid.body.tip_amount).toBe('50.00')
    expect(await balance(id)).toBe('0.00')
  })
  it('lets only one of 5 racing payments take the last ₹1,000', async () => {
    const id = await invoice()
    const replies = await Promise.all(Array.from({ length: 5 }, () => pay(id, 'upi', '1000')))
    expect(replies.filter((r) => r.status === 201)).toHaveLength(1)
    expect(await balance(id)).toBe('0.00')
  })
  it('saves once when a request is replayed', async () => {
    const id = await invoice()
    const body = { id: crypto.randomUUID(), methodId: methods.upi, amount: '1000', reference: crypto.randomUUID().slice(0, 12), allocations: [{ invoiceId: id, amount: '1000' }] }
    const headers = { 'idempotency-key': crypto.randomUUID() }
    const replies = await Promise.all(Array.from({ length: 4 }, () => call('POST', '/payments', cashier, body, headers)))
    expect(replies.every((r) => r.status === 201)).toBe(true)
    expect(await balance(id)).toBe('0.00')
  })
})

describe('verification', () => {
  it('stops a cashier confirming', async () => {
    const paid = await pay(await invoice(), 'upi', '1000')
    expect((await call('POST', `/payments/${paid.body.id}/confirm`, cashier)).status).toBe(403)
  })
  it('stops people confirming their own payment', async () => {
    const paid = await pay(await invoice(manager), 'upi', '1000', {}, manager)
    const result = await call('POST', `/payments/${paid.body.id}/confirm`, manager)
    expect(result.status).toBe(403)
    expect(result.body.code).toBe('needs_second_person')
  })
  it('records who confirmed and when', async () => {
    const paid = await pay(await invoice(), 'upi', '1000')
    const done = await call('POST', `/payments/${paid.body.id}/confirm`, manager)
    expect(done.body.status).toBe('confirmed')
    expect(done.body.history[0]).toMatchObject({ from_status: 'recorded', to_status: 'confirmed', changed_by: 'Manager' })
  })
  it('reopens the bill when a payment fails', async () => {
    const id = await invoice()
    const paid = await pay(id, 'upi', '1000')
    const failed = await call('POST', `/payments/${paid.body.id}/fail`, manager, { reason: 'Not in the bank' })
    expect(failed.body.status).toBe('failed')
    expect(await balance(id)).toBe('1000.00')
  })
  it('needs a reason to void', async () => {
    const paid = await pay(await invoice(), 'upi', '1000')
    expect((await call('POST', `/payments/${paid.body.id}/void`, manager, {})).status).toBe(422)
  })
  it('refuses to reopen a voided payment', async () => {
    const paid = await pay(await invoice(), 'upi', '1000')
    await call('POST', `/payments/${paid.body.id}/void`, manager, { reason: 'Mistake' })
    expect((await call('POST', `/payments/${paid.body.id}/confirm`, manager)).status).toBe(409)
  })
})

describe('refunds', () => {
  it('tracks a part refund, then a full refund, keeping the payment', async () => {
    const id = await invoice()
    const paid = (await pay(id, 'upi', '1000')).body
    const refund = (amount: string) => call('POST', `/payments/${paid.id}/refunds`, manager, {
      id: crypto.randomUUID(), invoiceId: id, amount, methodId: methods.upi, reason: 'Wrong item',
    })
    expect((await refund('400')).body.refund_state).toBe('partially_refunded')
    expect((await refund('700')).status).toBe(409)
    const full = await refund('600')
    expect(full.body.refund_state).toBe('refunded')
    expect(full.body.amount).toBe('1000.00')
  })
  it('stops a cashier refunding', async () => {
    const id = await invoice()
    const paid = (await pay(id, 'upi', '1000')).body
    const result = await call('POST', `/payments/${paid.id}/refunds`, cashier, { id: crypto.randomUUID(), invoiceId: id, amount: '10', methodId: methods.upi, reason: 'Mine' })
    expect(result.status).toBe(403)
  })
})

describe('customers and unpaid bills', () => {
  it('shows who owes an unpaid bill', async () => {
    const customer = await call('POST', '/customers', cashier, { name: 'Ravi Kumar', phone: '9876543210' })
    const created = await call('POST', '/orders', cashier, { id: crypto.randomUUID(), orderType: 'takeaway' })
    const added = await call('POST', `/orders/${created.body.id}/items`, cashier, { id: crypto.randomUUID(), variantId: variant })
    const named = await call('PATCH', `/orders/${created.body.id}`, cashier, { version: added.body.version, customerId: customer.body.id })
    expect(named.body.customer_name).toBe('Ravi Kumar')
    const issued = await call('POST', `/orders/${created.body.id}/finalize`, cashier, { version: named.body.version, invoices: [{ id: crypto.randomUUID() }] })
    const unpaid = await call('GET', '/invoices?unpaid=true', owner)
    const row = unpaid.body.items.find((item: any) => item.id === issued.body.invoices[0].id)
    expect(row).toMatchObject({ customer_name: 'Ravi Kumar', outstanding: '1000.00' })
  })
  it('does not let a business attach another’s customer', async () => {
    const other = await call('POST', '/customers', ownerB, { name: 'Other', phone: '9000000000' })
    const created = await call('POST', '/orders', cashier, { id: crypto.randomUUID(), orderType: 'takeaway' })
    expect((await call('PATCH', `/orders/${created.body.id}`, cashier, { version: created.body.version, customerId: other.body.id })).status).toBe(422)
  })
})

describe('cash drawer', () => {
  it('refuses cash with no open session', async () => {
    expect((await pay(await invoice(), 'cash', '100')).body.code).toBe('no_open_session')
  })
  it('runs a whole shift and reports the shortfall', async () => {
    const opened = await openDrawer('1000')
    expect(opened.status).toBe(201)
    const session = opened.body.id
    expect((await openDrawer('1')).status).toBe(409)

    const id = await invoice()
    const sale = await pay(id, 'cash', '1000', { tipAmount: '20' })
    expect(sale.status).toBe(201)

    const mistaken = await pay(await invoice(), 'cash', '300')
    await call('POST', `/payments/${mistaken.body.id}/void`, manager, { reason: 'Wrong bill' })

    const refundId = await invoice()
    const refundable = (await pay(refundId, 'cash', '200')).body
    await call('POST', `/payments/${refundable.id}/refunds`, manager, { id: crypto.randomUUID(), invoiceId: refundId, amount: '50', methodId: methods.cash, reason: 'Cold food' })

    const drop = await call('POST', `/cash-sessions/${session}/movements`, manager, { type: 'safe_drop', amount: '500', reason: 'To safe' })
    expect(drop.body.running_expected).toBe('1670.00')
    expect((await call('POST', `/cash-sessions/${session}/movements`, cashier, { type: 'paid_out', amount: '1', reason: 'Mine' })).status).toBe(403)

    const blind = await call('GET', `/cash-sessions/${session}`, cashier)
    expect(blind.body.expected_amount).toBeNull()
    expect(blind.body).not.toHaveProperty('running_expected')
    expect(blind.body.movements).toEqual([])

    const closed = await closeDrawer(session, '1650')
    expect(closed.body.status).toBe('closed')
    expect(closed.body.variance).toBeNull()

    const seen = await call('GET', `/cash-sessions/${session}`, manager)
    expect(seen.body).toMatchObject({ expected_amount: '1670.00', counted_amount: '1650.00', variance: '-20.00' })

    expect((await pay(await invoice(), 'cash', '100')).body.code).toBe('no_open_session')
    expect((await closeDrawer(session, '1670')).status).toBe(409)
    expect((await call('POST', `/cash-sessions/${session}/review`, manager, {})).status).toBe(409)
    const reviewed = await call('POST', `/cash-sessions/${session}/review`, manager, { note: 'Short ₹20, spoke to cashier' })
    expect(reviewed.body).toMatchObject({ status: 'reviewed', variance: '-20.00' })
  })
  it('stops the person who closed from reviewing', async () => {
    const session = (await openDrawer('100', manager)).body.id
    await closeDrawer(session, '100', manager)
    const result = await call('POST', `/cash-sessions/${session}/review`, manager, { note: 'Fine' })
    expect(result.status).toBe(409)
    await call('POST', `/cash-sessions/${session}/review`, owner, { note: 'Fine' })
  })
  it('stops a waiter using the drawer', async () => {
    expect((await openDrawer('1', waiter)).status).toBe(403)
  })
  it('counts every sale that races the close', async () => {
    const session = (await openDrawer('0')).body.id
    const bills = await Promise.all(Array.from({ length: 4 }, () => invoice()))
    const sales = bills.map((id) => pay(id, 'cash', '100'))
    const closing = closeDrawer(session, '0')
    const replies = await Promise.all(sales)
    await closing
    const saved = replies.filter((r) => r.status === 201).length
    const seen = await call('GET', `/cash-sessions/${session}`, owner)
    expect(seen.body.expected_amount).toBe(`${saved * 100}.00`)
    await call('POST', `/cash-sessions/${session}/review`, owner, { note: 'Race test' })
  })
})

describe('isolation', () => {
  it('cannot pay another business’s bill', async () => {
    const id = await invoice()
    const methodB = (await call('GET', '/payment-methods', ownerB)).body.items.find((m: any) => m.kind === 'upi').id
    const result = await call('POST', '/payments', ownerB, {
      id: crypto.randomUUID(), methodId: methodB, amount: '10', reference: 'X', allocations: [{ invoiceId: id, amount: '10' }],
    })
    expect(result.status).toBe(422)
    expect(await balance(id)).toBe('1000.00')
  })
  it('cannot use another business’s payment method', async () => {
    const result = await call('POST', '/payments', ownerB, { id: crypto.randomUUID(), methodId: methods.upi, amount: '10', reference: 'X' })
    expect(result.status).toBe(422)
  })
  it('cannot see or change another business’s payments and sessions', async () => {
    const paid = await pay(await invoice(), 'upi', '1000')
    expect((await call('GET', `/payments/${paid.body.id}`, ownerB)).status).toBe(404)
    expect((await call('POST', `/payments/${paid.body.id}/confirm`, ownerB)).status).toBe(404)
    expect((await call('GET', '/payments', ownerB)).body.items).toEqual([])
    expect((await call('GET', '/cash-sessions', ownerB)).body.items).toEqual([])
    expect((await call('GET', '/customers', ownerB)).body.items.every((c: any) => c.phone !== '9876543210')).toBe(true)
  })
})
