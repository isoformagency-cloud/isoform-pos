// Lists transactions the API left open, and what they hold. Add "end" to terminate them.
// Run: node --env-file=../../.env.local scripts/show-stuck.mjs [end]
import pg from 'pg'

const db = new pg.Client({ connectionString: process.env.DATABASE_URL_DIRECT, ssl: { rejectUnauthorized: false } })
await db.connect()
const { rows } = await db.query(
  `select a.pid, a.state, now() - a.xact_start as open_for, left(regexp_replace(a.query, '\\s+', ' ', 'g'), 140) as last_query,
          (select count(*)::int from pg_locks l where l.pid = a.pid and l.locktype = 'advisory') as advisory_locks,
          (select count(*)::int from pg_locks l where l.pid = a.pid and l.mode like '%Exclusive%' and l.locktype = 'relation') as table_locks
     from pg_stat_activity a
    where a.usename = 'isoform_api' and a.state like 'idle in transaction%'`,
)
for (const row of rows) console.log(row)
if (rows.length === 0) console.log('none stuck')
if (process.argv[2] === 'end') {
  for (const { pid } of rows) await db.query(`select pg_terminate_backend($1)`, [pid])
  console.log('ended', rows.length)
}
await db.end()
