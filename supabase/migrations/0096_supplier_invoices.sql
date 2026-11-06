-- Stock > Supplier Invoices: a bill from a supplier for products bought in. Saving one adds each line's
-- quantity to Stock and sets the product's cost price to the line's unit cost (done by the app, see
-- src/app/(app)/stock/invoices/actions.ts); these tables only keep the record.
create table public.supplier_invoices (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  supplier_name text not null,
  invoice_number text,
  invoice_date date not null default current_date,
  total numeric(12, 2) not null default 0 check (total >= 0),
  paid boolean not null default false,
  note text,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index supplier_invoices_brand_date_idx on public.supplier_invoices (brand_id, invoice_date desc);

-- The same supplier's invoice number can be entered once: entering it again would add the stock twice.
create unique index supplier_invoices_supplier_number_key
  on public.supplier_invoices (lower(supplier_name), invoice_number)
  where invoice_number is not null;

create table public.supplier_invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.supplier_invoices (id) on delete cascade,
  product_id uuid not null references public.products (id),
  quantity numeric(12, 2) not null check (quantity > 0),
  unit_cost numeric(12, 2) not null check (unit_cost >= 0)
);

create index supplier_invoice_items_invoice_idx on public.supplier_invoice_items (invoice_id);

alter table public.supplier_invoices enable row level security;
alter table public.supplier_invoice_items enable row level security;
