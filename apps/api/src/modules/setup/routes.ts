import { Hono } from 'hono'
import { z } from 'zod'
import { audit, command, dbContext, readBody, requires, session, type Env } from '../../platform/context.js'
import { tx, type Db } from '../../platform/db.js'
import { AppError, forbidden, notFound } from '../../platform/errors.js'

export const setup = new Hono<Env>()
setup.use(session)

const BACKUP_PAGE = 1000

const SAMPLE_MENU: { category: string; icon: string; items: { name: string; description: string; food: string; sizes: [string, string][]; shot?: boolean }[] }[] = [
  {
    category: 'Coffee', icon: 'coffee', items: [
      { name: 'Filter coffee', description: 'Strong South Indian coffee with hot milk.', food: 'veg', sizes: [['Regular', '80']], shot: true },
      { name: 'Cappuccino', description: 'Espresso with steamed milk and foam.', food: 'veg', sizes: [['Regular', '140'], ['Large', '170']], shot: true },
      { name: 'Cold coffee', description: 'Chilled coffee blended with milk.', food: 'veg', sizes: [['Regular', '160']], shot: true },
    ],
  },
  {
    category: 'Tea', icon: 'cup', items: [
      { name: 'Masala chai', description: 'Spiced milk tea.', food: 'veg', sizes: [['Regular', '50']] },
      { name: 'Green tea', description: 'Light and unsweetened.', food: 'veg', sizes: [['Regular', '90']] },
    ],
  },
  {
    category: 'Snacks', icon: 'croissant', items: [
      { name: 'Veg sandwich', description: 'Grilled with mint chutney.', food: 'veg', sizes: [['Regular', '130']] },
      { name: 'Paneer puff', description: 'Flaky pastry with spiced paneer.', food: 'veg', sizes: [['Regular', '70']] },
      { name: 'Chicken roll', description: 'Spiced chicken in a soft wrap.', food: 'non_veg', sizes: [['Regular', '150']] },
    ],
  },
  {
    category: 'Desserts', icon: 'cake', items: [
      { name: 'Chocolate brownie', description: 'Served warm.', food: 'egg', sizes: [['Regular', '120']] },
      { name: 'Banana cake', description: 'One slice, baked in house.', food: 'egg', sizes: [['Regular', '90']] },
    ],
  },
]

const SAMPLE_TABLES = [
  { name: 'T1', seats: 2, shape: 'square', x: 60, y: 60 },
  { name: 'T2', seats: 2, shape: 'square', x: 300, y: 60 },
  { name: 'T3', seats: 4, shape: 'round', x: 540, y: 60 },
  { name: 'T4', seats: 6, shape: 'long', x: 60, y: 320 },
]

setup.get('/setup', requires('business.read'), async (c) => {
  const actor = c.get('actor')
  const status = await tx(dbContext(actor), async (db) => {
    const { rows: [row] } = await db.query(
      `select t.setup_dismissed as dismissed,
              (t.upi_id is not null or t.fssai_number is not null or t.bill_footer is not null) as details,
              exists (select 1 from app.products where is_active) as menu,
              exists (select 1 from app.dining_tables where is_active) as tables,
              (select count(*) from app.memberships where status = 'active') > 1 as staff,
              exists (select 1 from app.products where is_sample and is_active) as sample
         from app.tenants t where t.id = $1`,
      [actor.tenantId],
    )
    return row
  })
  return c.json(status)
})

setup.post('/setup/dismiss', requires('business.write'), async (c) => {
  const input = await readBody(c, z.strictObject({ dismissed: z.boolean() }))
  return command(c, 200, async (db, actor) => {
    await db.query(`update app.tenants set setup_dismissed = $2 where id = $1`, [actor.tenantId, input.dismissed])
    return input
  })
})

async function sampleTaxRate(db: Db, tenantId: string) {
  const { rows: [existing] } = await db.query(`select id from app.tax_rates where is_active order by name limit 1`)
  if (existing) return existing.id as string
  const { rows: [created] } = await db.query(
    `insert into app.tax_rates (tenant_id, name, cgst_rate, sgst_rate) values ($1, 'Sample rate, check before use', 2.5, 2.5) returning id`,
    [tenantId],
  )
  return created.id as string
}

/** Sample bills would take real numbers from a GST series, so samples stop at the menu and tables. */
setup.post('/setup/sample', requires('business.write'), async (c) => {
  await readBody(c, z.strictObject({}))
  const branchId = c.get('actor').branchIds[0]
  if (!branchId) throw forbidden()
  return command(c, 201, async (db, actor) => {
    const { rowCount } = await db.query(`select 1 from app.products where is_active limit 1`)
    if (rowCount) throw new AppError(409, 'menu_not_empty', 'Your menu already has items, so sample data can’t be added.')

    const taxRateId = await sampleTaxRate(db, actor.tenantId)
    const { rows: [addon] } = await db.query(
      `insert into app.addons (tenant_id, name, price) values ($1, 'Extra shot', 40) returning id`,
      [actor.tenantId],
    )
    for (const [index, group] of SAMPLE_MENU.entries()) {
      const { rows: [category] } = await db.query(
        `insert into app.categories (tenant_id, name, sort_order, icon, is_sample) values ($1, $2, $3, $4, true)
         on conflict (tenant_id, name) do update set is_active = true, is_sample = true returning id`,
        [actor.tenantId, group.category, index + 1, group.icon],
      )
      for (const item of group.items) {
        const { rows: [product] } = await db.query(
          `insert into app.products (tenant_id, category_id, name, description, food_type, tax_rate_id, is_sample)
           values ($1, $2, $3, $4, $5, $6, true) returning id`,
          [actor.tenantId, category.id, item.name, item.description, item.food, taxRateId],
        )
        for (const [order, [size, price]] of item.sizes.entries()) {
          await db.query(
            `insert into app.product_variants (tenant_id, product_id, name, price, sort_order) values ($1, $2, $3, $4, $5)`,
            [actor.tenantId, product.id, size, price, order],
          )
        }
        if (item.shot) {
          await db.query(`insert into app.product_addons (tenant_id, product_id, addon_id) values ($1, $2, $3)`, [actor.tenantId, product.id, addon.id])
        }
      }
    }

    const { rowCount: seated } = await db.query(`select 1 from app.dining_tables where branch_id = $1 and is_active limit 1`, [branchId])
    if (!seated) {
      const { rows: [area] } = await db.query(
        `insert into app.floor_areas (tenant_id, branch_id, name, is_sample) values ($1, $2, 'Sample floor', true) returning id`,
        [actor.tenantId, branchId],
      )
      for (const table of SAMPLE_TABLES) {
        await db.query(
          `insert into app.dining_tables (tenant_id, branch_id, area_id, name, seats, shape, pos_x, pos_y, is_sample)
           values ($1, $2, $3, $4, $5, $6, $7, $8, true)`,
          [actor.tenantId, branchId, area.id, table.name, table.seats, table.shape, table.x, table.y],
        )
      }
    }
    await audit(db, actor, 'sample.added', 'tenant', actor.tenantId)
    return { added: true }
  })
})

/** Hides what the samples added. A sample that was sold stays in the records behind its bills. */
setup.post('/setup/sample/clear', requires('business.write'), async (c) => {
  await readBody(c, z.strictObject({}))
  return command(c, 200, async (db, actor) => {
    await db.query(`update app.products set is_active = false where is_sample`)
    await db.query(`update app.categories set is_active = false where is_sample`)
    await db.query(
      `update app.addons a set is_active = false where a.name = 'Extra shot'
          and exists (select 1 from app.product_addons pa join app.products p on p.id = pa.product_id where pa.addon_id = a.id and p.is_sample)
          and not exists (select 1 from app.product_addons pa join app.products p on p.id = pa.product_id where pa.addon_id = a.id and not p.is_sample)`,
    )
    await db.query(
      `update app.dining_tables t set is_active = false
        where t.is_sample and t.seated_at is null
          and not exists (select 1 from app.orders o where o.table_id = t.id and o.status = 'open')`,
    )
    await db.query(
      `update app.floor_areas a set is_active = false
        where a.is_sample and not exists (select 1 from app.dining_tables t where t.area_id = a.id and t.is_active)`,
    )
    await audit(db, actor, 'sample.cleared', 'tenant', actor.tenantId)
    return { cleared: true }
  })
})

// Named columns, so a new secret column can never leak into a download.
const BACKUP: Record<string, string> = {
  business: `select id, display_name, currency, rounding_rule, prices_include_tax, upi_id, fssai_number, bill_footer, created_at from app.tenants`,
  taxRegistrations: `select id, legal_name, trade_name, gstin, state_code, scheme, address, is_active from app.tax_registrations`,
  branches: `select id, name, code, address, phone, timezone, day_cutoff, is_active from app.branches`,
  staff: `select id, display_name, role, status, created_at from app.memberships`,
  customers: `select id, name, phone, email, address, notes, created_at from app.customers`,
  categories: `select id, name, sort_order, icon, is_active from app.categories`,
  taxRates: `select id, name, cgst_rate, sgst_rate, igst_rate, cess_rate, is_active from app.tax_rates`,
  products: `select id, category_id, tax_rate_id, name, description, food_type, hsn_sac, is_active from app.products`,
  variants: `select id, product_id, name, price, is_active from app.product_variants`,
  addons: `select id, name, price, is_active from app.addons`,
  orders: `select id, branch_id, display_number, order_type, status, table_label, customer_id, business_date, notes, cancel_reason, created_by, created_at from app.orders`,
  orderItems: `select id, order_id, product_name, variant_name, unit_price, quantity, status, void_reason, created_at from app.order_items`,
  bills: `select id, branch_id, order_id, document_type, number, invoice_date, business_date, customer_id, taxable_total, cgst_total, sgst_total, igst_total, cess_total, round_off, grand_total, issued_by, issued_at from app.invoices`,
  billLines: `select id, invoice_id, description, hsn_sac, quantity, unit_price, discount, taxable_value, cgst_rate, sgst_rate, igst_rate, cess_rate, cgst, sgst, igst, cess from app.invoice_lines`,
  creditNotes: `select id, branch_id, invoice_id, number, kind, reason, note_date, business_date, taxable_total, grand_total, issued_by, issued_at from app.credit_notes`,
  payments: `select id, branch_id, method_id, method_kind, amount, tip_amount, reference, status, status_reason, business_date, created_at from app.payments`,
  refunds: `select id, branch_id, amount, status, status_reason, business_date, created_at from app.refunds`,
  cashSessions: `select id, branch_id, business_date, status, opening_amount, expected_amount, counted_amount, variance, opened_at from app.cash_sessions`,
  expenses: `select id, branch_id, name, category, amount, expense_date, method, reference, notes, status, void_reason, created_at from app.expenses`,
  suppliers: `select id, name, phone, notes from app.suppliers`,
  stockItems: `select id, name, category, unit, cost, min_stock, is_active from app.stock_items`,
  stockMoves: `select id, branch_id, stock_item_id, kind, quantity, reason, created_at from app.stock_moves`,
}

setup.get('/backup', requires('backup.download'), (c) => c.json({ sections: Object.keys(BACKUP) }))

/** One section a page at a time, because a whole business can be larger than one response may be. */
setup.get('/backup/:section', requires('backup.download'), async (c) => {
  const section = c.req.param('section')
  if (!Object.hasOwn(BACKUP, section)) throw notFound('Backup section')
  const offset = z.coerce.number().int().min(0).default(0).parse(c.req.query('offset'))
  const actor = c.get('actor')
  const rows = await tx(dbContext(actor), async (db) => {
    const result = await db.query(`${BACKUP[section]} order by 1 limit ${BACKUP_PAGE} offset $1`, [offset])
    if (section === 'business') await audit(db, actor, 'backup.downloaded', 'tenant', actor.tenantId)
    return result.rows
  })
  return c.json({ rows, nextOffset: rows.length === BACKUP_PAGE ? offset + BACKUP_PAGE : null })
})
