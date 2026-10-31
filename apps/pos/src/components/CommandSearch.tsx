import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileText, Package, Receipt, Search, User, Users, UtensilsCrossed, type LucideIcon } from 'lucide-react'
import { useNavigate } from 'react-router'
import { api } from '../lib/api'
import { money } from '../lib/format'
import { typeName } from './order-look'

interface Hit {
  key: string
  icon: LucideIcon
  title: string
  note: string
  to: string
}

const hitsFrom = (data: any): { group: string; hits: Hit[] }[] => [
  {
    group: 'Orders',
    hits: (data?.orders ?? []).map((item: any) => ({
      key: `order-${item.id}`,
      icon: Receipt,
      title: `Order #${item.display_number}${item.table_label ? ` · ${item.table_label}` : ''}`,
      note: `${typeName(item.order_type)}${item.customer_name ? ` · ${item.customer_name}` : ''} · ${item.business_date}`,
      to: item.status === 'open' ? `/pos?order=${item.id}` : `/orders?open=${item.id}`,
    })),
  },
  {
    group: 'Bills',
    hits: (data?.bills ?? []).map((item: any) => ({
      key: `bill-${item.id}`, icon: FileText, title: item.number, note: `${money(item.grand_total)} · ${item.invoice_date}`, to: `/invoices/${item.id}`,
    })),
  },
  {
    group: 'Customers',
    hits: (data?.customers ?? []).map((item: any) => ({
      key: `customer-${item.id}`, icon: User, title: item.name, note: item.phone, to: `/customers?open=${item.id}`,
    })),
  },
  {
    group: 'Menu',
    hits: (data?.menu ?? []).map((item: any) => ({
      key: `menu-${item.id}`, icon: UtensilsCrossed, title: item.name, note: item.category, to: '/menu',
    })),
  },
  {
    group: 'Stock',
    hits: (data?.stock ?? []).map((item: any) => ({
      key: `stock-${item.id}`, icon: Package, title: item.name, note: item.category, to: '/inventory',
    })),
  },
  {
    group: 'Staff',
    hits: (data?.staff ?? []).map((item: any) => ({
      key: `staff-${item.id}`, icon: Users, title: item.display_name, note: item.role, to: '/staff',
    })),
  },
].filter((section) => section.hits.length > 0)

export function CommandSearch({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [text, setText] = useState('')
  const [term, setTerm] = useState('')
  const [index, setIndex] = useState(0)
  const navigate = useNavigate()

  useEffect(() => {
    dialog.current?.showModal()
  }, [])

  useEffect(() => {
    const wait = setTimeout(() => setTerm(text.trim()), 200)
    return () => clearTimeout(wait)
  }, [text])

  const results = useQuery({
    queryKey: ['search', term],
    queryFn: () => api(`/search?q=${encodeURIComponent(term)}`, { branch: true }),
    enabled: term.length >= 2,
    staleTime: 10000,
  })

  const sections = useMemo(() => hitsFrom(term.length >= 2 ? results.data : null), [results.data, term])
  const flat = sections.flatMap((section) => section.hits)

  useEffect(() => setIndex(0), [term])

  function go(hit?: Hit) {
    if (!hit) return
    onClose()
    navigate(hit.to)
  }

  function keys(event: React.KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setIndex((index + 1) % Math.max(flat.length, 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setIndex((index - 1 + flat.length) % Math.max(flat.length, 1))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      go(flat[index])
    }
  }

  return (
    <dialog
      ref={dialog}
      aria-label="Search"
      onCancel={(event) => { event.preventDefault(); onClose() }}
      onClick={(event) => { if (event.target === dialog.current) onClose() }}
      className="sheet mx-auto mt-[12vh] w-[min(36rem,calc(100vw-2rem))] overflow-hidden rounded-2xl bg-white p-0 text-ink shadow-float"
    >
      <label className="flex items-center gap-3 border-b border-line-soft px-4">
        <Search size={18} className="shrink-0 text-ink-faint" aria-hidden="true" />
        <span className="sr-only">Search</span>
        <input
          autoFocus
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={keys}
          placeholder="Order number, bill, customer, item or staff"
          className="h-13 w-full bg-transparent text-base outline-none placeholder:text-ink-faint"
        />
      </label>
      <div className="thin-scroll max-h-[55vh] overflow-y-auto p-2">
        {term.length < 2 && <p className="p-4 text-center text-sm text-ink-soft">Type at least two letters.</p>}
        {term.length >= 2 && results.isPending && <p className="p-4 text-center text-sm text-ink-soft">Searching…</p>}
        {results.error && <p className="p-4 text-center text-sm text-bad">{results.error.message}</p>}
        {term.length >= 2 && results.data && flat.length === 0 && <p className="p-4 text-center text-sm text-ink-soft">Nothing matches “{term}”.</p>}
        {sections.map((section) => (
          <div key={section.group} className="mb-1">
            <p className="px-2.5 pt-2 pb-1 text-xs font-medium text-ink-faint">{section.group}</p>
            {section.hits.map((hit) => {
              const Icon = hit.icon
              const active = flat[index]?.key === hit.key
              return (
                <button
                  key={hit.key}
                  className={`flex min-h-11 w-full items-center gap-3 rounded-lg px-2.5 text-left text-sm ${active ? 'bg-brand-tint' : 'hover:bg-mist'}`}
                  onMouseEnter={() => setIndex(flat.indexOf(hit))}
                  onClick={() => go(hit)}
                >
                  <Icon size={16} strokeWidth={1.75} className="shrink-0 text-ink-soft" aria-hidden="true" />
                  <span className="min-w-0 truncate font-medium">{hit.title}</span>
                  <span className="ml-auto truncate pl-3 text-xs text-ink-soft">{hit.note}</span>
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </dialog>
  )
}
