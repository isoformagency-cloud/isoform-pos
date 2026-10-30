import { useEffect, useRef } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)

const ROWS = [
  { label: 'Billed', note: 'Invoices issued today', amount: 48250 },
  { label: 'Recorded', note: 'Staff say it was received', amount: 46900 },
  { label: 'Confirmed', note: 'Checked against evidence', amount: 41300 },
  { label: 'In the bank', note: 'Settlement has arrived', amount: 33800 },
]

/** Example day showing why these four figures stay separate. */
export function MoneyLadder() {
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const ctx = gsap.context(() => {
      gsap.from('[data-bar]', {
        scaleX: 0,
        transformOrigin: 'left center',
        duration: 0.9,
        ease: 'power3.out',
        stagger: 0.12,
        scrollTrigger: { trigger: root.current, start: 'top 75%', once: true },
      })
    }, root)
    return () => ctx.revert()
  }, [])

  return (
    <div ref={root} className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 sm:p-6">
      <p className="text-sm font-medium">Today’s money</p>
      <ul className="mt-4 space-y-5">
        {ROWS.map((row, index) => (
          <li key={row.label}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
              <p className="text-[0.9375rem]">
                <span className="font-medium">{row.label}</span>
                <span className="ml-2 text-sm text-white/65">{row.note}</span>
              </p>
              <p className="numbers">₹{row.amount.toLocaleString('en-IN')}</p>
            </div>
            <div
              data-bar
              className="mt-2 h-1.5 rounded-full"
              style={{
                width: `${(row.amount / ROWS[0].amount) * 100}%`,
                background: index === 3 ? 'white' : 'var(--color-brand)',
              }}
            />
          </li>
        ))}
      </ul>
    </div>
  )
}
