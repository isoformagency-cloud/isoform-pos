-- Customer profiles, expenses, and stock with recipes.
alter table app.customers
  add column email text check (char_length(email) <= 120),
  add column address text check (char_length(address) <= 300);

create table app.expenses (
  id uuid primary key,
  tenant_id uuid not null references app.tenants on delete restrict,
  branch_id uuid not null,
  name text not null check (char_length(name) between 2 and 120),
  category text not null check (category in ('ingredients', 'rent', 'electricity', 'salaries', 'maintenance', 'packaging', 'marketing', 'other')),
  amount app.money not null check (amount > 0),
  expense_date date not null,
  method text not null check (method in ('cash', 'upi', 'card', 'bank_transfer', 'cheque', 'other')),
  reference text check (char_length(reference) <= 80),
  notes text check (char_length(notes) <= 300),
  receipt_path text,
  cash_movement_id uuid,
  status text not null default 'active' check (status in ('active', 'voided')),
  void_reason text,
  voided_by uuid,
  voided_at timestamptz,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  check (status <> 'voided' or (void_reason is not null and voided_by is not null)),
  foreign key (tenant_id, branch_id) references app.branches (tenant_id, id),
  foreign key (tenant_id, created_by) references app.memberships (tenant_id, id),
  foreign key (tenant_id, voided_by) references app.memberships (tenant_id, id),
  foreign key (tenant_id, cash_movement_id) references app.cash_movements (tenant_id, id)
);
create index expenses_branch_date_idx on app.expenses (branch_id, expense_date desc);

create table app.suppliers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants on delete restrict,
  name text not null check (char_length(name) between 2 and 120),
  phone text check (phone ~ '^[0-9]{10}$'),
  notes text check (char_length(notes) <= 300),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, id)
);
create unique index suppliers_name_idx on app.suppliers (tenant_id, lower(name)) where is_active;

create table app.stock_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants on delete restrict,
  name text not null check (char_length(name) between 2 and 120),
  category text not null default 'General' check (char_length(category) between 2 and 40),
  unit text not null check (unit in ('kg', 'g', 'L', 'ml', 'pcs', 'pack', 'box', 'dozen')),
  cost app.money not null default 0 check (cost >= 0),
  min_stock numeric(12, 3) not null default 0 check (min_stock >= 0),
  supplier_id uuid,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, supplier_id) references app.suppliers (tenant_id, id)
);
create unique index stock_items_name_idx on app.stock_items (tenant_id, lower(name)) where is_active;

-- The current figure for each branch, kept in step with the ledger below by a trigger.
create table app.stock_levels (
  tenant_id uuid not null references app.tenants on delete restrict,
  branch_id uuid not null,
  stock_item_id uuid not null,
  quantity numeric(14, 3) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (branch_id, stock_item_id),
  foreign key (tenant_id, branch_id) references app.branches (tenant_id, id),
  foreign key (tenant_id, stock_item_id) references app.stock_items (tenant_id, id)
);

-- Every change is a new row and rows are never edited, so stock can always be traced.
create table app.stock_moves (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants on delete restrict,
  branch_id uuid not null,
  stock_item_id uuid not null,
  kind text not null check (kind in ('in', 'out', 'count', 'sale')),
  quantity numeric(14, 3) not null check (quantity <> 0),
  unit_cost app.money,
  reason text check (char_length(reason) <= 200),
  supplier_id uuid,
  order_id uuid,
  expense_id uuid references app.expenses,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, branch_id) references app.branches (tenant_id, id),
  foreign key (tenant_id, stock_item_id) references app.stock_items (tenant_id, id),
  foreign key (tenant_id, supplier_id) references app.suppliers (tenant_id, id),
  foreign key (tenant_id, branch_id, order_id) references app.orders (tenant_id, branch_id, id),
  foreign key (tenant_id, created_by) references app.memberships (tenant_id, id)
);
create index stock_moves_item_idx on app.stock_moves (branch_id, stock_item_id, created_at desc);
create index stock_moves_branch_idx on app.stock_moves (branch_id, created_at desc);

create table app.recipe_lines (
  tenant_id uuid not null references app.tenants on delete restrict,
  product_id uuid not null,
  stock_item_id uuid not null,
  quantity numeric(12, 3) not null check (quantity > 0),
  primary key (product_id, stock_item_id),
  foreign key (tenant_id, product_id) references app.products (tenant_id, id),
  foreign key (tenant_id, stock_item_id) references app.stock_items (tenant_id, id)
);

create function app.apply_stock_move() returns trigger language plpgsql as $$
begin
  insert into app.stock_levels (tenant_id, branch_id, stock_item_id, quantity)
  values (new.tenant_id, new.branch_id, new.stock_item_id, new.quantity)
  on conflict (branch_id, stock_item_id)
  do update set quantity = app.stock_levels.quantity + excluded.quantity, updated_at = now();
  return new;
end $$;

create trigger apply_stock_move after insert on app.stock_moves
  for each row execute function app.apply_stock_move();

do $$
declare
  name text;
begin
  foreach name in array array['suppliers', 'stock_items', 'recipe_lines'] loop
    execute format('alter table app.%I enable row level security', name);
    execute format('alter table app.%I force row level security', name);
    execute format($p$create policy tenant_isolation on app.%I
      using (tenant_id = (select app.tenant_id()))
      with check (tenant_id = (select app.tenant_id()))$p$, name);
  end loop;
  foreach name in array array['expenses', 'stock_levels', 'stock_moves'] loop
    execute format('alter table app.%I enable row level security', name);
    execute format('alter table app.%I force row level security', name);
    execute format($p$create policy branch_isolation on app.%I
      using (tenant_id = (select app.tenant_id()) and branch_id = any ((select app.branch_ids())::uuid[]))
      with check (tenant_id = (select app.tenant_id()) and branch_id = any ((select app.branch_ids())::uuid[]))$p$, name);
  end loop;
end $$;

grant select, insert, update on app.expenses, app.suppliers, app.stock_items, app.stock_levels to app_user;
grant select, insert on app.stock_moves to app_user;
grant select, insert, delete on app.recipe_lines to app_user;
