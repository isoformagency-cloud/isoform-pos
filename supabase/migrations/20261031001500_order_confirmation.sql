-- Confirming an order locks what was ordered. After that, only a discount can change the bill.
alter table app.orders
  add column confirmed_at timestamptz,
  add column confirmed_by uuid,
  add foreign key (tenant_id, confirmed_by) references app.memberships (tenant_id, id);

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
          or new.service_charge_percent is distinct from old.service_charge_percent) then
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

create or replace function app.guard_order_items() returns trigger language plpgsql as $$
declare
  current_order record;
begin
  select status, confirmed_at into current_order from app.orders where id = new.order_id;
  if current_order.status <> 'open' then
    raise exception 'items on order % cannot change after it closes', new.order_id using errcode = 'P0001';
  end if;
  if current_order.confirmed_at is not null then
    raise exception 'items cannot change after the order is confirmed' using errcode = 'P0001';
  end if;
  return new;
end $$;

create or replace function app.guard_order_children() returns trigger language plpgsql as $$
declare
  row_data jsonb := to_jsonb(case when tg_op = 'DELETE' then old else new end);
  target uuid := coalesce(
    (row_data ->> 'order_id')::uuid,
    (select order_id from app.order_items where id = (row_data ->> 'order_item_id')::uuid));
  current_order record;
begin
  select status, confirmed_at into current_order from app.orders where id = target;
  if current_order.status <> 'open' then
    raise exception 'order % cannot change after it closes', target using errcode = 'P0001';
  end if;
  if tg_table_name = 'order_item_addons' and current_order.confirmed_at is not null then
    raise exception 'items cannot change after the order is confirmed' using errcode = 'P0001';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
