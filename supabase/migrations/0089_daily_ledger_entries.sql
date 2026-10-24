-- Values typed into the Stock > Daily Ledger. The ledger works its figures out from the stock history,
-- the sold lines and Stock's costs; anything staff type into a cell is kept here, per product and
-- month, and shown in place of the worked-out number -- in the ledger only (Stock, prices and orders
-- are never changed by it). Clearing a cell deletes its row, so the worked-out number comes back.
--
-- field is the column: sku, weight, unit, unit_price, ex_date, s_price_loka, tc10, total_cost, begin,
-- or p:DD / s:DD / o:DD for the P, S and O cells of day DD of the month.
create table public.daily_ledger_entries (
  product_id uuid not null references public.products (id) on delete cascade,
  month text not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  field text not null check (
    field in ('sku', 'weight', 'unit', 'unit_price', 'ex_date', 's_price_loka', 'tc10', 'total_cost', 'begin')
    or field ~ '^[pso]:(0[1-9]|[12][0-9]|3[01])$'
  ),
  value text not null,
  updated_at timestamptz not null default now(),
  primary key (product_id, month, field)
);

create index daily_ledger_entries_month_idx on public.daily_ledger_entries (month);

alter table public.daily_ledger_entries enable row level security;
