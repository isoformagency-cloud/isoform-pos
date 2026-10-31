import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { UserPlus } from 'lucide-react'
import { api } from '../lib/api'
import { Modal, Notice } from './ui'

export function CustomerPicker({ current, canCreate, onPick, onClose }: {
  current?: any
  canCreate: boolean
  onPick: (customerId: string | null) => void
  onClose: () => void
}) {
  const [text, setText] = useState('')
  const [term, setTerm] = useState('')
  const [adding, setAdding] = useState(false)
  const digits = text.replace(/\D/g, '')

  useEffect(() => {
    const wait = setTimeout(() => setTerm(text.trim()), 200)
    return () => clearTimeout(wait)
  }, [text])

  const found = useQuery({ queryKey: ['customers', term], queryFn: () => api(`/customers?search=${encodeURIComponent(term)}`), enabled: term.length >= 2 })
  const create = useMutation({
    mutationFn: (body: object) => api('/customers', { method: 'POST', body }),
    onSuccess: (data) => onPick(data.id),
  })

  if (adding) {
    return (
      <Modal title="New customer" onClose={onClose}>
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            create.mutate(Object.fromEntries(new FormData(event.currentTarget)))
          }}
        >
          <label className="field">Name<input name="name" required autoFocus defaultValue={digits ? '' : text} /></label>
          <label className="field">10-digit mobile<input name="phone" required inputMode="numeric" pattern="\d{10}" title="10 digits" defaultValue={digits} /></label>
          {create.error && <Notice>{create.error.message}</Notice>}
          <button className="btn btn-primary" disabled={create.isPending}>Save and add to order</button>
        </form>
      </Modal>
    )
  }

  return (
    <Modal title="Add customer" text="Search by name or mobile number." onClose={onClose}>
      <label className="field">
        <span className="sr-only">Find customer</span>
        <input autoFocus value={text} onChange={(event) => setText(event.target.value)} placeholder="Name or mobile" />
      </label>
      {found.error && <div className="mt-2"><Notice>{found.error.message}</Notice></div>}
      <ul className="mt-2 divide-y divide-line-soft">
        {found.data?.items.map((customer: any) => (
          <li key={customer.id}>
            <button className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-2 text-left text-sm hover:bg-mist" onClick={() => onPick(customer.id)}>
              <span className="font-medium">{customer.name}</span>
              <span className="tnum text-ink-soft">{customer.phone}</span>
            </button>
          </li>
        ))}
      </ul>
      {term.length >= 2 && found.data?.items.length === 0 && <p className="py-2 text-sm text-ink-soft">No customer matches that.</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {canCreate && <button className="btn btn-secondary btn-sm" onClick={() => setAdding(true)}><UserPlus size={15} aria-hidden="true" /> New customer</button>}
        {current?.customer_id && <button className="btn btn-ghost btn-sm" onClick={() => onPick(null)}>Remove {current.customer_name}</button>}
      </div>
    </Modal>
  )
}
