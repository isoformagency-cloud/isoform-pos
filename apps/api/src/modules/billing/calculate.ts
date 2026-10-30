// All money here is whole paise in BigInt, so floating point can never affect a bill.
// Rounding is half-up. Tax rules marked for review are in docs/03-database-design.md section 12.

export const paise = (value: string): bigint => {
  const negative = value.startsWith('-')
  const [whole, fraction = ''] = value.replace('-', '').split('.')
  const amount = BigInt(whole) * 100n + BigInt((fraction + '00').slice(0, 2))
  return negative ? -amount : amount
}

export const rupees = (value: bigint): string => {
  const sign = value < 0n ? '-' : ''
  const abs = value < 0n ? -value : value
  return `${sign}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`
}

/** Fixed-point value with three decimals: 2.500 becomes 2500n. */
export const milli = (value: string): bigint => {
  const [whole, fraction = ''] = value.split('.')
  return BigInt(whole) * 1000n + BigInt((fraction + '000').slice(0, 3))
}

export const fromMilli = (value: bigint) => `${value / 1000n}.${String(value % 1000n).padStart(3, '0')}`

export const divide = (numerator: bigint, denominator: bigint) => (numerator * 2n + denominator) / (denominator * 2n)

const HUNDRED_PERCENT = 100000n

export interface TaxRates {
  cgst: string
  sgst: string
  igst: string
  cess: string
}

export interface BillPiece {
  group: number
  orderItemId: string | null
  description: string
  hsnSac: string | null
  quantity: string
  unitPrice: string
  rates: TaxRates
}

export interface Discount {
  kind: 'percent' | 'amount'
  value: string
}

export interface BillSettings {
  chargesTax: boolean
  pricesIncludeTax: boolean
  roundingRule: 'none' | 'nearest_rupee'
  serviceChargePercent: string
}

export interface BillLine {
  orderItemId: string | null
  description: string
  hsnSac: string | null
  quantity: string
  unitPrice: string
  discount: string
  taxableValue: string
  rates: TaxRates
  cgst: string
  sgst: string
  igst: string
  cess: string
}

export interface Bill {
  lines: BillLine[]
  taxableTotal: string
  cgstTotal: string
  sgstTotal: string
  igstTotal: string
  cessTotal: string
  roundOff: string
  grandTotal: string
}

const NO_TAX: TaxRates = { cgst: '0', sgst: '0', igst: '0', cess: '0' }
const COMPONENTS = ['cgst', 'sgst', 'igst', 'cess'] as const
type Amounts = Record<(typeof COMPONENTS)[number], bigint>

const rateTotal = (rates: TaxRates) => COMPONENTS.reduce((sum, key) => sum + milli(rates[key]), 0n)

/** Splits a discount across lines by value. Any leftover paise go to the largest lines. */
function allocate(total: bigint, weights: bigint[]) {
  const sum = weights.reduce((a, b) => a + b, 0n)
  if (sum === 0n) return weights.map(() => 0n)
  const shares = weights.map((weight) => (total * weight) / sum)
  let leftover = total - shares.reduce((a, b) => a + b, 0n)
  const order = weights.map((_, index) => index).sort((a, b) => (weights[b] > weights[a] ? 1 : weights[b] < weights[a] ? -1 : 0))
  for (const index of order) {
    if (leftover === 0n) break
    if (shares[index] < weights[index]) {
      shares[index] += 1n
      leftover -= 1n
    }
  }
  return shares
}

function taxLine(amount: bigint, rates: TaxRates, includesTax: boolean): { taxable: bigint; taxes: Amounts } {
  const total = rateTotal(rates)
  const taxable = includesTax ? divide(amount * HUNDRED_PERCENT, HUNDRED_PERCENT + total) : amount
  const taxes = Object.fromEntries(COMPONENTS.map((key) => [key, divide(taxable * milli(rates[key]), HUNDRED_PERCENT)])) as Amounts
  if (includesTax) {
    // Rounding must not move the price the customer sees, so the last tax absorbs any paisa.
    const gap = amount - taxable - COMPONENTS.reduce((sum, key) => sum + taxes[key], 0n)
    const last = [...COMPONENTS].reverse().find((key) => milli(rates[key]) > 0n)
    if (last) taxes[last] += gap
  }
  return { taxable, taxes }
}

export function discountTotal(subtotal: bigint, discounts: Discount[]) {
  return discounts.reduce(
    (sum, discount) => sum + (discount.kind === 'amount' ? paise(discount.value) : divide(subtotal * paise(discount.value), 10000n)),
    0n,
  )
}

/** Turns order pieces into one bill per group. One order can be split into several bills. */
export function calculateBills(pieces: BillPiece[], discounts: Discount[], settings: BillSettings): Bill[] {
  const gross = pieces.map((piece) => divide(paise(piece.unitPrice) * milli(piece.quantity), 1000n))
  const subtotal = gross.reduce((a, b) => a + b, 0n)
  const totalDiscount = discountTotal(subtotal, discounts)
  if (totalDiscount > subtotal) throw new RangeError('discount exceeds subtotal')
  const shares = allocate(totalDiscount, gross)
  const groups = [...new Set(pieces.map((piece) => piece.group))].sort((a, b) => a - b)

  return groups.map((group) => {
    const lines: BillLine[] = []
    const totals: Amounts & { taxable: bigint } = { taxable: 0n, cgst: 0n, sgst: 0n, igst: 0n, cess: 0n }
    let highestRates = NO_TAX

    const push = (line: Omit<BillLine, 'taxableValue' | 'cgst' | 'sgst' | 'igst' | 'cess' | 'discount' | 'rates'>, amount: bigint, discount: bigint, rates: TaxRates, includesTax: boolean) => {
      const applied = settings.chargesTax ? rates : NO_TAX
      const { taxable, taxes } = taxLine(amount, applied, settings.chargesTax && includesTax)
      totals.taxable += taxable
      for (const key of COMPONENTS) totals[key] += taxes[key]
      lines.push({
        ...line,
        discount: rupees(discount),
        taxableValue: rupees(taxable),
        rates: applied,
        cgst: rupees(taxes.cgst),
        sgst: rupees(taxes.sgst),
        igst: rupees(taxes.igst),
        cess: rupees(taxes.cess),
      })
    }

    pieces.forEach((piece, index) => {
      if (piece.group !== group) return
      if (rateTotal(piece.rates) > rateTotal(highestRates)) highestRates = piece.rates
      const { group: _group, rates, ...line } = piece
      push(line, gross[index] - shares[index], shares[index], rates, settings.pricesIncludeTax)
    })

    // Service charge is voluntary and only exists if a person added it. It is taxed
    // at the bill's highest item rate, which an accountant must confirm.
    const base = pieces.reduce((sum, piece, index) => (piece.group === group ? sum + gross[index] - shares[index] : sum), 0n)
    const charge = divide(base * milli(settings.serviceChargePercent), HUNDRED_PERCENT)
    if (charge > 0n) {
      push(
        { orderItemId: null, description: 'Service charge (voluntary)', hsnSac: null, quantity: '1.000', unitPrice: rupees(charge) },
        charge, 0n, highestRates, false,
      )
    }

    const beforeRounding = totals.taxable + totals.cgst + totals.sgst + totals.igst + totals.cess
    const grand = settings.roundingRule === 'nearest_rupee' ? divide(beforeRounding, 100n) * 100n : beforeRounding
    return {
      lines,
      taxableTotal: rupees(totals.taxable),
      cgstTotal: rupees(totals.cgst),
      sgstTotal: rupees(totals.sgst),
      igstTotal: rupees(totals.igst),
      cessTotal: rupees(totals.cess),
      roundOff: rupees(grand - beforeRounding),
      grandTotal: rupees(grand),
    }
  })
}

/** Indian financial year code for a date: 2026-10-30 is 2627, and 2027-01-15 is also 2627. */
export function financialYear(date: string) {
  const [year, month] = date.split('-').map(Number)
  const start = month < 4 ? year - 1 : year
  return `${String(start).slice(2)}${String(start + 1).slice(2)}`
}
