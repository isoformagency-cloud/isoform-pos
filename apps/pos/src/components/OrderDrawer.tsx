import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import type { Me } from '../App'
import { api } from '../lib/api'
import { dateTime, money } from '../lib/format'
import { typeName } from './order-look'
import { Badge, Modal, Notice, type Tone } from './ui'

export function paymentState(order: any): { label: string; tone: Tone } | null {
  if (order.status !== 'finalized' || order.outstanding === null) return null
  if (Number(order.outstanding) <= 0) return { label: 'Paid', tone: 'ok' }
  return Number(order.paid) > 0 ? { label: 'Part paid', tone: 'wait' } : { label: 'Unpaid', tone: 'wait' }
}

export function OrderDrawer({ id, me, onClose, onOpenInPos }: { id: string; me: Me; onClose: () => void; onOpenInPos: () => void }) {
  const order = useQuery({ queryKey: ['order', id], queryFn: () => api(`/orders/${id}`, { branch: true }) })
  const timeline = useQuery({ queryKey: ['timeline', id, order.data?.version], queryFn: () => api(`/orders/${id}/timeline`, { branch: true }) })
  const data = order.data
  const items = data?.items.filter((item: any) => item.status === 'active') ?? []
  const voided = data?.items.filter((item: any) => item.status === 'voided') ?? []

  return (
    <Modal
      side
      title={data ? `Order #${data.display_number}` : 'Order'}
      text={data ? `${typeName(data.order_type)}${data.aggregator ? ` · ${data.aggregator}` : ''} · ${data.business_date}` : undefined}
      onClose={onClose}
      footer={data?.status === 'open' && me.permissions.includes('orders.write') ? <button className="btn btn-primary" onClick={onOpenInPos}>Open in POS</button> : undefined}
    >
      {order.error && <Notice>{order.error.message}</Notice>}
      {order.isPending && <p className="text-sm text-ink-soft">Loading…</p>}
      {data && (
        <div className="grid gap-5">
          <div className="flex flex-wrap gap-1.5">
            {data.status === 'finalized' && <Badge tone="ok">Billed</Badge>}
            {data.status === 'cancelled' && <Badge tone="bad">Cancelled</Badge>}
            {data.status === 'open' && <Badge tone="sky">Open</Badge>}
            {data.confirmed_at && data.status === 'open' && <Badge tone="brand">Confirmed</Badge>}
            {data.held_at && <Badge tone="wait">On hold</Badge>}
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            {data.table_label && <div><dt className="text-xs text-ink-soft">Table</dt><dd>{data.table_label}</dd></div>}
            {data.guest_count && <div><dt className="text-xs text-ink-soft">Guests</dt><dd>{data.guest_count}</dd></div>}
            <div><dt className="text-xs text-ink-soft">Customer</dt><dd>{data.customer_name ?? 'Walk-in'}</dd></div>
            {data.customer_phone && <div><dt className="text-xs text-ink-soft">Phone</dt><dd className="tnum">{data.customer_phone}</dd></div>}
            {data.delivery_address && <div className="col-span-2"><dt className="text-xs text-ink-soft">Delivery address</dt><dd>{data.delivery_address}</dd></div>}
            {data.notes && <div className="col-span-2"><dt className="text-xs text-ink-soft">Order note</dt><dd>{data.notes}</dd></div>}
            {data.cancel_reason && <div className="col-span-2"><dt className="text-xs text-ink-soft">Cancelled because</dt><dd>{data.cancel_reason}</dd></div>}
          </dl>

          <section>
            <h3 className="mb-1 text-sm">Items</h3>
            <ul className="divide-y divide-line-soft text-sm">
              {items.map((item: any) => (
                <li key={item.id} className="py-2">
                  <div className="flex justify-between gap-3">
                    <span>{Number(item.quantity)} × {item.product_name}{item.variant_name !== 'Regular' ? ` · ${item.variant_name}` : ''}</span>
                    <span className="tnum">{money(item.line_total)}</span>
                  </div>
                  {item.addons.map((addon: any) => <p key={addon.id} className="text-xs text-ink-soft">+ {addon.name}</p>)}
                  {item.notes && <p className="text-xs text-wait">Note: {item.notes}</p>}
                </li>
              ))}
              {voided.map((item: any) => (
                <li key={item.id} className="flex justify-between gap-3 py-2 text-ink-faint line-through">
                  <span>{Number(item.quantity)} × {item.product_name}</span>
                  <span className="tnum">{money(item.line_total)}</span>
                </li>
              ))}
            </ul>
            <dl className="tnum mt-1 space-y-1 border-t border-line-soft pt-2 text-sm">
              <div className="flex justify-between text-ink-soft"><dt>Subtotal</dt><dd>{money(data.subtotal)}</dd></div>
              {Number(data.discount) > 0 && <div className="flex justify-between text-ok"><dt>Discount</dt><dd>−{money(data.discount)}</dd></div>}
              <div className="flex justify-between font-medium"><dt>Before tax</dt><dd>{money(data.after_discount)}</dd></div>
            </dl>
          </section>

          <section>
            <h3 className="mb-2 text-sm">Timeline</h3>
            {timeline.isPending && <p className="text-sm text-ink-soft">Loading…</p>}
            <ol className="grid gap-3">
              {timeline.data?.items.map((event: any, index: number) => (
                <li key={`${event.at}-${index}`} className="flex gap-3 text-sm">
                  <span className="mt-1.5 size-2 shrink-0 rounded-full bg-brand" />
                  <span className="min-w-0">
                    <span className="block">
                      {event.label.startsWith('Bill ') && data.status === 'finalized'
                        ? <BillLink label={event.label} orderId={id} />
                        : event.label}
                    </span>
                    <span className="text-xs text-ink-soft">{dateTime(event.at)}{event.by ? ` · ${event.by}` : ''}</span>
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </div>
      )}
    </Modal>
  )
}

function BillLink({ label, orderId }: { label: string; orderId: string }) {
  const number = label.split(' ')[1]
  const found = useQuery({
    queryKey: ['bill-by-number', orderId, number],
    queryFn: () => api(`/search?q=${encodeURIComponent(number)}`, { branch: true }),
  })
  const bill = found.data?.bills?.find((item: any) => item.number === number)
  return bill ? <Link to={`/invoices/${bill.id}`} className="underline">{label}</Link> : <>{label}</>
}
