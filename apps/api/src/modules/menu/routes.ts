import { Hono } from 'hono'
import { z } from 'zod'
import { audit, command, dbContext, readBody, requires, session, type Env } from '../../platform/context'
import { tx } from '../../platform/db'
import { forbidden, notFound } from '../../platform/errors'

export const menu = new Hono<Env>()
menu.use(session)

const money = z.string().regex(/^\d{1,12}(\.\d{1,2})?$/, 'Enter an amount such as 120 or 120.50.')
const rate = z.string().regex(/^\d{1,3}(\.\d{1,3})?$/).refine((value) => Number(value) <= 100, 'A rate cannot exceed 100.')
const name = z.string().trim().min(1).max(120)
const foodType = z.enum(['veg', 'non_veg', 'egg', 'none'])
const id = (value: string | undefined) => z.uuid().parse(value)

const newRate = z.strictObject({
  name,
  cgstRate: rate.default('0'),
  sgstRate: rate.default('0'),
  igstRate: rate.default('0'),
  cessRate: rate.default('0'),
})
const rateUpdate = z.strictObject({ name: name.optional(), isActive: z.boolean().optional() })
const newCategory = z.strictObject({ name, sortOrder: z.number().int().default(0) })
const categoryUpdate = z.strictObject({ name: name.optional(), sortOrder: z.number().int().optional(), isActive: z.boolean().optional() })
const newVariant = z.strictObject({ name, price: money, sortOrder: z.number().int().default(0) })
const variantUpdate = z.strictObject({ name: name.optional(), price: money.optional(), sortOrder: z.number().int().optional(), isActive: z.boolean().optional() })
const newProduct = z.strictObject({
  name,
  categoryId: z.uuid(),
  taxRateId: z.uuid(),
  description: z.string().trim().max(500).optional(),
  foodType: foodType.default('none'),
  hsnSac: z.string().trim().max(12).optional(),
  variants: z.array(newVariant).min(1).max(20),
})
const productUpdate = z.strictObject({
  name: name.optional(),
  categoryId: z.uuid().optional(),
  taxRateId: z.uuid().optional(),
  description: z.string().trim().max(500).optional(),
  foodType: foodType.optional(),
  hsnSac: z.string().trim().max(12).optional(),
  isActive: z.boolean().optional(),
})
const newAddon = z.strictObject({ name, price: money })
const addonUpdate = z.strictObject({ name: name.optional(), price: money.optional(), isActive: z.boolean().optional() })
const productAddons = z.strictObject({ addonIds: z.array(z.uuid()).max(50) })
// A null price removes the branch's price and returns it to the menu price.
const override = z.strictObject({ price: money.nullable(), isAvailable: z.boolean() })

/** The menu as one branch sells it. With no branch, it shows the business-wide prices. */
menu.get('/menu', requires('menu.read'), async (c) => {
  const actor = c.get('actor')
  const branchId = c.req.query('branchId') ?? (actor.branchIds.length === 1 ? actor.branchIds[0] : null)
  if (branchId && !actor.branchIds.includes(branchId)) throw forbidden()

  const data = await tx(dbContext(actor), async (db) => {
    const categories = await db.query(`select id, name, sort_order, is_active from app.categories order by sort_order, name`)
    const taxRates = await db.query(
      `select id, name, cgst_rate::text, sgst_rate::text, igst_rate::text, cess_rate::text, is_active from app.tax_rates order by name`,
    )
    const addons = await db.query(`select id, name, price::text, is_active from app.addons order by name`)
    const products = await db.query(
      `select p.id, p.name, p.description, p.food_type, p.hsn_sac, p.category_id, p.tax_rate_id, p.is_active,
              coalesce((select array_agg(pa.addon_id) from app.product_addons pa where pa.product_id = p.id), '{}') as addon_ids,
              jsonb_agg(jsonb_build_object(
                'id', v.id, 'name', v.name, 'isActive', v.is_active,
                'menuPrice', v.price::text,
                'price', coalesce(o.price, v.price)::text,
                'hasBranchPrice', o.price is not null,
                'isAvailable', v.is_active and coalesce(o.is_available, true)
              ) order by v.sort_order, v.name) as variants
         from app.products p
         join app.product_variants v on v.product_id = p.id
         left join app.branch_variant_overrides o on o.variant_id = v.id and o.branch_id = $1
        group by p.id order by p.name`,
      [branchId],
    )
    return { branchId, categories: categories.rows, taxRates: taxRates.rows, addons: addons.rows, products: products.rows }
  })
  return c.json(data)
})

menu.post('/tax-rates', requires('menu.write'), async (c) => {
  const input = await readBody(c, newRate)
  return command(c, 201, async (db, actor) => {
    const { rows: [row] } = await db.query(
      `insert into app.tax_rates (tenant_id, name, cgst_rate, sgst_rate, igst_rate, cess_rate)
       values ($1, $2, $3, $4, $5, $6) returning id, name`,
      [actor.tenantId, input.name, input.cgstRate, input.sgstRate, input.igstRate, input.cessRate],
    )
    await audit(db, actor, 'tax_rate.created', 'tax_rate', row.id, input)
    return row
  })
})

// A rate's percentages never change. Create a new rate instead, so a rate's meaning stays stable.
menu.patch('/tax-rates/:id', requires('menu.write'), async (c) => {
  const rateId = id(c.req.param('id'))
  const input = await readBody(c, rateUpdate)
  return command(c, 200, async (db, actor) => {
    const { rows } = await db.query(
      `update app.tax_rates set name = coalesce($2, name), is_active = coalesce($3, is_active) where id = $1 returning id, name, is_active`,
      [rateId, input.name, input.isActive],
    )
    if (!rows[0]) throw notFound('Tax rate')
    await audit(db, actor, 'tax_rate.updated', 'tax_rate', rateId, input)
    return rows[0]
  })
})

menu.post('/categories', requires('menu.write'), async (c) => {
  const input = await readBody(c, newCategory)
  return command(c, 201, async (db, actor) => {
    const { rows: [row] } = await db.query(
      `insert into app.categories (tenant_id, name, sort_order) values ($1, $2, $3) returning id, name, sort_order, is_active`,
      [actor.tenantId, input.name, input.sortOrder],
    )
    return row
  })
})

menu.patch('/categories/:id', requires('menu.write'), async (c) => {
  const categoryId = id(c.req.param('id'))
  const input = await readBody(c, categoryUpdate)
  return command(c, 200, async (db) => {
    const { rows } = await db.query(
      `update app.categories set name = coalesce($2, name), sort_order = coalesce($3, sort_order), is_active = coalesce($4, is_active)
        where id = $1 returning id, name, sort_order, is_active`,
      [categoryId, input.name, input.sortOrder, input.isActive],
    )
    if (!rows[0]) throw notFound('Category')
    return rows[0]
  })
})

menu.post('/products', requires('menu.write'), async (c) => {
  const input = await readBody(c, newProduct)
  return command(c, 201, async (db, actor) => {
    const { rows: [product] } = await db.query(
      `insert into app.products (tenant_id, category_id, name, description, food_type, hsn_sac, tax_rate_id)
       values ($1, $2, $3, $4, $5, $6, $7) returning id, name`,
      [actor.tenantId, input.categoryId, input.name, input.description, input.foodType, input.hsnSac, input.taxRateId],
    )
    for (const variant of input.variants) {
      await db.query(
        `insert into app.product_variants (tenant_id, product_id, name, price, sort_order) values ($1, $2, $3, $4, $5)`,
        [actor.tenantId, product.id, variant.name, variant.price, variant.sortOrder],
      )
    }
    await audit(db, actor, 'product.created', 'product', product.id, input)
    return product
  })
})

menu.patch('/products/:id', requires('menu.write'), async (c) => {
  const productId = id(c.req.param('id'))
  const input = await readBody(c, productUpdate)
  return command(c, 200, async (db, actor) => {
    const { rows } = await db.query(
      `update app.products set
         name = coalesce($2, name), category_id = coalesce($3, category_id), tax_rate_id = coalesce($4, tax_rate_id),
         description = coalesce($5, description), food_type = coalesce($6, food_type),
         hsn_sac = coalesce($7, hsn_sac), is_active = coalesce($8, is_active)
       where id = $1 returning id, name, is_active`,
      [productId, input.name, input.categoryId, input.taxRateId, input.description, input.foodType, input.hsnSac, input.isActive],
    )
    if (!rows[0]) throw notFound('Product')
    await audit(db, actor, 'product.updated', 'product', productId, input)
    return rows[0]
  })
})

menu.post('/products/:id/variants', requires('menu.write'), async (c) => {
  const productId = id(c.req.param('id'))
  const input = await readBody(c, newVariant)
  return command(c, 201, async (db, actor) => {
    const { rows: [row] } = await db.query(
      `insert into app.product_variants (tenant_id, product_id, name, price, sort_order)
       values ($1, $2, $3, $4, $5) returning id, name, price::text`,
      [actor.tenantId, productId, input.name, input.price, input.sortOrder],
    )
    await audit(db, actor, 'variant.created', 'variant', row.id, input)
    return row
  })
})

menu.patch('/variants/:id', requires('menu.write'), async (c) => {
  const variantId = id(c.req.param('id'))
  const input = await readBody(c, variantUpdate)
  return command(c, 200, async (db, actor) => {
    const { rows: [before] } = await db.query(`select name, price::text, is_active from app.product_variants where id = $1`, [variantId])
    if (!before) throw notFound('Variant')
    const { rows: [row] } = await db.query(
      `update app.product_variants set
         name = coalesce($2, name), price = coalesce($3, price),
         sort_order = coalesce($4, sort_order), is_active = coalesce($5, is_active)
       where id = $1 returning id, name, price::text, is_active`,
      [variantId, input.name, input.price, input.sortOrder, input.isActive],
    )
    await audit(db, actor, 'variant.updated', 'variant', variantId, row, before)
    return row
  })
})

menu.post('/addons', requires('menu.write'), async (c) => {
  const input = await readBody(c, newAddon)
  return command(c, 201, async (db, actor) => {
    const { rows: [row] } = await db.query(
      `insert into app.addons (tenant_id, name, price) values ($1, $2, $3) returning id, name, price::text, is_active`,
      [actor.tenantId, input.name, input.price],
    )
    await audit(db, actor, 'addon.created', 'addon', row.id, input)
    return row
  })
})

menu.patch('/addons/:id', requires('menu.write'), async (c) => {
  const addonId = id(c.req.param('id'))
  const input = await readBody(c, addonUpdate)
  return command(c, 200, async (db, actor) => {
    const { rows } = await db.query(
      `update app.addons set name = coalesce($2, name), price = coalesce($3, price), is_active = coalesce($4, is_active)
        where id = $1 returning id, name, price::text, is_active`,
      [addonId, input.name, input.price, input.isActive],
    )
    if (!rows[0]) throw notFound('Add-on')
    await audit(db, actor, 'addon.updated', 'addon', addonId, input)
    return rows[0]
  })
})

menu.put('/products/:id/addons', requires('menu.write'), async (c) => {
  const productId = id(c.req.param('id'))
  const input = await readBody(c, productAddons)
  return command(c, 200, async (db, actor) => {
    const { rowCount } = await db.query(`select 1 from app.products where id = $1`, [productId])
    if (!rowCount) throw notFound('Product')
    await db.query(`delete from app.product_addons where product_id = $1`, [productId])
    for (const addonId of new Set(input.addonIds)) {
      await db.query(`insert into app.product_addons (tenant_id, product_id, addon_id) values ($1, $2, $3)`, [actor.tenantId, productId, addonId])
    }
    return { addonIds: input.addonIds }
  })
})

menu.put('/branches/:branchId/variants/:variantId', requires('menu.write'), async (c) => {
  const branchId = id(c.req.param('branchId'))
  const variantId = id(c.req.param('variantId'))
  if (!c.get('actor').branchIds.includes(branchId)) throw forbidden()
  const input = await readBody(c, override)
  return command(c, 200, async (db, actor) => {
    await db.query(
      `insert into app.branch_variant_overrides (tenant_id, branch_id, variant_id, price, is_available)
       values ($1, $2, $3, $4, $5)
       on conflict (tenant_id, branch_id, variant_id) do update set price = excluded.price, is_available = excluded.is_available`,
      [actor.tenantId, branchId, variantId, input.price, input.isAvailable],
    )
    await audit(db, actor, 'variant.branch_override', 'variant', variantId, { branchId, ...input })
    return { branchId, variantId, ...input }
  })
})
