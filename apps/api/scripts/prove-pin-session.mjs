// Stage 4 proof: can a PIN-only staff member get a real Supabase session that works
// with private Realtime, and is an unassigned user kept out? Creates and removes its own data.
import { createClient } from '@supabase/supabase-js'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import pg from 'pg'

const { SUPABASE_URL: url, SUPABASE_ANON_KEY: anon, SUPABASE_SERVICE_ROLE_KEY: service, DATABASE_URL_DIRECT: direct } = process.env
const admin = createClient(url, service, { auth: { persistSession: false } })
const db = new pg.Client({ connectionString: direct, ssl: { rejectUnauthorized: false } })
await db.connect()

const tenant = crypto.randomUUID()
const tax = crypto.randomUUID()
const branch = crypto.randomUUID()
const created = []

async function sessionFor(label) {
  const email = `staff-${crypto.randomUUID()}@staff.isoform.invalid`
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true })
  if (error) throw new Error(`create ${label}: ${error.message}`)
  created.push(data.user.id)
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (link.error) throw new Error(`link ${label}: ${link.error.message}`)
  const client = createClient(url, anon, { auth: { persistSession: false } })
  const verified = await client.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: 'magiclink' })
  if (verified.error) throw new Error(`verify ${label}: ${verified.error.message}`)
  return { client, session: verified.data.session, userId: data.user.id }
}

async function listen(person, topic) {
  await person.client.realtime.setAuth(person.session.access_token)
  const received = []
  const channel = person.client.channel(topic, { config: { private: true } })
  channel.on('broadcast', { event: 'changed' }, (message) => received.push(message.payload))
  const states = []
  const status = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(states.at(-1) ?? 'TIMEOUT'), 12000)
    channel.subscribe((state, error) => {
      states.push(error ? `${state}: ${error.message}` : state)
      if (state === 'SUBSCRIBED') { clearTimeout(timer); resolve(state) }
    })
  })
  console.log(`      states: ${states.join(' > ').slice(0, 220)}`)
  return { status, received, channel }
}

let ok = true
const report = (name, pass, detail = '') => { ok &&= pass; console.log(`${pass ? 'PASS' : 'FAIL'}  ${name} ${detail}`) }

try {
  const staff = await sessionFor('staff')
  const outsider = await sessionFor('outsider')
  await db.query(`insert into app.tenants (id, display_name, status) values ($1, 'Proof', 'active')`, [tenant])
  await db.query(`insert into app.tax_registrations (id, tenant_id, legal_name, state_code, scheme, address) values ($1, $2, 'P', '33', 'unregistered', 'A')`, [tax, tenant])
  await db.query(`insert into app.branches (id, tenant_id, tax_registration_id, name, code) values ($1, $2, $3, 'Main', 'MN')`, [branch, tenant, tax])
  const member = crypto.randomUUID()
  await db.query(`insert into app.memberships (id, tenant_id, user_id, display_name, role) values ($1, $2, $3, 'Cashier', 'cashier')`, [member, tenant, staff.userId])
  await db.query(`insert into app.branch_memberships (tenant_id, membership_id, branch_id) values ($1, $2, $3)`, [tenant, member, branch])

  report('PIN user gets a session without any email sent', Boolean(staff.session?.access_token))
  const JWKS = createRemoteJWKSet(new URL(`${url}/auth/v1/.well-known/jwks.json`))
  const { payload, protectedHeader } = await jwtVerify(staff.session.access_token, JWKS, { audience: 'authenticated' })
  report('The API can verify that session locally', payload.sub === staff.userId, protectedHeader.alg)

  const topic = `branch:${branch}`
  const allowed = await listen(staff, topic)
  report('Assigned staff can join their branch channel', allowed.status === 'SUBSCRIBED', allowed.status)
  const blocked = await listen(outsider, topic)
  report('An unassigned user is refused', blocked.status !== 'SUBSCRIBED', blocked.status)

  const sent = await fetch(`${url}/realtime/v1/api/broadcast`, {
    method: 'POST',
    headers: { apikey: service, authorization: `Bearer ${service}`, 'content-type': 'application/json' },
    body: JSON.stringify({ messages: [{ topic, event: 'changed', payload: { entity: 'order' }, private: true }] }),
  })
  await new Promise((resolve) => setTimeout(resolve, 2500))
  report('A server signal reaches assigned staff', allowed.received.length === 1, `http ${sent.status}, ${allowed.received.length} received`)
  report('The outsider receives nothing', blocked.received.length === 0)
  await staff.client.realtime.disconnect()
  await outsider.client.realtime.disconnect()
} catch (error) {
  report('Proof crashed', false, error.message)
} finally {
  await db.query(`delete from app.branch_memberships where tenant_id = $1`, [tenant])
  await db.query(`delete from app.memberships where tenant_id = $1`, [tenant])
  await db.query(`delete from app.branches where tenant_id = $1`, [tenant])
  await db.query(`delete from app.tax_registrations where tenant_id = $1`, [tenant])
  await db.query(`delete from app.tenants where id = $1`, [tenant])
  for (const id of created) await admin.auth.admin.deleteUser(id)
  await db.end()
}
process.exit(ok ? 0 : 1)
