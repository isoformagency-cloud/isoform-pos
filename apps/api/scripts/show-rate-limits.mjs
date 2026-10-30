// Read-only: shows what the request limiter has counted.
// Run: node --env-file=../../.env.local scripts/show-rate-limits.mjs
import pg from 'pg'

const db = new pg.Client({ connectionString: process.env.DATABASE_URL_DIRECT, ssl: { rejectUnauthorized: false } })
await db.connect()
const { rows } = await db.query(
  `select split_part(bucket, ':', 1) as name, left(split_part(bucket, ':', 2), 8) as visitor, hits, window_ends > now() as active
     from app.rate_limits order by window_ends desc limit 12`,
)
console.table(rows)
const { rows: [total] } = await db.query(`select count(*)::int as buckets from app.rate_limits`)
console.log(total)
await db.end()
