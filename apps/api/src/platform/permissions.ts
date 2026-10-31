export type Role = 'owner' | 'manager' | 'cashier' | 'waiter' | 'kitchen' | 'accountant'

const MANAGER = [
  'business.read', 'branches.read', 'staff.read', 'staff.write', 'devices.manage', 'menu.read', 'menu.write',
  'orders.read', 'orders.write', 'orders.discount', 'orders.discount_limited', 'orders.cancel',
  'billing.read', 'billing.write', 'billing.correct',
  'payments.read', 'payments.record', 'payments.verify', 'payments.refund',
  'cash.use', 'cash.move', 'cash.review', 'customers.read', 'customers.write', 'reports.read',
  'tables.read', 'tables.use', 'tables.manage', 'kitchen.read', 'kitchen.update',
] as const
const OWNER = [...MANAGER, 'business.write', 'branches.write'] as const

export type Permission = (typeof OWNER)[number]

const FRONTLINE: readonly Permission[] = ['branches.read', 'menu.read', 'orders.read', 'orders.write', 'tables.read', 'tables.use', 'kitchen.read', 'kitchen.update']

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: OWNER,
  manager: MANAGER,
  accountant: ['business.read', 'branches.read', 'menu.read', 'orders.read', 'billing.read', 'payments.read', 'payments.verify', 'cash.review', 'customers.read', 'reports.read'],
  cashier: [...FRONTLINE, 'orders.discount_limited', 'billing.read', 'billing.write', 'payments.read', 'payments.record', 'cash.use', 'customers.read', 'customers.write'],
  waiter: FRONTLINE,
  kitchen: ['branches.read', 'menu.read', 'orders.read', 'kitchen.read', 'kitchen.update'],
}

export const can = (role: Role, permission: Permission) => ROLE_PERMISSIONS[role].includes(permission)
export const permissionsFor = (role: Role) => ROLE_PERMISSIONS[role]

/** Roles that sign in with a PIN on a registered device rather than email. */
export const PIN_ROLES: readonly Role[] = ['cashier', 'waiter', 'kitchen']
