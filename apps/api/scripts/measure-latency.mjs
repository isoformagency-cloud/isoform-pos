// Measures database round trips and open connections from this machine.
// Run: node --env-file=../../.env.local scripts/measure-latency.mjs
import pg from 'pg'

const ssl = { rejectUnauthorized: false }
async function measure(name, url) {
  const started = performance.now()
  const client = new pg.Client({ connectionString: url, ssl })
  await client.connect()
  const connect = performance.now() - started
  const times = []
  for (let i = 0; i < 15; i += 1) {
    const t = performance.now()
    await client.query('select 1')
    times.push(performance.now() - t)
  }
  times.sort((a, b) => a - b)
  console.log(name, `connect ${Math.round(connect)} ms, median ${Math.round(times[7])} ms, worst ${Math.round(times[14])} ms`)
  await client.end()
}

await measure('direct', process.env.DATABASE_URL_DIRECT)
await measure('pooler', process.env.DATABASE_URL_API)

const admin = new pg.Client({ connectionString: process.env.DATABASE_URL_DIRECT, ssl })
await admin.connect()
const { rows } = await admin.query(
  `select usename, state, count(*)::int as n, max(now() - state_change)::text as longest
     from pg_stat_activity where datname = current_database() and usename is not null
    group by usename, state order by n desc`,
)
console.table(rows)
const { rows: [locks] } = await admin.query(`select count(*)::int as waiting from pg_stat_activity where wait_event_type = 'Lock'`)
console.log('waiting on locks', locks.waiting)
await admin.end()
