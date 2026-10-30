// Integration tests against the real Supabase project, through the real HTTP layer.
// They create two businesses and remove everything afterwards.
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { request } from './testing'
import { provisionBusiness } from './modules/tenancy/provision'
import { closeDb } from './platform/db'
import { createSession, supabaseAdmin } from './platform/supabase'

const run = crypto.randomUUID().slice(0, 8)
const business = (label: string) => ({
  displayName: `Test ${label} ${run}`, legalName: 'Legal', scheme: 'unregistered' as const, stateCode: '33',
  address: 'Address', branchName: 'Main', branchCode: 'MN', ownerName: `Owner ${label}`,
  ownerEmail: `owner-${label}-${run}@staff.isoform.invalid`,
})

let a: Awaited<ReturnType<typeof provisionBusiness>>
let b: Awaited<ReturnType<typeof provisionBusiness>>
let ownerA: string
let ownerB: string
let taxA: string
const users: string[] = []
let db: pg.Client

async function call(method: string, path: string, token?: string, body?: unknown, headers: Record<string, string> = {}) {
  const write = method !== 'GET'
  const response = await request(`/api/v1${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(write ? { 'idempotency-key': crypto.randomUUID(), 'content-type': 'application/json' } : {}),
      ...headers,
    },
    body: write ? JSON.stringify(body ?? {}) : undefined,
  })
  return { status: response.status, body: (await response.json()) as any }
}

const tokenFor = async (email: string) => (await createSession(email)).access_token

async function addCashier(token: string, branchIds: string[], pin = '4821') {
  const { body, status } = await call('POST', '/staff', token, { displayName: 'Cashier', role: 'cashier', pin, branchIds })
  expect(status).toBe(201)
  const { rows: [row] } = await db.query(`select user_id from app.memberships where id = $1`, [body.id])
  users.push(row.user_id)
  const { data } = await supabaseAdmin.auth.admin.getUserById(row.user_id)
  return { id: body.id as string, token: await tokenFor(data.user!.email!) }
}

beforeAll(async () => {
  db = new pg.Client({ connectionString: process.env.DATABASE_URL_DIRECT, ssl: { rejectUnauthorized: false } })
  await db.connect()
  a = await provisionBusiness(business('a'))
  b = await provisionBusiness(business('b'))
  users.push(a.userId, b.userId)
  ownerA = await tokenFor(business('a').ownerEmail)
  ownerB = await tokenFor(business('b').ownerEmail)
  taxA = (await call('GET', '/tax-registrations', ownerA)).body.items[0].id
})

afterAll(async () => {
  for (const tenant of [a.tenantId, b.tenantId]) {
    for (const table of ['audit_log', 'idempotency_keys', 'device_pin_attempts', 'devices', 'branch_memberships',
      'registers', 'payment_methods', 'memberships', 'branches', 'tax_registrations']) {
      await db.query(`delete from app.${table} where tenant_id = $1`, [tenant])
    }
    await db.query(`delete from app.tenants where id = $1`, [tenant])
  }
  for (const id of users) await supabaseAdmin.auth.admin.deleteUser(id)
  await db.end()
  await closeDb()
})

describe('sessions', () => {
  it('refuses requests with no token or a fake token', async () => {
    expect((await call('GET', '/me')).status).toBe(401)
    expect((await call('GET', '/me', 'not.a.token')).status).toBe(401)
  })
  it('refuses a real user who belongs to no business', async () => {
    const email = `nobody-${run}@staff.isoform.invalid`
    const { data } = await supabaseAdmin.auth.admin.createUser({ email, email_confirm: true })
    users.push(data.user!.id)
    expect((await call('GET', '/me', await tokenFor(email))).status).toBe(403)
  })
  it('identifies the owner from the database', async () => {
    const me = await call('GET', '/me', ownerA)
    expect(me.body).toMatchObject({ tenantId: a.tenantId, role: 'owner', branchIds: [a.branchId] })
  })
  it('never exposes a PIN hash', async () => {
    await addCashier(ownerA, [a.branchId])
    expect(JSON.stringify((await call('GET', '/staff', ownerA)).body)).not.toContain('argon2')
  })
})

describe('tenant isolation over HTTP', () => {
  it('ignores another business named in a header', async () => {
    expect((await call('GET', '/business', ownerB, undefined, { 'x-tenant-id': a.tenantId })).status).toBe(403)
  })
  it('refuses another business’s branch in a header', async () => {
    expect((await call('GET', '/branches', ownerB, undefined, { 'x-branch-id': a.branchId })).status).toBe(403)
  })
  it('lists only its own data', async () => {
    const branches = await call('GET', '/branches', ownerB)
    expect(branches.body.items.map((x: any) => x.id)).toEqual([b.branchId])
    const staff = await call('GET', '/staff', ownerB)
    expect(staff.body.items.every((x: any) => x.id !== a.membershipId)).toBe(true)
  })
  it('cannot edit another business’s staff, branch or device', async () => {
    expect((await call('PATCH', `/staff/${a.membershipId}`, ownerB, { displayName: 'Hacked' })).status).toBe(404)
    expect((await call('PATCH', `/branches/${a.branchId}`, ownerB, { name: 'Hacked' })).status).toBe(403)
    expect((await call('POST', '/devices', ownerB, { branchId: a.branchId, name: 'Evil' })).status).toBe(403)
  })
  it('cannot assign staff to another business’s branch', async () => {
    const created = await call('POST', '/staff', ownerB, { displayName: 'Xavier', role: 'cashier', pin: '1234', branchIds: [a.branchId] })
    expect(created.status).toBe(403)
  })
  it('cannot point a branch at another business’s tax registration', async () => {
    expect((await call('POST', '/branches', ownerB, { name: 'Evil', code: 'EV', taxRegistrationId: taxA })).status).toBe(422)
  })
  it('rejects extra fields such as tenant or status', async () => {
    expect((await call('PATCH', '/business', ownerA, { status: 'active' })).status).toBe(422)
    expect((await call('PATCH', '/business', ownerA, { tenantId: b.tenantId })).status).toBe(422)
  })
})

describe('roles and branches', () => {
  it('blocks each role from what it may not do', async () => {
    const cashier = await addCashier(ownerA, [a.branchId])
    expect((await call('GET', '/staff', cashier.token)).status).toBe(403)
    expect((await call('GET', '/business', cashier.token)).status).toBe(403)
    expect((await call('PATCH', '/business', cashier.token, { displayName: 'Mine' })).status).toBe(403)
    expect((await call('POST', '/devices', cashier.token, { branchId: a.branchId, name: 'X' })).status).toBe(403)
  })
  it('keeps branch staff inside their branch', async () => {
    const second = await call('POST', '/branches', ownerA, { name: 'Second', code: 'SC', taxRegistrationId: taxA })
    expect(second.status).toBe(201)
    const cashier = await addCashier(ownerA, [a.branchId])
    const branches = await call('GET', '/branches', cashier.token)
    expect(branches.body.items.map((x: any) => x.id)).toEqual([a.branchId])
    expect((await call('GET', '/branches', cashier.token, undefined, { 'x-branch-id': second.body.id })).status).toBe(403)
    const owner = await call('GET', '/branches', ownerA)
    expect(owner.body.items).toHaveLength(2)
  })
  it('creates a register with each new branch', async () => {
    const { rows } = await db.query(`select count(*)::int as n from app.registers where tenant_id = $1`, [a.tenantId])
    expect(rows[0].n).toBe(2)
  })
  it('does not let the last owner be removed', async () => {
    const result = await call('PATCH', `/staff/${a.membershipId}`, ownerA, { status: 'removed' })
    expect(result.status).toBe(409)
    expect(result.body.code).toBe('last_owner')
  })
  it('removes access on the next request', async () => {
    const cashier = await addCashier(ownerA, [a.branchId])
    expect((await call('GET', '/me', cashier.token)).status).toBe(200)
    await call('PATCH', `/staff/${cashier.id}`, ownerA, { status: 'removed' })
    expect((await call('GET', '/me', cashier.token)).status).toBe(403)
  })
  it('blocks a suspended business immediately', async () => {
    await db.query(`update app.tenants set status = 'suspended' where id = $1`, [b.tenantId])
    expect((await call('GET', '/me', ownerB)).status).toBe(403)
    await db.query(`update app.tenants set status = 'active' where id = $1`, [b.tenantId])
  })
})

describe('idempotency', () => {
  it('requires a key on writes', async () => {
    const response = await call('PATCH', '/business', ownerA, { displayName: 'Keyless' }, { 'idempotency-key': '' })
    expect(response.status).toBe(400)
  })
  it('does the work once when replayed, even at the same moment', async () => {
    const key = crypto.randomUUID()
    const headers = { 'idempotency-key': key }
    const body = { branchId: a.branchId, name: 'Till' }
    const replies = await Promise.all(Array.from({ length: 5 }, () => call('POST', '/devices', ownerA, body, headers)))
    expect(new Set(replies.map((r) => r.body.id)).size).toBe(1)
    const { rows } = await db.query(`select count(*)::int as n from app.devices where tenant_id = $1 and name = 'Till'`, [a.tenantId])
    expect(rows[0].n).toBe(1)
  })
  it('refuses one key used for two different requests', async () => {
    const headers = { 'idempotency-key': crypto.randomUUID() }
    await call('PATCH', '/business', ownerA, { displayName: 'First name' }, headers)
    expect((await call('PATCH', '/business', ownerA, { displayName: 'Other name' }, headers)).status).toBe(409)
  })
})

describe('PIN login', () => {
  let device: string
  let deviceId: string
  let cashier: { id: string; token: string }
  const login = (pin: string, credential = device, membershipId = cashier.id) =>
    call('POST', '/auth/pin-login', undefined, { deviceCredential: credential, membershipId, pin })

  beforeAll(async () => {
    const created = await call('POST', '/devices', ownerA, { branchId: a.branchId, name: 'Counter' })
    device = created.body.credential
    deviceId = created.body.id
    cashier = await addCashier(ownerA, [a.branchId], '4821')
  })

  it('lists names for a registered device and nothing without one', async () => {
    const listed = await call('POST', '/auth/device-staff', undefined, { deviceCredential: device })
    expect(listed.body.items.some((x: any) => x.id === cashier.id)).toBe(true)
    expect(JSON.stringify(listed.body)).not.toContain('pin')
    const fake = `${a.tenantId}.${a.branchId}.${deviceId}.wrong`
    expect((await call('POST', '/auth/device-staff', undefined, { deviceCredential: fake })).status).toBe(401)
  })
  it('stores only a hash of the device credential', async () => {
    const { rows } = await db.query(`select credential_hash from app.devices where id = $1`, [deviceId])
    expect(device).not.toContain(rows[0].credential_hash)
  })
  it('gives a working session for the right PIN on a registered device', async () => {
    const result = await login('4821')
    expect(result.status).toBe(200)
    const me = await call('GET', '/me', result.body.accessToken)
    expect(me.body).toMatchObject({ role: 'cashier', branchIds: [a.branchId] })
  })
  it('refuses a PIN without a real device credential', async () => {
    const fake = `${a.tenantId}.${a.branchId}.${deviceId}.wrong-secret`
    expect((await login('4821', fake)).status).toBe(401)
    expect((await login('4821', 'garbage')).status).toBe(401)
  })
  it('refuses staff who do not belong to the device’s branch', async () => {
    const other = await addCashier(ownerB, [b.branchId], '4821')
    expect((await login('4821', device, other.id)).status).toBe(401)
  })
  it('locks after five wrong PINs until a manager unlocks it', async () => {
    for (let i = 0; i < 4; i += 1) expect((await login('0000')).status).toBe(401)
    expect((await login('0000')).status).toBe(423)
    expect((await login('4821')).status).toBe(423)
    expect((await call('POST', `/staff/${cashier.id}/unlock`, ownerA)).status).toBe(200)
    expect((await login('4821')).status).toBe(200)
  })
  it('stops working when the device is revoked', async () => {
    await call('POST', `/devices/${deviceId}/revoke`, ownerA)
    expect((await login('4821')).status).toBe(401)
  })
})

describe('audit', () => {
  it('records who did what, without secrets', async () => {
    const { rows } = await db.query(`select action, actor_membership_id, after_data from app.audit_log where tenant_id = $1`, [a.tenantId])
    expect(rows.some((r) => r.action === 'staff.created' && r.actor_membership_id === a.membershipId)).toBe(true)
    expect(JSON.stringify(rows)).not.toMatch(/argon2|"pin":/)
  })
})
