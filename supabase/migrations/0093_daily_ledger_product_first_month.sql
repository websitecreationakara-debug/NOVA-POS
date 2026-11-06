-- The first month a product added from the Daily Ledger appears in (migration 0091): it is not listed
-- in earlier months. Null = every month. Products already there start from the first month anything
-- was typed into them.
alter table public.daily_ledger_products
  add column first_month text check (first_month ~ '^\d{4}-(0[1-9]|1[0-2])$');

update public.daily_ledger_products p
set first_month = (select min(e.month) from public.daily_ledger_product_entries e where e.product_id = p.id);
