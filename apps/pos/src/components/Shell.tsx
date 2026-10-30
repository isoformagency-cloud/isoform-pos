import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, LayoutDashboard, LogOut, MonitorSmartphone, Receipt, Settings, Users, UtensilsCrossed } from 'lucide-react'
import { NavLink, Outlet } from 'react-router'
import type { Me } from '../App'
import { activeBranch, api, saveActiveBranch, supabase } from '../lib/api'

const NAV = [
  { to: '/', label: 'Home', icon: LayoutDashboard },
  { to: '/orders', label: 'Orders', icon: Receipt, needs: 'orders.read' },
  { to: '/menu', label: 'Menu', icon: UtensilsCrossed, needs: 'menu.read' },
  { to: '/branches', label: 'Branches', icon: Building2, needs: 'branches.read' },
  { to: '/staff', label: 'Staff', icon: Users, needs: 'staff.read' },
  { to: '/devices', label: 'Devices', icon: MonitorSmartphone, needs: 'devices.manage' },
  { to: '/settings', label: 'Settings', icon: Settings, needs: 'business.read' },
]

export function Shell({ me }: { me: Me }) {
  const queryClient = useQueryClient()
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => api('/branches') })
  const items = NAV.filter((item) => !item.needs || me.permissions.includes(item.needs))
  const list: { id: string; name: string }[] = branches.data?.items ?? []

  return (
    <div className="min-h-svh md:grid md:grid-cols-[13.5rem_1fr]">
      <aside className="flex flex-col border-b border-line bg-paper-soft p-3 md:min-h-svh md:border-r md:border-b-0">
        <p className="px-2 py-2 font-display font-semibold tracking-tight">ISOFORM POS</p>
        {list.length > 1 && (
          <label className="field mt-2 px-1">
            Branch
            <select
              defaultValue={activeBranch() ?? ''}
              onChange={(event) => {
                saveActiveBranch(event.target.value || null)
                queryClient.invalidateQueries()
              }}
            >
              <option value="">All my branches</option>
              {list.map((branch) => (
                <option key={branch.id} value={branch.id}>{branch.name}</option>
              ))}
            </select>
          </label>
        )}
        <nav aria-label="Main" className="mt-3 flex gap-1 overflow-x-auto md:block md:space-y-1">
          {items.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex min-h-11 shrink-0 items-center gap-2.5 rounded-lg border px-3 text-sm ${
                  isActive ? 'border-line bg-white font-medium' : 'border-transparent text-ink-soft hover:text-ink'
                }`
              }
            >
              <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-3 border-t border-line pt-3 md:mt-auto">
          <p className="px-2 text-sm font-medium">{me.displayName}</p>
          <p className="px-2 text-xs capitalize text-ink-soft">{me.role}</p>
          <button className="btn mt-1 w-full justify-start text-sm text-ink-soft" onClick={() => supabase.auth.signOut()}>
            <LogOut size={16} aria-hidden="true" /> Sign out
          </button>
        </div>
      </aside>
      <main className="min-w-0 p-5 md:p-8">
        <Outlet />
      </main>
    </div>
  )
}
