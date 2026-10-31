import { useEffect, useState } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Search, Users } from 'lucide-react'
import { Link, useSearchParams } from 'react-router'
import type { Me } from '../App'
import { typeName } from '../components/order-look'
import { Avatar, Badge, Empty, Modal, Notice, PageHeader } from '../components/ui'
import { api } from '../lib/api'
import { dateTime, money, shortDate } from '../lib/format'

const SORTS = [
  ['spend', 'Top spenders'],
  ['recent', 'Most recent visit'],
  ['orders', 'Most orders'],
  ['newest', 'Newest'],
  ['name', 'Name A to Z'],
] as const

const average = (spent: string, orders: number) => (orders > 0 ? money(Math.round(Number(spent) / orders)) : '—')

function Stat({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return (
    <div className="card p-4">
      <p className="text-sm text-ink-soft">{label}</p>
      <p className="tnum mt-1 font-display text-2xl font-semibold tracking-tight">{value}</p>
      {note && <p className="mt-0.5 text-xs text-ink-soft">{note}</p>}
    </div>
  )
}

export function Customers({ me }: { me: Me }) {
  const queryClient = useQueryClient()
  const [params, setParams] = useSearchParams()
  const [text, setText] = useState('')
  const [term, setTerm] = useState('')
  const [sort, setSort] = useState('spend')
  const [editing, setEditing] = useState<any | 'new' | null>(null)
  const openId = params.get('open')
  const canWrite = me.permissions.includes('customers.write')

  useEffect(() => {
    const wait = setTimeout(() => setTerm(text.trim()), 250)
    return () => clearTimeout(wait)
  }, [text])

  const summary = useQuery({ queryKey: ['customers', 'summary'], queryFn: () => api('/customers/summary', { branch: true }) })
  const list = useInfiniteQuery({
    queryKey: ['customers', 'list', term, sort],
    queryFn: ({ pageParam }) => api(`/customers?search=${encodeURIComponent(term)}&sort=${sort}&offset=${pageParam}`, { branch: true }),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextOffset ?? undefined,
  })
  const rows: any[] = list.data?.pages.flatMap((page) => page.items) ?? []
  const open = (id: string | null) => setParams(id ? { open: id } : {}, { replace: true })
  const data = summary.data

  return (
    <>
      <PageHeader
        title="Customers"
        text="Your regulars, their visits and what they spend."
        action={canWrite && <button className="btn btn-primary" onClick={() => setEditing('new')}><Plus size={16} aria-hidden="true" /> Add customer</button>}
      />

      {data && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Customers" value={data.total} note="With a saved profile" />
          <Stat label="Visited in 30 days" value={data.recent} note={data.total ? `${Math.round((data.recent / data.total) * 100)}% of customers` : undefined} />
          <Stat label="Repeat customers" value={data.repeat} note="More than one order" />
          <Stat label="Lifetime spend" value={money(data.lifetime)} note="From saved customers" />
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="relative min-w-52 flex-1 sm:max-w-sm">
          <span className="sr-only">Search customers</span>
          <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-faint" aria-hidden="true" />
          <input value={text} onChange={(event) => setText(event.target.value)} className="input !min-h-10 !pl-9 !text-sm" placeholder="Name, phone or email" />
        </label>
        <label>
          <span className="sr-only">Sort customers</span>
          <select className="input !min-h-10 !w-auto !text-sm" value={sort} onChange={(event) => setSort(event.target.value)}>
            {SORTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
      </div>

      {list.error && <Notice>{list.error.message}</Notice>}
      {list.isPending && <p className="py-6 text-sm text-ink-soft">Loading customers…</p>}
      {list.data && rows.length === 0 && (
        <Empty
          icon={Users}
          title={term ? `No customers match “${term}”.` : 'No customers yet'}
          text={term ? undefined : 'Add a customer here, or attach one to a bill from the POS.'}
        />
      )}

      {rows.length > 0 && (
        <>
          <div className="card hidden overflow-hidden md:block">
            <table className="data-table">
              <thead>
                <tr><th>Customer</th><th>Phone</th><th className="!text-right">Orders</th><th className="!text-right">Total spent</th><th className="!text-right">Avg. order</th><th className="!text-right">Last visit</th></tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} data-link tabIndex={0} onClick={() => open(row.id)} onKeyDown={(event) => { if (event.key === 'Enter') open(row.id) }}>
                    <td>
                      <span className="flex items-center gap-2.5">
                        <Avatar name={row.name} />
                        <span className="min-w-0">
                          <span className="block font-medium">{row.name}</span>
                          {row.notes && <span className="block max-w-56 truncate text-xs text-wait">{row.notes}</span>}
                        </span>
                      </span>
                    </td>
                    <td className="tnum">{row.phone}</td>
                    <td className="tnum text-right">{row.orders}</td>
                    <td className="tnum text-right font-medium">{money(row.spent)}</td>
                    <td className="tnum text-right">{average(row.spent, row.orders)}</td>
                    <td className="text-right whitespace-nowrap text-ink-soft">{row.last_visit ? shortDate(row.last_visit) : 'Never'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="grid gap-2 md:hidden">
            {rows.map((row) => (
              <li key={row.id}>
                <button className="card flex w-full items-center gap-3 p-3 text-left" onClick={() => open(row.id)}>
                  <Avatar name={row.name} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{row.name}</span>
                    <span className="tnum block text-xs text-ink-soft">{row.phone} · {row.orders} orders</span>
                  </span>
                  <span className="tnum font-medium">{money(row.spent)}</span>
                </button>
              </li>
            ))}
          </ul>

          {list.hasNextPage && (
            <button className="btn btn-secondary mt-3 w-full" disabled={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>
              {list.isFetchingNextPage ? 'Loading…' : 'Show more'}
            </button>
          )}
        </>
      )}

      {openId && <Profile id={openId} canWrite={canWrite} onClose={() => open(null)} onEdit={setEditing} />}
      {editing && (
        <CustomerForm
          customer={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(id) => {
            setEditing(null)
            queryClient.invalidateQueries({ queryKey: ['customers'] })
            queryClient.invalidateQueries({ queryKey: ['customer', id] })
          }}
        />
      )}
    </>
  )
}

function Profile({ id, canWrite, onClose, onEdit }: { id: string; canWrite: boolean; onClose: () => void; onEdit: (customer: any) => void }) {
  const profile = useQuery({ queryKey: ['customer', id], queryFn: () => api(`/customers/${id}`, { branch: true }) })
  const data = profile.data

  return (
    <Modal
      side
      title={data?.name ?? 'Customer'}
      text={data ? `Customer since ${shortDate(data.created_at)}` : undefined}
      onClose={onClose}
      footer={canWrite && data ? <button className="btn btn-secondary" onClick={() => onEdit(data)}>Edit</button> : undefined}
    >
      {profile.error && <Notice>{profile.error.message}</Notice>}
      {profile.isPending && <p className="text-sm text-ink-soft">Loading…</p>}
      {data && (
        <div className="grid gap-5">
          {data.notes && <p className="rounded-xl bg-wait-tint p-3 text-sm text-wait">{data.notes}</p>}

          <dl className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-paper-soft p-3"><dt className="text-xs text-ink-soft">Orders</dt><dd className="tnum font-semibold">{data.orders}</dd></div>
            <div className="rounded-xl bg-paper-soft p-3"><dt className="text-xs text-ink-soft">Total spent</dt><dd className="tnum font-semibold">{money(data.spent)}</dd></div>
            <div className="rounded-xl bg-paper-soft p-3"><dt className="text-xs text-ink-soft">Avg. order</dt><dd className="tnum font-semibold">{average(data.spent, data.orders)}</dd></div>
          </dl>

          <dl className="grid gap-2 text-sm">
            <div><dt className="text-xs text-ink-soft">Phone</dt><dd className="tnum">{data.phone}</dd></div>
            {data.email && <div><dt className="text-xs text-ink-soft">Email</dt><dd>{data.email}</dd></div>}
            {data.address && <div><dt className="text-xs text-ink-soft">Address</dt><dd>{data.address}</dd></div>}
          </dl>

          {data.usual.length > 0 && (
            <section>
              <h3 className="mb-1.5 text-sm">Usually orders</h3>
              <ul className="flex flex-wrap gap-1.5">
                {data.usual.map((item: any) => <li key={item.name}><Badge>{item.name} · {Number(item.quantity)}</Badge></li>)}
              </ul>
            </section>
          )}

          <section>
            <h3 className="mb-1.5 text-sm">Order history</h3>
            {data.history.length === 0 && <p className="text-sm text-ink-soft">No orders yet. Attach this customer to a bill from the POS.</p>}
            <ul className="divide-y divide-line-soft text-sm">
              {data.history.map((order: any) => (
                <li key={order.id}>
                  <Link to={`/orders?tab=all&open=${order.id}`} className="flex min-h-11 items-center justify-between gap-3 hover:underline">
                    <span>#{order.display_number} · {typeName(order.order_type)}<span className="block text-xs text-ink-soft">{dateTime(order.created_at)}</span></span>
                    <span className="tnum">{order.amount ? money(order.amount) : <span className="capitalize text-ink-soft">{order.status}</span>}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </Modal>
  )
}

function CustomerForm({ customer, onClose, onSaved }: { customer: any | null; onClose: () => void; onSaved: (id: string) => void }) {
  const save = useMutation({
    mutationFn: (body: object) => (customer ? api(`/customers/${customer.id}`, { method: 'PATCH', body }) : api('/customers', { method: 'POST', body })),
    onSuccess: (data) => onSaved(data.id),
  })

  return (
    <Modal title={customer ? `Edit ${customer.name}` : 'Add customer'} onClose={onClose}>
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          save.mutate(Object.fromEntries(new FormData(event.currentTarget)))
        }}
      >
        <label className="field">Name<input name="name" required minLength={2} maxLength={100} defaultValue={customer?.name} /></label>
        <label className="field">10-digit mobile<input name="phone" required inputMode="numeric" pattern="\d{10}" title="10 digits" defaultValue={customer?.phone} /></label>
        <label className="field">Email (optional)<input name="email" type="email" defaultValue={customer?.email ?? ''} /></label>
        <label className="field">Address (optional)<input name="address" maxLength={300} defaultValue={customer?.address ?? ''} /></label>
        <label className="field">
          Notes (optional)
          <input name="notes" maxLength={300} defaultValue={customer?.notes ?? ''} placeholder="Prefers oat milk, allergic to nuts" />
          <span className="hint">Staff see this on the order when this customer is added.</span>
        </label>
        {save.error && <Notice>{save.error.message}</Notice>}
        <button className="btn btn-primary" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save customer'}</button>
      </form>
    </Modal>
  )
}
