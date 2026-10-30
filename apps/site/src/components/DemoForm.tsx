import { useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router'
import { OUTLET_OPTIONS, validateDemoRequest, type DemoRequestErrors } from '../lib/demo-request'

type Status = 'idle' | 'sending' | 'sent' | 'failed'

function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string
  label: string
  error?: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && !error && <p className="text-sm text-ink-soft">{hint}</p>}
      {error && (
        <p id={`${id}-error`} className="field-error">
          {error}
        </p>
      )}
    </div>
  )
}

export function DemoForm() {
  const [status, setStatus] = useState<Status>('idle')
  const [errors, setErrors] = useState<DemoRequestErrors>({})

  const describe = (name: keyof DemoRequestErrors) => ({
    'aria-invalid': errors[name] ? true : undefined,
    'aria-describedby': errors[name] ? `${name}-error` : undefined,
  })

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const payload = Object.fromEntries(new FormData(form))
    const { errors: found } = validateDemoRequest(payload)
    setErrors(found)
    const first = Object.keys(found)[0]
    if (first) {
      form.querySelector<HTMLElement>(`#${first}`)?.focus()
      return
    }

    setStatus('sending')
    try {
      const response = await fetch('/api/demo-request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (response.ok) {
        setStatus('sent')
        return
      }
      if (response.status === 422) {
        const data = await response.json()
        setErrors(data.errors ?? {})
        setStatus('idle')
        return
      }
      setStatus('failed')
    } catch {
      setStatus('failed')
    }
  }

  if (status === 'sent') {
    return (
      <div role="status" className="rounded-xl bg-ok-tint p-6">
        <h2 className="title">Thanks, we have your request.</h2>
        <p className="mt-2">We’ll contact you on the number you gave us.</p>
      </div>
    )
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="name" label="Your name" error={errors.name}>
          <input id="name" name="name" autoComplete="name" required maxLength={100} {...describe('name')} />
        </Field>
        <Field id="business" label="Business name" error={errors.business}>
          <input id="business" name="business" autoComplete="organization" required maxLength={120} {...describe('business')} />
        </Field>
        <Field id="phone" label="Mobile number" error={errors.phone}>
          <input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" required {...describe('phone')} />
        </Field>
        <Field id="email" label="Email (optional)" error={errors.email}>
          <input id="email" name="email" type="email" autoComplete="email" {...describe('email')} />
        </Field>
        <Field id="city" label="City" error={errors.city}>
          <input id="city" name="city" autoComplete="address-level2" required maxLength={80} {...describe('city')} />
        </Field>
        <Field id="outlets" label="Number of outlets" error={errors.outlets}>
          <select id="outlets" name="outlets" required defaultValue="" {...describe('outlets')}>
            <option value="" disabled>
              Choose one
            </option>
            {OUTLET_OPTIONS.map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        </Field>
      </div>

      <Field id="message" label="What do you use for billing today? (optional)" error={errors.message}>
        <textarea id="message" name="message" rows={4} maxLength={1000} {...describe('message')} />
      </Field>

      {/* Hidden from people. Bots that fill every field reveal themselves here. */}
      <div aria-hidden="true" className="absolute -left-[9999px]">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" tabIndex={-1} autoComplete="off" />
      </div>

      {status === 'failed' && (
        <p role="alert" className="rounded-xl border border-bad/40 bg-paper-soft p-4 text-bad">
          We couldn’t send your request, and nothing was saved. Please try again in a little while.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <button type="submit" className="btn btn-primary" disabled={status === 'sending'}>
          {status === 'sending' ? 'Sending…' : 'Request a demo'}
        </button>
        <p className="text-sm text-ink-soft">
          We only use these details to reply. See our{' '}
          <Link to="/privacy" className="underline">
            privacy page
          </Link>
          .
        </p>
      </div>
    </form>
  )
}
