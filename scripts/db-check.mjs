// Read-only connection check. Run with: node --env-file=.env.local scripts/db-check.mjs
import pg from 'pg'

for (const name of ['DATABASE_URL_DIRECT', 'DATABASE_URL_POOLER']) {
  const client = new pg.Client({
    connectionString: process.env[name],
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
  })
  try {
    await client.connect()
    const { rows: [info] } = await client.query(
      `select current_setting('server_version') as version, current_user as role,
         (select count(*)::int from pg_tables where schemaname = 'public') as public_tables,
         (select count(*)::int from information_schema.schemata where schema_name = 'app') as app_schema`,
    )
    console.log(name, 'OK', info)
  } catch (error) {
    console.log(name, 'FAILED', error.code ?? '', String(error.message).replace(/postgres(ql)?:\/\/\S+/g, '<url>').slice(0, 120))
  } finally {
    await client.end().catch(() => {})
  }
}
