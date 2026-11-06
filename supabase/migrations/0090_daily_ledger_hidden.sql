-- Products dropped from the Stock > Daily Ledger's "Removed from Stock" group with its Delete button.
-- Only the ledger forgets them: the product itself, its stock history and its orders are untouched.
create table public.daily_ledger_hidden (
  product_id uuid primary key references public.products (id) on delete cascade,
  hidden_at timestamptz not null default now()
);

alter table public.daily_ledger_hidden enable row level security;
