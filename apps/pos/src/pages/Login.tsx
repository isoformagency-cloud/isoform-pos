import { useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router'
import { Notice } from '../components/ui'
import { deviceCredential, supabase } from '../lib/api'

function Frame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="grid min-h-svh place-items-center bg-paper-soft p-5">
      <div className="card w-full max-w-sm p-6">
        <p className="font-display font-semibold tracking-tight">ISOFORM POS</p>
        <h1 className="mt-4 text-2xl">{title}</h1>
        <div className="mt-5 grid gap-4">{children}</div>
      </div>
    </main>
  )
}

export function Login() {
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setBusy(true)
    setError('')
    const { error: failed } = await supabase.auth.signInWithPassword({
      email: String(form.get('email')),
      password: String(form.get('password')),
    })
    setBusy(false)
    if (failed) setError('That email or password was not accepted.')
  }

  async function forgot(event: FormEvent) {
    const email = String(new FormData((event.currentTarget as HTMLButtonElement).form!).get('email'))
    if (!email) return setError('Enter your email first.')
    await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin })
    setError('')
    setNotice('If that email has an account, a reset link is on its way.')
  }

  return (
    <Frame title="Sign in">
      <form onSubmit={submit} className="grid gap-4">
        <label className="field">
          Email
          <input name="email" type="email" autoComplete="email" required />
        </label>
        <label className="field">
          Password
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        {error && <Notice>{error}</Notice>}
        {notice && <Notice tone="ok">{notice}</Notice>}
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <button type="button" className="text-sm text-ink-soft underline" onClick={forgot}>Forgot password?</button>
      </form>
      {deviceCredential() && <Link to="/pin" className="btn btn-secondary">Staff PIN login</Link>}
    </Frame>
  )
}

export function SetPassword({ onDone }: { onDone: () => void }) {
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const password = String(new FormData(event.currentTarget).get('password'))
    if (password.length < 10) return setError('Use at least 10 characters.')
    const { error: failed } = await supabase.auth.updateUser({ password })
    if (failed) setError(failed.message)
    else onDone()
  }

  return (
    <Frame title="Choose a password">
      <form onSubmit={submit} className="grid gap-4">
        <label className="field">
          New password
          <input name="password" type="password" autoComplete="new-password" required />
        </label>
        {error && <Notice>{error}</Notice>}
        <button className="btn btn-primary">Save password</button>
      </form>
    </Frame>
  )
}
