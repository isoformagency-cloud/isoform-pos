export type Role = 'owner' | 'admin' | 'manager' | 'cashier' | 'waiter' | 'kitchen' | 'accountant'

const MANAGER = [
  'business.read', 'branches.read', 'staff.read', 'staff.write', 'devices.manage', 'menu.read', 'menu.write',
  'orders.read', 'orders.write', 'orders.discount', 'orders.discount_limited', 'orders.cancel',
  'billing.read', 'billing.write', 'billing.correct',
  'payments.read', 'payments.record', 'payments.verify', 'payments.refund',
  'cash.use', 'cash.move', 'cash.review', 'customers.read', 'customers.write', 'reports.read',
  'tables.read', 'tables.use', 'tables.manage', 'kitchen.read', 'kitchen.update',
  'expenses.read', 'expenses.write', 'inventory.read', 'inventory.write', 'activity.read',
] as const
const ADMIN = [...MANAGER, 'business.write', 'branches.write'] as const
const OWNER = [...ADMIN, 'permissions.manage', 'backup.download'] as const

export type Permission = (typeof OWNER)[number]

const FRONTLINE: readonly Permission[] = ['branches.read', 'menu.read', 'orders.read', 'orders.write', 'tables.read', 'tables.use', 'kitchen.read', 'kitchen.update']

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: OWNER,
  admin: ADMIN,
  manager: MANAGER,
  accountant: ['business.read', 'branches.read', 'menu.read', 'orders.read', 'billing.read', 'payments.read', 'payments.verify', 'cash.review', 'customers.read', 'reports.read', 'expenses.read', 'inventory.read', 'activity.read'],
  cashier: [...FRONTLINE, 'orders.discount_limited', 'billing.read', 'billing.write', 'payments.read', 'payments.record', 'cash.use', 'customers.read', 'customers.write'],
  waiter: FRONTLINE,
  kitchen: ['branches.read', 'menu.read', 'orders.read', 'kitchen.read', 'kitchen.update', 'inventory.read'],
}

export type Level = 'none' | 'view' | 'manage'
export type Overrides = Partial<Record<string, Level>>

export interface Module {
  key: string
  label: string
  read: readonly Permission[]
  work: readonly Permission[]
  /** Sensitive actions. Manage keeps these for roles that have them and never grants them to others. */
  guarded?: readonly Permission[]
  levels: readonly Level[]
}

// Staff, devices, branches and settings aren't here: a PIN on a shared tablet must never reach them.
export const MODULES: readonly Module[] = [
  { key: 'orders', label: 'Orders and POS', read: ['orders.read'], work: ['orders.write'], guarded: ['orders.discount', 'orders.discount_limited', 'orders.cancel'], levels: ['none', 'view', 'manage'] },
  { key: 'tables', label: 'Tables', read: ['tables.read'], work: ['tables.use'], guarded: ['tables.manage'], levels: ['none', 'view', 'manage'] },
  { key: 'kitchen', label: 'Kitchen', read: ['kitchen.read'], work: ['kitchen.update'], levels: ['none', 'view', 'manage'] },
  // Taking an order needs prices, so everyone can at least see the menu.
  { key: 'menu', label: 'Menu', read: ['menu.read'], work: ['menu.write'], levels: ['view', 'manage'] },
  { key: 'billing', label: 'Bills and payments', read: ['billing.read', 'payments.read'], work: ['billing.write', 'payments.record'], guarded: ['billing.correct', 'payments.verify', 'payments.refund'], levels: ['none', 'view', 'manage'] },
  { key: 'cash', label: 'Cash', read: ['cash.review'], work: ['cash.use'], guarded: ['cash.move'], levels: ['none', 'view', 'manage'] },
  { key: 'customers', label: 'Customers', read: ['customers.read'], work: ['customers.write'], levels: ['none', 'view', 'manage'] },
  { key: 'inventory', label: 'Inventory', read: ['inventory.read'], work: ['inventory.write'], levels: ['none', 'view', 'manage'] },
  { key: 'expenses', label: 'Expenses', read: ['expenses.read'], work: ['expenses.write'], levels: ['none', 'view', 'manage'] },
  { key: 'reports', label: 'Reports', read: ['reports.read'], work: [], levels: ['none', 'view'] },
]

export const EDITABLE_ROLES: readonly Role[] = ['admin', 'manager', 'cashier', 'waiter', 'kitchen', 'accountant']

/** What a role has before an owner changes anything, as the grid shows it. */
export function defaultLevel(role: Role, module: Module): Level {
  const has = (permission: Permission) => ROLE_PERMISSIONS[role].includes(permission)
  if (module.work.length > 0 && module.work.every(has)) return 'manage'
  return [...module.read, ...(module.guarded ?? [])].some(has) ? 'view' : 'none'
}

export function permissionsFor(role: Role, overrides: Overrides = {}): Permission[] {
  const defaults = ROLE_PERMISSIONS[role]
  if (role === 'owner') return [...defaults]
  const granted = new Set<Permission>(defaults)
  for (const module of MODULES) {
    const level = overrides[module.key]
    if (!level || !module.levels.includes(level)) continue
    for (const permission of [...module.read, ...module.work, ...(module.guarded ?? [])]) granted.delete(permission)
    if (level === 'none') continue
    for (const permission of module.read) granted.add(permission)
    if (level === 'manage') {
      for (const permission of module.work) granted.add(permission)
      for (const permission of module.guarded ?? []) if (defaults.includes(permission)) granted.add(permission)
    }
  }
  return [...granted]
}

export const can = (actor: { permissions: readonly Permission[] }, permission: Permission) => actor.permissions.includes(permission)

/** Roles that sign in with a PIN on a registered device rather than email. */
export const PIN_ROLES: readonly Role[] = ['cashier', 'waiter', 'kitchen']
