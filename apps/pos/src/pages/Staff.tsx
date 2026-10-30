import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Me } from '../App'
import { useAsk } from '../components/Ask'
import { Loading, Notice, PageHeader } from '../components/ui'
import { api } from '../lib/api'

const PIN_ROLES = ['cashier', 'waiter', 'kitchen']

export function Staff({ me }: { me: Me }) {
  const queryClient = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [role, setRole] = useState('cashier')
  const { ask, node } = useAsk()
  const staff = useQuery({ queryKey: ['staff'], queryFn: () => api('/staff') })
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => api('/branches') })
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['staff'] })

  const add = useMutation({
    mutationFn: (body: object) => api('/staff', { method: 'POST', body }),
    onSuccess: () => {
      setAdding(false)
      refresh()
    },
  })
  const remove = useMutation({
    mutationFn: (id: string) => api(`/staff/${id}`, { method: 'PATCH', body: { status: 'removed' } }),
    onSuccess: refresh,
  })
  const unlock = useMutation({
    mutationFn: (id: string) => api(`/staff/${id}/unlock`, { method: 'POST' }),
    onSuccess: refresh,
  })

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const usesPin = PIN_ROLES.includes(role)
    add.mutate({
      displayName: form.get('displayName'),
      role,
      branchIds: form.getAll('branchIds'),
      ...(usesPin ? { pin: form.get('pin') } : { email: form.get('email') }),
    })
  }

  const roles = me.role === 'owner' ? ['cashier', 'waiter', 'kitchen', 'manager', 'accountant', 'owner'] : PIN_ROLES

  return (
    <>
      {node}
      <PageHeader
        title="Staff"
        text="Frontline staff use a PIN on a registered device. Managers and owners sign in with email."
        action={<button className="btn btn-primary" onClick={() => setAdding(!adding)}>Add staff</button>}
      />
      {adding && (
        <form onSubmit={submit} className="card mb-5 grid gap-4 p-5 sm:grid-cols-3">
          <label className="field">Name<input name="displayName" required minLength={2} /></label>
          <label className="field">
            Role
            <select value={role} onChange={(event) => setRole(event.target.value)}>
              {roles.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          {PIN_ROLES.includes(role) ? (
            <label className="field">PIN (4 to 6 digits)<input name="pin" inputMode="numeric" pattern="\d{4,6}" required autoComplete="off" /></label>
          ) : (
            <label className="field">Email<input name="email" type="email" required /></label>
          )}
          <fieldset className="sm:col-span-3">
            <legend className="text-sm font-medium">Branches</legend>
            <div className="mt-2 flex flex-wrap gap-4">
              {branches.data?.items.map((branch: any) => (
                <label key={branch.id} className="flex min-h-11 items-center gap-2 text-sm">
                  <input type="checkbox" name="branchIds" value={branch.id} defaultChecked={branches.data.items.length === 1} />
                  {branch.name}
                </label>
              ))}
            </div>
          </fieldset>
          {add.error && <div className="sm:col-span-3"><Notice>{add.error.message}</Notice></div>}
          <button className="btn btn-primary justify-self-start" disabled={add.isPending}>Save</button>
        </form>
      )}
      {remove.error && <div className="mb-3"><Notice>{remove.error.message}</Notice></div>}
      <Loading ready={!staff.isPending} error={staff.error}>
        <ul className="card divide-y divide-line">
          {staff.data?.items.map((member: any) => (
            <li key={member.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <p className="font-medium">{member.display_name}</p>
                <p className="text-sm capitalize text-ink-soft">{member.role} · {member.status}</p>
              </div>
              {member.id !== me.membershipId && (
                <div className="flex gap-2">
                  {member.has_pin && <button className="btn btn-secondary" onClick={() => unlock.mutate(member.id)}>Unlock PIN</button>}
                  <button
                    className="btn btn-secondary"
                    onClick={async () => (await ask(`Remove ${member.display_name}?`, [], 'Remove')) && remove.mutate(member.id)}
                  >
                    Remove
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </Loading>
    </>
  )
}
