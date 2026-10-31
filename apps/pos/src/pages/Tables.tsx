import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarClock, LayoutGrid, Map as MapIcon, Pencil, Plus, Users, UtensilsCrossed } from 'lucide-react'
import { useNavigate } from 'react-router'
import type { Me } from '../App'
import { useAsk } from '../components/Ask'
import { ChooseBranch, useWorkingBranch } from '../components/BranchPicker'
import { Badge, Empty, Modal, Notice, PageHeader, Segmented } from '../components/ui'
import { api } from '../lib/api'
import { dateTime, localDate, money, time } from '../lib/format'

export const STATES: Record<string, { label: string; tile: string; dot: string }> = {
  available: { label: 'Available', tile: 'border-line bg-white text-ink', dot: 'bg-ok' },
  occupied: { label: 'Occupied', tile: 'border-brand-300 bg-brand-tint text-brand-deep', dot: 'bg-brand' },
  reserved: { label: 'Reserved', tile: 'border-sky/40 bg-sky-tint text-sky', dot: 'bg-sky' },
  waiting: { label: 'Waiting', tile: 'border-wait/40 bg-wait-tint text-wait', dot: 'bg-wait' },
  billing: { label: 'Billing', tile: 'border-ink bg-ink text-white', dot: 'bg-ink' },
}

// The floor is a fixed 1000 by 640 grid, so a layout looks the same on every screen.
const GRID_W = 1000
const SIZE: Record<string, { w: number; h: number; radius: string }> = {
  square: { w: 120, h: 110, radius: '1rem' },
  round: { w: 116, h: 116, radius: '50%' },
  long: { w: 190, h: 100, radius: '1rem' },
}

const minutesSince = (value: string) => Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000))

function detail(table: any) {
  if (table.state === 'occupied' || table.state === 'billing') return `${money(table.amount ?? 0)} · ${minutesSince(table.order_started)}m`
  if (table.state === 'reserved') return time(table.reservation.reservedAt)
  if (table.state === 'waiting') return `${minutesSince(table.seated_at)}m`
  return `${table.seats} seats`
}

function TableFace({ table }: { table: any }) {
  return (
    <>
      <span className="block font-display text-lg leading-tight font-semibold">{table.name}</span>
      <span className="block text-xs">{STATES[table.state].label}</span>
      <span className="tnum block text-xs opacity-80">{detail(table)}</span>
    </>
  )
}

export function Tables({ me }: { me: Me }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const branch = useWorkingBranch(me)
  const canManage = me.permissions.includes('tables.manage')
  const [areaId, setAreaId] = useState('')
  const [view, setView] = useState<'floor' | 'cards'>(window.innerWidth < 768 ? 'cards' : 'floor')
  const [editing, setEditing] = useState(false)
  const [picked, setPicked] = useState<string | null>(null)
  const [edit, setEdit] = useState<any | 'new' | null>(null)
  const [reserving, setReserving] = useState<any | null>(null)
  const [picking, setPicking] = useState<{ mode: 'move' | 'merge'; table: any } | null>(null)
  const { ask, node } = useAsk()

  const floor = useQuery({ queryKey: ['floor', branch], queryFn: () => api('/floor', { branch: true }), enabled: Boolean(branch), refetchInterval: 20000 })
  const reservations = useQuery({ queryKey: ['floor', 'reservations'], queryFn: () => api('/reservations', { branch: true }), enabled: Boolean(branch) })

  const act = useMutation({
    mutationFn: ({ path, method = 'POST', body }: { path: string; method?: string; body?: object }) => api(path, { method, body: body ?? {}, branch: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['floor'] })
      queryClient.invalidateQueries({ queryKey: ['orders'] })
      setPicked(null)
      setPicking(null)
      setEdit(null)
      setReserving(null)
    },
  })

  if (!branch) {
    return <ChooseBranch title="Tables" />
  }

  const areas: any[] = floor.data?.areas ?? []
  const tables: any[] = floor.data?.tables ?? []
  const area = areas.find((item) => item.id === areaId) ?? areas[0]
  const shown = tables.filter((table) => table.area_id === area?.id)
  const counts = Object.keys(STATES).map((state) => ({ state, count: tables.filter((table) => table.state === state).length }))
  const current = tables.find((table) => table.id === picked)
  const height = Math.max(640, ...shown.map((table) => table.pos_y + 180))

  async function addArea() {
    const answer = await ask('Add an area', [{ name: 'name', label: 'Area name', required: true, placeholder: 'Outdoor' }], 'Add area')
    if (answer) act.mutate({ path: '/areas', body: { name: answer.name } })
  }

  async function renameArea() {
    const answer = await ask(`Rename ${area.name}`, [{ name: 'name', label: 'Area name', required: true, defaultValue: area.name }], 'Save')
    if (answer) act.mutate({ path: `/areas/${area.id}`, method: 'PATCH', body: { name: answer.name } })
  }

  async function removeArea() {
    if (await ask(`Remove ${area.name}?`, [], 'Remove')) act.mutate({ path: `/areas/${area.id}`, method: 'PATCH', body: { isActive: false } })
  }

  async function seat(table: any) {
    const answer = await ask(`Seat guests at ${table.name}`, [{ name: 'guests', label: 'Guests (optional)', inputMode: 'numeric' }], 'Seat guests')
    if (answer) act.mutate({ path: `/tables/${table.id}/seat`, body: answer.guests ? { guests: Number(answer.guests) } : {} })
  }

  const header = (
    <PageHeader
      title="Tables"
      text="Tap a table to start an order, reserve it, or move guests."
      action={canManage && (
        <div className="flex flex-wrap gap-2">
          {editing && <button className="btn btn-secondary" onClick={addArea}><Plus size={16} aria-hidden="true" /> Add area</button>}
          {editing && areas.length > 0 && <button className="btn btn-secondary" onClick={() => setEdit('new')}><Plus size={16} aria-hidden="true" /> Add table</button>}
          <button className={`btn ${editing ? 'btn-primary' : 'btn-secondary'}`} onClick={() => { setEditing(!editing); setView('floor') }}>
            <Pencil size={15} aria-hidden="true" /> {editing ? 'Done' : 'Edit layout'}
          </button>
        </div>
      )}
    />
  )

  return (
    <>
      {node}
      {header}
      {act.error && !edit && !reserving && !picked && !picking && <div className="mb-3"><Notice>{act.error.message}</Notice></div>}
      {floor.error && <Notice>{floor.error.message}</Notice>}
      {floor.isPending && <p className="py-6 text-sm text-ink-soft">Loading tables…</p>}

      {floor.data && areas.length === 0 && (
        <Empty
          icon={UtensilsCrossed}
          title="No tables yet"
          text={canManage ? 'Add an area such as Indoor, then add your tables.' : 'A manager needs to set up the tables first.'}
          action={canManage ? <button className="btn btn-primary" onClick={() => { setEditing(true); addArea() }}>Add your first area</button> : undefined}
        />
      )}

      {areas.length > 0 && (
        <>
          <ul className="mb-3 flex flex-wrap gap-2">
            {counts.map(({ state, count }) => (
              <li key={state} className="flex items-center gap-2 rounded-lg border border-line-soft bg-white px-2.5 py-1.5 text-sm shadow-card">
                <span className={`size-2 rounded-full ${STATES[state].dot}`} />
                {STATES[state].label}
                <span className="tnum font-medium">{count}</span>
              </li>
            ))}
          </ul>

          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Segmented
              label="Area"
              value={area?.id ?? ''}
              options={areas.map((item) => ({ value: item.id, label: item.name, count: tables.filter((table) => table.area_id === item.id).length }))}
              onChange={setAreaId}
            />
            {editing && <button className="btn btn-ghost btn-sm" onClick={renameArea}>Rename</button>}
            {editing && <button className="btn btn-ghost btn-sm" onClick={removeArea}>Remove</button>}
            <div className="ml-auto flex rounded-[0.625rem] bg-mist p-1">
              {([['floor', MapIcon, 'Floor plan'], ['cards', LayoutGrid, 'Cards']] as const).map(([value, Icon, label]) => (
                <button key={value} aria-pressed={view === value} className={`flex min-h-8 items-center gap-1.5 rounded-md px-2.5 text-sm ${view === value ? 'bg-white font-medium shadow-card' : 'text-ink-soft'}`} onClick={() => setView(value)}>
                  <Icon size={14} aria-hidden="true" /> {label}
                </button>
              ))}
            </div>
          </div>

          {shown.length === 0 && <Empty title="No tables in this area" text={!canManage ? undefined : editing ? 'Choose Add table above.' : 'Choose Edit layout, then Add table.'} />}

          {shown.length > 0 && view === 'floor' && (
            <FloorPlan
              tables={shown}
              height={height}
              editing={editing}
              onTap={(table) => (editing ? setEdit(table) : setPicked(table.id))}
              onMoved={(id, x, y) => {
                // The table stays where it was dropped while the new spot saves.
                queryClient.setQueryData(['floor', branch], (old: any) => old && {
                  ...old,
                  tables: old.tables.map((table: any) => (table.id === id ? { ...table, pos_x: x, pos_y: y } : table)),
                })
                act.mutate({ path: '/tables/layout', method: 'PUT', body: { positions: [{ id, x, y }] } })
              }}
            />
          )}

          {shown.length > 0 && view === 'cards' && (
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {shown.map((table) => (
                <li key={table.id}>
                  <button className={`min-h-24 w-full rounded-xl border p-3 text-left shadow-card ${STATES[table.state].tile}`} onClick={() => (editing ? setEdit(table) : setPicked(table.id))}>
                    <TableFace table={table} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {reservations.data?.items.length > 0 && (
            <section className="mt-6">
              <h2 className="mb-2 text-lg">Upcoming reservations</h2>
              <ul className="card divide-y divide-line-soft overflow-hidden">
                {reservations.data.items.map((item: any) => (
                  <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
                    <span className="flex items-center gap-3">
                      <CalendarClock size={17} strokeWidth={1.75} className="shrink-0 text-sky" aria-hidden="true" />
                      <span>
                        <span className="font-medium">{item.guest_name}</span>
                        <span className="block text-ink-soft">{dateTime(item.reserved_at)} · {item.table_name} · {item.guests} guests{item.phone ? ` · ${item.phone}` : ''}</span>
                      </span>
                    </span>
                    <span className="flex gap-1.5">
                      <button className="btn btn-secondary btn-sm" disabled={act.isPending} onClick={() => act.mutate({ path: `/reservations/${item.id}`, method: 'PATCH', body: { status: 'seated' } })}>Seat</button>
                      <button className="btn btn-ghost btn-sm" disabled={act.isPending} onClick={() => act.mutate({ path: `/reservations/${item.id}`, method: 'PATCH', body: { status: 'cancelled' } })}>Cancel</button>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {current && !picking && !reserving && (
        <Modal
          title={`Table ${current.name}`}
          text={`${STATES[current.state].label} · ${current.seats} seats`}
          onClose={() => setPicked(null)}
        >
          <div className="grid gap-2">
            {act.error && <Notice>{act.error.message}</Notice>}
            {current.reservation && !current.order_id && (
              <div className="rounded-xl bg-sky-tint p-3 text-sm text-sky">
                <p className="font-medium">{current.reservation.guestName} · {current.reservation.guests} guests</p>
                <p>{time(current.reservation.reservedAt)}{current.reservation.phone ? ` · ${current.reservation.phone}` : ''}</p>
              </div>
            )}
            {current.order_id ? (
              <>
                <div className="tnum flex items-center justify-between rounded-xl bg-paper-soft p-3 text-sm">
                  <span>Order #{current.display_number} · {current.item_count} {current.item_count === 1 ? 'item' : 'items'}{current.guest_count ? ` · ${current.guest_count} guests` : ''}</span>
                  <span className="font-semibold">{money(current.amount ?? 0)}</span>
                </div>
                <button className="btn btn-primary" onClick={() => navigate(`/pos?order=${current.order_id}`)}>Open order</button>
                <div className="grid grid-cols-2 gap-2">
                  <button className="btn btn-secondary" onClick={() => setPicking({ mode: 'move', table: current })}>Move</button>
                  <button className="btn btn-secondary" disabled={Boolean(current.confirmed_at)} onClick={() => setPicking({ mode: 'merge', table: current })}>Merge</button>
                </div>
                {current.confirmed_at && <p className="text-xs text-ink-soft">Confirmed orders can be moved but not merged.</p>}
              </>
            ) : (
              <>
                <button className="btn btn-primary" onClick={() => navigate(`/pos?table=${current.id}`)}>Start order</button>
                {current.state === 'available' && <button className="btn btn-secondary" onClick={() => seat(current)}><Users size={16} aria-hidden="true" /> Seat guests</button>}
                {current.state === 'waiting' && <button className="btn btn-secondary" disabled={act.isPending} onClick={() => act.mutate({ path: `/tables/${current.id}/clear` })}>Mark available</button>}
                {current.state === 'reserved' && (
                  <div className="grid grid-cols-2 gap-2">
                    <button className="btn btn-secondary" disabled={act.isPending} onClick={() => act.mutate({ path: `/reservations/${current.reservation.id}`, method: 'PATCH', body: { status: 'seated' } })}>Guests arrived</button>
                    <button className="btn btn-secondary" disabled={act.isPending} onClick={() => act.mutate({ path: `/reservations/${current.reservation.id}`, method: 'PATCH', body: { status: 'cancelled' } })}>Cancel booking</button>
                  </div>
                )}
                <button className="btn btn-secondary" onClick={() => setReserving(current)}><CalendarClock size={16} aria-hidden="true" /> Reserve</button>
              </>
            )}
          </div>
        </Modal>
      )}

      {picking && (
        <PickTable
          mode={picking.mode}
          source={picking.table}
          tables={tables}
          error={act.error?.message}
          busy={act.isPending}
          onClose={() => setPicking(null)}
          onPick={(target) => {
            if (picking.mode === 'move') {
              act.mutate({ path: `/orders/${picking.table.order_id}`, method: 'PATCH', body: { version: picking.table.order_version, tableId: target.id } })
            } else {
              act.mutate({ path: `/orders/${picking.table.order_id}/merge`, body: { version: picking.table.order_version, intoId: target.order_id, intoVersion: target.order_version } })
            }
          }}
        />
      )}

      {reserving && (
        <ReserveDialog
          table={reserving}
          error={act.error?.message}
          busy={act.isPending}
          onClose={() => setReserving(null)}
          onSave={(body) => act.mutate({ path: '/reservations', body: { tableId: reserving.id, ...body } })}
        />
      )}

      {edit && (
        <TableEditor
          table={edit === 'new' ? null : edit}
          areas={areas}
          defaultArea={area?.id}
          error={act.error?.message}
          busy={act.isPending}
          onClose={() => setEdit(null)}
          onSave={(body) => act.mutate(edit === 'new' ? { path: '/tables', body } : { path: `/tables/${edit.id}`, method: 'PATCH', body })}
          onRemove={edit === 'new' ? undefined : () => act.mutate({ path: `/tables/${edit.id}`, method: 'PATCH', body: { isActive: false } })}
        />
      )}
    </>
  )
}

function FloorPlan({ tables, height, editing, onTap, onMoved }: {
  tables: any[]
  height: number
  editing: boolean
  onTap: (table: any) => void
  onMoved: (id: string, x: number, y: number) => void
}) {
  const canvas = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<{ id: string; x: number; y: number; moved: boolean; offsetX: number; offsetY: number } | null>(null)

  const scale = () => (canvas.current?.clientWidth ?? GRID_W) / GRID_W
  const place = (event: ReactPointerEvent, table: any) => {
    const box = canvas.current!.getBoundingClientRect()
    const size = SIZE[table.shape]
    const raw = (px: number, origin: number, offset: number) => (px - origin) / scale() - offset
    // Snapping keeps rows straight without any fiddling.
    const snap = (value: number, max: number) => Math.min(max, Math.max(0, Math.round(value / 10) * 10))
    return {
      x: snap(raw(event.clientX, box.left, drag?.offsetX ?? 0), GRID_W - size.w),
      y: snap(raw(event.clientY, box.top, drag?.offsetY ?? 0), 1000 - size.h),
    }
  }

  return (
    <div
      ref={canvas}
      className={`card relative w-full overflow-hidden ${editing ? 'bg-[radial-gradient(var(--color-line)_1px,transparent_1px)] [background-size:24px_24px]' : ''}`}
      style={{ aspectRatio: `${GRID_W} / ${height}` }}
    >
      {tables.map((table) => {
        const size = SIZE[table.shape]
        const held = drag?.id === table.id ? drag : null
        const x = held ? held.x : table.pos_x
        const y = held ? held.y : table.pos_y
        return (
          <button
            key={table.id}
            className={`absolute grid place-content-center border p-1 text-center leading-tight shadow-card transition-shadow ${STATES[table.state].tile} ${editing ? 'cursor-grab touch-none active:cursor-grabbing' : 'hover:shadow-float'} ${held ? 'z-10 shadow-float' : ''}`}
            style={{
              left: `${(x / GRID_W) * 100}%`,
              top: `${(y / height) * 100}%`,
              width: `${(size.w / GRID_W) * 100}%`,
              height: `${(size.h / height) * 100}%`,
              borderRadius: size.radius,
            }}
            onClick={() => { if (!editing) onTap(table) }}
            onPointerDown={(event) => {
              if (!editing) return
              event.currentTarget.setPointerCapture(event.pointerId)
              const box = event.currentTarget.getBoundingClientRect()
              setDrag({ id: table.id, x, y, moved: false, offsetX: (event.clientX - box.left) / scale(), offsetY: (event.clientY - box.top) / scale() })
            }}
            onPointerMove={(event) => {
              if (held) setDrag({ ...held, ...place(event, table), moved: true })
            }}
            onPointerUp={() => {
              if (!held) return
              if (held.moved) onMoved(table.id, held.x, held.y)
              else onTap(table)
              setDrag(null)
            }}
          >
            <TableFace table={table} />
          </button>
        )
      })}
    </div>
  )
}

function PickTable({ mode, source, tables, error, busy, onPick, onClose }: {
  mode: 'move' | 'merge'
  source: any
  tables: any[]
  error?: string
  busy: boolean
  onPick: (table: any) => void
  onClose: () => void
}) {
  const options = tables.filter((table) => table.id !== source.id && (mode === 'move' ? !table.order_id : table.state === 'occupied'))
  return (
    <Modal
      title={mode === 'move' ? `Move order from ${source.name}` : `Merge ${source.name} into…`}
      text={mode === 'merge' ? `All items from ${source.name} join the table you choose, and ${source.name} becomes free.` : undefined}
      onClose={onClose}
    >
      {error && <div className="mb-2"><Notice>{error}</Notice></div>}
      {options.length === 0 && <p className="py-3 text-sm text-ink-soft">{mode === 'move' ? 'No free tables right now.' : 'No other open tables to merge with.'}</p>}
      <ul className="grid grid-cols-3 gap-2">
        {options.map((table) => (
          <li key={table.id}>
            <button disabled={busy} className={`min-h-20 w-full rounded-xl border p-2 text-center ${STATES[table.state].tile}`} onClick={() => onPick(table)}>
              <TableFace table={table} />
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  )
}

function ReserveDialog({ table, error, busy, onSave, onClose }: {
  table: any
  error?: string
  busy: boolean
  onSave: (body: object) => void
  onClose: () => void
}) {
  return (
    <Modal title={`Reserve ${table.name}`} onClose={onClose}>
      <form
        className="grid grid-cols-2 gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          const form = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>
          onSave({
            guestName: form.guestName.trim(),
            phone: form.phone || undefined,
            guests: Number(form.guests),
            reservedAt: new Date(`${form.date}T${form.time}`).toISOString(),
          })
        }}
      >
        <label className="field col-span-2">Guest name<input name="guestName" required maxLength={80} /></label>
        <label className="field">Mobile (optional)<input name="phone" inputMode="numeric" pattern="\d{10}" title="10 digits" /></label>
        <label className="field">Guests<input name="guests" type="number" min={1} max={200} defaultValue={Math.min(table.seats, 4)} required /></label>
        <label className="field">Date<input name="date" type="date" min={localDate()} defaultValue={localDate()} required /></label>
        <label className="field">Time<input name="time" type="time" required /></label>
        {error && <div className="col-span-2"><Notice>{error}</Notice></div>}
        <button className="btn btn-primary col-span-2" disabled={busy}>Save reservation</button>
      </form>
    </Modal>
  )
}

function TableEditor({ table, areas, defaultArea, error, busy, onSave, onRemove, onClose }: {
  table: any | null
  areas: any[]
  defaultArea?: string
  error?: string
  busy: boolean
  onSave: (body: object) => void
  onRemove?: () => void
  onClose: () => void
}) {
  const settings = useQuery({ queryKey: ['pos-settings'], queryFn: () => api('/pos-settings') })
  const defaultSeats = settings.data?.default_seats ?? 4
  return (
    <Modal title={table ? `Edit ${table.name}` : 'Add table'} onClose={onClose}>
      <form
        className="grid grid-cols-2 gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          const form = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>
          onSave({ name: form.name.trim(), seats: Number(form.seats), shape: form.shape, areaId: form.areaId })
        }}
      >
        <label className="field">Table name<input name="name" required maxLength={30} defaultValue={table?.name} placeholder="T1" /></label>
        <label className="field">Seats<input name="seats" type="number" min={1} max={100} defaultValue={table?.seats ?? defaultSeats} required /></label>
        <label className="field">
          Shape
          <select name="shape" defaultValue={table?.shape ?? 'square'}>
            <option value="square">Square</option>
            <option value="round">Round</option>
            <option value="long">Long</option>
          </select>
        </label>
        <label className="field">
          Area
          <select name="areaId" defaultValue={table?.area_id ?? defaultArea}>
            {areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}
          </select>
        </label>
        {error && <div className="col-span-2"><Notice>{error}</Notice></div>}
        <button className="btn btn-primary col-span-2" disabled={busy}>{table ? 'Save table' : 'Add table'}</button>
        {onRemove && <button type="button" className="btn btn-ghost col-span-2" disabled={busy} onClick={onRemove}>Remove table</button>}
      </form>
      {table && <p className="mt-3 flex items-center gap-1.5 text-xs text-ink-soft"><Badge>Tip</Badge> Drag tables on the floor plan to move them.</p>}
    </Modal>
  )
}
