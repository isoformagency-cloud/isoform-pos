const url = process.env.SUPABASE_URL!
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!

/**
 * Tells other screens in a branch that something changed. The message carries no data:
 * each screen refetches through the API, so its permissions still apply. A missed signal
 * only delays an update until the next regular refresh, so failures are ignored.
 */
export async function signalBranches(branchIds: string[]) {
  if (process.env.VITEST || branchIds.length === 0) return
  try {
    await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        messages: branchIds.map((id) => ({ topic: `branch:${id}`, event: 'changed', payload: {}, private: true })),
      }),
      signal: AbortSignal.timeout(1500),
    })
  } catch {
    // The next regular refresh picks this up.
  }
}
