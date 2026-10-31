import type { ReactNode } from 'react'
import { money } from '../lib/format'

export type BillFormat = 'thermal' | 'a4'

const TITLES: Record<string, string> = { tax_invoice: 'Tax invoice', bill_of_supply: 'Bill of supply' }
const isZero = (value: string) => Number(value) === 0

const titleFor = (bill: any) => (bill.seller_snapshot.scheme === 'unregistered' ? 'Bill' : TITLES[bill.document_type])

const totalsFor = (bill: any) => [
  ['Taxable value', bill.taxable_total],
  ['CGST', bill.cgst_total],
  ['SGST', bill.sgst_total],
  ['IGST', bill.igst_total],
  ['Cess', bill.cess_total],
  ['Round off', bill.round_off],
].filter(([, value], index) => index === 0 || !isZero(value))

function CreditNotes({ bill }: { bill: any }) {
  if (!bill.creditNotes?.length) return null
  return (
    <section className="mt-3 border-t border-dashed border-ink-soft pt-2">
      <p className="font-semibold">Credit notes</p>
      {bill.creditNotes.map((note: any) => (
        <p key={note.id} className="text-xs">{note.number} · {money(note.grand_total)} · {note.reason}</p>
      ))}
    </section>
  )
}

export function Receipt({ bill, format, lineAction }: { bill: any; format: BillFormat; lineAction?: (line: any) => ReactNode }) {
  return format === 'a4' ? <A4 bill={bill} lineAction={lineAction} /> : <Thermal bill={bill} lineAction={lineAction} />
}

function Thermal({ bill, lineAction }: { bill: any; lineAction?: (line: any) => ReactNode }) {
  const seller = bill.seller_snapshot
  return (
    <article className="print-area card mx-auto max-w-md p-5 font-mono text-sm">
      <header className="text-center">
        <p className="font-semibold">{seller.tradeName ?? seller.legalName}</p>
        <p>{seller.branchName}</p>
        <p>{seller.branchAddress ?? seller.address}</p>
        {seller.gstin && <p>GSTIN {seller.gstin}</p>}
        {seller.fssai && <p>FSSAI {seller.fssai}</p>}
        <p className="mt-2 font-semibold uppercase">{titleFor(bill)}</p>
      </header>
      <dl className="mt-3 border-t border-dashed border-ink-soft pt-2">
        <div className="flex justify-between"><dt>No.</dt><dd>{bill.number}</dd></div>
        <div className="flex justify-between"><dt>Date</dt><dd>{bill.invoice_date}</dd></div>
        <div className="flex justify-between"><dt>State</dt><dd>{seller.stateCode}</dd></div>
        {bill.customer_name && <div className="flex justify-between gap-3"><dt>Customer</dt><dd className="text-right">{bill.customer_name}</dd></div>}
        {bill.delivery_address && <div className="mt-1"><dt className="sr-only">Deliver to</dt><dd>{bill.delivery_address}</dd></div>}
      </dl>
      <ul className="mt-2 border-t border-dashed border-ink-soft pt-2">
        {bill.lines.map((line: any) => (
          <li key={line.id} className="py-1">
            <div className="flex justify-between gap-3">
              <span>{Number(line.quantity)} × {line.description}</span>
              <span>{line.taxable_value}</span>
            </div>
            {line.hsn_sac && <p className="text-xs">HSN/SAC {line.hsn_sac}</p>}
            {!isZero(line.discount) && <p className="text-xs">Discount {line.discount}</p>}
            {lineAction?.(line)}
          </li>
        ))}
      </ul>
      <dl className="mt-2 border-t border-dashed border-ink-soft pt-2">
        {totalsFor(bill).map(([label, value]) => (
          <div key={label} className="flex justify-between"><dt>{label}</dt><dd>{value}</dd></div>
        ))}
        <div className="mt-1 flex justify-between border-t border-ink pt-1 text-base font-semibold"><dt>Total</dt><dd>₹{bill.grand_total}</dd></div>
      </dl>
      {seller.scheme === 'composition' && <p className="mt-3 text-xs">Composition taxable person, not eligible to collect tax on supplies.</p>}
      <CreditNotes bill={bill} />
      {seller.footer && <p className="mt-3 text-center text-xs">{seller.footer}</p>}
    </article>
  )
}

function A4({ bill, lineAction }: { bill: any; lineAction?: (line: any) => ReactNode }) {
  const seller = bill.seller_snapshot
  const taxed = bill.lines.some((line: any) => !isZero(line.cgst) || !isZero(line.sgst))
  return (
    <article className="print-area print-a4 card mx-auto max-w-3xl p-8 text-sm">
      <style>{'@media print { @page { size: A4; margin: 12mm; } }'}</style>
      <header className="flex flex-wrap justify-between gap-6 border-b border-ink pb-4">
        <div>
          <p className="font-display text-xl font-semibold">{seller.tradeName ?? seller.legalName}</p>
          <p>{seller.branchName}</p>
          <p className="max-w-xs">{seller.branchAddress ?? seller.address}</p>
          {seller.branchPhone && <p>Phone {seller.branchPhone}</p>}
          {seller.gstin && <p>GSTIN {seller.gstin}</p>}
          {seller.fssai && <p>FSSAI {seller.fssai}</p>}
        </div>
        <div className="text-right">
          <p className="font-display text-xl font-semibold">{titleFor(bill)}</p>
          <p className="tnum">No. {bill.number}</p>
          <p className="tnum">Date {bill.invoice_date}</p>
          <p>Place of supply: state {seller.stateCode}</p>
        </div>
      </header>
      {(bill.customer_name || bill.delivery_address) && (
        <section className="mt-3">
          <p className="text-xs text-ink-soft">Billed to</p>
          {bill.customer_name && <p>{bill.customer_name}{bill.customer_phone ? ` · ${bill.customer_phone}` : ''}</p>}
          {bill.delivery_address && <p>{bill.delivery_address}</p>}
        </section>
      )}
      <table className="tnum mt-4 w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-ink text-xs">
            <th className="py-1.5 pr-2 font-medium">Item</th>
            <th className="py-1.5 pr-2 font-medium">HSN/SAC</th>
            <th className="py-1.5 pr-2 text-right font-medium">Qty</th>
            <th className="py-1.5 pr-2 text-right font-medium">Rate</th>
            <th className="py-1.5 pr-2 text-right font-medium">Discount</th>
            <th className="py-1.5 pr-2 text-right font-medium">Taxable</th>
            {taxed && <th className="py-1.5 pr-2 text-right font-medium">CGST</th>}
            {taxed && <th className="py-1.5 text-right font-medium">SGST</th>}
          </tr>
        </thead>
        <tbody>
          {bill.lines.map((line: any) => (
            <tr key={line.id} className="border-b border-line">
              <td className="py-1.5 pr-2">{line.description}{lineAction && <span className="block">{lineAction(line)}</span>}</td>
              <td className="py-1.5 pr-2">{line.hsn_sac}</td>
              <td className="py-1.5 pr-2 text-right">{Number(line.quantity)}</td>
              <td className="py-1.5 pr-2 text-right">{line.unit_price}</td>
              <td className="py-1.5 pr-2 text-right">{isZero(line.discount) ? '' : line.discount}</td>
              <td className="py-1.5 pr-2 text-right">{line.taxable_value}</td>
              {taxed && <td className="py-1.5 pr-2 text-right">{line.cgst}<span className="block text-xs text-ink-soft">{Number(line.cgst_rate)}%</span></td>}
              {taxed && <td className="py-1.5 text-right">{line.sgst}<span className="block text-xs text-ink-soft">{Number(line.sgst_rate)}%</span></td>}
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="tnum mt-3 ml-auto w-64">
        {totalsFor(bill).map(([label, value]) => (
          <div key={label} className="flex justify-between py-0.5"><dt>{label}</dt><dd>{value}</dd></div>
        ))}
        <div className="mt-1 flex justify-between border-t border-ink pt-1 text-base font-semibold"><dt>Total</dt><dd>₹{bill.grand_total}</dd></div>
      </dl>
      {seller.scheme === 'composition' && <p className="mt-3 text-xs">Composition taxable person, not eligible to collect tax on supplies.</p>}
      <CreditNotes bill={bill} />
      {seller.footer && <p className="mt-6 text-center">{seller.footer}</p>}
    </article>
  )
}
