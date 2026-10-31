import { useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { Loading, PageHeader, Segmented } from '../components/ui'
import { api } from '../lib/api'
import { dateTime } from '../lib/format'

const ACTIONS: Record<string, string> = {
  'order.discount_added': 'Added a discount', 'order.discount_removed': 'Removed a discount', 'order.cancelled': 'Cancelled an order',
  'order.confirmed': 'Confirmed an order', 'order.merged': 'Merged orders', 'order.sent_to_kitchen': 'Sent an order to the kitchen',
  'order.service_charge': 'Changed the service charge', 'order_item.quantity': 'Changed an item quantity', 'order_item.voided': 'Removed an item from an order',
  'invoice.issued': 'Issued a bill', 'credit_note.issued': 'Issued a credit note', 'payment.recorded': 'Recorded a payment',
  'payment_method.updated': 'Changed a payment method', 'refund.recorded': 'Recorded a refund', 'refund.confirmed': 'Confirmed a refund', 'refund.voided': 'Voided a refund',
  'cash.moved': 'Moved cash', 'cash_session.opened': 'Opened a cash session', 'cash_session.closed': 'Closed a cash session', 'cash_session.reviewed': 'Reviewed a cash session',
  'expense.created': 'Recorded an expense', 'expense.updated': 'Edited an expense', 'expense.voided': 'Voided an expense',
  'stock_item.created': 'Added an ingredient', 'stock_item.updated': 'Edited an ingredient', 'recipe.updated': 'Changed a recipe',
  'product.created': 'Added a menu item', 'product.updated': 'Edited a menu item', 'variant.created': 'Added a size', 'variant.updated': 'Changed a price or size',
  'variant.branch_override': 'Changed a branch price or sold-out status', 'addon.created': 'Added an add-on', 'addon.updated': 'Edited an add-on',
  'tax_rate.created': 'Added a tax rate', 'tax_rate.updated': 'Edited a tax rate', 'customer.updated': 'Edited a customer',
  'staff.created': 'Added a staff member', 'staff.updated': 'Edited a staff member', 'staff.unlocked': 'Unlocked a PIN', 'permissions.updated': 'Changed role permissions',
  'device.registered': 'Registered a device', 'device.revoked': 'Removed a device', 'branch.created': 'Added a branch', 'branch.updated': 'Edited a branch',
  'business.updated': 'Changed settings', 'table.created': 'Added a table', 'table.updated': 'Edited a table',
  'sample.added': 'Added sample data', 'sample.cleared': 'Cleared sample data', 'backup.downloaded': 'Downloaded a backup',
}

const GROUPS = [
  { value: 'all', label: 'Everything' },
  { value: 'discounts', label: 'Discounts' },
  { value: 'cancellations', label: 'Cancellations' },
  { value: 'stock', label: 'Stock' },
  { value: 'menu', label: 'Menu' },
  { value: 'staff', label: 'Staff' },
]

const detail = (data: any) => data?.reason ?? data?.name ?? data?.displayName ?? null

export function Activity() {
  const [group, setGroup] = useState('all')
  const query = useInfiniteQuery({
    queryKey: ['activity', group],
    queryFn: ({ pageParam }) => api(`/activity?group=${group}&offset=${pageParam}`),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextOffset,
  })
  const items = query.data?.pages.flatMap((page) => page.items) ?? []

  return (
    <>
      <PageHeader title="Activity" text="Who did what and when. Entries can’t be edited or removed." />
      <div className="mb-4"><Segmented label="Show" value={group} options={GROUPS} onChange={setGroup} /></div>
      <Loading ready={!query.isPending} error={query.error} empty={query.data && items.length === 0 ? 'Nothing here yet.' : undefined}>
        <ul className="card divide-y divide-line-soft overflow-hidden">
          {items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 p-3 text-sm">
              <span className="min-w-0">
                <span className="font-medium">{item.actor_name ?? 'System'}</span> {(ACTIONS[item.action] ?? item.action).toLowerCase()}
                {detail(item.after_data) && <span className="block text-ink-soft">{detail(item.after_data)}</span>}
              </span>
              <span className="tnum shrink-0 text-xs text-ink-soft">{dateTime(item.created_at)}</span>
            </li>
          ))}
        </ul>
        {query.hasNextPage && (
          <button className="btn btn-secondary mt-3" disabled={query.isFetchingNextPage} onClick={() => query.fetchNextPage()}>
            {query.isFetchingNextPage ? 'Loading…' : 'Show more'}
          </button>
        )}
      </Loading>
    </>
  )
}
