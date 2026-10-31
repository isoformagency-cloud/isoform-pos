import { useEffect, useState } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Download, Lock, Pause, Plus, Receipt, Search } from 'lucide-react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import type { Me } from '../App'
import { OrderDrawer, paymentState } from '../components/OrderDrawer'
import { ORDER_TYPES, TYPE_LOOK, typeName } from '../components/order-look'
import { Badge, Empty, Notice, PageHeader, Segmented } from '../components/ui'
import { api } from '../lib/api'
import { dateTime, downloadCsv, localDate, money, time } from '../lib/format'

const TABS: Record<string, string> = {
  running: 'status=open&held=false',
  held: 'status=open&held=true',
  completed: 'status=finalized',
  cancelled: 'status=cancelled',
  all: 'status=all',
}

const RANGES = [
  ['all', 'All time', null],
  ['today', 'Today', 0],
  ['week', 'Last 7 days', 6],
  ['month', 'Last 30 days', 29],
] as const

function StatusBadge({ order }: { order: any }) {
  if (order.status === 'cancelled') return <Badge tone="bad">Cancelled</Badge>
  if (order.status === 'finalized') return <Badge tone="ok">Billed</Badge>
  if (order.held_at) return <Badge tone="wait"><Pause size={11} aria-hidden="true" /> On hold</Badge>
  if (order.confirmed_at) return <Badge tone="brand"><Lock size={11} aria-hidden="true" /> Confirmed</Badge>
  return <Badge tone="sky">Open</Badge>
}

export function Orders({ me }: { me: Me }) {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') ?? 'running'
  const openId = params.get('open')
  const [text, setText] = useState(params.get('q') ?? '')
  const [term, setTerm] = useState(text)
  const [type, setType] = useState('')
  const [range, setRange] = useState<string>('all')
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')

  const canOrder = me.permissions.includes('orders.write')
  const canExport = me.permissions.includes('reports.read')

  const change = (next: Record<string, string | null>) => {
    const merged = new URLSearchParams(params)
    for (const [key, value] of Object.entries(next)) {
      if (value) merged.set(key, value)
      else merged.delete(key)
    }
    setParams(merged, { replace: true })
  }

  useEffect(() => {
    const wait = setTimeout(() => setTerm(text.trim()), 250)
    return () => clearTimeout(wait)
  }, [text])

  const daysBack = RANGES.find(([value]) => value === range)?.[2]
  const query = [
    term ? 'status=all' : TABS[tab],
    term ? `q=${encodeURIComponent(term)}` : '',
    type ? `type=${type}` : '',
    daysBack !== null && daysBack !== undefined ? `from=${localDate(daysBack)}` : '',
  ].filter(Boolean).join('&')

  const counts = useQuery({ queryKey: ['orders', 'counts'], queryFn: () => api('/orders/counts', { branch: true }), refetchInterval: 20000 })
  const list = useInfiniteQuery({
    queryKey: ['orders', 'list', query],
    queryFn: ({ pageParam }) => api(`/orders?${query}${pageParam ? `&before=${encodeURIComponent(pageParam)}` : ''}`, { branch: true }),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextBefore ?? undefined,
    refetchInterval: 20000,
  })
  const rows: any[] = list.data?.pages.flatMap((page) => page.items) ?? []

  const tabs = [
    { value: 'running', label: 'Running', count: counts.data?.running },
    { value: 'held', label: 'On hold', count: counts.data?.held },
    { value: 'completed', label: 'Completed', count: counts.data?.completed },
    { value: 'cancelled', label: 'Cancelled', count: counts.data?.cancelled },
    { value: 'all', label: 'All' },
  ]

  async function exportCsv() {
    setExporting(true)
    setExportError('')
    try {
      const { items } = await api(`/orders/export?${query}`, { branch: true })
      downloadCsv(`orders-${localDate()}.csv`, [
        ['Order', 'Date', 'Time', 'Type', 'Table', 'Customer', 'Phone', 'Items', 'Amount', 'Status', 'Still owed', 'Bill numbers'],
        ...items.map((item: any) => [
          item.display_number, item.business_date, time(item.created_at), typeName(item.order_type), item.table_label, item.customer_name,
          item.customer_phone, item.item_count, item.amount, item.status, item.outstanding, item.bill_numbers?.join(' '),
        ]),
      ])
    } catch (failure) {
      setExportError((failure as Error).message)
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Orders"
        text="Every order: running, on hold, billed and cancelled."
        action={(
          <div className="flex flex-wrap gap-2">
            {canExport && <button className="btn btn-secondary" disabled={exporting || rows.length === 0} onClick={exportCsv}><Download size={16} aria-hidden="true" /> {exporting ? 'Preparing…' : 'Export CSV'}</button>}
            {canOrder && <Link to="/pos?new=1" className="btn btn-primary"><Plus size={16} aria-hidden="true" /> New order</Link>}
          </div>
        )}
      />

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Segmented label="Order status" value={term ? 'all' : tab} options={tabs} onChange={(value) => { setText(''); setTerm(''); change({ tab: value === 'running' ? null : value, q: null }) }} />
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="relative min-w-52 flex-1 sm:max-w-sm">
          <span className="sr-only">Search orders</span>
          <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-faint" aria-hidden="true" />
          <input value={text} onChange={(event) => setText(event.target.value)} className="input !min-h-10 !pl-9 !text-sm" placeholder="Order number, customer, phone, bill or table" />
        </label>
        <label>
          <span className="sr-only">Order type</span>
          <select className="input !min-h-10 !w-auto !text-sm" value={type} onChange={(event) => setType(event.target.value)}>
            <option value="">All types</option>
            {ORDER_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label>
          <span className="sr-only">Period</span>
          <select className="input !min-h-10 !w-auto !text-sm" value={range} onChange={(event) => setRange(event.target.value)}>
            {RANGES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
      </div>

      {exportError && <div className="mb-3"><Notice>{exportError}</Notice></div>}
      {list.error && <Notice>{list.error.message}</Notice>}
      {list.isPending && <p className="py-6 text-sm text-ink-soft">Loading orders…</p>}
      {list.data && rows.length === 0 && (
        <Empty
          icon={Receipt}
          title={term ? `No orders match “${term}”.` : 'No orders here.'}
          text={term ? 'Try a phone number or bill number.' : undefined}
          action={!term && canOrder ? <Link to="/pos?new=1" className="btn btn-secondary">Start an order</Link> : undefined}
        />
      )}

      {rows.length > 0 && (
        <>
          <div className="card hidden overflow-hidden md:block">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Order</th><th>Table / type</th><th>Customer</th><th className="!text-right">Items</th><th className="!text-right">Amount</th><th>Payment</th><th>Status</th><th className="!text-right">Time</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((order) => {
                  const { icon: Icon, soft } = TYPE_LOOK[order.order_type]
                  const paid = paymentState(order)
                  return (
                    <tr key={order.id} data-link tabIndex={0} onClick={() => change({ open: order.id })} onKeyDown={(event) => { if (event.key === 'Enter') change({ open: order.id }) }}>
                      <td className="font-mono font-medium">#{order.display_number}</td>
                      <td><span className={`flex items-center gap-1.5 ${soft}`}><Icon size={15} aria-hidden="true" />{order.table_label || typeName(order.order_type)}</span></td>
                      <td className="max-w-40 truncate">{order.customer_name ?? <span className="text-ink-faint">Walk-in</span>}</td>
                      <td className="tnum text-right">{order.item_count}</td>
                      <td className="tnum text-right font-medium">{money(order.amount)}</td>
                      <td>{paid ? <Badge tone={paid.tone}>{paid.label}</Badge> : <span className="text-ink-faint">—</span>}</td>
                      <td><StatusBadge order={order} /></td>
                      <td className="tnum text-right whitespace-nowrap text-ink-soft">{dateTime(order.created_at)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <ul className="grid gap-2 md:hidden">
            {rows.map((order) => {
              const { icon: Icon, soft } = TYPE_LOOK[order.order_type]
              const paid = paymentState(order)
              return (
                <li key={order.id}>
                  <button className="card w-full p-3 text-left" onClick={() => change({ open: order.id })}>
                    <span className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2 font-medium">
                        <Icon size={15} className={soft} aria-hidden="true" />
                        <span className="font-mono">#{order.display_number}</span>
                        {order.table_label}
                      </span>
                      <span className="tnum font-medium">{money(order.amount)}</span>
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-soft">
                      <StatusBadge order={order} />
                      {paid && <Badge tone={paid.tone}>{paid.label}</Badge>}
                      <span>{order.customer_name ?? 'Walk-in'} · {dateTime(order.created_at)}</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>

          {list.hasNextPage && (
            <button className="btn btn-secondary mt-3 w-full" disabled={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>
              {list.isFetchingNextPage ? 'Loading…' : 'Show more'}
            </button>
          )}
        </>
      )}

      {openId && <OrderDrawer id={openId} me={me} onClose={() => change({ open: null })} onOpenInPos={() => navigate(`/pos?order=${openId}`)} />}
    </>
  )
}
