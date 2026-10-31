import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, FileText, Printer } from 'lucide-react'
import { Link, useParams, useSearchParams } from 'react-router'
import type { Me } from '../App'
import { useAsk } from '../components/Ask'
import { Receipt, type BillFormat } from '../components/Receipt'
import { Badge, Empty, Loading, Notice, PageHeader, Segmented } from '../components/ui'
import { api } from '../lib/api'
import { money } from '../lib/format'
import { downloadBillPdf } from '../lib/pdf'

const isZero = (value: string) => Number(value) === 0

export function Invoices() {
  const [unpaid, setUnpaid] = useState(false)
  const invoices = useQuery({ queryKey: ['invoices', unpaid], queryFn: () => api(`/invoices${unpaid ? '?unpaid=true' : ''}`) })
  return (
    <>
      <PageHeader title="Bills" text="Issued bills can’t be edited. Corrections are made with a credit note." />
      <div className="mb-4">
        <Segmented
          label="Bill filter"
          value={unpaid ? 'unpaid' : 'all'}
          options={[{ value: 'all', label: 'All' }, { value: 'unpaid', label: 'Unpaid' }]}
          onChange={(value) => setUnpaid(value === 'unpaid')}
        />
      </div>
      <Loading ready={!invoices.isPending} error={invoices.error}>
        {invoices.data?.items.length === 0 && <Empty icon={FileText} title={unpaid ? 'Nothing is unpaid.' : 'No bills yet.'} text={unpaid ? undefined : 'Bills appear here once they’re issued from an order.'} />}
        {invoices.data?.items.length > 0 && (
          <ul className="card divide-y divide-line-soft overflow-hidden">
            {invoices.data.items.map((invoice: any) => (
              <li key={invoice.id}>
                <Link to={`/invoices/${invoice.id}`} className="flex flex-wrap items-center justify-between gap-3 p-4 transition-colors hover:bg-paper-soft">
                  <span>
                    <span className="font-mono text-sm font-medium">{invoice.number}</span>
                    <span className="block text-sm text-ink-soft">{invoice.invoice_date}{invoice.customer_name ? ` · ${invoice.customer_name}` : ''}</span>
                  </span>
                  <span className="flex items-center gap-3">
                    {!isZero(invoice.credited) && <Badge tone="neutral">{money(invoice.credited)} credited</Badge>}
                    {Number(invoice.outstanding) > 0 ? <Badge tone="wait">{money(invoice.outstanding)} due</Badge> : <Badge tone="ok">Paid</Badge>}
                    <span className="tnum font-medium">{money(invoice.grand_total)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Loading>
    </>
  )
}

export function InvoiceDetail({ me }: { me: Me }) {
  const { id } = useParams()
  const [params] = useSearchParams()
  const queryClient = useQueryClient()
  const { ask, node } = useAsk()
  const invoice = useQuery({ queryKey: ['invoice', id], queryFn: () => api(`/invoices/${id}`) })
  const settings = useQuery({ queryKey: ['pos-settings'], queryFn: () => api('/pos-settings') })
  const paid = useQuery({ queryKey: ['invoice-payments', id], queryFn: () => api(`/payments?invoiceId=${id}`), enabled: me.permissions.includes('payments.read') })
  const [chosen, setChosen] = useState<BillFormat | null>(null)
  const [pdfError, setPdfError] = useState('')
  const printed = useRef(false)
  const credit = useMutation({
    mutationFn: (body: object) => api(`/invoices/${id}/credit-notes`, { method: 'POST', body: { id: crypto.randomUUID(), ...body } }),
    onSuccess: (data) => {
      queryClient.setQueryData(['invoice', id], data)
      queryClient.invalidateQueries({ queryKey: ['invoices'] })
    },
  })

  const data = invoice.data
  const canCorrect = me.permissions.includes('billing.correct')
  const fullyCredited = data && Number(data.credited) >= Number(data.grand_total)
  const format: BillFormat = chosen ?? settings.data?.bill_format ?? 'thermal'

  useEffect(() => {
    if (params.get('print') && data && settings.data && !printed.current) {
      printed.current = true
      window.print()
    }
  }, [params, data, settings.data])

  async function pdf() {
    setPdfError('')
    try {
      await downloadBillPdf(data)
    } catch {
      setPdfError('Could not create the PDF. Use Print, then Save as PDF.')
    }
  }

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
            <div className="flex flex-wrap items-center gap-2">
              <Segmented
                label="Bill size"
                value={format}
                options={[{ value: 'thermal', label: '80mm' }, { value: 'a4', label: 'A4' }]}
                onChange={setChosen}
              />
              <button className="btn btn-secondary" onClick={pdf}><Download size={16} aria-hidden="true" /> PDF</button>
              <button className="btn btn-primary" onClick={() => window.print()}><Printer size={16} aria-hidden="true" /> Print</button>
              {canCorrect && !fullyCredited && <button className="btn btn-secondary" onClick={cancel}>Cancel bill</button>}
            </div>
          </div>
          {credit.error && <div className="no-print mb-4"><Notice>{credit.error.message}</Notice></div>}
          {pdfError && <div className="no-print mb-4"><Notice>{pdfError}</Notice></div>}

          <section className="no-print card mx-auto mb-4 max-w-md p-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg">Payment</h2>
              <p className="tnum text-sm">{Number(data.outstanding) > 0 ? `${money(data.outstanding)} due` : 'Nothing due'}</p>
            </div>
            <ul className="mt-2 space-y-1 text-sm">
              {paid.data?.items.map((item: any) => (
                <li key={item.id} className="flex justify-between gap-3">
                  <span>{item.method_name}{item.reference ? ` · ${item.reference}` : ''}</span>
                  <span className="tnum">{money(item.amount)} <span className="capitalize text-ink-soft">{item.status}</span></span>
                </li>
              ))}
            </ul>
            {Number(data.outstanding) > 0 && me.permissions.includes('payments.record') && (
              <Link to={`/checkout/${id}`} className="btn btn-brand mt-3 w-full">Take payment</Link>
            )}
          </section>

          <Receipt
            bill={data}
            format={format}
            lineAction={canCorrect ? (line) => Number(line.quantity) > Number(line.credited_quantity) && (
              <button className="no-print text-xs underline" onClick={() => correct(line)}>Credit this line</button>
            ) : undefined}
          />
        </>
      )}
    </Loading>
  )
}
