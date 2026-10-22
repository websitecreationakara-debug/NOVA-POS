-- An invoice number staff typed in by hand (Orders > an order > the pencil next to its
-- number). Invoice numbers are normally worked out from the order's position in its month
-- (YYYYMM-N, see src/lib/invoiceNumber.ts); when this is set it is shown instead, on the
-- order page, the Orders list, the customer history and the printed invoice. Null = automatic.
alter table public.orders
  add column if not exists custom_invoice_number text;

-- Two orders can't carry the same typed-in number.
create unique index if not exists orders_custom_invoice_number_key
  on public.orders (custom_invoice_number)
  where custom_invoice_number is not null;
