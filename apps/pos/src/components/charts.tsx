import { useState } from 'react'
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'

interface Bar {
  label: string
  value: number
}

/** A round top value for the axis, so its labels read as 2,000 rather than 1,837. */
function niceTop(value: number) {
  if (value <= 0) return 1
  const power = 10 ** Math.floor(Math.log10(value))
  return ([1, 2, 2.5, 5, 10].find((step) => step * power >= value) ?? 10) * power
}

/** One series, so one colour and no legend. The title above it names what's drawn. */
export function BarChart({ rows, format, name, tall }: { rows: Bar[]; format: (value: number) => string; name: string; tall?: boolean }) {
  const [hover, setHover] = useState<number | null>(null)
  const top = niceTop(Math.max(...rows.map((row) => row.value), 0))
  const every = Math.ceil(rows.length / 8)
  const shown = hover === null ? null : rows[hover]

  return (
    <figure className="relative">
      <div className={`flex gap-2 ${tall ? 'h-44 lg:h-64' : 'h-44'}`} aria-hidden="true">
        <div className="tnum flex w-12 shrink-0 flex-col justify-between text-right text-[0.6875rem] text-ink-faint">
          <span>{format(top)}</span>
          <span>{format(top / 2)}</span>
          <span>{format(0)}</span>
        </div>
        <div className="relative min-w-0 flex-1 border-b border-line">
          <div className="absolute inset-x-0 top-0 border-t border-line-soft" />
          <div className="absolute inset-x-0 top-1/2 border-t border-line-soft" />
          <div className="absolute inset-0 flex items-end" onMouseLeave={() => setHover(null)}>
            {rows.map((row, index) => (
              <div key={row.label} className="flex h-full min-w-0 flex-1 items-end justify-center px-px" onMouseEnter={() => setHover(index)}>
                <span
                  className={`block w-full max-w-5 rounded-t ${hover === index ? 'bg-brand-deep' : 'bg-brand'}`}
                  style={{ height: `${Math.max((Math.max(row.value, 0) / top) * 100, row.value > 0 ? 1.5 : 0)}%`, printColorAdjust: 'exact' }}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="ml-14 mt-1 flex text-[0.6875rem] text-ink-faint" aria-hidden="true">
        {rows.map((row, index) => (
          <span key={row.label} className="min-w-0 flex-1 overflow-visible text-center whitespace-nowrap">{index % every === 0 ? row.label : ''}</span>
        ))}
      </div>
      {shown && (
        <p className="tnum pointer-events-none absolute top-0 right-0 rounded-lg border border-line-soft bg-white px-2.5 py-1 text-xs shadow-card" aria-hidden="true">
          <span className="text-ink-soft">{shown.label}</span> <span className="font-medium">{format(shown.value)}</span>
        </p>
      )}
      <table className="sr-only">
        <caption>{name}</caption>
        <tbody>{rows.map((row) => <tr key={row.label}><th scope="row">{row.label}</th><td>{format(row.value)}</td></tr>)}</tbody>
      </table>
    </figure>
  )
}

/** Parts of a whole, longest first. Every row carries its own name and amount, so colour adds nothing. */
export function ShareBars({ rows, format }: { rows: Bar[]; format: (value: number) => string }) {
  const total = rows.reduce((sum, row) => sum + Math.max(row.value, 0), 0)
  return (
    <ul className="grid gap-3">
      {rows.map((row) => {
        const share = total ? (Math.max(row.value, 0) / total) * 100 : 0
        return (
          <li key={row.label}>
            <p className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate">{row.label}</span>
              <span className="tnum shrink-0 font-medium">{format(row.value)} <span className="font-normal text-ink-soft">{Math.round(share)}%</span></span>
            </p>
            <span className="mt-1 block h-1.5 rounded-full bg-mist" aria-hidden="true">
              <span className="block h-full rounded-full bg-brand" style={{ width: `${share}%`, printColorAdjust: 'exact' }} />
            </span>
          </li>
        )
      })}
    </ul>
  )
}

/** Change against an earlier period, with an arrow and words as well as colour. */
export function Change({ now, before, against }: { now: number; before: number; against: string }) {
  if (before === 0) return <span className="text-xs text-ink-soft">{now === 0 ? `Same as ${against}` : `Nothing ${against}`}</span>
  const percent = Math.round(((now - before) / before) * 100)
  const Icon = percent === 0 ? Minus : percent > 0 ? ArrowUpRight : ArrowDownRight
  return (
    <span className={`tnum inline-flex items-center gap-0.5 text-xs ${percent > 0 ? 'text-ok' : percent < 0 ? 'text-wait' : 'text-ink-soft'}`}>
      <Icon size={13} aria-hidden="true" />
      {percent === 0 ? `Same as ${against}` : `${Math.abs(percent)}% ${percent > 0 ? 'up on' : 'down on'} ${against}`}
    </span>
  )
}
