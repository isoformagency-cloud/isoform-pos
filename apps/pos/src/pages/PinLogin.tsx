import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router'
import { Notice } from '../components/ui'
import { api, deviceCredential, supabase } from '../lib/api'

export function PinLogin() {
  const credential = deviceCredential()
  const navigate = useNavigate()
  const [staff, setStaff] = useState<{ id: string; display_name: string }[] | null>(null)
  const [person, setPerson] = useState<{ id: string; display_name: string } | null>(null)
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!credential) return
    api('/auth/device-staff', { method: 'POST', body: { deviceCredential: credential } })
      .then((data) => setStaff(data.items))
      .catch((failure) => setError(failure.message))
  }, [credential])

  if (!credential) return <Navigate to="/" replace />

  async function submit() {
    setError('')
    try {
      const data = await api('/auth/pin-login', {
        method: 'POST',
        body: { deviceCredential: credential, membershipId: person!.id, pin },
      })
      await supabase.auth.setSession({ access_token: data.accessToken, refresh_token: data.refreshToken })
      navigate('/', { replace: true })
    } catch (failure) {
      setPin('')
      setError((failure as Error).message)
    }
  }

  return (
    <main className="grid min-h-svh place-items-center bg-paper-soft p-5">
      <div className="card w-full max-w-sm p-6">
        <h1 className="text-2xl">{person ? person.display_name : 'Who’s working?'}</h1>
        {error && <div className="mt-3"><Notice>{error}</Notice></div>}
        {!person ? (
          <ul className="mt-4 grid gap-2">
            {staff?.map((member) => (
              <li key={member.id}>
                <button className="btn btn-secondary w-full" onClick={() => setPerson(member)}>{member.display_name}</button>
              </li>
            ))}
            {staff?.length === 0 && <li className="text-ink-soft">No staff with a PIN work at this branch yet.</li>}
          </ul>
        ) : (
          <>
            <p aria-live="polite" className="mt-4 h-8 text-center font-mono text-2xl tracking-[0.4em]">{'•'.repeat(pin.length)}</p>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
                <button key={digit} className="btn btn-secondary !min-h-14 text-lg" onClick={() => setPin((pin + digit).slice(0, 6))}>{digit}</button>
              ))}
              <button className="btn" aria-label="Delete last digit" onClick={() => setPin(pin.slice(0, -1))}>⌫</button>
              <button className="btn btn-secondary !min-h-14 text-lg" onClick={() => setPin((pin + '0').slice(0, 6))}>0</button>
              <button className="btn btn-primary" disabled={pin.length < 4} onClick={submit}>Go</button>
            </div>
            <button className="mt-3 text-sm text-ink-soft underline" onClick={() => { setPerson(null); setPin('') }}>Not you?</button>
          </>
        )}
        <Link to="/" className="mt-5 block text-center text-sm text-ink-soft underline">Manager sign in</Link>
      </div>
    </main>
  )
}
