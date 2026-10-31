import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, ChevronRight } from 'lucide-react'
import type { Me } from '../App'
import { api, saveActiveBranch, useActiveBranch } from '../lib/api'
import { Loading, PageHeader } from './ui'

/** The branch this screen works in. With several branches and none chosen, there isn't one yet. */
export function useWorkingBranch(me: Me) {
  const active = useActiveBranch()
  return active ?? (me.branchIds.length === 1 ? me.branchIds[0] : null)
}

export function useChooseBranch() {
  const queryClient = useQueryClient()
  return (id: string | null) => {
    saveActiveBranch(id)
    queryClient.invalidateQueries()
  }
}

/** Shown where work has to belong to one branch, so the choice is right there on the screen. */
export function ChooseBranch({ title }: { title: string }) {
  const choose = useChooseBranch()
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => api('/branches') })

  return (
    <div className="mx-auto w-full max-w-md p-5 md:p-8">
      <PageHeader title={title} text="Which branch are you working in? You can change this at the top of the screen." />
      <Loading ready={!branches.isPending} error={branches.error}>
        <ul className="card divide-y divide-line-soft overflow-hidden">
          {branches.data?.items.map((branch: any) => (
            <li key={branch.id}>
              <button className="flex min-h-14 w-full items-center gap-3 px-4 text-left transition-colors hover:bg-paper-soft" onClick={() => choose(branch.id)}>
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-tint text-brand"><Building2 size={18} strokeWidth={1.75} aria-hidden="true" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{branch.name}</span>
                  <span className="block font-mono text-xs text-ink-soft">{branch.code}</span>
                </span>
                <ChevronRight size={17} className="text-ink-faint" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      </Loading>
    </div>
  )
}
