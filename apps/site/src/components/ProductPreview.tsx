import { useEffect, useRef, useState } from 'react'
import gsap from 'gsap'
import {
  Check,
  ChartColumn,
  Clock,
  Coffee,
  Cookie,
  CreditCard,
  CupSoda,
  LayoutDashboard,
  Receipt,
  Search,
  Utensils,
  Wallet,
} from 'lucide-react'
import { Mark } from './Logo'

const NAV = [
  [LayoutDashboard, 'Dashboard'],
  [Receipt, 'POS / Billing'],
  [CreditCard, 'Payments'],
  [Wallet, 'Cash'],
  [ChartColumn, 'Reports'],
] as const

const MENU = [
  { name: 'Filter coffee', price: 84, quantity: 3, Icon: Coffee },
  { name: 'Masala dosa', price: 150, quantity: 2, Icon: Utensils },
  { name: 'Veg biryani', price: 250, quantity: 1, Icon: Utensils },
  { name: 'Gulab jamun', price: 75, quantity: 2, Icon: Cookie },
  { name: 'Cold coffee', price: 140, quantity: 0, Icon: CupSoda },
  { name: 'Veg puff', price: 45, quantity: 0, Icon: Cookie },
]

const PAYMENTS = [
  { id: 'cash', label: 'Cash', amount: 300, reference: 'Drawer 1' },
  { id: 'upi', label: 'UPI', amount: 500, reference: 'Ref 4821' },
  { id: 'card', label: 'Card terminal', amount: 200, reference: 'Ref 0937' },
] as const

const TOTAL = 1000
const money = (value: number) =>
  `₹${value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** A working example of the split-payment flow. All figures are sample data. */
export function ProductPreview() {
  const [recorded, setRecorded] = useState<string[]>([])
  const [confirmed, setConfirmed] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const ctx = gsap.context(() => {
      gsap.from(root.current, { y: 32, opacity: 0, duration: 0.9, ease: 'power3.out', clearProps: 'all' })
    }, root)
    return () => ctx.revert()
  }, [])

  const paid = PAYMENTS.filter((payment) => recorded.includes(payment.id)).reduce(
    (sum, payment) => sum + payment.amount,
    0,
  )
  const remaining = PAYMENTS.filter((payment) => !recorded.includes(payment.id))

  return (
    <div>
      <div ref={root} className="relative text-left">
        <div className="grid overflow-hidden rounded-2xl border border-line bg-white shadow-float lg:grid-cols-[12rem_1fr_21rem]">
          <aside aria-hidden="true" className="hidden border-r border-line bg-paper-soft p-3 lg:block">
            <div className="flex items-center gap-2 px-2 py-2">
              <Mark className="h-5 w-auto text-brand" />
              <span className="text-[0.8125rem] font-semibold">Sample Cafe</span>
            </div>
            <ul className="mt-3 space-y-0.5">
              {NAV.map(([Icon, label]) => (
                <li
                  key={label}
                  className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[0.8125rem] ${
                    label === 'POS / Billing'
                      ? 'border border-line bg-white font-medium text-ink'
                      : 'border border-transparent text-ink-soft'
                  }`}
                >
                  <Icon size={15} strokeWidth={1.75} />
                  {label}
                </li>
              ))}
            </ul>
          </aside>

          <div aria-hidden="true" className="hidden border-r border-line p-4 md:block lg:p-5">
            <div className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-[0.8125rem] text-ink-soft">
              <Search size={15} strokeWidth={1.75} /> Search menu…
            </div>
            <div className="mt-3 flex gap-1.5 text-xs">
              {['All', 'Coffee', 'Breakfast', 'Desserts'].map((category) => (
                <span
                  key={category}
                  className={`rounded-lg border px-2.5 py-1 ${
                    category === 'All' ? 'border-ink bg-ink text-white' : 'border-line text-ink-soft'
                  }`}
                >
                  {category}
                </span>
              ))}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2.5 xl:grid-cols-3">
              {MENU.map(({ name, price, quantity, Icon }) => (
                <div
                  key={name}
                  className={`relative rounded-xl border p-2 ${quantity ? 'border-brand/40' : 'border-line'}`}
                >
                  {quantity > 0 && (
                    <span className="numbers absolute left-3.5 top-3.5 flex size-5 items-center justify-center rounded-md bg-brand text-[0.6875rem] text-white">
                      {quantity}
                    </span>
                  )}
                  <div className="flex h-16 items-center justify-center rounded-lg bg-[#f3efe9] text-ink-soft">
                    <Icon size={20} strokeWidth={1.5} />
                  </div>
                  <p className="mt-2 text-[0.8125rem] font-medium">{name}</p>
                  <p className="numbers text-xs text-ink-soft">₹{price}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="p-4 sm:p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="eyebrow !text-ink-soft !text-[0.6875rem]">Sample bill</p>
                <p className="mt-1 text-[0.9375rem] font-semibold">Table 6 · 4 guests</p>
              </div>
              <span className="rounded-full bg-brand-tint px-2 py-0.5 text-xs font-medium text-brand-deep">
                Dine-in
              </span>
            </div>

            <ul className="mt-3 space-y-1.5 border-t border-line pt-3 text-[0.8125rem]">
              {MENU.filter((item) => item.quantity).map((item) => (
                <li key={item.name} className="flex justify-between gap-4">
                  <span>
                    <span className="numbers text-ink-soft">{item.quantity}×</span> {item.name}
                  </span>
                  <span className="numbers">₹{item.price * item.quantity}</span>
                </li>
              ))}
            </ul>

            <dl className="numbers mt-3 space-y-1 border-t border-line pt-3 text-xs text-ink-soft">
              {[
                ['CGST 2.5%', '₹23.80'],
                ['SGST 2.5%', '₹23.80'],
                ['Round off', '₹0.40'],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between">
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
              <div className="flex justify-between pt-1 text-[0.9375rem] font-medium text-ink">
                <dt>Total</dt>
                <dd>{money(TOTAL)}</dd>
              </div>
            </dl>

            {recorded.length > 0 && (
              <ul className="mt-3 space-y-2 border-t border-line pt-3 text-[0.8125rem]">
                {recorded.map((id) => {
                  const payment = PAYMENTS.find((item) => item.id === id)!
                  return (
                    <li key={id} className="flex items-center justify-between gap-3">
                      <span>
                        {payment.label}
                        <span className="numbers block text-[0.6875rem] text-ink-soft">{payment.reference}</span>
                      </span>
                      <span className="text-right">
                        <span className="numbers">₹{payment.amount}</span>
                        <span
                          className={`flex items-center gap-1 text-[0.6875rem] font-medium ${
                            confirmed ? 'text-ok' : 'text-wait'
                          }`}
                        >
                          {confirmed ? <Check size={11} /> : <Clock size={11} />}
                          {confirmed ? 'Confirmed' : 'Recorded'}
                        </span>
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}

            <div
              aria-live="polite"
              className="numbers mt-3 flex justify-between border-t border-ink pt-3 text-[0.9375rem] font-medium"
            >
              <span>Balance due</span>
              <span>{money(TOTAL - paid)}</span>
            </div>

            <div className="mt-4 rounded-xl bg-paper-soft p-3 ring-1 ring-line">
              {remaining.length > 0 ? (
                <>
                  <p className="text-[0.8125rem] font-medium">Try it: record how this table paid</p>
                  <div className="mt-2 grid gap-1.5">
                    {remaining.map((payment) => (
                      <button
                        key={payment.id}
                        type="button"
                        className="btn btn-secondary btn-sm justify-between !min-h-10"
                        onClick={() => setRecorded([...recorded, payment.id])}
                      >
                        {payment.label}
                        <span className="numbers">₹{payment.amount}</span>
                      </button>
                    ))}
                  </div>
                </>
              ) : confirmed ? (
                <>
                  <p className="text-[0.8125rem] font-medium">Checked against the terminal, UPI app and drawer.</p>
                  <button
                    type="button"
                    className="link mt-2 text-[0.8125rem]"
                    onClick={() => {
                      setRecorded([])
                      setConfirmed(false)
                    }}
                  >
                    Start again
                  </button>
                </>
              ) : (
                <>
                  <p className="text-[0.8125rem] font-medium">
                    Fully recorded, not yet proven. A manager checks it next.
                  </p>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm mt-2 !min-h-10 w-full"
                    onClick={() => setConfirmed(true)}
                  >
                    Confirm as manager
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
      <p className="eyebrow mt-4 text-right !text-[0.6875rem] !text-ink-soft">Concept preview · Sample data</p>
    </div>
  )
}
