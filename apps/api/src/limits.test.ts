// Request limits and headers against the real Supabase project.
import pg from 'pg'
import { afterAll, describe, expect, it } from 'vitest'
import { app } from './app.js'
import { closeDb } from './platform/db.js'

const post = (path: string, body: string, headers: Record<string, string> = {}) =>
  app.request(`/api/v1${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body })

afterAll(() => closeDb())

describe('request limits', () => {
  it('stops one visitor after the limit and leaves others alone', async () => {
    const visitor = { 'x-real-ip': `test-${crypto.randomUUID()}` }
    const body = JSON.stringify({ deviceCredential: 'not-a-real-device' })
    const statuses = []
    for (let i = 0; i < 32; i += 1) statuses.push((await post('/auth/device-staff', body, visitor)).status)
    expect(statuses.slice(0, 30).every((status) => status === 401)).toBe(true)
    expect(statuses.slice(30)).toEqual([429, 429])
    expect((await post('/auth/device-staff', body, { 'x-real-ip': `test-${crypto.randomUUID()}` })).status).toBe(401)
  })
  it('keeps no raw address', async () => {
    const db = new pg.Client({ connectionString: process.env.DATABASE_URL_DIRECT, ssl: { rejectUnauthorized: false } })
    await db.connect()
    const { rows } = await db.query(`select bucket from app.rate_limits`)
    expect(rows.every((row) => !row.bucket.includes('test-'))).toBe(true)
    await db.end()
  })
})

describe('request hardening', () => {
  it('refuses an oversized body', async () => {
    const response = await post('/auth/device-staff', JSON.stringify({ deviceCredential: 'x'.repeat(200000) }))
    expect(response.status).toBe(413)
  })
  it('sends security headers', async () => {
    const response = await app.request('/api/v1/health')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('x-frame-options')).toBeTruthy()
  })
  it('tells visitors without a session nothing about which routes exist', async () => {
    const known = await app.request('/api/v1/staff')
    const unknown = await app.request('/api/v1/nope')
    expect(known.status).toBe(401)
    expect(unknown.status).toBe(401)
    expect(await unknown.json()).toEqual(await known.json())
  })
})
