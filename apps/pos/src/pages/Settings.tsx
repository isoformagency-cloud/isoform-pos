import type { FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loading, Notice, PageHeader } from '../components/ui'
import { api } from '../lib/api'

export function Settings() {
  const queryClient = useQueryClient()
  const business = useQuery({ queryKey: ['business'], queryFn: () => api('/business') })
  const me = queryClient.getQueryData<{ permissions: string[] }>(['me'])
  const canWrite = me?.permissions.includes('business.write')
  const save = useMutation({
    mutationFn: (body: object) => api('/business', { method: 'PATCH', body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['business'] }),
  })

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    save.mutate({
      displayName: form.get('displayName'),
      roundingRule: form.get('roundingRule'),
      pricesIncludeTax: form.get('pricesIncludeTax') === 'on',
      allowSelfVerification: form.get('allowSelfVerification') === 'on',
    })
  }

  return (
    <>
      <PageHeader title="Settings" />
      <Loading ready={!business.isPending} error={business.error}>
        <form key={business.dataUpdatedAt} onSubmit={submit} className="card grid max-w-lg gap-4 p-5">
          <fieldset disabled={!canWrite} className="grid gap-4">
            <label className="field">Business name<input name="displayName" defaultValue={business.data?.display_name} required minLength={2} /></label>
            <label className="field">
              Rounding
              <select name="roundingRule" defaultValue={business.data?.rounding_rule}>
                <option value="nearest_rupee">Nearest rupee</option>
                <option value="none">No rounding</option>
              </select>
            </label>
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" name="pricesIncludeTax" defaultChecked={business.data?.prices_include_tax} />
              Menu prices include tax
            </label>
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" name="allowSelfVerification" defaultChecked={business.data?.allow_self_verification} />
              Let one person record and confirm payments (for very small teams)
            </label>
          </fieldset>
          {save.error && <Notice>{save.error.message}</Notice>}
          {save.isSuccess && <Notice tone="ok">Saved.</Notice>}
          {canWrite && <button className="btn btn-primary justify-self-start" disabled={save.isPending}>Save</button>}
        </form>
      </Loading>
    </>
  )
}
