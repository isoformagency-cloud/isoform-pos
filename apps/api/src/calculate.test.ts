// Hand-checked figures. These run in milliseconds with no database.
import { describe, expect, it } from 'vitest'
import { calculateBills, financialYear, paise, rupees, type BillPiece, type BillSettings } from './modules/billing/calculate'

const gst5 = { cgst: '2.5', sgst: '2.5', igst: '0', cess: '0' }
const gst18 = { cgst: '9', sgst: '9', igst: '0', cess: '0' }
const piece = (unitPrice: string, quantity = '1', rates = gst5, group = 0): BillPiece => ({
  group, orderItemId: null, description: 'Item', hsnSac: null, quantity, unitPrice, rates,
})
const regular: BillSettings = { chargesTax: true, pricesIncludeTax: false, roundingRule: 'nearest_rupee', serviceChargePercent: '0' }
const sum = (values: string[]) => rupees(values.reduce((total, value) => total + paise(value), 0n))

describe('tax on top of the price', () => {
  it('matches the website’s sample bill exactly', () => {
    const [bill] = calculateBills([piece('84', '3'), piece('150', '2'), piece('250'), piece('75', '2')], [], regular)
    expect(bill.taxableTotal).toBe('952.00')
    expect(bill.cgstTotal).toBe('23.80')
    expect(bill.sgstTotal).toBe('23.80')
    expect(bill.roundOff).toBe('0.40')
    expect(bill.grandTotal).toBe('1000.00')
  })
  it('rounds tax half-up on each line', () => {
    const [bill] = calculateBills([piece('10.10')], [], { ...regular, roundingRule: 'none' })
    expect(bill.cgstTotal).toBe('0.25')
    expect(bill.sgstTotal).toBe('0.25')
    expect(bill.grandTotal).toBe('10.60')
  })
  it('rounds the total down when that is nearest', () => {
    const [bill] = calculateBills([piece('100.10')], [], regular)
    expect(bill.grandTotal).toBe('105.00')
    expect(bill.roundOff).toBe('-0.10')
  })
  it('handles fractional quantities', () => {
    const [bill] = calculateBills([piece('333.33', '1.5')], [], { ...regular, roundingRule: 'none' })
    expect(bill.taxableTotal).toBe('500.00')
  })
  it('keeps different rates on their own lines', () => {
    const [bill] = calculateBills([piece('100'), piece('100', '1', gst18)], [], regular)
    expect(bill.cgstTotal).toBe('11.50')
    expect(bill.grandTotal).toBe('223.00')
  })
})

describe('prices that include tax', () => {
  const inclusive = { ...regular, pricesIncludeTax: true, roundingRule: 'none' as const }
  it('takes the tax out of ₹105 at 5%', () => {
    const [bill] = calculateBills([piece('105')], [], inclusive)
    expect(bill.taxableTotal).toBe('100.00')
    expect(bill.cgstTotal).toBe('2.50')
    expect(bill.grandTotal).toBe('105.00')
  })
  it('never lets rounding change the menu price', () => {
    for (const price of ['0.01', '1.99', '19.99', '99.99', '149.50', '333.33', '1000.01']) {
      const [bill] = calculateBills([piece(price)], [], inclusive)
      expect(bill.grandTotal).toBe(rupees(paise(price)))
    }
  })
})

describe('discounts', () => {
  it('applies a percentage before tax', () => {
    const [bill] = calculateBills([piece('1000')], [{ kind: 'percent', value: '10' }], regular)
    expect(bill.taxableTotal).toBe('900.00')
    expect(bill.cgstTotal).toBe('22.50')
    expect(bill.grandTotal).toBe('945.00')
  })
  it('shares a discount across lines without losing a paisa', () => {
    const [bill] = calculateBills([piece('33.33'), piece('33.33'), piece('33.34')], [{ kind: 'amount', value: '10' }], { ...regular, roundingRule: 'none' })
    expect(sum(bill.lines.map((line) => line.discount))).toBe('10.00')
    expect(bill.taxableTotal).toBe('90.00')
  })
  it('allows a 100% discount', () => {
    const [bill] = calculateBills([piece('100')], [{ kind: 'percent', value: '100' }], regular)
    expect(bill.grandTotal).toBe('0.00')
  })
  it('refuses a discount above the subtotal', () => {
    expect(() => calculateBills([piece('10')], [{ kind: 'amount', value: '11' }], regular)).toThrow(RangeError)
  })
})

describe('composition and unregistered businesses', () => {
  const none = { ...regular, chargesTax: false }
  it('charges no GST at all', () => {
    const [bill] = calculateBills([piece('100')], [], none)
    expect(bill.cgstTotal).toBe('0.00')
    expect(bill.sgstTotal).toBe('0.00')
    expect(bill.grandTotal).toBe('100.00')
    expect(bill.lines[0].rates.cgst).toBe('0')
  })
  it('does not strip tax from prices that claim to include it', () => {
    const [bill] = calculateBills([piece('105')], [], { ...none, pricesIncludeTax: true })
    expect(bill.taxableTotal).toBe('105.00')
  })
})

describe('service charge', () => {
  it('is absent unless a person added it', () => {
    const [bill] = calculateBills([piece('100')], [], regular)
    expect(bill.lines).toHaveLength(1)
  })
  it('is its own labelled line, on the discounted amount, and taxed', () => {
    const [bill] = calculateBills([piece('1000')], [{ kind: 'percent', value: '10' }], { ...regular, serviceChargePercent: '5', roundingRule: 'none' })
    const line = bill.lines[1]
    expect(line.description).toBe('Service charge (voluntary)')
    expect(line.taxableValue).toBe('45.00')
    expect(bill.taxableTotal).toBe('945.00')
    // ₹45 at 2.5% is ₹1.125, which rounds up to ₹1.13 for CGST and for SGST.
    expect(bill.grandTotal).toBe('992.26')
  })
})

describe('split bills', () => {
  it('splits into separate bills that add back to the whole', () => {
    const pieces = [piece('300', '1', gst5, 0), piece('700', '1', gst5, 1)]
    const bills = calculateBills(pieces, [{ kind: 'amount', value: '100' }], { ...regular, roundingRule: 'none' })
    expect(bills).toHaveLength(2)
    expect(bills[0].lines[0].discount).toBe('30.00')
    expect(bills[1].lines[0].discount).toBe('70.00')
    expect(sum(bills.map((bill) => bill.taxableTotal))).toBe('900.00')
  })
})

describe('the totals always reconcile', () => {
  it('holds across many price, quantity and setting combinations', () => {
    for (const price of ['0.01', '9.99', '84', '149.50', '999.99']) {
      for (const quantity of ['1', '2', '3', '0.333', '7.5']) {
        for (const pricesIncludeTax of [false, true]) {
          for (const roundingRule of ['none', 'nearest_rupee'] as const) {
            const [bill] = calculateBills(
              [piece(price, quantity), piece('33.33', '3', gst18)],
              [{ kind: 'percent', value: '7.5' }],
              { ...regular, pricesIncludeTax, roundingRule, serviceChargePercent: '3' },
            )
            expect(sum(bill.lines.map((line) => line.taxableValue))).toBe(bill.taxableTotal)
            expect(sum(bill.lines.map((line) => line.cgst))).toBe(bill.cgstTotal)
            expect(sum([bill.taxableTotal, bill.cgstTotal, bill.sgstTotal, bill.igstTotal, bill.cessTotal, bill.roundOff])).toBe(bill.grandTotal)
            expect(Math.abs(Number(bill.roundOff))).toBeLessThan(1)
          }
        }
      }
    }
  })
})

describe('money text', () => {
  it('keeps negative values', () => {
    expect(paise('-0.84')).toBe(-84n)
    expect(rupees(paise('-12.05'))).toBe('-12.05')
  })
})

describe('financial year', () => {
  it('turns over on 1 April', () => {
    expect(financialYear('2026-10-30')).toBe('2627')
    expect(financialYear('2027-03-31')).toBe('2627')
    expect(financialYear('2027-04-01')).toBe('2728')
  })
})
