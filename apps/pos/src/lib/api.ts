import { createClient } from '@supabase/supabase-js'

declare const __SUPABASE_URL__: string
declare const __SUPABASE_ANON_KEY__: string

export const supabase = createClient(__SUPABASE_URL__, __SUPABASE_ANON_KEY__)

const DEVICE_KEY = 'isoform.device'
const BRANCH_KEY = 'isoform.branch'

function stored(key: string) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function store(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // Private windows can block storage. The app still works, it just won't remember.
  }
}

export const deviceCredential = () => stored(DEVICE_KEY)
export const saveDeviceCredential = (value: string | null) => store(DEVICE_KEY, value)
export const activeBranch = () => stored(BRANCH_KEY)
export const saveActiveBranch = (value: string | null) => store(BRANCH_KEY, value)

export class ApiError extends Error {
  status: number
  code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

export async function api<T = any>(path: string, options: { method?: string; body?: unknown; branch?: boolean } = {}): Promise<T> {
  const { method = 'GET', body, branch = false } = options
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  const branchId = branch ? activeBranch() : null
  // One key per action, reused on retries, so a retried save can never happen twice.
  const key = crypto.randomUUID()

  for (let attempt = 0; ; attempt += 1) {
    let response: Response | null = null
    try {
      response = await fetch(`/api/v1${path}`, {
        method,
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(branchId ? { 'x-branch-id': branchId } : {}),
          ...(method === 'GET' ? {} : { 'content-type': 'application/json', 'idempotency-key': key }),
        },
        body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
      })
    } catch {
      // Handled below with the other temporary failures.
    }
    if (response && response.status !== 503) {
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new ApiError(response.status, payload.code ?? 'error', payload.message ?? 'Something went wrong.')
      return payload as T
    }
    if (attempt === 2) throw new ApiError(response?.status ?? 0, 'offline', 'Could not reach ISOFORM. Check your connection and try again.')
    await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)))
  }
}
