import { useEffect, useRef, useState, type FormEvent } from 'react'

export interface AskField {
  name: string
  label: string
  required?: boolean
  defaultValue?: string
  placeholder?: string
  inputMode?: 'decimal' | 'numeric' | 'text'
}

interface Request {
  title: string
  fields: AskField[]
  confirm: string
  resolve: (values: Record<string, string> | null) => void
}

/**
 * Asks a question in an in-app dialog and resolves with the answers, or null if cancelled.
 * Browser prompts are blocked in app windows and would not exist in the mobile app.
 */
export function useAsk() {
  const [request, setRequest] = useState<Request | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    if (request) dialog.current?.showModal()
  }, [request])

  const finish = (values: Record<string, string> | null) => {
    request?.resolve(values)
    setRequest(null)
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    finish(Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>)
  }

  const ask = (title: string, fields: AskField[] = [], confirm = 'OK') =>
    new Promise<Record<string, string> | null>((resolve) => setRequest({ title, fields, confirm, resolve }))

  const node = request && (
    <dialog ref={dialog} onCancel={() => finish(null)} className="sheet m-auto w-[min(24rem,calc(100vw-2rem))] rounded-2xl bg-white p-5 text-ink shadow-float">
      <form onSubmit={submit} className="grid gap-3">
        <h2 className="text-lg">{request.title}</h2>
        {request.fields.map((field, index) => (
          <label key={field.name} className="field">
            {field.label}
            <input
              name={field.name}
              required={field.required}
              defaultValue={field.defaultValue}
              placeholder={field.placeholder}
              inputMode={field.inputMode}
              autoFocus={index === 0}
              autoComplete="off"
            />
          </label>
        ))}
        <div className="mt-1 flex gap-2">
          <button className="btn btn-primary flex-1">{request.confirm}</button>
          <button type="button" className="btn btn-secondary" onClick={() => finish(null)}>Cancel</button>
        </div>
      </form>
    </dialog>
  )

  return { ask, node }
}
