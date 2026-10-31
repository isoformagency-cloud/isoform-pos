import { useMemo } from 'react'
import { encode } from 'uqr'

/** The customer pays the café directly from their own UPI app. Nothing passes through ISOFORM. */
export function UpiQr({ upiId, payee, amount, note }: { upiId: string; payee: string; amount: string; note: string }) {
  const link = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(payee)}&am=${encodeURIComponent(amount)}&cu=INR&tn=${encodeURIComponent(note)}`
  const { data, size } = useMemo(() => encode(link, { ecc: 'M', border: 2 }), [link])
  const cells = data.flatMap((row, y) => row.flatMap((dark, x) => (dark ? `M${x} ${y}h1v1h-1z` : [])))

  return (
    <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`UPI QR code for ${amount} rupees to ${upiId}`} className="size-40 rounded-lg bg-white" shapeRendering="crispEdges">
      <path d={cells.join('')} fill="#16161f" />
    </svg>
  )
}
