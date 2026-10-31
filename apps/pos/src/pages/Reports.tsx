import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Me } from '../App'
import { Loading, PageHeader } from '../components/ui'
import { activeBranch, api } from '../lib/api'

const money = (value: string) => `₹${Number(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const count = (value: number, noun: string) => `${value} ${noun}${value === 1 ? '' : 's'}`
const today = () => {
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

function Figure({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="card p-4">
      <p className="text-sm text-ink-soft">{label}</p>
      <p className="tnum mt-1 font-display text-2xl font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-xs text-ink-soft">{note}</p>
    </div>
  )
}

export function Reports({ me }: { me: Me }) {
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(today)
  const branch = activeBranch()
  const query = useQuery({
    queryKey: ['report', from, to, branch],
    queryFn: () => api(`/reports/daily?from=${from}&to=${to}${branch ? `&branchId=${branch}` : ''}`),
    enabled: Boolean(from && to),
  })
  const data = query.data

  return (
    <>
      <PageHeader title="Reports" text="Days are trading days, so a bill after midnight counts towards the day it belongs to." />
      <div className="mb-5 flex flex-wrap gap-3">
        <label className="field">From<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label className="field">To<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
      </div>

      <Loading ready={!query.isPending} error={query.error}>
        {data && (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Figure label="Net sales" value={money(data.sales.net_sales)} note={`${count(data.sales.bills, 'bill')}, before tax, after credit notes`} />
              <Figure label="Tax" value={money(String(Number(data.sales.cgst) + Number(data.sales.sgst) + Number(data.sales.igst) + Number(data.sales.cess)))} note={`CGST ${data.sales.cgst} · SGST ${data.sales.sgst}`} />
              <Figure label="Payments recorded" value={money(data.paymentTotals.recorded)} note="Entered by staff, not proof of receipt" />
              <Figure label="Payments confirmed" value={money(data.paymentTotals.confirmed)} note="Checked and confirmed" />
              <Figure label="Waiting to be checked" value={money(data.paymentTotals.awaiting_check)} note={count(data.paymentTotals.awaiting_count, 'payment')} />
              <Figure label="Still owed" value={money(data.outstanding.total)} note={`${count(data.outstanding.bills, 'bill')} from these days`} />
              <Figure label="Refunds" value={money(data.refunds.total)} note={`${data.refunds.count} recorded`} />
              <Figure label="Tips" value={money(data.paymentTotals.tips)} note="Not counted as sales" />
              <Figure label="Orders" value={String(data.orders.billed)} note={`${data.orders.cancelled} cancelled · ${data.orders.still_open} still open`} />
            </div>

            <p className="mt-3 text-sm text-ink-soft">
              These figures show what was billed and recorded. They don’t show profit or what has reached your bank.
            </p>

            <div className="mt-6 grid gap-6 lg:grid-cols-2">
              <section>
                <h2 className="mb-2 text-xl">Payments by method</h2>
                <table className="card tnum w-full border-separate border-spacing-0 overflow-hidden text-sm">
                  <thead>
                    <tr className="text-left text-ink-soft">
                      <th className="p-3 font-medium">Method</th>
                      <th className="p-3 text-right font-medium">Recorded</th>
                      <th className="p-3 text-right font-medium">Confirmed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.payments.length === 0 && <tr><td colSpan={3} className="p-3  text-ink-soft">No payments in this period.</td></tr>}
                    {data.payments.map((row: any) => (
                      <tr key={row.method}>
                        <td className="border-t border-line p-3 ">{row.method}</td>
                        <td className="border-t border-line p-3 text-right">{money(row.recorded)}</td>
                        <td className="border-t border-line p-3 text-right">{money(row.confirmed)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>

              <section>
                <h2 className="mb-2 text-xl">Top items</h2>
                <table className="card tnum w-full border-separate border-spacing-0 overflow-hidden text-sm">
                  <thead>
                    <tr className="text-left text-ink-soft">
                      <th className="p-3 font-medium">Item</th>
                      <th className="p-3 text-right font-medium">Quantity</th>
                      <th className="p-3 text-right font-medium">Sales</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.length === 0 && <tr><td colSpan={3} className="p-3  text-ink-soft">No sales in this period.</td></tr>}
                    {data.items.map((row: any) => (
                      <tr key={row.description}>
                        <td className="border-t border-line p-3 ">{row.description}</td>
                        <td className="border-t border-line p-3 text-right">{Number(row.quantity)}</td>
                        <td className="border-t border-line p-3 text-right">{money(row.sales)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-1 text-xs text-ink-soft">Before credit notes.</p>
              </section>

              <section>
                <h2 className="mb-2 text-xl">Tax by rate</h2>
                <table className="card tnum w-full border-separate border-spacing-0 overflow-hidden text-sm">
                  <thead>
                    <tr className="text-left text-ink-soft">
                      <th className="p-3 font-medium">Rate</th>
                      <th className="p-3 text-right font-medium">Taxable</th>
                      <th className="p-3 text-right font-medium">Tax</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.taxRates.length === 0 && <tr><td colSpan={3} className="p-3  text-ink-soft">No bills in this period.</td></tr>}
                    {data.taxRates.map((row: any) => (
                      <tr key={row.rate}>
                        <td className="border-t border-line p-3">{Number(row.rate)}%</td>
                        <td className="border-t border-line p-3 text-right">{money(row.taxable)}</td>
                        <td className="border-t border-line p-3 text-right">{money(row.tax)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-1 text-xs text-ink-soft">Before credit notes. Check figures with your accountant before filing.</p>
              </section>

              <section>
                <h2 className="mb-2 text-xl">Cash sessions</h2>
                <ul className="card divide-y divide-line-soft overflow-hidden text-sm">
                  {data.cash.length === 0 && <li className="p-3 text-ink-soft">No sessions in this period.</li>}
                  {data.cash.map((row: any) => (
                    <li key={row.id} className="flex flex-wrap justify-between gap-2 p-3">
                      <span>{row.business_date} · {row.branch} · {row.register} · <span className="capitalize">{row.status}</span></span>
                      {row.variance && (
                        <span className={`tnum ${Number(row.variance) === 0 ? 'text-ok' : 'text-wait'}`}>
                          {Number(row.variance) === 0 ? 'Matched' : `${Number(row.variance) < 0 ? 'Short' : 'Over'} ${money(row.variance.replace('-', ''))}`}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>

              {me.branchIds.length > 1 && !branch && (
                <section>
                  <h2 className="mb-2 text-xl">By branch</h2>
                  <ul className="card divide-y divide-line-soft overflow-hidden text-sm">
                    {data.byBranch.map((row: any) => (
                      <li key={row.id} className="flex justify-between gap-3 p-3">
                        <span>{row.name}</span>
                        <span className="tnum">{money(String(Number(row.billed_sales) - Number(row.credited_sales)))}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          </>
        )}
      </Loading>
    </>
  )
}
