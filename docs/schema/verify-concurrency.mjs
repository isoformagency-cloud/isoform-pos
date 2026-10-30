// Tests the draft schema on a real Supabase project with simultaneous connections.
// It installs the schema, runs the tests, then removes everything it created.
// Only for a spare, empty project. It refuses to run once migrations have been applied.
import { readdirSync, readFileSync } from 'node:fs'
import pg from 'pg'

const migrations = new URL('../../supabase/migrations/', import.meta.url)
const schemaSql = () =>
  readdirSync(migrations)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((file) => readFileSync(new URL(file, migrations), 'utf8'))
    .join('\n')

const ssl = { rejectUnauthorized: false }
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL_DIRECT, ssl })
const direct = new pg.Pool({ connectionString: process.env.DATABASE_URL_DIRECT, ssl, max: 20 })
const pooler = new pg.Pool({ connectionString: process.env.DATABASE_URL_POOLER, ssl, max: 15 })

const uuid = () => crypto.randomUUID()
const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}

const users = []
function makeTenant() {
  return {
    id: uuid(), tax: uuid(), branch: uuid(), register: uuid(), owner: uuid(), cashier: uuid(),
    rate: uuid(), category: uuid(), product: uuid(), variant: uuid(), cash: uuid(), upi: uuid(),
    series: uuid(),
  }
}

async function seed(t, label) {
  const q = (sql, params) => admin.query(sql, params)
  await q(`insert into app.tenants (id, display_name, status) values ($1, $2, 'active')`, [t.id, label])
  await q(`insert into app.tax_registrations (id, tenant_id, legal_name, gstin, state_code, scheme, address)
           values ($1, $2, 'Legal', '33ABCDE1234F1Z5', '33', 'regular', 'Address')`, [t.tax, t.id])
  await q(`insert into app.branches (id, tenant_id, tax_registration_id, name, code) values ($1, $2, $3, 'Main', 'MN')`, [t.branch, t.id, t.tax])
  await q(`insert into app.registers (id, tenant_id, branch_id, name) values ($1, $2, $3, 'Main')`, [t.register, t.id, t.branch])
  for (const [member, role] of [[t.owner, 'owner'], [t.cashier, 'cashier']]) {
    const user = uuid()
    users.push(user)
    await q(`insert into auth.users (id) values ($1)`, [user])
    await q(`insert into app.memberships (id, tenant_id, user_id, display_name, role) values ($1, $2, $3, $4, $4)`, [member, t.id, user, role])
  }
  await q(`insert into app.tax_rates (id, tenant_id, name, cgst_rate, sgst_rate) values ($1, $2, 'GST 5%', 2.5, 2.5)`, [t.rate, t.id])
  await q(`insert into app.categories (id, tenant_id, name) values ($1, $2, 'Food')`, [t.category, t.id])
  await q(`insert into app.products (id, tenant_id, category_id, name, tax_rate_id) values ($1, $2, $3, 'Dosa', $4)`, [t.product, t.id, t.category, t.rate])
  await q(`insert into app.product_variants (id, tenant_id, product_id, price) values ($1, $2, $3, 952)`, [t.variant, t.id, t.product])
  await q(`insert into app.payment_methods (id, tenant_id, name, kind) values ($1, $2, 'Cash', 'cash'), ($3, $2, 'UPI', 'upi')`, [t.cash, t.id, t.upi])
  await q(`insert into app.invoice_series (id, tenant_id, tax_registration_id, branch_id, document_type, prefix, financial_year)
           values ($1, $2, $3, $4, 'tax_invoice', 'MN', '2627')`, [t.series, t.id, t.tax, t.branch])
}

async function tx(pool, t, fn, member = t?.owner) {
  const c = await pool.connect()
  try {
    await c.query('begin')
    await c.query(
      `select set_config('app.tenant_id', $1, true), set_config('app.branch_ids', $2, true), set_config('app.membership_id', $3, true)`,
      [t?.id ?? '', t ? `{${t.branch}}` : '{}', member ?? ''],
    )
    await c.query('set local role app_user')
    const value = await fn(c)
    await c.query('commit')
    return value
  } catch (error) {
    await c.query('rollback').catch(() => {})
    throw error
  } finally {
    c.release()
  }
}

const settle = async (jobs) => {
  const outcome = await Promise.allSettled(jobs)
  return {
    won: outcome.filter((r) => r.status === 'fulfilled').map((r) => r.value),
    lost: outcome.filter((r) => r.status === 'rejected').map((r) => r.reason.message),
  }
}

let orderNumber = 0
const addOrder = (c, t, id = uuid()) =>
  c.query(
    `insert into app.orders (id, tenant_id, branch_id, display_number, order_type, business_date, created_by)
     values ($1, $2, $3, $4, 'dine_in', '2026-10-30', $5)`,
    [id, t.id, t.branch, ++orderNumber, t.owner],
  ).then(() => id)

async function addInvoice(c, t, orderId, id = uuid()) {
  const { rows: [{ number }] } = await c.query(
    `insert into app.invoices (id, tenant_id, branch_id, tax_registration_id, order_id, series_id, document_type, number,
       invoice_date, business_date, seller_snapshot, taxable_total, cgst_total, sgst_total, round_off, grand_total, issued_by)
     values ($1, $2, $3, $4, $5, $6, 'tax_invoice', 'x', '2026-10-30', '2026-10-30', '{}', 952, 23.8, 23.8, 0.4, 1000, $7)
     returning number`,
    [id, t.id, t.branch, t.tax, orderId, t.series, t.owner],
  )
  await c.query(
    `insert into app.invoice_lines (tenant_id, branch_id, invoice_id, line_number, description, quantity, unit_price,
       taxable_value, cgst_rate, sgst_rate, cgst, sgst)
     values ($1, $2, $3, 1, 'Dosa', 1, 952, 952, 2.5, 2.5, 23.8, 23.8)`,
    [t.id, t.branch, id],
  )
  return number
}

const addPayment = (c, t, id, amount, reference) =>
  c.query(
    `insert into app.payments (id, tenant_id, branch_id, method_id, method_kind, amount, reference, received_at, business_date, recorded_by)
     values ($1, $2, $3, $4, 'upi', $5, $6, now(), '2026-10-30', $7)`,
    [id, t.id, t.branch, t.upi, amount, reference, t.owner],
  )

const allocate = (c, t, paymentId, invoiceId, amount) =>
  c.query(
    `insert into app.payment_allocations (tenant_id, branch_id, payment_id, invoice_id, amount, created_by)
     values ($1, $2, $3, $4, $5, $6)`,
    [t.id, t.branch, paymentId, invoiceId, amount, t.owner],
  )

async function invoiceNumbers(t) {
  console.log('\nInvoice numbers under load')
  const orders = await tx(direct, t, async (c) => {
    const list = []
    for (let i = 0; i < 60; i += 1) list.push(await addOrder(c, t))
    return list
  })
  const started = performance.now()
  const { won, lost } = await settle(
    orders.map((order, index) =>
      tx(direct, t, async (c) => {
        const number = await addInvoice(c, t, order)
        if (index % 6 === 5) throw new Error('simulated failure')
        return number
      }),
    ),
  )
  const seconds = (performance.now() - started) / 1000
  const used = won.map((n) => Number(n.split('-')[2])).sort((a, b) => a - b)
  check('50 invoices commit while 10 others fail', won.length === 50 && lost.every((m) => m === 'simulated failure'), `${won.length} won`)
  check('No number is used twice', new Set(used).size === used.length)
  check('No gaps: numbers run 1 to 50', used.every((n, i) => n === i + 1), `max ${used.at(-1)}`)
  console.log(`  INFO  ${(60 / seconds).toFixed(1)} invoices a second from this PC, on one series`)
}

async function allocations(t) {
  console.log('\nOverpayment races')
  const invoice = uuid()
  const payments = Array.from({ length: 20 }, uuid)
  await tx(direct, t, async (c) => {
    await addInvoice(c, t, await addOrder(c, t), invoice)
    for (const [i, id] of payments.entries()) await addPayment(c, t, id, 100, `RACE-${i}`)
  })
  const { won, lost } = await settle(payments.map((id) => tx(direct, t, (c) => allocate(c, t, id, invoice, 100))))
  const { rows: [{ outstanding }] } = await tx(direct, t, (c) => c.query(`select outstanding from app.invoice_balances where invoice_id = $1`, [invoice]))
  check('20 payments race for a ₹1,000 bill: exactly 10 fit', won.length === 10, `${won.length} won`)
  check('The rest are rejected for the right reason', lost.every((m) => /exceeds the invoice balance/.test(m)))
  check('The bill ends at exactly ₹0', Number(outstanding) === 0, outstanding)

  const invoice2 = uuid()
  const payment = uuid()
  await tx(direct, t, async (c) => {
    await addInvoice(c, t, await addOrder(c, t), invoice2)
    await addPayment(c, t, payment, 500, 'REFUND-RACE')
    await allocate(c, t, payment, invoice2, 500)
  })
  const refunds = await settle(
    Array.from({ length: 10 }, () =>
      tx(direct, t, (c) =>
        c.query(
          `insert into app.refunds (id, tenant_id, branch_id, payment_id, invoice_id, method_id, method_kind, amount, reason,
             refunded_at, business_date, recorded_by)
           values ($1, $2, $3, $4, $5, $6, 'upi', 100, 'Race', now(), '2026-10-30', $7)`,
          [uuid(), t.id, t.branch, payment, invoice2, t.upi, t.owner],
        ),
      ),
    ),
  )
  check('10 refunds race on a ₹500 payment: exactly 5 fit', refunds.won.length === 5, `${refunds.won.length} won`)
}

async function duplicates(t) {
  console.log('\nDuplicate records')
  const reference = await settle(Array.from({ length: 10 }, () => tx(direct, t, (c) => addPayment(c, t, uuid(), 50, 'SAME-REF'))))
  check('10 tills enter one reference: one is saved', reference.won.length === 1, `${reference.won.length} won`)
  const replay = uuid()
  const retry = await settle(Array.from({ length: 10 }, () => tx(direct, t, (c) => addPayment(c, t, replay, 50, null))))
  check('A double tap sent 10 times saves once', retry.won.length === 1, `${retry.won.length} won`)
}

async function orderConflicts(t) {
  console.log('\nTwo people editing one order')
  const order = await tx(direct, t, (c) => addOrder(c, t))
  const { won } = await settle(
    Array.from({ length: 10 }, (_, i) =>
      tx(direct, t, (c) => c.query(`update app.orders set notes = $1 where id = $2 and version = 1`, [`edit ${i}`, order]).then((r) => r.rowCount)),
    ),
  )
  check('Only one stale save wins', won.reduce((sum, n) => sum + n, 0) === 1, `${won.reduce((s, n) => s + n, 0)} applied`)
}

async function cashRaces(t) {
  console.log('\nCash drawer races')
  const open = await settle(
    Array.from({ length: 10 }, () => {
      const id = uuid()
      return tx(direct, t, (c) =>
        c.query(
          `insert into app.cash_sessions (id, tenant_id, branch_id, register_id, business_date, opening_amount, opened_by)
           values ($1, $2, $3, $4, '2026-10-30', 1000, $5)`,
          [id, t.id, t.branch, t.register, t.owner],
        ),
      ).then(() => id)
    }),
  )
  check('10 people open one register: one session opens', open.won.length === 1, `${open.won.length} won`)
  const session = open.won[0]

  const move = () =>
    tx(direct, t, (c) =>
      c.query(
        `insert into app.cash_movements (tenant_id, branch_id, cash_session_id, movement_type, direction, amount, reason, recorded_by)
         values ($1, $2, $3, 'paid_in', 1, 10, 'Race', $4)`,
        [t.id, t.branch, session, t.owner],
      ),
    )
  const jobs = Array.from({ length: 30 }, move)
  jobs.splice(15, 0, tx(direct, t, (c) => c.query(`update app.cash_sessions set status = 'closed', counted_amount = 1000 where id = $1`, [session]).then(() => 'closed')))
  jobs.push(...Array.from({ length: 10 }, move))
  const { won, lost } = await settle(jobs)
  const { rows: [row] } = await tx(direct, t, (c) =>
    c.query(`select s.expected_amount, (select coalesce(sum(direction * amount), 0) from app.cash_movements m where m.cash_session_id = s.id) as moved
             from app.cash_sessions s where s.id = $1`, [session]),
  )
  check('The session closes', won.includes('closed'))
  check('Movements after closing are refused', lost.every((m) => /is closed/.test(m)), `${lost.length} refused`)
  check('Expected cash includes every saved movement', Number(row.expected_amount) === 1000 + Number(row.moved), `${row.expected_amount} = 1000 + ${row.moved}`)
}

async function poolerIsolation(a, b) {
  console.log('\nShared connections (transaction pooler)')
  await tx(pooler, a, (c) => addOrder(c, a))
  await tx(pooler, b, (c) => addOrder(c, b))
  const reads = await settle(
    Array.from({ length: 300 }, (_, i) => {
      const t = i % 2 ? a : b
      return tx(pooler, t, async (c) => {
        const { rows } = await c.query(`select distinct tenant_id from app.orders`)
        return rows.every((row) => row.tenant_id === t.id) && rows.length === 1
      })
    }),
  )
  check('300 mixed requests never see the other business', reads.won.length === 300 && reads.won.every(Boolean), `${reads.won.filter(Boolean).length} clean`)

  const leaks = await settle(Array.from({ length: 30 }, () => tx(pooler, null, (c) => c.query(`select id from app.orders`).then((r) => r.rowCount))))
  check('A request with no business sees nothing afterwards', leaks.won.length === 30 && leaks.won.every((n) => n === 0))

  const c = await pooler.connect()
  const { rows: [{ value }] } = await c.query(`select current_setting('app.tenant_id', true) as value`)
  c.release()
  check('Nothing is left on the shared connection', !value, value ?? 'empty')
}

async function speed(t) {
  console.log('\nSpeed with 100,000 orders (database time, excluding network)')
  await admin.query(
    `insert into app.orders (id, tenant_id, branch_id, display_number, order_type, status, business_date, created_by)
     select gen_random_uuid(), $1, $2, n + 100000, 'dine_in', 'finalized', date '2026-10-30' - (n % 365), $3
       from generate_series(1, 100000) n`,
    [t.id, t.branch, t.owner],
  )
  await admin.query(`analyze app.orders`)
  const plan = async (sql, params) =>
    tx(direct, t, async (c) => {
      const { rows } = await c.query(`explain (analyze, format json) ${sql}`, params)
      return rows[0]['QUERY PLAN'][0]
    })
  const list = await plan(`select id from app.orders where tenant_id = $1 and branch_id = $2 and business_date = '2026-10-29' order by created_at desc limit 50`, [t.id, t.branch])
  const open = await plan(`select id from app.orders where tenant_id = $1 and branch_id = $2 and status = 'open'`, [t.id, t.branch])
  check('A day’s orders load in under 50 ms', list['Execution Time'] < 50, `${list['Execution Time'].toFixed(1)} ms`)
  check('Open orders load in under 50 ms', open['Execution Time'] < 50, `${open['Execution Time'].toFixed(1)} ms`)
}

async function teardown() {
  await admin.query(`drop schema if exists app cascade`)
  await admin.query(`drop role if exists isoform_api`)
  await admin.query(`drop role if exists app_user`)
  if (users.length) await admin.query(`delete from auth.users where id = any($1::uuid[])`, [users])
  const { rows: [left] } = await admin.query(
    `select (select count(*)::int from information_schema.schemata where schema_name = 'app') as app_schema,
            (select count(*)::int from pg_roles where rolname = 'app_user') as app_role,
            (select count(*)::int from auth.users) as auth_users`,
  )
  console.log('\nCleanup', left)
}

await admin.connect()
const { rows: [state] } = await admin.query(`select count(*)::int as n from information_schema.schemata where schema_name = 'app'`)
if (state.n) {
  console.log('The app schema already exists, so this test will not run.')
  await admin.end()
  process.exit(2)
}

let crashed = null
try {
  await admin.query(schemaSql())
  console.log('Schema installed on Supabase')
  const a = makeTenant()
  const b = makeTenant()
  await seed(a, 'Tenant A')
  await seed(b, 'Tenant B')
  await invoiceNumbers(a)
  await allocations(a)
  await duplicates(a)
  await orderConflicts(a)
  await cashRaces(a)
  await poolerIsolation(a, b)
  await speed(a)
} catch (error) {
  crashed = error
  results.push(false)
  console.log('CRASHED', String(error.message).replace(/postgres(ql)?:\/\/\S+/g, '<url>').slice(0, 300))
} finally {
  await teardown().catch((error) => console.log('CLEANUP FAILED', error.message))
  await direct.end()
  await pooler.end()
  await admin.end()
}

console.log(`\n${results.filter(Boolean).length} of ${results.length} checks passed`)
process.exit(results.every(Boolean) && !crashed ? 0 : 1)
