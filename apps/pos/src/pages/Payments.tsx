import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Me } from '../App'
import { useAsk } from '../components/Ask'
import { Badge, Loading, Notice, PageHeader, Segmented, type Tone } from '../components/ui'
import { api } from '../lib/api'
import { money } from '../lib/format'

const STATUS_TONE: Record<string, Tone> = { recorded: 'wait', pending: 'wait', confirmed: 'ok', failed: 'neutral', voided: 'neutral' }

const FILTERS = [
  ['recorded', 'To verify'],
  ['confirmed', 'Confirmed'],
  ['', 'All'],
] as const

export function Payments({ me }: { me: Me }) {
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState<string>('recorded')
  const [openId, setOpenId] = useState<string | null>(null)
  const { ask, node } = useAsk()
  const canVerify = me.permissions.includes('payments.verify')
  const canRefund = me.permissions.includes('payments.refund')

  const list = useQuery({ queryKey: ['payments', filter], queryFn: () => api(`/payments${filter ? `?status=${filter}` : ''}`) })
  const detail = useQuery({ queryKey: ['payment', openId], queryFn: () => api(`/payments/${openId}`), enabled: Boolean(openId) })
  const methods = useQuery({ queryKey: ['methods'], queryFn: () => api('/payment-methods') })

  const act = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: object }) => api(path, { method: 'POST', body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments'] })
      queryClient.invalidateQueries({ queryKey: ['payment'] })
      queryClient.invalidateQueries({ queryKey: ['invoice'] })
    },
  })

  async function withReason(path: string, title: string, label: string) {
    const answer = await ask(title, [{ name: 'reason', label: 'Reason', required: true }], label)
    if (answer) act.mutate({ path, body: { reason: answer.reason } })
  }

  async function refund(payment: any) {
    const allocation = payment.allocations[0]
    if (!allocation) return
    const answer = await ask(`Record a refund on ${allocation.number}`, [
      { name: 'amount', label: 'Amount already refunded to the customer', required: true, inputMode: 'decimal' },
      { name: 'reference', label: 'Refund reference (if any)' },
      { name: 'reason', label: 'Reason', required: true },
    ], 'Record refund')
    if (!answer) return
    const method = methods.data?.items.find((item: any) => item.kind === payment.method_kind)
    act.mutate({
      path: `/payments/${payment.id}/refunds`,
      body: {
        id: crypto.randomUUID(), invoiceId: allocation.invoice_id, amount: answer.amount,
        methodId: method.id, reference: answer.reference || undefined, reason: answer.reason,
      },
    })
  }

  async function confirmAll() {
    const ids = (list.data?.items ?? []).map((item: any) => item.id)
    if (await ask(`Confirm these ${ids.length} payments?`, [], 'Confirm all')) act.mutate({ path: '/payments/confirm-all', body: { ids } })
  }

  const payment = detail.data

  return (
    <>
      {node}
      <PageHeader title="Payments" text="Recorded means it was entered. Confirmed means someone checked it arrived." />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Segmented
          label="Payment filter"
          value={filter || 'all'}
          options={FILTERS.map(([value, label]) => ({ value: value || 'all', label }))}
          onChange={(value) => { setFilter(value === 'all' ? '' : value); setOpenId(null) }}
        />
        {canVerify && filter === 'recorded' && list.data?.items.length > 1 && (
          <button className="btn btn-secondary ml-auto" disabled={act.isPending} onClick={confirmAll}>Confirm all</button>
        )}
      </div>
      {act.error && <div className="mb-3"><Notice>{act.error.message}</Notice></div>}
      <Loading
        ready={!list.isPending}
        error={list.error}
        empty={list.data?.items.length === 0 ? (filter === 'recorded' ? 'Nothing is waiting to be verified.' : 'No payments here yet.') : undefined}
      >
        <ul className="card divide-y divide-line-soft overflow-hidden">
          {list.data?.items.map((item: any) => (
            <li key={item.id}>
              <button className="flex w-full flex-wrap items-center justify-between gap-3 p-4 text-left hover:bg-paper-soft" aria-expanded={openId === item.id} onClick={() => setOpenId(openId === item.id ? null : item.id)}>
                <span>
                  <span className="font-medium">{item.method_name}</span>
                  <span className="block text-sm text-ink-soft">{item.reference ? `${item.reference} · ` : ''}{item.recorded_by_name}</span>
                </span>
                <span className="flex items-center gap-2 text-right">
                  {item.refund_state !== 'none' && <Badge tone="wait">{item.refund_state.replace('_', ' ')}</Badge>}
                  <Badge tone={STATUS_TONE[item.status]}><span className="capitalize">{item.status}</span></Badge>
                  <span className="tnum font-medium">{money(item.amount)}</span>
                </span>
              </button>
              {openId === item.id && payment?.id === item.id && (
                <div className="border-t border-line bg-paper-soft p-4 text-sm">
                  {payment.allocations.map((allocation: any) => (
                    <p key={allocation.invoice_id}>Bill {allocation.number}: <span className="tnum">{money(allocation.amount)}</span></p>
                  ))}
                  {payment.status_reason && <p className="mt-1 text-ink-soft">Reason: {payment.status_reason}</p>}
                  {payment.refunds.map((entry: any) => (
                    <p key={entry.id} className="mt-1">Refund <span className="tnum">{money(entry.amount)}</span> · {entry.status} · {entry.reason}</p>
                  ))}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {canVerify && payment.status === 'recorded' && <button className="btn btn-primary" onClick={() => act.mutate({ path: `/payments/${payment.id}/confirm` })}>Confirm received</button>}
                    {canVerify && payment.status === 'recorded' && <button className="btn btn-secondary" onClick={() => withReason(`/payments/${payment.id}/fail`, 'Mark as not received?', 'Mark failed')}>Not received</button>}
                    {canVerify && ['recorded', 'confirmed'].includes(payment.status) && <button className="btn btn-secondary" onClick={() => withReason(`/payments/${payment.id}/void`, 'Void this entry?', 'Void')}>Void</button>}
                    {canRefund && ['recorded', 'confirmed'].includes(payment.status) && payment.allocations.length > 0 && <button className="btn btn-secondary" onClick={() => refund(payment)}>Record refund</button>}
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      </Loading>
    </>
  )
}
