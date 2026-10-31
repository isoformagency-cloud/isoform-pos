import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAsk } from '../components/Ask'
import { Loading, Notice, PageHeader } from '../components/ui'
import { api, deviceCredential, saveDeviceCredential } from '../lib/api'

export function Devices() {
  const queryClient = useQueryClient()
  const [registered, setRegistered] = useState(Boolean(deviceCredential()))
  const { ask, node } = useAsk()
  const devices = useQuery({ queryKey: ['devices'], queryFn: () => api('/devices') })
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => api('/branches') })
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['devices'] })

  const add = useMutation({
    mutationFn: (body: object) => api('/devices', { method: 'POST', body }),
    onSuccess: (data) => {
      saveDeviceCredential(data.credential)
      setRegistered(true)
      refresh()
    },
  })
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/devices/${id}/revoke`, { method: 'POST' }),
    onSuccess: refresh,
  })

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    add.mutate(Object.fromEntries(new FormData(event.currentTarget)))
  }

  return (
    <>
      {node}
      <PageHeader title="Devices" text="Staff can only use a PIN on a device registered here." />
      {registered ? (
        <div className="mb-5"><Notice tone="ok">This device is registered for PIN login.</Notice></div>
      ) : (
        <form onSubmit={submit} className="card mb-5 grid gap-4 p-5 sm:grid-cols-3">
          <label className="field">Device name<input name="name" required minLength={2} placeholder="Counter tablet" /></label>
          <label className="field">
            Branch
            <select name="branchId" required>
              {branches.data?.items.map((branch: any) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </select>
          </label>
          <button className="btn btn-primary self-end" disabled={add.isPending}>Register this device</button>
          {add.error && <div className="sm:col-span-3"><Notice>{add.error.message}</Notice></div>}
        </form>
      )}
      <Loading ready={!devices.isPending} error={devices.error}>
        <ul className="card divide-y divide-line-soft overflow-hidden">
          {devices.data?.items.length === 0 && <li className="p-6 text-center text-ink-soft">No devices yet.</li>}
          {devices.data?.items.map((device: any) => (
            <li key={device.id} className="flex items-center justify-between gap-3 p-4">
              <div>
                <p className="font-medium">{device.name}</p>
                <p className="text-sm capitalize text-ink-soft">{device.status}</p>
              </div>
              {device.status === 'active' && (
                <button className="btn btn-secondary" onClick={async () => (await ask(`Revoke ${device.name}?`, [], 'Revoke')) && revoke.mutate(device.id)}>Revoke</button>
              )}
            </li>
          ))}
        </ul>
      </Loading>
    </>
  )
}
