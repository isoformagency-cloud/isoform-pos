-- Holding orders, guest counts, delivery addresses, and the settings the POS and bills read.
alter table app.orders
  add column held_at timestamptz,
  add column guest_count integer check (guest_count between 1 and 200),
  add column delivery_address text check (char_length(delivery_address) <= 300);

alter table app.tenants
  add column upi_id text check (upi_id ~ '^[A-Za-z0-9._-]{2,64}@[A-Za-z0-9.-]{2,64}$'),
  add column fssai_number text check (fssai_number ~ '^[0-9]{14}$'),
  add column bill_footer text check (char_length(bill_footer) <= 200),
  add column bill_format text not null default 'thermal' check (bill_format in ('thermal', 'a4')),
  add column discount_presets integer[] not null default '{5,10,15}'
    check (cardinality(discount_presets) <= 6 and 0 < all (discount_presets) and 100 >= all (discount_presets)),
  add column cashier_discount_limit numeric(5,2) not null default 20 check (cashier_discount_limit between 0 and 100);

grant update (upi_id, fssai_number, bill_footer, bill_format, discount_presets, cashier_discount_limit)
  on app.tenants to app_user;

create index orders_open_branch_idx on app.orders (branch_id, created_at desc) where status = 'open';

-- Everything that changes the bill stays locked after confirming.
create or replace function app.guard_order() returns trigger language plpgsql as $$
begin
  if old.status <> 'open' then
    raise exception 'order % is % and can no longer change', old.id, old.status using errcode = 'P0001';
  end if;
  if new.status = 'cancelled' and exists (select 1 from app.invoices where order_id = old.id) then
    raise exception 'order % has an invoice, so it needs a credit note instead', old.id using errcode = 'P0001';
  end if;
  if old.confirmed_at is not null
     and (new.confirmed_at is distinct from old.confirmed_at
          or new.service_charge_percent is distinct from old.service_charge_percent
          or new.order_type is distinct from old.order_type) then
    raise exception 'a confirmed order can only take discounts' using errcode = 'P0001';
  end if;
  new.version := old.version + 1;
  new.updated_at := now();
  if new.status <> old.status then
    insert into app.order_status_history (tenant_id, branch_id, order_id, from_status, to_status, changed_by)
    values (old.tenant_id, old.branch_id, old.id, old.status, new.status, app.membership_id());
  end if;
  return new;
end $$;
