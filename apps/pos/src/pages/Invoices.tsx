import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import type { Me } from '../App'
import { useAsk } from '../components/Ask'
import { Loading, Notice, PageHeader } from '../components/ui'
import { api } from '../lib/api'

const money = (value: string) => `₹${value}`
const isZero = (value: string) => Number(value) === 0
const TITLES: Record<string, string> = { tax_invoice: 'Tax invoice', bill_of_supply: 'Bill of supply' }

export function Invoices() {
  const invoices = useQuery({ queryKey: ['invoices'], queryFn: () => api('/invoices') })
  return (
    <>
      <PageHeader title="Bills" text="Issued bills can’t be edited. Corrections are made with a credit note." />
      <Loading ready={!invoices.isPending} error={invoices.error} empty={invoices.data?.items.length === 0 ? 'No bills yet. Bills appear here once they’re issued from an order.' : undefined}>
        <ul className="card divide-y divide-line">
          {invoices.data?.items.map((invoice: any) => (
            <li key={invoice.id}>
              <Link to={`/invoices/${invoice.id}`} className="flex flex-wrap items-center justify-between gap-3 p-4 hover:bg-paper-soft">
                <span>
                  <span className="font-mono text-sm">{invoice.number}</span>
                  <span className="block text-sm text-ink-soft">{invoice.invoice_date}</span>
                </span>
                <span className="text-right">
                  <span className="font-mono">{money(invoice.grand_total)}</span>
                  {!isZero(invoice.credited) && <span className="block text-xs text-wait">{money(invoice.credited)} credited</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Loading>
    </>
  )
}

export function InvoiceDetail({ me }: { me: Me }) {
  const { id } = useParams()
  const queryClient = useQueryClient()
  const { ask, node } = useAsk()
  const invoice = useQuery({ queryKey: ['invoice', id], queryFn: () => api(`/invoices/${id}`) })
  const credit = useMutation({
    mutationFn: (body: object) => api(`/invoices/${id}/credit-notes`, { method: 'POST', body: { id: crypto.randomUUID(), ...body } }),
    onSuccess: (data) => {
      queryClient.setQueryData(['invoice', id], data)
      queryClient.invalidateQueries({ queryKey: ['invoices'] })
    },
  })

  const data = invoice.data
  const canCorrect = me.permissions.includes('billing.correct')
  const seller = data?.seller_snapshot
  const fullyCredited = data && Number(data.credited) >= Number(data.grand_total)

  async function cancel() {
    const answer = await ask('Cancel this bill?', [{ name: 'reason', label: 'Reason', required: true }], 'Issue credit note')
    if (answer) credit.mutate({ kind: 'cancellation', reason: answer.reason })
  }

  async function correct(line: any) {
    const left = Number(line.quantity) - Number(line.credited_quantity)
    const answer = await ask(`Credit ${line.description}`, [
      { name: 'quantity', label: `Quantity (up to ${left})`, required: true, defaultValue: String(left), inputMode: 'decimal' },
      { name: 'reason', label: 'Reason', required: true },
    ], 'Issue credit note')
    if (answer) credit.mutate({ kind: 'correction', reason: answer.reason, lines: [{ invoiceLineId: line.id, quantity: answer.quantity }] })
  }

  return (
    <Loading ready={!invoice.isPending} error={invoice.error}>
      {node}
      {data && (
        <>
          <div className="no-print mb-5 flex flex-wrap items-center justify-between gap-3">
            <Link to="/invoices" className="text-sm text-ink-soft underline">All bills</Link>
            <div className="flex flex-wrap gap-2">
              <button className="btn btn-primary" onClick={() => window.print()}>Print</button>
              {canCorrect && !fullyCredited && <button className="btn btn-secondary" onClick={cancel}>Cancel bill</button>}
            </div>
          </div>
          {credit.error && <div className="no-print mb-4"><Notice>{credit.error.message}</Notice></div>}

          <article className="print-area card mx-auto max-w-md p-5 font-mono text-sm">
            <header className="text-center">
              <p className="font-semibold">{seller.tradeName ?? seller.legalName}</p>
              <p>{seller.branchName}</p>
              <p>{seller.branchAddress ?? seller.address}</p>
              {seller.gstin && <p>GSTIN {seller.gstin}</p>}
              <p className="mt-2 font-semibold uppercase">{seller.scheme === 'unregistered' ? 'Bill' : TITLES[data.document_type]}</p>
            </header>
            <dl className="mt-3 border-t border-dashed border-ink-soft pt-2">
              <div className="flex justify-between"><dt>No.</dt><dd>{data.number}</dd></div>
              <div className="flex justify-between"><dt>Date</dt><dd>{data.invoice_date}</dd></div>
              <div className="flex justify-between"><dt>State</dt><dd>{seller.stateCode}</dd></div>
            </dl>
            <ul className="mt-2 border-t border-dashed border-ink-soft pt-2">
              {data.lines.map((line: any) => (
                <li key={line.id} className="py-1">
                  <div className="flex justify-between gap-3">
                    <span>{Number(line.quantity)} × {line.description}</span>
                    <span>{line.taxable_value}</span>
                  </div>
                  {line.hsn_sac && <p className="text-xs">HSN/SAC {line.hsn_sac}</p>}
                  {!isZero(line.discount) && <p className="text-xs">Discount {line.discount}</p>}
                  {canCorrect && Number(line.quantity) > Number(line.credited_quantity) && (
                    <button className="no-print text-xs underline" onClick={() => correct(line)}>Credit this line</button>
                  )}
                </li>
              ))}
            </ul>
            <dl className="mt-2 border-t border-dashed border-ink-soft pt-2">
              {[
                ['Taxable value', data.taxable_total],
                ['CGST', data.cgst_total],
                ['SGST', data.sgst_total],
                ['IGST', data.igst_total],
                ['Cess', data.cess_total],
                ['Round off', data.round_off],
              ].filter(([, value], index) => index === 0 || !isZero(value)).map(([label, value]) => (
                <div key={label} className="flex justify-between"><dt>{label}</dt><dd>{value}</dd></div>
              ))}
              <div className="mt-1 flex justify-between border-t border-ink pt-1 text-base font-semibold"><dt>Total</dt><dd>{money(data.grand_total)}</dd></div>
            </dl>
            {seller.scheme === 'composition' && <p className="mt-3 text-xs">Composition taxable person, not eligible to collect tax on supplies.</p>}
            {data.creditNotes.length > 0 && (
              <section className="mt-3 border-t border-dashed border-ink-soft pt-2">
                <p className="font-semibold">Credit notes</p>
                {data.creditNotes.map((note: any) => (
                  <p key={note.id} className="text-xs">{note.number} · {money(note.grand_total)} · {note.reason}</p>
                ))}
              </section>
            )}
          </article>
        </>
      )}
    </Loading>
  )
}
