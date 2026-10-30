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
  idleTimeoutMillis: 10000,
})

export type Db = pg.PoolClient

/** Runs fn in one transaction with the request's context, which ends with the transaction. */
export async function tx<T>(context: DbContext, fn: (db: Db) => Promise<T>): Promise<T> {
  const db = await pool.connect()
  try {
    // Sent as one message to save a network round trip. Values are escaped.
    const value = (text: string | undefined) => db.escapeLiteral(text ?? '')
    await db.query(
      `begin; select set_config('app.tenant_id', ${value(context.tenantId)}, true),
         set_config('app.branch_ids', ${value(`{${(context.branchIds ?? []).join(',')}}`)}, true),
         set_config('app.membership_id', ${value(context.membershipId)}, true),
         set_config('app.user_id', ${value(context.userId)}, true)`,
    )
    const result = await fn(db)
    await db.query('commit')
    return result
  } catch (error) {
    await db.query('rollback').catch(() => {})
    throw error
  } finally {
    db.release()
  }
}

export const closeDb = () => pool.end()
