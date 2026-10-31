-- Stages 10 and 11: menu details, an Admin role, editable permissions, choices in Settings and sample data.

alter table app.memberships drop constraint memberships_role_check;
alter table app.memberships add constraint memberships_role_check
  check (role in ('owner', 'admin', 'manager', 'cashier', 'waiter', 'kitchen', 'accountant'));
alter table app.invitations drop constraint invitations_role_check;
alter table app.invitations add constraint invitations_role_check
  check (role in ('owner', 'admin', 'manager', 'cashier', 'waiter', 'kitchen', 'accountant'));

alter table app.categories
  add column icon text not null default 'utensils'
    check (icon in ('utensils', 'coffee', 'cup', 'cake', 'croissant', 'pizza', 'salad', 'soup', 'ice_cream', 'beer')),
  add column is_sample boolean not null default false;
alter table app.products add column is_sample boolean not null default false;
alter table app.floor_areas add column is_sample boolean not null default false;
alter table app.dining_tables add column is_sample boolean not null default false;

alter table app.tenants
  add column order_types text[] not null default '{dine_in,takeaway,delivery,aggregator}'
    check (cardinality(order_types) > 0 and order_types <@ array['dine_in', 'takeaway', 'delivery', 'aggregator']),
  add column default_seats integer not null default 4 check (default_seats between 1 and 100),
  add column show_item_photos boolean not null default true,
  add column show_food_marks boolean not null default true,
  add column muted_alerts text[] not null default '{}',
  add column setup_dismissed boolean not null default false;

grant update (order_types, default_seats, show_item_photos, show_food_marks, muted_alerts, setup_dismissed)
  on app.tenants to app_user;

-- Only changes from a role's defaults are stored, so improving a default reaches every business.
create table app.role_permissions (
  tenant_id uuid not null references app.tenants on delete restrict,
  role text not null check (role in ('admin', 'manager', 'cashier', 'waiter', 'kitchen', 'accountant')),
  module text not null check (char_length(module) between 2 and 30),
  level text not null check (level in ('none', 'view', 'manage')),
  primary key (tenant_id, role, module)
);

alter table app.role_permissions enable row level security;
alter table app.role_permissions force row level security;
create policy tenant_isolation on app.role_permissions
  using (tenant_id = (select app.tenant_id()))
  with check (tenant_id = (select app.tenant_id()));
grant select, insert, update, delete on app.role_permissions to app_user;

create index on app.audit_log (tenant_id, actor_membership_id, created_at desc);
create index on app.orders (tenant_id, created_by, created_at desc);
