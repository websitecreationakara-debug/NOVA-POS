-- The group a product added from the Daily Ledger sits under (migration 0091). Null = "Added in ledger".
alter table public.daily_ledger_products add column category text;
