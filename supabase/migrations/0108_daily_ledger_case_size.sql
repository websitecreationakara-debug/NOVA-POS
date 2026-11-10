-- Daily Ledger: the "Units / case" column (field case_size). The typed-value tables only accept a fixed list of
-- fields, so case_size is added to it -- on the table for products added in the ledger (0091) and the one for
-- POS products (0089). Run after 0107.
alter table public.daily_ledger_product_entries drop constraint if exists daily_ledger_product_entries_field_check;
alter table public.daily_ledger_product_entries add constraint daily_ledger_product_entries_field_check check (
  field in ('sku', 'weight', 'unit', 'unit_price', 'ex_date', 's_price_loka', 'tc10', 'total_cost', 'begin', 'case_size')
  or field ~ '^[pso]:(0[1-9]|[12][0-9]|3[01])$'
);

alter table public.daily_ledger_entries drop constraint if exists daily_ledger_entries_field_check;
alter table public.daily_ledger_entries add constraint daily_ledger_entries_field_check check (
  field in ('sku', 'weight', 'unit', 'unit_price', 'ex_date', 's_price_loka', 'tc10', 'total_cost', 'begin', 'case_size')
  or field ~ '^[pso]:(0[1-9]|[12][0-9]|3[01])$'
);
