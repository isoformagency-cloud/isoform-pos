import { useEffect, useRef, type ReactNode } from 'react'
import { X, type LucideIcon } from 'lucide-react'

export function PageHeader({ title, text, action }: { title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[1.75rem] leading-tight">{title}</h1>
        {text && <p className="mt-1 max-w-2xl text-sm text-ink-soft">{text}</p>}
      </div>
      {action}
    </div>
  )
}

export function Notice({ tone = 'bad', children }: { tone?: 'bad' | 'ok'; children: ReactNode }) {
  return (
    <p role={tone === 'bad' ? 'alert' : 'status'} className={`rounded-xl p-3 text-sm ${tone === 'bad' ? 'bg-bad-tint text-bad' : 'bg-ok-tint text-ok'}`}>
      {children}
    </p>
  )
}

export function Loading({ error, empty, ready, children }: { error?: Error | null; empty?: string; ready: boolean; children: ReactNode }) {
  if (error) return <Notice>{error.message}</Notice>
  if (!ready) return <p className="py-6 text-sm text-ink-soft">Loading…</p>
  if (empty) return <Empty title={empty} />
  return <>{children}</>
}

export function Empty({ icon: Icon, title, text, action }: { icon?: LucideIcon; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="card grid justify-items-center gap-2 px-6 py-12 text-center">
      {Icon && (
        <span className="mb-1 grid size-11 place-items-center rounded-xl bg-mist text-ink-soft">
          <Icon size={20} strokeWidth={1.75} aria-hidden="true" />
        </span>
      )}
      <p className="max-w-sm font-medium text-ink-mid">{title}</p>
      {text && <p className="max-w-sm text-sm text-ink-soft">{text}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

const TONES = {
  neutral: 'bg-mist text-ink-mid',
  brand: 'bg-brand-100 text-brand-deep',
  ok: 'bg-ok-tint text-ok',
  wait: 'bg-wait-tint text-wait',
  bad: 'bg-bad-tint text-bad',
  sky: 'bg-sky-tint text-sky',
}

export type Tone = keyof typeof TONES

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium whitespace-nowrap ${TONES[tone]}`}>{children}</span>
}

export function Segmented<T extends string>({ label, value, options, onChange }: {
  label: string
  value: T
  options: { value: T; label: string; count?: number }[]
  onChange: (value: T) => void
}) {
  return (
    <div role="tablist" aria-label={label} className="thin-scroll inline-flex max-w-full gap-1 overflow-x-auto rounded-xl bg-mist p-1">
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            className={`flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors ${active ? 'bg-white text-ink shadow-card' : 'text-ink-soft hover:text-ink'}`}
            onClick={() => onChange(option.value)}
          >
            {option.label}
            {option.count !== undefined && <span className="tnum text-xs text-ink-faint">{option.count}</span>}
          </button>
        )
      })}
    </div>
  )
}

/** A native dialog, so focus, Escape and the backdrop all behave without extra code. */
export function Modal({ title, text, side = false, onClose, footer, children }: {
  title: ReactNode
  text?: string
  side?: boolean
  onClose: () => void
  footer?: ReactNode
  children: ReactNode
}) {
  const dialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    dialog.current?.showModal()
    // A dialog focuses its first control, which here would be Close rather than the first box.
    dialog.current?.querySelector<HTMLElement>('input:not([type=radio],[type=checkbox]), textarea')?.focus()
  }, [])

  const shape = side
    ? 'sheet-side m-0 ml-auto h-dvh max-h-dvh w-[min(30rem,100vw)] max-w-none rounded-none'
    : 'sheet m-auto max-h-[calc(100dvh-2rem)] w-[min(27rem,calc(100vw-2rem))] rounded-2xl'

  return (
    <dialog
      ref={dialog}
      onCancel={(event) => { event.preventDefault(); onClose() }}
      onClick={(event) => { if (event.target === dialog.current) onClose() }}
      className={`${shape} overflow-hidden bg-white p-0 text-ink shadow-float`}
    >
      <div className={`flex flex-col ${side ? 'h-full' : 'max-h-[calc(100dvh-2rem)]'}`}>
        <header className="flex items-start justify-between gap-4 px-5 pt-5 pb-3">
          <div className="min-w-0">
            <h2 className="text-lg">{title}</h2>
            {text && <p className="mt-0.5 text-sm text-ink-soft">{text}</p>}
          </div>
          <button type="button" aria-label="Close" className="btn btn-ghost btn-icon -mt-1.5 -mr-2" onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>
        {footer && <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line-soft px-5 py-3">{footer}</footer>}
      </div>
    </dialog>
  )
}

export function Avatar({ name }: { name: string }) {
  const initials = name.split(/\s+/).map((word) => word[0]).join('').slice(0, 2).toUpperCase()
  return <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-100 text-xs font-semibold text-brand-deep">{initials}</span>
}

export function Mark({ size = 36 }: { size?: number }) {
  return (
    <span className="grid shrink-0 place-items-center rounded-[28%] bg-brand" style={{ width: size, height: size }}>
      <svg viewBox="0 0 342 431" fill="white" style={{ height: size * 0.54 }} aria-hidden="true">
        <rect width="80" height="431" />
        <path d="M105 0h237l-48 85H105z" />
        <path d="M105 136h162l-47 85H105z" />
        <path d="M105 271h88l-88 160z" />
      </svg>
    </span>
  )
}
