-- ---------------------------------------------------------------------------
-- Row Level Security. Every table is forced, so even its owner is filtered.
-- ---------------------------------------------------------------------------

do $$
declare
  name text;
  tenant_tables text[] := array[
    'tax_registrations', 'branches', 'branch_memberships', 'device_pin_attempts', 'invitations',
    'customers', 'tax_rates', 'categories', 'products', 'product_variants', 'addons', 'product_addons',
    'payment_methods', 'idempotency_keys', 'audit_log'];
  branch_tables text[] := array[
    'devices', 'branch_variant_overrides', 'registers', 'invoice_series', 'cash_sessions', 'orders', 'order_items',
    'order_item_addons', 'order_discounts', 'order_status_history', 'invoices', 'invoice_lines',
    'credit_notes', 'credit_note_lines', 'payments', 'financial_status_history', 'payment_allocations',
    'refunds', 'cash_movements'];
begin
  foreach name in array tenant_tables loop
    execute format('alter table app.%I enable row level security', name);
    execute format('alter table app.%I force row level security', name);
    execute format($p$create policy tenant_isolation on app.%I
      using (tenant_id = (select app.tenant_id()))
      with check (tenant_id = (select app.tenant_id()))$p$, name);
  end loop;

  foreach name in array branch_tables loop
    execute format('alter table app.%I enable row level security', name);
    execute format('alter table app.%I force row level security', name);
    execute format($p$create policy branch_isolation on app.%I
      using (tenant_id = (select app.tenant_id()) and branch_id = any ((select app.branch_ids())::uuid[]))
      with check (tenant_id = (select app.tenant_id()) and branch_id = any ((select app.branch_ids())::uuid[]))$p$, name);
  end loop;
end $$;

alter table app.tenants enable row level security;
alter table app.tenants force row level security;
create policy tenant_self on app.tenants for select using (id = (select app.tenant_id()));
create policy tenant_settings on app.tenants for update
  using (id = (select app.tenant_id())) with check (id = (select app.tenant_id()));

-- A user must be able to find their own memberships before a tenant is chosen.
alter table app.memberships enable row level security;
alter table app.memberships force row level security;
create policy own_or_tenant_read on app.memberships for select
  using (tenant_id = (select app.tenant_id()) or user_id = (select app.user_id()));
create policy tenant_write on app.memberships for insert with check (tenant_id = (select app.tenant_id()));
create policy tenant_update on app.memberships for update
  using (tenant_id = (select app.tenant_id())) with check (tenant_id = (select app.tenant_id()));


-- ---------------------------------------------------------------------------
-- Privileges. Financial history has no UPDATE or DELETE for the API role.
-- Payments, refunds and sessions allow updates to their status columns only.
-- ---------------------------------------------------------------------------

grant usage on schema app to app_user;
grant select on all tables in schema app to app_user;
grant execute on all functions in schema app to app_user;

grant insert, update on
  app.tax_registrations, app.branches, app.memberships, app.devices, app.device_pin_attempts,
  app.invitations, app.customers, app.tax_rates, app.categories, app.products, app.product_variants,
  app.addons, app.branch_variant_overrides, app.registers, app.orders, app.payment_methods
  to app_user;

grant insert, delete on app.branch_memberships, app.product_addons, app.order_discounts, app.order_item_addons to app_user;
grant update (display_name, logo_path, rounding_rule, prices_include_tax, allow_self_verification)
  on app.tenants to app_user;
grant insert, update on app.order_items to app_user;

grant insert on
  app.order_status_history, app.invoice_series, app.invoices, app.invoice_lines, app.credit_notes,
  app.credit_note_lines, app.payments, app.financial_status_history, app.payment_allocations,
  app.refunds, app.cash_sessions, app.cash_movements, app.idempotency_keys, app.audit_log
  to app_user;

grant update (next_number) on app.invoice_series to app_user;
grant update (status, status_reason) on app.payments to app_user;
grant update (status, status_reason) on app.refunds to app_user;
grant update (status, counted_amount, review_note) on app.cash_sessions to app_user;
