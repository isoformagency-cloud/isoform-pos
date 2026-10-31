import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle, Armchair, Bell, Building2, ChartColumn, ChefHat, CircleDot, CreditCard, FileText, LayoutDashboard, LogOut, Menu as MenuIcon, MonitorSmartphone,
  MoreHorizontal, Package, PauseCircle, Plus, Receipt, ReceiptIndianRupee, Search, Settings, ShoppingCart, UserRound, Users, UtensilsCrossed, Wallet, X,
} from 'lucide-react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import type { Me } from '../App'
import { api, saveActiveBranch, supabase, useActiveBranch } from '../lib/api'
import { useLiveUpdates } from '../lib/live'
import { useChooseBranch } from './BranchPicker'
import { CommandSearch } from './CommandSearch'
import { Avatar, Mark } from './ui'

interface NavItem {
  to: string
  label: string
  icon: typeof Receipt
  needs?: string
  orNeeds?: string
  count?: 'runningOrders' | 'unpaidBills' | 'paymentsToVerify' | 'kitchenActive' | 'lowStock'
}

const GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: 'Operate',
    items: [
      { to: '/', label: 'Home', icon: LayoutDashboard },
      { to: '/pos', label: 'POS / Billing', icon: ShoppingCart, needs: 'orders.write' },
      { to: '/orders', label: 'Orders', icon: Receipt, needs: 'orders.read', count: 'runningOrders' },
      { to: '/tables', label: 'Tables', icon: Armchair, needs: 'tables.read' },
      { to: '/kitchen', label: 'Kitchen', icon: ChefHat, needs: 'kitchen.read', count: 'kitchenActive' },
      { to: '/invoices', label: 'Bills', icon: FileText, needs: 'billing.read', count: 'unpaidBills' },
      { to: '/payments', label: 'Payments', icon: CreditCard, needs: 'payments.read', count: 'paymentsToVerify' },
      { to: '/cash', label: 'Cash', icon: Wallet, needs: 'cash.use', orNeeds: 'cash.review' },
    ],
  },
  {
    label: 'Manage',
    items: [
      { to: '/menu', label: 'Menu', icon: UtensilsCrossed, needs: 'menu.read' },
      { to: '/inventory', label: 'Inventory', icon: Package, needs: 'inventory.read', count: 'lowStock' },
      { to: '/customers', label: 'Customers', icon: UserRound, needs: 'customers.read' },
      { to: '/expenses', label: 'Expenses', icon: ReceiptIndianRupee, needs: 'expenses.read' },
      { to: '/staff', label: 'Staff', icon: Users, needs: 'staff.read' },
      { to: '/devices', label: 'Devices', icon: MonitorSmartphone, needs: 'devices.manage' },
      { to: '/branches', label: 'Branches', icon: Building2, needs: 'branches.read' },
    ],
  },
  {
    label: 'Insights',
    items: [{ to: '/reports', label: 'Reports', icon: ChartColumn, needs: 'reports.read' }],
  },
]

const SETTINGS: NavItem = { to: '/settings', label: 'Settings', icon: Settings, needs: 'business.read' }

const ROLE_NAMES: Record<string, string> = {
  owner: 'Owner', manager: 'Manager', cashier: 'Cashier', waiter: 'Waiter', kitchen: 'Kitchen staff', accountant: 'Accountant',
}

export interface Alerts {
  runningOrders: number
  heldOrders: number
  leftoverOrders: number
  unpaidBills: number
  paymentsToVerify: number
  kitchenActive: number
  kitchenDelayed: number
  lowStock: number
}

const allowed = (me: Me, item: NavItem) =>
  !item.needs || me.permissions.includes(item.needs) || Boolean(item.orNeeds && me.permissions.includes(item.orNeeds))

function SideNav({ me, alerts, onPick }: { me: Me; alerts?: Alerts; onPick?: () => void }) {
  const active = useActiveBranch()
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => api('/branches') })
  const settings = useQuery({ queryKey: ['pos-settings'], queryFn: () => api('/pos-settings') })
  const list: { id: string; name: string }[] = branches.data?.items ?? []
  const current = list.find((branch) => branch.id === active) ?? (list.length === 1 ? list[0] : null)

  const row = ({ to, label, icon: Icon, count }: NavItem) => {
    const value = count ? alerts?.[count] : 0
    return (
      <NavLink
        key={to}
        to={to}
        end={to === '/'}
        onClick={onPick}
        className={({ isActive }) =>
          `flex min-h-10 items-center gap-2.5 rounded-[0.625rem] border px-2.5 text-sm transition-colors ${
            isActive ? 'border-line-soft bg-white font-medium text-ink shadow-card' : 'border-transparent text-ink-soft hover:bg-mist hover:text-ink'
          }`
        }
      >
        <Icon size={17} strokeWidth={1.75} aria-hidden="true" />
        {label}
        {Boolean(value) && <span className="tnum ml-auto rounded-md bg-mist px-1.5 text-xs font-medium text-ink-mid">{value}</span>}
      </NavLink>
    )
  }

  return (
    <div className="flex h-full flex-col p-3">
      <div className="flex items-center gap-2.5 px-1 py-1">
        <Mark />
        <div className="min-w-0">
          <p className="truncate font-display text-[0.9375rem] font-semibold tracking-tight">{settings.data?.display_name ?? 'ISOFORM POS'}</p>
          <p className="truncate text-xs text-ink-soft">{current?.name ?? 'All branches'}</p>
        </div>
      </div>

      {me.permissions.includes('orders.write') && (
        <Link to="/pos?new=1" onClick={onPick} className="btn btn-primary mt-3 w-full">
          <Plus size={17} aria-hidden="true" /> Create new order
        </Link>
      )}

      <nav aria-label="Main" className="thin-scroll mt-3 min-h-0 flex-1 space-y-4 overflow-y-auto px-px">
        {GROUPS.map((group) => {
          const items = group.items.filter((item) => allowed(me, item) && (item.to !== '/kitchen' || settings.data?.uses_kitchen !== false))
          if (items.length === 0) return null
          return (
            <div key={group.label}>
              <p className="mb-1 px-2.5 text-[0.6875rem] font-semibold tracking-wide text-ink-faint uppercase">{group.label}</p>
              <div className="space-y-0.5">{items.map(row)}</div>
            </div>
          )
        })}
      </nav>

      <div className="mt-2 border-t border-line pt-2">
        {allowed(me, SETTINGS) && row(SETTINGS)}
        <div className="mt-1 flex items-center gap-2.5 px-1 py-1">
          <Avatar name={me.displayName} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{me.displayName}</p>
            <p className="truncate text-xs text-ink-soft">{ROLE_NAMES[me.role] ?? me.role}</p>
          </div>
          <button aria-label="Sign out" title="Sign out" className="btn btn-ghost btn-icon" onClick={() => supabase.auth.signOut()}>
            <LogOut size={17} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  )
}

function BranchSwitcher() {
  const active = useActiveBranch()
  const choose = useChooseBranch()
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => api('/branches') })
  const list: { id: string; name: string }[] = branches.data?.items ?? []
  if (list.length < 2) return null

  return (
    <label className="flex min-w-0 items-center gap-1.5">
      <Building2 size={16} strokeWidth={1.75} className="hidden shrink-0 text-ink-soft sm:block" aria-hidden="true" />
      <span className="sr-only">Branch</span>
      <select
        className="h-9 w-28 min-w-0 rounded-[0.625rem] border border-line bg-white px-2 text-sm font-medium sm:w-40"
        value={active ?? ''}
        onChange={(event) => choose(event.target.value || null)}
      >
        <option value="">All branches</option>
        {list.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
      </select>
    </label>
  )
}

function AlertBell({ alerts }: { alerts?: Alerts }) {
  const [open, setOpen] = useState(false)
  const holder = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !holder.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])

  const rows = [
    { count: alerts?.kitchenDelayed, to: '/kitchen', icon: AlertTriangle, text: (n: number) => `${n} kitchen ${n === 1 ? 'ticket' : 'tickets'} delayed` },
    { count: alerts?.lowStock, to: '/inventory', icon: Package, text: (n: number) => `${n} ${n === 1 ? 'ingredient' : 'ingredients'} low or out of stock` },
    { count: alerts?.paymentsToVerify, to: '/payments', icon: CreditCard, text: (n: number) => `${n} ${n === 1 ? 'payment' : 'payments'} to confirm` },
    { count: alerts?.unpaidBills, to: '/invoices', icon: FileText, text: (n: number) => `${n} unpaid ${n === 1 ? 'bill' : 'bills'}` },
    { count: alerts?.heldOrders, to: '/orders?tab=held', icon: PauseCircle, text: (n: number) => `${n} ${n === 1 ? 'order' : 'orders'} on hold` },
    { count: alerts?.leftoverOrders, to: '/orders', icon: CircleDot, text: (n: number) => `${n} ${n === 1 ? 'order' : 'orders'} left open from an earlier day` },
  ].filter((row) => row.count)
  const total = rows.reduce((sum, row) => sum + (row.count ?? 0), 0)

  return (
    <div ref={holder} className="relative">
      <button
        aria-label={total ? `Alerts, ${total} waiting` : 'Alerts'}
        aria-expanded={open}
        className="btn btn-ghost btn-icon relative"
        onClick={() => setOpen(!open)}
      >
        <Bell size={19} strokeWidth={1.75} aria-hidden="true" />
        {total > 0 && <span className="tnum absolute top-0.5 right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-bad px-1 text-[0.625rem] font-semibold text-white">{total > 99 ? '99+' : total}</span>}
      </button>
      {open && (
        <div className="sheet absolute right-0 z-40 mt-2 w-72 rounded-xl border border-line-soft bg-white p-1.5 shadow-float">
          <p className="px-2.5 pt-1.5 pb-1 text-sm font-medium">Needs attention</p>
          {rows.length === 0 && <p className="px-2.5 pb-3 text-sm text-ink-soft">You’re all caught up.</p>}
          {rows.map(({ to, icon: Icon, text, count }) => (
            <Link key={to + text(1)} to={to} onClick={() => setOpen(false)} className="flex min-h-10 items-center gap-2.5 rounded-lg px-2.5 text-sm text-ink-mid hover:bg-mist">
              <Icon size={16} strokeWidth={1.75} className="shrink-0" aria-hidden="true" />
              {text(count ?? 0)}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

const BOTTOM = [
  { to: '/', label: 'Home', icon: LayoutDashboard, needs: undefined },
  { to: '/pos', label: 'POS', icon: ShoppingCart, needs: 'orders.write' },
  { to: '/orders', label: 'Orders', icon: Receipt, needs: 'orders.read' },
  { to: '/invoices', label: 'Bills', icon: FileText, needs: 'billing.read' },
]

export function Shell({ me }: { me: Me }) {
  const [drawer, setDrawer] = useState(false)
  const [searching, setSearching] = useState(false)
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const canOrder = me.permissions.includes('orders.write')
  const fullBleed = pathname === '/pos' || pathname === '/kitchen'

  // A branch remembered from someone else on a shared device would lock this person out.
  const active = useActiveBranch()
  useEffect(() => {
    if (active && !me.branchIds.includes(active)) saveActiveBranch(null)
  }, [active, me.branchIds])

  const alerts = useQuery<Alerts>({ queryKey: ['alerts'], queryFn: () => api('/alerts', { branch: true }), refetchInterval: 20000 })
  useLiveUpdates(active ? [active] : me.branchIds.slice(0, 5))

  useEffect(() => {
    const open = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setSearching(true)
      }
    }
    document.addEventListener('keydown', open)
    return () => document.removeEventListener('keydown', open)
  }, [])

  return (
    <div className="min-h-svh lg:pl-[15.75rem] print:pl-0">
      <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-[15.75rem] border-r border-line-soft bg-paper-soft lg:block">
        <SideNav me={me} alerts={alerts.data} />
      </aside>

      {drawer && (
        <div className="no-print fixed inset-0 z-50 lg:hidden">
          <button aria-label="Close menu" className="absolute inset-0 bg-ink/40" onClick={() => setDrawer(false)} />
          <aside className="sheet-side absolute inset-y-0 left-0 w-[17rem] max-w-[85vw] bg-paper-soft">
            <button aria-label="Close menu" className="btn btn-ghost btn-icon absolute top-2 right-2 z-10" onClick={() => setDrawer(false)}>
              <X size={18} aria-hidden="true" />
            </button>
            <SideNav me={me} alerts={alerts.data} onPick={() => setDrawer(false)} />
          </aside>
        </div>
      )}

      <header className="no-print sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-line-soft bg-white/95 px-3 backdrop-blur-sm lg:px-5">
        <button aria-label="Open menu" className="btn btn-ghost btn-icon lg:hidden" onClick={() => setDrawer(true)}>
          <MenuIcon size={20} aria-hidden="true" />
        </button>
        <span className="lg:hidden max-[420px]:hidden"><Mark size={28} /></span>
        <BranchSwitcher />
        <button
          className="ml-auto hidden h-9 w-64 items-center gap-2 rounded-[0.625rem] border border-line bg-white px-3 text-sm text-ink-faint transition-colors hover:border-line-strong md:ml-0 md:flex"
          onClick={() => setSearching(true)}
        >
          <Search size={16} className="shrink-0" aria-hidden="true" />
          <span className="truncate">Search orders, bills, menu</span>
          <kbd className="ml-auto shrink-0 rounded border border-line-soft bg-paper-soft px-1.5 py-px font-sans text-[0.6875rem] whitespace-nowrap text-ink-soft">Ctrl K</kbd>
        </button>
        <div className="ml-auto flex items-center gap-1.5">
          <button aria-label="Search" className="btn btn-ghost btn-icon md:hidden" onClick={() => setSearching(true)}>
            <Search size={19} aria-hidden="true" />
          </button>
          {canOrder && (
            <button className="btn btn-primary btn-sm" onClick={() => navigate('/pos?new=1')}>
              <Plus size={16} aria-hidden="true" /> New order
            </button>
          )}
          <AlertBell alerts={alerts.data} />
        </div>
      </header>

      <main className={fullBleed ? 'min-w-0 pb-16 lg:pb-0' : 'min-w-0 p-4 pb-24 md:p-7 md:pb-24 lg:p-8'}>
        <Outlet />
      </main>

      <nav aria-label="Quick links" className="no-print fixed inset-x-0 bottom-0 z-30 grid h-16 grid-cols-5 border-t border-line-soft bg-white pb-[env(safe-area-inset-bottom)] lg:hidden">
        {BOTTOM.filter((item) => !item.needs || me.permissions.includes(item.needs)).map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `flex flex-col items-center justify-center gap-0.5 text-[0.6875rem] ${isActive ? 'font-medium text-brand' : 'text-ink-soft'}`}>
            <Icon size={20} strokeWidth={1.75} aria-hidden="true" />
            {label}
          </NavLink>
        ))}
        <button className="flex flex-col items-center justify-center gap-0.5 text-[0.6875rem] text-ink-soft" onClick={() => setDrawer(true)}>
          <MoreHorizontal size={20} strokeWidth={1.75} aria-hidden="true" />
          More
        </button>
      </nav>

      {searching && <CommandSearch onClose={() => setSearching(false)} />}
    </div>
  )
}
