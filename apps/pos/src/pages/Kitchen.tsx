import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ChefHat, Clock, Expand, Minimize, Undo2 } from 'lucide-react'
import type { Me } from '../App'
import { TYPE_LOOK, typeName } from '../components/order-look'
import { Notice, Segmented } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { time } from '../lib/format'

const COLUMNS = [
  { status: 'new', label: 'New', note: 'Just received', dot: 'bg-sky', next: 'preparing', action: 'Start preparing' },
  { status: 'preparing', label: 'Preparing', note: 'In progress', dot: 'bg-wait', next: 'ready', action: 'Mark ready' },
  { status: 'ready', label: 'Ready', note: 'Waiting to be served', dot: 'bg-ok', next: 'completed', action: 'Mark served' },
  { status: 'completed', label: 'Completed', note: 'Last 2 hours', dot: 'bg-line-strong', next: null, action: '' },
] as const

const PREVIOUS: Record<string, string> = { preparing: 'new', ready: 'preparing', completed: 'ready' }
const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'dine_in', label: 'Dine-in' },
  { value: 'takeaway', label: 'Takeaway' },
  { value: 'delivery', label: 'Delivery' },
]

const minutes = (from: string, to = Date.now()) => Math.max(0, Math.floor((to - new Date(from).getTime()) / 60000))

export function Kitchen({ me }: { me: Me }) {
  const queryClient = useQueryClient()
  const holder = useRef<HTMLDivElement>(null)
  const [filter, setFilter] = useState('all')
  const [phoneColumn, setPhoneColumn] = useState('new')
  const [error, setError] = useState('')
  const [full, setFull] = useState(false)
  const [, setTick] = useState(0)
  const canUpdate = me.permissions.includes('kitchen.update')

  // Timers should move on their own, even when nothing else on the board changes.
  useEffect(() => {
    const beat = setInterval(() => setTick((value) => value + 1), 30000)
    const sync = () => setFull(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', sync)
    return () => {
      clearInterval(beat)
      document.removeEventListener('fullscreenchange', sync)
    }
  }, [])

  const board = useQuery({ queryKey: ['kitchen'], queryFn: () => api('/kitchen', { branch: true }), refetchInterval: 10000 })
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['kitchen'] })
    queryClient.invalidateQueries({ queryKey: ['alerts'] })
  }

  const move = useMutation({
    mutationFn: ({ id, from, to }: { id: string; from: string; to: string }) => api(`/kitchen/tickets/${id}/status`, { method: 'POST', branch: true, body: { from, to } }),
    onMutate: ({ id, to }) => {
      // The board answers at once. A refusal puts the ticket back on the next refresh.
      queryClient.setQueryData(['kitchen'], (old: any) => old && {
        ...old,
        tickets: old.tickets.map((ticket: any) => (ticket.id === id ? { ...ticket, status: to } : ticket)),
      })
      setError('')
    },
    onError: (failure) => {
      if (!(failure instanceof ApiError && failure.code === 'stale_ticket')) setError(failure.message)
    },
    onSettled: refresh,
  })

  const tick = useMutation({
    mutationFn: ({ id, done }: { id: string; done: boolean }) => api(`/kitchen/items/${id}/tick`, { method: 'POST', branch: true, body: { done } }),
    onMutate: ({ id, done }) => {
      queryClient.setQueryData(['kitchen'], (old: any) => old && {
        ...old,
        tickets: old.tickets.map((ticket: any) => ({
          ...ticket,
          items: ticket.items.map((item: any) => (item.id === id ? { ...item, preparedAt: done ? new Date().toISOString() : null } : item)),
        })),
      })
    },
    onError: (failure) => setError(failure.message),
    onSettled: refresh,
  })

  async function toggleFull() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await holder.current?.requestFullscreen()
    } catch {
      setError('This device doesn’t allow full screen.')
    }
  }

  const delay: number = board.data?.delayMinutes ?? 15
  const tickets: any[] = (board.data?.tickets ?? []).filter((ticket: any) =>
    filter === 'all' || ticket.order_type === filter || (filter === 'delivery' && ticket.order_type === 'aggregator'))
  const live = tickets.filter((ticket) => ticket.status !== 'completed')
  const delayed = live.filter((ticket) => ticket.status !== 'ready' && minutes(ticket.sent_at) >= delay)
  const inColumn = (status: string) => {
    const rows = tickets.filter((ticket) => ticket.status === status)
    return status === 'completed' ? rows.reverse() : rows
  }

  return (
    <div ref={holder} className="flex min-h-[calc(100svh-7.5rem)] flex-col bg-paper-soft lg:h-[calc(100svh-3.5rem)] lg:min-h-0">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line-soft bg-white px-3 py-2.5 md:px-5">
        <div className="flex items-center gap-2.5">
          <ChefHat size={20} strokeWidth={1.75} aria-hidden="true" />
          <div>
            <h1 className="text-lg leading-tight">Kitchen display</h1>
            <p className="text-xs text-ink-soft">
              {live.length} active
              {delayed.length > 0 && <span className="font-medium text-bad"> · {delayed.length} delayed (over {delay} min)</span>}
            </p>
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Segmented label="Order type" value={filter} options={FILTERS} onChange={setFilter} />
          <button aria-label={full ? 'Leave full screen' : 'Full screen'} title={full ? 'Leave full screen' : 'Full screen'} className="btn btn-secondary btn-icon" onClick={toggleFull}>
            {full ? <Minimize size={17} aria-hidden="true" /> : <Expand size={17} aria-hidden="true" />}
          </button>
        </div>
      </div>

      {error && <div className="px-3 pt-2 md:px-5"><Notice>{error}</Notice></div>}
      {board.error && <div className="px-3 pt-2 md:px-5"><Notice>{board.error.message}</Notice></div>}
      {board.isPending && <p className="p-5 text-sm text-ink-soft">Loading tickets…</p>}

      <div className="px-3 pt-2 lg:hidden">
        <Segmented
          label="Kitchen column"
          value={phoneColumn}
          options={COLUMNS.map((column) => ({ value: column.status, label: column.label, count: inColumn(column.status).length }))}
          onChange={setPhoneColumn}
        />
      </div>

      <div className="grid min-h-0 flex-1 gap-3 p-3 md:p-4 lg:grid-cols-4">
        {COLUMNS.map((column) => {
          const rows = inColumn(column.status)
          return (
            <section key={column.status} aria-label={column.label} className={`min-h-0 flex-col rounded-2xl bg-mist/70 lg:flex ${phoneColumn === column.status ? 'flex' : 'hidden'}`}>
              <header className="flex items-center gap-2 px-3 py-2.5">
                <span className={`size-2 rounded-full ${column.dot}`} />
                <h2 className="text-sm">{column.label}</h2>
                <span className="tnum text-sm text-ink-soft">{rows.length}</span>
                <span className="ml-auto text-xs text-ink-soft">{column.note}</span>
              </header>
              <ul className="thin-scroll grid min-h-0 flex-1 content-start gap-2 overflow-y-auto px-2 pb-2">
                {rows.length === 0 && <li className="px-2 py-6 text-center text-sm text-ink-faint">Nothing here</li>}
                {rows.map((ticket) => (
                  <Ticket
                    key={ticket.id}
                    ticket={ticket}
                    delay={delay}
                    action={column.action}
                    next={column.next}
                    canUpdate={canUpdate}
                    onMove={(to) => move.mutate({ id: ticket.id, from: ticket.status, to })}
                    onTick={(id, done) => tick.mutate({ id, done })}
                  />
                ))}
              </ul>
            </section>
          )
        })}
      </div>
    </div>
  )
}

function Ticket({ ticket, delay, action, next, canUpdate, onMove, onTick }: {
  ticket: any
  delay: number
  action: string
  next: string | null
  canUpdate: boolean
  onMove: (to: string) => void
  onTick: (id: string, done: boolean) => void
}) {
  const { icon: Icon, soft } = TYPE_LOOK[ticket.order_type]
  const done = ticket.status === 'completed'
  const age = minutes(ticket.sent_at, ticket.completed_at ? new Date(ticket.completed_at).getTime() : Date.now())
  const late = !done && ticket.status !== 'ready' && age >= delay
  const where = ticket.table_label || (ticket.aggregator ?? typeName(ticket.order_type))

  return (
    <li className={`card overflow-hidden p-3 ${late ? '!border-bad/50' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-mono text-base font-semibold">#{ticket.display_number}{ticket.round > 1 ? <span className="ml-1.5 font-sans text-xs font-medium text-wait">Round {ticket.round}</span> : null}</p>
          <p className={`flex items-center gap-1.5 text-xs ${soft}`}>
            <Icon size={13} aria-hidden="true" />
            <span className="truncate">{where}{ticket.customer_name ? ` · ${ticket.customer_name}` : ''}</span>
          </p>
        </div>
        <p className={`tnum flex shrink-0 items-center gap-1 text-sm font-medium ${late ? 'text-bad' : 'text-ink-soft'}`}>
          {late ? <AlertTriangle size={14} aria-hidden="true" /> : <Clock size={14} aria-hidden="true" />}
          {age}m
        </p>
      </div>

      <ul className="mt-2 space-y-0.5">
        {ticket.items.map((item: any) => (
          <li key={item.id}>
            <label className={`flex min-h-9 items-start gap-2.5 py-1 text-sm ${item.voided ? 'text-ink-faint line-through' : ''}`}>
              <input
                type="checkbox"
                className="mt-0.5 size-[1.125rem] shrink-0"
                checked={Boolean(item.preparedAt)}
                disabled={!canUpdate || done || item.voided}
                onChange={(event) => onTick(item.id, event.target.checked)}
              />
              <span className={item.preparedAt && !item.voided ? 'text-ink-faint line-through' : ''}>
                <span className="tnum font-semibold">{Number(item.quantity)}×</span> {item.name}{item.variant !== 'Regular' ? ` · ${item.variant}` : ''}
                {item.addons.map((addon: string) => <span key={addon} className="block text-xs text-ink-soft">+ {addon}</span>)}
                {item.notes && <span className="block text-xs font-medium text-wait">{item.notes}</span>}
              </span>
            </label>
          </li>
        ))}
      </ul>

      {ticket.notes && <p className="mt-1.5 rounded-lg bg-wait-tint px-2 py-1.5 text-xs text-wait">Note: {ticket.notes}</p>}

      {done && <p className="mt-2 text-xs text-ink-soft">Served {time(ticket.completed_at)}</p>}
      {canUpdate && (
        <div className="mt-2 flex gap-1.5">
          {PREVIOUS[ticket.status] && (
            <button aria-label="Move back one step" title="Move back one step" className="btn btn-secondary btn-icon !min-h-10" onClick={() => onMove(PREVIOUS[ticket.status])}>
              <Undo2 size={16} aria-hidden="true" />
            </button>
          )}
          {next && <button className={`btn flex-1 !min-h-10 ${ticket.status === 'new' ? 'btn-secondary' : 'btn-primary'}`} onClick={() => onMove(next)}>{ticket.order_type === 'dine_in' || ticket.status !== 'ready' ? action : 'Handed over'}</button>}
        </div>
      )}
    </li>
  )
}
