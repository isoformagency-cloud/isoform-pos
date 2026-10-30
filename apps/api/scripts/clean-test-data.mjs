// Removes businesses left by an interrupted test run. Only touches businesses whose owner
// has a reserved test address. Run: node --env-file=../../.env.local scripts/clean-test-data.mjs
import { createClient } from '@supabase/supabase-js'
import pg from 'pg'

const db = new pg.Client({ connectionString: process.env.DATABASE_URL_DIRECT, ssl: { rejectUnauthorized: false } })
await db.connect()
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const { rows: tenants } = await db.query(
  `select distinct m.tenant_id from app.memberships m join auth.users u on u.id = m.user_id
    where m.role = 'owner' and u.email ~ $1`,
  ['^(orders|menu|billing|pay|owner-[ab])-.*@staff\\.isoform\\.invalid$'],
)
for (const { tenant_id: tenant } of tenants) {
  const { rows: users } = await db.query(`select user_id from app.memberships where tenant_id = $1`, [tenant])
  for (const table of ['audit_log', 'idempotency_keys', 'cash_movements', 'financial_status_history', 'refunds', 'payment_allocations', 'payments', 'credit_note_lines', 'credit_notes', 'invoice_lines', 'invoices', 'invoice_series', 'order_discounts', 'order_item_addons', 'order_status_history', 'order_items', 'orders',
    'device_pin_attempts', 'devices', 'branch_variant_overrides', 'product_addons', 'addons', 'product_variants', 'products', 'categories',
    'tax_rates', 'customers', 'cash_sessions', 'branch_memberships', 'registers', 'payment_methods', 'memberships', 'branches', 'tax_registrations']) {
    await db.query(`delete from app.${table} where tenant_id = $1`, [tenant])
  }
  await db.query(`delete from app.tenants where id = $1`, [tenant])
  for (const { user_id: id } of users) await admin.auth.admin.deleteUser(id)
}
const { rows: [left] } = await db.query(`select (select count(*)::int from app.tenants) tenants, (select count(*)::int from auth.users) users`)
console.log('removed', tenants.length, 'left', left)
await db.end()
