-- Accounting > COGS & Margin Tracking: the Expense Ads typed against a product for one month (Month view
-- only). GPAD = Gross Profit - Expense Ads. Run after 0101.
create table public.product_ads_expenses (
  product_id uuid not null references public.products (id) on delete cascade,
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  amount numeric(12, 2) not null default 0 check (amount >= 0),
  updated_at timestamptz not null default now(),
  primary key (product_id, month)
);

alter table public.product_ads_expenses enable row level security;
