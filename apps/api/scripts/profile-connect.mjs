// Splits connection time into DNS, TCP, TLS-free handshake, to show which step stalls.
// Run: node --env-file=../../.env.local scripts/profile-connect.mjs
import { lookup } from 'node:dns/promises'
import { connect } from 'node:net'

const url = new URL(process.env.DATABASE_URL_API)
const host = url.hostname
const port = Number(url.port)
const stats = (name, values) => {
  const sorted = [...values].sort((a, b) => a - b)
  const worst = Math.round(sorted.at(-1))
  console.log(`${name.padEnd(10)} n=${values.length} median=${Math.round(sorted[Math.floor(sorted.length / 2)])}ms worst=${worst}ms over1s=${values.filter((v) => v > 1000).length}`)
}

const dns = []
const tcp = []
let failed = 0
for (let i = 0; i < 60; i += 1) {
  const a = performance.now()
  let address
  try {
    ;({ address } = await lookup(host))
  } catch {
    failed += 1
    continue
  }
  dns.push(performance.now() - a)
  const b = performance.now()
  await new Promise((resolve) => {
    const socket = connect({ host: address, port, timeout: 12000 })
    const done = () => { socket.destroy(); resolve() }
    socket.once('connect', () => { tcp.push(performance.now() - b); done() })
    socket.once('timeout', () => { failed += 1; done() })
    socket.once('error', () => { failed += 1; done() })
  })
  await new Promise((resolve) => setTimeout(resolve, 150))
}
stats('dns', dns)
stats('tcp', tcp)
console.log('failed attempts', failed)
