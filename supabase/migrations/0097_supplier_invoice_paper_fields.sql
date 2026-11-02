-- Supplier Invoices: the other columns printed on the paper invoice -- SKU, Packing (e.g. "2L") and
-- Unit (bottle / pkt) on each line, and the Exchange Rate (riel per $1) on the invoice. Run after 0096.
alter table public.supplier_invoices
  add column if not exists exchange_rate numeric(12, 2) check (exchange_rate is null or exchange_rate > 0);

alter table public.supplier_invoice_items
  add column if not exists sku text,
  add column if not exists packing text,
  add column if not exists unit text;
