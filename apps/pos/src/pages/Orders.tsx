import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Minus, Plus, Trash2 } from 'lucide-react'
import { useNavigate } from 'react-router'
import type { Me } from '../App'
import { useAsk } from '../components/Ask'
import { Loading, Notice, PageHeader } from '../components/ui'
import { activeBranch, api, ApiError } from '../lib/api'

const TYPES = [
  ['dine_in', 'Dine-in'],
  ['takeaway', 'Takeaway'],
  ['delivery', 'Delivery'],
  ['aggregator', 'Delivery app'],
] as const

const typeName = (type: string) => TYPES.find(([value]) => value === type)?.[1] ?? type
const money = (value: string) => `₹${value}`
const stepped = (order: any, itemId: string, step: number) =>
  String(Math.max(1, Number(order.items.find((item: any) => item.id === itemId).quantity) + step))

export function Orders({ me }: { me: Me }) {
  const queryClient = useQueryClient()
  const branch = activeBranch() ?? (me.branchIds.length === 1 ? me.branchIds[0] : null)
  const [orderId, setOrderId] = useState<string | null>(null)
  const [category, setCategory] = useState<string | null>(null)
  const [picking, setPicking] = useState<any | null>(null)
  const [error, setError] = useState('')
  const { ask, node } = useAsk()
  const navigate = useNavigate()
  const [billing, setBilling] = useState(false)
  const [secondBill, setSecondBill] = useState<string[]>([])
  const canBill = me.permissions.includes('billing.write')
  const canWrite = me.permissions.includes('orders.write')
  const canDiscount = me.permissions.includes('orders.discount')

  const list = useQuery({ queryKey: ['orders', branch], queryFn: () => api('/orders?status=open'), enabled: Boolean(branch), refetchInterval: 15000 })
  const menu = useQuery({ queryKey: ['menu', branch], queryFn: () => api(`/menu?branchId=${branch}`), enabled: Boolean(branch) })
  const order = useQuery({ queryKey: ['order', orderId], queryFn: () => api(`/orders/${orderId}`), enabled: Boolean(orderId) })

  const quote = useQuery({
    queryKey: ['quote', orderId, order.data?.version],
    queryFn: () => api(`/orders/${orderId}/quote`),
    enabled: billing && Boolean(orderId),
  })

  const issue = useMutation({
    mutationFn: () => {
      const items = order.data.items.filter((item: any) => item.status === 'active')
      const part = (list: any[]) => ({ id: crypto.randomUUID(), items: list.map((item) => ({ orderItemId: item.id, quantity: item.quantity })) })
      const second = items.filter((item: any) => secondBill.includes(item.id))
      const first = items.filter((item: any) => !secondBill.includes(item.id))
      return api(`/orders/${orderId}/finalize`, {
        method: 'POST',
        body: { version: order.data.version, invoices: second.length && first.length ? [part(first), part(second)] : [part(items)] },
      })
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['orders'] })
      queryClient.invalidateQueries({ queryKey: ['invoices'] })
      navigate(data.invoices.length === 1 ? `/invoices/${data.invoices[0].id}` : '/invoices')
    },
    onError: (failure) => {
      setError(failure.message)
      queryClient.invalidateQueries({ queryKey: ['order', orderId] })
    },
  })

  const refreshList = () => queryClient.invalidateQueries({ queryKey: ['orders'] })

  // Changes run one at a time, and each reads the newest order when it starts, so quick taps all count.
  const change = useMutation({
    scope: { id: 'order-change' },
    mutationFn: ({ path, method = 'POST', body }: { path: string; method?: string; body?: (latest: any) => object }) => {
      const latest = queryClient.getQueryData<any>(['order', orderId])
      return api(`/orders/${orderId}${path}`, { method, body: body?.(latest) })
    },
    onSuccess: (data) => {
      setError('')
      queryClient.setQueryData(['order', data.id], data)
      refreshList()
    },
    onError: (failure) => {
      setError(failure.message)
      if (failure instanceof ApiError && failure.code === 'stale_order') queryClient.invalidateQueries({ queryKey: ['order', orderId] })
    },
  })

  const start = useMutation({
    mutationFn: (body: object) => api('/orders', { method: 'POST', body: { id: crypto.randomUUID(), ...body } }),
    onSuccess: (data) => {
      queryClient.setQueryData(['order', data.id], data)
      setOrderId(data.id)
      setError('')
      refreshList()
    },
    onError: (failure) => setError(failure.message),
  })

  const current = order.data

  if (!branch) {
    return (
      <>
        <PageHeader title="Orders" />
        <Notice>Choose a branch from the menu to take orders.</Notice>
      </>
    )
  }

  async function newOrder(type: string) {
    if (type === 'aggregator') {
      const answer = await ask('Delivery app order', [
        { name: 'app', label: 'Delivery app', required: true, defaultValue: 'Swiggy' },
        { name: 'reference', label: 'Their order number' },
      ], 'Start order')
      if (answer) start.mutate({ orderType: type, aggregator: answer.app, aggregatorReference: answer.reference || undefined })
      return
    }
    if (type === 'dine_in') {
      const answer = await ask('Dine-in order', [{ name: 'table', label: 'Table (optional)' }], 'Start order')
      if (answer) start.mutate({ orderType: type, tableLabel: answer.table || undefined })
      return
    }
    start.mutate({ orderType: type })
  }

  function addVariant(variant: any, addonIds: string[] = []) {
    const same = order.data?.items.find((item: any) => item.variant_id === variant.id && item.status === 'active' && item.addons.length === 0)
    if (same && addonIds.length === 0) {
      change.mutate({
        path: `/items/${same.id}`,
        method: 'PATCH',
        body: (latest) => ({ version: latest.version, quantity: stepped(latest, same.id, 1) }),
      })
    } else {
      change.mutate({ path: '/items', body: () => ({ id: crypto.randomUUID(), variantId: variant.id, addonIds }) })
    }
    setPicking(null)
  }

  function tapProduct(product: any) {
    const variants = product.variants.filter((variant: any) => variant.isAvailable)
    if (variants.length === 1 && product.addon_ids.length === 0) addVariant(variants[0])
    else setPicking(product)
  }

  async function discount() {
    const answer = await ask('Add a discount', [
      { name: 'value', label: 'Rupees, or a percentage such as 10%', required: true },
      { name: 'reason', label: 'Reason', required: true },
    ], 'Apply')
    if (!answer) return
    const kind = answer.value.includes('%') ? 'percent' : 'amount'
    const value = answer.value.replace('%', '').trim()
    change.mutate({ path: '/discounts', body: () => ({ id: crypto.randomUUID(), kind, value, reason: answer.reason }) })
  }

  async function serviceCharge() {
    const answer = await ask('Voluntary service charge', [
      { name: 'percent', label: 'Percent (use 0 to remove)', required: true, defaultValue: current?.service_charge_percent ?? '0', inputMode: 'decimal' },
    ], 'Save')
    if (answer) change.mutate({ path: '', method: 'PATCH', body: (latest) => ({ version: latest.version, serviceChargePercent: answer.percent }) })
  }

  async function customer() {
    const answer = await ask('Who is this bill for?', [
      { name: 'name', label: 'Name', required: true, defaultValue: current?.customer_name ?? '' },
      { name: 'phone', label: '10-digit mobile', required: true, inputMode: 'numeric' },
    ], 'Save')
    if (!answer) return
    try {
      const saved = await api('/customers', { method: 'POST', body: answer })
      change.mutate({ path: '', method: 'PATCH', body: (latest) => ({ version: latest.version, customerId: saved.id }) })
    } catch (failure) {
      setError((failure as Error).message)
    }
  }

  async function issueBill() {
    if (await ask('Issue this bill?', [], 'Issue bill')) issue.mutate()
  }

  async function remove(item: any) {
    const answer = await ask(`Remove ${item.product_name}?`, [{ name: 'reason', label: 'Reason', required: true }], 'Remove')
    if (answer) change.mutate({ path: `/items/${item.id}/void`, body: (latest) => ({ version: latest.version, reason: answer.reason }) })
  }

  async function cancel() {
    const answer = await ask('Cancel this order?', [{ name: 'reason', label: 'Reason', required: true }], 'Cancel order')
    if (answer) change.mutate({ path: '/cancel', body: (latest) => ({ version: latest.version, reason: answer.reason }) }, { onSuccess: () => setOrderId(null) })
  }

  const products = (menu.data?.products ?? []).filter((product: any) => product.is_active && (!category || product.category_id === category))
  const categories = (menu.data?.categories ?? []).filter((item: any) => item.is_active)
  const open = current?.status === 'open'

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_22rem]">
      {node}
      <div className="min-w-0">
        <PageHeader
          title="Orders"
          action={canWrite && (
            <div className="flex flex-wrap gap-2">
              {TYPES.map(([value, label]) => (
                <button key={value} className="btn btn-secondary" disabled={start.isPending} onClick={() => newOrder(value)}>{label}</button>
              ))}
            </div>
          )}
        />

        <Loading ready={!list.isPending} error={list.error}>
          <ul className="mb-5 flex gap-2 overflow-x-auto pb-1">
            {list.data?.items.length === 0 && <li className="text-sm text-ink-soft">No open orders. Start one above.</li>}
            {list.data?.items.map((item: any) => (
              <li key={item.id}>
                <button
                  aria-pressed={item.id === orderId}
                  className={`min-h-14 min-w-28 rounded-xl border px-3 py-1.5 text-left text-sm ${item.id === orderId ? 'border-ink bg-ink text-white' : 'border-line'}`}
                  onClick={() => setOrderId(item.id)}
                >
                  <span className="font-mono">#{item.display_number}</span> {item.table_label}
                  <span className="block text-xs opacity-75">{typeName(item.order_type)} · {item.item_count} items</span>
                </button>
              </li>
            ))}
          </ul>
        </Loading>

        {current && open && canWrite && (
          <>
            <div className="mb-3 flex gap-2 overflow-x-auto pb-1 text-sm">
              <button className={`btn !min-h-10 ${!category ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setCategory(null)}>All</button>
              {categories.map((item: any) => (
                <button key={item.id} className={`btn !min-h-10 ${category === item.id ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setCategory(item.id)}>{item.name}</button>
              ))}
            </div>
            {products.length === 0 && <p className="text-ink-soft">No items here yet. Add them on the Menu page.</p>}
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {products.map((product: any) => {
                const available = product.variants.some((variant: any) => variant.isAvailable)
                return (
                  <li key={product.id}>
                    <button
                      disabled={!available || change.isPending}
                      className="card min-h-20 w-full p-3 text-left disabled:opacity-50"
                      onClick={() => tapProduct(product)}
                    >
                      <span className="block font-medium">{product.name}</span>
                      <span className="font-mono text-sm text-ink-soft">{available ? money(product.variants.find((v: any) => v.isAvailable).price) : 'Sold out'}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </div>

      <aside className="card self-start p-4 xl:sticky xl:top-5">
        {!current && <p className="text-ink-soft">Select or start an order.</p>}
        {current && (
          <>
            <p className="text-sm text-ink-soft">{typeName(current.order_type)}{current.aggregator ? ` · ${current.aggregator}` : ''}</p>
            <h2 className="text-xl">Order #{current.display_number}{current.table_label ? ` · ${current.table_label}` : ''}</h2>

            {error && <div className="mt-3"><Notice>{error}</Notice></div>}

            {picking && (
              <PickOptions
                product={picking}
                addons={(menu.data?.addons ?? []).filter((addon: any) => addon.is_active && picking.addon_ids.includes(addon.id))}
                onAdd={(variant, addonIds) => addVariant(variant, addonIds)}
                onClose={() => setPicking(null)}
              />
            )}

            <ul className="mt-3 divide-y divide-line">
              {current.items.filter((item: any) => item.status === 'active').length === 0 && <li className="py-3 text-sm text-ink-soft">No items yet.</li>}
              {current.items.filter((item: any) => item.status === 'active').map((item: any) => (
                <li key={item.id} className="py-2.5 text-sm">
                  <div className="flex justify-between gap-3">
                    <span className="font-medium">{item.product_name}{item.variant_name !== 'Regular' ? ` · ${item.variant_name}` : ''}</span>
                    <span className="font-mono">{money(item.line_total)}</span>
                  </div>
                  {item.addons.map((addon: any) => <p key={addon.id} className="text-xs text-ink-soft">+ {addon.name}</p>)}
                  {open && canWrite && (
                    <div className="mt-1 flex items-center gap-1">
                      <button
                        aria-label={`One less ${item.product_name}`}
                        className="btn btn-secondary !min-h-10 !px-3"
                        disabled={Number(item.quantity) <= 1}
                        onClick={() => change.mutate({ path: `/items/${item.id}`, method: 'PATCH', body: (latest) => ({ version: latest.version, quantity: stepped(latest, item.id, -1) }) })}
                      >
                        <Minus size={14} aria-hidden="true" />
                      </button>
                      <span className="w-8 text-center font-mono">{Number(item.quantity)}</span>
                      <button
                        aria-label={`One more ${item.product_name}`}
                        className="btn btn-secondary !min-h-10 !px-3"
                        onClick={() => change.mutate({ path: `/items/${item.id}`, method: 'PATCH', body: (latest) => ({ version: latest.version, quantity: stepped(latest, item.id, 1) }) })}
                      >
                        <Plus size={14} aria-hidden="true" />
                      </button>
                      <button aria-label={`Remove ${item.product_name}`} className="btn !min-h-10 ml-auto !px-3 text-ink-soft" onClick={() => remove(item)}>
                        <Trash2 size={15} aria-hidden="true" />
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>

            <dl className="mt-2 space-y-1 border-t border-line pt-3 font-mono text-sm">
              <div className="flex justify-between"><dt>Subtotal</dt><dd>{money(current.subtotal)}</dd></div>
              {current.discounts.map((item: any) => (
                <div key={item.id} className="flex justify-between gap-2 text-ink-soft">
                  <dt>Discount ({item.kind === 'percent' ? `${Number(item.value)}%` : money(item.value)})</dt>
                  {open && canDiscount && (
                    <dd><button className="underline" onClick={() => change.mutate({ path: `/discounts/${item.id}`, method: 'DELETE' })}>Remove</button></dd>
                  )}
                </div>
              ))}
              <div className="flex justify-between font-medium"><dt>Before tax</dt><dd>{money(current.after_discount)}</dd></div>
            </dl>
            <p className="mt-1 text-xs text-ink-soft">Tax is added when the bill is created.</p>

            {open && (
              <div className="mt-3 flex flex-wrap gap-2">
                {canBill && <button className="btn btn-primary w-full" disabled={Number(current.subtotal) === 0} onClick={() => setBilling(!billing)}>{billing ? 'Hide bill' : 'Create bill'}</button>}
                {canDiscount && <button className="btn btn-secondary" onClick={discount}>Discount</button>}
                {canWrite && <button className="btn btn-secondary" onClick={serviceCharge}>Service charge</button>}
                {canBill && <button className="btn btn-secondary" onClick={customer}>{current.customer_name ?? 'Add customer'}</button>}
                {canWrite && <button className="btn btn-secondary" onClick={cancel}>Cancel order</button>}
              </div>
            )}

            {open && billing && (
              <section className="mt-3 rounded-xl bg-paper-soft p-3 ring-1 ring-line">
                {quote.error && <Notice>{quote.error.message}</Notice>}
                {quote.isPending && <p className="text-sm text-ink-soft">Calculating…</p>}
                {quote.data?.bill && (
                  <>
                    <dl className="space-y-1 font-mono text-sm">
                      <div className="flex justify-between"><dt>Taxable value</dt><dd>{money(quote.data.bill.taxableTotal)}</dd></div>
                      <div className="flex justify-between"><dt>CGST</dt><dd>{money(quote.data.bill.cgstTotal)}</dd></div>
                      <div className="flex justify-between"><dt>SGST</dt><dd>{money(quote.data.bill.sgstTotal)}</dd></div>
                      {Number(quote.data.bill.roundOff) !== 0 && <div className="flex justify-between"><dt>Round off</dt><dd>{quote.data.bill.roundOff}</dd></div>}
                      <div className="flex justify-between border-t border-ink pt-1 text-base font-semibold"><dt>Total</dt><dd>{money(quote.data.bill.grandTotal)}</dd></div>
                    </dl>
                    {current.items.filter((item: any) => item.status === 'active').length > 1 && (
                      <fieldset className="mt-2 border-t border-line pt-2 text-sm">
                        <legend className="text-xs text-ink-soft">Split: tick items for a second bill</legend>
                        {current.items.filter((item: any) => item.status === 'active').map((item: any) => (
                          <label key={item.id} className="flex min-h-10 items-center gap-2">
                            <input
                              type="checkbox"
                              checked={secondBill.includes(item.id)}
                              onChange={(event) => setSecondBill(event.target.checked ? [...secondBill, item.id] : secondBill.filter((id) => id !== item.id))}
                            />
                            {item.product_name}
                          </label>
                        ))}
                      </fieldset>
                    )}
                    <button className="btn btn-primary mt-2 w-full" disabled={issue.isPending} onClick={issueBill}>
                      {issue.isPending ? 'Issuing…' : 'Issue bill'}
                    </button>
                  </>
                )}
              </section>
            )}
          </>
        )}
      </aside>
    </div>
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

  return (
    <div className="mt-3 rounded-xl bg-paper-soft p-3 ring-1 ring-line">
      <p className="font-medium">{product.name}</p>
      <fieldset className="mt-2 grid gap-1 text-sm">
        <legend className="sr-only">Size</legend>
        {variants.map((variant: any) => (
          <label key={variant.id} className="flex min-h-10 items-center justify-between gap-2">
            <span><input type="radio" name="size" checked={variant.id === variantId} onChange={() => setVariantId(variant.id)} /> {variant.name}</span>
            <span className="font-mono">{money(variant.price)}</span>
          </label>
        ))}
      </fieldset>
      {addons.length > 0 && (
        <fieldset className="mt-2 grid gap-1 border-t border-line pt-2 text-sm">
          <legend className="sr-only">Add-ons</legend>
          {addons.map((addon) => (
            <label key={addon.id} className="flex min-h-10 items-center justify-between gap-2">
              <span>
                <input
                  type="checkbox"
                  checked={chosen.includes(addon.id)}
                  onChange={(event) => setChosen(event.target.checked ? [...chosen, addon.id] : chosen.filter((id) => id !== addon.id))}
                /> {addon.name}
              </span>
              <span className="font-mono">+{money(addon.price)}</span>
            </label>
          ))}
        </fieldset>
      )}
      <div className="mt-2 flex gap-2">
        <button className="btn btn-primary flex-1" onClick={() => onAdd(variants.find((v: any) => v.id === variantId), chosen)}>Add</button>
        <button className="btn btn-secondary" onClick={onClose}>Close</button>
      </div>
    </div>
  )
}
