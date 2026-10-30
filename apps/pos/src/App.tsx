import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Session } from '@supabase/supabase-js'
import { Navigate, Route, Routes } from 'react-router'
import { Shell } from './components/Shell'
import { api, supabase } from './lib/api'
import { Branches } from './pages/Branches'
import { Devices } from './pages/Devices'
import { Home } from './pages/Home'
import { Login, SetPassword } from './pages/Login'
import { PinLogin } from './pages/PinLogin'
import { Settings } from './pages/Settings'
import { Staff } from './pages/Staff'

export interface Me {
  membershipId: string
  tenantId: string
  displayName: string
  role: string
  branchIds: string[]
  permissions: string[]
}

function Message({ text, action }: { text: string; action?: () => void }) {
  return (
    <main className="grid min-h-svh place-items-center p-5 text-center">
      <div>
        <p className="text-ink-soft">{text}</p>
        {action && <button className="btn btn-secondary mt-4" onClick={action}>Sign out</button>}
      </div>
    </main>
  )
}

export function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [recovering, setRecovering] = useState(false)
  const queryClient = useQueryClient()

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      if (event === 'PASSWORD_RECOVERY') setRecovering(true)
      setSession(next)
      if (event === 'SIGNED_OUT') queryClient.clear()
    })
    return () => data.subscription.unsubscribe()
  }, [queryClient])

  const me = useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/me'), enabled: Boolean(session) })

  if (session === undefined) return <Message text="Loading…" />
  if (recovering) return <SetPassword onDone={() => setRecovering(false)} />
  if (!session) {
    return (
      <Routes>
        <Route path="/pin" element={<PinLogin />} />
        <Route path="*" element={<Login />} />
      </Routes>
    )
  }
  if (me.isPending) return <Message text="Loading your business…" />
  if (me.isError) return <Message text={me.error.message} action={() => supabase.auth.signOut()} />

  return (
    <Routes>
      <Route element={<Shell me={me.data} />}>
        <Route index element={<Home me={me.data} />} />
        <Route path="branches" element={<Branches me={me.data} />} />
        <Route path="staff" element={<Staff me={me.data} />} />
        <Route path="devices" element={<Devices />} />
        <Route path="settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
