import type { ReactNode } from 'react'

export function PageHeader({ title, text, action }: { title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-3xl">{title}</h1>
        {text && <p className="mt-1 text-ink-soft">{text}</p>}
      </div>
      {action}
    </div>
  )
}

export function Notice({ tone = 'bad', children }: { tone?: 'bad' | 'ok'; children: ReactNode }) {
  return (
    <p role={tone === 'bad' ? 'alert' : 'status'} className={`rounded-xl p-3 text-sm ${tone === 'bad' ? 'border border-bad/40 text-bad' : 'bg-ok-tint text-ok'}`}>
      {children}
    </p>
  )
}

export function Loading({ error, empty, ready, children }: { error?: Error | null; empty?: string; ready: boolean; children: ReactNode }) {
  if (error) return <Notice>{error.message}</Notice>
  if (!ready) return <p className="text-ink-soft">Loading…</p>
  if (empty) return <p className="card p-6 text-center text-ink-soft">{empty}</p>
  return <>{children}</>
}
