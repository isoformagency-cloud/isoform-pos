import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Copy, ImagePlus, Search, UtensilsCrossed } from 'lucide-react'
import type { Me } from '../App'
import { useAsk } from '../components/Ask'
import { useWorkingBranch } from '../components/BranchPicker'
import { CATEGORY_ICONS, CATEGORY_ICON_NAMES } from '../components/order-look'
import { RecipeDialog } from '../components/RecipeDialog'
import { Badge, Empty, FoodMark, Loading, Modal, Notice, PageHeader, Segmented } from '../components/ui'
import { api, menuPhoto, supabase } from '../lib/api'
import { shrink } from '../lib/photo'

interface Variant {
  id: string
  name: string
  price: string
  menuPrice: string
  hasBranchPrice: boolean
  isAvailable: boolean
  isActive: boolean
}

type Panel = 'product' | 'rate' | 'categories' | 'addons' | null
type Show = 'all' | 'available' | 'sold_out' | 'hidden'

const FOOD_TYPES = [['veg', 'Veg'], ['non_veg', 'Non-veg'], ['egg', 'Egg'], ['none', 'Not applicable']]

const soldOut = (product: any) => product.is_active && product.variants.every((variant: Variant) => !variant.isAvailable)

async function uploadPhoto(productId: string, file: File) {
  const blob = await shrink(file, 600)
  const { path, token } = await api(`/products/${productId}/photo`, { method: 'POST' })
  const { error } = await supabase.storage.from('menu-photos').uploadToSignedUrl(path, token, blob, { contentType: 'image/jpeg' })
  if (error) throw new Error('The photo could not be uploaded.')
  await api(`/products/${productId}`, { method: 'PATCH', body: { imagePath: path } })
}

function ItemDialog({ product, data, onClose }: { product: any; data: any; onClose: () => void }) {
  const queryClient = useQueryClient()
  const save = useMutation({
    mutationFn: (body: object) => api(`/products/${product.id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['menu'] })
      onClose()
    },
  })
  const photo = useMutation({
    mutationFn: (file: File | null) => (file ? uploadPhoto(product.id, file) : api(`/products/${product.id}`, { method: 'PATCH', body: { imagePath: '' } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['menu'] }),
  })
  const shown = data.products.find((item: any) => item.id === product.id) ?? product

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>
    save.mutate({ name: form.name, description: form.description, categoryId: form.categoryId, foodType: form.foodType })
  }

  return (
    <Modal
      title={`Edit ${product.name}`}
      onClose={onClose}
      footer={<button form="item-form" className="btn btn-primary" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save'}</button>}
    >
      <form id="item-form" onSubmit={submit} className="grid gap-3">
        <div className="flex items-center gap-3">
          {shown.image_path
            ? <img src={menuPhoto(shown.image_path)} alt="" className="size-20 rounded-xl object-cover" />
            : <span className="grid size-20 place-items-center rounded-xl bg-mist text-ink-faint"><ImagePlus size={22} aria-hidden="true" /></span>}
          <div className="grid gap-1">
            <label className="btn btn-secondary btn-sm cursor-pointer">
              {photo.isPending ? 'Uploading…' : shown.image_path ? 'Change photo' : 'Add photo'}
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                disabled={photo.isPending}
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) photo.mutate(file)
                }}
              />
            </label>
            {shown.image_path && <button type="button" className="text-sm text-ink-soft underline" onClick={() => photo.mutate(null)}>Remove photo</button>}
          </div>
        </div>
        {photo.error && <Notice>{photo.error.message}</Notice>}
        <label className="field">Item name<input name="name" defaultValue={product.name} required /></label>
        <label className="field">
          Description
          <textarea name="description" rows={2} maxLength={500} defaultValue={product.description ?? ''} />
          <span className="hint">Shown on the item in the POS.</span>
        </label>
        <label className="field">
          Category
          <select name="categoryId" defaultValue={product.category_id}>
            {data.categories.filter((c: any) => c.is_active).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="field">
          Food type
          <select name="foodType" defaultValue={product.food_type}>
            {FOOD_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        {save.error && <Notice>{save.error.message}</Notice>}
      </form>
    </Modal>
  )
}

function CategoriesDialog({ data, onClose }: { data: any; onClose: () => void }) {
  const queryClient = useQueryClient()
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['menu'] })
  const list = data.categories.filter((c: any) => c.is_active)
  const change = useMutation({
    mutationFn: ({ path, method = 'POST', body }: { path: string; method?: string; body: object }) => api(path, { method, body }),
    onSuccess: refresh,
  })

  function move(index: number, by: number) {
    const ids = list.map((c: any) => c.id)
    ;[ids[index], ids[index + by]] = [ids[index + by], ids[index]]
    change.mutate({ path: '/categories/order', method: 'PUT', body: { ids } })
  }

  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    change.mutate({ path: '/categories', body: { name: String(new FormData(form).get('name')) } }, { onSuccess: () => form.reset() })
  }

  return (
    <Modal title="Categories" text="The POS shows them in this order." onClose={onClose}>
      <ul className="divide-y divide-line-soft">
        {list.map((category: any, index: number) => {
          const Icon = CATEGORY_ICONS[category.icon] ?? UtensilsCrossed
          return (
            <li key={category.id} className="flex items-center gap-2 py-2">
              <Icon size={18} strokeWidth={1.75} className="shrink-0 text-ink-soft" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{category.name}</span>
              <select
                aria-label={`Icon for ${category.name}`}
                className="h-9 w-28 rounded-lg border border-line bg-white px-1.5 text-sm"
                value={category.icon}
                onChange={(event) => change.mutate({ path: `/categories/${category.id}`, method: 'PATCH', body: { icon: event.target.value } })}
              >
                {Object.entries(CATEGORY_ICON_NAMES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <button aria-label={`Move ${category.name} up`} disabled={index === 0 || change.isPending} className="btn btn-ghost btn-icon" onClick={() => move(index, -1)}><ArrowUp size={16} aria-hidden="true" /></button>
              <button aria-label={`Move ${category.name} down`} disabled={index === list.length - 1 || change.isPending} className="btn btn-ghost btn-icon" onClick={() => move(index, 1)}><ArrowDown size={16} aria-hidden="true" /></button>
            </li>
          )
        })}
      </ul>
      <form onSubmit={add} className="mt-3 flex items-end gap-2">
        <label className="field flex-1">Add a category<input name="name" required /></label>
        <button className="btn btn-primary" disabled={change.isPending}>Add</button>
      </form>
      {change.error && <div className="mt-3"><Notice>{change.error.message}</Notice></div>}
    </Modal>
  )
}

function AddonsDialog({ data, onClose }: { data: any; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<any | null>(null)
  const [chosen, setChosen] = useState<string[]>([])
  const addons = data.addons.filter((addon: any) => addon.is_active)
  const items = data.products.filter((product: any) => product.is_active)
  const done = () => queryClient.invalidateQueries({ queryKey: ['menu'] })
  const create = useMutation({ mutationFn: (body: object) => api('/addons', { method: 'POST', body }), onSuccess: done })
  const link = useMutation({
    mutationFn: () => api(`/addons/${editing.id}/products`, { method: 'PUT', body: { productIds: chosen } }),
    onSuccess: () => {
      done()
      setEditing(null)
    },
  })

  function open(addon: any) {
    setEditing(addon)
    setChosen(items.filter((product: any) => product.addon_ids.includes(addon.id)).map((product: any) => product.id))
  }

  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    create.mutate(Object.fromEntries(new FormData(form)), { onSuccess: () => form.reset() })
  }

  if (editing) {
    return (
      <Modal
        title={`Items with ${editing.name}`}
        text="Tick the items that offer this add-on."
        onClose={() => setEditing(null)}
        footer={<button className="btn btn-primary" disabled={link.isPending} onClick={() => link.mutate()}>{link.isPending ? 'Saving…' : 'Save'}</button>}
      >
        <ul className="grid gap-1">
          {items.map((product: any) => (
            <li key={product.id}>
              <label className="flex min-h-10 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={chosen.includes(product.id)}
                  onChange={(event) => setChosen(event.target.checked ? [...chosen, product.id] : chosen.filter((id) => id !== product.id))}
                />
                {product.name}
              </label>
            </li>
          ))}
        </ul>
        {link.error && <div className="mt-3"><Notice>{link.error.message}</Notice></div>}
      </Modal>
    )
  }

  return (
    <Modal title="Add-ons" text="Extras such as an extra shot, and the items they go with." onClose={onClose}>
      {addons.length === 0 && <p className="text-sm text-ink-soft">No add-ons yet.</p>}
      <ul className="divide-y divide-line-soft">
        {addons.map((addon: any) => {
          const linked = items.filter((product: any) => product.addon_ids.includes(addon.id)).length
          return (
            <li key={addon.id} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0 text-sm">
                <span className="font-medium">{addon.name}</span> <span className="tnum text-ink-soft">+₹{addon.price}</span>
                <span className="block text-ink-soft">{linked} {linked === 1 ? 'item' : 'items'}</span>
              </span>
              <button className="btn btn-secondary btn-sm" onClick={() => open(addon)}>Choose items</button>
            </li>
          )
        })}
      </ul>
      <form onSubmit={add} className="mt-3 flex flex-wrap items-end gap-2">
        <label className="field min-w-32 flex-1">Add an add-on<input name="name" required /></label>
        <label className="field w-24">Price<input name="price" inputMode="decimal" required /></label>
        <button className="btn btn-primary" disabled={create.isPending}>Add</button>
      </form>
      {create.error && <div className="mt-3"><Notice>{create.error.message}</Notice></div>}
    </Modal>
  )
}

export function Menu({ me }: { me: Me }) {
  const queryClient = useQueryClient()
  const [panel, setPanel] = useState<Panel>(null)
  const [recipeFor, setRecipeFor] = useState<any | null>(null)
  const [editing, setEditing] = useState<any | null>(null)
  const [show, setShow] = useState<Show>('all')
  const [food, setFood] = useState('all')
  const [term, setTerm] = useState('')
  const { ask, node } = useAsk()
  const branch = useWorkingBranch(me)
  const canWrite = me.permissions.includes('menu.write')
  const menu = useQuery({
    queryKey: ['menu', branch],
    queryFn: () => api(`/menu${branch ? `?branchId=${branch}` : ''}`),
  })
  const change = useMutation({
    mutationFn: ({ path, method = 'POST', body }: { path: string; method?: string; body?: object }) => api(path, { method, body }),
    onSuccess: () => {
      setPanel(null)
      queryClient.invalidateQueries({ queryKey: ['menu'] })
    },
  })

  const data = menu.data
  const send = (path: string) => (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    change.mutate({ path, body: Object.fromEntries(new FormData(event.currentTarget)) })
  }

  function addProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>
    const variants = [{ name: form.size1 || 'Regular', price: form.price1 }]
    if (form.size2 && form.price2) variants.push({ name: form.size2, price: form.price2 })
    change.mutate({
      path: '/products',
      body: { name: form.name, description: form.description || undefined, categoryId: form.categoryId, taxRateId: form.taxRateId, foodType: form.foodType, variants },
    })
  }

  async function editPrice(variant: Variant) {
    const scope = branch ? 'this branch' : 'all branches'
    const answer = await ask(`${variant.name} price at ${scope}`, [
      { name: 'price', label: 'Price', required: true, defaultValue: variant.price, inputMode: 'decimal' },
    ], 'Save')
    if (!answer) return
    const next = answer.price
    if (branch) change.mutate({ path: `/branches/${branch}/variants/${variant.id}`, method: 'PUT', body: { price: next, isAvailable: variant.isAvailable } })
    else change.mutate({ path: `/variants/${variant.id}`, method: 'PATCH', body: { price: next } })
  }

  const actions = canWrite && (
    <div className="flex flex-wrap gap-2">
      <button className="btn btn-primary" onClick={() => setPanel('product')}>Add item</button>
      <button className="btn btn-secondary" onClick={() => setPanel('categories')}>Categories</button>
      <button className="btn btn-secondary" onClick={() => setPanel('addons')}>Add-ons</button>
      <button className="btn btn-secondary" onClick={() => setPanel('rate')}>Add tax rate</button>
    </div>
  )

  const ready = Boolean(data?.categories.length && data?.taxRates.length)
  const products = data?.products ?? []
  const counts = useMemo(() => ({
    all: products.length,
    available: products.filter((p: any) => p.is_active && !soldOut(p)).length,
    sold_out: products.filter(soldOut).length,
    hidden: products.filter((p: any) => !p.is_active).length,
  }), [products])
  const shown = products.filter((product: any) => {
    if (show === 'available' && (!product.is_active || soldOut(product))) return false
    if (show === 'sold_out' && !soldOut(product)) return false
    if (show === 'hidden' && product.is_active) return false
    if (food !== 'all' && product.food_type !== food) return false
    return !term.trim() || product.name.toLowerCase().includes(term.trim().toLowerCase())
  })

  return (
    <>
      {node}
      {recipeFor && <RecipeDialog product={recipeFor} onClose={() => setRecipeFor(null)} />}
      {editing && data && <ItemDialog product={editing} data={data} onClose={() => setEditing(null)} />}
      {panel === 'categories' && data && <CategoriesDialog data={data} onClose={() => setPanel(null)} />}
      {panel === 'addons' && data && <AddonsDialog data={data} onClose={() => setPanel(null)} />}
      <PageHeader title="Menu" text={branch ? 'Showing prices for the selected branch.' : 'Showing menu prices for all branches.'} action={actions} />

      {panel === 'rate' && (
        <form onSubmit={send('/tax-rates')} className="card mb-5 grid gap-3 p-5 sm:grid-cols-4">
          <label className="field">Name<input name="name" placeholder="As on your GST setup" required /></label>
          <label className="field">CGST %<input name="cgstRate" inputMode="decimal" defaultValue="0" required /></label>
          <label className="field">SGST %<input name="sgstRate" inputMode="decimal" defaultValue="0" required /></label>
          <button className="btn btn-primary self-end" disabled={change.isPending}>Save</button>
          <p className="text-sm text-ink-soft sm:col-span-4">Rates can’t be edited later, so past bills stay correct. Add a new rate if yours changes, and check your rate with your accountant.</p>
        </form>
      )}
      {panel === 'product' && !ready && (
        <div className="mb-5"><Notice>Add a category and a tax rate first.</Notice></div>
      )}
      {panel === 'product' && ready && (
        <form onSubmit={addProduct} className="card mb-5 grid gap-3 p-5 sm:grid-cols-3">
          <label className="field">Item name<input name="name" required /></label>
          <label className="field">
            Category
            <select name="categoryId" required>
              {data.categories.filter((c: any) => c.is_active).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="field">
            Tax rate
            <select name="taxRateId" required>
              {data.taxRates.filter((t: any) => t.is_active).map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <label className="field sm:col-span-2">Description (optional)<input name="description" maxLength={500} /></label>
          <label className="field">
            Food type
            <select name="foodType" defaultValue="veg">
              {FOOD_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="field">Size<input name="size1" placeholder="Regular" /></label>
          <label className="field">Price<input name="price1" inputMode="decimal" required /></label>
          <label className="field">Second size (optional)<input name="size2" placeholder="Large" /></label>
          <label className="field">Second price<input name="price2" inputMode="decimal" /></label>
          <button className="btn btn-primary self-end" disabled={change.isPending}>Save item</button>
        </form>
      )}
      {change.error && <div className="mb-4"><Notice>{change.error.message}</Notice></div>}

      <Loading
        ready={!menu.isPending}
        error={menu.error}
        empty={data && data.products.length === 0 ? (canWrite ? 'Your menu is empty. Start by adding a category and a tax rate.' : 'The menu has not been set up yet.') : undefined}
      >
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Segmented
            label="Show"
            value={show}
            options={[
              { value: 'all', label: 'All', count: counts.all },
              { value: 'available', label: 'Available', count: counts.available },
              { value: 'sold_out', label: 'Sold out', count: counts.sold_out },
              { value: 'hidden', label: 'Hidden', count: counts.hidden },
            ]}
            onChange={setShow}
          />
          <select aria-label="Food type" className="h-10 rounded-[0.625rem] border border-line bg-white px-2 text-sm" value={food} onChange={(event) => setFood(event.target.value)}>
            <option value="all">All food types</option>
            {FOOD_TYPES.slice(0, 3).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <label className="relative min-w-40 flex-1 sm:max-w-64">
            <span className="sr-only">Search menu</span>
            <Search size={16} className="absolute top-3 left-3 text-ink-faint" aria-hidden="true" />
            <input className="h-10 w-full rounded-[0.625rem] border border-line bg-white pr-3 pl-9 text-sm" placeholder="Search items" value={term} onChange={(event) => setTerm(event.target.value)} />
          </label>
        </div>

        {shown.length === 0 && <Empty title="No items match these filters." />}

        {data?.categories.map((category: any) => {
          const items = shown.filter((p: any) => p.category_id === category.id)
          if (items.length === 0) return null
          const Icon = CATEGORY_ICONS[category.icon] ?? UtensilsCrossed
          return (
            <section key={category.id} className="mb-6">
              <h2 className="mb-2 flex items-center gap-2 text-lg"><Icon size={18} strokeWidth={1.75} className="text-ink-soft" aria-hidden="true" /> {category.name}</h2>
              <ul className="card divide-y divide-line-soft overflow-hidden">
                {items.map((product: any) => {
                  const addons = data.addons.filter((addon: any) => addon.is_active && product.addon_ids.includes(addon.id))
                  return (
                    <li key={product.id} className="flex gap-3 p-4">
                      {product.image_path && <img src={menuPhoto(product.image_path)} alt="" decoding="async" className="size-14 shrink-0 rounded-lg object-cover" />}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className={`flex flex-wrap items-center gap-1.5 font-medium ${product.is_active ? '' : 'text-ink-soft line-through'}`}>
                              <FoodMark type={product.food_type} /> {product.name}
                              {!product.is_active && <Badge>Hidden</Badge>}
                              {soldOut(product) && <Badge tone="wait">Sold out</Badge>}
                            </p>
                            {product.description && <p className="mt-0.5 max-w-xl text-sm text-ink-soft">{product.description}</p>}
                            {addons.length > 0 && <p className="mt-0.5 text-sm text-ink-soft">Add-ons: {addons.map((addon: any) => addon.name).join(', ')}</p>}
                          </div>
                          {canWrite && (
                            <span className="flex flex-wrap gap-2">
                              <button className="btn btn-secondary !min-h-9 text-sm" onClick={() => setEditing(product)}>Edit</button>
                              <button
                                className="btn btn-secondary !min-h-9 text-sm"
                                disabled={change.isPending}
                                onClick={() => change.mutate({ path: `/products/${product.id}/duplicate`, body: {} })}
                              >
                                <Copy size={14} aria-hidden="true" /> Duplicate
                              </button>
                              {me.permissions.includes('inventory.read') && <button className="btn btn-secondary !min-h-9 text-sm" onClick={() => setRecipeFor(product)}>Recipe</button>}
                              <button
                                className="btn btn-secondary !min-h-9 text-sm"
                                onClick={() => change.mutate({ path: `/products/${product.id}`, method: 'PATCH', body: { isActive: !product.is_active } })}
                              >
                                {product.is_active ? 'Hide from menu' : 'Show on menu'}
                              </button>
                            </span>
                          )}
                        </div>
                        <ul className="mt-2 space-y-1">
                          {product.variants.map((variant: Variant) => (
                            <li key={variant.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                              <span className="text-ink-soft">{variant.name}</span>
                              <span className="flex items-center gap-2">
                                {variant.hasBranchPrice && <span className="text-xs text-brand-deep">Branch price</span>}
                                <span className="tnum font-medium">₹{variant.price}</span>
                                {canWrite && <button className="btn !min-h-9 text-sm underline" onClick={() => editPrice(variant)}>Price</button>}
                                {canWrite && branch && variant.hasBranchPrice && (
                                  <button
                                    className="btn !min-h-9 text-sm underline"
                                    onClick={() => change.mutate({ path: `/branches/${branch}/variants/${variant.id}`, method: 'PUT', body: { price: null, isAvailable: variant.isAvailable } })}
                                  >
                                    Use menu price
                                  </button>
                                )}
                                {canWrite && branch && (
                                  <button
                                    className="btn btn-secondary !min-h-9 text-sm"
                                    onClick={() => change.mutate({
                                      path: `/branches/${branch}/variants/${variant.id}`,
                                      method: 'PUT',
                                      body: { price: variant.hasBranchPrice ? variant.price : null, isAvailable: !variant.isAvailable },
                                    })}
                                  >
                                    {variant.isAvailable ? 'Mark sold out' : 'Mark available'}
                                  </button>
                                )}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </section>
          )
        })}
      </Loading>
    </>
  )
}
