-- ---------------------------------------------------------------------------
-- Idempotency and audit
-- ---------------------------------------------------------------------------

create table app.idempotency_keys (
  tenant_id uuid not null references app.tenants on delete restrict,
  key text not null,
  request_hash text not null,
  response_status integer not null,
  response_body jsonb not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, key)
);

create table app.audit_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants on delete restrict,
  branch_id uuid,
  actor_membership_id uuid,
  device_id uuid,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  request_id text,
  created_at timestamptz not null default now()
);


-- ---------------------------------------------------------------------------
-- Indexes for everyday queries. tenant_id comes first, which also keeps RLS fast.
-- ---------------------------------------------------------------------------

create index on app.memberships (user_id);
create index on app.branches (tenant_id);
create index on app.products (tenant_id, category_id);
create index on app.product_variants (tenant_id, product_id);
create index on app.orders (tenant_id, branch_id, business_date desc);
create index on app.orders (tenant_id, branch_id) where status = 'open';
create index on app.order_items (tenant_id, order_id);
create index on app.order_item_addons (tenant_id, order_item_id);
create index on app.order_discounts (tenant_id, order_id);
create index on app.order_status_history (tenant_id, order_id);
create index on app.invoices (tenant_id, branch_id, business_date desc);
create index on app.invoices (tenant_id, order_id);
create index on app.invoices (tenant_id, customer_id) where customer_id is not null;
create index on app.invoice_lines (tenant_id, invoice_id);
create index on app.credit_notes (tenant_id, invoice_id);
create index on app.credit_note_lines (tenant_id, credit_note_id);
create index on app.payments (tenant_id, branch_id, business_date desc);
create index on app.payments (tenant_id, branch_id) where status in ('pending', 'recorded');
create index on app.payment_allocations (tenant_id, payment_id);
create index on app.payment_allocations (tenant_id, invoice_id);
create index on app.refunds (tenant_id, payment_id);
create index on app.refunds (tenant_id, invoice_id);
create index on app.cash_sessions (tenant_id, branch_id, business_date desc);
create index on app.cash_movements (tenant_id, cash_session_id);
create index on app.cash_movements (payment_id) where payment_id is not null;
create index on app.cash_movements (refund_id) where refund_id is not null;
create index on app.financial_status_history (tenant_id, entity_type, entity_id);
create index on app.audit_log (tenant_id, created_at desc);
create index on app.audit_log (tenant_id, entity_type, entity_id);
create index on app.idempotency_keys (created_at);

