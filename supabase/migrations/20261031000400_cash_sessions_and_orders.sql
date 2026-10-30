-- ---------------------------------------------------------------------------
-- Registers and cash sessions
-- ---------------------------------------------------------------------------

create table app.registers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants on delete restrict,
  branch_id uuid not null,
  name text not null,
  is_active boolean not null default true,
  unique (tenant_id, id),
  unique (tenant_id, branch_id, id),
  unique (tenant_id, branch_id, name),
  foreign key (tenant_id, branch_id) references app.branches (tenant_id, id)
);

create table app.cash_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants on delete restrict,
  branch_id uuid not null,
  register_id uuid not null,
  status text not null default 'open' check (status in ('open', 'closed', 'reviewed')),
  business_date date not null,
  opening_amount app.money not null check (opening_amount >= 0),
  opened_by uuid not null,
  opened_at timestamptz not null default now(),
  expected_amount app.money,
  counted_amount app.money check (counted_amount >= 0),
  variance app.money generated always as (counted_amount - expected_amount) stored,
  closed_by uuid,
  closed_at timestamptz,
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_note text,
  unique (tenant_id, id),
  unique (tenant_id, branch_id, id),
  foreign key (tenant_id, branch_id, register_id) references app.registers (tenant_id, branch_id, id),
  foreign key (tenant_id, opened_by) references app.memberships (tenant_id, id),
  foreign key (tenant_id, closed_by) references app.memberships (tenant_id, id),
  foreign key (tenant_id, reviewed_by) references app.memberships (tenant_id, id)
);

create unique index one_open_session_per_register on app.cash_sessions (register_id) where status = 'open';


-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------

create table app.orders (
  id uuid primary key,
  tenant_id uuid not null references app.tenants on delete restrict,
  branch_id uuid not null,
  display_number integer not null check (display_number > 0),
  order_type text not null check (order_type in ('dine_in', 'takeaway', 'delivery', 'aggregator')),
  aggregator text,
  aggregator_reference text,
  table_label text,
  customer_id uuid,
  status text not null default 'open' check (status in ('open', 'finalized', 'cancelled')),
  service_charge_percent app.rate not null default 0,
  business_date date not null,
  notes text,
  version integer not null default 1,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancel_reason text,
  unique (tenant_id, id),
  unique (tenant_id, branch_id, id),
  unique (branch_id, business_date, display_number),
  check ((order_type = 'aggregator') = (aggregator is not null)),
  check (status <> 'cancelled' or cancel_reason is not null),
  foreign key (tenant_id, branch_id) references app.branches (tenant_id, id),
  foreign key (tenant_id, customer_id) references app.customers (tenant_id, id),
  foreign key (tenant_id, created_by) references app.memberships (tenant_id, id)
);

create table app.order_items (
  id uuid primary key,
  tenant_id uuid not null references app.tenants on delete restrict,
  branch_id uuid not null,
  order_id uuid not null,
  variant_id uuid not null,
  product_name text not null,
  variant_name text not null,
  unit_price app.money not null check (unit_price >= 0),
  quantity app.quantity not null,
  notes text,
  status text not null default 'active' check (status in ('active', 'voided')),
  void_reason text,
  voided_by uuid,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, branch_id, id),
  check (status <> 'voided' or (void_reason is not null and voided_by is not null)),
  foreign key (tenant_id, branch_id, order_id) references app.orders (tenant_id, branch_id, id),
  foreign key (tenant_id, variant_id) references app.product_variants (tenant_id, id),
  foreign key (tenant_id, created_by) references app.memberships (tenant_id, id),
  foreign key (tenant_id, voided_by) references app.memberships (tenant_id, id)
);

create table app.order_item_addons (
  id uuid primary key,
  tenant_id uuid not null references app.tenants on delete restrict,
  branch_id uuid not null,
  order_item_id uuid not null,
  addon_id uuid not null,
  addon_name text not null,
  unit_price app.money not null check (unit_price >= 0),
  quantity app.quantity not null default 1,
  foreign key (tenant_id, branch_id, order_item_id) references app.order_items (tenant_id, branch_id, id),
  foreign key (tenant_id, addon_id) references app.addons (tenant_id, id)
);

create table app.order_discounts (
  id uuid primary key,
  tenant_id uuid not null references app.tenants on delete restrict,
  branch_id uuid not null,
  order_id uuid not null,
  kind text not null check (kind in ('percent', 'amount')),
  value app.money not null check (value > 0),
  reason text not null,
  approved_by uuid not null,
  created_at timestamptz not null default now(),
  check (kind <> 'percent' or value <= 100),
  foreign key (tenant_id, branch_id, order_id) references app.orders (tenant_id, branch_id, id),
  foreign key (tenant_id, approved_by) references app.memberships (tenant_id, id)
);

create table app.order_status_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants on delete restrict,
  branch_id uuid not null,
  order_id uuid not null,
  from_status text,
  to_status text not null,
  changed_by uuid,
  changed_at timestamptz not null default now(),
  foreign key (tenant_id, branch_id, order_id) references app.orders (tenant_id, branch_id, id)
);

-- Bumps the version on every change, so a stale save can be detected,
-- and blocks moves out of a finished state.
create function app.guard_order() returns trigger language plpgsql as $$
begin
  if old.status <> 'open' then
    raise exception 'order % is % and can no longer change', old.id, old.status using errcode = 'P0001';
  end if;
  if new.status = 'cancelled' and exists (select 1 from app.invoices where order_id = old.id) then
    raise exception 'order % has an invoice, so it needs a credit note instead', old.id using errcode = 'P0001';
  end if;
  new.version := old.version + 1;
  new.updated_at := now();
  if new.status <> old.status then
    insert into app.order_status_history (tenant_id, branch_id, order_id, from_status, to_status, changed_by)
    values (old.tenant_id, old.branch_id, old.id, old.status, new.status, app.membership_id());
  end if;
  return new;
end $$;

create trigger guard_order before update on app.orders for each row execute function app.guard_order();

create function app.guard_order_items() returns trigger language plpgsql as $$
begin
  if (select status from app.orders where id = new.order_id) <> 'open' then
    raise exception 'items on order % cannot change after it closes', new.order_id using errcode = 'P0001';
  end if;
  return new;
end $$;

-- Discounts and add-ons are locked with the rest of the order.
create function app.guard_order_children() returns trigger language plpgsql as $$
declare
  row_data jsonb := to_jsonb(case when tg_op = 'DELETE' then old else new end);
  target uuid := coalesce(
    (row_data ->> 'order_id')::uuid,
    (select order_id from app.order_items where id = (row_data ->> 'order_item_id')::uuid));
begin
  if (select status from app.orders where id = target) <> 'open' then
    raise exception 'order % cannot change after it closes', target using errcode = 'P0001';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

create trigger guard_order_items before insert or update on app.order_items
  for each row execute function app.guard_order_items();

create trigger guard_order_discounts before insert or delete on app.order_discounts
  for each row execute function app.guard_order_children();

create trigger guard_order_item_addons before insert or delete on app.order_item_addons
  for each row execute function app.guard_order_children();

