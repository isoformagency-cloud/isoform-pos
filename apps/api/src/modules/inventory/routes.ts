import { Hono } from 'hono'
import { z } from 'zod'
import { audit, command, dbContext, readBody, requires, session, type Actor, type Env } from '../../platform/context.js'
import { tx, type Db } from '../../platform/db.js'
import { AppError, notFound } from '../../platform/errors.js'
import { can } from '../../platform/permissions.js'
import { recordExpense } from '../expenses/routes.js'

export const inventory = new Hono<Env>()
inventory.use(session)

const uuidParam = (value: string | undefined) => z.uuid().parse(value)
const quantity = z.string().regex(/^\d{1,9}(\.\d{1,3})?$/)
const positive = quantity.refine((value) => Number(value) > 0, 'Enter a quantity above zero.')
const money = z.string().regex(/^\d{1,12}(\.\d{1,2})?$/)
const name = z.string().trim().min(2).max(120)
const unit = z.enum(['kg', 'g', 'L', 'ml', 'pcs', 'pack', 'box', 'dozen'])

const newItem = z.strictObject({
  name, unit,
  category: z.string().trim().min(2).max(40).default('General'),
  cost: money.default('0'),
  minStock: quantity.default('0'),
  supplierId: z.uuid().optional(),
})
const itemUpdate = z.strictObject({
  name: name.optional(),
  category: z.string().trim().min(2).max(40).optional(),
  cost: money.optional(),
  minStock: quantity.optional(),
  supplierId: z.uuid().nullable().optional(),
  isActive: z.boolean().optional(),
})
const stockChange = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('in'),
    quantity: positive,
    unitCost: money.optional(),
    supplierId: z.uuid().optional(),
    reason: z.string().trim().max(200).optional(),
    expense: z.strictObject({ id: z.uuid(), method: z.enum(['cash', 'upi', 'card', 'bank_transfer', 'cheque', 'other']), expenseDate: z.iso.date(), fromDrawer: z.boolean().default(false) }).optional(),
  }),
  z.strictObject({ kind: z.literal('out'), quantity: positive, reason: z.string().trim().min(2).max(200) }),
  z.strictObject({ kind: z.literal('count'), quantity, reason: z.string().trim().max(200).optional() }),
])
const newSupplier = z.strictObject({ name, phone: z.string().regex(/^\d{10}$/).optional(), notes: z.string().trim().max(300).optional() })
const supplierUpdate = z.strictObject({
  name: name.optional(),
  phone: z.string().regex(/^\d{10}$/).optional(),
  notes: z.string().trim().max(300).optional(),
  isActive: z.boolean().optional(),
})
const recipe = z.strictObject({ lines: z.array(z.strictObject({ stockItemId: z.uuid(), quantity: positive })).max(30) })

function workingBranch(actor: Actor) {
  if (actor.branchIds.length !== 1) throw new AppError(400, 'branch_required', 'Choose a branch first.')
  return actor.branchIds[0]
}

const levelOf = async (db: Db, branchId: string, itemId: string) => {
  const { rows: [row] } = await db.query(
    `select coalesce(l.quantity, 0)::text as quantity, s.name, s.unit, s.cost::text, s.is_active
       from app.stock_items s
       left join app.stock_levels l on l.stock_item_id = s.id and l.branch_id = $1
      where s.id = $2`,
    [branchId, itemId],
  )
  if (!row) throw notFound('Ingredient')
  return row
}

/** Sales take their recipe quantities off stock. A sale is never refused for low stock. */
export async function deductForSale(db: Db, actor: Actor, branchId: string, orderId: string) {
  await db.query(
    `insert into app.stock_moves (tenant_id, branch_id, stock_item_id, kind, quantity, order_id, created_by)
     select $1, $2, r.stock_item_id, 'sale', -sum(i.quantity * r.quantity), $3, $4
       from app.order_items i
       join app.product_variants v on v.id = i.variant_id
       join app.recipe_lines r on r.product_id = v.product_id
       join app.stock_items s on s.id = r.stock_item_id and s.is_active
      where i.order_id = $3 and i.status = 'active'
      group by r.stock_item_id`,
    [actor.tenantId, branchId, orderId, actor.membershipId],
  )
}

inventory.get('/inventory', requires('inventory.read'), async (c) => {
  const actor = c.get('actor')
  const branchId = workingBranch(actor)
  const data = await tx(dbContext(actor), async (db) => {
    const { rows: items } = await db.query(
      `select s.id, s.name, s.category, s.unit, s.cost::text, s.min_stock::text, s.supplier_id, p.name as supplier_name,
              coalesce(l.quantity, 0)::text as quantity, l.updated_at
         from app.stock_items s
         left join app.suppliers p on p.id = s.supplier_id
         left join app.stock_levels l on l.stock_item_id = s.id and l.branch_id = $1
        where s.is_active order by s.category, s.name`,
      [branchId],
    )
    const out = items.filter((item) => Number(item.quantity) <= 0).length
    const low = items.filter((item) => Number(item.quantity) > 0 && Number(item.quantity) <= Number(item.min_stock)).length
    const value = items.reduce((sum, item) => sum + Math.max(Number(item.quantity), 0) * Number(item.cost), 0)
    return { items, totals: { items: items.length, low, out, value: value.toFixed(2) } }
  })
  return c.json(data)
})

/** A plain list for the recipe picker, which works whichever branch is chosen. */
inventory.get('/inventory/items', requires('inventory.read'), async (c) => {
  const items = await tx(dbContext(c.get('actor')), async (db) => {
    const { rows } = await db.query(`select id, name, unit from app.stock_items where is_active order by name`)
    return rows
  })
  return c.json({ items })
})

inventory.post('/inventory/items', requires('inventory.write'), async (c) => {
  const input = await readBody(c, newItem)
  return command(c, 201, async (db, actor) => {
    const { rows: [row] } = await db.query(
      `insert into app.stock_items (tenant_id, name, category, unit, cost, min_stock, supplier_id)
       values ($1, $2, $3, $4, $5, $6, $7) returning id, name`,
      [actor.tenantId, input.name, input.category, input.unit, input.cost, input.minStock, input.supplierId],
    )
    await audit(db, actor, 'stock_item.created', 'stock_item', row.id, input)
    return row
  })
})

inventory.patch('/inventory/items/:id', requires('inventory.write'), async (c) => {
  const id = uuidParam(c.req.param('id'))
  const input = await readBody(c, itemUpdate)
  return command(c, 200, async (db, actor) => {
    const { rows: [row] } = await db.query(
      `update app.stock_items set name = coalesce($2, name), category = coalesce($3, category), cost = coalesce($4, cost),
         min_stock = coalesce($5, min_stock), supplier_id = case when $6 then $7::uuid else supplier_id end, is_active = coalesce($8, is_active)
       where id = $1 returning id, name`,
      [id, input.name, input.category, input.cost, input.minStock, input.supplierId !== undefined, input.supplierId ?? null, input.isActive],
    )
    if (!row) throw notFound('Ingredient')
    if (input.isActive === false) await db.query(`delete from app.recipe_lines where stock_item_id = $1`, [id])
    await audit(db, actor, 'stock_item.updated', 'stock_item', id, input)
    return row
  })
})

inventory.post('/inventory/items/:id/moves', requires('inventory.write'), async (c) => {
  const id = uuidParam(c.req.param('id'))
  const input = await readBody(c, stockChange)
  const branchId = workingBranch(c.get('actor'))
  return command(c, 201, async (db, actor) => {
    // Held until commit, so a count can't be thrown off by a change landing at the same moment.
    await db.query(`select app.lock_record('stock', $1)`, [id])
    const current = await levelOf(db, branchId, id)
    if (!current.is_active) throw notFound('Ingredient')

    let change = input.quantity
    if (input.kind === 'out') change = `-${input.quantity}`
    if (input.kind === 'count') {
      change = (Number(input.quantity) - Number(current.quantity)).toFixed(3)
      if (Number(change) === 0) return { quantity: current.quantity, unchanged: true }
    }

    const unitCost = input.kind === 'in' ? input.unitCost : undefined
    let expenseId: string | null = null
    if (input.kind === 'in' && input.expense) {
      if (!can(actor, 'expenses.write')) throw new AppError(403, 'forbidden', 'You do not have permission to do this.')
      const total = Number(input.quantity) * Number(unitCost ?? current.cost)
      if (total <= 0) throw new AppError(422, 'cost_required', 'Enter a cost to record this as an expense.')
      await recordExpense(db, actor, branchId, {
        id: input.expense.id, name: `${current.name} purchase`, category: 'ingredients', amount: total.toFixed(2),
        expenseDate: input.expense.expenseDate, method: input.expense.method, fromDrawer: input.expense.fromDrawer,
      })
      expenseId = input.expense.id
    }

    await db.query(
      `insert into app.stock_moves (tenant_id, branch_id, stock_item_id, kind, quantity, unit_cost, reason, supplier_id, expense_id, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [actor.tenantId, branchId, id, input.kind, change, unitCost, input.reason || null,
        input.kind === 'in' ? input.supplierId : null, expenseId, actor.membershipId],
    )
    // Stock is valued at the latest purchase price.
    if (unitCost) await db.query(`update app.stock_items set cost = $2 where id = $1`, [id, unitCost])
    const { quantity: after } = await levelOf(db, branchId, id)
    return { quantity: after }
  })
})

inventory.get('/inventory/moves', requires('inventory.read'), async (c) => {
  const actor = c.get('actor')
  const itemId = z.uuid().optional().parse(c.req.query('itemId'))
  const items = await tx(dbContext(actor), async (db) => {
    const { rows } = await db.query(
      `select m.id, m.kind, m.quantity::text, m.unit_cost::text, m.reason, m.created_at, s.name as item_name, s.unit,
              b.display_name as created_by_name, p.name as supplier_name, o.display_number
         from app.stock_moves m
         join app.stock_items s on s.id = m.stock_item_id
         join app.memberships b on b.id = m.created_by
         left join app.suppliers p on p.id = m.supplier_id
         left join app.orders o on o.id = m.order_id
        where m.branch_id = any($1::uuid[]) and ($2::uuid is null or m.stock_item_id = $2)
        order by m.created_at desc limit 200`,
      [actor.branchIds, itemId ?? null],
    )
    return rows
  })
  return c.json({ items })
})

inventory.get('/suppliers', requires('inventory.read'), async (c) => {
  const items = await tx(dbContext(c.get('actor')), async (db) => {
    const { rows } = await db.query(
      `select p.id, p.name, p.phone, p.notes,
              (select count(*)::int from app.stock_items s where s.supplier_id = p.id and s.is_active) as item_count
         from app.suppliers p where p.is_active order by p.name`,
    )
    return rows
  })
  return c.json({ items })
})

inventory.post('/suppliers', requires('inventory.write'), async (c) => {
  const input = await readBody(c, newSupplier)
  return command(c, 201, async (db, actor) => {
    const { rows: [row] } = await db.query(
      `insert into app.suppliers (tenant_id, name, phone, notes) values ($1, $2, $3, $4) returning id, name`,
      [actor.tenantId, input.name, input.phone, input.notes],
    )
    return row
  })
})

inventory.patch('/suppliers/:id', requires('inventory.write'), async (c) => {
  const id = uuidParam(c.req.param('id'))
  const input = await readBody(c, supplierUpdate)
  return command(c, 200, async (db) => {
    const { rows: [row] } = await db.query(
      `update app.suppliers set name = coalesce($2, name), phone = coalesce($3, phone), notes = coalesce($4, notes), is_active = coalesce($5, is_active)
       where id = $1 returning id, name`,
      [id, input.name, input.phone, input.notes, input.isActive],
    )
    if (!row) throw notFound('Supplier')
    return row
  })
})

inventory.get('/products/:id/recipe', requires('menu.read'), async (c) => {
  const id = uuidParam(c.req.param('id'))
  const lines = await tx(dbContext(c.get('actor')), async (db) => {
    const { rows } = await db.query(
      `select r.stock_item_id, r.quantity::text, s.name, s.unit from app.recipe_lines r
         join app.stock_items s on s.id = r.stock_item_id where r.product_id = $1 order by s.name`,
      [id],
    )
    return rows
  })
  return c.json({ lines })
})

inventory.put('/products/:id/recipe', requires('menu.write'), async (c) => {
  const id = uuidParam(c.req.param('id'))
  const input = await readBody(c, recipe)
  return command(c, 200, async (db, actor) => {
    const { rows: [product] } = await db.query(`select id from app.products where id = $1`, [id])
    if (!product) throw notFound('Menu item')
    await db.query(`delete from app.recipe_lines where product_id = $1`, [id])
    // A later line wins, so listing an ingredient twice can't fail the save.
    const lines = new Map(input.lines.map((line) => [line.stockItemId, line.quantity]))
    for (const [stockItemId, amount] of lines) {
      await db.query(
        `insert into app.recipe_lines (tenant_id, product_id, stock_item_id, quantity) values ($1, $2, $3, $4)`,
        [actor.tenantId, id, stockItemId, amount],
      )
    }
    await audit(db, actor, 'recipe.updated', 'product', id, { lines: lines.size })
    return { saved: lines.size }
  })
})
