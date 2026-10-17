-- Remembers when a product's selling price changed. Orders already keep the price
-- they were sold at (order_items.unit_price), so a price change only affects orders
-- made after it; this log just records each change with its time (and the price it
-- replaced) so "when did it become $105?" can be answered. Written by a trigger, so
-- every way a price changes (Stock, the website sync, the Margin Report) is covered.
-- History starts when this is applied; earlier changes were not recorded.
create table if not exists public.product_price_history (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  price numeric(12, 2) not null,
  previous_price numeric(12, 2),
  changed_at timestamptz not null default now()
);

create index if not exists product_price_history_product_idx
  on public.product_price_history (product_id, changed_at desc);

alter table public.product_price_history enable row level security;

create or replace function public.log_product_price_change()
returns trigger
language plpgsql
as $$
begin
  insert into public.product_price_history (product_id, price, previous_price)
  values (new.id, new.price, old.price);
  return new;
end;
$$;

drop trigger if exists products_log_price_change on public.products;
create trigger products_log_price_change
  after update of price on public.products
  for each row
  when (old.price is distinct from new.price)
  execute function public.log_product_price_change();
