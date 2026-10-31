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
line('POS settings', await get('/pos-settings'), 200)
line('alerts', await get('/alerts'), 200)
line('order counts', await get('/orders/counts'), 200)
line('search', await get('/search?q=ab'), 200)

console.log('--- full sale')
const menu = JSON.parse((await get('/menu')).text)
const variant = menu.products.flatMap((p: any) => p.is_active ? p.variants : []).find((v: any) => v.isAvailable).id
const methods = JSON.parse((await get('/payment-methods')).text).items
const upi = methods.find((m: any) => m.kind === 'upi').id
const kinds = methods.map((m: any) => m.kind).join(', ')
console.log(`${kinds.startsWith('cash, upi, card, bank_transfer') ? 'PASS' : 'FAIL'} payment order: ${kinds}`)
const id = crypto.randomUUID()
line('start order', await write('/orders', { id, orderType: 'takeaway', notes: 'Live check' }), 201)
const add = await write(`/orders/${id}/items`, { id: crypto.randomUUID(), variantId: variant })
line('add item', add, 201)
const held = await write(`/orders/${id}/hold`, { version: JSON.parse(add.text).version, held: true })
line('hold order', held, 200)
const resumed = await write(`/orders/${id}/hold`, { version: JSON.parse(held.text).version, held: false })
line('resume order', resumed, 200)
const sent = await write(`/orders/${id}/send`, { version: JSON.parse(resumed.text).version })
line('send to kitchen', sent, 200)
const onBoard = await get('/kitchen')
line('kitchen board', onBoard, 200)
const ticket = JSON.parse(onBoard.text).tickets.find((row: any) => row.order_id === id)
line('ticket moves to preparing', await write(`/kitchen/tickets/${ticket.id}/status`, { from: 'new', to: 'preparing' }), 200)
line('ticket tick', await write(`/kitchen/items/${ticket.items[0].id}/tick`, { done: true }), 200)
line('floor plan', await get('/floor'), 200)
line('reservations', await get('/reservations'), 200)
const confirm = await write(`/orders/${id}/confirm`, { version: JSON.parse(sent.text).version })
line('confirm order', confirm, 200)
line('new item blocked after confirming', await write(`/orders/${id}/items`, { id: crypto.randomUUID(), variantId: variant }), 409)
line('service charge blocked after confirming', await write(`/orders/${id}`, { version: JSON.parse(confirm.text).version, serviceChargePercent: '5' }, 'PATCH'), 409)
const discount = await write(`/orders/${id}/discounts`, { id: crypto.randomUUID(), kind: 'percent', value: '10', reason: 'Live check' })
line('discount after confirming', discount, 201)
line('tax quote', await get(`/orders/${id}/quote`), 200)
const invoiceId = crypto.randomUUID()
const finalize = await write(`/orders/${id}/finalize`, { version: JSON.parse(discount.text).version, invoices: [{ id: invoiceId }] })
line('issue bill', finalize, 201)
const emptyId = crypto.randomUUID()
const empty = await write('/orders', { id: emptyId, orderType: 'takeaway', notes: 'Live check, empty' })
line('empty order deletes with no reason', await write(`/orders/${emptyId}/cancel`, { version: JSON.parse(empty.text).version }), 200)
const total = JSON.parse(finalize.text).invoices?.[0]?.grandTotal
const paymentId = crypto.randomUUID()
const pay = await write('/payments', { id: paymentId, methodId: upi, amount: total, reference: `LIVE-${Date.now()}`, allocations: [{ invoiceId, amount: total }] })
line('record payment', pay, 201)
const confirmAll = await write('/payments/confirm-all', { ids: [paymentId] })
line('confirm all, own payment', confirmAll, 200)
console.log(`${confirmAll.text.includes('"confirmed":1') ? 'PASS' : 'FAIL'} confirm all result: ${confirmAll.text.slice(0, 60)}`)
const paid = JSON.parse((await get(`/invoices/${invoiceId}`)).text)
console.log(`${paid.outstanding === '0.00' ? 'PASS' : 'FAIL'} bill ${paid.number} for ₹${paid.grand_total}, still owed ₹${paid.outstanding}`)
line('daily report', await get(`/reports/daily?from=${paid.business_date}`), 200)
line('order timeline', await get(`/orders/${id}/timeline`), 200)
line('order export', await get('/orders/export?status=finalized'), 200)

console.log('--- customers, expenses and stock')
const branchId = JSON.parse(me.text).branchIds[0]
const atBranch = (path: string) => timed(`/api/v1${path}`, { headers: { ...auth, 'x-branch-id': branchId } })
line('customers', await get('/customers'), 200)
line('customer summary', await get('/customers/summary'), 200)
line('suppliers', await get('/suppliers'), 200)
line('stock history', await atBranch('/inventory/moves'), 200)
line('expense summary', await atBranch('/expenses/summary'), 200)
const expenseList = await atBranch('/expenses')
line('expenses', expenseList, 200)
const withReceipt = JSON.parse(expenseList.text).items.find((row: any) => row.has_receipt)
if (withReceipt) {
  const receipt = await atBranch(`/expenses/${withReceipt.id}/receipt`)
  line('receipt link', receipt, 200)
  const { url } = JSON.parse(receipt.text)
  const photo = await fetch(url)
  console.log(`${photo.ok && photo.headers.get('content-type') === 'image/jpeg' ? 'PASS' : 'FAIL'} receipt photo: ${photo.status} ${photo.headers.get('content-type')}`)
  console.log(`receipt url ${url}`)
} else console.log('SKIP receipt: no expense has a photo')

const recipes = await Promise.all(menu.products.filter((p: any) => p.is_active).map(async (product: any) => (
  { product, lines: JSON.parse((await get(`/products/${product.id}/recipe`)).text).lines }
)))
const recipe = recipes.find((row) => row.lines.length > 0 && row.product.variants.some((v: any) => v.isAvailable))
if (recipe) {
  const level = async () => JSON.parse((await atBranch('/inventory')).text).items.find((row: any) => row.id === recipe.lines[0].stock_item_id)
  const before = await level()
  const saleId = crypto.randomUUID()
  await write('/orders', { id: saleId, orderType: 'takeaway', notes: 'Live check, stock' })
  const saleItem = await write(`/orders/${saleId}/items`, { id: crypto.randomUUID(), variantId: recipe.product.variants.find((v: any) => v.isAvailable).id })
  const saleConfirm = await write(`/orders/${saleId}/confirm`, { version: JSON.parse(saleItem.text).version })
  const saleInvoice = crypto.randomUUID()
  const saleBill = await write(`/orders/${saleId}/finalize`, { version: JSON.parse(saleConfirm.text).version, invoices: [{ id: saleInvoice }] })
  line('bill with a recipe', saleBill, 201)
  const saleTotal = JSON.parse(saleBill.text).invoices?.[0]?.grandTotal
  await write('/payments', { id: crypto.randomUUID(), methodId: upi, amount: saleTotal, allocations: [{ invoiceId: saleInvoice, amount: saleTotal }] })
  const after = await level()
  const taken = Number(before.quantity) - Number(after.quantity)
  console.log(`${taken === Number(recipe.lines[0].quantity) ? 'PASS' : 'FAIL'} sale took ${taken} ${before.unit} of ${before.name}, ${before.quantity} to ${after.quantity}`)
} else console.log('SKIP stock deduction: no menu item has a recipe')

console.log('--- dashboard, reports, menu and settings')
line('dashboard', await get('/dashboard?range=today'), 200)
line('sales report', await get(`/reports/sales?from=${paid.business_date}`), 200)
line('item report', await get(`/reports/products?from=${paid.business_date}`), 200)
line('profit report', await get(`/reports/profit?from=${paid.business_date}`), 200)
line('staff report', await get(`/reports/staff?from=${paid.business_date}`), 200)
line('activity log', await get('/activity?group=discounts'), 200)
line('staff list', await get('/staff'), 200)
line('permissions grid', await get('/permissions'), 200)
line('setup guide', await get('/setup'), 200)
line('all payment methods', await get('/payment-methods/all'), 200)
line('backup sections', await get('/backup'), 200)
const copied = await write(`/products/${menu.products.find((p: any) => p.is_active).id}/duplicate`, {})
line('duplicate an item', copied, 201)
line('hide the copy', await write(`/products/${JSON.parse(copied.text).id}`, { isActive: false }, 'PATCH'), 200)

console.log('--- staff PIN login')
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
const asCashier = { headers: { authorization: `Bearer ${cashierToken}` } }
line('cashier blocked from reports', await timed('/api/v1/reports/daily?from=2026-10-30', asCashier), 403)
line('cashier blocked from dashboard', await timed('/api/v1/dashboard', asCashier), 403)
line('cashier blocked from permissions', await timed('/api/v1/permissions', asCashier), 403)
line('cashier blocked from backup', await timed('/api/v1/backup/customers', asCashier), 403)
await write(`/staff/${staffId}`, { status: 'removed' }, 'PATCH')
await write(`/devices/${deviceId}/revoke`, {})

console.log('--- speed (measured from this PC, so it includes your internet)')
const pings: number[] = []
for (let i = 0; i < 12; i += 1) pings.push((await timed('/api/v1/health')).ms)
stats('network only (health)', pings)
const reads: number[] = []
for (let i = 0; i < 12; i += 1) reads.push((await get('/orders?status=open')).ms)
stats('list open orders', reads)
const stockReads: number[] = []
for (let i = 0; i < 12; i += 1) stockReads.push((await atBranch('/inventory')).ms)
stats('stock page', stockReads)
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
