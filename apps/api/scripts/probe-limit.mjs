// Sends public requests until the limiter responds. Run: node scripts/probe-limit.mjs https://app-address
const base = process.argv[2]
const statuses = []
for (let i = 0; i < 75; i += 1) {
  const response = await fetch(`${base}/api/v1/auth/device-staff`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deviceCredential: 'probe' }),
  })
  statuses.push(response.status)
}
const first = statuses.indexOf(429)
console.log('sent', statuses.length, '| first blocked at request', first + 1, '| blocked', statuses.filter((s) => s === 429).length, '| other', [...new Set(statuses)].join(','))
