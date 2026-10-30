// Proves the limits through the API's own tx(), the way every real request runs.
// Run: npx tsx --env-file=../../.env.local scripts/prove-time-limits.ts
import { closeDb, tx } from '../src/platform/db'

const attempt = async (name: string, fn: () => Promise<unknown>) => {
  const started = performance.now()
  try {
    await fn()
    console.log(`FAIL ${name}: was allowed`)
  } catch (error) {
    const { code, message } = error as { code?: string; message?: string }
    console.log(`PASS ${name}: stopped after ${Math.round((performance.now() - started) / 1000)}s (${code ?? message})`)
  }
}

const limits = await tx({}, async (db) => {
  const { rows } = await db.query(`select current_setting('statement_timeout') s, current_setting('lock_timeout') l, current_setting('idle_in_transaction_session_timeout') i`)
  return rows[0]
})
console.log('limits inside a request', limits)

await attempt('slow statement', () => tx({}, (db) => db.query('select pg_sleep(40)')))
await attempt('abandoned transaction', () =>
  tx({}, async (db) => {
    await new Promise((resolve) => setTimeout(resolve, 34000))
    return db.query('select 1')
  }),
)

const after = await tx({}, async (db) => (await db.query(`select current_setting('statement_timeout') s`)).rows[0])
console.log('API still works afterwards', after)
await closeDb()
