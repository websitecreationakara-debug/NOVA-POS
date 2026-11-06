-- Supplier Invoices: remember the product's cost price from before the invoice set it, so deleting the
-- invoice can put it back (as well as the quantities). Invoices saved before this have no record and keep
-- their costs as set. Run after 0098.
alter table public.supplier_invoice_items
  add column if not exists previous_cost numeric(12, 2),
  add column if not exists cost_recorded boolean not null default false;
