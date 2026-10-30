import { createHash } from 'node:crypto'
import { validateDemoRequest } from '../src/lib/demo-request.js'

const MAX_BYTES = 4096

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

export async function POST(request: Request) {
  const raw = await request.text()
  if (raw.length > MAX_BYTES) return json(413, { code: 'too_large' })

  let body: Record<string, unknown>
  try {
    body = JSON.parse(raw)
  } catch {
    return json(400, { code: 'invalid_json' })
  }

  // Bots fill the hidden field. Reply normally so they don't learn it was noticed.
  if (body.website) return json(201, { ok: true })

  const { value, errors } = validateDemoRequest(body)
  if (Object.keys(errors).length > 0) return json(422, { code: 'invalid', errors })

  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return json(503, { code: 'not_configured' })

  const ip = request.headers.get('x-real-ip')
  if (ip) {
    const visitor = createHash('sha256').update(ip).digest('hex').slice(0, 32)
    const check = await fetch(`${url}/rest/v1/rpc/allow_demo_request`, {
      method: 'POST',
      headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ visitor }),
    }).catch(() => null)
    if (check?.ok && (await check.json()) === false) return json(429, { code: 'too_many_requests' })
  }

  const saved = await fetch(`${url}/rest/v1/demo_requests`, {
    method: 'POST',
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      prefer: 'return=minimal',
    },
    body: JSON.stringify(value),
  }).catch(() => null)

  if (!saved?.ok) {
    console.error('demo_request_failed', saved?.status ?? 'network')
    return json(502, { code: 'save_failed' })
  }
  return json(201, { ok: true })
}
