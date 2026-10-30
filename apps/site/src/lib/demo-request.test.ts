import { afterEach, describe, expect, it, vi } from 'vitest'
import { POST } from '../../api/demo-request'
import { validateDemoRequest } from './demo-request'

const valid = {
  name: 'Asha Raman',
  business: 'Hill Cafe',
  phone: '+91 98765-43210',
  email: '',
  city: 'Ooty',
  outlets: '1',
  message: '',
}

const send = (body: unknown) =>
  POST(new Request('http://test/api/demo-request', { method: 'POST', body: JSON.stringify(body) }))

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('validateDemoRequest', () => {
  it('accepts a complete request and normalises the phone number', () => {
    const { value, errors } = validateDemoRequest(valid)
    expect(errors).toEqual({})
    expect(value.phone).toBe('9876543210')
  })

  it('reports every missing required field', () => {
    const { errors } = validateDemoRequest({})
    expect(Object.keys(errors).sort()).toEqual(['business', 'city', 'name', 'outlets', 'phone'])
  })

  it('rejects numbers that are not Indian mobiles', () => {
    expect(validateDemoRequest({ ...valid, phone: '12345' }).errors.phone).toBeDefined()
  })

  it('rejects an outlet value outside the list', () => {
    expect(validateDemoRequest({ ...valid, outlets: '999' }).errors.outlets).toBeDefined()
  })
})

describe('POST /api/demo-request', () => {
  it('rejects invalid details without saving', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    expect((await send({ name: 'x' })).status).toBe(422)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('quietly drops bot submissions', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    expect((await send({ ...valid, website: 'spam.example' })).status).toBe(201)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('reports an error when storage is not configured', async () => {
    vi.stubEnv('SUPABASE_URL', '')
    expect((await send(valid)).status).toBe(503)
  })

  it('saves valid requests and never forwards the hidden field', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://db.test')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'server-only')
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 201 }))
    vi.stubGlobal('fetch', fetcher)
    expect((await send({ ...valid, website: '' })).status).toBe(201)
    const saved = JSON.parse(fetcher.mock.calls[0][1].body)
    expect(saved.phone).toBe('9876543210')
    expect(saved).not.toHaveProperty('website')
  })

  it('reports a failure when the database rejects the save', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://db.test')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'server-only')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 500 })))
    expect((await send(valid)).status).toBe(502)
  })
})
