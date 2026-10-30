// Reads the certificate chain the database presents and tests strict verification.
// Run: node --env-file=../../.env.local scripts/read-db-certificate.mjs [save]
import { X509Certificate } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { connect } from 'node:net'
import tls from 'node:tls'
import pg from 'pg'

async function chain(url) {
  const { hostname, port } = new URL(url)
  const socket = await new Promise((resolve, reject) => {
    const raw = connect({ host: hostname, port: Number(port) }, () => {
      const request = Buffer.alloc(8)
      request.writeInt32BE(8, 0)
      request.writeInt32BE(80877103, 4)
      raw.write(request)
      raw.once('data', (reply) => (reply.toString() === 'S' ? resolve(raw) : reject(new Error('no TLS'))))
    })
    raw.once('error', reject)
  })
  const secure = tls.connect({ socket, servername: hostname, rejectUnauthorized: false })
  await new Promise((resolve) => secure.once('secureConnect', resolve))
  const certs = []
  let cert = secure.getPeerCertificate(true)
  const seen = new Set()
  while (cert?.raw && !seen.has(cert.fingerprint256)) {
    seen.add(cert.fingerprint256)
    const x509 = new X509Certificate(cert.raw)
    certs.push({ subject: x509.subject.replace(/\n/g, ', '), issuer: x509.issuer.replace(/\n/g, ', '), expires: x509.validTo, sha256: x509.fingerprint256, pem: x509.toString() })
    cert = cert.issuerCertificate
  }
  secure.destroy()
  return certs
}

for (const name of ['DATABASE_URL_API', 'DATABASE_URL_DIRECT']) {
  const certs = await chain(process.env[name])
  console.log(name)
  for (const c of certs) console.log('  ', c.subject, '| issued by', c.issuer, '| expires', c.expires)
}

const pooled = await chain(process.env.DATABASE_URL_API)
const root = pooled.at(-1)
console.log('root sha256', root.sha256)

for (const name of ['DATABASE_URL_API', 'DATABASE_URL_DIRECT']) {
  const client = new pg.Client({ connectionString: process.env[name], ssl: { ca: root.pem, rejectUnauthorized: true } })
  try {
    await client.connect()
    await client.query('select 1')
    console.log(name, 'strict verification PASSED')
  } catch (error) {
    console.log(name, 'strict verification FAILED:', error.code ?? error.message)
  } finally {
    await client.end().catch(() => {})
  }
}

if (process.argv[2] === 'save') {
  writeFileSync(new URL('../src/platform/database-ca.ts', import.meta.url), `// Public root certificate of the Supabase database. SHA-256 ${root.sha256}\nexport const DATABASE_CA = \`${root.pem.trim()}\n\`\n`)
  console.log('saved')
}
