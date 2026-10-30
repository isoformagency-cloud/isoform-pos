import { Hono } from 'hono'
import { z } from 'zod'
import { audit, command, dbContext, readBody, requires, session, type Actor, type Env } from '../../platform/context.js'
import { tx, type Db } from '../../platform/db.js'
import { AppError, notFound } from '../../platform/errors.js'
import { calculateBills, divide, financialYear, fromMilli, milli, paise, rupees, type Bill, type BillPiece, type Discount } from './calculate.js'

export const billing = new Hono<Env>()
billing.use(session)

const version = z.number().int().positive()
const quantity = z.string().regex(/^\d{1,8}(\.\d{1,3})?$/).refine((value) => Number(value) > 0)
const uuidParam = (value: string | undefined) => z.uuid().parse(value)

const finalize = z.strictObject({
  version,
  invoices: z.array(z.strictObject({
    id: z.uuid(),
    items: z.array(z.strictObject({ orderItemId: z.uuid(), quantity })).optional(),
  })).min(1).max(20),
})

const creditNote = z.strictObject({
  id: z.uuid(),
  kind: z.enum(['cancellation', 'correction']),
  reason: z.string().trim().min(2).max(300),
  lines: z.array(z.strictObject({ invoiceLineId: z.uuid(), quantity })).optional(),
}).refine((value) => value.kind === 'cancellation' || Boolean(value.lines?.length), { message: 'Choose what to correct.' })

interface BillingData {
  order: any
  tenant: any
  registration: any
  branch: any
  items: any[]
  discounts: Discount[]
}

async function loadBillingData(db: Db, orderId: string): Promise<BillingData> {
  const { rows: [order] } = await db.query(
    `select id, branch_id, tenant_id, status, version, customer_id, service_charge_percent::text from app.orders where id = $1`,
    [orderId],
  )
  if (!order) throw notFound('Order')
  const { rows: [branch] } = await db.query(
    `select id, name, code, address, phone, timezone, day_cutoff, tax_registration_id,
            (now() at time zone timezone)::date::text as today,
            ((now() at time zone timezone) - day_cutoff::interval)::date::text as business_date
       from app.branches where id = $1`,
    [order.branch_id],
  )
  const { rows: [tenant] } = await db.query(`select rounding_rule, prices_include_tax from app.tenants where id = $1`, [order.tenant_id])
  const { rows: [registration] } = await db.query(
    `select id, legal_name, trade_name, gstin, state_code, scheme, address from app.tax_registrations where id = $1`,
    [branch.tax_registration_id],
  )
  const { rows: items } = await db.query(
    `select i.id, i.product_name, i.variant_name, i.quantity::text, p.hsn_sac,
            r.cgst_rate::text as cgst, r.sgst_rate::text as sgst, r.igst_rate::text as igst, r.cess_rate::text as cess,
            (i.unit_price + coalesce(a.extra, 0))::numeric(14,2)::text as unit_price,
            coalesce(a.names, '') as addon_names
       from app.order_items i
       join app.product_variants v on v.id = i.variant_id
       join app.products p on p.id = v.product_id
       join app.tax_rates r on r.id = p.tax_rate_id
       left join lateral (
         select sum(unit_price * quantity) as extra, string_agg(addon_name, ', ') as names
           from app.order_item_addons where order_item_id = i.id
       ) a on true
      where i.order_id = $1 and i.status = 'active'
      order by i.created_at`,
    [orderId],
  )
  const { rows: discounts } = await db.query(`select kind, value::text from app.order_discounts where order_id = $1 order by created_at`, [orderId])
  return { order, tenant, registration, branch, items, discounts }
}

const settingsFor = (data: BillingData) => ({
  chargesTax: data.registration.scheme === 'regular',
  pricesIncludeTax: data.tenant.prices_include_tax,
  roundingRule: data.tenant.rounding_rule,
  serviceChargePercent: data.order.service_charge_percent,
})

const pieceFor = (item: any, itemQuantity: string, group: number): BillPiece => ({
  group,
  orderItemId: item.id,
  description: [item.product_name, item.variant_name !== 'Regular' ? item.variant_name : '', item.addon_names ? `+ ${item.addon_names}` : '']
    .filter(Boolean).join(' '),
  hsnSac: item.hsn_sac,
  quantity: itemQuantity,
  unitPrice: item.unit_price,
  rates: { cgst: item.cgst, sgst: item.sgst, igst: item.igst, cess: item.cess },
})

function calculate(data: BillingData, pieces: BillPiece[]) {
  try {
    return calculateBills(pieces, data.discounts, settingsFor(data))
  } catch (error) {
    if (error instanceof RangeError) throw new AppError(409, 'discount_too_large', 'The discount is more than the order total.')
    throw error
  }
}

/** Finds or creates the numbering series, avoiding a prefix already used on this registration. */
async function seriesFor(db: Db, actor: Actor, registrationId: string, branch: any, documentType: string, year: string) {
  const find = () =>
    db.query(
      `select id from app.invoice_series
        where tax_registration_id = $1 and branch_id = $2 and register_id is null and document_type = $3 and financial_year = $4`,
      [registrationId, branch.id, documentType, year],
    )
  const { rows: [existing] } = await find()
  if (existing) return existing.id as string

  await db.query(`select app.lock_record('series', $1)`, [registrationId])
  const { rows: [again] } = await find()
  if (again) return again.id as string

  const short = branch.code.slice(0, 3)
  const candidates = documentType === 'credit_note'
    ? [`C${short}`, `X${short}`, `Y${short}`, `Z${short}`]
    : [branch.code, `S${short}`, `T${short}`, `U${short}`]
  const { rows: used } = await db.query(
    `select prefix from app.invoice_series where tax_registration_id = $1 and financial_year = $2`,
    [registrationId, year],
  )
  const prefix = candidates.find((candidate) => !used.some((row) => row.prefix === candidate))
  if (!prefix) throw new AppError(409, 'series_unavailable', 'No invoice series is available for this branch.')
  const { rows: [created] } = await db.query(
    `insert into app.invoice_series (tenant_id, tax_registration_id, branch_id, document_type, prefix, financial_year)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [actor.tenantId, registrationId, branch.id, documentType, prefix, year],
  )
  return created.id as string
}

async function saveInvoice(db: Db, actor: Actor, data: BillingData, id: string, bill: Bill, seriesId: string, documentType: string) {
  const { registration, branch } = data
  const seller = {
    legalName: registration.legal_name, tradeName: registration.trade_name, gstin: registration.gstin,
    stateCode: registration.state_code, address: registration.address, scheme: registration.scheme,
    branchName: branch.name, branchAddress: branch.address, branchPhone: branch.phone,
  }
  // The database assigns the number. Nothing here can choose it.
  const { rows: [invoice] } = await db.query(
    `insert into app.invoices (id, tenant_id, branch_id, tax_registration_id, order_id, series_id, document_type,
       invoice_date, business_date, customer_id, seller_snapshot, taxable_total, cgst_total, sgst_total, igst_total,
       cess_total, round_off, grand_total, issued_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
     returning id, number`,
    [id, actor.tenantId, branch.id, registration.id, data.order.id, seriesId, documentType, branch.today, branch.business_date,
      data.order.customer_id, JSON.stringify(seller), bill.taxableTotal, bill.cgstTotal, bill.sgstTotal, bill.igstTotal,
      bill.cessTotal, bill.roundOff, bill.grandTotal, actor.membershipId],
  )
  for (const [index, line] of bill.lines.entries()) {
    await db.query(
      `insert into app.invoice_lines (tenant_id, branch_id, invoice_id, order_item_id, line_number, description, hsn_sac,
         quantity, unit_price, discount, taxable_value, cgst_rate, sgst_rate, igst_rate, cess_rate, cgst, sgst, igst, cess)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
      [actor.tenantId, branch.id, id, line.orderItemId, index + 1, line.description, line.hsnSac, line.quantity, line.unitPrice,
        line.discount, line.taxableValue, line.rates.cgst, line.rates.sgst, line.rates.igst, line.rates.cess,
        line.cgst, line.sgst, line.igst, line.cess],
    )
  }
  return invoice as { id: string; number: string }
}

async function loadInvoice(db: Db, id: string) {
  const { rows: [invoice] } = await db.query(
    `select i.id, i.number, i.document_type, i.order_id, i.branch_id, i.invoice_date::text, i.business_date::text,
            i.seller_snapshot, i.buyer_snapshot, i.taxable_total::text, i.cgst_total::text, i.sgst_total::text,
            i.igst_total::text, i.cess_total::text, i.round_off::text, i.grand_total::text, i.issued_at,
            b.credited::text, b.allocated::text, b.refunded::text, b.outstanding::text
       from app.invoices i join app.invoice_balances b on b.invoice_id = i.id
      where i.id = $1`,
    [id],
  )
  if (!invoice) throw notFound('Invoice')
  const { rows: lines } = await db.query(
    `select l.id, l.line_number, l.description, l.hsn_sac, l.quantity::text, l.unit_price::text, l.discount::text, l.taxable_value::text,
            l.cgst_rate::text, l.sgst_rate::text, l.cgst::text, l.sgst::text, l.igst::text, l.cess::text,
            coalesce((select sum(c.quantity) from app.credit_note_lines c where c.invoice_line_id = l.id), 0)::text as credited_quantity
       from app.invoice_lines l where l.invoice_id = $1 order by l.line_number`,
    [id],
  )
  const { rows: creditNotes } = await db.query(
    `select id, number, kind, reason, note_date::text, grand_total::text from app.credit_notes where invoice_id = $1 order by issued_at`,
    [id],
  )
  return { ...invoice, lines, creditNotes }
}

billing.get('/orders/:id/quote', requires('billing.read'), async (c) => {
  const orderId = uuidParam(c.req.param('id'))
  const quote = await tx(dbContext(c.get('actor')), async (db) => {
    const data = await loadBillingData(db, orderId)
    if (data.items.length === 0) return { documentType: null, bill: null }
    const [bill] = calculate(data, data.items.map((item) => pieceFor(item, item.quantity, 0)))
    return { documentType: data.registration.scheme === 'regular' ? 'tax_invoice' : 'bill_of_supply', bill }
  })
  return c.json(quote)
})

billing.post('/orders/:id/finalize', requires('billing.write'), async (c) => {
  const orderId = uuidParam(c.req.param('id'))
  const input = await readBody(c, finalize)
  return command(c, 201, async (db, actor) => {
    // Takes the order first, so two tills can never bill it twice.
    const { rowCount } = await db.query(
      `update app.orders set status = 'finalized' where id = $1 and version = $2 and status = 'open'`,
      [orderId, input.version],
    )
    if (!rowCount) {
      const { rows: [current] } = await db.query(`select status from app.orders where id = $1`, [orderId])
      if (!current) throw notFound('Order')
      throw new AppError(409, 'stale_order', 'This order was changed on another screen. Check it and try again.')
    }

    const data = await loadBillingData(db, orderId)
    if (data.items.length === 0) throw new AppError(409, 'empty_order', 'Add at least one item before billing.')

    const pieces: BillPiece[] = []
    const billed = new Map<string, bigint>()
    input.invoices.forEach((invoice, group) => {
      for (const part of invoice.items ?? data.items.map((item) => ({ orderItemId: item.id, quantity: item.quantity }))) {
        const item = data.items.find((row) => row.id === part.orderItemId)
        if (!item) throw new AppError(422, 'invalid_item', 'That item is not on this order.')
        billed.set(item.id, (billed.get(item.id) ?? 0n) + milli(part.quantity))
        pieces.push(pieceFor(item, part.quantity, group))
      }
    })
    if (data.items.some((item) => billed.get(item.id) !== milli(item.quantity))) {
      throw new AppError(422, 'split_incomplete', 'Every item must be fully billed.')
    }
    if (new Set(pieces.map((piece) => piece.group)).size !== input.invoices.length) {
      throw new AppError(422, 'split_empty', 'Each bill needs at least one item.')
    }

    const bills = calculate(data, pieces)
    const documentType = data.registration.scheme === 'regular' ? 'tax_invoice' : 'bill_of_supply'
    const seriesId = await seriesFor(db, actor, data.registration.id, data.branch, documentType, financialYear(data.branch.today))

    const saved = []
    for (const [index, bill] of bills.entries()) {
      const invoice = await saveInvoice(db, actor, data, input.invoices[index].id, bill, seriesId, documentType)
      saved.push({ ...invoice, grandTotal: bill.grandTotal })
      await audit(db, actor, 'invoice.issued', 'invoice', invoice.id, { number: invoice.number, grandTotal: bill.grandTotal })
    }
    return { invoices: saved }
  })
})

billing.get('/invoices', requires('billing.read'), async (c) => {
  const actor = c.get('actor')
  const date = z.iso.date().optional().parse(c.req.query('date'))
  const before = z.iso.datetime({ offset: true }).optional().parse(c.req.query('before'))
  const unpaid = c.req.query('unpaid') === 'true'
  const items = await tx(dbContext(actor), async (db) => {
    const { rows } = await db.query(
      `select i.id, i.number, i.document_type, i.invoice_date::text, i.grand_total::text, i.issued_at, i.branch_id,
              b.credited::text, b.outstanding::text, c.name as customer_name, c.phone as customer_phone
         from app.invoices i join app.invoice_balances b on b.invoice_id = i.id
         left join app.customers c on c.id = i.customer_id
        where i.branch_id = any($1::uuid[]) and ($2::date is null or i.business_date = $2)
          and ($3::timestamptz is null or i.issued_at < $3) and (not $4 or b.outstanding > 0)
        order by i.issued_at desc limit 50`,
      [actor.branchIds, date ?? null, before ?? null, unpaid],
    )
    return rows
  })
  return c.json({ items, nextBefore: items.length === 50 ? items[49].issued_at : null })
})

billing.get('/invoices/:id', requires('billing.read'), async (c) => {
  const id = uuidParam(c.req.param('id'))
  return c.json(await tx(dbContext(c.get('actor')), (db) => loadInvoice(db, id)))
})

billing.post('/invoices/:id/credit-notes', requires('billing.correct'), async (c) => {
  const invoiceId = uuidParam(c.req.param('id'))
  const input = await readBody(c, creditNote)
  return command(c, 201, async (db, actor) => {
    await db.query(`select app.lock_record('invoice', $1)`, [invoiceId])
    const invoice = await loadInvoice(db, invoiceId)
    const { rows: [header] } = await db.query(
      `select i.tax_registration_id, b.code, b.name, b.id as branch_id,
              (now() at time zone b.timezone)::date::text as today,
              ((now() at time zone b.timezone) - b.day_cutoff::interval)::date::text as business_date
         from app.invoices i join app.branches b on b.id = i.branch_id where i.id = $1`,
      [invoiceId],
    )
    const { rows: [{ rounding_rule: rounding }] } = await db.query(`select rounding_rule from app.tenants where id = $1`, [actor.tenantId])

    const { rows: earlier } = await db.query(
      `select cl.invoice_line_id, sum(cl.taxable_value)::text taxable, sum(cl.cgst)::text cgst, sum(cl.sgst)::text sgst,
              sum(cl.igst)::text igst, sum(cl.cess)::text cess
         from app.credit_note_lines cl join app.credit_notes n on n.id = cl.credit_note_id
        where n.invoice_id = $1 group by cl.invoice_line_id`,
      [invoiceId],
    )
    const already = (lineId: string, key: 'taxable' | 'cgst' | 'sgst' | 'igst' | 'cess') =>
      paise(earlier.find((row) => row.invoice_line_id === lineId)?.[key] ?? '0')

    const requested = input.kind === 'cancellation'
      ? invoice.lines.map((line: any) => ({ invoiceLineId: line.id, quantity: fromMilli(milli(line.quantity) - milli(line.credited_quantity)) }))
        .filter((line: any) => milli(line.quantity) > 0n)
      : input.lines!
    if (requested.length === 0) throw new AppError(409, 'nothing_to_credit', 'This invoice has already been fully credited.')

    const noteLines = requested.map((part: { invoiceLineId: string; quantity: string }) => {
      const line = invoice.lines.find((row: any) => row.id === part.invoiceLineId)
      if (!line) throw new AppError(422, 'invalid_line', 'That line is not on this invoice.')
      const total = milli(line.quantity)
      const left = total - milli(line.credited_quantity)
      const wanted = milli(part.quantity)
      if (wanted > left) throw new AppError(422, 'over_credit', 'That is more than remains on this line.')
      // The last of a line takes whatever remains, so rounding can never leave a stray paisa.
      const share = (value: string, key: 'taxable' | 'cgst' | 'sgst' | 'igst' | 'cess') =>
        wanted === left ? paise(value) - already(line.id, key) : divide(paise(value) * wanted, total)
      return {
        invoiceLineId: line.id, quantity: part.quantity,
        taxable: share(line.taxable_value, 'taxable'), cgst: share(line.cgst, 'cgst'), sgst: share(line.sgst, 'sgst'),
        igst: share(line.igst, 'igst'), cess: share(line.cess, 'cess'),
      }
    })

    const sum = (key: 'taxable' | 'cgst' | 'sgst' | 'igst' | 'cess'): bigint =>
      (noteLines as any[]).reduce((total: bigint, line: any) => total + (line[key] as bigint), 0n)
    const beforeRounding: bigint = sum('taxable') + sum('cgst') + sum('sgst') + sum('igst') + sum('cess')
    const remaining = paise(invoice.grand_total) - paise(invoice.credited)
    const grand: bigint = input.kind === 'cancellation'
      ? remaining
      : rounding === 'nearest_rupee' ? divide(beforeRounding, 100n) * 100n : beforeRounding
    if (grand <= 0n) throw new AppError(409, 'nothing_to_credit', 'There is nothing left to credit.')

    const seriesId = await seriesFor(db, actor, header.tax_registration_id, { id: header.branch_id, code: header.code }, 'credit_note', financialYear(header.today))
    await db.query(
      `insert into app.credit_notes (id, tenant_id, branch_id, tax_registration_id, invoice_id, series_id, kind, reason, note_date,
         business_date, taxable_total, cgst_total, sgst_total, igst_total, cess_total, round_off, grand_total, issued_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
      [input.id, actor.tenantId, header.branch_id, header.tax_registration_id, invoiceId, seriesId, input.kind, input.reason,
        header.today, header.business_date, rupees(sum('taxable')), rupees(sum('cgst')), rupees(sum('sgst')), rupees(sum('igst')),
        rupees(sum('cess')), rupees(grand - beforeRounding), rupees(grand), actor.membershipId],
    )
    for (const line of noteLines) {
      await db.query(
        `insert into app.credit_note_lines (tenant_id, branch_id, credit_note_id, invoice_line_id, quantity, taxable_value, cgst, sgst, igst, cess)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [actor.tenantId, header.branch_id, input.id, line.invoiceLineId, line.quantity, rupees(line.taxable), rupees(line.cgst),
          rupees(line.sgst), rupees(line.igst), rupees(line.cess)],
      )
    }
    await audit(db, actor, 'credit_note.issued', 'invoice', invoiceId, { kind: input.kind, reason: input.reason, grandTotal: rupees(grand) })
    return loadInvoice(db, invoiceId)
  })
})
