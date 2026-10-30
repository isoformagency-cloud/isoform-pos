-- ---------------------------------------------------------------------------
-- People, access and devices
-- ---------------------------------------------------------------------------

create table app.memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants on delete restrict,
  user_id uuid not null references auth.users on delete restrict,
  display_name text not null,
  role text not null check (role in ('owner', 'manager', 'cashier', 'waiter', 'kitchen', 'accountant')),
  status text not null default 'active' check (status in ('active', 'suspended', 'removed')),
  pin_hash text,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, user_id)
);

create table app.branch_memberships (
  tenant_id uuid not null references app.tenants on delete restrict,
  membership_id uuid not null,
  branch_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, membership_id, branch_id),
  foreign key (tenant_id, membership_id) references app.memberships (tenant_id, id),
  foreign key (tenant_id, branch_id) references app.branches (tenant_id, id)
);

create table app.devices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants on delete restrict,
  branch_id uuid not null,
  name text not null,
  credential_hash text not null unique,
  status text not null default 'active' check (status in ('active', 'revoked')),
  registered_by uuid not null,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, branch_id) references app.branches (tenant_id, id),
  foreign key (tenant_id, registered_by) references app.memberships (tenant_id, id)
);

create table app.device_pin_attempts (
  tenant_id uuid not null references app.tenants on delete restrict,
  device_id uuid not null,
  membership_id uuid not null,
  failed_count integer not null default 0 check (failed_count >= 0),
  locked_until timestamptz,
  primary key (tenant_id, device_id, membership_id),
  foreign key (tenant_id, device_id) references app.devices (tenant_id, id),
  foreign key (tenant_id, membership_id) references app.memberships (tenant_id, id)
);

create table app.invitations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants on delete restrict,
  email text not null,
  role text not null check (role in ('owner', 'manager', 'cashier', 'waiter', 'kitchen', 'accountant')),
  branch_ids uuid[] not null default '{}',
  token_hash text not null unique,
  invited_by uuid not null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, invited_by) references app.memberships (tenant_id, id)
);

-- Created only when a bill is left unpaid, so we hold as little personal data as possible.
create table app.customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants on delete restrict,
  name text not null,
  phone text not null check (phone ~ '^[0-9]{10}$'),
  notes text,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, phone)
);

