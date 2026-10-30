// Times real work to show where a slow request spends its time.
// Run: npx tsx --env-file=../../.env.local scripts/profile-requests.ts
import pg from 'pg'
import { closeDb, tx } from '../src/platform/db'

const ssl = { rejectUnauthorized: false }
const stats = (name: string, values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  const at = (p: number) => Math.round(sorted[Math.floor((sorted.length - 1) * p)])
  console.log(`${name.padEnd(30)} n=${values.length} median=${at(0.5)}ms p95=${at(0.95)}ms worst=${at(1)}ms over1s=${values.filter((v) => v > 1000).length}`)
}

async function loop(url: string, count: number) {
  const client = new pg.Client({ connectionString: url, ssl })
  client.on('error', () => {})
  await client.connect()
  const times: number[] = []
  for (let i = 0; i < count; i += 1) {
    const t = performance.now()
    await client.query('select 1')
    times.push(performance.now() - t)
  }
  await client.end()
  return times
}

stats('direct select 1', await loop(process.env.DATABASE_URL_DIRECT!, 120))
stats('pooler select 1', await loop(process.env.DATABASE_URL_API!, 120))

const connects: number[] = []
for (let i = 0; i < 12; i += 1) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL_API, ssl })
  const t = performance.now()
  await client.connect()
  connects.push(performance.now() - t)
  await client.end()
}
stats('new pooler connection', connects)

const txs: number[] = []
for (let i = 0; i < 40; i += 1) {
  const t = performance.now()
  await tx({}, (db) => db.query('select 1'))
  txs.push(performance.now() - t)
}
stats('tx with one query', txs)

const parallel: number[] = []
for (let round = 0; round < 6; round += 1) {
  await Promise.all(Array.from({ length: 8 }, async () => {
    const t = performance.now()
    await tx({}, (db) => db.query('select 1'))
    parallel.push(performance.now() - t)
  }))
}
stats('8 parallel tx (pool of 3)', parallel)
await closeDb()

const admin = new pg.Client({ connectionString: process.env.DATABASE_URL_DIRECT, ssl })
await admin.connect()
const { rows } = await admin.query(
  `select usename, coalesce(state, '-') as state, count(*)::int as n from pg_stat_activity
    where usename in ('isoform_api', 'pgbouncer', 'postgres') group by 1, 2 order by 1, 2`,
)
console.table(rows)
const { rows: [size] } = await admin.query(
  `select pg_size_pretty(pg_database_size(current_database())) as db,
          (select count(*)::int from auth.users) as users, (select setting from pg_settings where name = 'max_connections') as max_connections`,
)
console.log(size)
await admin.end()
