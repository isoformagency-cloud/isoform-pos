import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAsk } from '../components/Ask'
import { Loading, Notice, PageHeader } from '../components/ui'
import { api } from '../lib/api'

const LEVELS: Record<string, string> = { none: 'No access', view: 'View', manage: 'Manage' }
const ROLES: Record<string, string> = {
  admin: 'Admin', manager: 'Manager', cashier: 'Cashier', waiter: 'Waiter', kitchen: 'Kitchen staff', accountant: 'Accountant',
}

export function Permissions() {
  const queryClient = useQueryClient()
  const { ask, node } = useAsk()
  const query = useQuery({ queryKey: ['permissions'], queryFn: () => api('/permissions') })
  const save = useMutation({
    mutationFn: ({ role, levels }: { role: string; levels: Record<string, string> }) => api(`/permissions/${role}`, { method: 'PUT', body: { levels } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['permissions'] }),
  })
  const data = query.data

  async function reset() {
    if (!(await ask('Put every role back to its starting access?', [], 'Reset'))) return
    for (const row of data.grid) save.mutate({ role: row.role, levels: {} })
  }

  const action = <button className="btn btn-secondary" disabled={!data || save.isPending} onClick={reset}>Reset to starting access</button>

  return (
    <>
      {node}
      <PageHeader title="Permissions" text="Choose what each role can see and do. Owners always have full access." action={action} />
      {save.error && <div className="mb-3"><Notice>{save.error.message}</Notice></div>}
      <Loading ready={!query.isPending} error={query.error}>
        {data && (
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[52rem] text-sm">
              <thead>
                <tr className="text-left text-ink-soft">
                  <th scope="col" className="p-3 font-medium">Section</th>
                  {data.grid.map((row: any) => <th key={row.role} scope="col" className="p-3 font-medium">{ROLES[row.role]}</th>)}
                </tr>
              </thead>
              <tbody>
                {data.modules.map((module: any) => (
                  <tr key={module.key}>
                    <th scope="row" className="border-t border-line p-3 text-left font-medium whitespace-nowrap">{module.label}</th>
                    {data.grid.map((row: any) => {
                      const changed = row.levels[module.key] !== row.defaults[module.key]
                      return (
                        <td key={row.role} className="border-t border-line p-2">
                          <select
                            aria-label={`${module.label} for ${ROLES[row.role]}`}
                            className={`h-9 w-full rounded-lg border bg-white px-1.5 text-sm ${changed ? 'border-brand font-medium' : 'border-line'}`}
                            value={row.levels[module.key]}
                            disabled={save.isPending}
                            onChange={(event) => save.mutate({ role: row.role, levels: { ...row.levels, [module.key]: event.target.value } })}
                          >
                            {module.levels.map((level: string) => <option key={level} value={level}>{LEVELS[level]}</option>)}
                          </select>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <ul className="mt-3 grid max-w-2xl gap-1 text-sm text-ink-soft">
          <li>A purple outline marks a change from the starting access.</li>
          <li>Manage never hands out refunds, credit notes, cancellations or full discounts. Those stay with the roles that start with them.</li>
          <li>Staff, devices, branches and settings aren’t listed, so a PIN on a shared tablet can never reach them.</li>
          <li>Anyone already signed in sees changes the next time they open the app.</li>
        </ul>
      </Loading>
    </>
  )
}
