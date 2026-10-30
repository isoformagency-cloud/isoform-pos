-- Design notes: docs/03-database-design.md
-- Tables live in a private `app` schema. Supabase's automatic REST API only
-- exposes `public`, so browsers have no route to these tables at all.

create schema app;

-- The API connects as a login role that belongs to app_user. It cannot bypass RLS.
create role app_user nologin;

-- ---------------------------------------------------------------------------
-- Request context. The API sets these with SET LOCAL inside each transaction.
-- An unset value becomes NULL, which matches no rows, so mistakes fail closed.
-- ---------------------------------------------------------------------------

create function app.tenant_id() returns uuid language sql stable as
  $$ select nullif(current_setting('app.tenant_id', true), '')::uuid $$;

create function app.user_id() returns uuid language sql stable as
  $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;

create function app.membership_id() returns uuid language sql stable as
  $$ select nullif(current_setting('app.membership_id', true), '')::uuid $$;

create function app.branch_ids() returns uuid[] language sql stable as
  $$ select coalesce(nullif(current_setting('app.branch_ids', true), '')::uuid[], '{}') $$;

-- Serialises work on one record until the transaction ends.
create function app.lock_record(kind text, id uuid) returns void language sql as
  $$ select pg_advisory_xact_lock(hashtextextended(kind || ':' || id::text, 0)) $$;

create domain app.money as numeric(14, 2);
create domain app.quantity as numeric(12, 3) check (value > 0);
create domain app.rate as numeric(6, 3) check (value >= 0 and value <= 100);


-- ---------------------------------------------------------------------------
-- Businesses, tax registrations and branches
-- ---------------------------------------------------------------------------

create table app.tenants (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (char_length(display_name) between 2 and 120),
  logo_path text,
  status text not null default 'pending' check (status in ('pending', 'active', 'suspended', 'closed')),
  currency char(3) not null default 'INR',
  rounding_rule text not null default 'nearest_rupee' check (rounding_rule in ('none', 'nearest_rupee')),
  prices_include_tax boolean not null default false,
  allow_self_verification boolean not null default false,
  created_at timestamptz not null default now()
);

create table app.tax_registrations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants on delete restrict,
  legal_name text not null,
  trade_name text,
  gstin char(15),
  state_code char(2) not null,
  scheme text not null check (scheme in ('regular', 'composition', 'unregistered')),
  address text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, gstin),
  check ((scheme = 'unregistered') = (gstin is null)),
  check (gstin is null or gstin ~ '^[0-9]{2}[A-Z0-9]{13}$')
);

create table app.branches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants on delete restrict,
  tax_registration_id uuid not null,
  name text not null,
  code text not null check (code ~ '^[A-Z0-9]{2,4}$'),
  address text,
  phone text,
  timezone text not null default 'Asia/Kolkata',
  day_cutoff time not null default '04:00',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, code),
  foreign key (tenant_id, tax_registration_id) references app.tax_registrations (tenant_id, id)
);

