import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Me } from '../App'
import { useAsk } from '../components/Ask'
import { useWorkingBranch } from '../components/BranchPicker'
import { RecipeDialog } from '../components/RecipeDialog'
import { Loading, Notice, PageHeader } from '../components/ui'
import { api } from '../lib/api'

interface Variant {
  id: string
  name: string
  price: string
  menuPrice: string
  hasBranchPrice: boolean
  isAvailable: boolean
  isActive: boolean
}

type Panel = 'product' | 'category' | 'rate' | 'addon' | null

export function Menu({ me }: { me: Me }) {
  const queryClient = useQueryClient()
  const [panel, setPanel] = useState<Panel>(null)
  const [recipeFor, setRecipeFor] = useState<any | null>(null)
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
      body: { name: form.name, categoryId: form.categoryId, taxRateId: form.taxRateId, foodType: form.foodType, variants },
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
      <button className="btn btn-secondary" onClick={() => setPanel('category')}>Add category</button>
      <button className="btn btn-secondary" onClick={() => setPanel('rate')}>Add tax rate</button>
      <button className="btn btn-secondary" onClick={() => setPanel('addon')}>Add add-on</button>
    </div>
  )

  const ready = Boolean(data?.categories.length && data?.taxRates.length)

  return (
    <>
      {node}
      {recipeFor && <RecipeDialog product={recipeFor} onClose={() => setRecipeFor(null)} />}
      <PageHeader title="Menu" text={branch ? 'Showing prices for the selected branch.' : 'Showing menu prices for all branches.'} action={actions} />

      {panel === 'category' && (
        <form onSubmit={send('/categories')} className="card mb-5 flex flex-wrap items-end gap-3 p-5">
          <label className="field flex-1">Category name<input name="name" required /></label>
          <button className="btn btn-primary" disabled={change.isPending}>Save</button>
        </form>
      )}
      {panel === 'addon' && (
        <form onSubmit={send('/addons')} className="card mb-5 flex flex-wrap items-end gap-3 p-5">
          <label className="field flex-1">Add-on name<input name="name" required /></label>
          <label className="field">Price<input name="price" inputMode="decimal" required /></label>
          <button className="btn btn-primary" disabled={change.isPending}>Save</button>
        </form>
      )}
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
          <label className="field">
            Food type
            <select name="foodType" defaultValue="veg">
              <option value="veg">Veg</option>
              <option value="non_veg">Non-veg</option>
              <option value="egg">Egg</option>
              <option value="none">Not applicable</option>
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
        {data?.categories.map((category: any) => {
          const items = data.products.filter((p: any) => p.category_id === category.id)
          if (items.length === 0) return null
          return (
            <section key={category.id} className="mb-6">
              <h2 className="mb-2 text-lg">{category.name}</h2>
              <ul className="card divide-y divide-line-soft overflow-hidden">
                {items.map((product: any) => (
                  <li key={product.id} className="p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className={`font-medium ${product.is_active ? '' : 'text-ink-soft line-through'}`}>{product.name}</p>
                      {canWrite && (
                        <span className="flex flex-wrap gap-2">
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
                    {canWrite && data.addons.length > 0 && (
                      <fieldset className="mt-2 flex flex-wrap gap-x-4 text-sm">
                        <legend className="sr-only">Add-ons for {product.name}</legend>
                        {data.addons.filter((addon: any) => addon.is_active).map((addon: any) => (
                          <label key={addon.id} className="flex min-h-10 items-center gap-2 text-ink-soft">
                            <input
                              type="checkbox"
                              checked={product.addon_ids.includes(addon.id)}
                              onChange={(event) => change.mutate({
                                path: `/products/${product.id}/addons`,
                                method: 'PUT',
                                body: {
                                  addonIds: event.target.checked
                                    ? [...product.addon_ids, addon.id]
                                    : product.addon_ids.filter((id: string) => id !== addon.id),
                                },
                              })}
                            />
                            {addon.name} (+₹{addon.price})
                          </label>
                        ))}
                      </fieldset>
                    )}
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
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
      </Loading>
    </>
  )
}
