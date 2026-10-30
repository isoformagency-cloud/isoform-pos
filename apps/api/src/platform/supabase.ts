import { createClient } from '@supabase/supabase-js'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { AppError } from './errors'

const url = process.env.SUPABASE_URL!
const options = { auth: { persistSession: false, autoRefreshToken: false } }

export const supabaseAdmin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, options)

const keys = createRemoteJWKSet(new URL(`${url}/auth/v1/.well-known/jwks.json`))

export async function verifyToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, keys, { audience: 'authenticated', issuer: `${url}/auth/v1` })
    return payload.sub!
  } catch {
    throw new AppError(401, 'invalid_session', 'Please sign in again.')
  }
}

/** Creates a real session for a user without sending any email. */
export async function createSession(email: string) {
  const link = await supabaseAdmin.auth.admin.generateLink({ type: 'magiclink', email })
  if (link.error) throw new AppError(502, 'session_failed', 'Could not start a session.')
  const client = createClient(url, process.env.SUPABASE_ANON_KEY!, options)
  const { data, error } = await client.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: 'magiclink' })
  if (error || !data.session) throw new AppError(502, 'session_failed', 'Could not start a session.')
  return data.session
}
