// Loads the draft schema into a real PostgreSQL engine (PGlite) and attacks it.
// Run with: npm run verify:schema
//
// PGlite has one connection, so this proves the rules, not behaviour under
// simultaneous writers. Concurrency tests run against Postgres at Stage 4.
import { readdirSync, readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const migrations = new URL('../../supabase/migrations/', import.meta.url)
const schemaSql = () =>
  readdirSync(migrations)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((file) => readFileSync(new URL(file, migrations), 'utf8'))
    .join('\n')

const db = new PGlite()
const results = []

const ids = {}
const id = (name) => (ids[name] ??= crypto.randomUUID())

async function setup() {
  await db.exec(`
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql as 'select null::uuid';
    create role authenticated;
    create schema realtime;
    create table realtime.messages (extension text);
    create function realtime.topic() returns text language sql as 'select null::text';
  `)
  await db.exec(process.env.SCHEMA_FILE ? readFileSync(process.env.SCHEMA_FILE, 'utf8') : schemaSql())

  for (const tenant of ['A', 'B']) {
    const t = id(`tenant${tenant}`)
    const tax = id(`tax${tenant}`)
    const owner = id(`owner${tenant}`)
    const cashier = id(`cashier${tenant}`)
    await db.query(`insert into app.tenants (id, display_name, status) values ($1, $2, 'active')`, [t, `Tenant ${tenant}`])
    await db.query(
      `insert into app.tax_registrations (id, tenant_id, legal_name, gstin, state_code, scheme, address)
       values ($1, $2, 'Legal', '33ABCDE1234F1Z5', '33', 'regular', 'Address')`,
      [tax, t],
    )
    for (const n of [1, 2]) {
      await db.query(
        `insert into app.branches (id, tenant_id, tax_registration_id, name, code) values ($1, $2, $3, $4, $5)`,
        [id(`branch${tenant}${n}`), t, tax, `Branch ${n}`, `B${n}`],
      )
      await db.query(`insert into app.registers (id, tenant_id, branch_id, name) values ($1, $2, $3, 'Main')`, [
        id(`register${tenant}${n}`), t, id(`branch${tenant}${n}`),
      ])
    }
    for (const [member, role] of [[owner, 'owner'], [cashier, 'cashier']]) {
      const user = crypto.randomUUID()
      await db.query(`insert into auth.users values ($1)`, [user])
      await db.query(
        `insert into app.memberships (id, tenant_id, user_id, display_name, role) values ($1, $2, $3, $4, $5)`,
        [member, t, user, role, role],
      )
    }
    await db.query(`insert into app.tax_rates (id, tenant_id, name, cgst_rate, sgst_rate) values ($1, $2, 'GST 5%', 2.5, 2.5)`, [id(`rate${tenant}`), t])
    await db.query(`insert into app.categories (id, tenant_id, name) values ($1, $2, 'Food')`, [id(`category${tenant}`), t])
    await db.query(
      `insert into app.products (id, tenant_id, category_id, name, tax_rate_id) values ($1, $2, $3, 'Dosa', $4)`,
      [id(`product${tenant}`), t, id(`category${tenant}`), id(`rate${tenant}`)],
    )
    await db.query(`insert into app.product_variants (id, tenant_id, product_id, price) values ($1, $2, $3, 952)`, [
      id(`variant${tenant}`), t, id(`product${tenant}`),
    ])
    for (const [method, kind] of [['cash', 'cash'], ['upi', 'upi'], ['card', 'card']]) {
      await db.query(`insert into app.payment_methods (id, tenant_id, name, kind) values ($1, $2, $3, $4)`, [
        id(`${method}${tenant}`), t, method, kind,
      ])
    }
    await db.query(
      `insert into app.invoice_series (id, tenant_id, tax_registration_id, branch_id, document_type, prefix, financial_year)
       values ($1, $2, $3, $4, 'tax_invoice', 'B1', '2627')`,
      [id(`series${tenant}`), t, tax, id(`branch${tenant}1`)],
    )
    await db.query(
      `insert into app.invoice_series (id, tenant_id, tax_registration_id, branch_id, document_type, prefix, financial_year)
       values ($1, $2, $3, $4, 'credit_note', 'CN1', '2627')`,
      [id(`cnseries${tenant}`), t, tax, id(`branch${tenant}1`)],
    )
  }

  await db.query(
    `insert into app.tax_registrations (id, tenant_id, legal_name, gstin, state_code, scheme, address)
     values ($1, $2, 'Small', '33ZZZZZ9999Z1Z5', '33', 'composition', 'Address')`,
    [id('taxComp'), id('tenantA')],
  )
  await db.query(`insert into app.branches (id, tenant_id, tax_registration_id, name, code) values ($1, $2, $3, 'Small', 'B3')`, [
    id('branchA3'), id('tenantA'), id('taxComp'),
  ])
  await db.query(
    `insert into app.invoice_series (id, tenant_id, tax_registration_id, branch_id, document_type, prefix, financial_year)
     values ($1, $2, $3, $4, 'bill_of_supply', 'B3', '2627')`,
    [id('seriesComp'), id('tenantA'), id('taxComp'), id('branchA3')],
  )
}

// Runs fn inside a transaction, as the API would: restricted role, context set locally.
async function as(tenant, branches, fn, membership) {
  await db.exec('begin')
  try {
    await db.query(`select set_config('app.tenant_id', $1, true), set_config('app.branch_ids', $2, true), set_config('app.membership_id', $3, true)`, [
      tenant ? id(`tenant${tenant}`) : '',
      `{${branches.map((b) => id(`branch${b}`)).join(',')}}`,
      membership ? id(membership) : tenant ? id(`owner${tenant}`) : '',
    ])
    await db.exec('set local role app_user')
    const value = await fn()
    await db.exec('commit')
    return value
  } catch (error) {
    await db.exec('rollback').catch(() => {})
    throw error
  }
}

const check = (group, name, ok, detail = '') => {
  results.push({ group, name, ok, detail })
}

async function refused(group, name, pattern, fn) {
  try {
    await fn()
    check(group, name, false, 'was allowed')
  } catch (error) {
    const ok = pattern.test(error.message)
    check(group, name, ok, ok ? '' : error.message)
  }
}

const rows = async (sql, params) => (await db.query(sql, params)).rows

const openSession = (tenant, n, sessionId) =>
  db.query(
    `insert into app.cash_sessions (id, tenant_id, branch_id, register_id, business_date, opening_amount, opened_by)
     values ($1, $2, $3, $4, '2026-10-30', 5000, $5)`,
    [sessionId, id(`tenant${tenant}`), id(`branch${tenant}${n}`), id(`register${tenant}${n}`), id(`owner${tenant}`)],
  )

async function makeOrder(tenant, n, orderId, displayNumber) {
  await db.query(
    `insert into app.orders (id, tenant_id, branch_id, display_number, order_type, business_date, created_by)
     values ($1, $2, $3, $4, 'dine_in', '2026-10-30', $5)`,
    [orderId, id(`tenant${tenant}`), id(`branch${tenant}${n}`), displayNumber, id(`owner${tenant}`)],
  )
}

async function issueInvoice(tenant, invoiceId, orderId, { series = id(`series${tenant}`), date = '2026-10-30', typedNumber = 'TYPED-BY-HAND', item = null, quantity = 1 } = {}) {
  const [{ number }] = await rows(
    `insert into app.invoices (id, tenant_id, branch_id, tax_registration_id, order_id, series_id, document_type,
       number, invoice_date, business_date, seller_snapshot, taxable_total, cgst_total, sgst_total, round_off, grand_total, issued_by)
     values ($1, $2, $3, $4, $5, $6, 'tax_invoice', $7, $8, '2026-10-30', '{}', 952, 23.8, 23.8, 0.4, 1000, $9)
     returning number`,
    [invoiceId, id(`tenant${tenant}`), id(`branch${tenant}1`), id(`tax${tenant}`), orderId, series, typedNumber, date, id(`owner${tenant}`)],
  )
  await addLine(tenant, invoiceId, 1, item, quantity)
  return number
}

const addLine = (tenant, invoiceId, lineNumber, item = null, quantity = 1) =>
  db.query(
    `insert into app.invoice_lines (tenant_id, branch_id, invoice_id, order_item_id, line_number, description, quantity,
       unit_price, taxable_value, cgst_rate, sgst_rate, cgst, sgst)
     values ($1, $2, $3, $4, $5, 'Dosa', $6, 952, 952, 2.5, 2.5, 23.8, 23.8)`,
    [id(`tenant${tenant}`), id(`branch${tenant}1`), invoiceId, item, lineNumber, quantity],
  )

const addItem = (orderId, itemId, quantity) =>
  db.query(
    `insert into app.order_items (id, tenant_id, branch_id, order_id, variant_id, product_name, variant_name, unit_price, quantity, created_by)
     values ($1, $2, $3, $4, $5, 'Dosa', 'Regular', 476, $6, $7)`,
    [itemId, id('tenantA'), id('branchA1'), orderId, id('variantA'), quantity, id('ownerA')],
  )

async function pay(tenant, paymentId, method, amount, { reference = null, session = null, status = 'recorded' } = {}) {
  await db.query(
    `insert into app.payments (id, tenant_id, branch_id, method_id, method_kind, amount, reference, received_at,
       business_date, cash_session_id, status, recorded_by)
     values ($1, $2, $3, $4, $5, $6, $7, now(), '2026-10-30', $8, $9, $10)`,
    [paymentId, id(`tenant${tenant}`), id(`branch${tenant}1`), id(`${method}${tenant}`), method, amount, reference, session, status, id(`owner${tenant}`)],
  )
  if (session) {
    await db.query(
      `insert into app.cash_movements (tenant_id, branch_id, cash_session_id, movement_type, direction, amount, payment_id, recorded_by)
       values ($1, $2, $3, 'sale', 1, $4, $5, $6)`,
      [id(`tenant${tenant}`), id(`branch${tenant}1`), session, amount, paymentId, id(`owner${tenant}`)],
    )
  }
}

const allocate = (tenant, paymentId, invoiceId, amount) =>
  db.query(
    `insert into app.payment_allocations (tenant_id, branch_id, payment_id, invoice_id, amount, created_by)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [id(`tenant${tenant}`), id(`branch${tenant}1`), paymentId, invoiceId, amount, id(`owner${tenant}`)],
  )

async function isolation() {
  const g = 'Tenant isolation'
  const a = id('orderA')
  await as('A', ['A1', 'A2'], () => makeOrder('A', 1, a, 1))

  check(g, 'A business sees its own order', (await as('A', ['A1'], () => rows(`select id from app.orders`))).length === 1)
  check(g, 'Another business sees none of it', (await as('B', ['B1', 'B2'], () => rows(`select id from app.orders`))).length === 0)
  check(g, 'No tenant set means no rows', (await as(null, [], () => rows(`select id from app.orders`))).length === 0)
  check(g, 'Another business cannot read tenants', (await as('B', [], () => rows(`select id from app.tenants`))).length === 1)
  check(g, 'Searching by exact ID finds nothing', (await as('B', ['B1'], () => rows(`select id from app.orders where id = $1`, [a]))).length === 0)

  await as('B', ['B1', 'B2'], async () => {
    const { affectedRows } = await db.query(`update app.orders set notes = 'hacked' where id = $1`, [a])
    check(g, 'Another business cannot change it', affectedRows === 0)
  })

  await refused(g, 'Cannot insert a row for another business', /row-level security/, () =>
    as('B', ['A1'], () => makeOrder('A', 1, crypto.randomUUID(), 2)),
  )
  await refused(g, 'Cannot link to another business’s product', /foreign key/, () =>
    as('A', ['A1'], () =>
      db.query(
        `insert into app.order_items (id, tenant_id, branch_id, order_id, variant_id, product_name, variant_name, unit_price, quantity, created_by)
         values ($1, $2, $3, $4, $5, 'x', 'x', 1, 1, $6)`,
        [crypto.randomUUID(), id('tenantA'), id('branchA1'), a, id('variantB'), id('ownerA')],
      ),
    ),
  )
  await refused(g, 'Cannot use another business’s payment method', /foreign key/, () =>
    as('A', ['A1'], () =>
      db.query(
        `insert into app.payments (id, tenant_id, branch_id, method_id, method_kind, amount, received_at, business_date, recorded_by)
         values ($1, $2, $3, $4, 'upi', 1, now(), '2026-10-30', $5)`,
        [crypto.randomUUID(), id('tenantA'), id('branchA1'), id('upiB'), id('ownerA')],
      ),
    ),
  )
  await refused(g, 'A record cannot claim the wrong payment method type', /foreign key/, () =>
    as('A', ['A1'], () =>
      db.query(
        `insert into app.payments (id, tenant_id, branch_id, method_id, method_kind, amount, received_at, business_date, recorded_by)
         values ($1, $2, $3, $4, 'upi', 1, now(), '2026-10-30', $5)`,
        [crypto.randomUUID(), id('tenantA'), id('branchA1'), id('cardA'), id('ownerA')],
      ),
    ),
  )
}

async function branches() {
  const g = 'Branch access'
  const b2 = id('orderA2')
  await as('A', ['A1', 'A2'], () => makeOrder('A', 2, b2, 1))
  check(g, 'Staff on branch 1 cannot see branch 2', (await as('A', ['A1'], () => rows(`select id from app.orders where id = $1`, [b2]))).length === 0)
  check(g, 'Owner with both branches sees both', (await as('A', ['A1', 'A2'], () => rows(`select id from app.orders`))).length === 2)
  await refused(g, 'Staff cannot write into another branch', /row-level security/, () =>
    as('A', ['A1'], () => makeOrder('A', 2, crypto.randomUUID(), 2)),
  )
  await refused(g, 'A branch 1 order cannot hold a branch 2 invoice', /foreign key/, () =>
    as('A', ['A1', 'A2'], async () => {
      await db.query(
        `insert into app.invoices (id, tenant_id, branch_id, tax_registration_id, order_id, series_id, document_type, number,
           invoice_date, business_date, seller_snapshot, taxable_total, grand_total, issued_by)
         values ($1, $2, $3, $4, $5, $6, 'tax_invoice', 'X-1', '2026-10-30', '2026-10-30', '{}', 0, 0, $7)`,
        [crypto.randomUUID(), id('tenantA'), id('branchA1'), id('taxA'), b2, id('seriesA'), id('ownerA')],
      )
    }),
  )
}

async function invoices() {
  const g = 'Invoices'
  const order = id('orderBill')
  const inv = id('invoice1')
  const number = await as('A', ['A1'], async () => {
    await makeOrder('A', 1, order, 10)
    return issueInvoice('A', inv, order)
  })
  check(g, 'Numbers follow the agreed format', number === 'B1-2627-000001', number)
  check(g, 'The number fits the 16-character limit', number.length <= 16)
  check(g, 'A hand-typed number is ignored', number !== 'TYPED-BY-HAND')

  const second = id('invoice2')
  const number2 = await as('A', ['A1'], async () => {
    await makeOrder('A', 1, id('orderBill2'), 11)
    return issueInvoice('A', second, id('orderBill2'))
  })
  check(g, 'The next invoice takes the next number', number2 === 'B1-2627-000002', number2)

  await refused(g, 'A failed bill rolls back', /boom/, () =>
    as('A', ['A1'], async () => {
      await makeOrder('A', 1, id('orderFail'), 20)
      await issueInvoice('A', crypto.randomUUID(), id('orderFail'))
      throw new Error('boom')
    }),
  )
  const number3 = await as('A', ['A1'], async () => {
    await makeOrder('A', 1, id('orderBill3'), 12)
    return issueInvoice('A', id('invoice3'), id('orderBill3'))
  })
  check(g, 'A failed bill leaves no gap in the series', number3 === 'B1-2627-000003', number3)

  await refused(g, 'An issued invoice cannot be edited', /permission denied/, () =>
    as('A', ['A1'], () => db.query(`update app.invoices set grand_total = 1 where id = $1`, [inv])),
  )
  await refused(g, 'An issued invoice cannot be deleted', /permission denied/, () =>
    as('A', ['A1'], () => db.query(`delete from app.invoices where id = $1`, [inv])),
  )
  await refused(g, 'Totals that do not add up are rejected', /check constraint/, () =>
    as('A', ['A1'], async () => {
      await makeOrder('A', 1, id('orderBad'), 13)
      await db.query(
        `insert into app.invoices (id, tenant_id, branch_id, tax_registration_id, order_id, series_id, document_type, number,
           invoice_date, business_date, seller_snapshot, taxable_total, grand_total, issued_by)
         values ($1, $2, $3, $4, $5, $6, 'tax_invoice', 'Y-1', '2026-10-30', '2026-10-30', '{}', 100, 999, $7)`,
        [crypto.randomUUID(), id('tenantA'), id('branchA1'), id('taxA'), id('orderBad'), id('seriesA'), id('ownerA')],
      )
    }),
  )
  await refused(g, 'An invoice whose lines disagree is rejected at commit', /do not match its lines/, () =>
    as('A', ['A1'], async () => {
      await makeOrder('A', 1, id('orderBad2'), 14)
      await db.query(
        `insert into app.invoices (id, tenant_id, branch_id, tax_registration_id, order_id, series_id, document_type, number,
           invoice_date, business_date, seller_snapshot, taxable_total, grand_total, issued_by)
         values ($1, $2, $3, $4, $5, $6, 'tax_invoice', 'Y-2', '2026-10-30', '2026-10-30', '{}', 100, 100, $7)`,
        [crypto.randomUUID(), id('tenantA'), id('branchA1'), id('taxA'), id('orderBad2'), id('seriesA'), id('ownerA')],
      )
    }),
  )
  await refused(g, 'A bill of supply cannot charge GST', /check constraint/, () =>
    as('A', ['A3'], async () => {
      await makeOrder('A', 3, id('orderSupply'), 15)
      await db.query(
        `insert into app.invoices (id, tenant_id, branch_id, tax_registration_id, order_id, series_id, document_type, number,
           invoice_date, business_date, seller_snapshot, taxable_total, cgst_total, grand_total, issued_by)
         values ($1, $2, $3, $4, $5, $6, 'bill_of_supply', 'x', '2026-10-30', '2026-10-30', '{}', 100, 5, 105, $7)`,
        [crypto.randomUUID(), id('tenantA'), id('branchA3'), id('taxComp'), id('orderSupply'), id('seriesComp'), id('ownerA')],
      )
    }),
  )
  await refused(g, 'A regular business cannot issue a bill of supply', /does not match the tax scheme/, () =>
    as('A', ['A1'], async () => {
      await makeOrder('A', 1, id('orderWrongDoc'), 21)
      await db.query(
        `insert into app.invoices (id, tenant_id, branch_id, tax_registration_id, order_id, series_id, document_type, number,
           invoice_date, business_date, seller_snapshot, taxable_total, grand_total, issued_by)
         values ($1, $2, $3, $4, $5, $6, 'bill_of_supply', 'x', '2026-10-30', '2026-10-30', '{}', 0, 0, $7)`,
        [crypto.randomUUID(), id('tenantA'), id('branchA1'), id('taxA'), id('orderWrongDoc'), id('seriesA'), id('ownerA')],
      )
    }),
  )
  await refused(g, 'A credit-note series cannot number an invoice', /foreign key/, () =>
    as('A', ['A1'], async () => {
      await makeOrder('A', 1, id('orderWrongSeries'), 22)
      await issueInvoice('A', crypto.randomUUID(), id('orderWrongSeries'), { series: id('cnseriesA') })
    }),
  )
  await refused(g, 'An April bill cannot use last year’s series', /financial year/, () =>
    as('A', ['A1'], async () => {
      await makeOrder('A', 1, id('orderApril'), 23)
      await issueInvoice('A', crypto.randomUUID(), id('orderApril'), { date: '2027-04-01' })
    }),
  )
  await refused(g, 'The counter cannot be reset', /only move forward/, () =>
    as('A', ['A1'], () => db.query(`update app.invoice_series set next_number = 1 where id = $1`, [id('seriesA')])),
  )
  await refused(g, 'A line cannot be added to an issued invoice', /do not match its lines/, () =>
    as('A', ['A1'], () => addLine('A', inv, 2)),
  )

  await as('A', ['A1'], async () => {
    await makeOrder('A', 1, id('orderSplit'), 24)
    await addItem(id('orderSplit'), id('itemSplit'), 2)
    await issueInvoice('A', id('invoiceSplit'), id('orderSplit'), { item: id('itemSplit'), quantity: 2 })
  })
  await refused(g, 'A split bill cannot bill an item twice', /already been billed/, () =>
    as('A', ['A1'], () => issueInvoice('A', crypto.randomUUID(), id('orderSplit'), { item: id('itemSplit'), quantity: 1 })),
  )
  await refused(g, 'An invoiced order cannot be cancelled', /needs a credit note/, () =>
    as('A', ['A1'], () => db.query(`update app.orders set status = 'cancelled', cancel_reason = 'x' where id = $1`, [id('orderSplit')])),
  )
  await refused(g, 'A cancelled order cannot be invoiced', /cannot be invoiced/, () =>
    as('A', ['A1'], async () => {
      await makeOrder('A', 1, id('orderCancelled'), 25)
      await db.query(`update app.orders set status = 'cancelled', cancel_reason = 'x' where id = $1`, [id('orderCancelled')])
      await issueInvoice('A', crypto.randomUUID(), id('orderCancelled'))
    }),
  )

  await refused(g, 'A discount cannot be added after finalising', /cannot change after/, () =>
    as('A', ['A1'], async () => {
      await db.query(`update app.orders set status = 'finalized' where id = $1`, [order])
      await db.query(
        `insert into app.order_discounts (id, tenant_id, branch_id, order_id, kind, value, reason, approved_by)
         values ($1, $2, $3, $4, 'amount', 10, 'x', $5)`,
        [crypto.randomUUID(), id('tenantA'), id('branchA1'), order, id('ownerA')],
      )
    }),
  )
  await refused(g, 'Order items cannot change after finalising', /cannot change after/, () =>
    as('A', ['A1'], async () => {
      await db.query(`update app.orders set status = 'finalized' where id = $1`, [order])
      await db.query(
        `insert into app.order_items (id, tenant_id, branch_id, order_id, variant_id, product_name, variant_name, unit_price, quantity, created_by)
         values ($1, $2, $3, $4, $5, 'x', 'x', 1, 1, $6)`,
        [crypto.randomUUID(), id('tenantA'), id('branchA1'), order, id('variantA'), id('ownerA')],
      )
    }),
  )
  await as('A', ['A1'], () => db.query(`update app.orders set status = 'finalized' where id = $1`, [order]))
  await refused(g, 'A finalised order cannot reopen', /can no longer change/, () =>
    as('A', ['A1'], () => db.query(`update app.orders set status = 'open' where id = $1`, [order])),
  )
  const [{ version }] = await as('A', ['A1'], () => rows(`select version from app.orders where id = $1`, [id('orderBill2')]))
  await as('A', ['A1'], () => db.query(`update app.orders set notes = 'x' where id = $1`, [id('orderBill2')]))
  const [{ version: after }] = await as('A', ['A1'], () => rows(`select version from app.orders where id = $1`, [id('orderBill2')]))
  check(g, 'Each order change bumps its version', after === version + 1)
}

async function payments() {
  const g = 'Payments'
  const inv = id('invoice1')
  const session = id('session1')
  await as('A', ['A1'], () => openSession('A', 1, session))

  await as('A', ['A1'], async () => {
    await pay('A', id('payCash'), 'cash', 300, { session })
    await pay('A', id('payUpi'), 'upi', 500, { reference: 'UPI-1' })
    await pay('A', id('payCard'), 'card', 200, { reference: 'CARD-1' })
    await allocate('A', id('payCash'), inv, 300)
    await allocate('A', id('payUpi'), inv, 500)
    await allocate('A', id('payCard'), inv, 200)
  })
  const balance = async () => Number((await as('A', ['A1'], () => rows(`select outstanding from app.invoice_balances where invoice_id = $1`, [inv])))[0].outstanding)
  check(g, 'Split of ₹300 + ₹500 + ₹200 clears a ₹1,000 bill', (await balance()) === 0)

  const partial = id('invoice2')
  await as('A', ['A1'], async () => {
    await pay('A', id('payPartial'), 'upi', 400, { reference: 'UPI-2' })
    await allocate('A', id('payPartial'), partial, 400)
  })
  const [{ outstanding }] = await as('A', ['A1'], () => rows(`select outstanding from app.invoice_balances where invoice_id = $1`, [partial]))
  check(g, 'A part payment leaves the right balance', Number(outstanding) === 600)

  await refused(g, 'Cannot allocate more than the bill owes', /exceeds the invoice balance/, () =>
    as('A', ['A1'], async () => {
      await pay('A', id('payOver'), 'upi', 900, { reference: 'UPI-3' })
      await allocate('A', id('payOver'), partial, 700)
    }),
  )
  await refused(g, 'Cannot allocate more than the payment', /exceeds the payment amount/, () =>
    as('A', ['A1'], async () => {
      await pay('A', id('payOver2'), 'upi', 100, { reference: 'UPI-4' })
      await allocate('A', id('payOver2'), partial, 150)
    }),
  )
  await refused(g, 'A duplicate reference is rejected', /duplicate key/, () =>
    as('A', ['A1'], () => pay('A', crypto.randomUUID(), 'upi', 50, { reference: 'UPI-1' })),
  )
  await refused(g, 'A replayed payment ID is rejected', /duplicate key/, () =>
    as('A', ['A1'], () => pay('A', id('payUpi'), 'upi', 500, { reference: 'UPI-NEW' })),
  )
  await refused(g, 'A payment amount cannot be edited', /permission denied/, () =>
    as('A', ['A1'], () => db.query(`update app.payments set amount = 1 where id = $1`, [id('payUpi')])),
  )
  await refused(g, 'A payment cannot be deleted', /permission denied/, () =>
    as('A', ['A1'], () => db.query(`delete from app.payments where id = $1`, [id('payUpi')])),
  )
  await refused(g, 'An allocation cannot be edited', /permission denied/, () =>
    as('A', ['A1'], () => db.query(`update app.payment_allocations set amount = 1`)),
  )
  await refused(g, 'A failed payment needs a reason', /check constraint/, () =>
    as('A', ['A1'], () => db.query(`update app.payments set status = 'voided' where id = $1`, [id('payPartial')])),
  )

  await refused(g, 'The recorder cannot confirm their own payment', /cannot confirm it/, () =>
    as('A', ['A1'], () => db.query(`update app.payments set status = 'confirmed' where id = $1`, [id('payUpi')])),
  )
  await as('A', ['A1'], () => db.query(`update app.payments set status = 'confirmed' where id = $1`, [id('payUpi')]), 'cashierA')
  const [{ status_changed_by }] = await as('A', ['A1'], () => rows(`select status_changed_by from app.payments where id = $1`, [id('payUpi')]))
  check(g, 'The confirmer’s name is stored by the database', status_changed_by === id('cashierA'))
  await refused(g, 'The confirmer cannot be faked', /permission denied/, () =>
    as('A', ['A1'], () => db.query(`update app.payments set status_changed_by = $1 where id = $2`, [id('ownerA'), id('payUpi')])),
  )
  const history = await as('A', ['A1'], () => rows(`select from_status, to_status from app.financial_status_history where entity_id = $1`, [id('payUpi')]))
  check(g, 'Confirming a payment is written to history', history.length === 1 && history[0].to_status === 'confirmed')

  await refused(g, 'A confirmed payment cannot go back to recorded', /cannot change from/, () =>
    as('A', ['A1'], () => db.query(`update app.payments set status = 'recorded' where id = $1`, [id('payUpi')])),
  )
  await refused(g, 'Voiding without reversing allocations is rejected at commit', /still has allocations/, () =>
    as('A', ['A1'], () => db.query(`update app.payments set status = 'voided', status_reason = 'typo' where id = $1`, [id('payCard')])),
  )

  await as('A', ['A1'], async () => {
    const [{ id: original }] = await rows(`select id from app.payment_allocations where payment_id = $1`, [id('payCard')])
    await db.query(
      `insert into app.payment_allocations (tenant_id, branch_id, payment_id, invoice_id, amount, reverses_allocation_id, created_by)
       values ($1, $2, $3, $4, -200, $5, $6)`,
      [id('tenantA'), id('branchA1'), id('payCard'), inv, original, id('ownerA')],
    )
    await db.query(`update app.payments set status = 'voided', status_reason = 'typo' where id = $1`, [id('payCard')])
  })
  check(g, 'Voiding a payment reopens the balance', (await balance()) === 200)

  await as('A', ['A1'], () => pay('A', crypto.randomUUID(), 'card', 200, { reference: 'CARD-1' }))
  check(g, 'A voided reference can be used again', true)

  const [{ id: otherAllocation }] = await as('A', ['A1'], () => rows(`select id from app.payment_allocations where payment_id = $1`, [id('payUpi')]))
  await as('B', ['B1'], async () => {
    await makeOrder('B', 1, id('orderB'), 1)
    await issueInvoice('B', id('invoiceB'), id('orderB'))
    await pay('B', id('payB'), 'upi', 1000, { reference: 'B-1' })
    await allocate('B', id('payB'), id('invoiceB'), 1000)
  })
  await refused(g, 'A reversal cannot point at another business’s record', /foreign key|mirror/, () =>
    as('B', ['B1'], () =>
      db.query(
        `insert into app.payment_allocations (tenant_id, branch_id, payment_id, invoice_id, amount, reverses_allocation_id, created_by)
         values ($1, $2, $3, $4, -500, $5, $6)`,
        [id('tenantB'), id('branchB1'), id('payB'), id('invoiceB'), otherAllocation, id('ownerB')],
      ),
    ),
  )
  await refused(g, 'A reversal must mirror the original amount', /mirror/, () =>
    as('B', ['B1'], async () => {
      const [{ id: original }] = await rows(`select id from app.payment_allocations where payment_id = $1`, [id('payB')])
      await db.query(
        `insert into app.payment_allocations (tenant_id, branch_id, payment_id, invoice_id, amount, reverses_allocation_id, created_by)
         values ($1, $2, $3, $4, -1, $5, $6)`,
        [id('tenantB'), id('branchB1'), id('payB'), id('invoiceB'), original, id('ownerB')],
      )
    }),
  )

  await refused(g, 'A voided payment cannot be allocated', /cannot be allocated/, () =>
    as('A', ['A1'], () => allocate('A', id('payCard'), inv, 10)),
  )
}

async function refunds() {
  const g = 'Refunds'
  const inv = id('invoice1')
  const refund = (paymentId, amount) =>
    db.query(
      `insert into app.refunds (id, tenant_id, branch_id, payment_id, invoice_id, method_id, method_kind, amount, reason,
         refunded_at, business_date, recorded_by)
       values ($1, $2, $3, $4, $5, $6, 'upi', $7, 'Wrong item', now(), '2026-10-30', $8)`,
      [crypto.randomUUID(), id('tenantA'), id('branchA1'), paymentId, inv, id('upiA'), amount, id('ownerA')],
    )
  const state = async () => (await as('A', ['A1'], () => rows(`select refund_state from app.payment_refund_state where payment_id = $1`, [id('payUpi')])))[0].refund_state

  check(g, 'A new payment shows no refund', (await state()) === 'none')
  await as('A', ['A1'], () => refund(id('payUpi'), 100))
  check(g, 'A part refund shows partially refunded', (await state()) === 'partially_refunded')
  await refused(g, 'Refunds cannot exceed the payment', /refund exceeds/, () => as('A', ['A1'], () => refund(id('payUpi'), 450)))
  await as('A', ['A1'], () => refund(id('payUpi'), 400))
  check(g, 'A full refund shows refunded', (await state()) === 'refunded')
  const [{ amount }] = await as('A', ['A1'], () => rows(`select amount from app.payments where id = $1`, [id('payUpi')]))
  check(g, 'The original payment is untouched', Number(amount) === 500)
  await refused(g, 'A refunded payment cannot be voided', /live refund/, () =>
    as('A', ['A1'], async () => {
      const [{ id: original }] = await rows(`select id from app.payment_allocations where payment_id = $1`, [id('payUpi')])
      await db.query(
        `insert into app.payment_allocations (tenant_id, branch_id, payment_id, invoice_id, amount, reverses_allocation_id, created_by)
         values ($1, $2, $3, $4, -500, $5, $6)`,
        [id('tenantA'), id('branchA1'), id('payUpi'), inv, original, id('ownerA')],
      )
      await db.query(`update app.payments set status = 'voided', status_reason = 'x' where id = $1`, [id('payUpi')])
    }),
  )
}

async function creditNotes() {
  const g = 'Credit notes'
  const note = async (amount, lineAmount = amount) => {
    const noteId = crypto.randomUUID()
    await db.query(
      `insert into app.credit_notes (id, tenant_id, branch_id, tax_registration_id, invoice_id, series_id, number, kind, reason,
         note_date, business_date, taxable_total, grand_total, issued_by)
       values ($1, $2, $3, $4, $5, $6, 'x', 'correction', 'Wrong item', '2026-10-30', '2026-10-30', $7, $7, $8)`,
      [noteId, id('tenantA'), id('branchA1'), id('taxA'), id('invoice3'), id('cnseriesA'), amount, id('ownerA')],
    )
    const [{ id: line }] = await rows(`select id from app.invoice_lines where invoice_id = $1`, [id('invoice3')])
    await db.query(
      `insert into app.credit_note_lines (tenant_id, branch_id, credit_note_id, invoice_line_id, quantity, taxable_value)
       values ($1, $2, $3, $4, 1, $5)`,
      [id('tenantA'), id('branchA1'), noteId, line, lineAmount],
    )
  }
  await as('A', ['A1'], () => note(100))
  const [{ outstanding }] = await as('A', ['A1'], () => rows(`select outstanding from app.invoice_balances where invoice_id = $1`, [id('invoice3')]))
  check(g, 'A credit note reduces what is owed', Number(outstanding) === 900)
  const [{ number }] = await as('A', ['A1'], () => rows(`select number from app.credit_notes limit 1`))
  check(g, 'Credit notes get their own series', number === 'CN1-2627-000001', number)
  await refused(g, 'Credit notes cannot exceed the invoice', /cannot exceed invoice total/, () => as('A', ['A1'], () => note(950)))
  await refused(g, 'A credit note must match its lines', /do not match its lines/, () => as('A', ['A1'], () => note(50, 20)))
}

async function cash() {
  const g = 'Cash'
  const session = id('session1')
  const movement = (type, direction, amount, extra = {}) =>
    db.query(
      `insert into app.cash_movements (tenant_id, branch_id, cash_session_id, movement_type, direction, amount, reason, recorded_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id('tenantA'), id('branchA1'), extra.session ?? session, type, direction, amount, extra.reason ?? null, id('ownerA')],
    )

  await refused(g, 'A second open session on a register is rejected', /duplicate key/, () =>
    as('A', ['A1'], () => openSession('A', 1, crypto.randomUUID())),
  )
  await refused(g, 'A cash payment needs a session', /check constraint/, () =>
    as('A', ['A1'], () => pay('A', crypto.randomUUID(), 'cash', 10)),
  )
  await refused(g, 'A cash payment missing from the drawer fails at commit', /does not match the drawer/, () =>
    as('A', ['A1'], () =>
      db.query(
        `insert into app.payments (id, tenant_id, branch_id, method_id, method_kind, amount, received_at, business_date, cash_session_id, recorded_by)
         values ($1, $2, $3, $4, 'cash', 10, now(), '2026-10-30', $5, $6)`,
        [crypto.randomUUID(), id('tenantA'), id('branchA1'), id('cashA'), session, id('ownerA')],
      ),
    ),
  )
  await refused(g, 'A cash withdrawal needs a reason', /check constraint/, () => as('A', ['A1'], () => movement('paid_out', -1, 50)))
  await refused(g, 'A movement type cannot use the wrong direction', /check constraint/, () =>
    as('A', ['A1'], () => movement('safe_drop', 1, 50, { reason: 'x' })),
  )

  await as('A', ['A1'], () => movement('safe_drop', -1, 1000, { reason: 'To safe' }))
  await refused(g, 'A cash movement cannot be edited', /permission denied/, () =>
    as('A', ['A1'], () => db.query(`update app.cash_movements set amount = 1`)),
  )
  await refused(g, 'The opening balance cannot be edited', /permission denied/, () =>
    as('A', ['A1'], () => db.query(`update app.cash_sessions set opening_amount = 1 where id = $1`, [session])),
  )
  await refused(g, 'A client cannot supply its own expected cash', /permission denied/, () =>
    as('A', ['A1'], () =>
      db.query(`update app.cash_sessions set status = 'closed', counted_amount = 4250, expected_amount = 99999 where id = $1`, [session]),
    ),
  )

  await as('A', ['A1'], async () => {
    await pay('A', id('payCashVoid'), 'cash', 70, { session })
    const [{ id: original }] = await rows(`select id from app.cash_movements where payment_id = $1`, [id('payCashVoid')])
    await db.query(
      `insert into app.cash_movements (tenant_id, branch_id, cash_session_id, movement_type, direction, amount, payment_id,
         corrects_movement_id, reason, recorded_by)
       values ($1, $2, $3, 'correction', -1, 70, $4, $5, 'Entered twice', $6)`,
      [id('tenantA'), id('branchA1'), session, id('payCashVoid'), original, id('ownerA')],
    )
    await db.query(`update app.payments set status = 'voided', status_reason = 'Entered twice' where id = $1`, [id('payCashVoid')])
  })
  check(g, 'A voided cash payment is corrected in the drawer', true)

  await as('A', ['A1'], () => db.query(`update app.cash_sessions set status = 'closed', counted_amount = 4250 where id = $1`, [session]))
  const [row] = await as('A', ['A1'], () => rows(`select expected_amount, variance from app.cash_sessions where id = $1`, [session]))
  check(g, 'Expected cash is worked out from the movements', Number(row.expected_amount) === 4300, row.expected_amount)
  check(g, 'The shortfall is stored', Number(row.variance) === -50, row.variance)

  await refused(g, 'A closed session takes no more movements', /is closed/, () =>
    as('A', ['A1'], () => movement('paid_in', 1, 10, { reason: 'late' })),
  )
  await refused(g, 'A closed session cannot be reopened', /cannot move from/, () =>
    as('A', ['A1'], () => db.query(`update app.cash_sessions set status = 'open' where id = $1`, [session])),
  )
  await refused(g, 'A closed count cannot be changed', /cannot be changed/, () =>
    as('A', ['A1'], () => db.query(`update app.cash_sessions set status = 'reviewed', counted_amount = 4300, review_note = 'x' where id = $1`, [session]), 'cashierA'),
  )
  await refused(g, 'The person who closed cannot review', /cannot review it/, () =>
    as('A', ['A1'], () => db.query(`update app.cash_sessions set status = 'reviewed', review_note = 'x' where id = $1`, [session])),
  )
  await refused(g, 'A cash difference needs a review note', /needs a review note/, () =>
    as('A', ['A1'], () => db.query(`update app.cash_sessions set status = 'reviewed' where id = $1`, [session]), 'cashierA'),
  )
  await as('A', ['A1'], () => db.query(`update app.cash_sessions set status = 'reviewed', review_note = 'Short ₹50, noted' where id = $1`, [session]), 'cashierA')
  const [{ variance }] = await as('A', ['A1'], () => rows(`select variance from app.cash_sessions where id = $1`, [session]))
  check(g, 'Review keeps the shortfall on record', Number(variance) === -50)
}

async function privileges() {
  const g = 'Database privileges'
  const [{ rolbypassrls, rolsuper }] = await rows(`select rolbypassrls, rolsuper from pg_roles where rolname = 'app_user'`)
  check(g, 'The API role cannot bypass RLS', rolbypassrls === false && rolsuper === false)

  const unprotected = await rows(`
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'app' and c.relkind = 'r' and not (c.relrowsecurity and c.relforcerowsecurity)`)
  check(g, 'Every table has forced RLS', unprotected.length === 0, unprotected.map((r) => r.relname).join(', '))

  const noTenant = await rows(`
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'app' and c.relkind = 'r' and c.relname <> 'tenants'
      and not exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped)`)
  check(g, 'Every table carries a tenant', noTenant.length === 0, noTenant.map((r) => r.relname).join(', '))

  const deletable = await rows(`
    select table_name from information_schema.role_table_grants
    where grantee = 'app_user' and privilege_type = 'DELETE' and table_schema = 'app'
      and table_name in ('invoices', 'invoice_lines', 'credit_notes', 'credit_note_lines', 'payments',
        'payment_allocations', 'refunds', 'cash_sessions', 'cash_movements', 'financial_status_history', 'audit_log')`)
  check(g, 'No financial table can be deleted from', deletable.length === 0, deletable.map((r) => r.table_name).join(', '))

  await as('A', [], () => db.query(`update app.tenants set display_name = 'New name' where id = $1`, [id('tenantA')]))
  check(g, 'A business can edit its own settings', true)
  await refused(g, 'A business cannot change its own account status', /permission denied/, () =>
    as('A', [], () => db.query(`update app.tenants set status = 'active' where id = $1`, [id('tenantA')])),
  )
  await as('B', [], async () => {
    const { affectedRows } = await db.query(`update app.tenants set display_name = 'Hacked' where id = $1`, [id('tenantA')])
    check(g, 'A business cannot edit another business', affectedRows === 0)
  })
  await refused(g, 'The audit log cannot be edited', /permission denied/, () =>
    as('A', ['A1'], () => db.query(`update app.audit_log set action = 'x'`)),
  )
  await refused(g, 'The audit log cannot be deleted', /permission denied/, () =>
    as('A', ['A1'], () => db.query(`delete from app.audit_log`)),
  )
}

await setup()
for (const suite of [isolation, branches, invoices, payments, refunds, creditNotes, cash, privileges]) {
  await suite()
}

const groups = [...new Set(results.map((r) => r.group))]
for (const group of groups) {
  console.log(`\n${group}`)
  for (const r of results.filter((x) => x.group === group)) {
    console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`)
  }
}
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length} of ${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
