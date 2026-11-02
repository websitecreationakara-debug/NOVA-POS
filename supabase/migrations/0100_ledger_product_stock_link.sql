-- Daily Ledger: link a ledger product to the Stock product it is the same as, when the two are named
-- differently. A supplier invoice line for the ledger product then adds to that Stock product too (see
-- src/app/(app)/stock/invoices/actions.ts). Optional: ledger-only products stay unlinked. Run after 0099.
alter table public.daily_ledger_products
  add column if not exists stock_product_id uuid references public.products (id) on delete set null;

create index if not exists daily_ledger_products_stock_product_idx
  on public.daily_ledger_products (stock_product_id)
  where stock_product_id is not null;
