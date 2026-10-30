-- ---------------------------------------------------------------------------
-- Invoices and credit notes. These tables are never updated.
-- ---------------------------------------------------------------------------

create table app.invoice_series (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants on delete restrict,
  tax_registration_id uuid not null,
  branch_id uuid not null,
  register_id uuid,
  document_type text not null check (document_type in ('tax_invoice', 'bill_of_supply', 'credit_note')),
  prefix text not null check (prefix ~ '^[A-Z0-9]{1,4}$'),
  financial_year char(4) not null check (financial_year ~ '^[0-9]{4}$'),
  next_number bigint not null default 1 check (next_number > 0),
  unique (tenant_id, id),
  unique (tenant_id, branch_id, tax_registration_id, document_type, id),
  unique nulls not distinct (tax_registration_id, branch_id, register_id, document_type, financial_year),
  foreign key (tenant_id, tax_registration_id) references app.tax_registrations (tenant_id, id),
  foreign key (tenant_id, branch_id) references app.branches (tenant_id, id),
  foreign key (tenant_id, branch_id, register_id) references app.registers (tenant_id, branch_id, id)
);

-- The number always comes from here, so nothing can type one in. The row lock is
-- held until commit, and a rollback restores the counter, so a failed bill leaves no gap.
create function app.assign_document_number() returns trigger language plpgsql as $$
declare
  document_date date := (to_jsonb(new) ->> tg_argv[0])::date;
  start_year integer := extract(year from document_date)::integer
    - case when extract(month from document_date) < 4 then 1 else 0 end;
  financial_year_code char(4) := right(start_year::text, 2) || right((start_year + 1)::text, 2);
  series record;
begin
  update app.invoice_series set next_number = next_number + 1
   where id = new.series_id
  returning prefix, financial_year, next_number - 1 as used into series;
  if not found then
    raise exception 'document series % not found', new.series_id using errcode = 'P0001';
  end if;
  if series.financial_year <> financial_year_code then
    raise exception 'series is for financial year %, but this document is dated %',
      series.financial_year, document_date using errcode = 'P0001';
  end if;
  new.number := series.prefix || '-' || series.financial_year || '-' || lpad(series.used::text, 6, '0');
  if char_length(new.number) > 16 then
    raise exception 'document number % exceeds 16 characters', new.number using errcode = 'P0001';
  end if;
  return new;
end $$;

create function app.guard_series_counter() returns trigger language plpgsql as $$
begin
  if new.next_number <> old.next_number + 1 then
    raise exception 'a document counter can only move forward by one' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger guard_series_counter before update on app.invoice_series
  for each row execute function app.guard_series_counter();

create table app.invoices (
  id uuid primary key,
  tenant_id uuid not null references app.tenants on delete restrict,
  branch_id uuid not null,
  tax_registration_id uuid not null,
  order_id uuid not null,
  series_id uuid not null,
  document_type text not null check (document_type in ('tax_invoice', 'bill_of_supply')),
  number text not null check (char_length(number) <= 16),
  invoice_date date not null,
  business_date date not null,
  customer_id uuid,
  seller_snapshot jsonb not null,
  buyer_snapshot jsonb,
  taxable_total app.money not null check (taxable_total >= 0),
  cgst_total app.money not null default 0 check (cgst_total >= 0),
  sgst_total app.money not null default 0 check (sgst_total >= 0),
  igst_total app.money not null default 0 check (igst_total >= 0),
  cess_total app.money not null default 0 check (cess_total >= 0),
  round_off app.money not null default 0 check (abs(round_off) < 1),
  grand_total app.money not null check (grand_total >= 0),
  issued_by uuid not null,
  issued_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, branch_id, id),
  unique (tax_registration_id, number),
  check (grand_total = taxable_total + cgst_total + sgst_total + igst_total + cess_total + round_off),
  check (document_type <> 'bill_of_supply' or cgst_total + sgst_total + igst_total + cess_total = 0),
  foreign key (tenant_id, branch_id, order_id) references app.orders (tenant_id, branch_id, id),
  foreign key (tenant_id, tax_registration_id) references app.tax_registrations (tenant_id, id),
  foreign key (tenant_id, branch_id, tax_registration_id, document_type, series_id)
    references app.invoice_series (tenant_id, branch_id, tax_registration_id, document_type, id),
  foreign key (tenant_id, customer_id) references app.customers (tenant_id, id),
  foreign key (tenant_id, issued_by) references app.memberships (tenant_id, id)
);

create function app.guard_invoice() returns trigger language plpgsql as $$
begin
  if (select tax_registration_id from app.branches where id = new.branch_id) <> new.tax_registration_id then
    raise exception 'invoice must use the tax registration of its branch' using errcode = 'P0001';
  end if;
  if ((select scheme from app.tax_registrations where id = new.tax_registration_id) = 'regular')
     <> (new.document_type = 'tax_invoice') then
    raise exception 'document type does not match the tax scheme' using errcode = 'P0001';
  end if;
  if (select status from app.orders where id = new.order_id) = 'cancelled' then
    raise exception 'a cancelled order cannot be invoiced' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger a_guard_invoice before insert on app.invoices
  for each row execute function app.guard_invoice();

create trigger b_number_invoice before insert on app.invoices
  for each row execute function app.assign_document_number('invoice_date');

create table app.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants on delete restrict,
  branch_id uuid not null,
  invoice_id uuid not null,
  order_item_id uuid,
  line_number integer not null check (line_number > 0),
  description text not null,
  hsn_sac text,
  quantity app.quantity not null,
  unit_price app.money not null check (unit_price >= 0),
  discount app.money not null default 0 check (discount >= 0),
  taxable_value app.money not null check (taxable_value >= 0),
  cgst_rate app.rate not null default 0,
  sgst_rate app.rate not null default 0,
  igst_rate app.rate not null default 0,
  cess_rate app.rate not null default 0,
  cgst app.money not null default 0 check (cgst >= 0),
  sgst app.money not null default 0 check (sgst >= 0),
  igst app.money not null default 0 check (igst >= 0),
  cess app.money not null default 0 check (cess >= 0),
  unique (tenant_id, id),
  unique (invoice_id, line_number),
  foreign key (tenant_id, branch_id, invoice_id) references app.invoices (tenant_id, branch_id, id),
  foreign key (tenant_id, branch_id, order_item_id) references app.order_items (tenant_id, branch_id, id)
);

-- A split bill can use an order item only up to the quantity ordered.
create function app.guard_invoice_line() returns trigger language plpgsql as $$
declare
  item record;
  billed numeric;
begin
  if new.order_item_id is null then
    return new;
  end if;
  perform app.lock_record('order_item', new.order_item_id);
  select quantity, status into item from app.order_items where id = new.order_item_id;
  if item.status <> 'active' then
    raise exception 'a voided item cannot be billed' using errcode = 'P0001';
  end if;
  select coalesce(sum(quantity), 0) into billed from app.invoice_lines where order_item_id = new.order_item_id;
  if billed + new.quantity > item.quantity then
    raise exception 'this item has already been billed' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger guard_invoice_line before insert on app.invoice_lines
  for each row execute function app.guard_invoice_line();

-- At commit, an invoice's totals must equal the sum of its lines. This also runs
-- for each new line, so a line cannot be slipped into an invoice afterwards.
create function app.check_invoice_totals() returns trigger language plpgsql as $$
declare
  target uuid := (to_jsonb(new) ->> tg_argv[0])::uuid;
  lines record;
  invoice record;
begin
  select * into invoice from app.invoices where id = target;
  select coalesce(sum(taxable_value), 0) taxable, coalesce(sum(cgst), 0) cgst, coalesce(sum(sgst), 0) sgst,
         coalesce(sum(igst), 0) igst, coalesce(sum(cess), 0) cess
    into lines from app.invoice_lines where invoice_id = target;
  if (lines.taxable, lines.cgst, lines.sgst, lines.igst, lines.cess)
     is distinct from (invoice.taxable_total::numeric, invoice.cgst_total::numeric, invoice.sgst_total::numeric,
                       invoice.igst_total::numeric, invoice.cess_total::numeric) then
    raise exception 'invoice % totals do not match its lines', target using errcode = 'P0001';
  end if;
  return null;
end $$;

create constraint trigger check_invoice_totals after insert on app.invoices
  deferrable initially deferred for each row execute function app.check_invoice_totals('id');

create constraint trigger check_invoice_line_totals after insert on app.invoice_lines
  deferrable initially deferred for each row execute function app.check_invoice_totals('invoice_id');

create table app.credit_notes (
  id uuid primary key,
  tenant_id uuid not null references app.tenants on delete restrict,
  branch_id uuid not null,
  tax_registration_id uuid not null,
  invoice_id uuid not null,
  series_id uuid not null,
  document_type text not null default 'credit_note' check (document_type = 'credit_note'),
  number text not null check (char_length(number) <= 16),
  kind text not null check (kind in ('cancellation', 'correction')),
  reason text not null,
  note_date date not null,
  business_date date not null,
  taxable_total app.money not null check (taxable_total >= 0),
  cgst_total app.money not null default 0 check (cgst_total >= 0),
  sgst_total app.money not null default 0 check (sgst_total >= 0),
  igst_total app.money not null default 0 check (igst_total >= 0),
  cess_total app.money not null default 0 check (cess_total >= 0),
  round_off app.money not null default 0 check (abs(round_off) < 1),
  grand_total app.money not null check (grand_total > 0),
  issued_by uuid not null,
  issued_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, branch_id, id),
  unique (tax_registration_id, number),
  check (grand_total = taxable_total + cgst_total + sgst_total + igst_total + cess_total + round_off),
  foreign key (tenant_id, branch_id, invoice_id) references app.invoices (tenant_id, branch_id, id),
  foreign key (tenant_id, tax_registration_id) references app.tax_registrations (tenant_id, id),
  foreign key (tenant_id, branch_id, tax_registration_id, document_type, series_id)
    references app.invoice_series (tenant_id, branch_id, tax_registration_id, document_type, id),
  foreign key (tenant_id, issued_by) references app.memberships (tenant_id, id)
);

create table app.credit_note_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants on delete restrict,
  branch_id uuid not null,
  credit_note_id uuid not null,
  invoice_line_id uuid not null,
  quantity app.quantity not null,
  taxable_value app.money not null check (taxable_value >= 0),
  cgst app.money not null default 0 check (cgst >= 0),
  sgst app.money not null default 0 check (sgst >= 0),
  igst app.money not null default 0 check (igst >= 0),
  cess app.money not null default 0 check (cess >= 0),
  foreign key (tenant_id, branch_id, credit_note_id) references app.credit_notes (tenant_id, branch_id, id),
  foreign key (tenant_id, invoice_line_id) references app.invoice_lines (tenant_id, id)
);

create function app.guard_credit_note() returns trigger language plpgsql as $$
declare
  invoice_total numeric;
  credited numeric;
begin
  perform app.lock_record('invoice', new.invoice_id);
  select grand_total into invoice_total from app.invoices where id = new.invoice_id;
  select coalesce(sum(grand_total), 0) into credited from app.credit_notes where invoice_id = new.invoice_id;
  if credited + new.grand_total > invoice_total then
    raise exception 'credit notes cannot exceed invoice total' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger a_guard_credit_note before insert on app.credit_notes
  for each row execute function app.guard_credit_note();

create trigger b_number_credit_note before insert on app.credit_notes
  for each row execute function app.assign_document_number('note_date');

create function app.check_credit_note_totals() returns trigger language plpgsql as $$
declare
  target uuid := (to_jsonb(new) ->> tg_argv[0])::uuid;
  lines record;
  note record;
begin
  select * into note from app.credit_notes where id = target;
  select coalesce(sum(taxable_value), 0) taxable, coalesce(sum(cgst), 0) cgst, coalesce(sum(sgst), 0) sgst,
         coalesce(sum(igst), 0) igst, coalesce(sum(cess), 0) cess
    into lines from app.credit_note_lines where credit_note_id = target;
  if (lines.taxable, lines.cgst, lines.sgst, lines.igst, lines.cess)
     is distinct from (note.taxable_total::numeric, note.cgst_total::numeric, note.sgst_total::numeric,
                       note.igst_total::numeric, note.cess_total::numeric) then
    raise exception 'credit note % totals do not match its lines', target using errcode = 'P0001';
  end if;
  return null;
end $$;

create constraint trigger check_credit_note_totals after insert on app.credit_notes
  deferrable initially deferred for each row execute function app.check_credit_note_totals('id');

create constraint trigger check_credit_note_line_totals after insert on app.credit_note_lines
  deferrable initially deferred for each row execute function app.check_credit_note_totals('credit_note_id');

