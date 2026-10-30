-- ---------------------------------------------------------------------------
-- Tax rates and menu
-- ---------------------------------------------------------------------------

create table app.tax_rates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants on delete restrict,
  name text not null,
  cgst_rate app.rate not null default 0,
  sgst_rate app.rate not null default 0,
  igst_rate app.rate not null default 0,
  cess_rate app.rate not null default 0,
  is_active boolean not null default true,
  unique (tenant_id, id),
  unique (tenant_id, name)
);

create table app.categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants on delete restrict,
  name text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  unique (tenant_id, id),
  unique (tenant_id, name)
);

create table app.products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants on delete restrict,
  category_id uuid not null,
  name text not null,
  description text,
  food_type text not null default 'none' check (food_type in ('veg', 'non_veg', 'egg', 'none')),
  hsn_sac text,
  tax_rate_id uuid not null,
  image_path text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, category_id) references app.categories (tenant_id, id),
  foreign key (tenant_id, tax_rate_id) references app.tax_rates (tenant_id, id)
);

-- Every product has at least one variant, so a price lives in exactly one place.
create table app.product_variants (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants on delete restrict,
  product_id uuid not null,
  name text not null default 'Regular',
  price app.money not null check (price >= 0),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  unique (tenant_id, id),
  unique (tenant_id, product_id, name),
  foreign key (tenant_id, product_id) references app.products (tenant_id, id)
);

create table app.addons (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants on delete restrict,
  name text not null,
  price app.money not null check (price >= 0),
  is_active boolean not null default true,
  unique (tenant_id, id)
);

create table app.product_addons (
  tenant_id uuid not null references app.tenants on delete restrict,
  product_id uuid not null,
  addon_id uuid not null,
  primary key (tenant_id, product_id, addon_id),
  foreign key (tenant_id, product_id) references app.products (tenant_id, id),
  foreign key (tenant_id, addon_id) references app.addons (tenant_id, id)
);

create table app.branch_variant_overrides (
  tenant_id uuid not null references app.tenants on delete restrict,
  branch_id uuid not null,
  variant_id uuid not null,
  price app.money check (price >= 0),
  is_available boolean not null default true,
  primary key (tenant_id, branch_id, variant_id),
  foreign key (tenant_id, branch_id) references app.branches (tenant_id, id),
  foreign key (tenant_id, variant_id) references app.product_variants (tenant_id, id)
);

