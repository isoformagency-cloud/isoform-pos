export type Role = 'owner' | 'manager' | 'cashier' | 'waiter' | 'kitchen' | 'accountant'

const MANAGER = ['business.read', 'branches.read', 'staff.read', 'staff.write', 'devices.manage', 'menu.read', 'menu.write'] as const
const OWNER = [...MANAGER, 'business.write', 'branches.write'] as const

export type Permission = (typeof OWNER)[number]

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: OWNER,
  manager: MANAGER,
  accountant: ['business.read', 'branches.read', 'menu.read'],
  cashier: ['branches.read', 'menu.read'],
  waiter: ['branches.read', 'menu.read'],
  kitchen: ['branches.read', 'menu.read'],
}

export const can = (role: Role, permission: Permission) => ROLE_PERMISSIONS[role].includes(permission)
export const permissionsFor = (role: Role) => ROLE_PERMISSIONS[role]

/** Roles that sign in with a PIN on a registered device rather than email. */
export const PIN_ROLES: readonly Role[] = ['cashier', 'waiter', 'kitchen']
