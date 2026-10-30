import pg from 'pg'

export interface DbContext {
  tenantId?: string
  branchIds?: string[]
  membershipId?: string
  userId?: string
}

// Small pool: each serverless instance shares Supabase's transaction pooler.
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL_API,
  ssl: { rejectUnauthorized: false },
  max: 3,
  // Reusing a connection takes 60 ms. Opening one takes 500 ms and sometimes stalls.
  idleTimeoutMillis: 120000,
  connectionTimeoutMillis: 5000,
  // Without this, a silently dead connection would leave a request waiting forever.
  query_timeout: 25000,
  keepAlive: true,
})

// An idle connection dropping is normal. Without this listener it would crash the process.
pool.on('error', (error) => console.error('db_idle_error', (error as { code?: string }).code))

export type Db = pg.PoolClient

const CONNECTION_ERRORS = new Set(['ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNREFUSED', 'EPIPE', '57P01', '25P03'])
export const isConnectionError = (error: unknown) => {
  const { code, message } = error as { code?: string; message?: string }
  return CONNECTION_ERRORS.has(code ?? '') || /Query read timeout|timeout expired|timeout exceeded|Connection terminated|not queryable/i.test(message ?? '')
}

/** Runs fn in one transaction with the request's context, which ends with the transaction. */
/** A stalled connection attempt usually succeeds at once when tried again. */
async function connectWithRetry(attempts = 3): Promise<pg.PoolClient> {
  try {
    return await pool.connect()
  } catch (error) {
    if (attempts <= 1 || !isConnectionError(error)) throw error
    return connectWithRetry(attempts - 1)
  }
}

export async function tx<T>(context: DbContext, fn: (db: Db) => Promise<T>, canRetry = true): Promise<T> {
  const db = await connectWithRetry()
  // A connection dying mid-request must fail that request, not crash the whole process.
  const ignore = () => {}
  db.on('error', ignore)
  const release = (destroy?: boolean) => {
    db.off('error', ignore)
    db.release(destroy)
  }
  let started = false
  try {
    // Sent as one message to save a network round trip. Values are escaped.
    const value = (text: string | undefined) => db.escapeLiteral(text ?? '')
    await db.query(
      `begin;
       set local statement_timeout = '20s';
       set local lock_timeout = '10s';
       set local idle_in_transaction_session_timeout = '30s';
       select set_config('app.tenant_id', ${value(context.tenantId)}, true),
         set_config('app.branch_ids', ${value(`{${(context.branchIds ?? []).join(',')}}`)}, true),
         set_config('app.membership_id', ${value(context.membershipId)}, true),
         set_config('app.user_id', ${value(context.userId)}, true)`,
    )
    started = true
    const result = await fn(db)
    await db.query('commit')
    release()
    return result
  } catch (error) {
    if (isConnectionError(error)) {
      release(true)
      // Retried only if the work never began, so nothing can run twice.
      if (!started && canRetry) return tx(context, fn, false)
      throw error
    }
    await db.query('rollback').catch(() => {})
    release()
    throw error
  }
}

export const closeDb = () => pool.end()
