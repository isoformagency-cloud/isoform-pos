import { useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, Printer } from 'lucide-react'
import type { Me } from '../App'
import { BarChart, Change, ShareBars } from '../components/charts'
import { typeName } from '../components/order-look'
import { Loading, PageHeader, Segmented } from '../components/ui'
import { api, useActiveBranch } from '../lib/api'
import { downloadCsv, localDate, money, shortDate } from '../lib/format'

const count = (value: number, noun: string) => `${value} ${noun}${value === 1 ? '' : 's'}`
const CATEGORIES: Record<string, string> = {
  ingredients: 'Ingredients', rent: 'Rent', electricity: 'Electricity', salaries: 'Salaries', maintenance: 'Maintenance',
  packaging: 'Packaging', marketing: 'Marketing', other: 'Other',
}
const ROLES: Record<string, string> = {
  owner: 'Owner', admin: 'Admin', manager: 'Manager', cashier: 'Cashier', waiter: 'Waiter', kitchen: 'Kitchen staff', accountant: 'Accountant',
}

const monthStart = () => `${localDate().slice(0, 8)}01`
const PRESETS: { value: string; label: string; range?: () => { from: string; to: string } }[] = [
  { value: 'today', label: 'Today', range: () => ({ from: localDate(), to: localDate() }) },
  { value: 'yesterday', label: 'Yesterday', range: () => ({ from: localDate(1), to: localDate(1) }) },
  { value: 'd7', label: '7 days', range: () => ({ from: localDate(6), to: localDate() }) },
  { value: 'd30', label: '30 days', range: () => ({ from: localDate(29), to: localDate() }) },
  { value: 'month', label: 'This month', range: () => ({ from: monthStart(), to: localDate() }) },
  { value: 'custom', label: 'Choose dates' },
]

function Figure({ label, value, note }: { label: string; value: string; note: ReactNode }) {
  return (
    <div className="card p-4">
      <p className="text-sm text-ink-soft">{label}</p>
      <p className="tnum mt-1 font-display text-2xl font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-xs text-ink-soft">{note}</p>
    </div>
  )
}

function Table({ head, rows, empty }: { head: string[]; rows: ReactNode[][]; empty: string }) {
  return (
    <div className="card overflow-x-auto">
      <table className="tnum w-full text-sm">
        <thead>
          <tr className="text-left text-ink-soft">
            {head.map((title, index) => <th key={title} scope="col" className={`p-3 font-medium whitespace-nowrap ${index ? 'text-right' : ''}`}>{title}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={head.length} className="border-t border-line p-3 text-ink-soft">{empty}</td></tr>}
          {rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, column) => <td key={column} className={`border-t border-line p-3 ${column ? 'text-right whitespace-nowrap' : ''}`}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="min-w-0">
      <h2 className="mb-2 text-xl">{title}</h2>
      {children}
      {note && <p className="mt-1 text-xs text-ink-soft">{note}</p>}
    </section>
  )
}

function Overview({ data, sales, single }: { data: any; sales?: any; single: boolean }) {
  const against = single ? 'the day before' : 'the period before'
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Figure
          label="Net sales"
          value={money(data.sales.net_sales)}
          note={sales ? <Change now={Number(sales.period.net_sales)} before={Number(sales.previous.net_sales)} against={against} /> : 'Before tax, after credit notes'}
        />
        <Figure
          label="Orders"
          value={String(data.orders.billed)}
          note={sales ? <Change now={sales.period.orders} before={sales.previous.orders} against={against} /> : `${data.orders.cancelled} cancelled`}
        />
        <Figure
          label="Average order"
          value={sales ? money(sales.period.average_order) : '–'}
          note={sales ? <Change now={Number(sales.period.average_order)} before={Number(sales.previous.average_order)} against={against} /> : ''}
        />
        <Figure label="Tax" value={money(Number(data.sales.cgst) + Number(data.sales.sgst) + Number(data.sales.igst) + Number(data.sales.cess))} note={`CGST ${data.sales.cgst} · SGST ${data.sales.sgst}`} />
        <Figure label="Payments recorded" value={money(data.paymentTotals.recorded)} note="Entered by staff, not proof of receipt" />
        <Figure label="Payments confirmed" value={money(data.paymentTotals.confirmed)} note="Checked and confirmed" />
        <Figure label="Waiting to be checked" value={money(data.paymentTotals.awaiting_check)} note={count(data.paymentTotals.awaiting_count, 'payment')} />
        <Figure label="Still owed" value={money(data.outstanding.total)} note={`${count(data.outstanding.bills, 'bill')} from these days`} />
        <Figure label="Refunds" value={money(data.refunds.total)} note={`${data.refunds.count} recorded`} />
      </div>
      <p className="mt-3 text-sm text-ink-soft">These figures show what was billed and recorded, not what has reached your bank.</p>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Section title="Cash sessions">
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
        </Section>
        {data.byBranch.length > 1 && (
          <Section title="By branch">
            <div className="card p-4">
              <ShareBars format={money} rows={data.byBranch.map((row: any) => ({ label: row.name, value: Number(row.billed_sales) - Number(row.credited_sales) }))} />
            </div>
          </Section>
        )}
      </div>
    </>
  )
}

function Sales({ data }: { data: any }) {
  const single = data.from === data.to
  return (
    <div className="grid gap-6">
      <Section title={single ? 'Sales by hour' : 'Sales by day'} note="Before tax, after credit notes.">
        <div className="card p-4">
          <BarChart
            name={single ? 'Sales by hour' : 'Sales by day'}
            format={money}
            rows={data.trend.map((row: any) => ({ label: single ? row.label : shortDate(row.label), value: Number(row.sales) }))}
          />
        </div>
      </Section>
      <Section title="Busiest hours" note={single ? 'Orders billed, by the hour they started.' : 'Orders billed across these days, by the hour they started.'}>
        <div className="card p-4">
          {data.hours.length === 0 ? <p className="text-sm text-ink-soft">No orders in this period.</p> : (
            <BarChart name="Orders by hour" format={(value) => String(Math.round(value))} rows={data.hours.map((row: any) => ({ label: row.label, value: row.orders }))} />
          )}
        </div>
      </Section>
    </div>
  )
}

function Mix({ data }: { data: any }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Section title="Payments by method" note="Recorded and confirmed payments.">
        <div className="card p-4">
          {data.payments.length === 0 ? <p className="text-sm text-ink-soft">No payments in this period.</p> : (
            <ShareBars format={money} rows={data.payments.map((row: any) => ({ label: `${row.method}, ${count(row.count, 'payment')}`, value: Number(row.amount) }))} />
          )}
        </div>
      </Section>
      <Section title="Sales by order type" note="Before tax, after credit notes.">
        <div className="card p-4">
          {data.orderTypes.length === 0 ? <p className="text-sm text-ink-soft">No sales in this period.</p> : (
            <ShareBars format={money} rows={data.orderTypes.map((row: any) => ({ label: `${typeName(row.order_type)}, ${count(row.orders, 'order')}`, value: Number(row.sales) }))} />
          )}
        </div>
      </Section>
    </div>
  )
}

function Products({ data }: { data: any }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Section title="Best sellers" note="By sales before tax, after credit notes.">
        <Table
          head={['Item', 'Quantity', 'Sales']}
          empty="No sales in this period."
          rows={data.best.slice(0, 15).map((row: any) => [row.name, Number(row.quantity), money(row.sales)])}
        />
      </Section>
      <Section title="Slow movers" note="Items on your menu that sold the least, including none at all.">
        <Table
          head={['Item', 'Quantity', 'Sales']}
          empty="Your menu has no items yet."
          rows={data.slow.map((row: any) => [row.name, Number(row.quantity), money(row.sales)])}
        />
      </Section>
      <Section title="Sales by category">
        <div className="card p-4">
          {data.byCategory.length === 0 ? <p className="text-sm text-ink-soft">No sales in this period.</p> : (
            <ShareBars format={money} rows={data.byCategory.map((row: any) => ({ label: row.category, value: Number(row.sales) }))} />
          )}
        </div>
      </Section>
    </div>
  )
}

function Profit({ data }: { data: any }) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        <Figure label="Net sales" value={money(data.netSales)} note="Before tax, after credit notes" />
        <Figure label="Expenses" value={money(data.expenses)} note="Voided expenses are left out" />
        <Figure label="Sales less expenses" value={money(data.salesLessExpenses)} note="An estimate, not accounting profit" />
      </div>
      <p className="mt-3 text-sm text-ink-soft">Stock you bought counts in full when you bought it, even if it isn’t used yet. Ask your accountant for true profit.</p>
      <div className="mt-6 max-w-2xl">
        <Section title="Expenses by category">
          <div className="card p-4">
            {data.byCategory.length === 0 ? <p className="text-sm text-ink-soft">No expenses in this period.</p> : (
              <ShareBars format={money} rows={data.byCategory.map((row: any) => ({ label: `${CATEGORIES[row.category] ?? row.category}, ${count(row.entries, 'entry').replace('entrys', 'entries')}`, value: Number(row.total) }))} />
            )}
          </div>
        </Section>
      </div>
    </>
  )
}

function Staff({ data }: { data: any }) {
  return (
    <Section title="Staff" note="Orders are counted for the person who started them, and bills for the person who issued them.">
      <Table
        head={['Name', 'Orders', 'Bills', 'Sales', 'Discounts', 'Cancelled']}
        empty="No staff activity in this period."
        rows={data.items.map((row: any) => [
          <span key="name">{row.display_name} <span className="text-ink-soft">{ROLES[row.role] ?? row.role}</span></span>,
          row.orders, row.bills, money(row.sales), row.discounts, row.cancelled,
        ])}
      />
    </Section>
  )
}

function Tax({ data }: { data: any }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Section title="Tax by rate" note="Before credit notes. Check figures with your accountant before filing.">
        <Table
          head={['Rate', 'Taxable', 'Tax']}
          empty="No bills in this period."
          rows={data.taxRates.map((row: any) => [`${Number(row.rate)}%`, money(row.taxable), money(row.tax)])}
        />
      </Section>
      <Section title="Tax totals">
        <Table
          head={['Tax', 'Amount']}
          empty=""
          rows={[['CGST', money(data.sales.cgst)], ['SGST', money(data.sales.sgst)], ['IGST', money(data.sales.igst)], ['Cess', money(data.sales.cess)], ['Round off', money(data.sales.round_off)]]}
        />
      </Section>
    </div>
  )
}

export function Reports({ me }: { me: Me }) {
  const [preset, setPreset] = useState('today')
  const [dates, setDates] = useState({ from: localDate(), to: localDate() })
  const [tab, setTab] = useState('overview')
  const branch = useActiveBranch()
  const { from, to } = dates
  const params = `from=${from}&to=${to}${branch ? `&branchId=${branch}` : ''}`
  const canSeeExpenses = me.permissions.includes('expenses.read')

  const daily = useQuery({ queryKey: ['report', params], queryFn: () => api(`/reports/daily?${params}`), enabled: tab === 'overview' || tab === 'tax' })
  const sales = useQuery({ queryKey: ['report-sales', params], queryFn: () => api(`/reports/sales?${params}`), enabled: ['overview', 'sales', 'mix'].includes(tab) })
  const products = useQuery({ queryKey: ['report-products', params], queryFn: () => api(`/reports/products?${params}`), enabled: tab === 'products' })
  const profit = useQuery({ queryKey: ['report-profit', params], queryFn: () => api(`/reports/profit?${params}`), enabled: tab === 'profit' })
  const staff = useQuery({ queryKey: ['report-staff', params], queryFn: () => api(`/reports/staff?${params}`), enabled: tab === 'staff' })

  const tabs = [
    { value: 'overview', label: 'Overview' },
    { value: 'sales', label: 'Sales' },
    { value: 'products', label: 'Items' },
    { value: 'mix', label: 'Payments and types' },
    ...(canSeeExpenses ? [{ value: 'profit', label: 'Expenses and profit' }] : []),
    { value: 'staff', label: 'Staff' },
    { value: 'tax', label: 'Tax' },
  ]
  const active = { overview: daily, tax: daily, sales, mix: sales, products, profit, staff }[tab]!

  function pick(value: string) {
    setPreset(value)
    const range = PRESETS.find((item) => item.value === value)?.range
    if (range) setDates(range())
  }

  function exportRows() {
    const data = active.data
    const sheets: Record<string, () => unknown[][]> = {
      overview: () => [['Figure', 'Value'], ['Net sales', data.sales.net_sales], ['Bills', data.sales.bills], ['CGST', data.sales.cgst], ['SGST', data.sales.sgst],
        ['Payments recorded', data.paymentTotals.recorded], ['Payments confirmed', data.paymentTotals.confirmed], ['Still owed', data.outstanding.total], ['Refunds', data.refunds.total]],
      sales: () => [['Period', 'Sales'], ...data.trend.map((row: any) => [row.label, row.sales])],
      mix: () => [['Kind', 'Name', 'Count', 'Amount'], ...data.payments.map((row: any) => ['Payment', row.method, row.count, row.amount]),
        ...data.orderTypes.map((row: any) => ['Order type', typeName(row.order_type), row.orders, row.sales])],
      products: () => [['Item', 'Category', 'Quantity', 'Sales'], ...data.best.map((row: any) => [row.name, row.category, row.quantity, row.sales])],
      profit: () => [['Line', 'Amount'], ['Net sales', data.netSales], ...data.byCategory.map((row: any) => [CATEGORIES[row.category] ?? row.category, row.total]), ['Sales less expenses', data.salesLessExpenses]],
      staff: () => [['Name', 'Role', 'Orders', 'Bills', 'Sales', 'Discounts', 'Cancelled'], ...data.items.map((row: any) => [row.display_name, row.role, row.orders, row.bills, row.sales, row.discounts, row.cancelled])],
      tax: () => [['Rate', 'Taxable', 'Tax'], ...data.taxRates.map((row: any) => [row.rate, row.taxable, row.tax])],
    }
    downloadCsv(`report-${tab}-${from}-to-${to}.csv`, sheets[tab]())
  }

  const actions = (
    <div className="no-print flex gap-2">
      <button className="btn btn-secondary" onClick={() => window.print()}><Printer size={16} aria-hidden="true" /> Print</button>
      <button className="btn btn-secondary" disabled={!active.data} onClick={exportRows}><Download size={16} aria-hidden="true" /> Export CSV</button>
    </div>
  )

  return (
    <>
      <PageHeader title="Reports" text="Days are trading days, so a bill after midnight counts towards the day it belongs to." action={actions} />
      <p className="mb-3 hidden text-sm print:block">{tabs.find((item) => item.value === tab)?.label}, {from === to ? shortDate(from) : `${shortDate(from)} to ${shortDate(to)}`}</p>

      <div className="no-print mb-4 grid grid-cols-[minmax(0,1fr)] gap-3">
        <div className="flex min-w-0 flex-wrap items-end gap-3">
          <Segmented label="Period" value={preset} options={PRESETS} onChange={pick} />
          {preset === 'custom' && (
            <>
              <label className="field">From<input type="date" value={from} max={to} onChange={(event) => setDates({ ...dates, from: event.target.value })} /></label>
              <label className="field">To<input type="date" value={to} min={from} onChange={(event) => setDates({ ...dates, to: event.target.value })} /></label>
            </>
          )}
        </div>
        <Segmented label="Report" value={tab} options={tabs} onChange={setTab} />
      </div>

      <Loading ready={Boolean(active.data)} error={active.error}>
        {tab === 'overview' && daily.data && <Overview data={daily.data} sales={sales.data} single={from === to} />}
        {tab === 'sales' && sales.data && <Sales data={sales.data} />}
        {tab === 'mix' && sales.data && <Mix data={sales.data} />}
        {tab === 'products' && products.data && <Products data={products.data} />}
        {tab === 'profit' && profit.data && <Profit data={profit.data} />}
        {tab === 'staff' && staff.data && <Staff data={staff.data} />}
        {tab === 'tax' && daily.data && <Tax data={daily.data} />}
      </Loading>
    </>
  )
}
