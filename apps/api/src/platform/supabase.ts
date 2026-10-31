import { createClient } from '@supabase/supabase-js'
import { createRemoteJWKSet, errors, jwtVerify } from 'jose'
import { AppError } from './errors.js'

const url = process.env.SUPABASE_URL!
const options = { auth: { persistSession: false, autoRefreshToken: false } }

export const supabaseAdmin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, options)

const keys = createRemoteJWKSet(new URL(`${url}/auth/v1/.well-known/jwks.json`))

export async function verifyToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, keys, { audience: 'authenticated', issuer: `${url}/auth/v1` })
    return payload.sub!
  } catch (error) {
    // Failing to fetch the signing keys says nothing about the token, so it's retried, not refused.
    if (error instanceof errors.JWKSTimeout || !(error instanceof errors.JOSEError)) {
      throw new AppError(503, 'auth_unavailable', 'Could not check your sign-in. Please try again.')
    }
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
