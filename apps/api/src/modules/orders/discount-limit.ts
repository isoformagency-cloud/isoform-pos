import type { Db } from '../../platform/db.js'
import { AppError } from '../../platform/errors.js'

/**
 * Cashiers can discount up to the owner's limit. Only their own discounts count, so a
 * manager's approval is never undone, and billing checks again in case items were removed.
 */
export async function assertDiscountLimit(db: Db, tenantId: string, orderId: string) {
  const { rows: [row] } = await db.query(
    `with sub as (
       select coalesce(sum(round((i.unit_price + coalesce(a.extra, 0)) * i.quantity, 2)), 0) as subtotal
         from app.order_items i
         left join lateral (select sum(unit_price * quantity) extra from app.order_item_addons where order_item_id = i.id) a on true
        where i.order_id = $1 and i.status = 'active'
     )
     select t.cashier_discount_limit::text as limit,
            coalesce(sum(case when d.kind = 'amount' then d.value else round(s.subtotal * d.value / 100, 2) end), 0)
              > round(s.subtotal * t.cashier_discount_limit / 100, 2) as over
       from sub s
       join app.tenants t on t.id = $2
       left join (select o.* from app.order_discounts o join app.memberships m on m.id = o.approved_by
                   where o.order_id = $1 and m.role = 'cashier') d on true
      group by t.cashier_discount_limit, s.subtotal`,
    [orderId, tenantId],
  )
  if (row?.over) {
    throw new AppError(403, 'discount_limit', `Cashiers can give up to ${Number(row.limit)}% off. Ask a manager to add more.`)
  }
}
