import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Me } from '../App'
import { Loading, Notice, PageHeader } from '../components/ui'
import { api } from '../lib/api'

export function Branches({ me }: { me: Me }) {
  const queryClient = useQueryClient()
  const [adding, setAdding] = useState(false)
  const canWrite = me.permissions.includes('branches.write')
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => api('/branches') })
  const tax = useQuery({ queryKey: ['tax'], queryFn: () => api('/tax-registrations'), enabled: canWrite })
  const add = useMutation({
    mutationFn: (body: object) => api('/branches', { method: 'POST', body }),
    onSuccess: () => {
      setAdding(false)
      queryClient.invalidateQueries({ queryKey: ['branches'] })
      // The sign-in details list your branches, so they have to catch up with the new one.
      queryClient.invalidateQueries({ queryKey: ['me'] })
    },
  })

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = Object.fromEntries(new FormData(event.currentTarget))
    add.mutate({ ...form, code: String(form.code).toUpperCase() })
  }

  return (
    <>
      <PageHeader
        title="Branches"
        action={canWrite && <button className="btn btn-primary" onClick={() => setAdding(!adding)}>Add branch</button>}
      />
      {adding && (
        <form onSubmit={submit} className="card mb-5 grid gap-4 p-5 sm:grid-cols-3">
          <label className="field">Name<input name="name" required minLength={2} /></label>
          <label className="field">Short code<input name="code" required pattern="[A-Za-z0-9]{2,4}" title="2 to 4 letters or numbers" /></label>
          <label className="field">
            Tax registration
            <select name="taxRegistrationId" required>
              {tax.data?.items.map((item: any) => (
                <option key={item.id} value={item.id}>{item.gstin ?? item.legal_name}</option>
              ))}
            </select>
          </label>
          {add.error && <div className="sm:col-span-3"><Notice>{add.error.message}</Notice></div>}
          <button className="btn btn-primary justify-self-start" disabled={add.isPending}>Save branch</button>
        </form>
      )}
      <Loading ready={!branches.isPending} error={branches.error}>
        <ul className="grid gap-3 sm:grid-cols-2">
          {branches.data?.items.map((branch: any) => (
            <li key={branch.id} className="card p-5">
              <p className="font-semibold">{branch.name}</p>
              <p className="font-mono text-sm text-ink-soft">{branch.code}</p>
            </li>
          ))}
        </ul>
      </Loading>
    </>
  )
}
