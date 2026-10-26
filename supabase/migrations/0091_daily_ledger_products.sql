-- Products added with the Stock > Daily Ledger's "Add product" button. They live in the ledger only:
-- no Stock row, no POS / Sales product, no website listing -- so they are not in the products table.
-- Everything else about them (begin stock, P / S / O per day, costs...) is typed into the ledger and
-- kept in daily_ledger_product_entries, the same fields as daily_ledger_entries (migration 0089).
create table public.daily_ledger_products (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  name text not null,
  unit text not null default 'pcs',
  unit_price numeric(12, 2) not null default 0 check (unit_price >= 0),
  created_at timestamptz not null default now()
);

create index daily_ledger_products_brand_idx on public.daily_ledger_products (brand_id);

create table public.daily_ledger_product_entries (
  product_id uuid not null references public.daily_ledger_products (id) on delete cascade,
  month text not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  field text not null check (
    field in ('sku', 'weight', 'unit', 'unit_price', 'ex_date', 's_price_loka', 'tc10', 'total_cost', 'begin')
    or field ~ '^[pso]:(0[1-9]|[12][0-9]|3[01])$'
  ),
  value text not null,
  updated_at timestamptz not null default now(),
  primary key (product_id, month, field)
);

alter table public.daily_ledger_products enable row level security;
alter table public.daily_ledger_product_entries enable row level security;
