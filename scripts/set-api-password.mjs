// Gives the API's login role a random password and saves its connection URL to .env.local.
// Run with: node --env-file=.env.local scripts/set-api-password.mjs
import { randomBytes } from 'node:crypto'
import { appendFileSync, readFileSync } from 'node:fs'
import pg from 'pg'

const envFile = new URL('../.env.local', import.meta.url)
if (/^DATABASE_URL_API=/m.test(readFileSync(envFile, 'utf8'))) {
  console.log('DATABASE_URL_API already set')
  process.exit(0)
}

const password = randomBytes(24).toString('hex')
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL_DIRECT, ssl: { rejectUnauthorized: false } })
await admin.connect()
await admin.query(`alter role isoform_api password '${password}'`)
await admin.end()

const url = new URL(process.env.DATABASE_URL_POOLER)
url.username = url.username.replace(/^postgres/, 'isoform_api')
url.password = password
appendFileSync(envFile, `\nDATABASE_URL_API=${url}\n`)
console.log('Saved DATABASE_URL_API to .env.local')
