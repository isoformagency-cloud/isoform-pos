import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Check, ChefHat, ChevronRight, Lock, MapPin, MessageSquare, Minus, Pause, Percent, Play, Plus, Receipt, Search, Trash2, User, UtensilsCrossed,
} from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router'
import type { Me } from '../App'
import { useAsk } from '../components/Ask'
import { ChooseBranch, useWorkingBranch } from '../components/BranchPicker'
import { CustomerPicker } from '../components/CustomerPicker'
import { DiscountDialog } from '../components/DiscountDialog'
import { ORDER_TYPES, TYPE_LOOK, typeName } from '../components/order-look'
import { Badge, Modal, Notice } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { isOlderDay, money, shortDate } from '../lib/format'

type Change = { path: string; method?: string; body?: object }

const FOOD_COLOUR: Record<string, string> = { veg: 'border-ok text-ok', non_veg: 'border-bad text-bad', egg: 'border-wait text-wait' }
const FOOD_NAME: Record<string, string> = { veg: 'Vegetarian', non_veg: 'Non-vegetarian', egg: 'Contains egg' }

function FoodMark({ type }: { type: string }) {
  if (!FOOD_COLOUR[type]) return null
  return (
    <span title={FOOD_NAME[type]} className={`grid size-3.5 shrink-0 place-items-center rounded-[3px] border ${FOOD_COLOUR[type]}`}>
      <span className="size-1.5 rounded-full bg-current" />
      <span className="sr-only">{FOOD_NAME[type]}</span>
    </span>
  )
}

export function Pos({ me }: { me: Me }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const branch = useWorkingBranch(me)
  const orderId = params.get('order')

  const [draftType, setDraftType] = useState<string>('dine_in')
  const [draftTable, setDraftTable] = useState<{ id: string; name: string } | null>(null)
  const [category, setCategory] = useState<string | null>(null)
  const [term, setTerm] = useState('')
  const [picking, setPicking] = useState<any | null>(null)
  const [dialog, setDialog] = useState<'discount' | 'customer' | 'table' | 'address' | null>(null)
  const [pane, setPane] = useState<'menu' | 'order'>('menu')
  const [secondBill, setSecondBill] = useState<string[]>([])
  const [error, setError] = useState('')
  const { ask, node } = useAsk()
  const searchBox = useRef<HTMLInputElement>(null)

  const can = (permission: string) => me.permissions.includes(permission)
  const canBill = can('billing.write')
  const canWrite = can('orders.write')
  const canDiscount = can('orders.discount') || can('orders.discount_limited')
  const canCancel = can('orders.cancel')

  const select = (id: string | null) => {
    setError('')
    setSecondBill((old) => (old.length ? [] : old))
    setParams(id ? { order: id } : {}, { replace: true })
  }

  // An order belongs to one branch, so changing branch starts fresh instead of showing someone else's.
  const lastBranch = useRef(branch)
  useEffect(() => {
    if (lastBranch.current && branch && lastBranch.current !== branch) {
      setDraftTable(null)
      select(null)
    }
    lastBranch.current = branch
  }, [branch])

  const askedTable = params.get('table')
  useEffect(() => {
    if (params.get('new')) {
      setDraftTable(null)
      select(null)
    }
  }, [params])

  useEffect(() => {
    const focus = (event: KeyboardEvent) => {
      const typing = /INPUT|TEXTAREA|SELECT/.test((event.target as HTMLElement).tagName)
      if (event.key === '/' && !typing && !document.querySelector('dialog[open]')) {
        event.preventDefault()
        searchBox.current?.focus()
      }
    }
    document.addEventListener('keydown', focus)
    return () => document.removeEventListener('keydown', focus)
  }, [])

  const list = useQuery({ queryKey: ['orders', 'bar', branch], queryFn: () => api('/orders?status=open', { branch: true }), enabled: Boolean(branch), refetchInterval: 15000 })
  const menu = useQuery({ queryKey: ['menu', branch], queryFn: () => api(`/menu?branchId=${branch}`), enabled: Boolean(branch) })
  const settings = useQuery({ queryKey: ['pos-settings'], queryFn: () => api('/pos-settings') })
  const floor = useQuery({ queryKey: ['floor', branch], queryFn: () => api('/floor', { branch: true }), enabled: Boolean(branch) && me.permissions.includes('tables.read') })
  const usesKitchen = settings.data?.uses_kitchen !== false
  // Applied once, so choosing a different table afterwards isn't undone by a refresh.
  const appliedTable = useRef<string | null>(null)
  useEffect(() => {
    if (!askedTable || !floor.data || appliedTable.current === askedTable) return
    const table = floor.data.tables.find((item: any) => item.id === askedTable)
    if (table) {
      appliedTable.current = askedTable
      setDraftTable({ id: table.id, name: table.name })
      setDraftType('dine_in')
    }
  }, [askedTable, floor.data])
  const order = useQuery({ queryKey: ['order', orderId], queryFn: () => api(`/orders/${orderId}`, { branch: true }), enabled: Boolean(orderId) })
  const current = orderId ? order.data : undefined

  const quote = useQuery({
    queryKey: ['quote', orderId, current?.version],
    queryFn: () => api(`/orders/${orderId}/quote`, { branch: true }),
    enabled: Boolean(orderId && current?.confirmed_at && current?.status === 'open' && canBill),
  })

  const refreshLists = () => {
    queryClient.invalidateQueries({ queryKey: ['orders'] })
    queryClient.invalidateQueries({ queryKey: ['alerts'] })
  }

  // The first tap on an empty screen creates the order. Later taps wait for it, so none are lost.
  const creating = useRef<Promise<string> | null>(null)
  const liveId = useRef<string | null>(orderId)
  useEffect(() => { liveId.current = orderId }, [orderId])

  function ensureOrder(extra: object = {}) {
    if (liveId.current) return Promise.resolve(liveId.current)
    const seat = draftTable && draftType === 'dine_in' ? { tableId: draftTable.id } : {}
    creating.current ??= api('/orders', { method: 'POST', branch: true, body: { id: crypto.randomUUID(), orderType: draftType, ...seat, ...extra } })
      .then((data) => {
        setDraftTable(null)
        queryClient.setQueryData(['order', data.id], data)
        liveId.current = data.id
        select(data.id)
        refreshLists()
        return data.id as string
      })
      .finally(() => { creating.current = null })
    return creating.current
  }

  // Changes run one at a time, and each reads the newest order when it starts, so quick taps all count.
  const change = useMutation({
    scope: { id: 'order-change' },
    mutationFn: async (build: (latest: any) => Change) => {
      const id = await ensureOrder()
      const latest = queryClient.getQueryData<any>(['order', id])
      const { path, method = 'POST', body } = build(latest)
      return api(`/orders/${id}${path}`, { method, body, branch: true })
    },
    onSuccess: (data) => {
      setError('')
      queryClient.setQueryData(['order', data.id], data)
      refreshLists()
    },
    onError: (failure) => {
      setError(failure.message)
      if (failure instanceof ApiError && failure.code === 'stale_order') queryClient.invalidateQueries({ queryKey: ['order'] })
    },
  })

  const issue = useMutation({
    mutationFn: () => {
      const items = current.items.filter((item: any) => item.status === 'active')
      const part = (rows: any[]) => ({ id: crypto.randomUUID(), items: rows.map((item) => ({ orderItemId: item.id, quantity: item.quantity })) })
      const second = items.filter((item: any) => secondBill.includes(item.id))
      const first = items.filter((item: any) => !secondBill.includes(item.id))
      return api(`/orders/${orderId}/finalize`, {
        method: 'POST',
        branch: true,
        body: { version: current.version, invoices: second.length && first.length ? [part(first), part(second)] : [part(items)] },
      })
    },
    onSuccess: (data) => {
      refreshLists()
      queryClient.invalidateQueries({ queryKey: ['invoices'] })
      const [first, next] = data.invoices
      navigate(`/checkout/${first.id}${next ? `?next=${next.id}` : ''}`)
    },
    onError: (failure) => {
      setError(failure.message)
      queryClient.invalidateQueries({ queryKey: ['order', orderId] })
    },
  })

  const categories = useMemo(() => (menu.data?.categories ?? []).filter((item: any) => item.is_active), [menu.data])
  const allProducts = useMemo(() => (menu.data?.products ?? []).filter((product: any) => product.is_active), [menu.data])
  const shown = allProducts.filter((product: any) =>
    (!category || product.category_id === category) && product.name.toLowerCase().includes(term.trim().toLowerCase()))

  if (!branch) {
    return <ChooseBranch title="POS / Billing" />
  }

  const items = current?.items.filter((item: any) => item.status === 'active') ?? []
  const open = !current || current.status === 'open'
  const confirmed = Boolean(current?.confirmed_at)
  const canEdit = open && !confirmed && canWrite
  const empty = items.length === 0
  const type = current?.order_type ?? draftType
  const unsent = items.filter((item: any) => !item.sent).length
  const orders: any[] = list.data?.items ?? []
  const running = orders.filter((item) => !item.held_at)
  const held = orders.filter((item) => item.held_at)

  function setType(next: string) {
    if (!current) {
      if (next === 'aggregator') {
        ask('Delivery app order', [
          { name: 'app', label: 'Delivery app', required: true, defaultValue: 'Swiggy' },
          { name: 'reference', label: 'Their order number' },
        ], 'Start order').then((answer) => {
          if (answer) ensureOrderOfType(next, { aggregator: answer.app, aggregatorReference: answer.reference || undefined })
        })
        return
      }
      setDraftType(next)
      return
    }
    if (next === 'aggregator') {
      ask('Delivery app order', [
        { name: 'app', label: 'Delivery app', required: true, defaultValue: 'Swiggy' },
        { name: 'reference', label: 'Their order number' },
      ], 'Save').then((answer) => {
        if (answer) change.mutate((latest) => ({ path: '', method: 'PATCH', body: { version: latest.version, orderType: next, aggregator: answer.app, aggregatorReference: answer.reference || undefined } }))
      })
      return
    }
    change.mutate((latest) => ({ path: '', method: 'PATCH', body: { version: latest.version, orderType: next } }))
  }

  function ensureOrderOfType(next: string, extra: object) {
    ensureOrder({ orderType: next, ...extra }).catch((failure) => setError(failure.message))
  }

  function addVariant(variant: any, addonIds: string[] = []) {
    change.mutate((latest) => {
      const same = latest?.items.find((item: any) => item.variant_id === variant.id && item.status === 'active' && item.addons.length === 0 && !item.sent)
      if (same && addonIds.length === 0) {
        return { path: `/items/${same.id}`, method: 'PATCH', body: { version: latest.version, quantity: String(Number(same.quantity) + 1) } }
      }
      return { path: '/items', body: { id: crypto.randomUUID(), variantId: variant.id, addonIds } }
    })
    setPicking(null)
  }

  function tapProduct(product: any) {
    const variants = product.variants.filter((variant: any) => variant.isAvailable)
    if (variants.length === 1 && product.addon_ids.length === 0) addVariant(variants[0])
    else setPicking(product)
  }

  const step = (item: any, by: number) => change.mutate((latest) => {
    const line = latest.items.find((row: any) => row.id === item.id)
    return { path: `/items/${item.id}`, method: 'PATCH', body: { version: latest.version, quantity: String(Math.max(1, Number(line.quantity) + by)) } }
  })

  async function remove(item: any) {
    const answer = await ask(`Remove ${item.product_name}?`, [{ name: 'reason', label: 'Reason', required: true }], 'Remove')
    if (answer) change.mutate((latest) => ({ path: `/items/${item.id}/void`, body: { version: latest.version, reason: answer.reason } }))
  }

  async function itemNote(item: any) {
    const answer = await ask(`Note for ${item.product_name}`, [{ name: 'notes', label: 'Kitchen note', defaultValue: item.notes ?? '', placeholder: 'Less sugar, no onion' }], 'Save note')
    if (answer) change.mutate((latest) => ({ path: `/items/${item.id}`, method: 'PATCH', body: { version: latest.version, notes: answer.notes } }))
  }

  async function orderNote() {
    const answer = await ask('Order note', [{ name: 'notes', label: 'Note', defaultValue: current?.notes ?? '' }], 'Save note')
    if (answer) change.mutate((latest) => ({ path: '', method: 'PATCH', body: { version: latest.version, notes: answer.notes } }))
  }

  async function serviceCharge() {
    const answer = await ask('Voluntary service charge', [
      { name: 'percent', label: 'Percent (use 0 to remove)', required: true, defaultValue: current?.service_charge_percent ?? '0', inputMode: 'decimal' },
    ], 'Save')
    if (answer) change.mutate((latest) => ({ path: '', method: 'PATCH', body: { version: latest.version, serviceChargePercent: answer.percent } }))
  }

  async function cancel() {
    const answer = await ask('Cancel this order?', [{ name: 'reason', label: 'Reason', required: true }], 'Cancel order')
    if (answer) change.mutate((latest) => ({ path: '/cancel', body: { version: latest.version, reason: answer.reason } }), { onSuccess: () => select(null) })
  }

  const deleteEmpty = () => change.mutate((latest) => ({ path: '/cancel', body: { version: latest.version } }), { onSuccess: () => select(null) })
  const confirmOrder = () => change.mutate((latest) => ({ path: '/confirm', body: { version: latest.version } }))
  const sendOrder = () => change.mutate((latest) => ({ path: '/send', body: { version: latest.version } }))
  const hold = (next: boolean) => change.mutate((latest) => ({ path: '/hold', body: { version: latest.version, held: next } }), {
    onSuccess: () => { if (next) select(null) },
  })

  const orderBar = (
    <ul aria-label="Open orders" className="thin-scroll flex gap-2 overflow-x-auto pb-1">
      {orders.length === 0 && <li className="flex min-h-14 items-center text-sm text-ink-soft">No open orders yet. Tap an item to start one.</li>}
      {[...running, ...held].map((item: any) => {
        const { icon: Icon, tone } = TYPE_LOOK[item.order_type]
        return (
          <li key={item.id}>
            <button
              aria-pressed={item.id === orderId}
              className={`min-h-14 min-w-32 rounded-xl border px-3 py-1.5 text-left text-sm transition-shadow ${tone} ${item.held_at ? 'border-dashed opacity-80' : ''} ${item.id === orderId ? 'ring-2 ring-ink ring-offset-1' : ''}`}
              onClick={() => { select(item.id); setPane('order') }}
            >
              <span className="flex items-center gap-1.5 font-medium">
                <Icon size={15} aria-hidden="true" />
                <span className="font-mono">#{item.display_number}</span>
                {item.table_label}
                {item.held_at && <Pause size={12} aria-label="On hold" className="ml-auto" />}
                {!item.held_at && item.confirmed_at && <Lock size={12} aria-label="Confirmed" className="ml-auto" />}
              </span>
              <span className="block text-xs whitespace-nowrap">
                {isOlderDay(item.created_at) ? `${shortDate(item.created_at)} · ` : ''}{typeName(item.order_type)} · {item.item_count} {item.item_count === 1 ? 'item' : 'items'}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )

  return (
    <div className="grid lg:h-[calc(100svh-3.5rem)] lg:grid-cols-[1fr_24rem]">
      {node}

      <section className={`min-w-0 flex-col p-3 md:p-5 lg:flex lg:min-h-0 ${pane === 'menu' ? 'flex' : 'hidden'}`}>
        {orderBar}

        <div className="mt-3 flex items-center gap-2">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">Search menu</span>
            <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-faint" aria-hidden="true" />
            <input ref={searchBox} value={term} onChange={(event) => setTerm(event.target.value)} className="input !pl-9" placeholder="Search menu" />
            <kbd className="pointer-events-none absolute top-1/2 right-3 hidden -translate-y-1/2 rounded border border-line-soft bg-paper-soft px-1.5 text-xs text-ink-soft sm:block">/</kbd>
          </label>
        </div>

        <div className="thin-scroll mt-3 flex shrink-0 gap-1.5 overflow-x-auto pb-1">
          {[{ id: null, name: 'All', count: allProducts.length }, ...categories.map((item: any) => ({ ...item, count: allProducts.filter((product: any) => product.category_id === item.id).length }))].map((item: any) => (
            <button
              key={item.id ?? 'all'}
              aria-pressed={category === item.id}
              className={`flex min-h-10 shrink-0 items-center gap-1.5 rounded-[0.625rem] border px-3 text-sm font-medium transition-colors ${category === item.id ? 'border-ink bg-ink text-white' : 'border-line bg-white text-ink-mid hover:border-line-strong'}`}
              onClick={() => setCategory(item.id)}
            >
              {item.name}
              <span className={`tnum text-xs ${category === item.id ? 'text-white/70' : 'text-ink-faint'}`}>{item.count}</span>
            </button>
          ))}
        </div>

        {confirmed && open && (
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-brand-tint px-3 py-2 text-sm text-brand-deep">
            <span className="flex items-center gap-2"><Lock size={15} aria-hidden="true" /> This order is confirmed, so items are locked.</span>
            <button className="btn btn-secondary btn-sm" onClick={() => select(null)}>Start a new order</button>
          </div>
        )}

        <div className="thin-scroll mt-2 min-h-0 flex-1 overflow-y-auto pb-24 lg:pb-2">
          {menu.isPending && <p className="py-6 text-sm text-ink-soft">Loading menu…</p>}
          {menu.error && <Notice>{menu.error.message}</Notice>}
          {menu.data && shown.length === 0 && (
            <p className="py-8 text-center text-sm text-ink-soft">{term ? `Nothing on the menu matches “${term}”.` : 'No items here yet. Add them on the Menu page.'}</p>
          )}
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
            {shown.map((product: any) => {
              const available = product.variants.filter((variant: any) => variant.isAvailable)
              const options = available.length > 1 || product.addon_ids.length > 0
              return (
                <li key={product.id}>
                  <button
                    disabled={available.length === 0 || !canEdit}
                    className="card flex min-h-[5.25rem] w-full flex-col justify-between gap-2 p-3 text-left transition-[border-color,transform] hover:border-brand-300 active:scale-[0.98] disabled:opacity-55"
                    onClick={() => tapProduct(product)}
                  >
                    <span className="flex items-start gap-1.5">
                      <span className="mt-0.5"><FoodMark type={product.food_type} /></span>
                      <span className="text-sm leading-snug font-medium">{product.name}</span>
                    </span>
                    <span className="flex items-center justify-between gap-2">
                      <span className="tnum text-sm text-ink-mid">{available.length ? money(available[0].price) : 'Sold out'}</span>
                      {options && <span className="text-xs text-ink-faint">Options</span>}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      </section>

      <aside aria-label="Current order" className={`flex-col border-l border-line-soft bg-paper max-lg:min-h-[calc(100svh-7.5rem)] lg:flex lg:min-h-0 ${pane === 'order' ? 'flex' : 'hidden'}`}>
        <div className="border-b border-line-soft p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <button className="mb-1 flex items-center gap-1 text-sm text-ink-soft lg:hidden" onClick={() => setPane('menu')}>Back to menu</button>
              <h2 className="truncate text-lg">
                {current ? `Order #${current.display_number}` : 'New order'}
                {(current?.table_label ?? draftTable?.name) ? ` · ${current?.table_label ?? draftTable?.name}` : ''}
              </h2>
              <p className="flex flex-wrap items-center gap-1.5 text-xs text-ink-soft">
                {current?.guest_count ? `${current.guest_count} guests` : current ? typeName(type) : 'Tap an item to begin'}
                {current?.aggregator ? ` · ${current.aggregator}` : ''}
                {current?.held_at && <Badge tone="wait">On hold</Badge>}
                {confirmed && <Badge tone="brand"><Lock size={11} aria-hidden="true" /> Confirmed</Badge>}
              </p>
            </div>
            {current && <button className="btn btn-secondary btn-sm" onClick={() => select(null)}><Plus size={15} aria-hidden="true" /> New</button>}
          </div>

          <div role="group" aria-label="Order type" className="mt-2.5 grid grid-cols-4 gap-1 rounded-xl bg-mist p-1">
            {ORDER_TYPES.map(([value, label]) => {
              const Icon = TYPE_LOOK[value].icon
              const active = type === value
              return (
                <button
                  key={value}
                  aria-pressed={active}
                  disabled={!canEdit || change.isPending}
                  className={`flex min-h-11 flex-col items-center justify-center rounded-lg text-[0.6875rem] font-medium transition-colors ${active ? `bg-white shadow-card ${TYPE_LOOK[value].soft}` : 'text-ink-soft hover:text-ink'}`}
                  onClick={() => setType(value)}
                >
                  <Icon size={15} aria-hidden="true" />
                  {label}
                </button>
              )
            })}
          </div>

          <div className="mt-2 flex flex-wrap gap-1.5">
            {type === 'dine_in' && (
              <button disabled={!open || !canWrite} className="btn btn-secondary btn-sm" onClick={() => setDialog('table')}>
                <UtensilsCrossed size={14} aria-hidden="true" />
                {(current?.table_label ?? draftTable?.name) ? `Table ${current?.table_label ?? draftTable?.name}` : 'Choose table'}
              </button>
            )}
            {can('customers.read') && (
              <button disabled={!open} className="btn btn-secondary btn-sm max-w-44" onClick={() => setDialog('customer')}>
                <User size={14} aria-hidden="true" />
                <span className="truncate">{current?.customer_name ?? 'Add customer'}</span>
              </button>
            )}
            {(type === 'delivery' || type === 'aggregator') && (
              <button disabled={!open || !canWrite} className="btn btn-secondary btn-sm max-w-44" onClick={() => setDialog('address')}>
                <MapPin size={14} aria-hidden="true" />
                <span className="truncate">{current?.delivery_address || 'Delivery address'}</span>
              </button>
            )}
            {current && canWrite && (
              <button disabled={!open} className="btn btn-secondary btn-sm max-w-40" onClick={orderNote}>
                <MessageSquare size={14} aria-hidden="true" />
                <span className="truncate">{current.notes || 'Order note'}</span>
              </button>
            )}
          </div>
        </div>

        <div className="thin-scroll min-h-40 flex-1 overflow-y-auto px-3">
          {error && <div className="mt-3"><Notice>{error}</Notice></div>}
          {current?.customer_notes && <p className="mt-3 rounded-xl bg-wait-tint px-3 py-2 text-sm text-wait">{current.customer_name}: {current.customer_notes}</p>}
          {empty && (
            <div className="grid justify-items-center gap-1 py-12 text-center">
              <Receipt size={24} strokeWidth={1.5} className="text-ink-faint" aria-hidden="true" />
              <p className="text-sm font-medium text-ink-mid">No items yet</p>
              <p className="text-xs text-ink-soft">Tap items on the menu to add them.</p>
            </div>
          )}
          <ul className="divide-y divide-line-soft">
            {items.map((item: any) => (
              <li key={item.id} className="py-2.5 text-sm">
                <div className="flex justify-between gap-3">
                  <span className="font-medium">{item.product_name}{item.variant_name !== 'Regular' ? ` · ${item.variant_name}` : ''}</span>
                  <span className="tnum">{money(item.line_total)}</span>
                </div>
                {item.addons.map((addon: any) => <p key={addon.id} className="text-xs text-ink-soft">+ {addon.name}</p>)}
                {item.notes && <p className="text-xs text-wait">Note: {item.notes}</p>}
                {canEdit && item.sent ? (
                  <div className="mt-1 flex items-center gap-2 text-xs text-ink-soft">
                    <span className="tnum">Quantity {Number(item.quantity)}</span>
                    <span className="flex items-center gap-1 text-ok"><Check size={12} aria-hidden="true" /> With kitchen</span>
                    {canCancel && (
                      <button aria-label={`Remove ${item.product_name}`} className="btn btn-ghost btn-icon ml-auto !min-h-8 !w-8" onClick={() => remove(item)}>
                        <Trash2 size={15} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                ) : canEdit ? (
                  <div className="mt-1.5 flex items-center gap-1">
                    <button aria-label={`One less ${item.product_name}`} className="btn btn-secondary btn-icon !min-h-9 !w-9 !rounded-[0.625rem]" disabled={Number(item.quantity) <= 1} onClick={() => step(item, -1)}>
                      <Minus size={14} aria-hidden="true" />
                    </button>
                    <span className="tnum w-8 text-center font-medium">{Number(item.quantity)}</span>
                    <button aria-label={`One more ${item.product_name}`} className="btn btn-secondary btn-icon !min-h-9 !w-9 !rounded-[0.625rem]" onClick={() => step(item, 1)}>
                      <Plus size={14} aria-hidden="true" />
                    </button>
                    <button className="btn btn-ghost btn-sm ml-auto" onClick={() => itemNote(item)}>Note</button>
                    <button aria-label={`Remove ${item.product_name}`} className="btn btn-ghost btn-icon !min-h-9 !w-9" onClick={() => remove(item)}>
                      <Trash2 size={15} aria-hidden="true" />
                    </button>
                  </div>
                ) : (
                  <p className="tnum mt-0.5 text-xs text-ink-soft">Quantity {Number(item.quantity)}</p>
                )}
              </li>
            ))}
          </ul>
        </div>

        {current && (
          <div className="border-t border-line-soft bg-white p-3">
            <dl className="tnum space-y-1 text-sm">
              <div className="flex justify-between text-ink-soft"><dt>Subtotal · {items.length} {items.length === 1 ? 'item' : 'items'}</dt><dd>{money(current.subtotal)}</dd></div>
              {current.discounts.map((item: any) => (
                <div key={item.id} className="flex justify-between gap-2 text-ok">
                  <dt>Discount {item.kind === 'percent' ? `${Number(item.value)}%` : money(item.value)}</dt>
                  {open && canDiscount && (
                    <dd><button className="text-xs underline" onClick={() => change.mutate(() => ({ path: `/discounts/${item.id}`, method: 'DELETE' }))}>Remove</button></dd>
                  )}
                </div>
              ))}
              {Number(current.service_charge_percent) > 0 && <div className="flex justify-between text-ink-soft"><dt>Service charge</dt><dd>{Number(current.service_charge_percent)}%</dd></div>}
              {!confirmed && <div className="flex justify-between text-base font-semibold"><dt>Before tax</dt><dd>{money(current.after_discount)}</dd></div>}
            </dl>

            {confirmed && open && canBill && (
              <>
                {quote.error && <div className="mt-2"><Notice>{quote.error.message}</Notice></div>}
                {quote.isPending && <p className="mt-2 text-sm text-ink-soft">Working out tax…</p>}
                {quote.data?.bill && (
                  <dl className="tnum mt-1 space-y-1 text-sm">
                    <div className="flex justify-between text-ink-soft"><dt>Taxable value</dt><dd>{money(quote.data.bill.taxableTotal)}</dd></div>
                    {Number(quote.data.bill.cgstTotal) > 0 && <div className="flex justify-between text-ink-soft"><dt>CGST</dt><dd>{money(quote.data.bill.cgstTotal)}</dd></div>}
                    {Number(quote.data.bill.sgstTotal) > 0 && <div className="flex justify-between text-ink-soft"><dt>SGST</dt><dd>{money(quote.data.bill.sgstTotal)}</dd></div>}
                    {Number(quote.data.bill.roundOff) !== 0 && <div className="flex justify-between text-ink-soft"><dt>Round off</dt><dd>{quote.data.bill.roundOff}</dd></div>}
                    <div className="flex justify-between border-t border-line-soft pt-1 text-lg font-semibold"><dt>Total</dt><dd>{money(quote.data.bill.grandTotal)}</dd></div>
                  </dl>
                )}
                {items.length > 1 && (
                  <details className="mt-1 text-sm">
                    <summary className="min-h-8 py-1 text-ink-soft">Split into two bills</summary>
                    {items.map((item: any) => (
                      <label key={item.id} className="flex min-h-9 items-center gap-2">
                        <input
                          type="checkbox"
                          checked={secondBill.includes(item.id)}
                          onChange={(event) => setSecondBill(event.target.checked ? [...secondBill, item.id] : secondBill.filter((id) => id !== item.id))}
                        />
                        {item.product_name}
                      </label>
                    ))}
                  </details>
                )}
              </>
            )}

            {open && (
              <div className="mt-2.5 grid gap-1.5">
                <div className="flex flex-wrap gap-1.5">
                  {canWrite && !empty && (
                    <button className="btn btn-secondary btn-sm flex-1" disabled={change.isPending} onClick={() => hold(!current.held_at)}>
                      {current.held_at ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}
                      {current.held_at ? 'Resume' : 'Hold'}
                    </button>
                  )}
                  {canDiscount && !empty && (
                    <button className="btn btn-secondary btn-sm flex-1" onClick={() => setDialog('discount')}><Percent size={14} aria-hidden="true" /> Discount</button>
                  )}
                  {!confirmed && !empty && canWrite && (
                    <button className="btn btn-secondary btn-sm flex-1" onClick={serviceCharge}>Service charge</button>
                  )}
                </div>
                {usesKitchen && !confirmed && unsent > 0 && canWrite && (
                  <button className="btn btn-secondary w-full" disabled={change.isPending} onClick={sendOrder}>
                    <ChefHat size={16} aria-hidden="true" /> Send {unsent} to kitchen
                  </button>
                )}
                {!confirmed && !empty && canWrite && (
                  <button className="btn btn-primary w-full" disabled={change.isPending} onClick={confirmOrder}>Confirm order</button>
                )}
                {confirmed && canBill && quote.data?.bill && (
                  <button className="btn btn-brand w-full" disabled={issue.isPending} onClick={() => issue.mutate()}>
                    {issue.isPending ? 'Issuing bill…' : 'Issue bill and take payment'} <ChevronRight size={17} aria-hidden="true" />
                  </button>
                )}
                {confirmed && !canBill && <p className="text-xs text-ink-soft">A cashier will issue the bill from here.</p>}
                <div className="flex justify-center gap-3">
                  {empty && canWrite && <button className="btn btn-ghost btn-sm" disabled={change.isPending} onClick={deleteEmpty}>Delete order</button>}
                  {!empty && (confirmed ? canCancel : canWrite) && <button className="btn btn-ghost btn-sm" onClick={cancel}>Cancel order</button>}
                </div>
              </div>
            )}
          </div>
        )}
      </aside>

      {current && !empty && pane === 'menu' && (
        <button className="no-print btn btn-primary fixed inset-x-3 bottom-[4.75rem] z-20 shadow-float lg:hidden" onClick={() => setPane('order')}>
          View order · {items.length} {items.length === 1 ? 'item' : 'items'} · {money(current.after_discount)}
        </button>
      )}

      {picking && (
        <PickOptions
          product={picking}
          addons={(menu.data?.addons ?? []).filter((addon: any) => addon.is_active && picking.addon_ids.includes(addon.id))}
          onAdd={addVariant}
          onClose={() => setPicking(null)}
        />
      )}

      {dialog === 'discount' && current && (
        <DiscountDialog
          presets={settings.data?.discount_presets ?? []}
          limit={can('orders.discount') ? null : Number(settings.data?.cashier_discount_limit ?? 0)}
          onClose={() => setDialog(null)}
          onApply={(body) => {
            change.mutate(() => ({ path: '/discounts', body: { id: crypto.randomUUID(), ...body } }))
            setDialog(null)
          }}
        />
      )}

      {dialog === 'customer' && (
        <CustomerPicker
          current={current}
          canCreate={can('customers.write')}
          onClose={() => setDialog(null)}
          onPick={(customerId) => {
            change.mutate((latest) => ({ path: '', method: 'PATCH', body: { version: latest.version, customerId } }))
            setDialog(null)
          }}
        />
      )}

      {dialog === 'table' && (
        <TableDialog
          order={current}
          floor={floor.data}
          draft={draftTable}
          onClose={() => setDialog(null)}
          onPickDraft={(table) => { setDraftTable(table); setDialog(null) }}
          onSave={(body) => {
            change.mutate((latest) => ({ path: '', method: 'PATCH', body: { version: latest.version, ...body } }))
            setDialog(null)
          }}
        />
      )}

      {dialog === 'address' && (
        <AddressDialog
          value={current?.delivery_address ?? ''}
          onClose={() => setDialog(null)}
          onSave={(deliveryAddress) => {
            change.mutate((latest) => ({ path: '', method: 'PATCH', body: { version: latest.version, deliveryAddress } }))
            setDialog(null)
          }}
        />
      )}
    </div>
  )
}

function TableDialog({ order, floor, draft, onClose, onSave, onPickDraft }: {
  order?: any
  floor?: any
  draft: { id: string; name: string } | null
  onClose: () => void
  onSave: (body: object) => void
  onPickDraft: (table: { id: string; name: string } | null) => void
}) {
  const [table, setTable] = useState(order?.table_label ?? '')
  const [guests, setGuests] = useState(order?.guest_count ? String(order.guest_count) : '')
  const guestCount = guests ? Number(guests) : null
  const tables: any[] = floor?.tables ?? []
  const free = tables.filter((item) => !item.order_id || item.id === order?.table_id)

  if (tables.length > 0) {
    const pick = (item: any) => {
      if (order) onSave({ tableId: item.id, guestCount })
      else onPickDraft({ id: item.id, name: item.name })
    }
    return (
      <Modal title="Choose a table" onClose={onClose}>
        {order && (
          <label className="field mb-3">Guests<input value={guests} inputMode="numeric" onChange={(event) => setGuests(event.target.value.replace(/\D/g, '').slice(0, 3))} /></label>
        )}
        {free.length === 0 && <p className="py-3 text-sm text-ink-soft">No free tables right now.</p>}
        <ul className="grid grid-cols-3 gap-2">
          {free.map((item) => {
            const chosen = item.id === (order?.table_id ?? draft?.id)
            return (
              <li key={item.id}>
                <button className={`min-h-16 w-full rounded-xl border p-2 text-center text-sm ${chosen ? 'border-brand bg-brand-tint text-brand-deep' : 'border-line bg-white hover:border-line-strong'}`} onClick={() => pick(item)}>
                  <span className="block font-medium">{item.name}</span>
                  <span className="block text-xs text-ink-soft">{item.seats} seats</span>
                </button>
              </li>
            )
          })}
        </ul>
        {(order?.table_id || draft) && (
          <button className="btn btn-ghost btn-sm mt-3" onClick={() => (order ? onSave({ tableId: null }) : onPickDraft(null))}>Remove table</button>
        )}
      </Modal>
    )
  }

  return (
    <Modal
      title="Table and guests"
      text="Add your floor plan on the Tables page to choose from a list."
      onClose={onClose}
      footer={<button className="btn btn-primary" onClick={() => onSave({ tableLabel: table.trim(), guestCount })}>Save</button>}
    >
      <div className="grid grid-cols-2 gap-3">
        <label className="field">Table<input autoFocus value={table} maxLength={30} onChange={(event) => setTable(event.target.value)} placeholder="T4" /></label>
        <label className="field">Guests<input value={guests} inputMode="numeric" onChange={(event) => setGuests(event.target.value.replace(/\D/g, '').slice(0, 3))} /></label>
      </div>
    </Modal>
  )
}

function AddressDialog({ value, onClose, onSave }: { value: string; onClose: () => void; onSave: (value: string) => void }) {
  const [text, setText] = useState(value)
  return (
    <Modal title="Delivery address" onClose={onClose} footer={<button className="btn btn-primary" onClick={() => onSave(text.trim())}>Save address</button>}>
      <label className="field">
        Address
        <textarea autoFocus rows={3} maxLength={300} value={text} onChange={(event) => setText(event.target.value)} />
      </label>
    </Modal>
  )
}

function PickOptions({ product, addons, onAdd, onClose }: {
  product: any
  addons: any[]
  onAdd: (variant: any, addonIds: string[]) => void
  onClose: () => void
}) {
  const variants = product.variants.filter((variant: any) => variant.isAvailable)
  const [variantId, setVariantId] = useState<string>(variants[0]?.id)
  const [chosen, setChosen] = useState<string[]>([])
  const variant = variants.find((item: any) => item.id === variantId)
  const extra = addons.filter((addon) => chosen.includes(addon.id)).reduce((sum, addon) => sum + Number(addon.price), 0)

  return (
    <Modal
      title={product.name}
      onClose={onClose}
      footer={<button className="btn btn-primary w-full" onClick={() => onAdd(variant, chosen)}>Add · {money(Number(variant.price) + extra)}</button>}
    >
      <fieldset className="grid gap-1 text-sm">
        <legend className="mb-1 font-medium text-ink-mid">Size</legend>
        {variants.map((item: any) => (
          <label key={item.id} className={`flex min-h-11 items-center justify-between gap-2 rounded-lg border px-3 ${item.id === variantId ? 'border-brand bg-brand-tint' : 'border-line'}`}>
            <span className="flex items-center gap-2"><input type="radio" name="size" checked={item.id === variantId} onChange={() => setVariantId(item.id)} /> {item.name}</span>
            <span className="tnum">{money(item.price)}</span>
          </label>
        ))}
      </fieldset>
      {addons.length > 0 && (
        <fieldset className="mt-3 grid gap-1 text-sm">
          <legend className="mb-1 font-medium text-ink-mid">Add-ons</legend>
          {addons.map((addon) => (
            <label key={addon.id} className={`flex min-h-11 items-center justify-between gap-2 rounded-lg border px-3 ${chosen.includes(addon.id) ? 'border-brand bg-brand-tint' : 'border-line'}`}>
              <span className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={chosen.includes(addon.id)}
                  onChange={(event) => setChosen(event.target.checked ? [...chosen, addon.id] : chosen.filter((id) => id !== addon.id))}
                />
                {addon.name}
              </span>
              <span className="tnum">+{money(addon.price)}</span>
            </label>
          ))}
        </fieldset>
      )}
    </Modal>
  )
}
