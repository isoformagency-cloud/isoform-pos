import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Me } from '../App'
import { useAsk } from '../components/Ask'
import { Avatar, Badge, Loading, Notice, PageHeader } from '../components/ui'
import { api } from '../lib/api'
import { dateTime } from '../lib/format'

const PIN_ROLES = ['cashier', 'waiter', 'kitchen']
const ROLE_NAMES: Record<string, string> = {
  owner: 'Owner', admin: 'Admin', manager: 'Manager', cashier: 'Cashier', waiter: 'Waiter', kitchen: 'Kitchen staff', accountant: 'Accountant',
}
const ROLES_FOR: Record<string, string[]> = {
  owner: ['cashier', 'waiter', 'kitchen', 'manager', 'accountant', 'admin', 'owner'],
  admin: ['cashier', 'waiter', 'kitchen', 'manager', 'accountant'],
}

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

  const roles = ROLES_FOR[me.role] ?? PIN_ROLES

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
              {roles.map((item) => <option key={item} value={item}>{ROLE_NAMES[item]}</option>)}
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
        <ul className="card divide-y divide-line-soft overflow-hidden">
          {staff.data?.items.map((member: any) => (
            <li key={member.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="flex items-center gap-3">
                <Avatar name={member.display_name} />
                <div>
                  <p className="font-medium">{member.display_name}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-sm text-ink-soft">
                    {ROLE_NAMES[member.role] ?? member.role}
                    {member.status !== 'active' && <Badge tone="wait">{member.status}</Badge>}
                  </p>
                  <p className="tnum mt-0.5 text-xs text-ink-soft">
                    {member.orders_today} {member.orders_today === 1 ? 'order' : 'orders'} today · {member.last_active ? `Last active ${dateTime(member.last_active)}` : 'Not active yet'}
                  </p>
                </div>
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
