-- Floor plans, reservations and the kitchen display.
create table app.floor_areas (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants on delete restrict,
  branch_id uuid not null,
  name text not null check (char_length(name) between 1 and 40),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, branch_id, id),
  foreign key (tenant_id, branch_id) references app.branches (tenant_id, id)
);
create unique index floor_areas_name_idx on app.floor_areas (branch_id, lower(name)) where is_active;

create table app.dining_tables (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants on delete restrict,
  branch_id uuid not null,
  area_id uuid not null,
  name text not null check (char_length(name) between 1 and 30),
  seats integer not null default 4 check (seats between 1 and 100),
  shape text not null default 'square' check (shape in ('square', 'round', 'long')),
  pos_x integer not null default 40 check (pos_x between 0 and 1000),
  pos_y integer not null default 40 check (pos_y between 0 and 1000),
  is_active boolean not null default true,
  seated_at timestamptz,
  seated_guests integer check (seated_guests between 1 and 200),
  created_at timestamptz not null default now(),
  unique (tenant_id, branch_id, id),
  foreign key (tenant_id, branch_id, area_id) references app.floor_areas (tenant_id, branch_id, id)
);
create unique index dining_tables_name_idx on app.dining_tables (branch_id, lower(name)) where is_active;

alter table app.orders
  add column table_id uuid,
  add foreign key (tenant_id, branch_id, table_id) references app.dining_tables (tenant_id, branch_id, id);

-- A table holds one open order. Two tills can't seat the same table.
create unique index orders_one_open_per_table on app.orders (table_id) where status = 'open' and table_id is not null;

create table app.table_reservations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants on delete restrict,
  branch_id uuid not null,
  table_id uuid not null,
  guest_name text not null check (char_length(guest_name) between 1 and 80),
  phone text check (phone ~ '^[0-9]{10}$'),
  guests integer not null default 2 check (guests between 1 and 200),
  reserved_at timestamptz not null,
  notes text check (char_length(notes) <= 300),
  status text not null default 'booked' check (status in ('booked', 'seated', 'cancelled')),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, branch_id, table_id) references app.dining_tables (tenant_id, branch_id, id),
  foreign key (tenant_id, created_by) references app.memberships (tenant_id, id)
);
create index table_reservations_due_idx on app.table_reservations (branch_id, reserved_at) where status = 'booked';

-- A ticket is one round sent to the kitchen, so a table can order more later.
create table app.kitchen_tickets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants on delete restrict,
  branch_id uuid not null,
  order_id uuid not null,
  round integer not null default 1 check (round > 0),
  status text not null default 'new' check (status in ('new', 'preparing', 'ready', 'completed', 'cancelled')),
  sent_by uuid not null,
  sent_at timestamptz not null default now(),
  started_at timestamptz,
  ready_at timestamptz,
  completed_at timestamptz,
  unique (tenant_id, branch_id, id),
  foreign key (tenant_id, branch_id, order_id) references app.orders (tenant_id, branch_id, id),
  foreign key (tenant_id, sent_by) references app.memberships (tenant_id, id)
);
create index kitchen_tickets_board_idx on app.kitchen_tickets (branch_id, status, sent_at);
create index kitchen_tickets_order_idx on app.kitchen_tickets (order_id);

-- Ticks live here, not on the order item, because a confirmed order's items can't change.
create table app.kitchen_ticket_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants on delete restrict,
  branch_id uuid not null,
  ticket_id uuid not null,
  order_item_id uuid not null unique,
  prepared_at timestamptz,
  foreign key (tenant_id, branch_id, ticket_id) references app.kitchen_tickets (tenant_id, branch_id, id),
  foreign key (tenant_id, branch_id, order_item_id) references app.order_items (tenant_id, branch_id, id)
);
create index kitchen_ticket_items_ticket_idx on app.kitchen_ticket_items (ticket_id);

alter table app.tenants
  add column uses_kitchen boolean not null default true,
  add column kitchen_delay_minutes integer not null default 15 check (kitchen_delay_minutes between 1 and 240);

do $$
declare
  name text;
begin
  foreach name in array array['floor_areas', 'dining_tables', 'table_reservations', 'kitchen_tickets', 'kitchen_ticket_items'] loop
    execute format('alter table app.%I enable row level security', name);
    execute format('alter table app.%I force row level security', name);
    execute format($p$create policy branch_isolation on app.%I
      using (tenant_id = (select app.tenant_id()) and branch_id = any ((select app.branch_ids())::uuid[]))
      with check (tenant_id = (select app.tenant_id()) and branch_id = any ((select app.branch_ids())::uuid[]))$p$, name);
  end loop;
end $$;

grant select, insert, update on app.floor_areas, app.dining_tables, app.table_reservations to app_user;
grant select, insert on app.kitchen_tickets, app.kitchen_ticket_items to app_user;
grant update (order_id, status, started_at, ready_at, completed_at) on app.kitchen_tickets to app_user;
grant update (prepared_at) on app.kitchen_ticket_items to app_user;
grant update (uses_kitchen, kitchen_delay_minutes) on app.tenants to app_user;

-- What the kitchen already has can't quietly change underneath it.
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
  if tg_op = 'UPDATE' and new.quantity is distinct from old.quantity
     and exists (select 1 from app.kitchen_ticket_items where order_item_id = old.id) then
    raise exception 'this item has gone to the kitchen, so its quantity cannot change' using errcode = 'P0001';
  end if;
  return new;
end $$;
