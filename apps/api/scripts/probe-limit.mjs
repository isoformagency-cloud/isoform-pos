// Sends public requests until the limiter responds. Run: node scripts/probe-limit.mjs https://app-address
const base = process.argv[2]
const statuses = []
let dropped = 0
for (let i = 0; i < 75; i += 1) {
  try {
    const response = await fetch(`${base}/api/v1/auth/device-staff`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deviceCredential: 'probe' }),
    })
    statuses.push(response.status)
  } catch {
    dropped += 1
  }
}
const first = statuses.indexOf(429)
console.log('answered', statuses.length, '| dropped', dropped, '| first blocked at', first + 1, '| blocked', statuses.filter((s) => s === 429).length, '| statuses', [...new Set(statuses)].join(','))
