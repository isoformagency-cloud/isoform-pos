import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Banknote, Building, CheckCircle2, CreditCard, Download, Plus, Printer, QrCode, Trash2, Wallet, type LucideIcon } from 'lucide-react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import type { Me } from '../App'
import { Loading, Notice } from '../components/ui'
import { UpiQr } from '../components/UpiQr'
import { api, ApiError } from '../lib/api'
import { money } from '../lib/format'
import { downloadBillPdf } from '../lib/pdf'

const METHOD_ICON: Record<string, LucideIcon> = { cash: Banknote, upi: QrCode, card: CreditCard, bank_transfer: Building, other: Wallet }
const REFERENCE_LABEL: Record<string, string> = {
  upi: 'UPI reference (UTR), optional', card: 'Approval code, optional', bank_transfer: 'Transfer reference, optional', other: 'Reference, optional',
}

interface Row {
  id: string
  methodId: string
  amount: string
  reference: string
  received: string
  saved: boolean
}

const round2 = (value: number) => (Math.round(value * 100) / 100).toFixed(2)

/** The last open payment always takes whatever is left, so the payments always add up to the bill. */
function settle(rows: Row[], target: number) {
  const last = rows.filter((row) => !row.saved).at(-1)
  if (!last) return rows
  const others = rows.reduce((sum, row) => (row === last ? sum : sum + Number(row.amount || 0)), 0)
  return rows.map((row) => (row === last ? { ...row, amount: round2(Math.max(target - others, 0)) } : row))
}

function quickCash(amount: number) {
  const steps = [50, 100, 200, 500, 2000].map((step) => Math.ceil(amount / step) * step)
  return [...new Set(steps.filter((value) => value > amount))].slice(0, 3)
}

export function Checkout({ me }: { me: Me }) {
  const { id } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const next = params.get('next')

  const invoice = useQuery({ queryKey: ['invoice', id], queryFn: () => api(`/invoices/${id}`, { branch: true }) })
  const methods = useQuery({ queryKey: ['methods'], queryFn: () => api('/payment-methods') })
  const settings = useQuery({ queryKey: ['pos-settings'], queryFn: () => api('/pos-settings') })

  const [rows, setRows] = useState<Row[]>([])
  const [target, setTarget] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ text: string; code?: string } | null>(null)
  const [change, setChange] = useState<number | null>(null)
  const [pdfError, setPdfError] = useState('')
  const started = useRef(false)
  const amounts = useRef<HTMLDivElement>(null)

  const bill = invoice.data
  const list: any[] = methods.data?.items ?? []
  const canRecord = me.permissions.includes('payments.record')
  const due = bill ? Number(bill.outstanding) : 0

  useEffect(() => {
    if (started.current || !bill || list.length === 0 || due <= 0) return
    started.current = true
    setTarget(due)
    setRows([{ id: crypto.randomUUID(), methodId: list[0].id, amount: bill.outstanding, reference: '', received: '', saved: false }])
  }, [bill, list, due])

  useEffect(() => {
    if (rows.length > 1) amounts.current?.querySelector<HTMLInputElement>('input[data-amount]:not([readonly]):not(:disabled)')?.focus()
  }, [rows.length])

  const update = (rowId: string, patch: Partial<Row>) => {
    setError(null)
    setRows((all) => settle(all.map((row) => (row.id === rowId ? { ...row, ...patch } : row)), target))
  }

  const lastOpen = rows.filter((row) => !row.saved).at(-1)
  const entered = rows.reduce((sum, row) => sum + Number(row.amount || 0), 0)
  const over = Number(round2(entered - target)) > 0
  const nothingLeft = rows.length > 1 && !over && Number(lastOpen?.amount) === 0
  const valid = rows.length > 0 && rows.every((row) => Number(row.amount) > 0) && !over
  const toRecord = rows.reduce((sum, row) => (row.saved ? sum : sum + Number(row.amount || 0)), 0)

  function addRow() {
    const unused = list.find((method) => !rows.some((row) => row.methodId === method.id)) ?? list[0]
    // The payment that was taking the whole bill now asks how much, and the new one takes the rest.
    const asked = rows.map((row) => (row === lastOpen ? { ...row, amount: '', received: '' } : row))
    setRows(settle([...asked, { id: crypto.randomUUID(), methodId: unused.id, amount: '', reference: '', received: '', saved: false }], target))
  }

  async function record() {
    setBusy(true)
    setError(null)
    let cashBack = 0
    try {
      for (const row of rows) {
        const method = list.find((item) => item.id === row.methodId)
        if (method.kind === 'cash' && Number(row.received) > Number(row.amount)) cashBack += Number(row.received) - Number(row.amount)
        if (row.saved) continue
        // The id stays the same on a retry, so a bill can never be paid twice by accident.
        await api('/payments', {
          method: 'POST',
          branch: true,
          body: {
            id: row.id, methodId: row.methodId, amount: round2(Number(row.amount)), reference: row.reference.trim() || undefined,
            allocations: [{ invoiceId: id, amount: round2(Number(row.amount)) }],
          },
        })
        update(row.id, { saved: true })
      }
      setChange(cashBack)
      await queryClient.invalidateQueries({ queryKey: ['invoice', id] })
    } catch (failure) {
      setError({ text: (failure as Error).message, code: failure instanceof ApiError ? failure.code : undefined })
      queryClient.invalidateQueries({ queryKey: ['invoice', id] })
    } finally {
      queryClient.invalidateQueries({ queryKey: ['invoices'] })
      queryClient.invalidateQueries({ queryKey: ['payments'] })
      queryClient.invalidateQueries({ queryKey: ['orders'] })
      queryClient.invalidateQueries({ queryKey: ['alerts'] })
      queryClient.invalidateQueries({ queryKey: ['invoice-payments', id] })
      setBusy(false)
    }
  }

  async function pdf() {
    setPdfError('')
    try {
      await downloadBillPdf(bill)
    } catch {
      setPdfError('Could not create the PDF. Use Print, then Save as PDF.')
    }
  }

  const paid = bill && due <= 0

  return (
    <Loading ready={!invoice.isPending} error={invoice.error}>
      {bill && paid && (
        <div className="mx-auto max-w-md pt-6 text-center">
          <CheckCircle2 size={44} strokeWidth={1.5} className="mx-auto text-ok" aria-hidden="true" />
          <h1 className="mt-3 text-2xl">Payment recorded</h1>
          <p className="mt-1 text-ink-soft">{bill.number} · {money(bill.grand_total)}</p>
          {Boolean(change) && (
            <p className="tnum mt-4 rounded-xl bg-wait-tint p-3 text-lg font-semibold text-wait">Change to return: {money(change ?? 0)}</p>
          )}
          <div className="mt-6 grid gap-2 sm:grid-cols-2">
            <Link to={`/invoices/${id}?print=1`} className="btn btn-secondary"><Printer size={16} aria-hidden="true" /> Print bill</Link>
            <button className="btn btn-secondary" onClick={pdf}><Download size={16} aria-hidden="true" /> Download PDF</button>
            {next
              ? <button className="btn btn-brand sm:col-span-2" onClick={() => navigate(`/checkout/${next}`, { replace: true })}>Take payment for the second bill</button>
              : <Link to="/pos?new=1" className="btn btn-primary sm:col-span-2"><Plus size={16} aria-hidden="true" /> New order</Link>}
          </div>
          {pdfError && <div className="mt-3"><Notice>{pdfError}</Notice></div>}
        </div>
      )}

      {bill && !paid && (
        <div className="mx-auto grid max-w-4xl gap-5 lg:grid-cols-[1fr_20rem]">
          <section className="min-w-0">
            <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
              <h1 className="text-[1.75rem] leading-tight">Payment</h1>
              <Link to={`/invoices/${id}`} className="text-sm text-ink-soft underline">View bill</Link>
            </div>

            {!canRecord && <Notice>Only cashiers and managers can record payments.</Notice>}

            <div ref={amounts} className="grid gap-3">
              {rows.map((row, index) => {
                const method = list.find((item) => item.id === row.methodId)
                const kind: string = method?.kind
                const back = Number(row.received) - Number(row.amount)
                return (
                  <div key={row.id} className={`card p-4 ${row.saved ? 'opacity-60' : ''}`}>
                    {rows.length > 1 && (
                      <div className="mb-2 flex items-center justify-between">
                        <p className="text-sm font-medium">Payment {index + 1}{row.saved ? ' · saved' : ''}</p>
                        {!row.saved && (
                          <button aria-label={`Remove payment ${index + 1}`} className="btn btn-ghost btn-icon !min-h-8 !w-8" onClick={() => setRows(settle(rows.filter((item) => item.id !== row.id), target))}>
                            <Trash2 size={15} aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    )}
                    <div role="radiogroup" aria-label="Payment method" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {list.map((item) => {
                        const Icon = METHOD_ICON[item.kind] ?? Wallet
                        const active = item.id === row.methodId
                        return (
                          <button
                            key={item.id}
                            role="radio"
                            aria-checked={active}
                            disabled={row.saved || busy}
                            className={`flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl border text-sm font-medium transition-colors ${active ? 'border-brand bg-brand-tint text-brand-deep' : 'border-line bg-white text-ink-mid hover:border-line-strong'}`}
                            onClick={() => update(row.id, { methodId: item.id, reference: '', received: '' })}
                          >
                            <Icon size={20} strokeWidth={1.75} aria-hidden="true" />
                            {item.name}
                          </button>
                        )
                      })}
                    </div>

                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <label className="field">
                        {row !== lastOpen ? 'How much?' : rows.length > 1 ? 'The rest of the bill' : 'Amount'}
                        {row === lastOpen || row.saved ? (
                          <input data-amount readOnly tabIndex={-1} value={row.amount} className="tnum !border-line-soft !bg-paper-soft font-medium" />
                        ) : (
                          <input data-amount disabled={busy} value={row.amount} inputMode="decimal" placeholder="0.00" onChange={(event) => update(row.id, { amount: event.target.value.replace(/[^\d.]/g, '') })} />
                        )}
                      </label>

                      {kind === 'cash' && (
                        <label className="field">
                          Cash received
                          <input disabled={row.saved || busy} value={row.received} inputMode="decimal" placeholder={row.amount} onChange={(event) => update(row.id, { received: event.target.value.replace(/[^\d.]/g, '') })} />
                        </label>
                      )}

                      {kind && kind !== 'cash' && (
                        <label className="field">
                          {REFERENCE_LABEL[kind]}
                          <input disabled={row.saved || busy} value={row.reference} maxLength={80} autoComplete="off" onChange={(event) => update(row.id, { reference: event.target.value })} />
                        </label>
                      )}
                    </div>

                    {kind === 'cash' && !row.saved && !busy && Number(row.amount) > 0 && (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <button className="btn btn-secondary btn-sm" onClick={() => update(row.id, { received: row.amount })}>Exact</button>
                        {quickCash(Number(row.amount)).map((value) => (
                          <button key={value} className="btn btn-secondary btn-sm tnum" onClick={() => update(row.id, { received: String(value) })}>{money(value)}</button>
                        ))}
                        {back > 0 && <p className="tnum ml-auto text-sm font-semibold text-wait">Change to return: {money(round2(back))}</p>}
                      </div>
                    )}

                    {kind === 'upi' && (
                      <div className="mt-3">
                        {settings.data?.upi_id ? (
                          <div className="flex flex-wrap items-center gap-4 rounded-xl bg-paper-soft p-3">
                            <UpiQr upiId={settings.data.upi_id} payee={settings.data.display_name} amount={round2(Number(row.amount || 0))} note={`Bill ${bill.number}`} />
                            <div className="text-sm">
                              <p className="font-medium">Scan with any UPI app</p>
                              <p className="tnum text-ink-soft">{money(row.amount || 0)} to {settings.data.upi_id}</p>
                              <p className="mt-2 max-w-52 text-xs text-ink-soft">Check the money has arrived before you record it.</p>
                            </div>
                          </div>
                        ) : (
                          <p className="text-sm text-ink-soft">
                            {me.permissions.includes('business.write')
                              ? <>Add your UPI ID in <Link to="/settings" className="underline">Settings</Link> to show a QR code here.</>
                              : 'Ask the owner to add a UPI ID to show a QR code here.'}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {canRecord && !busy && list.length > 1 && rows.length > 0 && (
              <button className="btn btn-secondary mt-3" onClick={addRow}><Plus size={16} aria-hidden="true" /> Split payment</button>
            )}
          </section>

          <aside className="card self-start p-4 lg:sticky lg:top-20">
            <p className="font-mono text-sm">{bill.number}</p>
            <p className="text-xs text-ink-soft">Order #{bill.display_number}{bill.customer_name ? ` · ${bill.customer_name}` : ''}</p>
            <ul className="mt-3 divide-y divide-line-soft text-sm">
              {bill.lines.map((line: any) => (
                <li key={line.id} className="flex justify-between gap-3 py-1.5">
                  <span>{Number(line.quantity)} × {line.description}</span>
                  <span className="tnum">{money(line.taxable_value)}</span>
                </li>
              ))}
            </ul>
            <dl className="tnum mt-2 space-y-1 border-t border-line-soft pt-2 text-sm">
              <div className="flex justify-between text-ink-soft"><dt>Taxable value</dt><dd>{money(bill.taxable_total)}</dd></div>
              {Number(bill.cgst_total) > 0 && <div className="flex justify-between text-ink-soft"><dt>CGST</dt><dd>{money(bill.cgst_total)}</dd></div>}
              {Number(bill.sgst_total) > 0 && <div className="flex justify-between text-ink-soft"><dt>SGST</dt><dd>{money(bill.sgst_total)}</dd></div>}
              {Number(bill.round_off) !== 0 && <div className="flex justify-between text-ink-soft"><dt>Round off</dt><dd>{bill.round_off}</dd></div>}
              <div className="flex justify-between border-t border-line-soft pt-1 text-lg font-semibold"><dt>{Number(bill.allocated) > 0 ? 'Still due' : 'Total'}</dt><dd>{money(bill.outstanding)}</dd></div>
            </dl>

            {error && (
              <div className="mt-3">
                <Notice>
                  {error.text}
                  {error.code === 'no_open_session' && <> <Link to="/cash" className="underline">Open Cash</Link></>}
                </Notice>
              </div>
            )}
            {over && <div className="mt-3"><Notice>That’s {money(round2(entered - target))} more than the bill.</Notice></div>}
            {nothingLeft && <div className="mt-3"><Notice>That covers the whole bill. Remove the last payment.</Notice></div>}

            {canRecord && (
              <button className="btn btn-brand mt-3 w-full" disabled={!valid || busy} onClick={record}>
                {busy ? 'Saving…' : `Record ${money(round2(toRecord))}`}
              </button>
            )}
            <p className="mt-2 text-xs text-ink-soft">This records money you’ve already received. It doesn’t take a payment.</p>
          </aside>
        </div>
      )}
    </Loading>
  )
}
