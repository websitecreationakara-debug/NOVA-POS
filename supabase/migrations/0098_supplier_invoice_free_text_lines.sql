-- Supplier Invoices: a line can be something that is not a product of the business (the supplier calls it
-- differently, or it is not sold). It keeps only its typed description -- no product, so it adds nothing to
-- Stock and sets no cost. Run after 0097.
alter table public.supplier_invoice_items
  alter column product_id drop not null,
  add column if not exists description text;

alter table public.supplier_invoice_items
  add constraint supplier_invoice_items_product_or_description
  check (product_id is not null or nullif(btrim(description), '') is not null);
