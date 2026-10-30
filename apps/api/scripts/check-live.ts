// Checks a deployed POS end to end and measures speed. Use a demo business only.
// Run: npx tsx --env-file=../../.env.local scripts/check-live.ts https://app-address owner-email
import { createSession } from '../src/platform/supabase.js'

const base = process.argv[2].replace(/\/$/, '')
const email = process.argv[3]

const stats = (name: string, values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  const at = (p: number) => Math.round(sorted[Math.floor((sorted.length - 1) * p)])
  console.log(`${name.padEnd(24)} n=${values.length} median=${at(0.5)}ms p95=${at(0.95)}ms worst=${at(1)}ms`)
}

const timed = async (path: string, init?: RequestInit) => {
  const started = performance.now()
  const response = await fetch(base + path, init)
  const text = await response.text()
  return { ms: performance.now() - started, status: response.status, text, headers: response.headers }
}

const session = await createSession(email)
const auth = { authorization: `Bearer ${session.access_token}`, 'content-type': 'application/json' }
const get = (path: string) => timed(`/api/v1${path}`, { headers: auth })
const write = (path: string, body: object, method = 'POST') =>
  timed(`/api/v1${path}`, { method, headers: { ...auth, 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify(body) })
const line = (name: string, r: { status: number; text: string }, want: number) =>
  console.log(`${r.status === want ? 'PASS' : 'FAIL'} ${name}: ${r.status}${r.status === want ? '' : ' ' + r.text.slice(0, 140)}`)

console.log('--- access')
line('no session is refused', await timed('/api/v1/me'), 401)
line('fake session is refused', await timed('/api/v1/me', { headers: { authorization: 'Bearer nope.nope.nope' } }), 401)
const me = await get('/me')
line('database connection and sign-in', me, 200)
if (me.status !== 200) process.exit(1)

console.log('--- full sale')
const menu = JSON.parse((await get('/menu')).text)
const variant = menu.products.flatMap((p: any) => p.is_active ? p.variants : []).find((v: any) => v.isAvailable).id
const methods = JSON.parse((await get('/payment-methods')).text).items
const upi = methods.find((m: any) => m.kind === 'upi').id
const id = crypto.randomUUID()
line('start order', await write('/orders', { id, orderType: 'takeaway', notes: 'Live check' }), 201)
const add = await write(`/orders/${id}/items`, { id: crypto.randomUUID(), variantId: variant })
line('add item', add, 201)
line('tax quote', await get(`/orders/${id}/quote`), 200)
const invoiceId = crypto.randomUUID()
const finalize = await write(`/orders/${id}/finalize`, { version: JSON.parse(add.text).version, invoices: [{ id: invoiceId }] })
line('issue bill', finalize, 201)
const total = JSON.parse(finalize.text).invoices?.[0]?.grandTotal
const pay = await write('/payments', { id: crypto.randomUUID(), methodId: upi, amount: total, reference: `LIVE-${Date.now()}`, allocations: [{ invoiceId, amount: total }] })
line('record payment', pay, 201)
const paid = JSON.parse((await get(`/invoices/${invoiceId}`)).text)
console.log(`${paid.outstanding === '0.00' ? 'PASS' : 'FAIL'} bill ${paid.number} for ₹${paid.grand_total}, still owed ₹${paid.outstanding}`)
line('daily report', await get(`/reports/daily?from=${paid.business_date}`), 200)

console.log('--- staff PIN login')
const branchId = JSON.parse(me.text).branchIds[0]
const device = await write('/devices', { branchId, name: 'Live check' })
line('register device', device, 201)
const staff = await write('/staff', { displayName: 'Live Check', role: 'cashier', pin: '7391', branchIds: [branchId] })
line('add cashier', staff, 201)
const { credential, id: deviceId } = JSON.parse(device.text)
const staffId = JSON.parse(staff.text).id
const login = (pin: string) => timed('/api/v1/auth/pin-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deviceCredential: credential, membershipId: staffId, pin }) })
const pin = await login('7391')
line('PIN login', pin, 200)
line('wrong PIN refused', await login('0000'), 401)
const cashierToken = JSON.parse(pin.text).accessToken
line('cashier blocked from reports', await timed('/api/v1/reports/daily?from=2026-10-30', { headers: { authorization: `Bearer ${cashierToken}` } }), 403)
await write(`/staff/${staffId}`, { status: 'removed' }, 'PATCH')
await write(`/devices/${deviceId}/revoke`, {})

console.log('--- speed (measured from this PC, so it includes your internet)')
const pings: number[] = []
for (let i = 0; i < 12; i += 1) pings.push((await timed('/api/v1/health')).ms)
stats('network only (health)', pings)
const reads: number[] = []
for (let i = 0; i < 12; i += 1) reads.push((await get('/orders?status=open')).ms)
stats('list open orders', reads)
const starts: number[] = []
const adds: number[] = []
for (let i = 0; i < 6; i += 1) {
  const orderId = crypto.randomUUID()
  starts.push((await write('/orders', { id: orderId, orderType: 'takeaway', notes: 'Speed test' })).ms)
  const item = await write(`/orders/${orderId}/items`, { id: crypto.randomUUID(), variantId: variant })
  adds.push(item.ms)
  await write(`/orders/${orderId}/cancel`, { version: JSON.parse(item.text).version, reason: 'Speed test' })
}
stats('start order', starts)
stats('add item', adds)
console.log(`once each: issue bill ${Math.round(finalize.ms)}ms, record payment ${Math.round(pay.ms)}ms, PIN login ${Math.round(pin.ms)}ms`)

console.log('--- request limit')
const statuses: number[] = []
for (let i = 0; i < 33; i += 1) {
  statuses.push((await timed('/api/v1/auth/device-staff', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deviceCredential: 'probe' }) })).status)
}
console.log('first', statuses[0], 'last', statuses.at(-1), 'blocked', statuses.filter((s) => s === 429).length, 'of 33')
process.exit(0)
