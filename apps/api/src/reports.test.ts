// Report tests against the real Supabase project. Every expected figure is worked out by hand.
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { provisionBusiness } from './modules/tenancy/provision'
import { closeDb } from './platform/db'
import { createSession, supabaseAdmin } from './platform/supabase'
import { request } from './testing'

const run = crypto.randomUUID().slice(0, 8)
const emailFor = (label: string) => `rep-${label}-${run}@staff.isoform.invalid`

let a: Awaited<ReturnType<typeof provisionBusiness>>
let b: Awaited<ReturnType<typeof provisionBusiness>>
let owner: string
let ownerB: string
let cashier: string
let manager: string
let variant: string
let methods: Record<string, string>
let today: string
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

async function bill() {
  const created = await call('POST', '/orders', cashier, { id: crypto.randomUUID(), orderType: 'takeaway' })
  const added = await call('POST', `/orders/${created.body.id}/items`, cashier, { id: crypto.randomUUID(), variantId: variant })
  const issued = await call('POST', `/orders/${created.body.id}/finalize`, cashier, { version: added.body.version, invoices: [{ id: crypto.randomUUID() }] })
  return issued.body.invoices[0].id as string
}

const pay = async (invoiceId: string, kind: string, amount: string, tipAmount = '0') =>
  (await call('POST', '/payments', cashier, {
    id: crypto.randomUUID(), methodId: methods[kind], amount, tipAmount,
    reference: kind === 'cash' ? undefined : crypto.randomUUID().slice(0, 12),
    allocations: [{ invoiceId, amount }],
  })).body

const report = async (token = owner, query = `from=${today}`) => (await call('GET', `/reports/daily?${query}`, token)).body

beforeAll(async () => {
  db = new pg.Client({ connectionString: process.env.DATABASE_URL_DIRECT, ssl: { rejectUnauthorized: false } })
  await db.connect()
  const base = { legalName: 'Legal', scheme: 'regular' as const, stateCode: '33', address: 'A', branchName: 'Main', branchCode: 'MN', ownerName: 'Owner' }
  a = await provisionBusiness({ ...base, displayName: 'Rep A', gstin: '33ABCDE1234F1Z5', ownerEmail: emailFor('a') })
  b = await provisionBusiness({ ...base, displayName: 'Rep B', gstin: '33ABCDE1234F2Z4', ownerEmail: emailFor('b') })
  users.push(a.userId, b.userId)
  owner = (await createSession(emailFor('a'))).access_token
  ownerB = (await createSession(emailFor('b'))).access_token

  const made = await call('POST', '/staff', owner, { displayName: 'Cashier', role: 'cashier', pin: '4821', branchIds: [a.branchId] })
  const { rows: [row] } = await db.query(`select user_id from app.memberships where id = $1`, [made.body.id])
  users.push(row.user_id)
  const { data } = await supabaseAdmin.auth.admin.getUserById(row.user_id)
  cashier = (await createSession(data.user!.email!)).access_token

  const managerEmail = emailFor('manager')
  const created = await supabaseAdmin.auth.admin.createUser({ email: managerEmail, email_confirm: true })
  users.push(created.data.user!.id)
  const { rows: [member] } = await db.query(
    `insert into app.memberships (tenant_id, user_id, display_name, role) values ($1, $2, 'Manager', 'manager') returning id`,
    [a.tenantId, created.data.user!.id],
  )
  await db.query(`insert into app.branch_memberships (tenant_id, membership_id, branch_id) values ($1, $2, $3)`, [a.tenantId, member.id, a.branchId])
  manager = (await createSession(managerEmail)).access_token

  const rate = (await call('POST', '/tax-rates', owner, { name: 'GST 5%', cgstRate: '2.5', sgstRate: '2.5' })).body.id
  const category = (await call('POST', '/categories', owner, { name: 'Food' })).body.id
  await call('POST', '/products', owner, { name: 'Thali', categoryId: category, taxRateId: rate, variants: [{ name: 'Regular', price: '952' }] })
  variant = (await call('GET', '/menu', owner)).body.products[0].variants[0].id
  methods = Object.fromEntries((await call('GET', '/payment-methods', owner)).body.items.map((m: any) => [m.kind, m.id]))
  const { rows: [{ date }] } = await db.query(
    `select ((now() at time zone timezone) - day_cutoff::interval)::date::text as date from app.branches where id = $1`, [a.branchId],
  )
  today = date

  // The day: bill 1 paid and confirmed by UPI with a ₹50 tip, bill 2 part-paid in cash,
  // bill 3 paid by card then voided, and bill 4 cancelled by credit note, then an order cancelled.
  const register = (await call('GET', '/registers', owner)).body.items[0].id
  const session = (await call('POST', '/cash-sessions', cashier, { id: crypto.randomUUID(), registerId: register, openingAmount: '100' })).body.id

  const first = await bill()
  const upi = await pay(first, 'upi', '1000', '50')
  await call('POST', `/payments/${upi.id}/confirm`, manager)

  const second = await bill()
  await pay(second, 'cash', '400')

  const third = await bill()
  const card = await pay(third, 'card', '1000')
  await call('POST', `/payments/${card.id}/void`, manager, { reason: 'Wrong bill' })

  const fourth = await bill()
  await call('POST', `/invoices/${fourth}/credit-notes`, manager, { id: crypto.randomUUID(), kind: 'cancellation', reason: 'Cancelled' })

  const abandoned = await call('POST', '/orders', cashier, { id: crypto.randomUUID(), orderType: 'takeaway' })
  await call('POST', `/orders/${abandoned.body.id}/cancel`, cashier, { version: abandoned.body.version, reason: 'Left' })

  const refundable = await bill()
  const refundPayment = await pay(refundable, 'upi', '1000')
  await call('POST', `/payments/${refundPayment.id}/refunds`, manager, { id: crypto.randomUUID(), invoiceId: refundable, amount: '200', methodId: methods.upi, reason: 'Late' })

  await call('POST', `/cash-sessions/${session}/close`, cashier, { countedAmount: '490' })
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

describe('a day’s figures', () => {
  it('reports sales without tax, net of credit notes', async () => {
    const { sales } = await report()
    expect(sales.bills).toBe(5)
    expect(sales.credit_notes).toBe(1)
    expect(sales.billed_sales).toBe('4760.00')
    expect(sales.credited_sales).toBe('952.00')
    expect(sales.net_sales).toBe('3808.00')
  })
  it('reports tax collected, net of credit notes', async () => {
    const { sales } = await report()
    expect(sales.cgst).toBe('95.20')
    expect(sales.sgst).toBe('95.20')
    expect(sales.net_total).toBe('4000.00')
  })
  it('keeps recorded and confirmed payments apart', async () => {
    const { paymentTotals } = await report()
    expect(paymentTotals.recorded).toBe('2400.00')
    expect(paymentTotals.confirmed).toBe('1000.00')
    expect(paymentTotals.awaiting_check).toBe('1400.00')
    expect(paymentTotals.awaiting_count).toBe(2)
  })
  it('leaves voided payments out', async () => {
    const { payments } = await report()
    expect(payments.find((p: any) => p.kind === 'card').recorded).toBe('0.00')
  })
  it('breaks payments down by method', async () => {
    const { payments } = await report()
    expect(payments.find((p: any) => p.kind === 'upi')).toMatchObject({ recorded: '2000.00', confirmed: '1000.00' })
    expect(payments.find((p: any) => p.kind === 'cash')).toMatchObject({ recorded: '400.00', confirmed: '0.00' })
  })
  it('keeps tips out of sales and payments', async () => {
    const { paymentTotals } = await report()
    expect(paymentTotals.tips).toBe('50.00')
  })
  it('reports refunds separately', async () => {
    const { refunds } = await report()
    expect(refunds).toMatchObject({ count: 1, total: '200.00' })
  })
  it('reports what is still owed', async () => {
    const { outstanding } = await report()
    expect(outstanding.total).toBe('1800.00')
    expect(outstanding.bills).toBe(3)
  })
  it('counts orders by outcome', async () => {
    const { orders } = await report()
    expect(orders).toMatchObject({ billed: 5, cancelled: 1 })
  })
  it('shows the cash difference', async () => {
    const { cash } = await report()
    expect(cash[0]).toMatchObject({ expected_amount: '500.00', counted_amount: '490.00', variance: '-10.00' })
  })
  it('groups sales by item and tax rate', async () => {
    const { items, taxRates } = await report()
    expect(items[0]).toMatchObject({ description: 'Thali', sales: '4760.00' })
    expect(taxRates[0]).toMatchObject({ rate: '5.000', taxable: '4760.00', tax: '238.00' })
  })
  it('ignores days outside the range', async () => {
    const { sales } = await report(owner, 'from=2020-01-01&to=2020-01-31')
    expect(sales).toMatchObject({ bills: 0, net_sales: '0.00' })
  })
  it('refuses a range that is too long or backwards', async () => {
    expect((await call('GET', '/reports/daily?from=2025-01-01&to=2026-06-01', owner)).status).toBe(422)
    expect((await call('GET', '/reports/daily?from=2026-02-01&to=2026-01-01', owner)).status).toBe(422)
  })
})

describe('permissions and isolation', () => {
  it('keeps reports from cashiers', async () => {
    expect((await call('GET', `/reports/daily?from=${today}`, cashier)).status).toBe(403)
  })
  it('lets a manager read their branch', async () => {
    expect((await call('GET', `/reports/daily?from=${today}`, manager)).body.sales.bills).toBe(5)
  })
  it('lets an accountant review cash but not use the drawer', async () => {
    const email = emailFor('accountant')
    const created = await supabaseAdmin.auth.admin.createUser({ email, email_confirm: true })
    users.push(created.data.user!.id)
    const { rows: [member] } = await db.query(
      `insert into app.memberships (tenant_id, user_id, display_name, role) values ($1, $2, 'Accountant', 'accountant') returning id`,
      [a.tenantId, created.data.user!.id],
    )
    await db.query(`insert into app.branch_memberships (tenant_id, membership_id, branch_id) values ($1, $2, $3)`, [a.tenantId, member.id, a.branchId])
    const token = (await createSession(email)).access_token
    const sessions = await call('GET', '/cash-sessions', token)
    expect(sessions.body.items[0].variance).toBe('-10.00')
    const reviewed = await call('POST', `/cash-sessions/${sessions.body.items[0].id}/review`, token, { note: 'Checked' })
    expect(reviewed.body.status).toBe('reviewed')
    expect((await call('POST', '/cash-sessions', token, { id: crypto.randomUUID(), registerId: crypto.randomUUID(), openingAmount: '1' })).status).toBe(403)
  })
  it('shows a business nothing from another', async () => {
    const other = await report(ownerB)
    expect(other.sales).toMatchObject({ bills: 0, net_total: '0.00' })
    expect(other.payments).toEqual([])
    expect(other.cash).toEqual([])
    expect(other.items).toEqual([])
  })
  it('refuses another business’s branch', async () => {
    expect((await call('GET', `/reports/daily?from=${today}&branchId=${a.branchId}`, ownerB)).status).toBe(403)
  })
})
