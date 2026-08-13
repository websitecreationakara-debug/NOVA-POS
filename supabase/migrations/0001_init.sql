-- Phase 0: core brand/catalog data model for the NOVA POS system.
-- Brands in scope: BOSBA Premium Foods, BOSBA Drink&Snack, SORA SAKE.
-- Customers are shared across brands by default (no brand_id) until confirmed otherwise.

create extension if not exists "pgcrypto";

create type staff_role as enum ('admin', 'sales', 'stock', 'accountance', 'marketing');
create type payment_method as enum ('cash', 'bank_qr');
create type order_status as enum ('open', 'paid', 'voided');
create type discount_type as enum ('percent', 'fixed');

create table brands (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  created_at timestamptz not null default now()
);

create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  role staff_role not null,
  created_at timestamptz not null default now()
);

create table categories (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands (id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (brand_id, name)
);

create table products (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands (id) on delete cascade,
  category_id uuid references categories (id) on delete set null,
  sku text,
  name text not null,
  price numeric(12, 2) not null check (price >= 0),
  unit text not null default 'pcs',
  image_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id, sku)
);

create table customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  email text,
  notes text,
  created_at timestamptz not null default now()
);

create table stock_levels (
  product_id uuid primary key references products (id) on delete cascade,
  quantity numeric(12, 2) not null default 0,
  low_stock_threshold numeric(12, 2) not null default 0,
  updated_at timestamptz not null default now()
);

create table stock_adjustments (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products (id) on delete cascade,
  delta numeric(12, 2) not null,
  reason text not null,
  created_by uuid references profiles (id),
  created_at timestamptz not null default now()
);

create table promotions (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid references brands (id) on delete cascade,
  code text not null unique,
  description text,
  discount_type discount_type not null,
  discount_value numeric(12, 2) not null check (discount_value >= 0),
  starts_at timestamptz,
  ends_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table orders (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands (id),
  customer_id uuid references customers (id),
  status order_status not null default 'open',
  subtotal numeric(12, 2) not null default 0,
  discount numeric(12, 2) not null default 0,
  tax numeric(12, 2) not null default 0,
  total numeric(12, 2) not null default 0,
  payment_method payment_method,
  payment_reference text,
  created_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

create table order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders (id) on delete cascade,
  product_id uuid not null references products (id),
  quantity numeric(12, 2) not null check (quantity > 0),
  unit_price numeric(12, 2) not null,
  line_total numeric(12, 2) not null
);

create index products_brand_id_idx on products (brand_id);
create index categories_brand_id_idx on categories (brand_id);
create index orders_brand_id_idx on orders (brand_id);
create index order_items_order_id_idx on order_items (order_id);
create index stock_adjustments_product_id_idx on stock_adjustments (product_id);

insert into brands (slug, name) values
  ('bosba-premium-foods', 'BOSBA Premium Foods'),
  ('bosba-drink-snack', 'BOSBA Drink&Snack'),
  ('sora-sake', 'SORA SAKE');
