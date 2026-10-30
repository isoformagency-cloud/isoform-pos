import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Me } from '../App'
import { useAsk } from '../components/Ask'
import { Loading, Notice, PageHeader } from '../components/ui'
import { activeBranch, api } from '../lib/api'

const money = (value: string) => `₹${value}`
const MOVEMENT_NAMES: Record<string, string> = {
  sale: 'Cash sale', refund: 'Refund', paid_in: 'Cash added', paid_out: 'Paid out', safe_drop: 'Moved to safe',
  tip_in: 'Tip', tip_out: 'Tip reversed', correction: 'Correction', expense: 'Expense',
}

export function Cash({ me }: { me: Me }) {
  const queryClient = useQueryClient()
  const { ask, node } = useAsk()
  const [viewing, setViewing] = useState<string | null>(null)
  const branch = activeBranch() ?? (me.branchIds.length === 1 ? me.branchIds[0] : null)
  const canReview = me.permissions.includes('cash.review')
  const canMove = me.permissions.includes('cash.move')
  const canUse = me.permissions.includes('cash.use')

  const registers = useQuery({ queryKey: ['registers', branch], queryFn: () => api('/registers'), enabled: Boolean(branch) && canUse })
  const sessions = useQuery({ queryKey: ['sessions', branch], queryFn: () => api('/cash-sessions'), enabled: canUse })
  const session = useQuery({ queryKey: ['session', viewing], queryFn: () => api(`/cash-sessions/${viewing}`), enabled: Boolean(viewing) })

  const act = useMutation({
    mutationFn: ({ path, body }: { path: string; body: object }) => api(path, { method: 'POST', body }),
    onSuccess: (data) => {
      setViewing(data.id)
      queryClient.setQueryData(['session', data.id], data)
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
      queryClient.invalidateQueries({ queryKey: ['registers'] })
    },
  })

  async function open(register: any) {
    const answer = await ask(`Open ${register.name}`, [
      { name: 'amount', label: 'Cash in the drawer now', required: true, inputMode: 'decimal' },
    ], 'Open session')
    if (answer) act.mutate({ path: '/cash-sessions', body: { id: crypto.randomUUID(), registerId: register.id, openingAmount: answer.amount } })
  }

  async function close(id: string) {
    const answer = await ask('Close this session', [
      { name: 'amount', label: 'Count the drawer and enter the total', required: true, inputMode: 'decimal' },
    ], 'Close session')
    if (answer) act.mutate({ path: `/cash-sessions/${id}/close`, body: { countedAmount: answer.amount } })
  }

  async function move(id: string, type: string, title: string) {
    const answer = await ask(title, [
      { name: 'amount', label: 'Amount', required: true, inputMode: 'decimal' },
      { name: 'reason', label: 'Reason', required: true },
    ], 'Save')
    if (answer) act.mutate({ path: `/cash-sessions/${id}/movements`, body: { type, amount: answer.amount, reason: answer.reason } })
  }

  async function review(id: string) {
    const answer = await ask('Review this session', [{ name: 'note', label: 'Note (needed if there is a difference)' }], 'Mark reviewed')
    if (answer) act.mutate({ path: `/cash-sessions/${id}/review`, body: answer.note ? { note: answer.note } : {} })
  }

  const current = session.data

  return (
    <>
      {node}
      <PageHeader title="Cash" text="Every rupee in or out of the drawer is recorded. Differences stay on record." />
      {!branch && <Notice>Choose a branch from the menu to use the drawer.</Notice>}
      {act.error && <div className="mb-3"><Notice>{act.error.message}</Notice></div>}

      <Loading ready={!registers.isPending || !branch} error={registers.error}>
        <ul className="mb-6 grid gap-3 sm:grid-cols-2">
          {registers.data?.items.map((register: any) => (
            <li key={register.id} className="card flex items-center justify-between gap-3 p-4">
              <div>
                <p className="font-medium">{register.name}</p>
                <p className="text-sm text-ink-soft">{register.open_session_id ? 'Session open' : 'Closed'}</p>
              </div>
              {register.open_session_id
                ? <button className="btn btn-secondary" onClick={() => setViewing(register.open_session_id)}>View</button>
                : <button className="btn btn-primary" disabled={act.isPending} onClick={() => open(register)}>Open session</button>}
            </li>
          ))}
        </ul>
      </Loading>

      {current && (
        <section className="card mb-6 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-xl">{current.register_name}</h2>
              <p className="text-sm capitalize text-ink-soft">{current.status} · {current.business_date} · opened by {current.opened_by_name}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {current.status === 'open' && canMove && <button className="btn btn-secondary" onClick={() => move(current.id, 'safe_drop', 'Move cash to the safe')}>To safe</button>}
              {current.status === 'open' && canMove && <button className="btn btn-secondary" onClick={() => move(current.id, 'paid_out', 'Pay out cash')}>Pay out</button>}
              {current.status === 'open' && canMove && <button className="btn btn-secondary" onClick={() => move(current.id, 'paid_in', 'Add cash')}>Add cash</button>}
              {current.status === 'open' && <button className="btn btn-primary" onClick={() => close(current.id)}>Close session</button>}
              {current.status === 'closed' && canReview && <button className="btn btn-primary" onClick={() => review(current.id)}>Review</button>}
            </div>
          </div>

          <dl className="mt-4 grid gap-1 font-mono text-sm sm:max-w-sm">
            <div className="flex justify-between"><dt>Opening</dt><dd>{money(current.opening_amount)}</dd></div>
            {current.running_expected && current.status === 'open' && <div className="flex justify-between"><dt>Expected now</dt><dd>{money(Number(current.running_expected).toFixed(2))}</dd></div>}
            {current.expected_amount && <div className="flex justify-between"><dt>Expected</dt><dd>{money(current.expected_amount)}</dd></div>}
            {current.counted_amount && <div className="flex justify-between"><dt>Counted</dt><dd>{money(current.counted_amount)}</dd></div>}
            {current.variance && (
              <div className={`mt-1 flex justify-between rounded-lg px-2 py-1 font-medium ${Number(current.variance) === 0 ? 'bg-ok-tint text-ok' : 'bg-wait-tint text-wait'}`}>
                <dt>{Number(current.variance) === 0 ? 'Matches' : Number(current.variance) < 0 ? 'Short' : 'Over'}</dt>
                <dd>{money(current.variance.replace('-', ''))}</dd>
              </div>
            )}
            {current.status === 'closed' && !current.variance && <p className="font-sans text-ink-soft">Thanks. A manager will review this count.</p>}
          </dl>
          {current.review_note && <p className="mt-2 text-sm text-ink-soft">Review note: {current.review_note}</p>}

          {current.movements.length > 0 && (
            <ul className="mt-4 divide-y divide-line border-t border-line text-sm">
              {current.movements.map((movement: any) => (
                <li key={movement.id} className="flex justify-between gap-3 py-2">
                  <span>{MOVEMENT_NAMES[movement.movement_type]}{movement.reason ? ` · ${movement.reason}` : ''} <span className="text-ink-soft">· {movement.recorded_by_name}</span></span>
                  <span className="font-mono">{movement.direction > 0 ? '+' : '−'}{movement.amount}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {sessions.data?.items.length > 0 && (
        <>
          <h2 className="mb-2 text-xl">Sessions</h2>
          <ul className="card divide-y divide-line">
            {sessions.data.items.map((item: any) => (
              <li key={item.id}>
                <button className="flex w-full items-center justify-between gap-3 p-3 text-left text-sm hover:bg-paper-soft" onClick={() => setViewing(item.id)}>
                  <span>{item.business_date} · {item.register_name} · <span className="capitalize">{item.status}</span></span>
                  {item.variance && Number(item.variance) !== 0 && <span className="font-mono text-wait">{item.variance}</span>}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  )
}
