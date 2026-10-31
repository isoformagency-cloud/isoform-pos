import { useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Armchair, ChartColumn, Check, ChefHat, ChevronRight, CreditCard, FileText, PauseCircle, Receipt, ShoppingCart, UtensilsCrossed, Wallet, X, type LucideIcon } from 'lucide-react'
import { Link } from 'react-router'
import type { Me } from '../App'
import { BarChart, Change, ShareBars } from '../components/charts'
import { typeName } from '../components/order-look'
import type { Alerts } from '../components/Shell'
import { Badge, Notice, Segmented } from '../components/ui'
import { api, useActiveBranch } from '../lib/api'
import { money, shortDate, time } from '../lib/format'

const greeting = () => {
  const hour = new Date().getHours()
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
}

const SHORTCUTS: { to: string; label: string; text: string; icon: LucideIcon; needs: string }[] = [
  { to: '/pos?new=1', label: 'Take an order', text: 'Open the POS and start billing', icon: ShoppingCart, needs: 'orders.write' },
  { to: '/tables', label: 'Tables', text: 'See who is seated, and reserve tables', icon: Armchair, needs: 'tables.read' },
  { to: '/kitchen', label: 'Kitchen', text: 'Tickets to prepare and serve', icon: ChefHat, needs: 'kitchen.read' },
  { to: '/cash', label: 'Cash drawer', text: 'Open or close a cash session', icon: Wallet, needs: 'cash.use' },
  { to: '/menu', label: 'Menu', text: 'Items, prices and sold-out status', icon: UtensilsCrossed, needs: 'menu.write' },
  { to: '/reports', label: 'Reports', text: 'See how the day went', icon: ChartColumn, needs: 'reports.read' },
]

const RANGES = { today: 'yesterday', week: 'the week before', month: 'the days before' } as const
type Range = keyof typeof RANGES

function Tile({ label, value, note }: { label: string; value: string; note: ReactNode }) {
  return (
    <div className="card p-4">
      <p className="text-sm text-ink-soft">{label}</p>
      <p className="tnum mt-1 font-display text-2xl font-semibold tracking-tight">{value}</p>
      <p className="mt-1 min-h-4">{note}</p>
    </div>
  )
}

function Panel({ title, to, children }: { title: string; to?: string; children: ReactNode }) {
  return (
    <section className="card min-w-0 p-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-base">{title}</h2>
        {to && <Link to={to} className="text-sm text-ink-soft underline">View all</Link>}
      </div>
      {children}
    </section>
  )
}

function Dashboard() {
  const [range, setRange] = useState<Range>('today')
  const branch = useActiveBranch()
  const query = useQuery({
    queryKey: ['dashboard', range, branch],
    queryFn: () => api(`/dashboard?range=${range}${branch ? `&branchId=${branch}` : ''}`),
    refetchInterval: 60000,
  })
  const data = query.data
  const against = RANGES[range]
  const single = range === 'today'

  return (
    <div className="mt-6">
      <Segmented
        label="Period"
        value={range}
        options={[{ value: 'today', label: 'Today' }, { value: 'week', label: 'This week' }, { value: 'month', label: 'This month' }]}
        onChange={setRange}
      />
      {query.error && <div className="mt-3"><Notice>{query.error.message}</Notice></div>}
      {data && (
        <>
          <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label="Sales" value={money(data.period.net_sales)} note={<Change now={Number(data.period.net_sales)} before={Number(data.previous.net_sales)} against={against} />} />
            <Tile label="Orders" value={String(data.period.orders)} note={<Change now={data.period.orders} before={data.previous.orders} against={against} />} />
            <Tile label="Average order" value={money(data.period.average_order)} note={<Change now={Number(data.period.average_order)} before={Number(data.previous.average_order)} against={against} />} />
            {data.expenses && <Tile label="Expenses" value={money(data.expenses.total)} note={<span className="text-xs text-ink-soft">{data.expenses.entries} recorded</span>} />}
          </div>

          <div className="mt-3 grid gap-3 lg:grid-cols-3">
            <div className="card min-w-0 p-4 lg:col-span-2">
              <h2 className="mb-3 text-base">{single ? 'Sales by hour' : 'Sales by day'}</h2>
              <BarChart
                tall
                name={single ? 'Sales by hour' : 'Sales by day'}
                format={money}
                rows={data.trend.map((row: any) => ({ label: single ? row.label : shortDate(row.label), value: Number(row.sales) }))}
              />
            </div>
            <div className="grid content-start gap-3">
              <Panel title="Order types">
                {data.orderTypes.length === 0 ? <p className="text-sm text-ink-soft">No sales yet.</p> : (
                  <ShareBars format={money} rows={data.orderTypes.map((row: any) => ({ label: typeName(row.order_type), value: Number(row.sales) }))} />
                )}
              </Panel>
              <Panel title="Payments">
                {data.payments.length === 0 ? <p className="text-sm text-ink-soft">No payments yet.</p> : (
                  <ShareBars format={money} rows={data.payments.map((row: any) => ({ label: row.method, value: Number(row.amount) }))} />
                )}
              </Panel>
            </div>
          </div>

          <div className="mt-3 grid gap-3 lg:grid-cols-3">
            {data.recentOrders && (
              <Panel title="Recent orders" to="/orders">
                {data.recentOrders.length === 0 && <p className="text-sm text-ink-soft">No orders yet.</p>}
                <ul className="divide-y divide-line-soft">
                  {data.recentOrders.map((order: any) => (
                    <li key={order.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <span className="min-w-0 truncate">#{order.display_number} · {typeName(order.order_type)} <span className="text-ink-soft">{time(order.created_at)}</span></span>
                      {order.amount ? <span className="tnum shrink-0">{money(order.amount)}</span> : <Badge tone={order.status === 'cancelled' ? 'neutral' : 'wait'}>{order.status === 'cancelled' ? 'Cancelled' : 'Open'}</Badge>}
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
            {data.kitchen && (
              <Panel title="Kitchen" to="/kitchen">
                <dl className="grid grid-cols-3 gap-2 text-center">
                  {[['new', 'New'], ['preparing', 'Preparing'], ['ready', 'Ready']].map(([key, label]) => (
                    <div key={key} className="rounded-lg bg-paper-soft p-2">
                      <dd className="tnum font-display text-2xl font-semibold">{data.kitchen[key] ?? 0}</dd>
                      <dt className="text-xs text-ink-soft">{label}</dt>
                    </div>
                  ))}
                </dl>
              </Panel>
            )}
            {data.lowStock && (
              <Panel title="Low stock" to="/inventory">
                {data.lowStock.length === 0 && <p className="text-sm text-ink-soft">Everything is above its minimum.</p>}
                <ul className="divide-y divide-line-soft">
                  {data.lowStock.map((item: any) => (
                    <li key={item.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <span className="min-w-0 truncate">{item.name}</span>
                      <span className="tnum shrink-0 text-ink-soft">{Number(item.quantity)} {item.unit}</span>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
          </div>
        </>
      )}
    </div>
  )
}

const STEPS: { key: string; label: string; text: string; to: string }[] = [
  { key: 'details', label: 'Add your business details', text: 'FSSAI number, bill footer and UPI ID', to: '/settings' },
  { key: 'menu', label: 'Add your menu', text: 'Categories, items and tax rates', to: '/menu' },
  { key: 'tables', label: 'Set up your tables', text: 'Skip this if you only do takeaway', to: '/tables' },
  { key: 'staff', label: 'Add your staff', text: 'Give each person their own PIN', to: '/staff' },
]

function SetupGuide() {
  const queryClient = useQueryClient()
  const status = useQuery({ queryKey: ['setup'], queryFn: () => api('/setup') })
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['setup'] })
    queryClient.invalidateQueries({ queryKey: ['menu'] })
    queryClient.invalidateQueries({ queryKey: ['floor'] })
  }
  const dismiss = useMutation({ mutationFn: () => api('/setup/dismiss', { method: 'POST', body: { dismissed: true } }), onSuccess: refresh })
  const sample = useMutation({ mutationFn: () => api('/setup/sample', { method: 'POST', body: {} }), onSuccess: refresh })
  const data = status.data
  if (!data || data.dismissed) return null
  const done = STEPS.filter((step) => data[step.key]).length

  return (
    <section className="card mt-6 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg">Set up your café</h2>
          <p className="mt-0.5 text-sm text-ink-soft">{done} of {STEPS.length} done</p>
        </div>
        <button aria-label="Hide setup guide" className="btn btn-ghost btn-icon -mt-1 -mr-1" onClick={() => dismiss.mutate()}><X size={17} aria-hidden="true" /></button>
      </div>
      <ul className="mt-3 divide-y divide-line-soft">
        {STEPS.map((step) => (
          <li key={step.key}>
            <Link to={step.to} className="flex items-center gap-3 py-2.5">
              <span className={`grid size-6 shrink-0 place-items-center rounded-full border ${data[step.key] ? 'border-ok bg-ok text-white' : 'border-line-strong text-transparent'}`}>
                <Check size={14} aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className={`block text-sm font-medium ${data[step.key] ? 'text-ink-soft' : ''}`}>{step.label}<span className="sr-only">{data[step.key] ? ', done' : ''}</span></span>
                <span className="block text-sm text-ink-soft">{step.text}</span>
              </span>
              <ChevronRight size={17} className="ml-auto text-ink-faint" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
      {!data.menu && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-paper-soft p-3">
          <p className="text-sm text-ink-mid">Want to look around first? Add a sample café menu and tables, then clear them from Settings.</p>
          <button className="btn btn-secondary btn-sm" disabled={sample.isPending} onClick={() => sample.mutate()}>{sample.isPending ? 'Adding…' : 'Add sample menu'}</button>
        </div>
      )}
      {sample.error && <div className="mt-3"><Notice>{sample.error.message}</Notice></div>}
    </section>
  )
}

export function Home({ me }: { me: Me }) {
  const alerts = useQuery<Alerts>({ queryKey: ['alerts'], queryFn: () => api('/alerts', { branch: true }), refetchInterval: 20000 })
  const counts = [
    { to: '/orders', label: 'Running orders', value: alerts.data?.runningOrders, icon: Receipt, needs: 'orders.read' },
    { to: '/orders?tab=held', label: 'On hold', value: alerts.data?.heldOrders, icon: PauseCircle, needs: 'orders.read' },
    { to: '/invoices', label: 'Unpaid bills', value: alerts.data?.unpaidBills, icon: FileText, needs: 'billing.read' },
    { to: '/payments', label: 'Payments to confirm', value: alerts.data?.paymentsToVerify, icon: CreditCard, needs: 'payments.verify' },
  ].filter((item) => me.permissions.includes(item.needs))
  const shortcuts = SHORTCUTS.filter((item) => me.permissions.includes(item.needs))

  return (
    <>
      <h1 className="text-[1.75rem] leading-tight">{greeting()}, {me.displayName.split(' ')[0]}</h1>
      <p className="mt-1 text-sm text-ink-soft">{new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</p>

      {me.permissions.includes('business.write') && <SetupGuide />}

      {counts.length > 0 && (
        <ul className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {counts.map(({ to, label, value, icon: Icon }) => (
            <li key={label}>
              <Link to={to} className="card block p-4 transition-colors hover:border-line-strong">
                <span className="flex items-center justify-between text-sm text-ink-soft">
                  {label}
                  <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
                </span>
                <span className="tnum mt-2 block font-display text-3xl font-semibold tracking-tight">{value ?? '–'}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {me.permissions.includes('reports.read') && <Dashboard />}

      {shortcuts.length > 0 && (
        <ul className="card mt-6 divide-y divide-line-soft overflow-hidden">
          {shortcuts.map(({ to, label, text, icon: Icon }) => (
            <li key={to}>
              <Link to={to} className="flex items-center gap-3 p-4 transition-colors hover:bg-paper-soft">
                <span className="grid size-9 place-items-center rounded-lg bg-brand-tint text-brand"><Icon size={18} strokeWidth={1.75} aria-hidden="true" /></span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{label}</span>
                  <span className="block text-sm text-ink-soft">{text}</span>
                </span>
                <ChevronRight size={17} className="ml-auto text-ink-faint" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
