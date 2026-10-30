-- ---------------------------------------------------------------------------
-- Payments, allocations and refunds
-- ---------------------------------------------------------------------------

create table app.payment_methods (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants on delete restrict,
  name text not null,
  kind text not null check (kind in ('cash', 'upi', 'card', 'bank_transfer', 'other')),
  requires_reference boolean not null default false,
  is_active boolean not null default true,
  unique (tenant_id, id),
  unique (tenant_id, id, kind),
  unique (tenant_id, name)
);

create table app.payments (
  id uuid primary key,
  tenant_id uuid not null references app.tenants on delete restrict,
  branch_id uuid not null,
  method_id uuid not null,
  method_kind text not null,
  amount app.money not null check (amount > 0),
  tip_amount app.money not null default 0 check (tip_amount >= 0),
  reference text,
  received_at timestamptz not null,
  business_date date not null,
  cash_session_id uuid,
  customer_id uuid,
  notes text,
  status text not null default 'recorded' check (status in ('pending', 'recorded', 'confirmed', 'failed', 'voided')),
  status_reason text,
  status_changed_by uuid,
  status_changed_at timestamptz,
  recorded_by uuid not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, branch_id, id),
  check ((method_kind = 'cash') = (cash_session_id is not null)),
  check (status not in ('failed', 'voided') or status_reason is not null),
  foreign key (tenant_id, method_id, method_kind) references app.payment_methods (tenant_id, id, kind),
  foreign key (tenant_id, branch_id, cash_session_id) references app.cash_sessions (tenant_id, branch_id, id),
  foreign key (tenant_id, customer_id) references app.customers (tenant_id, id),
  foreign key (tenant_id, recorded_by) references app.memberships (tenant_id, id),
  foreign key (tenant_id, status_changed_by) references app.memberships (tenant_id, id)
);

-- A reference can be reused only after the first attempt failed or was voided.
create unique index one_active_payment_per_reference on app.payments (tenant_id, method_id, reference)
  where reference is not null and status not in ('failed', 'voided');

create table app.financial_status_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants on delete restrict,
  branch_id uuid not null,
  entity_type text not null check (entity_type in ('payment', 'refund')),
  entity_id uuid not null,
  from_status text not null,
  to_status text not null,
  reason text,
  changed_by uuid not null,
  changed_at timestamptz not null default now(),
  foreign key (tenant_id, branch_id) references app.branches (tenant_id, id),
  foreign key (tenant_id, changed_by) references app.memberships (tenant_id, id)
);

create function app.guard_financial_status() returns trigger language plpgsql as $$
declare
  allowed boolean;
begin
  if new.status = old.status then
    return new;
  end if;
  allowed := (old.status, new.status) in (
    ('pending', 'recorded'), ('pending', 'failed'), ('pending', 'voided'),
    ('recorded', 'confirmed'), ('recorded', 'failed'), ('recorded', 'voided'),
    ('confirmed', 'voided'));
  if not allowed then
    raise exception 'status cannot change from % to %', old.status, new.status using errcode = 'P0001';
  end if;
  if new.status = 'confirmed' and old.recorded_by = app.membership_id()
     and not (select allow_self_verification from app.tenants where id = old.tenant_id) then
    raise exception 'the person who recorded this cannot confirm it' using errcode = 'P0001';
  end if;
  new.status_changed_by := app.membership_id();
  new.status_changed_at := now();
  insert into app.financial_status_history
    (tenant_id, branch_id, entity_type, entity_id, from_status, to_status, reason, changed_by)
  values (old.tenant_id, old.branch_id, tg_argv[0], old.id, old.status, new.status, new.status_reason,
          app.membership_id());
  return new;
end $$;

create trigger guard_payment_status before update on app.payments
  for each row execute function app.guard_financial_status('payment');

create table app.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants on delete restrict,
  branch_id uuid not null,
  payment_id uuid not null,
  invoice_id uuid not null,
  amount app.money not null check (amount <> 0),
  reverses_allocation_id uuid unique,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  check ((amount < 0) = (reverses_allocation_id is not null)),
  foreign key (tenant_id, reverses_allocation_id) references app.payment_allocations (tenant_id, id),
  foreign key (tenant_id, branch_id, payment_id) references app.payments (tenant_id, branch_id, id),
  foreign key (tenant_id, branch_id, invoice_id) references app.invoices (tenant_id, branch_id, id),
  foreign key (tenant_id, created_by) references app.memberships (tenant_id, id)
);

create table app.refunds (
  id uuid primary key,
  tenant_id uuid not null references app.tenants on delete restrict,
  branch_id uuid not null,
  payment_id uuid not null,
  invoice_id uuid not null,
  credit_note_id uuid,
  method_id uuid not null,
  method_kind text not null,
  amount app.money not null check (amount > 0),
  reference text,
  reason text not null,
  refunded_at timestamptz not null,
  business_date date not null,
  cash_session_id uuid,
  status text not null default 'recorded' check (status in ('recorded', 'confirmed', 'failed', 'voided')),
  status_reason text,
  status_changed_by uuid,
  status_changed_at timestamptz,
  recorded_by uuid not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, branch_id, id),
  check ((method_kind = 'cash') = (cash_session_id is not null)),
  check (status not in ('failed', 'voided') or status_reason is not null),
  foreign key (tenant_id, branch_id, payment_id) references app.payments (tenant_id, branch_id, id),
  foreign key (tenant_id, branch_id, invoice_id) references app.invoices (tenant_id, branch_id, id),
  foreign key (tenant_id, branch_id, credit_note_id) references app.credit_notes (tenant_id, branch_id, id),
  foreign key (tenant_id, method_id, method_kind) references app.payment_methods (tenant_id, id, kind),
  foreign key (tenant_id, branch_id, cash_session_id) references app.cash_sessions (tenant_id, branch_id, id),
  foreign key (tenant_id, recorded_by) references app.memberships (tenant_id, id),
  foreign key (tenant_id, status_changed_by) references app.memberships (tenant_id, id)
);

create trigger guard_refund_status before update on app.refunds
  for each row execute function app.guard_financial_status('refund');

-- What the customer still owes. Negative means money is due back to them.
create view app.invoice_balances with (security_invoker = true) as
select i.id as invoice_id,
       i.tenant_id,
       i.branch_id,
       i.grand_total,
       coalesce(c.total, 0) as credited,
       coalesce(a.total, 0) as allocated,
       coalesce(r.total, 0) as refunded,
       i.grand_total - coalesce(c.total, 0) - coalesce(a.total, 0) + coalesce(r.total, 0) as outstanding
  from app.invoices i
  left join lateral (select sum(grand_total) total from app.credit_notes where invoice_id = i.id) c on true
  left join lateral (select sum(amount) total from app.payment_allocations where invoice_id = i.id) a on true
  left join lateral (
    select sum(amount) total from app.refunds where invoice_id = i.id and status not in ('failed', 'voided')
  ) r on true;

-- Refund state is calculated, so it can never disagree with the refund records.
create view app.payment_refund_state with (security_invoker = true) as
select p.id as payment_id,
       p.tenant_id,
       p.branch_id,
       coalesce(r.total, 0) as refunded,
       case when coalesce(r.total, 0) = 0 then 'none'
            when r.total < p.amount then 'partially_refunded'
            else 'refunded' end as refund_state
  from app.payments p
  left join lateral (
    select sum(amount) total from app.refunds where payment_id = p.id and status not in ('failed', 'voided')
  ) r on true;

create function app.guard_allocation() returns trigger language plpgsql as $$
declare
  payment record;
  allocated numeric;
  outstanding_now numeric;
  original record;
begin
  perform app.lock_record('invoice', new.invoice_id);
  perform app.lock_record('payment', new.payment_id);

  if new.amount < 0 then
    select * into original from app.payment_allocations where id = new.reverses_allocation_id;
    if not found or original.payment_id <> new.payment_id or original.invoice_id <> new.invoice_id
       or original.amount <> -new.amount then
      raise exception 'a reversal must exactly mirror the original allocation' using errcode = 'P0001';
    end if;
    return new;
  end if;

  select amount, status into payment from app.payments where id = new.payment_id;
  if payment.status not in ('recorded', 'confirmed') then
    raise exception 'a % payment cannot be allocated', payment.status using errcode = 'P0001';
  end if;

  select coalesce(sum(amount), 0) into allocated from app.payment_allocations where payment_id = new.payment_id;
  if allocated + new.amount > payment.amount then
    raise exception 'allocation exceeds the payment amount' using errcode = 'P0001';
  end if;

  select outstanding into outstanding_now from app.invoice_balances where invoice_id = new.invoice_id;
  if new.amount > outstanding_now then
    raise exception 'allocation exceeds the invoice balance' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger guard_allocation before insert on app.payment_allocations
  for each row execute function app.guard_allocation();

create function app.guard_refund() returns trigger language plpgsql as $$
declare
  from_payment numeric;
  refunded numeric;
begin
  perform app.lock_record('invoice', new.invoice_id);
  perform app.lock_record('payment', new.payment_id);
  select coalesce(sum(amount), 0) into from_payment from app.payment_allocations
   where payment_id = new.payment_id and invoice_id = new.invoice_id;
  select coalesce(sum(amount), 0) into refunded from app.refunds
   where payment_id = new.payment_id and invoice_id = new.invoice_id and status not in ('failed', 'voided');
  if refunded + new.amount > from_payment then
    raise exception 'refund exceeds what this payment contributed to the invoice' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger guard_refund before insert on app.refunds
  for each row execute function app.guard_refund();


-- ---------------------------------------------------------------------------
-- Cash movements
-- ---------------------------------------------------------------------------

create table app.cash_movements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants on delete restrict,
  branch_id uuid not null,
  cash_session_id uuid not null,
  movement_type text not null check (movement_type in
    ('sale', 'refund', 'expense', 'paid_in', 'paid_out', 'safe_drop', 'tip_in', 'tip_out', 'correction')),
  direction smallint not null check (direction in (1, -1)),
  amount app.money not null check (amount > 0),
  payment_id uuid,
  refund_id uuid,
  corrects_movement_id uuid unique,
  reason text,
  recorded_by uuid not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, corrects_movement_id) references app.cash_movements (tenant_id, id),
  check (movement_type not in ('sale', 'paid_in', 'tip_in') or direction = 1),
  check (movement_type not in ('refund', 'expense', 'paid_out', 'safe_drop', 'tip_out') or direction = -1),
  check (movement_type <> 'sale' or payment_id is not null),
  check (movement_type <> 'refund' or refund_id is not null),
  check ((movement_type = 'correction') = (corrects_movement_id is not null)),
  check (movement_type not in ('paid_in', 'paid_out', 'safe_drop', 'correction') or reason is not null),
  foreign key (tenant_id, branch_id, cash_session_id) references app.cash_sessions (tenant_id, branch_id, id),
  foreign key (tenant_id, branch_id, payment_id) references app.payments (tenant_id, branch_id, id),
  foreign key (tenant_id, branch_id, refund_id) references app.refunds (tenant_id, branch_id, id),
  foreign key (tenant_id, recorded_by) references app.memberships (tenant_id, id)
);

create function app.guard_cash_movement() returns trigger language plpgsql as $$
begin
  perform app.lock_record('cash_session', new.cash_session_id);
  if (select status from app.cash_sessions where id = new.cash_session_id) <> 'open' then
    raise exception 'cash session % is closed', new.cash_session_id using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger guard_cash_movement before insert on app.cash_movements
  for each row execute function app.guard_cash_movement();

-- Expected cash is always worked out here, from the movements, never supplied by a client.
create function app.guard_cash_session() returns trigger language plpgsql as $$
begin
  if old.status = 'open' and new.status = 'closed' then
    perform app.lock_record('cash_session', old.id);
    if new.counted_amount is null then
      raise exception 'closing a session needs a counted amount' using errcode = 'P0001';
    end if;
    select old.opening_amount + coalesce(sum(direction * amount), 0) into new.expected_amount
      from app.cash_movements where cash_session_id = old.id;
    new.closed_by := app.membership_id();
    new.closed_at := now();
  elsif old.status = 'closed' and new.status = 'reviewed' then
    if new.counted_amount is distinct from old.counted_amount
       or new.expected_amount is distinct from old.expected_amount then
      raise exception 'a closed session cannot be changed' using errcode = 'P0001';
    end if;
    if old.closed_by = app.membership_id()
       and not (select allow_self_verification from app.tenants where id = old.tenant_id) then
      raise exception 'the person who closed this session cannot review it' using errcode = 'P0001';
    end if;
    if old.variance <> 0 and new.review_note is null then
      raise exception 'a cash difference needs a review note' using errcode = 'P0001';
    end if;
    new.reviewed_by := app.membership_id();
    new.reviewed_at := now();
  else
    raise exception 'cash session cannot move from % to %', old.status, new.status using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger guard_cash_session before update on app.cash_sessions
  for each row execute function app.guard_cash_session();

-- At commit, the money records must agree with each other. A voided payment
-- must have its allocations reversed, and a cash payment must be in the drawer.
create function app.check_payment_consistency(target uuid) returns void language plpgsql as $$
declare
  payment record;
  allocated numeric;
  in_drawer numeric;
  live boolean;
begin
  select * into payment from app.payments where id = target;
  live := payment.status in ('recorded', 'confirmed');
  select coalesce(sum(amount), 0) into allocated from app.payment_allocations where payment_id = target;
  if not live and allocated <> 0 then
    raise exception 'payment % is % but still has allocations', target, payment.status using errcode = 'P0001';
  end if;
  if not live and exists (
    select 1 from app.refunds where payment_id = target and status not in ('failed', 'voided')
  ) then
    raise exception 'payment % has a live refund', target using errcode = 'P0001';
  end if;
  if payment.method_kind = 'cash' then
    select coalesce(sum(direction * amount), 0) into in_drawer from app.cash_movements
     where payment_id = target and movement_type in ('sale', 'correction');
    if in_drawer <> (case when live then payment.amount else 0 end) then
      raise exception 'cash payment % does not match the drawer', target using errcode = 'P0001';
    end if;
  end if;
end $$;

create function app.check_payment_trigger() returns trigger language plpgsql as $$
begin
  perform app.check_payment_consistency(new.id);
  return null;
end $$;

create constraint trigger check_payment after insert or update on app.payments
  deferrable initially deferred for each row execute function app.check_payment_trigger();

create function app.check_movement_trigger() returns trigger language plpgsql as $$
begin
  if new.payment_id is not null then
    perform app.check_payment_consistency(new.payment_id);
  end if;
  return null;
end $$;

create constraint trigger check_movement after insert on app.cash_movements
  deferrable initially deferred for each row execute function app.check_movement_trigger();

create function app.check_refund_trigger() returns trigger language plpgsql as $$
declare
  in_drawer numeric;
begin
  if new.method_kind = 'cash' then
    select coalesce(sum(direction * amount), 0) into in_drawer from app.cash_movements
     where refund_id = new.id and movement_type in ('refund', 'correction');
    if in_drawer <> (case when new.status in ('failed', 'voided') then 0 else -new.amount end) then
      raise exception 'cash refund % does not match the drawer', new.id using errcode = 'P0001';
    end if;
  end if;
  return null;
end $$;

create constraint trigger check_refund after insert or update on app.refunds
  deferrable initially deferred for each row execute function app.check_refund_trigger();

