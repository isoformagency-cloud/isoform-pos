import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Boxes, Plus, Search } from 'lucide-react'
import type { Me } from '../App'
import { ChooseBranch, useWorkingBranch } from '../components/BranchPicker'
import { Badge, Empty, Modal, Notice, PageHeader, Segmented } from '../components/ui'
import { api } from '../lib/api'
import { dateTime, localDate, money } from '../lib/format'

const UNITS = ['kg', 'g', 'L', 'ml', 'pcs', 'pack', 'box', 'dozen']
const MOVE_NAMES: Record<string, string> = { in: 'Stock in', out: 'Stock out', count: 'Count', sale: 'Sale' }
const METHODS: Record<string, string> = { cash: 'Cash', upi: 'UPI', card: 'Card', bank_transfer: 'Bank transfer', cheque: 'Cheque', other: 'Other' }

const amount = (value: string) => Number(value).toLocaleString('en-IN', { maximumFractionDigits: 3 })
const stateOf = (item: any) => (Number(item.quantity) <= 0 ? 'out' : Number(item.quantity) <= Number(item.min_stock) ? 'low' : 'ok')

function Stat({ label, value, note, tone }: { label: string; value: string | number; note?: string; tone?: string }) {
  return (
    <div className="card p-4">
      <p className="text-sm text-ink-soft">{label}</p>
      <p className={`tnum mt-1 font-display text-2xl font-semibold tracking-tight ${tone ?? ''}`}>{value}</p>
      {note && <p className="mt-0.5 text-xs text-ink-soft">{note}</p>}
    </div>
  )
}

export function Inventory({ me }: { me: Me }) {
  const branch = useWorkingBranch(me)
  const queryClient = useQueryClient()
  const [tab, setTab] = useState('stock')
  const [filter, setFilter] = useState('all')
  const [text, setText] = useState('')
  const [editing, setEditing] = useState<any | 'new' | null>(null)
  const [moving, setMoving] = useState<{ item: any; kind: 'in' | 'out' | 'count' } | null>(null)
  const [supplier, setSupplier] = useState(false)
  const canWrite = me.permissions.includes('inventory.write')
  const canExpense = me.permissions.includes('expenses.write')

  const stock = useQuery({ queryKey: ['inventory', branch], queryFn: () => api('/inventory', { branch: true }), enabled: Boolean(branch) })
  const moves = useQuery({ queryKey: ['inventory', 'moves', branch], queryFn: () => api('/inventory/moves', { branch: true }), enabled: Boolean(branch) && tab === 'history' })
  const suppliers = useQuery({ queryKey: ['inventory', 'suppliers'], queryFn: () => api('/suppliers') })
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['inventory'] })
    queryClient.invalidateQueries({ queryKey: ['alerts'] })
    queryClient.invalidateQueries({ queryKey: ['expenses'] })
  }

  if (!branch) return <ChooseBranch title="Inventory" />

  const items: any[] = stock.data?.items ?? []
  const totals = stock.data?.totals
  const shown = items.filter((item) =>
    (filter === 'all' || stateOf(item) === filter) && `${item.name} ${item.supplier_name ?? ''}`.toLowerCase().includes(text.trim().toLowerCase()))
  const categories = [...new Set(items.map((item) => item.category))]

  return (
    <>
      <PageHeader
        title="Inventory"
        text="Stock levels for ingredients and packaging. Sales take recipe quantities off automatically."
        action={canWrite && (
          <div className="flex flex-wrap gap-2">
            {tab === 'suppliers'
              ? <button className="btn btn-primary" onClick={() => setSupplier(true)}><Plus size={16} aria-hidden="true" /> Add supplier</button>
              : <button className="btn btn-primary" onClick={() => setEditing('new')}><Plus size={16} aria-hidden="true" /> Add ingredient</button>}
          </div>
        )}
      />

      {totals && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Items tracked" value={totals.items} note={`${categories.length} ${categories.length === 1 ? 'category' : 'categories'}`} />
          <Stat label="Low stock" value={totals.low} note="At or below minimum" tone={totals.low ? 'text-wait' : ''} />
          <Stat label="Out of stock" value={totals.out} tone={totals.out ? 'text-bad' : ''} />
          <Stat label="Stock value" value={money(totals.value)} note="At last cost price" />
        </div>
      )}

      <div className="mb-3">
        <Segmented
          label="Inventory view"
          value={tab}
          options={[
            { value: 'stock', label: 'Stock', count: items.length },
            { value: 'history', label: 'History' },
            { value: 'suppliers', label: 'Suppliers', count: suppliers.data?.items.length },
          ]}
          onChange={setTab}
        />
      </div>

      {tab === 'stock' && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <label className="relative min-w-48 flex-1 sm:max-w-xs">
              <span className="sr-only">Search stock</span>
              <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-faint" aria-hidden="true" />
              <input value={text} onChange={(event) => setText(event.target.value)} className="input !min-h-10 !pl-9 !text-sm" placeholder="Ingredient or supplier" />
            </label>
            <label>
              <span className="sr-only">Stock level</span>
              <select className="input !min-h-10 !w-auto !text-sm" value={filter} onChange={(event) => setFilter(event.target.value)}>
                <option value="all">All levels</option>
                <option value="low">Low stock</option>
                <option value="out">Out of stock</option>
              </select>
            </label>
          </div>

          {stock.error && <Notice>{stock.error.message}</Notice>}
          {stock.isPending && <p className="py-6 text-sm text-ink-soft">Loading stock…</p>}
          {stock.data && shown.length === 0 && (
            <Empty
              icon={Boxes}
              title={items.length ? 'Nothing matches that.' : 'No ingredients yet'}
              text={items.length ? undefined : 'Add your ingredients, then link them to menu items so sales update stock for you.'}
            />
          )}

          {shown.length > 0 && (
            <div className="card overflow-x-auto">
              <table className="data-table min-w-[44rem]">
                <thead><tr><th>Ingredient</th><th>Current stock</th><th className="!text-right">Minimum</th><th className="!text-right">Cost</th><th>Supplier</th>{canWrite && <th><span className="sr-only">Actions</span></th>}</tr></thead>
                <tbody>
                  {shown.map((item) => {
                    const state = stateOf(item)
                    return (
                      <tr key={item.id}>
                        <td>
                          {canWrite ? <button className="font-medium hover:underline" onClick={() => setEditing(item)}>{item.name}</button> : <span className="font-medium">{item.name}</span>}
                          <span className="block text-xs text-ink-soft">{item.category}</span>
                        </td>
                        <td className="whitespace-nowrap">
                          <span className="tnum font-medium">{amount(item.quantity)} {item.unit}</span>
                          {state === 'low' && <span className="ml-2"><Badge tone="wait">Low</Badge></span>}
                          {state === 'out' && <span className="ml-2"><Badge tone="bad">Out</Badge></span>}
                        </td>
                        <td className="tnum text-right text-ink-soft">{amount(item.min_stock)} {item.unit}</td>
                        <td className="tnum text-right whitespace-nowrap">{money(item.cost)}/{item.unit}</td>
                        <td className="max-w-36 truncate text-ink-soft">{item.supplier_name ?? '—'}</td>
                        {canWrite && (
                          <td className="whitespace-nowrap text-right">
                            <button className="btn btn-secondary btn-sm" onClick={() => setMoving({ item, kind: 'in' })}>In</button>{' '}
                            <button className="btn btn-secondary btn-sm" onClick={() => setMoving({ item, kind: 'out' })}>Out</button>{' '}
                            <button className="btn btn-ghost btn-sm" onClick={() => setMoving({ item, kind: 'count' })}>Count</button>
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {tab === 'history' && (
        <>
          {moves.error && <Notice>{moves.error.message}</Notice>}
          {moves.isPending && <p className="py-6 text-sm text-ink-soft">Loading history…</p>}
          {moves.data?.items.length === 0 && <Empty icon={Boxes} title="No stock changes yet" />}
          {moves.data?.items.length > 0 && (
            <div className="card overflow-x-auto">
              <table className="data-table min-w-[40rem]">
                <thead><tr><th>When</th><th>Item</th><th>Change</th><th className="!text-right">Quantity</th><th>Details</th><th>By</th></tr></thead>
                <tbody>
                  {moves.data.items.map((move: any) => (
                    <tr key={move.id}>
                      <td className="whitespace-nowrap text-ink-soft">{dateTime(move.created_at)}</td>
                      <td className="font-medium">{move.item_name}</td>
                      <td>{MOVE_NAMES[move.kind]}</td>
                      <td className={`tnum text-right font-medium ${Number(move.quantity) < 0 ? 'text-bad' : 'text-ok'}`}>{Number(move.quantity) > 0 ? '+' : ''}{amount(move.quantity)} {move.unit}</td>
                      <td className="max-w-48 truncate text-ink-soft">{move.reason ?? move.supplier_name ?? (move.display_number ? `Order #${move.display_number}` : '')}</td>
                      <td className="text-ink-soft">{move.created_by_name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {tab === 'suppliers' && (
        <>
          {suppliers.data?.items.length === 0 && <Empty icon={Boxes} title="No suppliers yet" />}
          {suppliers.data?.items.length > 0 && (
            <ul className="card divide-y divide-line-soft overflow-hidden">
              {suppliers.data.items.map((row: any) => (
                <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 p-4">
                  <span>
                    <span className="block font-medium">{row.name}</span>
                    <span className="tnum block text-sm text-ink-soft">{row.phone ?? 'No phone'}{row.notes ? ` · ${row.notes}` : ''}</span>
                  </span>
                  <Badge>{row.item_count} {row.item_count === 1 ? 'item' : 'items'}</Badge>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {editing && (
        <ItemForm
          item={editing === 'new' ? null : editing}
          categories={categories}
          suppliers={suppliers.data?.items ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refresh() }}
        />
      )}
      {moving && (
        <MoveForm
          {...moving}
          suppliers={suppliers.data?.items ?? []}
          canExpense={canExpense}
          onClose={() => setMoving(null)}
          onSaved={() => { setMoving(null); refresh() }}
        />
      )}
      {supplier && <SupplierForm onClose={() => setSupplier(false)} onSaved={() => { setSupplier(false); refresh() }} />}
    </>
  )
}

function ItemForm({ item, categories, suppliers, onClose, onSaved }: { item: any | null; categories: string[]; suppliers: any[]; onClose: () => void; onSaved: () => void }) {
  const save = useMutation({
    mutationFn: (body: object) => (item ? api(`/inventory/items/${item.id}`, { method: 'PATCH', body }) : api('/inventory/items', { method: 'POST', body })),
    onSuccess: onSaved,
  })

  return (
    <Modal title={item ? `Edit ${item.name}` : 'Add ingredient'} onClose={onClose}>
      <form
        className="grid grid-cols-2 gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          const form = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>
          const shared = { name: form.name.trim(), category: form.category.trim(), cost: form.cost || '0', minStock: form.minStock || '0' }
          save.mutate(item
            ? { ...shared, supplierId: form.supplierId || null }
            : { ...shared, unit: form.unit, supplierId: form.supplierId || undefined })
        }}
      >
        <label className="field col-span-2">Ingredient<input name="name" required minLength={2} maxLength={120} defaultValue={item?.name} placeholder="Coffee beans" /></label>
        <label className="field">
          Category
          <input name="category" list="stock-categories" required minLength={2} maxLength={40} defaultValue={item?.category ?? ''} placeholder="Dairy" />
          <datalist id="stock-categories">{categories.map((name) => <option key={name} value={name} />)}</datalist>
        </label>
        <label className="field">
          Unit
          <select name="unit" defaultValue={item?.unit ?? 'kg'} disabled={Boolean(item)}>
            {UNITS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
          </select>
        </label>
        <label className="field">Cost per unit<input name="cost" inputMode="decimal" pattern="\d+(\.\d{1,2})?" defaultValue={item?.cost ?? ''} /></label>
        <label className="field">Minimum stock<input name="minStock" inputMode="decimal" pattern="\d+(\.\d{1,3})?" defaultValue={item ? Number(item.min_stock) : ''} /></label>
        <label className="field col-span-2">
          Supplier
          <select name="supplierId" defaultValue={item?.supplier_id ?? ''}>
            <option value="">No supplier</option>
            {suppliers.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
        </label>
        {save.error && <div className="col-span-2"><Notice>{save.error.message}</Notice></div>}
        <button className="btn btn-primary col-span-2" disabled={save.isPending}>{item ? 'Save ingredient' : 'Add ingredient'}</button>
        {item && <button type="button" className="btn btn-ghost col-span-2" disabled={save.isPending} onClick={() => save.mutate({ isActive: false })}>Stop tracking this ingredient</button>}
      </form>
    </Modal>
  )
}

function MoveForm({ item, kind, suppliers, canExpense, onClose, onSaved }: {
  item: any
  kind: 'in' | 'out' | 'count'
  suppliers: any[]
  canExpense: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const [asExpense, setAsExpense] = useState(false)
  const [method, setMethod] = useState('upi')
  const save = useMutation({
    mutationFn: (body: object) => api(`/inventory/items/${item.id}/moves`, { method: 'POST', branch: true, body }),
    onSuccess: onSaved,
  })
  const title = { in: `Stock in: ${item.name}`, out: `Stock out: ${item.name}`, count: `Count ${item.name}` }[kind]

  return (
    <Modal title={title} text={`Now ${amount(item.quantity)} ${item.unit}`} onClose={onClose}>
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          const form = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>
          save.mutate({
            kind,
            quantity: form.quantity,
            ...(form.reason ? { reason: form.reason } : {}),
            ...(kind === 'in' && form.unitCost ? { unitCost: form.unitCost } : {}),
            ...(kind === 'in' && form.supplierId ? { supplierId: form.supplierId } : {}),
            ...(kind === 'in' && asExpense ? {
              expense: { id: crypto.randomUUID(), method, expenseDate: localDate(), fromDrawer: method === 'cash' && form.fromDrawer === 'on' },
            } : {}),
          })
        }}
      >
        <label className="field">
          {kind === 'count' ? `Counted quantity (${item.unit})` : `Quantity (${item.unit})`}
          <input name="quantity" required inputMode="decimal" pattern="\d+(\.\d{1,3})?" title="A quantity such as 2 or 2.5" />
        </label>
        {kind === 'in' && (
          <>
            <label className="field">Cost per {item.unit}<input name="unitCost" inputMode="decimal" pattern="\d+(\.\d{1,2})?" defaultValue={item.cost} /></label>
            <label className="field">
              Supplier
              <select name="supplierId" defaultValue={item.supplier_id ?? ''}>
                <option value="">No supplier</option>
                {suppliers.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
              </select>
            </label>
            {canExpense && (
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input type="checkbox" checked={asExpense} onChange={(event) => setAsExpense(event.target.checked)} /> Also record this purchase as an expense
              </label>
            )}
            {asExpense && (
              <label className="field">
                Paid by
                <select value={method} onChange={(event) => setMethod(event.target.value)}>
                  {Object.entries(METHODS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
            )}
            {asExpense && method === 'cash' && (
              <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="fromDrawer" defaultChecked /> Taken from the cash drawer</label>
            )}
          </>
        )}
        {kind !== 'in' && (
          <label className="field">
            Reason{kind === 'count' ? ' (optional)' : ''}
            <input name="reason" required={kind === 'out'} minLength={kind === 'out' ? 2 : undefined} maxLength={200} placeholder={kind === 'out' ? 'Spoiled, spilled, staff meal' : 'Weekly count'} />
          </label>
        )}
        {save.error && <Notice>{save.error.message}</Notice>}
        <button className="btn btn-primary" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save'}</button>
      </form>
    </Modal>
  )
}

function SupplierForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const save = useMutation({ mutationFn: (body: object) => api('/suppliers', { method: 'POST', body }), onSuccess: onSaved })

  return (
    <Modal title="Add supplier" onClose={onClose}>
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          const form = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>
          save.mutate({ name: form.name.trim(), ...(form.phone ? { phone: form.phone } : {}), ...(form.notes ? { notes: form.notes } : {}) })
        }}
      >
        <label className="field">Supplier name<input name="name" required minLength={2} maxLength={120} /></label>
        <label className="field">Mobile (optional)<input name="phone" inputMode="numeric" pattern="\d{10}" title="10 digits" /></label>
        <label className="field">Notes (optional)<input name="notes" maxLength={300} /></label>
        {save.error && <Notice>{save.error.message}</Notice>}
        <button className="btn btn-primary" disabled={save.isPending}>Save supplier</button>
      </form>
    </Modal>
  )
}
