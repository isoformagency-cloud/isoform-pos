import { useState } from 'react'
import { Modal, Segmented } from './ui'

export function DiscountDialog({ presets, limit, onApply, onClose }: {
  presets: number[]
  limit: number | null
  onApply: (body: { kind: 'percent' | 'amount'; value: string; reason?: string }) => void
  onClose: () => void
}) {
  const [kind, setKind] = useState<'percent' | 'amount'>('percent')
  const [value, setValue] = useState('')
  const [reason, setReason] = useState('')
  const quick = limit === null ? presets : presets.filter((preset) => preset <= limit)
  const valid = Number(value) > 0 && (kind === 'amount' || Number(value) <= 100)

  return (
    <Modal
      title="Add a discount"
      text={limit === null ? undefined : `Cashiers can give up to ${limit}% off an order.`}
      onClose={onClose}
      footer={<button className="btn btn-primary" disabled={!valid} onClick={() => onApply({ kind, value, reason: reason.trim() || undefined })}>Apply discount</button>}
    >
      <div className="grid gap-3">
        <Segmented
          label="Discount type"
          value={kind}
          options={[{ value: 'percent', label: 'Percent %' }, { value: 'amount', label: 'Amount ₹' }]}
          onChange={(next) => { setKind(next); setValue('') }}
        />
        {kind === 'percent' && quick.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {quick.map((preset) => (
              <button key={preset} className={`btn btn-sm ${value === String(preset) ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setValue(String(preset))}>{preset}%</button>
            ))}
          </div>
        )}
        <label className="field">
          {kind === 'percent' ? 'Percent' : 'Amount'}
          <input autoFocus value={value} inputMode="decimal" onChange={(event) => setValue(event.target.value.replace(/[^\d.]/g, ''))} />
        </label>
        <label className="field">
          Reason (optional)
          <input value={reason} maxLength={300} onChange={(event) => setReason(event.target.value)} placeholder="Regular customer" />
        </label>
      </div>
    </Modal>
  )
}
