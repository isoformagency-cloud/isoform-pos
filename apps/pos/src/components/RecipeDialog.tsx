import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { Link } from 'react-router'
import { api } from '../lib/api'
import { Modal, Notice } from './ui'

interface Line {
  stockItemId: string
  quantity: string
}

export function RecipeDialog({ product, onClose }: { product: any; onClose: () => void }) {
  const queryClient = useQueryClient()
  const stock = useQuery({ queryKey: ['inventory', 'items'], queryFn: () => api('/inventory/items') })
  const recipe = useQuery({ queryKey: ['recipe', product.id], queryFn: () => api(`/products/${product.id}/recipe`) })
  const [lines, setLines] = useState<Line[] | null>(null)

  useEffect(() => {
    if (recipe.data && lines === null) setLines(recipe.data.lines.map((line: any) => ({ stockItemId: line.stock_item_id, quantity: Number(line.quantity).toString() })))
  }, [recipe.data, lines])

  const save = useMutation({
    mutationFn: () => api(`/products/${product.id}/recipe`, { method: 'PUT', body: { lines: (lines ?? []).filter((line) => line.stockItemId && Number(line.quantity) > 0) } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recipe', product.id] })
      onClose()
    },
  })

  const items: any[] = stock.data?.items ?? []
  const change = (index: number, patch: Partial<Line>) => setLines((lines ?? []).map((line, at) => (at === index ? { ...line, ...patch } : line)))
  const unused = items.filter((item) => !(lines ?? []).some((line) => line.stockItemId === item.id))

  return (
    <Modal
      title={`Recipe: ${product.name}`}
      text="Each sale takes these amounts off stock, per item sold."
      onClose={onClose}
      footer={<button className="btn btn-primary" disabled={save.isPending || lines === null} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Save recipe'}</button>}
    >
      {(stock.error || recipe.error) && <Notice>{(stock.error ?? recipe.error)?.message}</Notice>}
      {stock.data && items.length === 0 && (
        <p className="text-sm text-ink-soft">Add ingredients on the <Link to="/inventory" className="underline">Inventory</Link> page first.</p>
      )}
      {items.length > 0 && lines && (
        <div className="grid gap-2">
          {lines.length === 0 && <p className="text-sm text-ink-soft">No ingredients linked yet.</p>}
          {lines.map((line, index) => {
            const item = items.find((row) => row.id === line.stockItemId)
            return (
              <div key={index} className="flex items-center gap-2">
                <label className="min-w-0 flex-1">
                  <span className="sr-only">Ingredient</span>
                  <select className="input !min-h-10 !text-sm" value={line.stockItemId} onChange={(event) => change(index, { stockItemId: event.target.value })}>
                    {item && <option value={item.id}>{item.name}</option>}
                    {unused.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                  </select>
                </label>
                <label className="flex w-28 shrink-0 items-center gap-1 text-sm text-ink-soft">
                  <span className="sr-only">Quantity</span>
                  <input className="input !min-h-10 !text-sm" inputMode="decimal" value={line.quantity} onChange={(event) => change(index, { quantity: event.target.value.replace(/[^\d.]/g, '') })} />
                  {item?.unit}
                </label>
                <button aria-label="Remove ingredient" className="btn btn-ghost btn-icon !min-h-9 !w-9" onClick={() => setLines(lines.filter((_, at) => at !== index))}>
                  <Trash2 size={15} aria-hidden="true" />
                </button>
              </div>
            )
          })}
          {unused.length > 0 && (
            <button className="btn btn-secondary btn-sm justify-self-start" onClick={() => setLines([...lines, { stockItemId: unused[0].id, quantity: '' }])}>
              <Plus size={15} aria-hidden="true" /> Add ingredient
            </button>
          )}
        </div>
      )}
      {save.error && <div className="mt-2"><Notice>{save.error.message}</Notice></div>}
    </Modal>
  )
}
