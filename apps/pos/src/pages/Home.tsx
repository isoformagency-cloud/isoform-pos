import { useQuery } from '@tanstack/react-query'
import { Armchair, ChartColumn, ChefHat, ChevronRight, CreditCard, FileText, PauseCircle, Receipt, ShoppingCart, UtensilsCrossed, Wallet, type LucideIcon } from 'lucide-react'
import { Link } from 'react-router'
import type { Me } from '../App'
import type { Alerts } from '../components/Shell'
import { api } from '../lib/api'

const greeting = () => {
  const hour = new Date().getHours()
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
}

const SHORTCUTS: { to: string; label: string; text: string; icon: LucideIcon; needs: string }[] = [
  { to: '/pos?new=1', label: 'Take an order', text: 'Open the POS and start billing', icon: ShoppingCart, needs: 'orders.write' },
  { to: '/tables', label: 'Tables', text: 'See who is seated, and reserve tables', icon: Armchair, needs: 'tables.read' },
  { to: '/kitchen', label: 'Kitchen', text: 'Tickets to prepare and serve', icon: ChefHat, needs: 'kitchen.read' },
  { to: '/cash', label: 'Cash drawer', text: 'Open or close a cash session', icon: Wallet, needs: 'cash.use' },
  { to: '/menu', label: 'Menu', text: 'Items, prices and sold-out status', icon: UtensilsCrossed, needs: 'menu.write' },
  { to: '/reports', label: 'Reports', text: 'See how the day went', icon: ChartColumn, needs: 'reports.read' },
]

export function Home({ me }: { me: Me }) {
  const alerts = useQuery<Alerts>({ queryKey: ['alerts'], queryFn: () => api('/alerts', { branch: true }), refetchInterval: 20000 })
  const counts = [
    { to: '/orders', label: 'Running orders', value: alerts.data?.runningOrders, icon: Receipt, needs: 'orders.read' },
    { to: '/orders?tab=held', label: 'On hold', value: alerts.data?.heldOrders, icon: PauseCircle, needs: 'orders.read' },
    { to: '/invoices', label: 'Unpaid bills', value: alerts.data?.unpaidBills, icon: FileText, needs: 'billing.read' },
    { to: '/payments', label: 'Payments to confirm', value: alerts.data?.paymentsToVerify, icon: CreditCard, needs: 'payments.verify' },
  ].filter((item) => me.permissions.includes(item.needs))
  const shortcuts = SHORTCUTS.filter((item) => me.permissions.includes(item.needs))

  return (
    <>
      <h1 className="text-[1.75rem] leading-tight">{greeting()}, {me.displayName.split(' ')[0]}</h1>
      <p className="mt-1 text-sm text-ink-soft">{new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</p>

      {counts.length > 0 && (
        <ul className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {counts.map(({ to, label, value, icon: Icon }) => (
            <li key={label}>
              <Link to={to} className="card block p-4 transition-colors hover:border-line-strong">
                <span className="flex items-center justify-between text-sm text-ink-soft">
                  {label}
                  <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
                </span>
                <span className="tnum mt-2 block font-display text-3xl font-semibold tracking-tight">{value ?? '–'}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {shortcuts.length > 0 && (
        <ul className="card mt-6 divide-y divide-line-soft overflow-hidden">
          {shortcuts.map(({ to, label, text, icon: Icon }) => (
            <li key={to}>
              <Link to={to} className="flex items-center gap-3 p-4 transition-colors hover:bg-paper-soft">
                <span className="grid size-9 place-items-center rounded-lg bg-brand-tint text-brand"><Icon size={18} strokeWidth={1.75} aria-hidden="true" /></span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{label}</span>
                  <span className="block text-sm text-ink-soft">{text}</span>
                </span>
                <ChevronRight size={17} className="ml-auto text-ink-faint" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
